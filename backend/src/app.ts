import cors from 'cors';
import express from 'express';
import type { Express, NextFunction, Request, Response } from 'express';
import { createSessionsRouter } from './routes/sessions';
import { isOriginAllowed } from './security/origin';
import type { SessionManager } from './pty/session-manager';
import type { ApiResponse, ShellInfo } from './types';

export interface AppDependencies {
  readonly manager: SessionManager;
  readonly allowedOrigins: readonly string[];
  readonly shells: readonly ShellInfo[];
}

/** Express アプリ生成（RDD.md 5章12項: CORSはホワイトリストのオリジンのみ許可） */
export const createApp = ({ manager, allowedOrigins, shells }: AppDependencies): Express => {
  const app = express();

  // サーバ側Origin強制（RDD.md 5章9項）: CORSヘッダ付与とは別に、
  // 非許可Originからの単純リクエスト（CSRF経由のセッション量産等）を403で遮断する。
  // Originヘッダなし（同一オリジン・curl等）は許可
  app.use((req: Request, res: Response<ApiResponse<never>>, next: NextFunction) => {
    const origin = req.headers.origin;
    if (origin !== undefined && !isOriginAllowed(origin, allowedOrigins)) {
      res.status(403).json({ success: false, data: null, error: '許可されていないオリジンです' });
      return;
    }
    next();
  });

  app.use(
    cors({
      origin: (origin, callback) => {
        // Originヘッダなし（curl等・同一オリジン）はCORSヘッダ付与なしで通す
        if (origin === undefined) {
          callback(null, false);
          return;
        }
        callback(null, isOriginAllowed(origin, allowedOrigins));
      },
    }),
  );
  app.use(express.json());

  app.get('/api/health', (_req: Request, res: Response) => {
    res.status(200).json({ success: true, data: 'ok', error: null });
  });

  // RDD 9.2章: 利用可能シェルの許可リスト
  app.get('/api/shells', (_req: Request, res: Response) => {
    res.status(200).json({ success: true, data: shells, error: null });
  });

  app.use('/api/sessions', createSessionsRouter(manager, shells));

  // 集中エラーハンドラ: 詳細はサーバログのみに残し、レスポンスへは漏らさない
  app.use(
    (error: unknown, _req: Request, res: Response<ApiResponse<never>>, _next: NextFunction) => {
      console.error('[multiterm] unhandled error:', error);
      res.status(500).json({ success: false, data: null, error: 'サーバ内部エラーが発生しました' });
    },
  );

  return app;
};
