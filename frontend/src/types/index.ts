export type SessionStatus = 'running' | 'idle' | 'waiting-input';

export interface Session {
  readonly id: string;
  readonly title: string;
  readonly shell: string;
  readonly createdAt: string;
  readonly status: SessionStatus;
}

export interface ApiEnvelope<T> {
  readonly success: boolean;
  readonly data: T | null;
  readonly error: string | null;
}

/**
 * WSはバイナリフレーム（タグ1バイト + ペイロード）。
 * PTY出力は生バイトのまま受け取り、xtermへ直接渡す（JSONエスケープ/パースを挟まない）。
 */
export type ServerMessage =
  | { readonly type: 'replay'; readonly data: Uint8Array }
  | { readonly type: 'data'; readonly data: Uint8Array }
  | { readonly type: 'status'; readonly status: SessionStatus }
  | { readonly type: 'exit'; readonly exitCode: number }
  | { readonly type: 'error'; readonly error: string };

export const SESSION_STATUSES: readonly SessionStatus[] = ['running', 'idle', 'waiting-input'];

/** 利用可能シェルの許可リストエントリ（RDD 9.2章） */
export interface ShellInfo {
  readonly id: string;
  readonly label: string;
  readonly path: string;
}
