import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { Columns3, Moon, PanelLeft, Rows3, Sun, TerminalSquare } from './icons';
import { Button } from './primitives/Button';
import { NewTerminalButton } from './NewTerminalButton';
import { SettingsPanel } from './SettingsPanel';
import { Sidebar } from './Sidebar';
import type { SidebarGroup, SidebarItem } from './Sidebar';
import { WindowControls } from './WindowControls';
import { WindowView } from './WindowView';
import {
  isDesktopApp,
  setupWindowResize,
  startWindowDrag,
} from '../features/window-controls/ipc';
import {
  aggregatePaneState,
  paneDotClasses,
  paneFrameClasses,
  paneStateLabel,
  resolvePaneState,
  shouldMarkDone,
} from '../features/status/pane-state';
import { useSettings } from '../contexts/settings-context';
import { useTheme } from '../contexts/theme-context';
import {
  collectSessionIds,
  equalizeRatios,
  splitLeaf,
  updateRatio,
} from '../features/layout/layout-tree';
import type { SplitDirection, SplitPath } from '../features/layout/layout-tree';
import { useWorkspaceWindows } from '../hooks/use-workspace-windows';
import { summarizeWindowClose, windowCloseMessage } from '../features/window/close-window';
import { resolveDigitShortcut } from '../features/window/window-keys';
import { buildDigitOrdinals, collectAllSessionIds } from '../features/window/window-model';
import { loadSettings } from '../features/settings/settings';
import {
  clampSidebarWidth,
  loadSidebarState,
  saveSidebarState,
} from '../features/sidebar/sidebar-state';
import type { SidebarState } from '../features/sidebar/sidebar-state';
import { resolveShellLabel } from '../features/settings/shell-label';
import {
  formatCpuPercent,
  formatGpuPercent,
  formatMemory,
  formatMemoryPercent,
} from '../features/metrics/format';
import {
  createSession,
  deleteSession,
  fetchMetrics,
  fetchSessions,
  fetchShells,
} from '../services/api';
import type { MetricsSnapshot, Session, SessionStatus, ShellInfo } from '../types';

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : '予期しないエラーが発生しました';

/** シェル検出の完了を待つ間隔と上限。WSLのコールドスタートは実測で10秒以上かかる */
const SHELL_FETCH_INTERVAL_MS = 2000;
const SHELL_FETCH_MAX_ATTEMPTS = 20;

/**
 * リソース使用量の取得間隔（RDD 17章）。
 *
 * CPU使用率は前回計測との差分で出るため、空けすぎると平均化されて動きが見えなくなる。
 * 逆に詰めすぎると全プロセスの走査が頻繁になり、測っている側が重くなる。
 */
const METRICS_INTERVAL_MS = 2000;

/**
 * デスクトップの窓の中で動いているか（RDD 16.7）。
 *
 * 起動後に変わることはないのでモジュール読み込み時に一度だけ判定する。
 * ブラウザのタブで開いたときは false になり、窓の操作UIを出さない。
 */
const desktopApp = isDesktopApp();

export function Workspace() {
  const { theme, toggleTheme } = useTheme();
  const { settings, setDefaultShellId } = useSettings();
  const [sessions, setSessions] = useState<readonly Session[]>([]);
  const [shells, setShells] = useState<readonly ShellInfo[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [sidebar, setSidebar] = useState<SidebarState>(loadSidebarState);
  // ウィンドウ構成と、その中のレイアウト・フォーカス（RDD 14章）
  const {
    windows,
    activeWindowId,
    activeSessionId,
    initialize: initializeWindows,
    updateActiveLayout,
    addSession,
    removeSession,
    focusSession,
    moveSession,
    moveSessionToOtherWindow,
    openWindow,
    closeWindow,
    switchWindow,
    renameWindowTitle,
  } = useWorkspaceWindows();
  // 各ターミナルの最新状態。サイドバーで一覧表示するため親で集約する
  const [statuses, setStatuses] = useState<Readonly<Record<string, SessionStatus>>>({});
  // 完了したがユーザーがまだ見ていないターミナル（herdr の done 相当）
  const [unseenDone, setUnseenDone] = useState<readonly string[]>([]);
  // アプリとターミナルのリソース使用量（RDD 17章）。取得できるまでは null
  const [metrics, setMetrics] = useState<MetricsSnapshot | null>(null);
  // 状態変化のコールバックから最新のアクティブIDを参照するためのref
  const activeSessionIdRef = useRef<string | null>(null);
  activeSessionIdRef.current = activeSessionId;
  // 直前の状態。実行中→待機の遷移だけを「完了」と判定するために使う
  const previousStatusRef = useRef<Record<string, SessionStatus>>({});
  // 実行中になった時刻。一瞬の実行を完了に数えないための判定に使う
  const runningSinceRef = useRef<Record<string, number>>({});
  // サイドバー幅のドラッグ計算に使う、サイドバー＋ターミナル領域の左端基準
  const contentRef = useRef<HTMLDivElement>(null);

  // 初期化: バックエンドの生存セッションをSSOTとしてレイアウトを復元（RDD 7章）
  // シェル一覧の取得失敗はセッション復元に影響させない（独立して失敗許容）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const alive = await fetchSessions();
        if (cancelled) return;
        setSessions(alive);
        initializeWindows(alive);
      } catch (error: unknown) {
        if (!cancelled) setErrorMessage(toErrorMessage(error));
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    (async () => {
      // WSLの検出は時間がかかる。バックエンドは即座に使えるシェルで先に応答するので、
      // 検出が終わるまで取り直して一覧を最新にする（RDD 9.2章の許可リスト）
      for (let attempt = 0; attempt < SHELL_FETCH_MAX_ATTEMPTS; attempt += 1) {
        try {
          const { shells: shellList, detecting } = await fetchShells();
          if (cancelled) return;
          setShells(shellList);
          if (!detecting) {
            // localStorageの既定シェルが現在の許可リストに無ければnullへ矯正（恒常400を回避）
            const stored = loadSettings().defaultShellId;
            if (stored !== null && !shellList.some((s) => s.id === stored)) {
              setDefaultShellId(null);
            }
            return;
          }
        } catch {
          // シェル一覧取得失敗時は「サーバ既定」で作成可能なため空のまま継続
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, SHELL_FETCH_INTERVAL_MS));
        if (cancelled) return;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setDefaultShellId, initializeWindows]);

  useEffect(() => {
    saveSidebarState(sidebar);
  }, [sidebar]);

  // リソース使用量を定期取得する（RDD 17章）。
  // 取得に失敗してもターミナルの操作には関係しないので、エラー表示は出さず次回に任せる。
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const snapshot = await fetchMetrics();
        if (!cancelled) setMetrics(snapshot);
      } catch {
        // 計測が取れないだけ。画面は動かし続ける
      }
    };
    void load();
    const timer = setInterval(() => void load(), METRICS_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  // 窓の枠を掴んでリサイズできるようにする（RDD 16.7）。ブラウザでは何も登録しない
  useEffect(() => setupWindowResize(), []);

  /**
   * ヘッダーの空白をドラッグして窓を動かす（RDD 16.7）。
   *
   * WebView2 123+ では CSS の `app-region: drag` が先に効くのでここへは来ない。
   * それ未満のための保険。
   */
  const handleTitlebarMouseDown = useCallback((event: JSX.TargetedMouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    // 押した先がボタンや入力欄なら動かさない（押したつもりで窓が動くのを防ぐ）
    if ((event.target as HTMLElement).closest('button, input, a')) return;
    startWindowDrag();
  }, []);

  // Alt+1〜9 で全ウィンドウ通しのN番目ペインへ、Alt+Shift+1〜9 でN番目の
  // ウィンドウへ移動する（RDD 9.6章・14章）。
  // 番号は全ウィンドウ通しなので、いま見ていないウィンドウのターミナルへも飛ぶ。
  // focusSession が所属ウィンドウへの切り替えまで面倒を見る。
  // キャプチャ段階で処理し、xtermがこれらのキーをシェルへ送るのを抑止する。
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const shortcut = resolveDigitShortcut(event);
      if (shortcut === null) return;
      if (shortcut.kind === 'window') {
        const target = windows[shortcut.index - 1];
        if (target === undefined) return;
        event.preventDefault();
        event.stopPropagation();
        switchWindow(target.id);
        return;
      }
      const target = collectAllSessionIds(windows)[shortcut.index - 1];
      if (target === undefined) return;
      event.preventDefault();
      event.stopPropagation();
      focusSession(target);
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [windows, focusSession, switchWindow]);

  // shellId 未指定は既定シェル、指定時はそのシェルで作成し既定も更新（RDD 9.5章）
  const handleCreate = useCallback(
    async (shellId?: string | null) => {
      const chosen = shellId === undefined ? settings.defaultShellId : shellId;
      if (shellId !== undefined) setDefaultShellId(shellId);
      try {
        setErrorMessage(null);
        const session = await createSession(chosen);
        setSessions((current) => [...current, session]);
        addSession(session.id, (current) =>
          current === null
            ? { type: 'leaf', sessionId: session.id }
            : {
                type: 'split',
                direction: 'vertical',
                ratio: 0.5,
                first: current,
                second: { type: 'leaf', sessionId: session.id },
              },
        );
      } catch (error: unknown) {
        setErrorMessage(toErrorMessage(error));
      }
    },
    [settings.defaultShellId, setDefaultShellId, addSession],
  );

  // shellId 未指定は既定シェル、指定時はそのシェルで分割し既定も更新（RDD 9.7章）
  const handleSplit = useCallback(
    async (targetId: string, direction: SplitDirection, shellId?: string | null) => {
      const chosen = shellId === undefined ? settings.defaultShellId : shellId;
      if (shellId !== undefined) setDefaultShellId(shellId);
      try {
        setErrorMessage(null);
        const session = await createSession(chosen);
        setSessions((current) => [...current, session]);
        addSession(session.id, (current) =>
          current === null
            ? { type: 'leaf', sessionId: session.id }
            : splitLeaf(current, targetId, direction, session.id),
        );
      } catch (error: unknown) {
        setErrorMessage(toErrorMessage(error));
      }
    },
    [settings.defaultShellId, setDefaultShellId, addSession],
  );

  const handleRenamed = useCallback((updated: Session) => {
    setSessions((current) => current.map((s) => (s.id === updated.id ? updated : s)));
  }, []);

  /**
   * 各ターミナルの状態変化を集約する。
   * 見ていないターミナルが完了したら「完了（未確認）」として残し、
   * 分割が多いときでも見落とさないようにする（herdr の done の考え方）。
   *
   * 「完了」とみなすのは実行中から待機へ変わったときだけ。
   * 最初から待機しているターミナルを完了扱いしないための条件。
   */
  const handleStatusChange = useCallback((sessionId: string, status: SessionStatus) => {
    const previous = previousStatusRef.current[sessionId];
    previousStatusRef.current = { ...previousStatusRef.current, [sessionId]: status };
    setStatuses((current) => ({ ...current, [sessionId]: status }));

    if (status === 'running') {
      runningSinceRef.current = { ...runningSinceRef.current, [sessionId]: Date.now() };
      return;
    }
    const startedAt = runningSinceRef.current[sessionId];
    const marked = shouldMarkDone({
      status,
      previous,
      isActive: sessionId === activeSessionIdRef.current,
      runningMs: startedAt === undefined ? null : Date.now() - startedAt,
    });
    if (marked) {
      setUnseenDone((current) =>
        current.includes(sessionId) ? current : [...current, sessionId],
      );
    }
  }, []);

  // 見たターミナルの「未確認」は解除する
  useEffect(() => {
    if (activeSessionId === null) return;
    setUnseenDone((current) =>
      current.includes(activeSessionId) ? current.filter((id) => id !== activeSessionId) : current,
    );
  }, [activeSessionId]);

  const removeFromView = useCallback(
    (sessionId: string) => {
      setSessions((current) => current.filter((s) => s.id !== sessionId));
      removeSession(sessionId);
    },
    [removeSession],
  );

  const handleClose = useCallback(
    async (sessionId: string) => {
      removeFromView(sessionId);
      try {
        await deleteSession(sessionId);
      } catch (error: unknown) {
        setErrorMessage(toErrorMessage(error));
      }
    },
    [removeFromView],
  );

  /**
   * ウィンドウを閉じると中のターミナルも終了する（RDD 14章）。
   * 実行中・入力待ちを巻き込むときだけ確認を挟む（全部待機なら黙って閉じてよい）。
   */
  const handleCloseWindow = useCallback(
    async (windowId: string) => {
      const target = windows.find((termWindow) => termWindow.id === windowId);
      if (target === undefined) return;
      const summary = summarizeWindowClose(target.layout, (id) => statuses[id]);
      if (summary.needsConfirm && !window.confirm(windowCloseMessage(target.title, summary))) {
        return;
      }
      closeWindow(windowId);
      setSessions((current) => current.filter((s) => !summary.sessionIds.includes(s.id)));
      // 1つ失敗しても残りは閉じにいく
      const results = await Promise.allSettled(summary.sessionIds.map(deleteSession));
      const failed = results.filter((result) => result.status === 'rejected').length;
      if (failed > 0) setErrorMessage(`${failed} 個のターミナルを終了できませんでした`);
    },
    [windows, statuses, closeWindow],
  );

  const handleRatioChange = useCallback(
    (path: SplitPath, ratio: number) => {
      updateActiveLayout((current) => (current === null ? null : updateRatio(current, path, ratio)));
    },
    [updateActiveLayout],
  );

  // 表示中のウィンドウの、指定した向きの分割を同じ大きさに揃える（RDD 18章）
  const handleEqualize = useCallback(
    (direction: SplitDirection) => {
      updateActiveLayout((current) =>
        current === null ? null : equalizeRatios(current, direction),
      );
    },
    [updateActiveLayout],
  );

  // サイドバー右端のドラッグで幅を変更する（SplitPane の境界線と同じ方式）
  const handleSidebarPointerDown = useCallback(
    (event: JSX.TargetedPointerEvent<HTMLDivElement>) => {
      const container = contentRef.current;
      if (!container) return;
      event.preventDefault();
      const rect = container.getBoundingClientRect();

      const handleMove = (moveEvent: PointerEvent) => {
        const width = clampSidebarWidth(moveEvent.clientX - rect.left);
        setSidebar((current) => ({ ...current, width }));
      };
      const handleUp = () => {
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleUp);
      };
      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', handleUp);
    },
    [],
  );

  /**
   * サイドバーの行をウィンドウごとにまとめる（RDD 14章）。
   *
   * Alt+数字の序数は全ウィンドウ通しなので、どのウィンドウの行にも出す。
   * 番号を見れば、いま見ていないウィンドウのターミナルへも直接飛べる。
   */
  const digitOrdinals = buildDigitOrdinals(windows);
  // セッションIDから使用量を引けるようにする（RDD 17章）。未取得・終了直後は undefined
  const usageBySession = new Map(metrics?.sessions.map((usage) => [usage.sessionId, usage]) ?? []);
  const sidebarGroups: SidebarGroup[] = windows.map((termWindow, windowOrder) => {
    const ids = termWindow.layout === null ? [] : collectSessionIds(termWindow.layout);
    const isActiveWindow = termWindow.id === activeWindowId;
    const items: SidebarItem[] = ids.flatMap((sessionId) => {
      const session = sessions.find((s) => s.id === sessionId);
      if (!session) return [];
      const status = statuses[sessionId] ?? session.status;
      return [
        {
          sessionId,
          title: session.title,
          shellLabel: resolveShellLabel(session.shell, shells),
          state: resolvePaneState(status, unseenDone.includes(sessionId)),
          index: digitOrdinals.get(sessionId) ?? null,
          usage: usageBySession.get(sessionId) ?? null,
        },
      ];
    });
    return {
      windowId: termWindow.id,
      title: termWindow.title,
      active: isActiveWindow,
      state: aggregatePaneState(items.map((item) => item.state)),
      index: windowOrder < 9 ? windowOrder + 1 : null,
      canClose: windows.length > 1,
      items,
    };
  });
  // ヘッダーのバッジと画面の外枠。全ウィンドウを横断し、1つでも注意が必要ならその状態にする
  const overallState = aggregatePaneState(
    sidebarGroups.flatMap((group) => group.items.map((item) => item.state)),
  );

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex shrink-0 items-center gap-3 border-b px-4 py-2">
        <Button
          variant="ghost"
          size="icon-sm"
          title={sidebar.open ? 'サイドバーを閉じる' : 'サイドバーを開く'}
          aria-label={sidebar.open ? 'サイドバーを閉じる' : 'サイドバーを開く'}
          aria-expanded={sidebar.open}
          onClick={() => setSidebar((current) => ({ ...current, open: !current.open }))}
        >
          <PanelLeft />
        </Button>
        {/*
          デスクトップ版ではここが窓のタイトルバーを兼ねる（RDD 16.7）。
          ボタンを1つも含めない範囲だけをドラッグ領域にしてあるので、
          個々の要素へ app-no-drag を振らなくて済む。
        */}
        <div
          className={`flex min-w-0 flex-1 items-center gap-3 ${desktopApp ? 'app-drag-region' : ''}`}
          onMouseDown={desktopApp ? handleTitlebarMouseDown : undefined}
        >
          <TerminalSquare className="size-5 shrink-0 text-primary" />
          <h1 className="shrink-0 text-sm font-semibold">MultiTerm</h1>
          {/* どのビルドを見ているか分かるようにする。上げ方は README を参照 */}
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            v{__APP_VERSION__}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {sessions.length} セッション（上限16）
          </span>
          {metrics !== null && (
            <span
              className="whitespace-nowrap text-xs tabular-nums text-muted-foreground"
              title={`MultiTerm 全体（バックエンドと全ターミナル）の使用量。CPUは${metrics.cpuCount}コア、メモリはマシンの総量に対する割合`}
            >
              CPU {formatCpuPercent(metrics.app.cpuPercent, metrics.cpuCount)} · MEM{' '}
              {formatMemoryPercent(metrics.app.memoryBytes, metrics.totalMemoryBytes)}（
              {formatMemory(metrics.app.memoryBytes)}） · GPU{' '}
              {formatGpuPercent(metrics.app.gpuPercent)}
            </span>
          )}
          {overallState !== 'idle' && (
            <span
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                overallState === 'blocked'
                  ? 'bg-red-500/15 text-red-400'
                  : overallState === 'working'
                    ? 'bg-blue-500/15 text-blue-400'
                    : 'bg-orange-300/15 text-orange-300'
              }`}
              title="すべてのターミナルのうち、最も注意が必要な状態"
            >
              <span
                className={`inline-block size-1.5 rounded-full ${paneDotClasses(overallState)}`}
              />
              {paneStateLabel(overallState)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <NewTerminalButton
            shells={shells}
            defaultShellId={settings.defaultShellId}
            onCreate={handleCreate}
          />
          <Button
            variant="outline"
            size="icon"
            onClick={() => handleEqualize('vertical')}
            title="左右の幅を揃える"
            aria-label="左右の幅を揃える"
          >
            <Columns3 />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => handleEqualize('horizontal')}
            title="上下の高さを揃える"
            aria-label="上下の高さを揃える"
          >
            <Rows3 />
          </Button>
          <SettingsPanel />
          <Button
            variant="outline"
            size="icon"
            onClick={toggleTheme}
            title={theme === 'dark' ? 'ライトテーマへ' : 'ダークテーマへ'}
          >
            {theme === 'dark' ? <Sun /> : <Moon />}
          </Button>
        </div>
        {desktopApp && <WindowControls />}
      </header>

      {errorMessage && (
        <div className="shrink-0 border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-xs text-destructive">
          {errorMessage}
        </div>
      )}

      {/* 状態の外枠はヘッダーより下だけ。ヘッダーはタイトルバーを兼ねる（RDD 16.6） */}
      <div ref={contentRef} className={`flex min-h-0 flex-1 ${paneFrameClasses(overallState)}`}>
        {sidebar.open && (
          <>
            <Sidebar
              groups={sidebarGroups}
              activeSessionId={activeSessionId}
              width={sidebar.width}
              cpuCount={metrics?.cpuCount ?? 1}
              totalMemoryBytes={metrics?.totalMemoryBytes ?? 0}
              onSelect={focusSession}
              onClose={handleClose}
              onRenamed={handleRenamed}
              onAddWindow={openWindow}
              onSelectWindow={switchWindow}
              onCloseWindow={handleCloseWindow}
              onRenameWindow={renameWindowTitle}
              onMoveToWindow={moveSessionToOtherWindow}
            />
            <div
              role="separator"
              aria-orientation="vertical"
              onPointerDown={handleSidebarPointerDown}
              title="ドラッグでサイドバーの幅を変更"
              className="w-1.5 shrink-0 cursor-col-resize bg-border transition-colors hover:bg-primary/60"
            />
          </>
        )}

        {/*
          非アクティブなウィンドウも display:none でDOMに残す（RDD 14章）。
          外すとWebSocketが切れて再接続とちらつきが起き、実行中のコマンドの画面も作り直しになる。
          xtermは非表示になると描画を自動で止めるため、残しておくコストは小さい。
        */}
        <main className="min-h-0 min-w-0 flex-1 p-2">
          {!loaded ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              読み込み中...
            </div>
          ) : (
            windows.map((termWindow) => (
              <div
                key={termWindow.id}
                className={termWindow.id === activeWindowId ? 'h-full w-full' : 'hidden'}
              >
                <WindowView
                  termWindow={termWindow}
                  ordinals={digitOrdinals}
                  visible={termWindow.id === activeWindowId}
                  sessions={sessions}
                  shells={shells}
                  defaultShellId={settings.defaultShellId}
                  onCreate={handleCreate}
                  onActivate={focusSession}
                  onClose={handleClose}
                  onSplit={handleSplit}
                  onExited={removeFromView}
                  onRenamed={handleRenamed}
                  onStatusChange={handleStatusChange}
                  onRatioChange={handleRatioChange}
                  onMove={moveSession}
                />
              </div>
            ))
          )}
        </main>
      </div>
    </div>
  );
}
