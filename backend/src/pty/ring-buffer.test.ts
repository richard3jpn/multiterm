import { describe, expect, it } from 'vitest';
import { appendCapped } from './ring-buffer';

describe('appendCapped（RDD 7章: 出力バッファ上限200KB）', () => {
  it('上限未満なら連結して返す（元の文字列は変更しない）', () => {
    const base = 'abc';
    const result = appendCapped(base, 'def', 10);
    expect(result).toBe('abcdef');
    expect(base).toBe('abc');
  });

  it('上限を超えたら末尾側を優先して切り詰める', () => {
    expect(appendCapped('12345', '67890', 8)).toBe('34567890');
  });

  it('追記チャンク単体が上限を超える場合はチャンク末尾のみ残す', () => {
    expect(appendCapped('abc', '0123456789', 4)).toBe('6789');
  });

  it('空チャンクは何もしない', () => {
    expect(appendCapped('abc', '', 8)).toBe('abc');
  });
});
