import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { Moon, PanelLeft, Sun, TerminalSquare } from './icons';
import { Button } from './primitives/Button';
import { NewTerminalButton } from './NewTerminalButton';
import { SettingsPanel } from './SettingsPanel';
import { Sidebar } from './Sidebar';
import type { SidebarItem } from './Sidebar';
import { SplitPane } from './SplitPane';
import { TerminalPanel } from './TerminalPanel';
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
import { collectSessionIds, removeLeaf, splitLeaf, updateRatio } from '../features/layout/layout-tree';
import { buildLayout } from '../features/layout/build-layout';
import type { LayoutNode, SplitDirection, SplitPath } from '../features/layout/layout-tree';
import { loadLayout, saveLayout } from '../features/layout/persistence';
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
  const [layout, setLayout] = useState<LayoutNode | null>(null);
  const [shells, setShells] = useState<readonly ShellInfo[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sidebar, setSidebar] = useState<SidebarState>(loadSidebarState);
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
        setLayout(buildLayout(loadLayout(), alive));
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
  }, [setDefaultShellId]);

  useEffect(() => {
    if (loaded) saveLayout(layout);
  }, [layout, loaded]);

  useEffect(() => {
    saveSidebarState(sidebar);
  }, [sidebar]);

  // Alt+1〜9 で視覚順のN番目ターミナルへフォーカス移動（RDD 9.6章）。
  // キャプチャ段階で処理し、xtermがAlt+数字をシェルへ送るのを抑止する。
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey) return;
      if (!event.code.startsWith('Digit')) return;
      const n = Number(event.code.slice(5));
      if (!Number.isInteger(n) || n < 1 || n > 9) return;
      if (layout === null) return;
      const target = collectSessionIds(layout)[n - 1];
      if (target === undefined) return;
      event.preventDefault();
      event.stopPropagation();
      setActiveSessionId(target);
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [layout]);

  // shellId 未指定は既定シェル、指定時はそのシェルで作成し既定も更新（RDD 9.5章）
  const handleCreate = useCallback(
    async (shellId?: string | null) => {
      const chosen = shellId === undefined ? settings.defaultShellId : shellId;
      if (shellId !== undefined) setDefaultShellId(shellId);
      try {
        setErrorMessage(null);
        const session = await createSession(chosen);
        setSessions((current) => [...current, session]);
        setActiveSessionId(session.id);
        setLayout((current) =>
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
    [settings.defaultShellId, setDefaultShellId],
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
        setActiveSessionId(session.id);
        setLayout((current) =>
          current === null
            ? { type: 'leaf', sessionId: session.id }
            : splitLeaf(current, targetId, direction, session.id),
        );
      } catch (error: unknown) {
        setErrorMessage(toErrorMessage(error));
      }
    },
    [settings.defaultShellId, setDefaultShellId],
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

  const removeFromView = useCallback((sessionId: string) => {
    setSessions((current) => current.filter((s) => s.id !== sessionId));
    setLayout((current) => (current === null ? null : removeLeaf(current, sessionId)));
    setActiveSessionId((current) => (current === sessionId ? null : current));
  }, []);

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

  const handleRatioChange = useCallback((path: SplitPath, ratio: number) => {
    setLayout((current) => (current === null ? null : updateRatio(current, path, ratio)));
  }, []);

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

  const orderedIds = layout === null ? [] : collectSessionIds(layout);

  // サイドバーの行。レイアウト上の並び（Alt+数字の順）と一致させる
  const sidebarItems: SidebarItem[] = orderedIds.flatMap((sessionId, order) => {
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) return [];
    const status = statuses[sessionId] ?? session.status;
    return [
      {
        sessionId,
        title: session.title,
        shellLabel: resolveShellLabel(session.shell, shells),
        state: resolvePaneState(status, unseenDone.includes(sessionId)),
        index: order < 9 ? order + 1 : null,
      },
    ];
  });
  // ヘッダーのバッジ。1つでも注意が必要なら全体をその状態として見せる
  const overallState = aggregatePaneState(sidebarItems.map((item) => item.state));

  const renderLeaf = useCallback(
    (sessionId: string) => {
      const session = sessions.find((s) => s.id === sessionId);
      if (!session) return null;
      const order = orderedIds.indexOf(sessionId);
      return (
        <TerminalPanel
          session={session}
          shellLabel={resolveShellLabel(session.shell, shells)}
          shells={shells}
          index={order >= 0 && order < 9 ? order + 1 : null}
          active={sessionId === activeSessionId}
          onActivate={setActiveSessionId}
          onClose={handleClose}
          onSplit={handleSplit}
          onExited={removeFromView}
          onRenamed={handleRenamed}
          onStatusChange={handleStatusChange}
        />
      );
    },
    [
      sessions,
      shells,
      orderedIds,
      activeSessionId,
      handleClose,
      handleSplit,
      removeFromView,
      handleRenamed,
      handleStatusChange,
    ],
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
              items={sidebarItems}
              activeSessionId={activeSessionId}
              width={sidebar.width}
              onSelect={setActiveSessionId}
              onClose={handleClose}
              onRenamed={handleRenamed}
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

        <main className="min-h-0 min-w-0 flex-1 p-2">
          {!loaded ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              読み込み中...
            </div>
          ) : layout === null ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
              <p className="text-sm">ターミナルがありません</p>
              <NewTerminalButton
                shells={shells}
                defaultShellId={settings.defaultShellId}
                onCreate={handleCreate}
              />
            </div>
          ) : (
            <SplitPane
              node={layout}
              path={[]}
              renderLeaf={renderLeaf}
              onRatioChange={handleRatioChange}
            />
          )}
        </main>
      </div>
    </div>
  );
}
