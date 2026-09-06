import { describe, expect, it } from 'vitest';
import {
  collectSessionIds,
  moveLeaf,
  pruneDeadLeaves,
  removeLeaf,
  resolveDropPosition,
  splitLeaf,
  updateRatio,
} from './layout-tree';
import type { LayoutNode } from './layout-tree';

const leaf = (sessionId: string): LayoutNode => ({ type: 'leaf', sessionId });

describe('二分木レイアウト（RDD 7章）', () => {
  it('splitLeaf: 葉を分割ノードに置き換える（元の木は変更しない）', () => {
    const root = leaf('a');
    const next = splitLeaf(root, 'a', 'horizontal', 'b');
    expect(next).toEqual({
      type: 'split',
      direction: 'horizontal',
      ratio: 0.5,
      first: leaf('a'),
      second: leaf('b'),
    });
    expect(root).toEqual(leaf('a'));
  });

  it('splitLeaf: 深い位置の葉も分割できる', () => {
    const root = splitLeaf(leaf('a'), 'a', 'vertical', 'b');
    const next = splitLeaf(root, 'b', 'horizontal', 'c');
    expect(collectSessionIds(next)).toEqual(['a', 'b', 'c']);
  });

  it('removeLeaf: 分割ノードは兄弟に置き換わる', () => {
    const root = splitLeaf(leaf('a'), 'a', 'vertical', 'b');
    expect(removeLeaf(root, 'a')).toEqual(leaf('b'));
    expect(removeLeaf(root, 'b')).toEqual(leaf('a'));
  });

  it('removeLeaf: 最後の葉を消すと null', () => {
    expect(removeLeaf(leaf('a'), 'a')).toBeNull();
  });

  it('pruneDeadLeaves: 生存IDにない葉を除去する（RDD 7章: バックエンドSSOT）', () => {
    const root = splitLeaf(splitLeaf(leaf('a'), 'a', 'vertical', 'b'), 'b', 'horizontal', 'c');
    const pruned = pruneDeadLeaves(root, new Set(['a', 'c']));
    expect(collectSessionIds(pruned as LayoutNode)).toEqual(['a', 'c']);
  });

  it('pruneDeadLeaves: 全滅なら null', () => {
    const root = splitLeaf(leaf('a'), 'a', 'vertical', 'b');
    expect(pruneDeadLeaves(root, new Set())).toBeNull();
  });

  it('updateRatio: 指定パスの比率を0.1〜0.9にクランプして更新する', () => {
    const root = splitLeaf(leaf('a'), 'a', 'vertical', 'b');
    const updated = updateRatio(root, [], 0.7);
    expect(updated.type === 'split' && updated.ratio).toBe(0.7);
    expect(updateRatio(root, [], 0.01).type === 'split' && (updateRatio(root, [], 0.01) as { ratio: number }).ratio).toBe(0.1);
    expect((updateRatio(root, [], 1.5) as { ratio: number }).ratio).toBe(0.9);
    // 元の木は不変
    expect(root.type === 'split' && root.ratio).toBe(0.5);
  });

  it('updateRatio: ネストしたパス（second側）も更新できる', () => {
    const inner = splitLeaf(leaf('b'), 'b', 'horizontal', 'c');
    const root: LayoutNode = {
      type: 'split',
      direction: 'vertical',
      ratio: 0.5,
      first: leaf('a'),
      second: inner,
    };
    const updated = updateRatio(root, ['second'], 0.3);
    expect(updated.type === 'split' && updated.second.type === 'split' && updated.second.ratio).toBe(0.3);
  });
});

describe('ペインの移動（RDD 15章）', () => {
  /** split(a, b) vertical */
  const pair = (): LayoutNode => splitLeaf(leaf('a'), 'a', 'vertical', 'b');
  /** split(a, split(b, c)) */
  const trio = (): LayoutNode => splitLeaf(pair(), 'b', 'horizontal', 'c');

  it('右へ落とすと移動先の後ろに並ぶ（左右分割）', () => {
    expect(moveLeaf(pair(), 'a', 'b', 'right')).toEqual({
      type: 'split',
      direction: 'vertical',
      ratio: 0.5,
      first: leaf('b'),
      second: leaf('a'),
    });
  });

  it('左へ落とすと移動先の前に並ぶ', () => {
    expect(moveLeaf(pair(), 'b', 'a', 'left')).toEqual({
      type: 'split',
      direction: 'vertical',
      ratio: 0.5,
      first: leaf('b'),
      second: leaf('a'),
    });
  });

  it('上下へ落とすと上下分割になる', () => {
    expect(moveLeaf(pair(), 'a', 'b', 'top')).toEqual({
      type: 'split',
      direction: 'horizontal',
      ratio: 0.5,
      first: leaf('a'),
      second: leaf('b'),
    });
    expect(moveLeaf(pair(), 'a', 'b', 'bottom')).toEqual({
      type: 'split',
      direction: 'horizontal',
      ratio: 0.5,
      first: leaf('b'),
      second: leaf('a'),
    });
  });

  it('深い位置のペインも動かせる', () => {
    expect(collectSessionIds(moveLeaf(trio(), 'c', 'a', 'left'))).toEqual(['c', 'a', 'b']);
  });

  it('移動してもセッションの集合は変わらない', () => {
    const next = moveLeaf(trio(), 'a', 'c', 'bottom');
    expect([...collectSessionIds(next)].sort()).toEqual(['a', 'b', 'c']);
  });

  it('同じペインへ落としたら何もしない', () => {
    const root = pair();
    expect(moveLeaf(root, 'a', 'a', 'right')).toBe(root);
  });

  it('移動先が無ければ何もしない', () => {
    const root = pair();
    expect(moveLeaf(root, 'a', 'missing', 'right')).toBe(root);
  });

  it('ペインが1つだけなら何もしない', () => {
    const root = leaf('a');
    expect(moveLeaf(root, 'a', 'b', 'right')).toBe(root);
  });

  it('元の木を変更しない', () => {
    const root = pair();
    const snapshot = structuredClone(root);
    moveLeaf(root, 'a', 'b', 'top');
    expect(root).toEqual(snapshot);
  });
});

describe('落とす位置の判定（RDD 15章）', () => {
  it('最も近い辺を選ぶ', () => {
    expect(resolveDropPosition(100, 100, 5, 50)).toBe('left');
    expect(resolveDropPosition(100, 100, 95, 50)).toBe('right');
    expect(resolveDropPosition(100, 100, 50, 5)).toBe('top');
    expect(resolveDropPosition(100, 100, 50, 95)).toBe('bottom');
  });

  it('幅と高さで正規化するので、横長のペインでも左右が選べる', () => {
    // 幅400・高さ100。左から20px は 0.05、上から30px は 0.3 なので left
    expect(resolveDropPosition(400, 100, 20, 30)).toBe('left');
    // 左から100px は 0.25。上から20px の 0.2 のほうが近いので top
    expect(resolveDropPosition(400, 100, 100, 20)).toBe('top');
  });

  it('距離が並んだら left → right → top → bottom の順で決める', () => {
    expect(resolveDropPosition(100, 100, 50, 50)).toBe('left');
  });

  it('サイズが取れないときは right（0除算しない）', () => {
    expect(resolveDropPosition(0, 100, 0, 50)).toBe('right');
    expect(resolveDropPosition(100, 0, 50, 0)).toBe('right');
  });
});
