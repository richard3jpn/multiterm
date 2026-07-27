import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSession, deleteSession, fetchSessions, fetchShells, renameSession } from './api';

const envelope = (data: unknown) => ({ success: true, data, error: null });

const mockFetch = (status: number, body: unknown): ReturnType<typeof vi.fn> => {
  const fn = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
  vi.stubGlobal('fetch', fn);
  return fn;
};

describe('REST APIクライアント', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetchSessions: 一覧を返す', async () => {
    const sessions = [{ id: 'x', title: 'Terminal 1', shell: 'bash', createdAt: 't', status: 'idle' }];
    const fn = mockFetch(200, envelope(sessions));
    await expect(fetchSessions()).resolves.toEqual(sessions);
    expect(fn.mock.calls[0][0]).toContain('/api/sessions');
  });

  it('createSession: POSTで作成する', async () => {
    const session = { id: 'y', title: 'Terminal 2', shell: 'bash', createdAt: 't', status: 'running' };
    const fn = mockFetch(201, envelope(session));
    await expect(createSession()).resolves.toEqual(session);
    expect(fn.mock.calls[0][1]?.method).toBe('POST');
  });

  it('deleteSession: DELETEを送る', async () => {
    const fn = mockFetch(200, envelope({ id: 'z' }));
    await deleteSession('z');
    expect(fn.mock.calls[0][0]).toContain('/api/sessions/z');
    expect(fn.mock.calls[0][1]?.method).toBe('DELETE');
  });

  it('fetchShells: 許可リストを返す（RDD 9.2章）', async () => {
    const shells = [{ id: 'bash', label: 'Bash', path: '/bin/bash' }];
    const fn = mockFetch(200, envelope(shells));
    await expect(fetchShells()).resolves.toEqual(shells);
    expect(fn.mock.calls[0][0]).toContain('/api/shells');
  });

  it('createSession: shellId指定時はボディに含める、省略時は空ボディ', async () => {
    const session = { id: 'y', title: 'Terminal 2', shell: 'zsh', createdAt: 't', status: 'running' };
    const fn = mockFetch(201, envelope(session));
    await createSession('zsh');
    expect(JSON.parse(fn.mock.calls[0][1]?.body as string)).toEqual({ shell: 'zsh' });
    await createSession(null);
    expect(JSON.parse(fn.mock.calls[1][1]?.body as string)).toEqual({});
  });

  it('renameSession: PATCHでtitleを送る（RDD 9.3章）', async () => {
    const session = { id: 'z', title: '監視', shell: 'bash', createdAt: 't', status: 'idle' };
    const fn = mockFetch(200, envelope(session));
    await expect(renameSession('z', '監視')).resolves.toEqual(session);
    expect(fn.mock.calls[0][0]).toContain('/api/sessions/z');
    expect(fn.mock.calls[0][1]?.method).toBe('PATCH');
    expect(JSON.parse(fn.mock.calls[0][1]?.body as string)).toEqual({ title: '監視' });
  });

  it('エラーレスポンス（envelope.error）を例外にする', async () => {
    mockFetch(429, { success: false, data: null, error: 'セッション数が上限です' });
    await expect(createSession()).rejects.toThrow('セッション数が上限です');
  });

  it('envelope形式でないレスポンスは汎用エラー', async () => {
    mockFetch(500, 'oops');
    await expect(fetchSessions()).rejects.toThrow();
  });
});
