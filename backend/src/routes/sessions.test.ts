import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import request from 'supertest';
import { createApp } from '../app';
import { SessionManager } from '../pty/session-manager';
import type { PtyLike } from '../pty/session-manager';

class FakePty extends EventEmitter implements PtyLike {
  onData(listener: (data: string) => void): void {
    this.on('data', listener);
  }
  onExit(listener: (e: { exitCode: number }) => void): void {
    this.on('exit', listener);
  }
  write(): void {}
  resize(): void {}
  kill(): void {}
}

const SHELLS = [
  { id: 'bash', label: 'Bash', path: '/bin/bash' },
  { id: 'zsh', label: 'Zsh', path: '/usr/bin/zsh' },
];

const buildApp = (maxSessions = 16) => {
  const manager = new SessionManager({
    spawn: () => new FakePty(),
    maxSessions,
    bufferLimit: 1024,
    defaultShell: SHELLS[0],
  });
  const app = createApp({
    manager,
    allowedOrigins: ['http://localhost:5173'],
    shells: SHELLS,
  });
  return { app, manager };
};

describe('REST API /api/sessions', () => {
  it('POST でセッションを作成し、API envelope で返す', async () => {
    const { app } = buildApp();
    const res = await request(app).post('/api/sessions').send({});
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.title).toBe('Terminal 1');
    expect(res.body.data.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.error).toBeNull();
  });

  it('GET で一覧を返す', async () => {
    const { app } = buildApp();
    await request(app).post('/api/sessions').send({});
    await request(app).post('/api/sessions').send({});
    const res = await request(app).get('/api/sessions');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });

  it('上限超過時は 429 とエラーメッセージ', async () => {
    const { app } = buildApp(1);
    await request(app).post('/api/sessions').send({});
    const res = await request(app).post('/api/sessions').send({});
    expect(res.status).toBe(429);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('上限');
  });

  it('DELETE でセッションを破棄する', async () => {
    const { app, manager } = buildApp();
    const created = await request(app).post('/api/sessions').send({});
    const res = await request(app).delete(`/api/sessions/${created.body.data.id}`);
    expect(res.status).toBe(200);
    expect(manager.list()).toHaveLength(0);
  });

  it('存在しないIDのDELETEは 404', async () => {
    const { app } = buildApp();
    const res = await request(app).delete('/api/sessions/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('不正な形式のIDは 400（入力バリデーション）', async () => {
    const { app } = buildApp();
    const res = await request(app).delete('/api/sessions/not-a-valid-uuid');
    expect(res.status).toBe(400);
  });

  it('CORS: 許可オリジンには Access-Control-Allow-Origin を返す', async () => {
    const { app } = buildApp();
    const res = await request(app)
      .get('/api/sessions')
      .set('Origin', 'http://localhost:5173');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('CORS: 非許可オリジンには Access-Control-Allow-Origin を返さない', async () => {
    const { app } = buildApp();
    const res = await request(app)
      .get('/api/sessions')
      .set('Origin', 'http://evil.example.com');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('サーバ側Origin強制: 非許可オリジンの単純POSTは403（CSRF対策）', async () => {
    const { app, manager } = buildApp();
    const res = await request(app)
      .post('/api/sessions')
      .set('Origin', 'http://evil.example.com')
      .send({});
    expect(res.status).toBe(403);
    expect(manager.list()).toHaveLength(0);
  });

  it('サーバ側Origin強制: 許可オリジンのPOSTは成功する', async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post('/api/sessions')
      .set('Origin', 'http://localhost:5173')
      .send({});
    expect(res.status).toBe(201);
  });

  it('サーバ側Origin強制: Originヘッダなし（curl等）は許可', async () => {
    const { app } = buildApp();
    const res = await request(app).post('/api/sessions').send({});
    expect(res.status).toBe(201);
  });

  it('GET /api/shells: 許可リストを返す（RDD 9.2章）', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/api/shells');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(SHELLS);
  });

  it('POST: 許可リスト内のシェルidで作成でき、Session.shellにidが入る', async () => {
    const { app } = buildApp();
    const res = await request(app).post('/api/sessions').send({ shell: 'zsh' });
    expect(res.status).toBe(201);
    expect(res.body.data.shell).toBe('zsh');
  });

  it.each(['fish', '/bin/evil', '../bash', 123])(
    'POST: 許可リスト外のシェル指定 %s は 400（RDD 9.2章セキュリティ要件）',
    async (shell) => {
      const { app, manager } = buildApp();
      const res = await request(app).post('/api/sessions').send({ shell });
      expect(res.status).toBe(400);
      expect(manager.list()).toHaveLength(0);
    },
  );

  it('POST: shell省略時はサーバ既定シェル', async () => {
    const { app } = buildApp();
    const res = await request(app).post('/api/sessions').send({});
    expect(res.status).toBe(201);
    expect(res.body.data.shell).toBe('bash');
  });

  it('PATCH: 名前を変更でき一覧に反映される（RDD 9.3章）', async () => {
    const { app } = buildApp();
    const created = await request(app).post('/api/sessions').send({});
    const id = created.body.data.id;
    const res = await request(app).patch(`/api/sessions/${id}`).send({ title: '  ビルド監視  ' });
    expect(res.status).toBe(200);
    expect(res.body.data.title).toBe('ビルド監視'); // トリムされる
    const list = await request(app).get('/api/sessions');
    expect(list.body.data[0].title).toBe('ビルド監視');
  });

  it.each([
    ['空文字', ''],
    ['空白のみ', '   '],
    ['31文字以上', 'あ'.repeat(31)],
    ['制御文字含み', 'badname'],
    ['非文字列', 42],
  ])('PATCH: 不正なtitle（%s）は 400', async (_label, title) => {
    const { app } = buildApp();
    const created = await request(app).post('/api/sessions').send({});
    const res = await request(app)
      .patch(`/api/sessions/${created.body.data.id}`)
      .send({ title });
    expect(res.status).toBe(400);
  });

  it('PATCH: 存在しないIDは 404', async () => {
    const { app } = buildApp();
    const res = await request(app)
      .patch('/api/sessions/00000000-0000-0000-0000-000000000000')
      .send({ title: 'x' });
    expect(res.status).toBe(404);
  });

  it('PATCH: 30文字ちょうどは許可', async () => {
    const { app } = buildApp();
    const created = await request(app).post('/api/sessions').send({});
    const res = await request(app)
      .patch(`/api/sessions/${created.body.data.id}`)
      .send({ title: 'a'.repeat(30) });
    expect(res.status).toBe(200);
  });

  it('PATCH: 絵文字30個はコードポイント単位で30文字として許可', async () => {
    const { app } = buildApp();
    const created = await request(app).post('/api/sessions').send({});
    const res = await request(app)
      .patch(`/api/sessions/${created.body.data.id}`)
      .send({ title: '🚀'.repeat(30) });
    expect(res.status).toBe(200);
  });

  it.each([{ id: 'bash' }, ['bash']])(
    'POST: shellが文字列以外（オブジェクト/配列）は 400',
    async (shell) => {
      const { app } = buildApp();
      const res = await request(app).post('/api/sessions').send({ shell });
      expect(res.status).toBe(400);
    },
  );

  it('サーバ側Origin強制: GET /api/shells も非許可オリジンは 403（RDD 9.4章）', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/api/shells').set('Origin', 'http://evil.example.com');
    expect(res.status).toBe(403);
  });

  it('サーバ側Origin強制: PATCH も非許可オリジンは 403（RDD 9.4章）', async () => {
    const { app } = buildApp();
    const created = await request(app).post('/api/sessions').send({});
    const res = await request(app)
      .patch(`/api/sessions/${created.body.data.id}`)
      .set('Origin', 'http://evil.example.com')
      .send({ title: 'x' });
    expect(res.status).toBe(403);
  });

  it('内部エラー時は 500 と詳細を漏らさないメッセージ', async () => {
    const { app, manager } = buildApp();
    vi.spyOn(manager, 'list').mockImplementation(() => {
      throw new Error('secret internal detail');
    });
    const res = await request(app).get('/api/sessions');
    expect(res.status).toBe(500);
    expect(res.body.error).not.toContain('secret');
  });
});
