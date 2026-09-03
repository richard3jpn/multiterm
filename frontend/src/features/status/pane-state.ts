import type { SessionStatus } from '../../types';

/**
 * サイドバーに出すペイン状態。
 *
 * バックエンドが返す SessionStatus（RDD 7章）を、AIエージェント運用向けに
 * 「見たかどうか」の軸を足して4段階にしたもの。herdr の状態モデルを踏襲している。
 * - blocked: 入力・承認待ち（すぐ人が動く必要がある）
 * - working: 実行中
 * - done:    完了したがユーザーがまだそのペインを見ていない
 * - idle:    完了済みで確認済み、または最初から待機
 */
export type PaneState = 'blocked' | 'working' | 'done' | 'idle';

export const PANE_STATES: readonly PaneState[] = ['blocked', 'working', 'done', 'idle'];

/**
 * セッション状態と「未確認か」からペイン状態を決める。
 *
 * done は idle のときだけ意味を持つ（実行中・入力待ちは未確認かどうかに関係なくそちらが優先）。
 */
export const resolvePaneState = (status: SessionStatus, unseen: boolean): PaneState => {
  if (status === 'waiting-input') return 'blocked';
  if (status === 'running') return 'working';
  return unseen ? 'done' : 'idle';
};

/** 注意を引く順（人が対応すべき順）。集約時に最も強い状態を選ぶために使う */
const SEVERITY: Record<PaneState, number> = { blocked: 3, working: 2, done: 1, idle: 0 };

/**
 * 複数ペインの状態を1つに集約する（herdr: ワークスペースは内部の状態を集約して表示する）。
 * ペインが無い場合は idle。
 */
export const aggregatePaneState = (states: readonly PaneState[]): PaneState =>
  states.reduce<PaneState>(
    (strongest, state) => (SEVERITY[state] > SEVERITY[strongest] ? state : strongest),
    'idle',
  );

export type PaneStateCounts = Readonly<Record<PaneState, number>>;

export const countPaneStates = (states: readonly PaneState[]): PaneStateCounts => {
  const counts: Record<PaneState, number> = { blocked: 0, working: 0, done: 0, idle: 0 };
  for (const state of states) counts[state] += 1;
  return counts;
};

/**
 * サイドバー行の状態ドット（RDD 5章6項）。赤・黄・青の3系統。
 * done は待機と同じ青にしている（色では区別せず、上部の集約カウントで数だけ示す）。
 */
export const paneDotClasses = (state: PaneState): string => {
  switch (state) {
    case 'blocked':
      return 'bg-red-500 animate-pulse';
    case 'working':
      return 'bg-amber-400';
    case 'done':
      return 'bg-blue-500';
    case 'idle':
      return 'bg-blue-500';
  }
};

export const paneStateLabel = (state: PaneState): string => {
  switch (state) {
    case 'blocked':
      return '入力待ち';
    case 'working':
      return '実行中';
    case 'done':
      return '完了（未確認）';
    case 'idle':
      return '待機';
  }
};

/**
 * これより短い「実行中」は完了として数えない。
 *
 * 再接続時のリサイズ等でPTYが再描画すると running が一瞬立つ。
 * それを「完了（未確認）」にするとリロードのたびに全ターミナルが未確認になってしまう。
 */
export const MIN_RUNNING_MS = 1000;

/**
 * 「完了（未確認）」として記録すべきかを判定する。
 *
 * 実行中から待機へ変わり、そのターミナルを見ておらず、
 * 実行が一瞬ではなかった場合だけ true。
 */
export const shouldMarkDone = (params: {
  readonly status: SessionStatus;
  readonly previous: SessionStatus | undefined;
  readonly isActive: boolean;
  readonly runningMs: number | null;
}): boolean =>
  params.status === 'idle' &&
  params.previous === 'running' &&
  !params.isActive &&
  params.runningMs !== null &&
  params.runningMs >= MIN_RUNNING_MS;
