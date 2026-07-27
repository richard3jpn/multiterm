import type { LayoutNode } from './layout-tree';

const STORAGE_KEY = 'multiterm.layout.v1';

const isValidNode = (value: unknown): value is LayoutNode => {
  if (typeof value !== 'object' || value === null) return false;
  const node = value as Record<string, unknown>;
  if (node.type === 'leaf') {
    return typeof node.sessionId === 'string' && node.sessionId !== '';
  }
  if (node.type === 'split') {
    return (
      (node.direction === 'horizontal' || node.direction === 'vertical') &&
      typeof node.ratio === 'number' &&
      node.ratio > 0 &&
      node.ratio < 1 &&
      isValidNode(node.first) &&
      isValidNode(node.second)
    );
  }
  return false;
};

/** localStorageのレイアウトを読み込む。外部データのため形状検証し、不正はnull */
export const loadLayout = (): LayoutNode | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return isValidNode(parsed) ? parsed : null;
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
