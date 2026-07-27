import { randomUUID } from 'node:crypto';
import { StateDetector } from '../monitor/state-detector';
import { appendCapped } from './ring-buffer';
import type { SessionInfo, SessionStatus, SessionSubscriber, ShellInfo } from '../types';

/** node-pty の IPty 互換の最小インターフェース（テストでは偽物を注入する） */
export interface PtyLike {
  onData(listener: (data: string) => void): void;
  onExit(listener: (e: { exitCode: number }) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

export type PtySpawn = (options: {
  cols: number;
  rows: number;
  shell: string;
  args: readonly string[];
}) => PtyLike;

export interface SessionManagerOptions {
  readonly spawn: PtySpawn;
  readonly maxSessions: number;
  readonly bufferLimit: number;
  readonly defaultShell?: ShellInfo;
}

export class SessionLimitError extends Error {}
export class SessionNotFoundError extends Error {}

interface ManagedSession {
  readonly id: string;
  title: string; // rename（RDD 9.3章）のため可変
  readonly shell: string;
  readonly createdAt: string;
  readonly pty: PtyLike;
  readonly detector: StateDetector;
  buffer: string;
  subscribers: readonly SessionSubscriber[];
}

const DEFAULT_SIZE = { cols: 80, rows: 24 } as const;

const assertPositiveInteger = (value: number, name: string): void => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} は正の整数である必要があります: ${value}`);
  }
};

/**
 * PTYセッションの生成・保持・破棄（RDD.md 7章）。
 * セッション実体はプロセス寿命の間メモリ上に維持され、リロード後の再接続を可能にする。
 */
export class SessionManager {
  private readonly sessions = new Map<string, ManagedSession>();
  private readonly options: SessionManagerOptions;
  private sequence = 0;

  constructor(options: SessionManagerOptions) {
    this.options = options;
  }

  /** セッションを作成する。shell（許可リスト解決済み）省略時はサーバ既定シェル（RDD 9.2章） */
  create(shell?: ShellInfo): SessionInfo {
    if (this.sessions.size >= this.options.maxSessions) {
      throw new SessionLimitError(
        `セッション数が上限（${this.options.maxSessions}）に達しています`,
      );
    }
    const chosen = shell ?? this.options.defaultShell;
    this.sequence += 1;
    const id = randomUUID();
    const session: ManagedSession = {
      id,
      title: `Terminal ${this.sequence}`,
      shell: chosen?.id ?? 'unknown',
      createdAt: new Date().toISOString(),
      pty: this.options.spawn({
        ...DEFAULT_SIZE,
        shell: chosen?.path ?? 'bash',
        args: chosen?.args ?? [],
      }),
      detector: new StateDetector(),
      buffer: '',
      subscribers: [],
    };
    this.sessions.set(id, session);
    this.wire(session);
    return this.toInfo(session);
  }

  /** セッション名を変更する。バリデーションは呼び出し側（ルート層）で実施済みであること */
  rename(id: string, title: string): SessionInfo {
    const session = this.require(id);
    session.title = title;
    return this.toInfo(session);
  }

  list(): SessionInfo[] {
    return [...this.sessions.values()].map((session) => this.toInfo(session));
  }

  get(id: string): SessionInfo | undefined {
    const session = this.sessions.get(id);
    return session ? this.toInfo(session) : undefined;
  }

  getBuffer(id: string): string | undefined {
    return this.sessions.get(id)?.buffer;
  }

  write(id: string, data: string): void {
    this.require(id).pty.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    assertPositiveInteger(cols, 'cols');
    assertPositiveInteger(rows, 'rows');
    this.require(id).pty.resize(cols, rows);
  }

  subscribe(id: string, subscriber: SessionSubscriber): () => void {
    const session = this.require(id);
    session.subscribers = [...session.subscribers, subscriber];
    return () => {
      const current = this.sessions.get(id);
      if (current) {
        current.subscribers = current.subscribers.filter((s) => s !== subscriber);
      }
    };
  }

  dispose(id: string): void {
    const session = this.require(id);
    session.detector.dispose();
    session.pty.kill();
    this.sessions.delete(id);
  }

  disposeAll(): void {
    for (const id of [...this.sessions.keys()]) {
      this.dispose(id);
    }
  }

  private wire(session: ManagedSession): void {
    session.pty.onData((data) => {
      session.buffer = appendCapped(session.buffer, data, this.options.bufferLimit);
      session.detector.feed(data);
      for (const subscriber of session.subscribers) subscriber.onData?.(data);
    });
    session.detector.onStatusChange((status) => {
      for (const subscriber of session.subscribers) subscriber.onStatus?.(status);
    });
    session.pty.onExit(({ exitCode }) => {
      const subscribers = session.subscribers;
      session.detector.dispose();
      this.sessions.delete(session.id);
      for (const subscriber of subscribers) subscriber.onExit?.(exitCode);
    });
  }

  private require(id: string): ManagedSession {
    const session = this.sessions.get(id);
    if (!session) {
      throw new SessionNotFoundError(`セッションが見つかりません: ${id}`);
    }
    return session;
  }

  private toInfo(session: ManagedSession): SessionInfo {
    return {
      id: session.id,
      title: session.title,
      shell: session.shell,
      createdAt: session.createdAt,
      status: session.detector.status as SessionStatus,
    };
  }
}
