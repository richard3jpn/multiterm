import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { SessionManager } from './session-manager';
import type { PtyLike, PtySpawn } from './session-manager';

class FakePty extends EventEmitter implements PtyLike {
  public written: string[] = [];
  public resized: Array<{ cols: number; rows: number }> = [];
  public killed = false;

  onData(listener: (data: string) => void): void {
    this.on('data', listener);
  }
  onExit(listener: (e: { exitCode: number }) => void): void {
    this.on('exit', listener);
  }
  write(data: string): void {
    this.written.push(data);
  }
  resize(cols: number, rows: number): void {
    this.resized.push({ cols, rows });
  }
  kill(): void {
    this.killed = true;
  }
}

const createManager = (limit = 16) => {
  const ptys: FakePty[] = [];
  const spawn: PtySpawn = () => {
    const pty = new FakePty();
    ptys.push(pty);
    return pty;
  };
  const manager = new SessionManager({ spawn, maxSessions: limit, bufferLimit: 20 });
  return { manager, ptys };
};

describe('SessionManager（RDD 7章 セッションモデル）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('セッションを作成し「Terminal N」で自動採番する', () => {
    const { manager } = createManager();
    const first = manager.create();
    const second = manager.create();
    expect(first.title).toBe('Terminal 1');
    expect(second.title).toBe('Terminal 2');
    expect(first.id).not.toBe(second.id);
    expect(manager.list().map((s) => s.id)).toEqual([first.id, second.id]);
  });

  it('削除後も採番は巻き戻らない', () => {
    const { manager } = createManager();
    const first = manager.create();
    manager.dispose(first.id);
    const next = manager.create();
    expect(next.title).toBe('Terminal 2');
  });

  it('上限（maxSessions）超過で SessionLimitError', () => {
    const { manager } = createManager(2);
    manager.create();
    manager.create();
    expect(() => manager.create()).toThrowError(/上限/);
  });

  it('list はコピーを返す（内部状態を変更できない）', () => {
    const { manager } = createManager();
    manager.create();
    const list = manager.list();
    (list as unknown[]).pop();
    expect(manager.list()).toHaveLength(1);
  });

  it('PTY出力をリングバッファ（上限付き）に蓄積し、getBuffer で取得できる', () => {
    const { manager, ptys } = createManager();
    const info = manager.create();
    ptys[0].emit('data', '0123456789');
    ptys[0].emit('data', 'abcdefghijklmn');
    expect(manager.getBuffer(info.id)).toBe('456789abcdefghijklmn'); // 上限20文字
  });

  it('write / resize がPTYへ委譲される（resizeは正の整数のみ許可）', () => {
    const { manager, ptys } = createManager();
    const info = manager.create();
    manager.write(info.id, 'ls\r');
    manager.resize(info.id, 80, 24);
    expect(ptys[0].written).toEqual(['ls\r']);
    expect(ptys[0].resized).toEqual([{ cols: 80, rows: 24 }]);
    expect(() => manager.resize(info.id, 0, 24)).toThrowError();
    expect(() => manager.resize(info.id, 80, -1)).toThrowError();
    expect(() => manager.resize(info.id, 1.5, 24)).toThrowError();
  });

  it('dispose でPTYをkillし一覧から除去する', () => {
    const { manager, ptys } = createManager();
    const info = manager.create();
    manager.dispose(info.id);
    expect(ptys[0].killed).toBe(true);
    expect(manager.list()).toHaveLength(0);
    expect(manager.getBuffer(info.id)).toBeUndefined();
  });

  it('PTYのexitでセッションが自動除去され、購読者へ通知される', () => {
    const { manager, ptys } = createManager();
    const info = manager.create();
    const exits: number[] = [];
    manager.subscribe(info.id, { onExit: (code) => exits.push(code) });
    ptys[0].emit('exit', { exitCode: 0 });
    expect(exits).toEqual([0]);
    expect(manager.list()).toHaveLength(0);
  });

  it('データ・状態変化を購読できる（RDD 7章: 状態変化を通知）', () => {
    const { manager, ptys } = createManager();
    const info = manager.create();
    const chunks: string[] = [];
    const statuses: string[] = [];
    manager.subscribe(info.id, {
      onData: (d) => chunks.push(d),
      onStatus: (s) => statuses.push(s),
    });
    ptys[0].emit('data', 'user@host:~$ ');
    vi.advanceTimersByTime(400); // QUIESCENCE_MS 経過で idle
    expect(chunks).toEqual(['user@host:~$ ']);
    expect(statuses).toEqual(['idle']);
    expect(manager.list()[0]?.status).toBe('idle');
  });

  it('存在しないIDへの操作は SessionNotFoundError', () => {
    const { manager } = createManager();
    expect(() => manager.write('nope', 'x')).toThrowError(/見つかりません/);
    expect(() => manager.resize('nope', 80, 24)).toThrowError(/見つかりません/);
    expect(() => manager.dispose('nope')).toThrowError(/見つかりません/);
    expect(() => manager.rename('nope', 'x')).toThrowError(/見つかりません/);
  });

  it('シェル指定で作成すると Session.shell にidが入り、spawnにpath/argsが渡る（RDD 9.2/9.5章）', () => {
    const spawned: Array<{ shell: string; args: readonly string[] }> = [];
    const manager = new SessionManager({
      spawn: ({ shell, args }) => {
        spawned.push({ shell, args });
        return new FakePty();
      },
      maxSessions: 16,
      bufferLimit: 20,
      defaultShell: { id: 'bash', label: 'Bash', path: '/bin/bash' },
    });
    const withDefault = manager.create();
    const withZsh = manager.create({ id: 'zsh', label: 'Zsh', path: '/usr/bin/zsh' });
    // RDD 9.5章: argsを持つシェル（wsl等）
    const withWsl = manager.create({
      id: 'wsl-Ubuntu',
      label: 'Ubuntu (zsh)',
      path: 'wsl.exe',
      args: ['-d', 'Ubuntu', '--cd', '~', '--', 'zsh', '-l'],
    });
    expect(withDefault.shell).toBe('bash');
    expect(withZsh.shell).toBe('zsh');
    expect(withWsl.shell).toBe('wsl-Ubuntu');
    expect(spawned).toEqual([
      { shell: '/bin/bash', args: [] },
      { shell: '/usr/bin/zsh', args: [] },
      { shell: 'wsl.exe', args: ['-d', 'Ubuntu', '--cd', '~', '--', 'zsh', '-l'] },
    ]);
  });

  it('rename でタイトルが変わり一覧に反映される（RDD 9.3章）', () => {
    const { manager } = createManager();
    const info = manager.create();
    const renamed = manager.rename(info.id, 'ビルド監視');
    expect(renamed.title).toBe('ビルド監視');
    expect(manager.list()[0]?.title).toBe('ビルド監視');
  });
});
