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

/** RDD 17章: プロセスツリー1本ぶんのリソース使用量 */
export interface ProcessUsage {
  /** 1コアを100%として数えた合計。マシンが複数コアなら100を超えうる */
  readonly cpuPercent: number;
  readonly memoryBytes: number;
}

/** RDD 17章: ターミナル1つぶんの使用量（シェルとその子孫の合計） */
export interface SessionUsage {
  readonly sessionId: string;
  readonly cpuPercent: number;
  readonly memoryBytes: number;
}

/** RDD 17章: リソース使用量の一式 */
export interface MetricsSnapshot {
  /** アプリ全体。バックエンド自身と全ターミナルのプロセスツリーの和集合 */
  readonly app: ProcessUsage;
  readonly sessions: readonly SessionUsage[];
  /** 論理コア数。cpuPercent をマシン全体に対する割合へ直すのに使う */
  readonly cpuCount: number;
}
