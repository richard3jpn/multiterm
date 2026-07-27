import { describe, expect, it } from 'vitest';
import { BUFFER_LIMIT, MAX_SESSIONS, loadConfig, selectShell } from './index';

describe('selectShell（RDD.md 5章2項: OS自動判定）', () => {
  it('win32 では powershell.exe', () => {
    expect(selectShell('win32', {})).toBe('powershell.exe');
  });

  it('linux では $SHELL を優先', () => {
    expect(selectShell('linux', { SHELL: '/usr/bin/zsh' })).toBe('/usr/bin/zsh');
  });

  it('$SHELL 未設定なら bash', () => {
    expect(selectShell('linux', {})).toBe('bash');
    expect(selectShell('darwin', {})).toBe('bash');
  });
});

describe('loadConfig', () => {
  const validEnv = { ALLOWED_ORIGINS: 'http://localhost:5173' };

  it('既定値: port=3001, host=127.0.0.1, 上限はRDD 7章準拠', () => {
    const config = loadConfig(validEnv, 'linux');
    expect(config.port).toBe(3001);
    expect(config.host).toBe('127.0.0.1');
    expect(config.maxSessions).toBe(MAX_SESSIONS);
    expect(config.bufferLimit).toBe(BUFFER_LIMIT);
    expect(MAX_SESSIONS).toBe(16);
    expect(BUFFER_LIMIT).toBe(200 * 1024);
  });

  it('ALLOWED_ORIGINS 未設定は起動エラー（RDD.md 5章9項）', () => {
    expect(() => loadConfig({}, 'linux')).toThrowError(/ALLOWED_ORIGINS/);
  });

  it('PORT 不正値は起動エラー', () => {
    expect(() => loadConfig({ ...validEnv, PORT: 'abc' }, 'linux')).toThrowError(/PORT/);
    expect(() => loadConfig({ ...validEnv, PORT: '0' }, 'linux')).toThrowError(/PORT/);
    expect(() => loadConfig({ ...validEnv, PORT: '70000' }, 'linux')).toThrowError(/PORT/);
  });

  it('HOST は環境変数で上書き可能（コンテナは0.0.0.0を注入）', () => {
    expect(loadConfig({ ...validEnv, HOST: '0.0.0.0' }, 'linux').host).toBe('0.0.0.0');
  });
});
