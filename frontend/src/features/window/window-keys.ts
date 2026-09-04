/**
 * Alt+数字 / Alt+Shift+数字 の判定（RDD 9.6章・14章）。
 *
 * - Alt+1〜9        : アクティブウィンドウ内の視覚順N番目のペインへ移動（既存）
 * - Alt+Shift+1〜9  : N番目のウィンドウへ切り替え（v5で追加）
 *
 * Ctrl+数字を使わないのは、ブラウザがタブ切り替えに予約していてページ側から奪えないため。
 * `event.code`（Digit1形式）で判定するので、Shiftによる文字の変化にも配列にも依存しない。
 */
export type DigitShortcut =
  | { readonly kind: 'pane'; readonly index: number }
  | { readonly kind: 'window'; readonly index: number }
  | null;

interface DigitKeyEvent {
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly code: string;
}

export const resolveDigitShortcut = (event: DigitKeyEvent): DigitShortcut => {
  if (!event.altKey || event.ctrlKey || event.metaKey) return null;
  if (!event.code.startsWith('Digit')) return null;
  const index = Number(event.code.slice(5));
  if (!Number.isInteger(index) || index < 1 || index > 9) return null;
  return event.shiftKey ? { kind: 'window', index } : { kind: 'pane', index };
};
