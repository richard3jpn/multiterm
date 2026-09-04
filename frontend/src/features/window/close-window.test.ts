import { describe, expect, it } from 'vitest';
import { summarizeWindowClose, windowCloseMessage } from './close-window';
import type { LayoutNode } from '../layout/layout-tree';
import type { SessionStatus } from '../../types';

const leaf = (sessionId: string): LayoutNode => ({ type: 'leaf', sessionId });
const split = (first: LayoutNode, second: LayoutNode): LayoutNode => ({
  type: 'split',
  direction: 'vertical',
  ratio: 0.5,
  first,
  second,
});

const statuses = (map: Record<string, SessionStatus>) => (id: string) => map[id];

describe('ウィンドウを閉じるときの確認（RDD 14章）', () => {
  it('空のウィンドウは確認不要', () => {
    const summary = summarizeWindowClose(null, statuses({}));
    expect(summary).toEqual({ sessionIds: [], busyCount: 0, needsConfirm: false });
  });

  it('全部待機なら確認不要', () => {
    const summary = summarizeWindowClose(
      split(leaf('a'), leaf('b')),
      statuses({ a: 'idle', b: 'idle' }),
    );
    expect(summary.sessionIds).toEqual(['a', 'b']);
    expect(summary.needsConfirm).toBe(false);
  });

  it('実行中が含まれると確認する', () => {
    const summary = summarizeWindowClose(
      split(leaf('a'), leaf('b')),
      statuses({ a: 'running', b: 'idle' }),
    );
    expect(summary.busyCount).toBe(1);
    expect(summary.needsConfirm).toBe(true);
  });

  it('入力待ちも件数に数える', () => {
    const summary = summarizeWindowClose(
      split(leaf('a'), split(leaf('b'), leaf('c'))),
      statuses({ a: 'waiting-input', b: 'running', c: 'idle' }),
    );
    expect(summary.busyCount).toBe(2);
  });

  it('状態が未取得のセッションは実行中に数えない', () => {
    const summary = summarizeWindowClose(leaf('a'), statuses({}));
    expect(summary.busyCount).toBe(0);
    expect(summary.needsConfirm).toBe(false);
  });

  it('確認文にウィンドウ名と件数を含める', () => {
    const summary = summarizeWindowClose(
      split(leaf('a'), leaf('b')),
      statuses({ a: 'running', b: 'idle' }),
    );
    expect(windowCloseMessage('調査用', summary)).toBe(
      '「調査用」の 2 個のターミナルを終了します。うち 1 個が実行中または入力待ちです。',
    );
  });
});
