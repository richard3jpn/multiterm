import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import { isOriginAllowed } from '../security/origin';
import type { SessionManager } from '../pty/session-manager';

export interface WsDependencies {
  readonly manager: SessionManager;
  readonly allowedOrigins: readonly string[];
}

/** クライアントからの入力1メッセージの最大長（暴走防止） */
const MAX_INPUT_LENGTH = 8192;

type ClientMessage =
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number };

const parseClientMessage = (raw: unknown): ClientMessage | null => {
  if (typeof raw !== 'string' && !Buffer.isBuffer(raw)) return null;
  try {
    const parsed: unknown = JSON.parse(raw.toString());
    if (typeof parsed !== 'object' || parsed === null) return null;
    const message = parsed as Record<string, unknown>;
    if (
      message.type === 'input' &&
      typeof message.data === 'string' &&
      message.data.length <= MAX_INPUT_LENGTH
    ) {
      return { type: 'input', data: message.data };
    }
    if (
      message.type === 'resize' &&
      typeof message.cols === 'number' &&
      typeof message.rows === 'number'
    ) {
      return { type: 'resize', cols: message.cols, rows: message.rows };
    }
    return null;
  } catch {
    return null;
  }
};

const send = (ws: WebSocket, payload: Record<string, unknown>): void => {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
};

const rejectUpgrade = (socket: Duplex, statusLine: string): void => {
  socket.write(`HTTP/1.1 ${statusLine}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
};

const bindSession = (ws: WebSocket, sessionId: string, manager: SessionManager): void => {
  const info = manager.get(sessionId);
  if (!info) {
    send(ws, { type: 'error', error: 'セッションが見つかりません' });
    ws.close();
    return;
  }

  // 再接続時の画面復元（RDD.md 5章4項: バッファ再生）
  send(ws, { type: 'replay', data: manager.getBuffer(sessionId) ?? '' });
  send(ws, { type: 'status', status: info.status });

  const unsubscribe = manager.subscribe(sessionId, {
    onData: (data) => send(ws, { type: 'data', data }),
    onStatus: (status) => send(ws, { type: 'status', status }),
    onExit: (exitCode) => {
      send(ws, { type: 'exit', exitCode });
      ws.close();
    },
  });

  ws.on('message', (raw) => {
    const message = parseClientMessage(raw);
    if (!message) {
      send(ws, { type: 'error', error: '不正なメッセージ形式です' });
      return;
    }
    try {
      if (message.type === 'input') {
        manager.write(sessionId, message.data);
      } else {
        manager.resize(sessionId, message.cols, message.rows);
      }
    } catch (error: unknown) {
      const reason = error instanceof RangeError ? error.message : '操作に失敗しました';
      send(ws, { type: 'error', error: reason });
    }
  });

  ws.on('close', unsubscribe);
};

/**
 * WebSocketサーバをHTTPサーバへ接続する（RDD.md 5章3項・9項）。
 * upgrade時にOriginをホワイトリスト検証し、不一致は403で拒否する。
 */
export const attachWsServer = (server: HttpServer, deps: WsDependencies): WebSocketServer => {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (!isOriginAllowed(req.headers.origin, deps.allowedOrigins)) {
      rejectUpgrade(socket, '403 Forbidden');
      return;
    }
    const url = new URL(req.url ?? '/', 'http://placeholder');
    if (url.pathname !== '/ws') {
      rejectUpgrade(socket, '404 Not Found');
      return;
    }
    const sessionId = url.searchParams.get('sessionId') ?? '';
    if (!deps.manager.get(sessionId)) {
      rejectUpgrade(socket, '404 Not Found');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      bindSession(ws, sessionId, deps.manager);
    });
  });

  return wss;
};
