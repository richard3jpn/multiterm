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

/**
 * ドラッグ中のペインを運ぶ独自MIME（RDD 15章）。
 *
 * `text/plain` にするとエディタやブラウザから流れてきた文字列も受け取ってしまう。
 * 独自の型にしておけば、`dragover` の時点で `dataTransfer.types` を見るだけで
 * 自分たちのドラッグかどうか判別できる（`getData` は drop まで読めない）。
 *
 * 落とす先がペインとサイドバーの2箇所あるため、型の定義と同じ場所に置いて共有する。
 */
export const DRAG_MIME = 'application/x-multiterm-session';

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

/** 左右へ落とすと見なす帯の幅（ペイン幅に対する割合）。両端にこの幅で取る */
const SIDE_BAND = 0.25;

/**
 * ペインのどこへ落としたかから、挿し込む向きを決める（RDD 15章）。
 *
 * 左右の端の帯に入っていれば左右、外なら上半分・下半分で上下に振る。
 *
 * 4辺までの距離で決めると、判定領域が対角線で切った三角形になり、上下の三角形が
 * 上端・下端の全幅に接する。ドラッグはヘッダーを掴む操作なので相手のヘッダー行付近を
 * 通ることになり、その高さでは左右の領域が数十pxしか無く、ほぼ必ず上下へ倒れていた。
 * 帯なら高さに関係なく左右へ落とせる。
 *
 * 中央付近でも必ずいずれかの辺に倒れるので、「落とせない場所」は作らない。
 * 境界はどちらも外側を優先しない（結果を決定的にするため、ちょうど中央は bottom）。
 */
export const resolveDropPosition = (
  width: number,
  height: number,
  offsetX: number,
  offsetY: number,
): DropPosition => {
  // 0除算を避ける。サイズが取れない状況では右に置く
  if (width <= 0 || height <= 0) return 'right';
  const horizontal = offsetX / width;
  if (horizontal < SIDE_BAND) return 'left';
  if (horizontal > 1 - SIDE_BAND) return 'right';
  return offsetY / height < 0.5 ? 'top' : 'bottom';
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

/** レイアウトの右側へ葉を足す（非破壊）。空レイアウトなら最初の葉になる */
export const appendLeafRight = (layout: LayoutNode | null, sessionId: string): LayoutNode =>
  layout === null
    ? { type: 'leaf', sessionId }
    : {
        type: 'split',
        direction: 'vertical',
        ratio: 0.5,
        first: layout,
        second: { type: 'leaf', sessionId },
      };

/**
 * 指定した向きに並ぶ枠がいくつ分か数える（RDD 18章）。
 *
 * 同じ向きの分割が続く限り足し合わせ、向きが変わったところで1枠として打ち切る。
 * 左右の均等化をするとき、上下にどう割れているかは1枠として扱えばよい。
 */
const countSlots = (node: LayoutNode, direction: SplitDirection): number =>
  node.type === 'split' && node.direction === direction
    ? countSlots(node.first, direction) + countSlots(node.second, direction)
    : 1;

/**
 * 指定した向きの分割を、葉が同じ大きさになるように割り直す（RDD 18章、非破壊）。
 *
 * 比率は分割ノード1つにつき1つしかなく、葉の大きさは祖先の比率の積で決まる。
 * そのため同じ向きが入れ子になっていると、全部を0.5にしても均等にならない
 * （3枚並びが 50% / 25% / 25% になる）。左右それぞれが何枠分かを数えて割り当てる。
 *
 * 同じ向きに11枚以上並ぶと 1/11 が下限0.1を下回るため、そこは厳密には均等にならない。
 * 比率が0になるとレイアウトの読み込み時に丸ごと捨てられるので、下限で止めるほうを取る。
 */
export const equalizeRatios = (node: LayoutNode, direction: SplitDirection): LayoutNode => {
  if (node.type !== 'split') return node;
  const first = equalizeRatios(node.first, direction);
  const second = equalizeRatios(node.second, direction);
  const ratio =
    node.direction === direction
      ? clampRatio(
          countSlots(first, direction) / (countSlots(first, direction) + countSlots(second, direction)),
        )
      : node.ratio;
  if (ratio === node.ratio && first === node.first && second === node.second) return node;
  return { ...node, ratio, first, second };
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
