import type { ShellInfo } from '../types';

/** Linux / macOS で検出を試みるシェル候補（RDD 9.2章） */
const UNIX_CANDIDATES: ReadonlyArray<{ id: string; label: string; paths: readonly string[] }> = [
  { id: 'bash', label: 'Bash', paths: ['/bin/bash', '/usr/bin/bash'] },
  { id: 'zsh', label: 'Zsh', paths: ['/bin/zsh', '/usr/bin/zsh'] },
  { id: 'fish', label: 'Fish', paths: ['/usr/bin/fish', '/usr/local/bin/fish'] },
  { id: 'sh', label: 'sh', paths: ['/bin/sh'] },
];

const basename = (path: string): string => path.split('/').filter(Boolean).pop() ?? path;

/**
 * Unix系（Linux / macOS）で利用可能なシェルを検出し許可リストを返す（RDD 9.2章）。
 * existsは注入可能（テスト用）。実在しない候補は含めない。
 * Windows（win32）のシェル検出は windows-shells.ts の buildWindowsShells を使う（RDD 9.5章）。
 */
export const detectShells = (
  platform: NodeJS.Platform,
  env: Readonly<Record<string, string | undefined>>,
  exists: (path: string) => boolean,
): ShellInfo[] => {
  void platform; // Unix系専用。呼び出し側がplatformで分岐する
  const detected = UNIX_CANDIDATES.flatMap((candidate) => {
    const path = candidate.paths.find(exists);
    return path ? [{ id: candidate.id, label: candidate.label, path }] : [];
  });
  // $SHELL（サーバ既定）が候補一覧外でも許可リストに含める
  const defaultShell = env.SHELL;
  if (defaultShell && exists(defaultShell)) {
    const id = basename(defaultShell);
    if (!detected.some((s) => s.id === id)) {
      return [...detected, { id, label: id, path: defaultShell }];
    }
  }
  return detected;
};

/** 許可リストのidのみ解決する。リスト外・パス文字列はundefined（RDD 9.2章セキュリティ要件） */
export const resolveShell = (
  id: string,
  registry: readonly ShellInfo[],
): ShellInfo | undefined => registry.find((shell) => shell.id === id);
