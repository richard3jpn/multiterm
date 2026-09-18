import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from './copy-text';

const setClipboard = (writeText: unknown) => {
  Object.defineProperty(navigator, 'clipboard', {
    value: writeText === null ? undefined : { writeText },
    configurable: true,
  });
};

afterEach(() => {
  setClipboard(null);
  vi.restoreAllMocks();
});

describe('copyText', () => {
  it('空文字は書き込まない', async () => {
    const writeText = vi.fn();
    setClipboard(writeText);
    expect(await copyText('')).toBe(false);
    expect(writeText).not.toHaveBeenCalled();
  });

  it('navigator.clipboard で書ければ true', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard(writeText);
    expect(await copyText('ls -la')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('ls -la');
  });

  // WebView2 のようにクリップボードAPIが拒否される場面がある
  it('navigator.clipboard が失敗したら textarea 経由で書く', async () => {
    setClipboard(vi.fn().mockRejectedValue(new Error('denied')));
    const exec = vi.fn().mockReturnValue(true);
    document.execCommand = exec;
    expect(await copyText('ls -la')).toBe(true);
    expect(exec).toHaveBeenCalledWith('copy');
    // 一時的なtextareaを残さない
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('navigator.clipboard が無くても textarea 経由で書く', async () => {
    setClipboard(null);
    document.execCommand = vi.fn().mockReturnValue(true);
    expect(await copyText('ls -la')).toBe(true);
  });

  it('どちらも失敗したら false', async () => {
    setClipboard(vi.fn().mockRejectedValue(new Error('denied')));
    document.execCommand = vi.fn().mockReturnValue(false);
    expect(await copyText('ls -la')).toBe(false);
  });
});
