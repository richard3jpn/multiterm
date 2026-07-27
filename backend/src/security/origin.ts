/**
 * WebSocket / CORS のOrigin検証（RDD.md 5章9項）。
 * クロスオリジンWS・DNSリバインディング経由のRCEを防ぐため、
 * ホワイトリスト完全一致のみ許可し、Originヘッダなしは拒否する。
 */
export const parseAllowedOrigins = (raw: string | undefined): string[] =>
  (raw ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '');

export const isOriginAllowed = (
  origin: string | undefined,
  allowedOrigins: readonly string[],
): boolean => origin !== undefined && allowedOrigins.includes(origin);
