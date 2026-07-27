import type { ShellInfo } from '../types';

/** WSLのシステムディストロ（ユーザー用でないため除外）判定 */
const isSystemDistro = (name: string): boolean => /^docker-desktop/i.test(name);

/**
 * `wsl.exe -l -v` の出力からユーザー用ディストロ名を抽出する（RDD 9.5章）。
 * 出力はUTF-16LE・カレントディストロの `*` マーカ・空白整形を含む前提でデコード済み文字列を受け取る。
 * パースできない行は無視し、失敗しても例外は投げない。
 */
export const parseWslDistros = (raw: string): string[] => {
  return raw
    .split(/\r?\n/)
    .map((line) => line.replace(/\x00/g, '').trim())
    .filter((line) => line !== '')
    // ヘッダ行（NAME で始まる）を除外
    .filter((line) => !/^\*?\s*NAME\b/i.test(line))
    .map((line) => {
      // 先頭の `*`（カレント）を除き、最初の空白区切りトークン＝ディストロ名
      const withoutMarker = line.replace(/^\*\s*/, '');
      const name = withoutMarker.split(/\s+/)[0];
      return name ?? '';
    })
    .filter((name) => name !== '' && !isSystemDistro(name));
};

export interface WslShell {
  readonly distro: string;
  readonly loginShell: string;
}

export interface WindowsShellOptions {
  readonly hasPwsh: boolean;
  readonly wslShells: readonly WslShell[];
}

/**
 * Windows用シェル許可リストを構築する（RDD 9.5章）。
 * path・args はここで構築した固定値のみ。クライアント入力は一切混入しない。
 */
export const buildWindowsShells = ({ hasPwsh, wslShells }: WindowsShellOptions): ShellInfo[] => {
  const shells: ShellInfo[] = [
    { id: 'cmd', label: 'コマンドプロンプト', path: 'cmd.exe', args: [] },
    { id: 'powershell', label: 'Windows PowerShell', path: 'powershell.exe', args: ['-NoLogo'] },
  ];
  if (hasPwsh) {
    shells.push({ id: 'pwsh', label: 'PowerShell', path: 'pwsh.exe', args: ['-NoLogo'] });
  }
  for (const { distro, loginShell } of wslShells) {
    shells.push({
      id: `wsl-${distro}`,
      label: `${distro} (${loginShell})`,
      path: 'wsl.exe',
      args: ['-d', distro, '--cd', '~', '--', loginShell, '-l'],
    });
  }
  return shells;
};
