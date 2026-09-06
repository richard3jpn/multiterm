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

/** ドラッグしたペインを、落とした先のペインのどちら側へ置くか（RDD 15章） */
export type DropPosition = 'left' | 'right' | 'top' | 'bottom';

/** 落とす位置から分割の向きを決める。左右に並べるのが vertical、上下が horizontal */
const directionOf = (position: DropPosition): SplitDirection =>
  position === 'left' || position === 'right' ? 'vertical' : 'horizontal';

/** 落とす位置から、移動するペインが分割の先手（first）に来るかを決める */
const isFirst = (position: DropPosition): boolean =>
  position === 'left' || position === 'top';

/** 指定セッションの葉を、移動先の葉と並ぶ分割ノードへ置き換える（非破壊） */
const insertBeside = (
  node: LayoutNode,
  targetSessionId: string,
  moved: LeafNode,
  position: DropPosition,
): LayoutNode => {
  if (node.type === 'leaf') {
    if (node.sessionId !== targetSessionId) return node;
    const first = isFirst(position);
    return {
      type: 'split',
      direction: directionOf(position),
      ratio: 0.5,
      first: first ? moved : node,
      second: first ? node : moved,
    };
  }
  return {
    ...node,
    first: insertBeside(node.first, targetSessionId, moved, position),
    second: insertBeside(node.second, targetSessionId, moved, position),
  };
};

/**
 * ペインを別のペインの隣へ移す（RDD 15章。非破壊）。
 *
 * 元の位置から取り除いてから移動先へ挿し込む。取り除きを先にするのは、
 * 移動先が「移動するペインを含む分割ノード」だったときに、
 * 挿し込んだ直後の木へ remove をかけて新しい葉まで消してしまうのを避けるため。
 *
 * 動かせない場合（同じペインへ落とした・移動先が無い・そのペインしか無い）は
 * 元の木をそのまま返す。呼び出し側で成否を分岐させず、常に木を受け取れるようにしている。
 */
export const moveLeaf = (
  node: LayoutNode,
  sessionId: string,
  targetSessionId: string,
  position: DropPosition,
): LayoutNode => {
  if (sessionId === targetSessionId) return node;
  const removed = removeLeaf(node, sessionId);
  if (removed === null) return node;
  if (!collectSessionIds(removed).includes(targetSessionId)) return node;
  return insertBeside(removed, targetSessionId, { type: 'leaf', sessionId }, position);
};

/**
 * ペインのどこへ落としたかから、挿し込む向きを決める（RDD 15章）。
 *
 * 4辺のうち最も近い辺を選ぶ。辺までの距離はペインの幅・高さで正規化する。
 * 正規化しないと、横長のペインでは左右がほぼ選ばれなくなる。
 *
 * 中央付近でも必ずいずれかの辺に倒れるので、「落とせない場所」は作らない。
 * 距離が並んだときは left → right → top → bottom の順で決める（結果を決定的にするため）。
 */
export const resolveDropPosition = (
  width: number,
  height: number,
  offsetX: number,
  offsetY: number,
): DropPosition => {
  // 0除算を避ける。サイズが取れない状況では右に置く
  if (width <= 0 || height <= 0) return 'right';
  const distances: ReadonlyArray<readonly [DropPosition, number]> = [
    ['left', offsetX / width],
    ['right', (width - offsetX) / width],
    ['top', offsetY / height],
    ['bottom', (height - offsetY) / height],
  ];
  return distances.reduce((nearest, current) =>
    current[1] < nearest[1] ? current : nearest,
  )[0];
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
