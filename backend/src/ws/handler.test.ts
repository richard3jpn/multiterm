import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { attachWsServer } from './handler';
import { SessionManager } from '../pty/session-manager';
import type { PtyLike } from '../pty/session-manager';

const ALLOWED_ORIGIN = 'http://localhost:5173';

class FakePty extends EventEmitter implements PtyLike {
  public written: string[] = [];
  public resized: Array<{ cols: number; rows: number }> = [];
  onData(listener: (data: string) => void): void {
    this.on('data', listener);
  }
  onExit(listener: (e: { exitCode: number }) => void): void {
    this.on('exit', listener);
  }
  write(data: string): void {
    this.written.push(data);
  }
  resize(cols: number, rows: number): void {
    this.resized.push({ cols, rows });
  }
  kill(): void {
    this.emit('exit', { exitCode: 0 });
  }
}

interface TestContext {
  server: http.Server;
  manager: SessionManager;
  ptys: FakePty[];
  url: string;
}

interface WsClient {
  readonly ws: WebSocket;
  next(): Promise<Record<string, unknown>>;
}

const startServer = async (): Promise<TestContext> => {
  const ptys: FakePty[] = [];
  const manager = new SessionManager({
    spawn: () => {
      const fake = new FakePty();
      ptys.push(fake);
      return fake;
    },
    maxSessions: 16,
    bufferLimit: 1024,
  });
  const server = http.createServer();
  attachWsServer(server, { manager, allowedOrigins: [ALLOWED_ORIGIN] });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { server, manager, ptys, url: `ws://127.0.0.1:${port}` };
};

/**
 * open直後に同一パケットで届くメッセージを取りこぼさないよう、
 * 接続時点で message リスナーを張りキューへ蓄積する。
 */
const connect = (url: string, origin?: string): Promise<WsClient> =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(url, origin ? { headers: { origin } } : {});
    const queue: Array<Record<string, unknown>> = [];
    const waiters: Array<(message: Record<string, unknown>) => void> = [];
    ws.on('message', (raw) => {
      const message = JSON.parse(raw.toString()) as Record<string, unknown>;
      const waiter = waiters.shift();
      if (waiter) waiter(message);
      else queue.push(message);
    });
    ws.on('open', () =>
      resolve({
        ws,
        next: () => {
          const queued = queue.shift();
          if (queued) return Promise.resolve(queued);
          return new Promise((resolveNext) => waiters.push(resolveNext));
        },
      }),
    );
    ws.on('error', reject);
  });

describe('WebSocketハンドラ（RDD.md 5章3項・9項）', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await startServer();
  });

  afterEach(async () => {
    await new Promise((resolve) => ctx.server.close(resolve));
  });

  it('許可Originなら接続でき、replayとstatusが送られる', async () => {
    const info = ctx.manager.create();
    ctx.ptys[0].emit('data', 'hello ');
    const client = await connect(`${ctx.url}/ws?sessionId=${info.id}`, ALLOWED_ORIGIN);
    expect(await client.next()).toEqual({ type: 'replay', data: 'hello ' });
    const status = await client.next();
    expect(status.type).toBe('status');
    client.ws.close();
  });

  it('Originヘッダなしは接続拒否（403）', async () => {
    const info = ctx.manager.create();
    await expect(connect(`${ctx.url}/ws?sessionId=${info.id}`)).rejects.toThrow();
  });

  it('非許可Originは接続拒否（403）', async () => {
    const info = ctx.manager.create();
    await expect(
      connect(`${ctx.url}/ws?sessionId=${info.id}`, 'http://evil.example.com'),
    ).rejects.toThrow();
  });

  it('存在しないセッションIDは接続拒否（404）', async () => {
    await expect(connect(`${ctx.url}/ws?sessionId=nope`, ALLOWED_ORIGIN)).rejects.toThrow();
  });

  it('inputメッセージがPTYへ書き込まれる', async () => {
    const info = ctx.manager.create();
    const client = await connect(`${ctx.url}/ws?sessionId=${info.id}`, ALLOWED_ORIGIN);
    await client.next(); // replay
    await client.next(); // status
    client.ws.send(JSON.stringify({ type: 'input', data: 'ls\r' }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(ctx.ptys[0].written).toEqual(['ls\r']);
    client.ws.close();
  });

  it('resizeメッセージがPTYへ委譲される', async () => {
    const info = ctx.manager.create();
    const client = await connect(`${ctx.url}/ws?sessionId=${info.id}`, ALLOWED_ORIGIN);
    client.ws.send(JSON.stringify({ type: 'resize', cols: 120, rows: 40 }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(ctx.ptys[0].resized).toEqual([{ cols: 120, rows: 40 }]);
    client.ws.close();
  });

  it('不正メッセージはerror応答（接続は維持）', async () => {
    const info = ctx.manager.create();
    const client = await connect(`${ctx.url}/ws?sessionId=${info.id}`, ALLOWED_ORIGIN);
    await client.next(); // replay
    await client.next(); // status
    client.ws.send('not-json');
    const error = await client.next();
    expect(error.type).toBe('error');
    expect(client.ws.readyState).toBe(client.ws.OPEN);
    client.ws.close();
  });

  it('PTY出力がdataとして配信される', async () => {
    const info = ctx.manager.create();
    const client = await connect(`${ctx.url}/ws?sessionId=${info.id}`, ALLOWED_ORIGIN);
    await client.next(); // replay
    await client.next(); // status
    ctx.ptys[0].emit('data', 'output!');
    expect(await client.next()).toEqual({ type: 'data', data: 'output!' });
    client.ws.close();
  });

  it('セッション終了でexitが送られ接続が閉じる', async () => {
    const info = ctx.manager.create();
    const client = await connect(`${ctx.url}/ws?sessionId=${info.id}`, ALLOWED_ORIGIN);
    await client.next(); // replay
    await client.next(); // status
    const closed = new Promise<void>((resolve) => client.ws.on('close', () => resolve()));
    ctx.ptys[0].emit('exit', { exitCode: 0 });
    expect(await client.next()).toEqual({ type: 'exit', exitCode: 0 });
    await closed;
  });
});
