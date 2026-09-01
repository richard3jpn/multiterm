import type { ApiEnvelope, Session, ShellInfo } from '../types';

// 既定は配信元と同じオリジン（単一バイナリがフロントとAPIを同一ポートで配信するため）。
// 開発時にViteの開発サーバから別ポートのバックエンドを叩く場合は VITE_API_URL で上書きする。
const API_URL: string = import.meta.env.VITE_API_URL ?? location.origin;

const requestJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${API_URL}${path}`, init);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(`サーバ応答の解析に失敗しました（HTTP ${response.status}）`);
  }
  const envelope = body as Partial<ApiEnvelope<T>>;
  if (!response.ok || envelope.success !== true || envelope.data == null) {
    throw new Error(
      typeof envelope.error === 'string' && envelope.error !== ''
        ? envelope.error
        : `サーバエラーが発生しました（HTTP ${response.status}）`,
    );
  }
  return envelope.data as T;
};

export const fetchSessions = (): Promise<Session[]> => requestJson<Session[]>('/api/sessions');

/** RDD 9.2章: 利用可能シェルの許可リスト */
/** シェル一覧と、バックエンドがまだ検出中か（検出中なら後で取り直す） */
export interface ShellList {
  readonly shells: ShellInfo[];
  readonly detecting: boolean;
}

/**
 * 利用可能シェルの許可リスト（RDD 9.2章）。
 *
 * WSLディストロの検出には時間がかかるため、バックエンドは即座に使えるシェルで
 * 先に応答し、検出中は `x-shell-detection: detecting` を返す。
 */
export const fetchShells = async (): Promise<ShellList> => {
  const response = await fetch(`${API_URL}/api/shells`);
  const detecting = response.headers.get('x-shell-detection') === 'detecting';
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(`サーバ応答の解析に失敗しました（HTTP ${response.status}）`);
  }
  const envelope = body as Partial<ApiEnvelope<ShellInfo[]>>;
  if (!response.ok || envelope.success !== true || envelope.data == null) {
    throw new Error(
      typeof envelope.error === 'string' && envelope.error !== ''
        ? envelope.error
        : `サーバエラーが発生しました（HTTP ${response.status}）`,
    );
  }
  return { shells: envelope.data, detecting };
};

/** shellId は許可リストのid。省略時はサーバ既定シェル（RDD 9.2章） */
export const createSession = (shellId?: string | null): Promise<Session> =>
  requestJson<Session>('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(shellId ? { shell: shellId } : {}),
  });

/** RDD 9.3章: セッション名変更 */
export const renameSession = (id: string, title: string): Promise<Session> =>
  requestJson<Session>(`/api/sessions/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });

export const deleteSession = (id: string): Promise<{ id: string }> =>
  requestJson<{ id: string }>(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
