import { beforeEach, describe, expect, it } from 'vitest';
import { loadLayout, saveLayout } from './persistence';
import type { LayoutNode } from './layout-tree';

const validLayout: LayoutNode = {
  type: 'split',
  direction: 'vertical',
  ratio: 0.5,
  first: { type: 'leaf', sessionId: 'a' },
  second: { type: 'leaf', sessionId: 'b' },
};

describe('レイアウトのlocalStorage保存（RDD 7章）', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('保存して読み戻せる', () => {
    saveLayout(validLayout);
    expect(loadLayout()).toEqual(validLayout);
  });

  it('null（レイアウトなし）も保存できる', () => {
    saveLayout(null);
    expect(loadLayout()).toBeNull();
  });

  it('未保存なら null', () => {
    expect(loadLayout()).toBeNull();
  });

  it('壊れたJSONは null（外部データを信頼しない）', () => {
    localStorage.setItem('multiterm.layout.v1', '{broken');
    expect(loadLayout()).toBeNull();
  });

  it('形状が不正なデータは null', () => {
    localStorage.setItem('multiterm.layout.v1', JSON.stringify({ type: 'leaf' }));
    expect(loadLayout()).toBeNull();
    localStorage.setItem(
      'multiterm.layout.v1',
      JSON.stringify({ type: 'split', direction: 'diagonal', ratio: 0.5, first: null, second: null }),
    );
    expect(loadLayout()).toBeNull();
  });
});
