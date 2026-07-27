import type { ShellInfo } from '../../types';

/**
 * セッションのシェルid（RDD 9.2/9.5章）を許可リストの表示ラベルに解決する。
 * 一覧に無い場合（サーバ再起動でシェル構成が変わった等）は id をそのまま返す。
 */
export const resolveShellLabel = (shellId: string, shells: readonly ShellInfo[]): string =>
  shells.find((s) => s.id === shellId)?.label ?? shellId;
