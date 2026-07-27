import type { SessionStatus } from '../../types';

/**
 * 状態に応じたパネル枠のTailwindクラス（RDD 2章・5章6項）
 * - running: 青い境界線（静的。パルスアニメーションは目障りなため不使用）
 * - waiting-input: 全体が黄色く発光してユーザーの注意を引く
 * - idle: 落ち着いた緑色の境界線
 */
export const statusFrameClasses = (status: SessionStatus): string => {
  switch (status) {
    case 'running':
      // 実行中: 鮮やかな青枠＋青発光（パルスなし。RDD 2章）
      return 'border-blue-500 shadow-[0_0_16px_rgba(59,130,246,0.7)]';
    case 'waiting-input':
      // 入力待ち: 黄枠＋強い黄発光でユーザーの注意を引く
      return 'border-yellow-400 shadow-[0_0_22px_rgba(250,204,21,0.85)]';
    case 'idle':
      // 待機: 落ち着いた緑枠＋控えめな緑発光
      return 'border-green-500 shadow-[0_0_12px_rgba(34,197,94,0.55)]';
  }
};

export const statusLabel = (status: SessionStatus): string => {
  switch (status) {
    case 'running':
      return '実行中';
    case 'waiting-input':
      return '入力待ち';
    case 'idle':
      return '待機';
  }
};

export const statusDotClasses = (status: SessionStatus): string => {
  switch (status) {
    case 'running':
      return 'bg-blue-500';
    case 'waiting-input':
      // 入力待ちはユーザーの操作を促すため、ドットのみ点滅を残す
      return 'bg-yellow-400 animate-pulse';
    case 'idle':
      return 'bg-green-500';
  }
};
