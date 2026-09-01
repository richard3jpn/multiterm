import { describe, expect, it } from 'vitest';
import { buildWsUrl, inputMessage, parseServerMessage, resizeMessage } from './ws';

const frame = (tag: number, payload: number[] = []): ArrayBuffer =>
  new Uint8Array([tag, ...payload]).buffer;

const bytesOf = (text: string): number[] => Array.from(new TextEncoder().encode(text));

describe('WebSocketサービス（バイナリプロトコル）', () => {
  it('buildWsUrl: sessionIdをクエリに含める（URLエンコード）', () => {
    const url = buildWsUrl('abc-123');
    expect(url).toMatch(/\/ws\?sessionId=abc-123$/);
    expect(buildWsUrl('a b')).toContain('sessionId=a%20b');
  });

  it('parseServerMessage: data / replay は生バイトのまま返す', () => {
    const data = parseServerMessage(frame(0x01, bytesOf('hello')));
    expect(data?.type).toBe('data');
    expect(data).toHaveProperty('data');
    if (data?.type === 'data') {
      expect(new TextDecoder().decode(data.data)).toBe('hello');
    }

    const replay = parseServerMessage(frame(0x02, bytesOf('あ')));
    expect(replay?.type).toBe('replay');
    if (replay?.type === 'replay') {
      // マルチバイトもバイト列のまま渡される（JSONエスケープを挟まない）
      expect(Array.from(replay.data)).toEqual([0xe3, 0x81, 0x82]);
    }
  });

  it('parseServerMessage: status は 0=running / 1=idle / 2=waiting-input', () => {
    expect(parseServerMessage(frame(0x03, [0]))).toEqual({ type: 'status', status: 'running' });
    expect(parseServerMessage(frame(0x03, [1]))).toEqual({ type: 'status', status: 'idle' });
    expect(parseServerMessage(frame(0x03, [2]))).toEqual({
      type: 'status',
      status: 'waiting-input',
    });
  });

  it('parseServerMessage: exit は i32 リトルエンディアン', () => {
    expect(parseServerMessage(frame(0x04, [0, 0, 0, 0]))).toEqual({ type: 'exit', exitCode: 0 });
    // -1 = 0xffffffff
    expect(parseServerMessage(frame(0x04, [0xff, 0xff, 0xff, 0xff]))).toEqual({
      type: 'exit',
      exitCode: -1,
    });
  });

  it('parseServerMessage: error は UTF-8 文字列', () => {
    expect(parseServerMessage(frame(0x05, bytesOf('セッションが見つかりません')))).toEqual({
      type: 'error',
      error: 'セッションが見つかりません',
    });
  });

  it('parseServerMessage: 不正な入力は null（外部データを信頼しない）', () => {
    expect(parseServerMessage(new ArrayBuffer(0))).toBeNull();
    expect(parseServerMessage(frame(0xff, [1, 2]))).toBeNull();
    expect(parseServerMessage(frame(0x03, [9]))).toBeNull();
    expect(parseServerMessage(frame(0x03, [0, 0]))).toBeNull();
    expect(parseServerMessage(frame(0x04, [0, 0]))).toBeNull();
  });

  it('inputMessage: タグ + UTF-8 バイト列', () => {
    expect(Array.from(inputMessage('ls\r'))).toEqual([0x01, ...bytesOf('ls\r')]);
    expect(Array.from(inputMessage('あ'))).toEqual([0x01, 0xe3, 0x81, 0x82]);
  });

  it('resizeMessage: タグ + u16 LE cols + u16 LE rows', () => {
    expect(Array.from(resizeMessage(120, 40))).toEqual([0x02, 120, 0, 40, 0]);
    // 256 = 0x0100 -> LE で [0x00, 0x01]
    expect(Array.from(resizeMessage(256, 300))).toEqual([0x02, 0x00, 0x01, 0x2c, 0x01]);
  });
});
