import { SESSION_STATUSES } from '../types';
import type { ServerMessage } from '../types';

/** 配信元と同じホスト・ポートへ繋ぐ（httpsで配信された場合は wss へ） */
const sameOriginWsUrl = (): string =>
  `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`;

// 開発時にViteの開発サーバから別ポートのバックエンドを叩く場合は VITE_WS_URL で上書きする。
const WS_URL: string = import.meta.env.VITE_WS_URL ?? sameOriginWsUrl();

export const buildWsUrl = (sessionId: string): string =>
  `${WS_URL}/ws?sessionId=${encodeURIComponent(sessionId)}`;

// --- サーバ → クライアント（タグ1バイト + ペイロード） ---
const TAG_DATA = 0x01;
const TAG_REPLAY = 0x02;
const TAG_STATUS = 0x03;
const TAG_EXIT = 0x04;
const TAG_ERROR = 0x05;

// --- クライアント → サーバ ---
const CLIENT_TAG_INPUT = 0x01;
const CLIENT_TAG_RESIZE = 0x02;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * サーバからのWSバイナリフレームを検証してパースする。不正はnull（外部データを信頼しない）。
 * data / replay は生バイトのまま返し、xtermへ直接書き込む。
 */
export const parseServerMessage = (raw: ArrayBuffer): ServerMessage | null => {
  const bytes = new Uint8Array(raw);
  if (bytes.length < 1) return null;
  const payload = bytes.subarray(1);
  switch (bytes[0]) {
    case TAG_DATA:
      return { type: 'data', data: payload };
    case TAG_REPLAY:
      return { type: 'replay', data: payload };
    case TAG_STATUS: {
      // 0=running / 1=idle / 2=waiting-input（SESSION_STATUSES の並びと一致）
      const status = SESSION_STATUSES[payload[0]];
      return payload.length === 1 && status ? { type: 'status', status } : null;
    }
    case TAG_EXIT: {
      if (payload.length !== 4) return null;
      const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
      return { type: 'exit', exitCode: view.getInt32(0, true) };
    }
    case TAG_ERROR:
      return { type: 'error', error: decoder.decode(payload) };
    default:
      return null;
  }
};

export const inputMessage = (data: string): Uint8Array<ArrayBuffer> => {
  const encoded = encoder.encode(data);
  const frame = new Uint8Array(1 + encoded.length);
  frame[0] = CLIENT_TAG_INPUT;
  frame.set(encoded, 1);
  return frame;
};

export const resizeMessage = (cols: number, rows: number): Uint8Array<ArrayBuffer> => {
  const frame = new Uint8Array(5);
  frame[0] = CLIENT_TAG_RESIZE;
  const view = new DataView(frame.buffer);
  view.setUint16(1, cols, true);
  view.setUint16(3, rows, true);
  return frame;
};
