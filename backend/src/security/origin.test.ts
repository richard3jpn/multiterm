import { describe, expect, it } from 'vitest';
import { isOriginAllowed, parseAllowedOrigins } from './origin';

describe('Origin検証（RDD 5章9項）', () => {
  it('カンマ区切りの環境変数値をトリムしてパースする', () => {
    expect(parseAllowedOrigins(' http://localhost:5173 , http://127.0.0.1:5173 ')).toEqual([
      'http://localhost:5173',
      'http://127.0.0.1:5173',
    ]);
  });

  it('未設定・空文字は空リスト（すべて拒否）', () => {
    expect(parseAllowedOrigins(undefined)).toEqual([]);
    expect(parseAllowedOrigins('')).toEqual([]);
  });

  it('ホワイトリスト完全一致のみ許可する', () => {
    const allowed = ['http://localhost:5173'];
    expect(isOriginAllowed('http://localhost:5173', allowed)).toBe(true);
    expect(isOriginAllowed('http://localhost:5173/', allowed)).toBe(false);
    expect(isOriginAllowed('http://evil.example.com', allowed)).toBe(false);
    expect(isOriginAllowed('http://localhost:51730', allowed)).toBe(false);
  });

  it('Originヘッダなしは拒否する（DNSリバインディング対策）', () => {
    expect(isOriginAllowed(undefined, ['http://localhost:5173'])).toBe(false);
  });
});
