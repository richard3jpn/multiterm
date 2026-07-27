import { describe, expect, it } from 'vitest';
import { resolveShellLabel } from './shell-label';
import type { ShellInfo } from '../../types';

const shells: ShellInfo[] = [
  { id: 'cmd', label: 'コマンドプロンプト', path: 'cmd.exe' },
  { id: 'powershell', label: 'Windows PowerShell', path: 'powershell.exe' },
  { id: 'wsl-Ubuntu-22.04', label: 'Ubuntu-22.04 (zsh)', path: 'wsl.exe' },
];

describe('resolveShellLabel（RDD 9.5章: シェルidをラベル表示）', () => {
  it('許可リストのlabelに解決する', () => {
    expect(resolveShellLabel('cmd', shells)).toBe('コマンドプロンプト');
    expect(resolveShellLabel('wsl-Ubuntu-22.04', shells)).toBe('Ubuntu-22.04 (zsh)');
  });

  it('一覧に無いidはそのまま返す（フォールバック）', () => {
    expect(resolveShellLabel('unknown-shell', shells)).toBe('unknown-shell');
    expect(resolveShellLabel('zsh', [])).toBe('zsh');
  });
});
