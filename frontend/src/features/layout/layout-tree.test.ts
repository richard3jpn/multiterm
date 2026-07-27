import { describe, expect, it } from 'vitest';
import {
  collectSessionIds,
  pruneDeadLeaves,
  removeLeaf,
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
