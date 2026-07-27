/**
 * 出力バッファへの上限付き追記（RDD.md 7章: リングバッファ、上限200KB/セッション）。
 * 既存文字列を変更せず、新しい文字列を返す。
 */
export const appendCapped = (buffer: string, chunk: string, limit: number): string => {
  if (chunk === '') return buffer;
  return (buffer + chunk).slice(-limit);
};
