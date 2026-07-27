import { describe, expect, it } from 'vitest';
import { sanitizeTitle } from './title';

describe('セッション名バリデーション（RDD 9.3章）', () => {
  it('前後空白をトリムして返す', () => {
    expect(sanitizeTitle('  ビルド監視  ')).toBe('ビルド監視');
  });

  it('空文字・空白のみは null', () => {
    expect(sanitizeTitle('')).toBeNull();
    expect(sanitizeTitle('   ')).toBeNull();
  });

  it('30文字ちょうどは許可、31文字は null（コードポイント単位）', () => {
    expect(sanitizeTitle('a'.repeat(30))).toBe('a'.repeat(30));
    expect(sanitizeTitle('a'.repeat(31))).toBeNull();
    expect(sanitizeTitle('🚀'.repeat(30))).toBe('🚀'.repeat(30));
    expect(sanitizeTitle('🚀'.repeat(31))).toBeNull();
  });

  it('制御文字を含む名前は null', () => {
    expect(sanitizeTitle('badname')).toBeNull();
    expect(sanitizeTitle('badname')).toBeNull();
  });
});
