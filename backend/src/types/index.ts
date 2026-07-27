export type SessionStatus = 'running' | 'idle' | 'waiting-input';

export interface SessionInfo {
  readonly id: string;
  readonly title: string;
  readonly shell: string;
  readonly createdAt: string;
  readonly status: SessionStatus;
}

/** RDD.md 4章パターン準拠のAPIレスポンス envelope */
export interface ApiResponse<T> {
  readonly success: boolean;
  readonly data: T | null;
  readonly error: string | null;
}

/** 利用可能シェルの許可リストエントリ（RDD 9.2章 / 9.5章） */
export interface ShellInfo {
  readonly id: string;
  readonly label: string;
  readonly path: string;
  /** 起動引数（RDD 9.5章。省略時は空配列扱い。Windowsのwsl/powershell等で使用） */
  readonly args?: readonly string[];
}

export interface SessionSubscriber {
  readonly onData?: (data: string) => void;
  readonly onStatus?: (status: SessionStatus) => void;
  readonly onExit?: (exitCode: number) => void;
}
