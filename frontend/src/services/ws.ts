import { SESSION_STATUSES } from '../types';
import type { ServerMessage, SessionStatus } from '../types';

const WS_URL: string = import.meta.env.VITE_WS_URL ?? 'ws://localhost:3001';

export const buildWsUrl = (sessionId: string): string =>
  `${WS_URL}/ws?sessionId=${encodeURIComponent(sessionId)}`;

/** サーバからのWSメッセージを検証してパースする。不正はnull（外部データを信頼しない） */
export const parseServerMessage = (raw: string): ServerMessage | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const message = parsed as Record<string, unknown>;
  switch (message.type) {
    case 'replay':
    case 'data':
      return typeof message.data === 'string'
        ? { type: message.type, data: message.data }
        : null;
    case 'status':
      return SESSION_STATUSES.includes(message.status as SessionStatus)
        ? { type: 'status', status: message.status as SessionStatus }
        : null;
    case 'exit':
      return typeof message.exitCode === 'number'
        ? { type: 'exit', exitCode: message.exitCode }
        : null;
    case 'error':
      return typeof message.error === 'string' ? { type: 'error', error: message.error } : null;
    default:
      return null;
  }
};

export const inputMessage = (data: string): string => JSON.stringify({ type: 'input', data });

export const resizeMessage = (cols: number, rows: number): string =>
  JSON.stringify({ type: 'resize', cols, rows });
