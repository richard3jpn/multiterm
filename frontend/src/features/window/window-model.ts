import { collectSessionIds } from '../layout/layout-tree';
import type { LayoutNode } from '../layout/layout-tree';

/**
 * ターミナルを並べる面。1画面に収まらなくなったターミナルを分けて置く（RDD 14章）。
 *
 * セッションはいずれか1つのウィンドウにのみ属する（排他所属）。
 * 同じセッションを複数のウィンドウに出すと、PTYのサイズが1つしか持てないのに
 * 別々の大きさのペインからリサイズが飛んで表示が壊れるため。
 */
export interface TermWindow {
  readonly id: string;
  readonly title: string;
  readonly layout: LayoutNode | null;
  /** このウィンドウで最後にフォーカスしていたターミナル。切り替えて戻ったときに復元する */
  readonly activeSessionId: string | null;
}

export interface WindowsState {
  readonly windows: readonly TermWindow[];
  readonly activeWindowId: string;
}

const AUTO_TITLE = /^Window (\d+)$/;

/** 自動採番の名前。閉じて空いた番号を埋める（改名済みの名前は採番に影響しない） */
export const nextWindowTitle = (windows: readonly TermWindow[]): string => {
  const used = new Set<number>();
  for (const window of windows) {
    const matched = AUTO_TITLE.exec(window.title);
    if (matched) used.add(Number(matched[1]));
  }
  let number = 1;
  while (used.has(number)) number += 1;
  return `Window ${number}`;
};

export const createWindow = (
  id: string,
  title: string,
  layout: LayoutNode | null = null,
  activeSessionId: string | null = null,
): TermWindow => ({ id, title, layout, activeSessionId });

export const findWindow = (
  windows: readonly TermWindow[],
  windowId: string,
): TermWindow | undefined => windows.find((window) => window.id === windowId);

export const activeWindow = (state: WindowsState): TermWindow | undefined =>
  findWindow(state.windows, state.activeWindowId);

/** セッションが属するウィンドウ。排他所属なので最初の一致でよい */
export const windowIdOfSession = (
  windows: readonly TermWindow[],
  sessionId: string,
): string | undefined =>
  windows.find(
    (window) => window.layout !== null && collectSessionIds(window.layout).includes(sessionId),
  )?.id;

/** 全ウィンドウのセッションID（ウィンドウの並び順 → 各ウィンドウ内の視覚順） */
export const collectAllSessionIds = (windows: readonly TermWindow[]): string[] =>
  windows.flatMap((window) => (window.layout === null ? [] : collectSessionIds(window.layout)));

/** 指定ウィンドウだけを差し替える（非破壊）。存在しないIDは何もしない */
export const updateWindow = (
  state: WindowsState,
  windowId: string,
  update: (window: TermWindow) => TermWindow,
): WindowsState => {
  if (findWindow(state.windows, windowId) === undefined) return state;
  return {
    ...state,
    windows: state.windows.map((window) => (window.id === windowId ? update(window) : window)),
  };
};

/** 末尾に追加してアクティブにする */
export const addWindow = (state: WindowsState, window: TermWindow): WindowsState => ({
  windows: [...state.windows, window],
  activeWindowId: window.id,
});

export const renameWindow = (
  state: WindowsState,
  windowId: string,
  title: string,
): WindowsState => updateWindow(state, windowId, (window) => ({ ...window, title }));

/** 存在しないIDへの切り替えは無視する（外部データ由来のIDを信頼しない） */
export const setActiveWindow = (state: WindowsState, windowId: string): WindowsState =>
  findWindow(state.windows, windowId) === undefined ? state : { ...state, activeWindowId: windowId };

/**
 * ウィンドウを閉じたあとにアクティブにするID。
 * 閉じたのがアクティブでなければ現状維持、アクティブなら1つ前（先頭なら新しい先頭）へ寄せる。
 */
export const nextActiveWindowId = (
  windows: readonly TermWindow[],
  removedId: string,
  currentActiveId: string,
): string => {
  const remaining = windows.filter((window) => window.id !== removedId);
  if (remaining.length === 0) return currentActiveId;
  if (currentActiveId !== removedId) {
    return findWindow(remaining, currentActiveId) === undefined
      ? remaining[0].id
      : currentActiveId;
  }
  const removedIndex = windows.findIndex((window) => window.id === removedId);
  return remaining[Math.max(0, removedIndex - 1)].id;
};

/** 最後の1つは閉じられない（ターミナルを置く面が無くなるため） */
export const removeWindow = (state: WindowsState, windowId: string): WindowsState => {
  if (state.windows.length <= 1) return state;
  if (findWindow(state.windows, windowId) === undefined) return state;
  return {
    windows: state.windows.filter((window) => window.id !== windowId),
    activeWindowId: nextActiveWindowId(state.windows, windowId, state.activeWindowId),
  };
};

/**
 * ウィンドウ内のフォーカス対象を解決する。
 * 現在の対象がレイアウトに残っていればそのまま、消えていれば先頭の葉へ寄せる。
 */
export const resolveActiveSession = (
  layout: LayoutNode | null,
  current: string | null,
): string | null => {
  if (layout === null) return null;
  const ids = collectSessionIds(layout);
  if (current !== null && ids.includes(current)) return current;
  return ids[0] ?? null;
};
