import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SIDEBAR_STATE,
  DEFAULT_SIDEBAR_WIDTH,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  clampSidebarWidth,
  loadSidebarState,
  saveSidebarState,
} from './sidebar-state';

describe('サイドバーの幅と開閉状態', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('clampSidebarWidth: 0〜480の整数にクランプ、不正値は既定224', () => {
    expect(clampSidebarWidth(300)).toBe(300);
    expect(clampSidebarWidth(SIDEBAR_WIDTH_MIN - 1)).toBe(SIDEBAR_WIDTH_MIN);
    expect(clampSidebarWidth(SIDEBAR_WIDTH_MAX + 1)).toBe(SIDEBAR_WIDTH_MAX);
    // 0まで縮められる（畳んだのと同じ見た目）
    expect(clampSidebarWidth(0)).toBe(0);
    expect(clampSidebarWidth(-500)).toBe(0);
    expect(clampSidebarWidth(30)).toBe(30);
    expect(clampSidebarWidth(240.6)).toBe(241);
    expect(clampSidebarWidth('300')).toBe(DEFAULT_SIDEBAR_WIDTH);
    expect(clampSidebarWidth(NaN)).toBe(DEFAULT_SIDEBAR_WIDTH);
    expect(clampSidebarWidth(Infinity)).toBe(DEFAULT_SIDEBAR_WIDTH);
    expect(clampSidebarWidth(undefined)).toBe(DEFAULT_SIDEBAR_WIDTH);
  });

  it('既定幅は現行の w-56（224px）と一致する', () => {
    expect(DEFAULT_SIDEBAR_WIDTH).toBe(224);
    expect(DEFAULT_SIDEBAR_STATE).toEqual({ width: 224, open: true });
  });

  it('保存して読み戻せる', () => {
    saveSidebarState({ width: 320, open: false });
    expect(loadSidebarState()).toEqual({ width: 320, open: false });
  });

  it('未保存・壊れたデータは既定値', () => {
    expect(loadSidebarState()).toEqual(DEFAULT_SIDEBAR_STATE);
    localStorage.setItem('multiterm.sidebar.v1', '{broken');
    expect(loadSidebarState()).toEqual(DEFAULT_SIDEBAR_STATE);
    localStorage.setItem('multiterm.sidebar.v1', 'null');
    expect(loadSidebarState()).toEqual(DEFAULT_SIDEBAR_STATE);
  });

  it('不正なフィールドは各既定値に矯正される', () => {
    localStorage.setItem('multiterm.sidebar.v1', JSON.stringify({ width: 'abc', open: 1 }));
    expect(loadSidebarState()).toEqual({ width: 224, open: true });
  });

  it('保存された幅が範囲外でも読み出し時にクランプされる', () => {
    localStorage.setItem('multiterm.sidebar.v1', JSON.stringify({ width: 9999, open: true }));
    expect(loadSidebarState().width).toBe(SIDEBAR_WIDTH_MAX);
  });
});
