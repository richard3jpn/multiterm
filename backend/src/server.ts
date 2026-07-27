import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import * as pty from 'node-pty';
import { createApp } from './app';
import { loadConfig } from './config';
import { SessionManager } from './pty/session-manager';
import { detectShells } from './pty/shell-registry';
import { buildWindowsShells, parseWslDistros } from './pty/windows-shells';
import type { WslShell } from './pty/windows-shells';
import { attachWsServer } from './ws/handler';
import type { ShellInfo } from './types';

const EXEC_OPTS = { timeout: 5000 } as const;

/** WSLディストロのログインシェル名を取得（RDD 9.5章。失敗時はzsh→bash→shで在否確認） */
const resolveWslLoginShell = (distro: string): string => {
  try {
    const out = execFileSync('wsl.exe', ['-d', distro, '--', 'sh', '-lc', 'echo $SHELL'], EXEC_OPTS)
      .toString('utf8')
      .trim();
    const name = out.split('/').filter(Boolean).pop();
    if (name) return name;
  } catch {
    // フォールバックへ
  }
  for (const cand of ['zsh', 'bash', 'sh']) {
    try {
      execFileSync('wsl.exe', ['-d', distro, '--', 'which', cand], { ...EXEC_OPTS, stdio: 'ignore' });
      return cand;
    } catch {
      // 次の候補
    }
  }
  return 'bash';
};

/** Windows用シェル許可リストの構築（RDD 9.5章。副作用: wsl/pwsh検出） */
const detectWindowsShells = (): ShellInfo[] => {
  let hasPwsh = false;
  try {
    execFileSync('pwsh.exe', ['-NoLogo', '-Command', 'exit'], { ...EXEC_OPTS, stdio: 'ignore' });
    hasPwsh = true;
  } catch {
    // pwsh未導入
  }
  let wslShells: WslShell[] = [];
  try {
    const raw = execFileSync('wsl.exe', ['-l', '-v'], EXEC_OPTS).toString('utf16le');
    wslShells = parseWslDistros(raw).map((distro) => ({
      distro,
      loginShell: resolveWslLoginShell(distro),
    }));
  } catch {
    // WSL未導入・パース失敗 → WSLシェルは追加しない（cmd/powershellは維持）
  }
  return buildWindowsShells({ hasPwsh, wslShells });
};

const main = (): void => {
  const platform = os.platform();
  const config = loadConfig(process.env, platform);

  // RDD 9.2章 / 9.5章: 利用可能シェルの許可リスト（実在検出）
  const shells =
    platform === 'win32'
      ? detectWindowsShells()
      : detectShells(platform, process.env, (path) => fs.existsSync(path));
  const defaultShell =
    shells.find((s) => s.path === config.shell || s.id === config.shell) ?? shells[0];
  if (!defaultShell) {
    throw new Error('利用可能なシェルが見つかりません');
  }

  // RDD 9.5章: node-pty conpty_console_list_agent の "AttachConsole failed" は
  // シェル動作に影響しない既知事象。Windowsでのみ、かつ node-pty の conpty agent
  // 由来（スタックに node-pty/conpty を含む）の既知エラーに限定して握りつぶし、
  // 無関係な致命的例外はグローバルに握りつぶさず再送出する
  if (platform === 'win32') {
    process.on('uncaughtException', (error: Error) => {
      const stack = error.stack ?? '';
      const isConptyAgent =
        /node-pty[\\/].*conpty/i.test(stack) && /AttachConsole|conpty/i.test(error.message);
      if (isConptyAgent) {
        console.warn('[multiterm] conpty既知事象を無視:', error.message);
        return;
      }
      throw error;
    });
  }

  const manager = new SessionManager({
    spawn: ({ cols, rows, shell, args }) =>
      pty.spawn(shell, [...args], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: os.homedir(),
        env: process.env as Record<string, string>,
      }),
    maxSessions: config.maxSessions,
    bufferLimit: config.bufferLimit,
    defaultShell,
  });

  const app = createApp({ manager, allowedOrigins: config.allowedOrigins, shells });
  const server = http.createServer(app);
  attachWsServer(server, { manager, allowedOrigins: config.allowedOrigins });

  server.listen(config.port, config.host, () => {
    console.log(
      `[multiterm] backend listening on ${config.host}:${config.port} ` +
        `(shells: ${shells.map((s) => s.id).join(', ')})`,
    );
  });

  const shutdown = (): void => {
    manager.disposeAll();
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
};

main();
