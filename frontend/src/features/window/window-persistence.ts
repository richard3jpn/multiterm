import { isLayoutNode } from '../layout/layout-tree';
import { loadLayout, removeStoredLayout } from '../layout/persistence';
import { createWindow } from './window-model';
import type { TermWindow, WindowsState } from './window-model';
import type { LayoutNode } from '../layout/layout-tree';

const STORAGE_KEY = 'multiterm.layout.v2';

const isTermWindow = (value: unknown): value is TermWindow => {
  if (typeof value !== 'object' || value === null) return false;
  const window = value as Record<string, unknown>;
  if (typeof window.id !== 'string' || window.id === '') return false;
  if (typeof window.title !== 'string' || window.title === '') return false;
  if (window.layout !== null && !isLayoutNode(window.layout)) return false;
  return window.activeSessionId === null || typeof window.activeSessionId === 'string';
};

const isWindowsState = (value: unknown): value is WindowsState => {
  if (typeof value !== 'object' || value === null) return false;
  const state = value as Record<string, unknown>;
  if (!Array.isArray(state.windows) || state.windows.length === 0) return false;
  if (!state.windows.every(isTermWindow)) return false;
  if (typeof state.activeWindowId !== 'string') return false;
  return state.windows.some((window) => window.id === state.activeWindowId);
};

/** 旧形式（レイアウト単体）をウィンドウ1つに包む。純関数なので単体で検証できる */
export const migrateLayoutToWindows = (
  layout: LayoutNode | null,
  windowId: string,
): WindowsState | null =>
  layout === null
    ? null
    : { windows: [createWindow(windowId, 'Window 1', layout, null)], activeWindowId: windowId };

/** 保存できたかを返す。移行時に「保存できたときだけ旧キーを消す」判断に使う */
export const saveWindows = (state: WindowsState): boolean => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    // localStorage不可（プライベートモード等）は永続化なしで継続
    return false;
  }
};

/**
 * ウィンドウ構成を読み込む。無ければ旧キー（multiterm.layout.v1）から移行する。
 *
 * v2のキーが存在する場合は、たとえ壊れていてもv1へは戻らない（nullを返す）。
 * 戻すと、ユーザーが閉じたはずのウィンドウが古いレイアウトから復活してしまうため。
 *
 * `newWindowId` は移行で作るウィンドウのID。呼び出し側が採番する。
 */
export const loadWindows = (newWindowId: string): WindowsState | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw);
      return isWindowsState(parsed) ? parsed : null;
    }
  } catch {
    return null;
  }

  const migrated = migrateLayoutToWindows(loadLayout(), newWindowId);
  if (migrated === null) return null;
  // 保存に失敗したときは旧キーを残す（次回の起動でもう一度移行できるようにする）
  if (saveWindows(migrated)) removeStoredLayout();
  return migrated;
};
