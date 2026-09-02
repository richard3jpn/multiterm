const STORAGE_KEY = 'multiterm.sidebar.v1';

// 0まで縮められる（畳んだのと同じ見た目になるが、境界線は残るのでドラッグで戻せる）
export const SIDEBAR_WIDTH_MIN = 0;
export const SIDEBAR_WIDTH_MAX = 480;
export const DEFAULT_SIDEBAR_WIDTH = 224;

export interface SidebarState {
  /** サイドバーの幅(px)。境界線ドラッグで変更する */
  readonly width: number;
  readonly open: boolean;
}

export const DEFAULT_SIDEBAR_STATE: SidebarState = {
  width: DEFAULT_SIDEBAR_WIDTH,
  open: true,
};

/** 幅は160〜480pxの整数にクランプ。数値でなければ既定値 */
export const clampSidebarWidth = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_SIDEBAR_WIDTH;
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(value)));
};

export const loadSidebarState = (): SidebarState => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_SIDEBAR_STATE;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_SIDEBAR_STATE;
    const record = parsed as Record<string, unknown>;
    return {
      width: clampSidebarWidth(record.width),
      open: typeof record.open === 'boolean' ? record.open : DEFAULT_SIDEBAR_STATE.open,
    };
  } catch {
    return DEFAULT_SIDEBAR_STATE;
  }
};

export const saveSidebarState = (state: SidebarState): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 永続化不可（プライベートモード等）でも動作は継続
  }
};
