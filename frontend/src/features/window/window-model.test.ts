import { describe, expect, it } from 'vitest';
import {
  activeWindow,
  addWindow,
  buildDigitOrdinals,
  collectAllSessionIds,
  createWindow,
  findWindow,
  nextActiveWindowId,
  nextWindowTitle,
  removeWindow,
  renameWindow,
  resolveActiveSession,
  setActiveWindow,
  updateWindow,
  windowIdOfSession,
} from './window-model';
import type { WindowsState } from './window-model';
import type { LayoutNode } from '../layout/layout-tree';

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
    createWindow('w2', 'Window 2', leaf('c'), 'c'),
  ],
  activeWindowId: 'w1',
});

describe('ウィンドウ名の自動採番', () => {
  it('ウィンドウが無ければ Window 1', () => {
    expect(nextWindowTitle([])).toBe('Window 1');
  });

  it('連番の続きを返す', () => {
    expect(nextWindowTitle(state().windows)).toBe('Window 3');
  });

  it('閉じて空いた番号を埋める', () => {
    const windows = [createWindow('w1', 'Window 1'), createWindow('w3', 'Window 3')];
    expect(nextWindowTitle(windows)).toBe('Window 2');
  });

  it('改名済みの名前は採番に影響しない', () => {
    const windows = [createWindow('w1', '調査用'), createWindow('w2', 'Window 5')];
    expect(nextWindowTitle(windows)).toBe('Window 1');
  });
});

describe('ウィンドウの追加・削除', () => {
  it('追加したウィンドウがアクティブになる', () => {
    const next = addWindow(state(), createWindow('w3', 'Window 3'));
    expect(next.windows.map((w) => w.id)).toEqual(['w1', 'w2', 'w3']);
    expect(next.activeWindowId).toBe('w3');
  });

  it('最後の1つは閉じられない（ターミナルを置く面が無くなるため）', () => {
    const single: WindowsState = { windows: [createWindow('w1', 'Window 1')], activeWindowId: 'w1' };
    expect(removeWindow(single, 'w1')).toBe(single);
  });

  it('存在しないIDの削除は何もしない', () => {
    const current = state();
    expect(removeWindow(current, 'missing')).toBe(current);
  });

  it('アクティブなウィンドウを閉じたら1つ前へ寄る', () => {
    const next = removeWindow({ ...state(), activeWindowId: 'w2' }, 'w2');
    expect(next.windows.map((w) => w.id)).toEqual(['w1']);
    expect(next.activeWindowId).toBe('w1');
  });

  it('先頭を閉じたら新しい先頭がアクティブになる', () => {
    const next = removeWindow(state(), 'w1');
    expect(next.activeWindowId).toBe('w2');
  });

  it('アクティブでないウィンドウを閉じてもアクティブは変わらない', () => {
    expect(nextActiveWindowId(state().windows, 'w2', 'w1')).toBe('w1');
  });
});

describe('ウィンドウの更新', () => {
  it('改名できる', () => {
    expect(findWindow(renameWindow(state(), 'w2', '調査用').windows, 'w2')?.title).toBe('調査用');
  });

  it('存在しないIDの更新は同じ状態を返す', () => {
    const current = state();
    expect(updateWindow(current, 'missing', (w) => ({ ...w, title: 'x' }))).toBe(current);
  });

  it('存在しないIDへの切り替えは無視する（外部データのIDを信頼しない）', () => {
    const current = state();
    expect(setActiveWindow(current, 'missing')).toBe(current);
    expect(setActiveWindow(current, 'w2').activeWindowId).toBe('w2');
  });

  it('アクティブなウィンドウを取り出せる', () => {
    expect(activeWindow(state())?.id).toBe('w1');
  });
});

describe('セッションの所属', () => {
  it('セッションが属するウィンドウを引ける', () => {
    expect(windowIdOfSession(state().windows, 'b')).toBe('w1');
    expect(windowIdOfSession(state().windows, 'c')).toBe('w2');
    expect(windowIdOfSession(state().windows, 'missing')).toBeUndefined();
  });

  it('全ウィンドウのセッションをウィンドウ順・視覚順で集める', () => {
    expect(collectAllSessionIds(state().windows)).toEqual(['a', 'b', 'c']);
  });
});

describe('ウィンドウ内のフォーカス対象', () => {
  it('レイアウトに残っていればそのまま', () => {
    expect(resolveActiveSession(split(leaf('a'), leaf('b')), 'b')).toBe('b');
  });

  it('消えていたら先頭の葉へ寄せる', () => {
    expect(resolveActiveSession(split(leaf('a'), leaf('b')), 'gone')).toBe('a');
  });

  it('レイアウトが空なら null', () => {
    expect(resolveActiveSession(null, 'a')).toBeNull();
  });
});

describe('Alt+数字の序数（RDD 14.5章）', () => {
  it('ウィンドウをまたいで通し番号を振る', () => {
    const ordinals = buildDigitOrdinals(state().windows);
    expect(ordinals.get('a')).toBe(1);
    expect(ordinals.get('b')).toBe(2);
    expect(ordinals.get('c')).toBe(3);
  });

  it('10個目以降は割り当てない（Alt+数字は1〜9まで）', () => {
    const ids = Array.from({ length: 11 }, (_, index) => `s${index + 1}`);
    const layout = ids
      .slice(1)
      .reduce<LayoutNode>((node, id) => split(node, leaf(id)), leaf(ids[0]));
    const ordinals = buildDigitOrdinals([createWindow('w1', 'Window 1', layout)]);
    expect(ordinals.get('s9')).toBe(9);
    expect(ordinals.has('s10')).toBe(false);
    expect(ordinals.size).toBe(9);
  });

  it('空のウィンドウは飛ばして続きから数える', () => {
    const windows = [
      createWindow('w1', 'Window 1', leaf('a')),
      createWindow('w2', 'Window 2', null),
      createWindow('w3', 'Window 3', leaf('b')),
    ];
    const ordinals = buildDigitOrdinals(windows);
    expect(ordinals.get('a')).toBe(1);
    expect(ordinals.get('b')).toBe(2);
  });

  it('ターミナルが1つも無ければ空', () => {
    expect(buildDigitOrdinals([createWindow('w1', 'Window 1', null)]).size).toBe(0);
  });
});
