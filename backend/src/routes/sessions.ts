import { Router } from 'express';
import type { Request, Response } from 'express';
import { SessionLimitError, SessionNotFoundError } from '../pty/session-manager';
import type { SessionManager } from '../pty/session-manager';
import { resolveShell } from '../pty/shell-registry';
import type { ApiResponse, SessionInfo, ShellInfo } from '../types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TITLE_MAX_LENGTH = 30;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1f\x7f]/;

const ok = <T>(data: T): ApiResponse<T> => ({ success: true, data, error: null });
const fail = (error: string): ApiResponse<never> => ({ success: false, data: null, error });

/** RDD 9.3章: 1〜30文字（コードポイント単位）・制御文字禁止・前後トリム。不正はnull */
export const sanitizeTitle = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null;
  const title = raw.trim();
  const length = [...title].length; // サロゲートペア（絵文字等）を1文字と数える
  if (length < 1 || length > TITLE_MAX_LENGTH) return null;
  if (CONTROL_CHARS.test(title)) return null;
  return title;
};

/** セッション管理 REST API（RDD 5章1項・9章） */
export const createSessionsRouter = (
  manager: SessionManager,
  shells: readonly ShellInfo[],
): Router => {
  const router = Router();

  router.get('/', (_req: Request, res: Response<ApiResponse<SessionInfo[]>>) => {
    res.status(200).json(ok(manager.list()));
  });

  router.post('/', (req: Request, res: Response<ApiResponse<SessionInfo>>) => {
    const rawShell: unknown = (req.body as Record<string, unknown> | undefined)?.shell;
    let shell: ShellInfo | undefined;
    if (rawShell !== undefined) {
      // RDD 9.2章: 許可リストのidのみ受理。リスト外・任意パスは400
      shell = typeof rawShell === 'string' ? resolveShell(rawShell, shells) : undefined;
      if (!shell) {
        res.status(400).json(fail('指定されたシェルは利用できません'));
        return;
      }
    }
    try {
      res.status(201).json(ok(manager.create(shell)));
    } catch (error: unknown) {
      if (error instanceof SessionLimitError) {
        res.status(429).json(fail(error.message));
        return;
      }
      throw error;
    }
  });

  router.patch('/:id', (req: Request, res: Response<ApiResponse<SessionInfo>>) => {
    const { id } = req.params;
    if (typeof id !== 'string' || !UUID_PATTERN.test(id)) {
      res.status(400).json(fail('セッションIDの形式が不正です'));
      return;
    }
    const title = sanitizeTitle((req.body as Record<string, unknown> | undefined)?.title);
    if (title === null) {
      res.status(400).json(fail('セッション名は1〜30文字で、制御文字は使用できません'));
      return;
    }
    try {
      res.status(200).json(ok(manager.rename(id, title)));
    } catch (error: unknown) {
      if (error instanceof SessionNotFoundError) {
        res.status(404).json(fail(error.message));
        return;
      }
      throw error;
    }
  });

  router.delete('/:id', (req: Request, res: Response<ApiResponse<{ id: string }>>) => {
    const { id } = req.params;
    // Express 5 の params は string | string[]。配列（重複パラメータ）は不正入力として弾く
    if (typeof id !== 'string' || !UUID_PATTERN.test(id)) {
      res.status(400).json(fail('セッションIDの形式が不正です'));
      return;
    }
    try {
      manager.dispose(id);
      res.status(200).json(ok({ id }));
    } catch (error: unknown) {
      if (error instanceof SessionNotFoundError) {
        res.status(404).json(fail(error.message));
        return;
      }
      throw error;
    }
  });

  return router;
};
