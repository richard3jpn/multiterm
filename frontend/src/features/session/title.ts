export const TITLE_MAX_LENGTH = 30;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1f\x7f]/;

/**
 * セッション名のクライアント側バリデーション（RDD 9.3章。サーバ側と同一規則）。
 * トリム後 1〜30文字（コードポイント単位）・制御文字禁止。不正はnull
 */
export const sanitizeTitle = (raw: string): string | null => {
  const title = raw.trim();
  const length = [...title].length;
  if (length < 1 || length > TITLE_MAX_LENGTH) return null;
  if (CONTROL_CHARS.test(title)) return null;
  return title;
};
