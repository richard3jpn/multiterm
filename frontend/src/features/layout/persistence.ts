import { isLayoutNode } from './layout-tree';
import type { LayoutNode } from './layout-tree';

const STORAGE_KEY = 'multiterm.layout.v1';

/** localStorageのレイアウトを読み込む。外部データのため形状検証し、不正はnull */
export const loadLayout = (): LayoutNode | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return isLayoutNode(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export const saveLayout = (layout: LayoutNode | null): void => {
  try {
    if (layout === null) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // localStorage不可（プライベートモード等）は永続化なしで継続
  }
};

/** v2への移行が完了したあと、古いキーを消すために使う */
export const removeStoredLayout = (): void => {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 削除できなくても動作は継続する（次回の読み込みでv2が優先される）
  }
};
