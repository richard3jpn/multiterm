import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { Moon, PanelLeft, Sun, TerminalSquare } from './icons';
import { Button } from './primitives/Button';
import { NewTerminalButton } from './NewTerminalButton';
import { SettingsPanel } from './SettingsPanel';
import { Sidebar } from './Sidebar';
import type { SidebarGroup, SidebarItem } from './Sidebar';
import { WindowView } from './WindowView';
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
import { collectSessionIds, splitLeaf, updateRatio } from '../features/layout/layout-tree';
import type { SplitDirection, SplitPath } from '../features/layout/layout-tree';
import { useWorkspaceWindows } from '../hooks/use-workspace-windows';
import { summarizeWindowClose, windowCloseMessage } from '../features/window/close-window';
import { resolveDigitShortcut } from '../features/window/window-keys';
import { loadSettings } from '../features/settings/settings';
import {
  clampSidebarWidth,
  loadSidebarState,
  saveSidebarState,
} from '../features/sidebar/sidebar-state';
import type { SidebarState } from '../features/sidebar/sidebar-state';
import { resolveShellLabel } from '../features/settings/shell-label';
import { createSession, deleteSession, fetchSessions, fetchShells } from '../services/api';
import type { Session, SessionStatus, ShellInfo } from '../types';

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : '予期しないエラーが発生しました';

/** シェル検出の完了を待つ間隔と上限。WSLのコールドスタートは実測で10秒以上かかる */
const SHELL_FETCH_INTERVAL_MS = 2000;
const SHELL_FETCH_MAX_ATTEMPTS = 20;

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
    activeLayout: layout,
    activeSessionId,
    initialize: initializeWindows,
    updateActiveLayout,
    addSession,
    removeSession,
    focusSession,
    openWindow,
    closeWindow,
    switchWindow,
    renameWindowTitle,
  } = useWorkspaceWindows();
  // 各ターミナルの最新状態。サイドバーで一覧表示するため親で集約する
  const [statuses, setStatuses] = useState<Readonly<Record<string, SessionStatus>>>({});
  // 完了したがユーザーがまだ見ていないターミナル（herdr の done 相当）
  const [unseenDone, setUnseenDone] = useState<readonly string[]>([]);
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

  // Alt+1〜9 でアクティブウィンドウ内のN番目ペインへ、Alt+Shift+1〜9 でN番目の
  // ウィンドウへ移動する（RDD 9.6章・14章）。
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
      if (layout === null) return;
      const target = collectSessionIds(layout)[shortcut.index - 1];
      if (target === undefined) return;
      event.preventDefault();
      event.stopPropagation();
      focusSession(target);
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [layout, windows, focusSession, switchWindow]);

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
   * Alt+数字の序数は「いま見ているウィンドウのN番目」なので、番号を振るのは
   * アクティブウィンドウの行だけ。他ウィンドウの行に番号を出すと嘘になる。
   */
  const sidebarGroups: SidebarGroup[] = windows.map((termWindow, windowOrder) => {
    const ids = termWindow.layout === null ? [] : collectSessionIds(termWindow.layout);
    const isActiveWindow = termWindow.id === activeWindowId;
    const items: SidebarItem[] = ids.flatMap((sessionId, order) => {
      const session = sessions.find((s) => s.id === sessionId);
      if (!session) return [];
      const status = statuses[sessionId] ?? session.status;
      return [
        {
          sessionId,
          title: session.title,
          shellLabel: resolveShellLabel(session.shell, shells),
          state: resolvePaneState(status, unseenDone.includes(sessionId)),
          index: isActiveWindow && order < 9 ? order + 1 : null,
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
    <div
      className={`flex h-dvh flex-col bg-background text-foreground ${paneFrameClasses(overallState)}`}
    >
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
        <TerminalSquare className="size-5 text-primary" />
        <h1 className="text-sm font-semibold">MultiTerm</h1>
        <span className="text-xs text-muted-foreground">
          {sessions.length} セッション（上限16）
        </span>
        {overallState !== 'idle' && (
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${
              overallState === 'blocked'
                ? 'bg-red-500/15 text-red-400'
                : overallState === 'working'
                  ? 'bg-blue-500/15 text-blue-400'
                  : 'bg-orange-300/15 text-orange-300'
            }`}
            title="すべてのターミナルのうち、最も注意が必要な状態"
          >
            <span className={`inline-block size-1.5 rounded-full ${paneDotClasses(overallState)}`} />
            {paneStateLabel(overallState)}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <NewTerminalButton
            shells={shells}
            defaultShellId={settings.defaultShellId}
            onCreate={handleCreate}
          />
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
      </header>

      {errorMessage && (
        <div className="shrink-0 border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-xs text-destructive">
          {errorMessage}
        </div>
      )}

      <div ref={contentRef} className="flex min-h-0 flex-1">
        {sidebar.open && (
          <>
            <Sidebar
              groups={sidebarGroups}
              activeSessionId={activeSessionId}
              width={sidebar.width}
              onSelect={focusSession}
              onClose={handleClose}
              onRenamed={handleRenamed}
              onAddWindow={openWindow}
              onSelectWindow={switchWindow}
              onCloseWindow={handleCloseWindow}
              onRenameWindow={renameWindowTitle}
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
                />
              </div>
            ))
          )}
        </main>
      </div>
    </div>
  );
}
