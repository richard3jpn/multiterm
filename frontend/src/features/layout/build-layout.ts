import { pruneDeadLeaves } from './layout-tree';
import type { LayoutNode } from './layout-tree';
import type { Session } from '../../types';

const collectIds = (node: LayoutNode): string[] =>
  node.type === 'leaf' ? [node.sessionId] : [...collectIds(node.first), ...collectIds(node.second)];

/** セッションをレイアウトの右側へ縦分割で足していく（非破壊）。空レイアウトなら最初の葉になる */
export const appendSessionsRight = (
  layout: LayoutNode | null,
  sessions: readonly Session[],
): LayoutNode | null =>
  sessions.reduce<LayoutNode | null>(
    (current, session) =>
      current === null
        ? { type: 'leaf', sessionId: session.id }
        : {
            type: 'split',
            direction: 'vertical',
            ratio: 0.5,
            first: current,
            second: { type: 'leaf', sessionId: session.id },
          },
    layout,
  );

/**
 * 生存セッション（バックエンドSSOT）でレイアウトを再構成する（RDD 7章）。
 * - 保存レイアウト中の死んだ葉は除去
 * - レイアウトに含まれない生存セッションは右側へ縦分割で追加
 */
export const buildLayout = (
  stored: LayoutNode | null,
  sessions: readonly Session[],
): LayoutNode | null => {
  const aliveIds = new Set(sessions.map((s) => s.id));
  const pruned = stored ? pruneDeadLeaves(stored, aliveIds) : null;
  const inLayout = new Set(pruned ? collectIds(pruned) : []);
  return appendSessionsRight(
    pruned,
    sessions.filter((s) => !inLayout.has(s.id)),
  );
};
