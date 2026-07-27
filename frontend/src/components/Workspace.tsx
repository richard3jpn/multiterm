import { useCallback, useEffect, useState } from 'react';
import { Moon, Sun, TerminalSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { NewTerminalButton } from './NewTerminalButton';
import { SettingsPanel } from './SettingsPanel';
import { SplitPane } from './SplitPane';
import { TerminalPanel } from './TerminalPanel';
import { useSettings } from '../contexts/settings-context';
import { useTheme } from '../contexts/theme-context';
import { collectSessionIds, removeLeaf, splitLeaf, updateRatio } from '../features/layout/layout-tree';
import { buildLayout } from '../features/layout/build-layout';
import type { LayoutNode, SplitDirection, SplitPath } from '../features/layout/layout-tree';
import { loadLayout, saveLayout } from '../features/layout/persistence';
import { loadSettings } from '../features/settings/settings';
import { resolveShellLabel } from '../features/settings/shell-label';
import { createSession, deleteSession, fetchSessions, fetchShells } from '../services/api';
import type { Session, ShellInfo } from '../types';

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : '予期しないエラーが発生しました';

export function Workspace() {
  const { theme, toggleTheme } = useTheme();
  const { settings, setDefaultShellId } = useSettings();
  const [sessions, setSessions] = useState<readonly Session[]>([]);
  const [layout, setLayout] = useState<LayoutNode | null>(null);
  const [shells, setShells] = useState<readonly ShellInfo[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

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
      try {
        const shellList = await fetchShells();
        if (cancelled) return;
        setShells(shellList);
        // localStorageの既定シェルが現在の許可リストに無ければnullへ矯正（恒常400を回避）
        const stored = loadSettings().defaultShellId;
        if (stored !== null && !shellList.some((s) => s.id === stored)) {
          setDefaultShellId(null);
        }
      } catch {
        // シェル一覧取得失敗時は「サーバ既定」で作成可能なため空のまま継続
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setDefaultShellId]);

  useEffect(() => {
    if (loaded) saveLayout(layout);
  }, [layout, loaded]);

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

  const orderedIds = layout === null ? [] : collectSessionIds(layout);

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
        />
      );
    },
    [sessions, shells, orderedIds, activeSessionId, handleClose, handleSplit, removeFromView, handleRenamed],
  );

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex shrink-0 items-center gap-3 border-b px-4 py-2">
        <TerminalSquare className="size-5 text-primary" />
        <h1 className="text-sm font-semibold">MultiTerm</h1>
        <span className="text-xs text-muted-foreground">
          {sessions.length} セッション（上限16）
        </span>
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

      <main className="min-h-0 flex-1 p-2">
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
          <SplitPane node={layout} path={[]} renderLeaf={renderLeaf} onRatioChange={handleRatioChange} />
        )}
      </main>
    </div>
  );
}
