export type SplitDirection = 'horizontal' | 'vertical';

export interface LeafNode {
  readonly type: 'leaf';
  readonly sessionId: string;
}

export interface SplitNode {
  readonly type: 'split';
  readonly direction: SplitDirection;
  readonly ratio: number;
  readonly first: LayoutNode;
  readonly second: LayoutNode;
}

export type LayoutNode = LeafNode | SplitNode;
export type SplitPath = readonly Array<'first' | 'second'>[number][];

const RATIO_MIN = 0.1;
const RATIO_MAX = 0.9;

export const clampRatio = (ratio: number): number =>
  Math.min(RATIO_MAX, Math.max(RATIO_MIN, ratio));

/** 指定セッションの葉を「元の葉 + 新しい葉」の分割ノードに置き換える（非破壊） */
export const splitLeaf = (
  node: LayoutNode,
  targetSessionId: string,
  direction: SplitDirection,
  newSessionId: string,
): LayoutNode => {
  if (node.type === 'leaf') {
    if (node.sessionId !== targetSessionId) return node;
    return {
      type: 'split',
      direction,
      ratio: 0.5,
      first: node,
      second: { type: 'leaf', sessionId: newSessionId },
    };
  }
  return {
    ...node,
    first: splitLeaf(node.first, targetSessionId, direction, newSessionId),
    second: splitLeaf(node.second, targetSessionId, direction, newSessionId),
  };
};

/** 指定セッションの葉を除去する。分割ノードは兄弟に置き換わる（非破壊） */
export const removeLeaf = (node: LayoutNode, sessionId: string): LayoutNode | null => {
  if (node.type === 'leaf') {
    return node.sessionId === sessionId ? null : node;
  }
  const first = removeLeaf(node.first, sessionId);
  const second = removeLeaf(node.second, sessionId);
  if (first === null) return second;
  if (second === null) return first;
  if (first === node.first && second === node.second) return node;
  return { ...node, first, second };
};

/** 生存セッション集合にない葉を除去する（RDD 7章: バックエンドをSSOTとする） */
export const pruneDeadLeaves = (
  node: LayoutNode,
  aliveIds: ReadonlySet<string>,
): LayoutNode | null => {
  if (node.type === 'leaf') {
    return aliveIds.has(node.sessionId) ? node : null;
  }
  const first = pruneDeadLeaves(node.first, aliveIds);
  const second = pruneDeadLeaves(node.second, aliveIds);
  if (first === null) return second;
  if (second === null) return first;
  if (first === node.first && second === node.second) return node;
  return { ...node, first, second };
};

/** 指定パスの分割ノードの比率を更新する（0.1〜0.9にクランプ、非破壊） */
export const updateRatio = (node: LayoutNode, path: SplitPath, ratio: number): LayoutNode => {
  if (node.type !== 'split') return node;
  if (path.length === 0) {
    return { ...node, ratio: clampRatio(ratio) };
  }
  const [head, ...rest] = path;
  return { ...node, [head]: updateRatio(node[head], rest, ratio) };
};

export const collectSessionIds = (node: LayoutNode): string[] =>
  node.type === 'leaf'
    ? [node.sessionId]
    : [...collectSessionIds(node.first), ...collectSessionIds(node.second)];

/**
 * localStorageから読んだ外部データがレイアウトツリーの形をしているか検証する。
 * 型の定義元に型ガードを置き、レイアウト単体・ウィンドウ配列の双方の永続化から使う。
 */
export const isLayoutNode = (value: unknown): value is LayoutNode => {
  if (typeof value !== 'object' || value === null) return false;
  const node = value as Record<string, unknown>;
  if (node.type === 'leaf') {
    return typeof node.sessionId === 'string' && node.sessionId !== '';
  }
  if (node.type === 'split') {
    return (
      (node.direction === 'horizontal' || node.direction === 'vertical') &&
      typeof node.ratio === 'number' &&
      node.ratio > 0 &&
      node.ratio < 1 &&
      isLayoutNode(node.first) &&
      isLayoutNode(node.second)
    );
  }
  return false;
};
