import { describe, expect, it } from 'vitest';
import { buildWindows } from './build-windows';
import { collectAllSessionIds, createWindow, findWindow } from './window-model';
import type { WindowsState } from './window-model';
import { collectSessionIds } from '../layout/layout-tree';
import type { LayoutNode } from '../layout/layout-tree';
import type { Session } from '../../types';

const leaf = (sessionId: string): LayoutNode => ({ type: 'leaf', sessionId });
const split = (first: LayoutNode, second: LayoutNode): LayoutNode => ({
  type: 'split',
  direction: 'vertical',
  ratio: 0.5,
  first,
  second,
});

const session = (id: string): Session => ({
  id,
  title: id,
  shell: 'powershell',
  createdAt: '2026-09-04T00:00:00Z',
  status: 'idle',
});

const stored = (): WindowsState => ({
  windows: [
    createWindow('w1', 'Window 1', split(leaf('a'), leaf('b')), 'b'),
    createWindow('w2', 'Window 2', leaf('c'), 'c'),
  ],
  activeWindowId: 'w2',
});

describe('保存データと生存セッションの突き合わせ（RDD 7章・14章）', () => {
  it('保存が無ければ Window 1 を1つ作って全セッションを入れる', () => {
    const built = buildWindows(null, [session('a'), session('b')], 'new');
    expect(built.windows).toHaveLength(1);
    expect(built.windows[0].title).toBe('Window 1');
    expect(built.activeWindowId).toBe('new');
    expect(collectAllSessionIds(built.windows)).toEqual(['a', 'b']);
  });

  it('保存もセッションも無ければ空のウィンドウが1つ（面は必ず1つ以上ある）', () => {
    const built = buildWindows(null, [], 'new');
    expect(built.windows).toHaveLength(1);
    expect(built.windows[0].layout).toBeNull();
    expect(built.windows[0].activeSessionId).toBeNull();
  });

  it('windowsが空配列の保存データも作り直す', () => {
    const built = buildWindows({ windows: [], activeWindowId: 'x' }, [session('a')], 'new');
    expect(built.windows).toHaveLength(1);
    expect(built.activeWindowId).toBe('new');
  });

  it('死んだセッションの葉を全ウィンドウから除去する', () => {
    const built = buildWindows(stored(), [session('a')], 'new');
    expect(collectAllSessionIds(built.windows)).toEqual(['a']);
    expect(findWindow(built.windows, 'w2')?.layout).toBeNull();
  });

  it('中身が空になったウィンドウも残す（ユーザーが作った面を消さない）', () => {
    const built = buildWindows(stored(), [session('a'), session('b')], 'new');
    expect(built.windows.map((w) => w.id)).toEqual(['w1', 'w2']);
  });

  it('孤児セッションはアクティブウィンドウへ追加する（先頭ではない）', () => {
    const built = buildWindows(stored(), [session('a'), session('b'), session('c'), session('d')], 'new');
    const active = findWindow(built.windows, 'w2');
    expect(active?.layout).not.toBeNull();
    expect(collectSessionIds(active!.layout!)).toEqual(['c', 'd']);
  });

  it('同じセッションが複数ウィンドウにある壊れたデータは、先に出た方だけ残す（排他所属）', () => {
    const broken: WindowsState = {
      windows: [
        createWindow('w1', 'Window 1', split(leaf('a'), leaf('b')), 'a'),
        createWindow('w2', 'Window 2', split(leaf('b'), leaf('c')), 'b'),
      ],
      activeWindowId: 'w1',
    };
    const built = buildWindows(broken, [session('a'), session('b'), session('c')], 'new');
    expect(collectAllSessionIds(built.windows)).toEqual(['a', 'b', 'c']);
    expect(collectSessionIds(findWindow(built.windows, 'w2')!.layout!)).toEqual(['c']);
  });

  it('activeWindowIdが存在しないIDなら先頭へフォールバックする', () => {
    const built = buildWindows(
      { ...stored(), activeWindowId: 'missing' },
      [session('a'), session('b'), session('c')],
      'new',
    );
    expect(built.activeWindowId).toBe('w1');
  });

  it('フォーカス対象が消えていたら、そのウィンドウの先頭の葉へ寄せる', () => {
    const built = buildWindows(stored(), [session('a'), session('c')], 'new');
    expect(findWindow(built.windows, 'w1')?.activeSessionId).toBe('a');
  });

  it('フォーカス対象が残っていれば維持する', () => {
    const built = buildWindows(stored(), [session('a'), session('b'), session('c')], 'new');
    expect(findWindow(built.windows, 'w1')?.activeSessionId).toBe('b');
  });

  it('セッションが全滅してもウィンドウの並びと名前は保たれる', () => {
    const built = buildWindows(stored(), [], 'new');
    expect(built.windows.map((w) => w.title)).toEqual(['Window 1', 'Window 2']);
    expect(collectAllSessionIds(built.windows)).toEqual([]);
  });
});
