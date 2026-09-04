import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadWindows, migrateLayoutToWindows, saveWindows } from './window-persistence';
import { createWindow } from './window-model';
import type { WindowsState } from './window-model';
import type { LayoutNode } from '../layout/layout-tree';

const V1_KEY = 'multiterm.layout.v1';
const V2_KEY = 'multiterm.layout.v2';

const leaf = (sessionId: string): LayoutNode => ({ type: 'leaf', sessionId });
const split = (first: LayoutNode, second: LayoutNode): LayoutNode => ({
  type: 'split',
  direction: 'vertical',
  ratio: 0.5,
  first,
  second,
});

const state = (): WindowsState => ({
  windows: [
    createWindow('w1', 'Window 1', split(leaf('a'), leaf('b')), 'a'),
    createWindow('w2', '調査用', null, null),
  ],
  activeWindowId: 'w2',
});

describe('旧形式からの変換（純関数）', () => {
  it('レイアウトが無ければ null', () => {
    expect(migrateLayoutToWindows(null, 'w1')).toBeNull();
  });

  it('ウィンドウ1つに包む', () => {
    const migrated = migrateLayoutToWindows(leaf('a'), 'w1');
    expect(migrated).toEqual({
      windows: [{ id: 'w1', title: 'Window 1', layout: leaf('a'), activeSessionId: null }],
      activeWindowId: 'w1',
    });
  });

  it('分割ツリーを構造ごと保持する', () => {
    const tree = split(leaf('a'), split(leaf('b'), leaf('c')));
    expect(migrateLayoutToWindows(tree, 'w1')?.windows[0].layout).toEqual(tree);
  });
});

describe('ウィンドウ構成のlocalStorage保存（RDD 14章）', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('保存して読み戻せる', () => {
    expect(saveWindows(state())).toBe(true);
    expect(loadWindows('new')).toEqual(state());
  });

  it('未保存なら null', () => {
    expect(loadWindows('new')).toBeNull();
  });

  it('壊れたJSONは null（外部データを信頼しない）', () => {
    localStorage.setItem(V2_KEY, '{broken');
    expect(loadWindows('new')).toBeNull();
  });

  it('形状が不正なデータは null', () => {
    const invalid: unknown[] = [
      { windows: 'not-array', activeWindowId: 'w1' },
      { windows: [], activeWindowId: 'w1' },
      { windows: [{ id: '', title: 'Window 1', layout: null, activeSessionId: null }], activeWindowId: '' },
      {
        windows: [{ id: 'w1', title: 'Window 1', layout: { type: 'split' }, activeSessionId: null }],
        activeWindowId: 'w1',
      },
      // activeWindowId がどのウィンドウも指していない
      {
        windows: [{ id: 'w1', title: 'Window 1', layout: null, activeSessionId: null }],
        activeWindowId: 'w9',
      },
    ];
    for (const value of invalid) {
      localStorage.setItem(V2_KEY, JSON.stringify(value));
      expect(loadWindows('new')).toBeNull();
    }
  });
});

describe('v1 から v2 への移行', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('v1しか無ければウィンドウ1つに包んで返す', () => {
    localStorage.setItem(V1_KEY, JSON.stringify(split(leaf('a'), leaf('b'))));
    const loaded = loadWindows('migrated');
    expect(loaded?.windows).toHaveLength(1);
    expect(loaded?.windows[0].title).toBe('Window 1');
    expect(loaded?.activeWindowId).toBe('migrated');
  });

  it('移行後は v1 を削除し、v2 を書く', () => {
    localStorage.setItem(V1_KEY, JSON.stringify(leaf('a')));
    loadWindows('migrated');
    expect(localStorage.getItem(V1_KEY)).toBeNull();
    expect(localStorage.getItem(V2_KEY)).not.toBeNull();
  });

  it('移行は一度だけ。2回目は書かれたv2が返る', () => {
    localStorage.setItem(V1_KEY, JSON.stringify(leaf('a')));
    loadWindows('first');
    expect(loadWindows('second')?.activeWindowId).toBe('first');
  });

  it('v1とv2が両方あればv2を優先し、v1は消さない', () => {
    saveWindows(state());
    localStorage.setItem(V1_KEY, JSON.stringify(leaf('old')));
    expect(loadWindows('new')).toEqual(state());
    expect(localStorage.getItem(V1_KEY)).not.toBeNull();
  });

  it('v2が壊れていてv1がある場合、v1へは戻らない（閉じたウィンドウが復活しないように）', () => {
    localStorage.setItem(V2_KEY, '{broken');
    localStorage.setItem(V1_KEY, JSON.stringify(leaf('a')));
    expect(loadWindows('new')).toBeNull();
  });

  it('保存できない環境では移行結果を返しつつ v1 を残す（データを失わない）', () => {
    localStorage.setItem(V1_KEY, JSON.stringify(leaf('a')));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(loadWindows('migrated')?.windows).toHaveLength(1);
    vi.restoreAllMocks();
    expect(localStorage.getItem(V1_KEY)).not.toBeNull();
  });
});
