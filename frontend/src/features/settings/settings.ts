/** ターミナル表示設定（RDD 9.1章）とシェル既定選択（RDD 9.2章）の純ロジック */

export interface FontPreset {
  readonly id: string;
  readonly label: string;
  readonly family: string;
}

/**
 * RDD 9.1章: 等幅フォントプリセット（任意文字列入力は不可）。
 * ターミナルは端末上のローカルフォントを使うため、各プリセットは
 * 未インストール環境でも等幅へ退避するようフォールバック連鎖を持つ。
 */
export const FONT_PRESETS: readonly FontPreset[] = [
  {
    id: 'system-mono',
    label: 'System Mono',
    family: 'Menlo, Consolas, "Liberation Mono", monospace',
  },
  {
    id: 'cascadia-code',
    label: 'Cascadia Code',
    family: '"Cascadia Code", "Cascadia Mono", Consolas, monospace',
  },
  {
    id: 'cascadia-mono',
    label: 'Cascadia Mono',
    family: '"Cascadia Mono", "Cascadia Code", Consolas, monospace',
  },
  { id: 'consolas', label: 'Consolas', family: 'Consolas, Menlo, monospace' },
  {
    id: 'jetbrains-mono',
    label: 'JetBrains Mono',
    family: '"JetBrains Mono", Consolas, Menlo, monospace',
  },
  {
    id: 'fira-code',
    label: 'Fira Code',
    family: '"Fira Code", "Fira Mono", Consolas, monospace',
  },
  {
    id: 'source-code-pro',
    label: 'Source Code Pro',
    family: '"Source Code Pro", Consolas, Menlo, monospace',
  },
  {
    id: 'hack',
    label: 'Hack',
    family: 'Hack, "DejaVu Sans Mono", Consolas, monospace',
  },
  {
    id: 'ubuntu-mono',
    label: 'Ubuntu Mono',
    family: '"Ubuntu Mono", "DejaVu Sans Mono", Consolas, monospace',
  },
  {
    id: 'lucida-console',
    label: 'Lucida Console',
    family: '"Lucida Console", Consolas, monospace',
  },
  { id: 'courier-new', label: 'Courier New', family: '"Courier New", Courier, monospace' },
];

export const FONT_SIZE_MIN = 10;
export const FONT_SIZE_MAX = 20;
export const DEFAULT_FONT_SIZE = 13;

export interface TerminalSettings {
  readonly fontFamilyId: string;
  readonly fontSize: number;
  /** 新規ターミナルの既定シェルid（未選択はnull=サーバ既定） */
  readonly defaultShellId: string | null;
}

export const DEFAULT_SETTINGS: TerminalSettings = {
  fontFamilyId: FONT_PRESETS[0].id,
  fontSize: DEFAULT_FONT_SIZE,
  defaultShellId: null,
};

const STORAGE_KEY = 'multiterm.settings.v1';

/** RDD 9.1章: サイズは10〜20pxの整数にクランプ。数値でなければ既定値 */
export const clampFontSize = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_FONT_SIZE;
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(value)));
};

/** プリセットidからfont-family文字列を解決。未知idは既定プリセット */
export const resolveFontFamily = (fontFamilyId: string): string =>
  (FONT_PRESETS.find((p) => p.id === fontFamilyId) ?? FONT_PRESETS[0]).family;

export const loadSettings = (): TerminalSettings => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_SETTINGS;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_SETTINGS;
    const record = parsed as Record<string, unknown>;
    return {
      fontFamilyId: FONT_PRESETS.some((p) => p.id === record.fontFamilyId)
        ? (record.fontFamilyId as string)
        : DEFAULT_SETTINGS.fontFamilyId,
      fontSize: clampFontSize(record.fontSize),
      defaultShellId:
        typeof record.defaultShellId === 'string' && record.defaultShellId !== ''
          ? record.defaultShellId
          : null,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
};

export const saveSettings = (settings: TerminalSettings): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // 永続化不可（プライベートモード等）でも動作は継続
  }
};
