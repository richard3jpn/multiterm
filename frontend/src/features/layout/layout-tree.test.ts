import { describe, expect, it } from 'vitest';
import {
  collectSessionIds,
  equalizeRatios,
  moveLeaf,
  pruneDeadLeaves,
  removeLeaf,
  resolveDropPosition,
  splitLeaf,
  updateRatio,
} from './layout-tree';
import type { LayoutNode, SplitDirection } from './layout-tree';

const leaf = (sessionId: string): LayoutNode => ({ type: 'leaf', sessionId });

const split = (
  direction: SplitDirection,
  ratio: number,
  first: LayoutNode,
  second: LayoutNode,
): LayoutNode => ({ type: 'split', direction, ratio, first, second });

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
  it('左右の帯に入れば左右、外なら上半分か下半分', () => {
    expect(resolveDropPosition(100, 100, 5, 50)).toBe('left');
    expect(resolveDropPosition(100, 100, 95, 50)).toBe('right');
    expect(resolveDropPosition(100, 100, 50, 5)).toBe('top');
    expect(resolveDropPosition(100, 100, 50, 95)).toBe('bottom');
  });

  it('上下に積まれた横長のペインでも、ヘッダーの高さで左右に落とせる', () => {
    // 幅1100・高さ420 は上下2分割の典型。ヘッダーを掴んで運ぶと相手のヘッダー行
    // （上端から14px程度）を通るが、そこでも左から100px は幅の0.09なので left。
    // 4辺までの距離で決めていた頃は、この高さでは左から37px以内でないと left にならなかった
    expect(resolveDropPosition(1100, 420, 100, 14)).toBe('left');
    expect(resolveDropPosition(1100, 420, 1000, 14)).toBe('right');
  });

  it('帯の外は高さの半分で上下を分ける', () => {
    // 左から25%ちょうどは帯の外（境界は帯に含めない）
    expect(resolveDropPosition(400, 100, 100, 20)).toBe('top');
    expect(resolveDropPosition(400, 100, 100, 80)).toBe('bottom');
  });

  it('ちょうど中央は bottom（結果を決定的にする）', () => {
    expect(resolveDropPosition(100, 100, 50, 50)).toBe('bottom');
  });

  it('サイズが取れないときは right（0除算しない）', () => {
    expect(resolveDropPosition(0, 100, 0, 50)).toBe('right');
    expect(resolveDropPosition(100, 0, 50, 0)).toBe('right');
  });
});

describe('幅・高さの均等化（RDD 18章）', () => {
  it('2枚並びは半分ずつになる', () => {
    const root = split('vertical', 0.8, leaf('a'), leaf('b'));
    expect(equalizeRatios(root, 'vertical')).toEqual(
      split('vertical', 0.5, leaf('a'), leaf('b')),
    );
  });

  it('同じ向きが入れ子でも、葉の数で割って全部同じ大きさにする', () => {
    // 左に1枚、右がさらに2枚に割れている。単純に全部0.5にすると 50% / 25% / 25% になる
    const root = split('vertical', 0.8, leaf('a'), split('vertical', 0.2, leaf('b'), leaf('c')));
    const equalized = equalizeRatios(root, 'vertical');
    expect(equalized).toEqual(
      split('vertical', 1 / 3, leaf('a'), split('vertical', 0.5, leaf('b'), leaf('c'))),
    );
  });

  it('向きが違うノードの比率は動かさない', () => {
    // 左右の均等化では、上下の分かれ方に触らない
    const inner = split('horizontal', 0.8, leaf('b'), leaf('c'));
    const root = split('vertical', 0.2, leaf('a'), inner);
    expect(equalizeRatios(root, 'vertical')).toEqual(split('vertical', 0.5, leaf('a'), inner));
  });

  it('入れ子の奥にある同じ向きも均等化する', () => {
    const root = split('horizontal', 0.5, leaf('a'), split('vertical', 0.9, leaf('b'), leaf('c')));
    expect(equalizeRatios(root, 'vertical')).toEqual(
      split('horizontal', 0.5, leaf('a'), split('vertical', 0.5, leaf('b'), leaf('c'))),
    );
  });

  it('元の木は変更しない', () => {
    const root = split('vertical', 0.8, leaf('a'), leaf('b'));
    equalizeRatios(root, 'vertical');
    expect(root).toEqual(split('vertical', 0.8, leaf('a'), leaf('b')));
  });

  it('変える比率が無ければ同じ木をそのまま返す', () => {
    const alreadyEven = split('vertical', 0.5, leaf('a'), leaf('b'));
    expect(equalizeRatios(alreadyEven, 'vertical')).toBe(alreadyEven);
    // 向きが違えば触るものが無い
    expect(equalizeRatios(alreadyEven, 'horizontal')).toBe(alreadyEven);
    const single = leaf('a');
    expect(equalizeRatios(single, 'vertical')).toBe(single);
  });

  it('同じ向きに並びすぎたら下限でクランプする（比率は0と1を取らない）', () => {
    // 11枚を左右に並べると 1/11 = 0.0909… で下限0.1を下回る。
    // 0を許すとレイアウトの読み込み時に丸ごと捨てられるため、下限で止める
    let root: LayoutNode = leaf('s0');
    for (let index = 1; index < 11; index += 1) {
      root = split('vertical', 0.5, root, leaf(`s${index}`));
    }
    const equalized = equalizeRatios(root, 'vertical');
    const ratios: number[] = [];
    const walk = (node: LayoutNode): void => {
      if (node.type !== 'split') return;
      ratios.push(node.ratio);
      walk(node.first);
      walk(node.second);
    };
    walk(equalized);
    expect(ratios.every((ratio) => ratio > 0 && ratio < 1)).toBe(true);
    expect(Math.min(...ratios)).toBeGreaterThanOrEqual(0.1);
  });
});
