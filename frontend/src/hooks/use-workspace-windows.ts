import { useCallback, useEffect, useState } from 'preact/hooks';
import { buildWindows } from '../features/window/build-windows';
import { loadWindows, saveWindows } from '../features/window/window-persistence';
import {
  activeWindow,
  addWindow,
  createWindow,
  nextWindowTitle,
  removeWindow,
  renameWindow,
  resolveActiveSession,
  setActiveWindow,
  updateWindow,
  windowIdOfSession,
} from '../features/window/window-model';
import { removeLeaf } from '../features/layout/layout-tree';
import type { LayoutNode } from '../features/layout/layout-tree';
import type { TermWindow, WindowsState } from '../features/window/window-model';
import type { Session } from '../types';

const newId = (): string => crypto.randomUUID();

/**
 * ウィンドウ構成の保持と永続化（RDD 14章）。
 *
 * 初期化前は null。初期化前の空状態で保存すると、localStorage のレイアウトを
 * 失うため、状態が入ってから保存する。
 */
export const useWorkspaceWindows = () => {
  const [state, setState] = useState<WindowsState | null>(null);

  useEffect(() => {
    if (state !== null) saveWindows(state);
  }, [state]);

  /** 生存セッション（バックエンドSSOT）で保存データを再構成する */
  const initialize = useCallback((sessions: readonly Session[]) => {
    setState(buildWindows(loadWindows(newId()), sessions, newId()));
  }, []);

  /** アクティブウィンドウのレイアウトだけを差し替える。分割・比率変更で使う */
  const updateActiveLayout = useCallback(
    (update: (layout: LayoutNode | null) => LayoutNode | null) => {
      setState((current) =>
        current === null
          ? current
          : updateWindow(current, current.activeWindowId, (window) => {
              const layout = update(window.layout);
              return {
                ...window,
                layout,
                activeSessionId: resolveActiveSession(layout, window.activeSessionId),
              };
            }),
      );
    },
    [],
  );

  /** 新しいターミナルをアクティブウィンドウへ置き、フォーカスする */
  const addSession = useCallback(
    (sessionId: string, place: (layout: LayoutNode | null) => LayoutNode) => {
      setState((current) =>
        current === null
          ? current
          : updateWindow(current, current.activeWindowId, (window) => ({
              ...window,
              layout: place(window.layout),
              activeSessionId: sessionId,
            })),
      );
    },
    [],
  );

  /**
   * ターミナルを画面から取り除く。所属ウィンドウを引いてから消すので、
   * 他ウィンドウで exit したセッションも正しく片付く。
   */
  const removeSession = useCallback((sessionId: string) => {
    setState((current) => {
      if (current === null) return current;
      const windowId = windowIdOfSession(current.windows, sessionId);
      if (windowId === undefined) return current;
      return updateWindow(current, windowId, (window) => {
        const layout = window.layout === null ? null : removeLeaf(window.layout, sessionId);
        return {
          ...window,
          layout,
          activeSessionId: resolveActiveSession(
            layout,
            window.activeSessionId === sessionId ? null : window.activeSessionId,
          ),
        };
      });
    });
  }, []);

  /** 他ウィンドウのターミナルを選んだときは、そのウィンドウへ切り替えてからフォーカスする */
  const focusSession = useCallback((sessionId: string) => {
    setState((current) => {
      if (current === null) return current;
      const windowId = windowIdOfSession(current.windows, sessionId) ?? current.activeWindowId;
      return updateWindow({ ...current, activeWindowId: windowId }, windowId, (window) => ({
        ...window,
        activeSessionId: sessionId,
      }));
    });
  }, []);

  const openWindow = useCallback(() => {
    setState((current) =>
      current === null
        ? current
        : addWindow(current, createWindow(newId(), nextWindowTitle(current.windows))),
    );
  }, []);

  const closeWindow = useCallback((windowId: string) => {
    setState((current) => (current === null ? current : removeWindow(current, windowId)));
  }, []);

  const switchWindow = useCallback((windowId: string) => {
    setState((current) => (current === null ? current : setActiveWindow(current, windowId)));
  }, []);

  const renameWindowTitle = useCallback((windowId: string, title: string) => {
    setState((current) => (current === null ? current : renameWindow(current, windowId, title)));
  }, []);

  const windows: readonly TermWindow[] = state?.windows ?? [];
  const current = state === null ? undefined : activeWindow(state);

  return {
    windows,
    activeWindowId: state?.activeWindowId ?? null,
    activeLayout: current?.layout ?? null,
    activeSessionId: current?.activeSessionId ?? null,
    initialize,
    updateActiveLayout,
    addSession,
    removeSession,
    focusSession,
    openWindow,
    closeWindow,
    switchWindow,
    renameWindowTitle,
  };
};
