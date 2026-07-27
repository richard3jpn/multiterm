import { describe, expect, it } from 'vitest';
import { buildLayout } from './build-layout';
import { collectSessionIds, splitLeaf } from './layout-tree';
import type { LayoutNode } from './layout-tree';
import type { Session } from '../../types';

const session = (id: string): Session => ({
  id,
  title: `Terminal ${id}`,
  shell: 'bash',
  createdAt: '2026-07-25T00:00:00.000Z',
  status: 'idle',
});

const leaf = (sessionId: string): LayoutNode => ({ type: 'leaf', sessionId });

describe('buildLayout（RDD 7章: バックエンドSSOTでの再構成）', () => {
  it('保存レイアウトの死んだ葉を除去する', () => {
    const stored = splitLeaf(leaf('a'), 'a', 'vertical', 'dead');
    const result = buildLayout(stored, [session('a')]);
    expect(result).toEqual(leaf('a'));
  });

  it('レイアウトにない生存セッションを右側へ追加する', () => {
    const result = buildLayout(leaf('a'), [session('a'), session('b')]);
    expect(result?.type).toBe('split');
    expect(collectSessionIds(result as LayoutNode)).toEqual(['a', 'b']);
  });

  it('保存レイアウトなし + セッションありなら連結して構成する', () => {
    const result = buildLayout(null, [session('a'), session('b'), session('c')]);
    expect(collectSessionIds(result as LayoutNode)).toEqual(['a', 'b', 'c']);
  });

  it('保存レイアウトなし + セッションなしは null', () => {
    expect(buildLayout(null, [])).toBeNull();
  });

  it('全葉が死んでいる場合、生存セッションのみで再構成する', () => {
    const stored = splitLeaf(leaf('dead1'), 'dead1', 'horizontal', 'dead2');
    const result = buildLayout(stored, [session('x')]);
    expect(result).toEqual(leaf('x'));
  });
});
