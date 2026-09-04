import { collectSessionIds } from '../layout/layout-tree';
import type { LayoutNode } from '../layout/layout-tree';
import type { SessionStatus } from '../../types';

/**
 * ウィンドウを閉じると中のセッション（シェルのプロセス）も終了する。
 * 実行中・入力待ちを巻き込むときだけ確認を挟む（全部待機なら黙って閉じてよい）。
 */
export interface WindowCloseSummary {
  readonly sessionIds: readonly string[];
  /** running + waiting-input の件数 */
  readonly busyCount: number;
  readonly needsConfirm: boolean;
}

export const summarizeWindowClose = (
  layout: LayoutNode | null,
  statusOf: (sessionId: string) => SessionStatus | undefined,
): WindowCloseSummary => {
  const sessionIds = layout === null ? [] : collectSessionIds(layout);
  const busyCount = sessionIds.filter((id) => {
    const status = statusOf(id);
    return status === 'running' || status === 'waiting-input';
  }).length;
  return { sessionIds, busyCount, needsConfirm: busyCount > 0 };
};

export const windowCloseMessage = (title: string, summary: WindowCloseSummary): string =>
  `「${title}」の ${summary.sessionIds.length} 個のターミナルを終了します。` +
  `うち ${summary.busyCount} 個が実行中または入力待ちです。`;
