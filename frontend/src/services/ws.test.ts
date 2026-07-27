import { describe, expect, it } from 'vitest';
import { buildWsUrl, parseServerMessage } from './ws';

describe('WebSocketサービス', () => {
  it('buildWsUrl: sessionIdをクエリに含める（URLエンコード）', () => {
    const url = buildWsUrl('abc-123');
    expect(url).toMatch(/\/ws\?sessionId=abc-123$/);
    expect(buildWsUrl('a b')).toContain('sessionId=a%20b');
  });

  it('parseServerMessage: 各メッセージ型を検証して返す', () => {
    expect(parseServerMessage(JSON.stringify({ type: 'data', data: 'x' }))).toEqual({
      type: 'data',
      data: 'x',
    });
    expect(parseServerMessage(JSON.stringify({ type: 'replay', data: '' }))).toEqual({
      type: 'replay',
      data: '',
    });
    expect(parseServerMessage(JSON.stringify({ type: 'status', status: 'idle' }))).toEqual({
      type: 'status',
      status: 'idle',
    });
    expect(parseServerMessage(JSON.stringify({ type: 'exit', exitCode: 0 }))).toEqual({
      type: 'exit',
      exitCode: 0,
    });
  });

  it('parseServerMessage: 不正な入力は null（外部データを信頼しない）', () => {
    expect(parseServerMessage('not-json')).toBeNull();
    expect(parseServerMessage(JSON.stringify({ type: 'data' }))).toBeNull();
    expect(parseServerMessage(JSON.stringify({ type: 'status', status: 'bogus' }))).toBeNull();
    expect(parseServerMessage(JSON.stringify({ type: 'unknown' }))).toBeNull();
    expect(parseServerMessage(JSON.stringify(null))).toBeNull();
  });
});
