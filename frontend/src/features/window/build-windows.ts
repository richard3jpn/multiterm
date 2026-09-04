import { appendSessionsRight } from '../layout/build-layout';
import { collectSessionIds, pruneDeadLeaves, removeLeaf } from '../layout/layout-tree';
import {
  createWindow,
  findWindow,
  resolveActiveSession,
  updateWindow,
} from './window-model';
import type { TermWindow, WindowsState } from './window-model';
import type { LayoutNode } from '../layout/layout-tree';
import type { Session } from '../../types';

const FIRST_WINDOW_TITLE = 'Window 1';

/**
 * 同じセッションが複数のウィンドウに載っている保存データを正す。
 * 先に出たウィンドウの葉を残し、後続からは取り除く（排他所属の不変条件）。
 */
const dedupeSessions = (windows: readonly TermWindow[]): readonly TermWindow[] => {
  const seen = new Set<string>();
  return windows.map((window) => {
    if (window.layout === null) return window;
    let layout: LayoutNode | null = window.layout;
    for (const sessionId of collectSessionIds(window.layout)) {
      if (seen.has(sessionId)) {
        layout = layout === null ? null : removeLeaf(layout, sessionId);
      } else {
        seen.add(sessionId);
      }
    }
    return layout === window.layout ? window : { ...window, layout };
  });
};

/**
 * 保存されたウィンドウ構成を、生存セッション（バックエンドSSOT）で再構成する（RDD 7章・14章）。
 *
 * - 死んだセッションの葉は全ウィンドウから除去する
 * - どのウィンドウにも載っていない生存セッションは、アクティブウィンドウへ右側に足す
 * - 中身が空になったウィンドウも残す（ユーザーが作った面を勝手に消さない）
 *
 * `fallbackWindowId` は保存データが無い/壊れているときに作る最初のウィンドウのID。
 * 呼び出し側が採番することで、この関数自体は決定的に保てる。
 */
export const buildWindows = (
  stored: WindowsState | null,
  sessions: readonly Session[],
  fallbackWindowId: string,
): WindowsState => {
  const firstWindow = (): WindowsState => ({
    windows: [
      createWindow(
        fallbackWindowId,
        FIRST_WINDOW_TITLE,
        appendSessionsRight(null, sessions),
        sessions[0]?.id ?? null,
      ),
    ],
    activeWindowId: fallbackWindowId,
  });

  if (stored === null || stored.windows.length === 0) return firstWindow();

  const aliveIds = new Set(sessions.map((session) => session.id));
  const pruned = stored.windows.map((window) => ({
    ...window,
    layout: window.layout === null ? null : pruneDeadLeaves(window.layout, aliveIds),
  }));
  const deduped = dedupeSessions(pruned);

  const activeWindowId =
    findWindow(deduped, stored.activeWindowId) === undefined
      ? deduped[0].id
      : stored.activeWindowId;

  // どのウィンドウにも載っていない生存セッションは、いま見ているウィンドウへ出す
  const placed = new Set(
    deduped.flatMap((window) => (window.layout === null ? [] : collectSessionIds(window.layout))),
  );
  const orphans = sessions.filter((session) => !placed.has(session.id));
  const withOrphans = updateWindow({ windows: deduped, activeWindowId }, activeWindowId, (window) => ({
    ...window,
    layout: appendSessionsRight(window.layout, orphans),
  }));

  return {
    ...withOrphans,
    windows: withOrphans.windows.map((window) => ({
      ...window,
      activeSessionId: resolveActiveSession(window.layout, window.activeSessionId),
    })),
  };
};
