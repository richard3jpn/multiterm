import { describe, expect, it } from 'vitest';
import { buildWindowsShells, parseWslDistros } from './windows-shells';

describe('parseWslDistros（RDD 9.5章: wsl -l -v 出力のパース）', () => {
  // wsl -l -v は UTF-16LE。デコード後の文字列を渡す想定
  const sample = [
    '  NAME              STATE           VERSION',
    '* Ubuntu-22.04      Running         2',
    '  docker-desktop    Stopped         2',
    '  Ubuntu            Stopped         2',
  ].join('\n');

  it('ディストロ名を抽出し、カレントマーカ(*)を除去する', () => {
    expect(parseWslDistros(sample)).toEqual(['Ubuntu-22.04', 'Ubuntu']);
  });

  it('docker-desktop系のシステムディストロを除外する', () => {
    const withData = sample + '\n  docker-desktop-data  Stopped         2';
    const result = parseWslDistros(withData);
    expect(result).not.toContain('docker-desktop');
    expect(result).not.toContain('docker-desktop-data');
  });

  it('ヘッダ行のみ・空文字はからの配列', () => {
    expect(parseWslDistros('  NAME   STATE   VERSION')).toEqual([]);
    expect(parseWslDistros('')).toEqual([]);
  });

  it('NUL文字（UTF-16残渣）や\\rが混じっても抽出できる', () => {
    const dirty = 'NAME\r\n* Ubuntu-22.04\x00  Running  2\r';
    expect(parseWslDistros(dirty)).toEqual(['Ubuntu-22.04']);
  });
});

describe('buildWindowsShells（RDD 9.5章: Windows許可リスト構築）', () => {
  it('cmd と powershell を常に含み、args が仕様どおり', () => {
    const shells = buildWindowsShells({ hasPwsh: false, wslShells: [] });
    const cmd = shells.find((s) => s.id === 'cmd');
    const ps = shells.find((s) => s.id === 'powershell');
    expect(cmd).toEqual({ id: 'cmd', label: 'コマンドプロンプト', path: 'cmd.exe', args: [] });
    expect(ps).toEqual({
      id: 'powershell',
      label: 'Windows PowerShell',
      path: 'powershell.exe',
      args: ['-NoLogo'],
    });
  });

  it('pwsh は hasPwsh のときのみ含む', () => {
    expect(buildWindowsShells({ hasPwsh: false, wslShells: [] }).some((s) => s.id === 'pwsh')).toBe(
      false,
    );
    const withPwsh = buildWindowsShells({ hasPwsh: true, wslShells: [] });
    expect(withPwsh.find((s) => s.id === 'pwsh')).toEqual({
      id: 'pwsh',
      label: 'PowerShell',
      path: 'pwsh.exe',
      args: ['-NoLogo'],
    });
  });

  it('WSLディストロは wsl-<distro> id と正しい args で構築する', () => {
    const shells = buildWindowsShells({
      hasPwsh: false,
      wslShells: [{ distro: 'Ubuntu-22.04', loginShell: 'zsh' }],
    });
    const wsl = shells.find((s) => s.id === 'wsl-Ubuntu-22.04');
    expect(wsl).toEqual({
      id: 'wsl-Ubuntu-22.04',
      label: 'Ubuntu-22.04 (zsh)',
      path: 'wsl.exe',
      args: ['-d', 'Ubuntu-22.04', '--cd', '~', '--', 'zsh', '-l'],
    });
  });

  it('複数WSLディストロを列挙する', () => {
    const shells = buildWindowsShells({
      hasPwsh: false,
      wslShells: [
        { distro: 'Ubuntu-22.04', loginShell: 'zsh' },
        { distro: 'Ubuntu', loginShell: 'bash' },
      ],
    });
    expect(shells.map((s) => s.id)).toEqual([
      'cmd',
      'powershell',
      'wsl-Ubuntu-22.04',
      'wsl-Ubuntu',
    ]);
  });
});
