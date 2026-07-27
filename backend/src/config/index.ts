import { parseAllowedOrigins } from '../security/origin';

export interface AppConfig {
  readonly port: number;
  readonly host: string;
  readonly allowedOrigins: readonly string[];
  readonly maxSessions: number;
  readonly bufferLimit: number;
  readonly shell: string;
}

/** RDD.md 7章: 同時セッション上限 */
export const MAX_SESSIONS = 16;
/** RDD.md 7章: 出力バッファ上限（200KB/セッション） */
export const BUFFER_LIMIT = 200 * 1024;

/** RDD.md 5章2項: OS自動判定によるシェル選択 */
export const selectShell = (
  platform: NodeJS.Platform,
  env: Readonly<Record<string, string | undefined>>,
): string => (platform === 'win32' ? 'powershell.exe' : (env.SHELL ?? 'bash'));

export const loadConfig = (
  env: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform,
): AppConfig => {
  const port = Number(env.PORT ?? 3001);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new RangeError(`PORT が不正です: ${env.PORT}`);
  }
  const allowedOrigins = parseAllowedOrigins(env.ALLOWED_ORIGINS);
  if (allowedOrigins.length === 0) {
    throw new Error('ALLOWED_ORIGINS が未設定です（RDD.md 5章9項: Origin検証は必須）');
  }
  return {
    port,
    // RDD.md 8章: 開発モードは127.0.0.1バインド。コンテナのみHOST=0.0.0.0を明示注入
    host: env.HOST ?? '127.0.0.1',
    allowedOrigins,
    maxSessions: MAX_SESSIONS,
    bufferLimit: BUFFER_LIMIT,
    shell: selectShell(platform, env),
  };
};
