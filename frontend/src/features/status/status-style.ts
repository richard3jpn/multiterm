import type { SessionStatus } from '../../types';

/**
 * 状態に応じたパネル枠のTailwindクラス（RDD 2章・5章6項）
 *
 * 赤・黄・青の3系統で組む。エージェントを見張る使い方では、実行中は放っておけて
 * 待機（作業が終わって手が空いた状態）こそ気づきたいため、目につく黄を待機に、
 * 落ち着いた青を実行中に割り当てている。
 * - running: 落ち着いた青の境界線（静的。パルスアニメーションは目障りなため不使用）
 * - waiting-input: 全体が赤く発光してユーザーの注意を引く
 * - idle: 黄の境界線（作業が終わったことに気づけるよう目につく色）
 */
export const statusFrameClasses = (status: SessionStatus): string => {
  switch (status) {
    case 'running':
      // 実行中: 落ち着いた青枠＋控えめな青発光（パルスなし。RDD 2章）
      return 'border-blue-500 shadow-[0_0_12px_rgba(59,130,246,0.55)]';
    case 'waiting-input':
      // 入力待ち: 赤枠＋強い赤発光でユーザーの注意を引く
      return 'border-red-500 shadow-[0_0_22px_rgba(239,68,68,0.85)]';
    case 'idle':
      // 待機: 黄枠＋黄発光。手が空いたことに気づけるようにする
      return 'border-amber-400 shadow-[0_0_16px_rgba(251,191,36,0.7)]';
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
      return 'bg-red-500 animate-pulse';
    case 'idle':
      return 'bg-amber-400';
  }
};

/**
 * パネルヘッダー帯の背景色。枠と同じ状態色を、文字が読める濃さで敷く。
 * 分割数が多いとき枠だけでは追いにくいため、帯でも状態が分かるようにする。
 */
export const statusHeaderClasses = (status: SessionStatus): string => {
  switch (status) {
    case 'running':
      return 'bg-blue-500/40';
    case 'waiting-input':
      return 'bg-red-500/40';
    case 'idle':
      return 'bg-amber-400/40';
  }
};
