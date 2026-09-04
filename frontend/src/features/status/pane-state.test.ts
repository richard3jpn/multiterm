import { describe, expect, it } from 'vitest';
import {
  aggregatePaneState,
  countPaneStates,
  paneDotClasses,
  paneFrameClasses,
  paneStateLabel,
  resolvePaneState,
  MIN_RUNNING_MS,
  shouldMarkDone,
} from './pane-state';
import type { PaneState } from './pane-state';

describe('ペイン状態の決定（herdr の状態モデルを踏襲）', () => {
  it('入力待ちは未確認かどうかに関係なく blocked', () => {
    expect(resolvePaneState('waiting-input', true)).toBe('blocked');
    expect(resolvePaneState('waiting-input', false)).toBe('blocked');
  });

  it('実行中は未確認かどうかに関係なく working', () => {
    expect(resolvePaneState('running', true)).toBe('working');
    expect(resolvePaneState('running', false)).toBe('working');
  });

  it('idle は未確認なら done、確認済みなら idle', () => {
    expect(resolvePaneState('idle', true)).toBe('done');
    expect(resolvePaneState('idle', false)).toBe('idle');
  });
});

describe('状態の集約（1つでも注意が必要なら全体をそう見せる）', () => {
  it('blocked が最優先', () => {
    expect(aggregatePaneState(['idle', 'working', 'blocked', 'done'])).toBe('blocked');
  });

  it('blocked が無ければ working', () => {
    expect(aggregatePaneState(['idle', 'done', 'working'])).toBe('working');
  });

  it('blocked / working が無ければ done', () => {
    expect(aggregatePaneState(['idle', 'done', 'idle'])).toBe('done');
  });

  it('すべて idle なら idle', () => {
    expect(aggregatePaneState(['idle', 'idle'])).toBe('idle');
  });

  it('ペインが無い場合は idle', () => {
    expect(aggregatePaneState([])).toBe('idle');
  });
});

describe('状態の集計', () => {
  it('各状態の件数を数える', () => {
    const states: PaneState[] = ['blocked', 'working', 'working', 'done', 'idle', 'idle', 'idle'];
    expect(countPaneStates(states)).toEqual({ blocked: 1, working: 2, done: 1, idle: 3 });
  });

  it('空なら全て0', () => {
    expect(countPaneStates([])).toEqual({ blocked: 0, working: 0, done: 0, idle: 0 });
  });
});

describe('表示', () => {
  it('状態色は status-style と揃える（実行中=青、待機=オレンジ）', () => {
    expect(paneDotClasses('blocked')).toContain('bg-red-500');
    expect(paneDotClasses('blocked')).toContain('animate-pulse');
    expect(paneDotClasses('working')).toBe('bg-blue-500');
    expect(paneDotClasses('idle')).toBe('bg-orange-300');
    // done は待機と同じオレンジ（色では区別せず、上部の集約カウントで数だけ示す）
    expect(paneDotClasses('done')).toBe('bg-orange-300');
  });

  it('画面全体の外枠は手を動かす必要がある状態だけ縁取る', () => {
    expect(paneFrameClasses('blocked')).toContain('inset');
    expect(paneFrameClasses('blocked')).toContain('239,68,68');
    // 待機・完了はオレンジで縁取る（作業が終わって手が空いたことに気づけるように）
    expect(paneFrameClasses('idle')).toContain('255,184,106');
    expect(paneFrameClasses('done')).toContain('255,184,106');
    // 実行中は放っておいてよいので枠なし
    expect(paneFrameClasses('working')).toBe('');
  });

  it('日本語ラベル', () => {
    expect(paneStateLabel('blocked')).toBe('入力待ち');
    expect(paneStateLabel('working')).toBe('実行中');
    expect(paneStateLabel('done')).toBe('完了（未確認）');
    expect(paneStateLabel('idle')).toBe('待機');
  });
});

describe('完了（未確認）の判定', () => {
  const base = {
    status: 'idle' as const,
    previous: 'running' as const,
    isActive: false,
    runningMs: 5000,
  };

  it('実行中から待機に変わり、見ていなくて、一瞬でなければ完了として記録する', () => {
    expect(shouldMarkDone(base)).toBe(true);
  });

  it('最初から待機のターミナルは完了にしない', () => {
    expect(shouldMarkDone({ ...base, previous: undefined })).toBe(false);
    expect(shouldMarkDone({ ...base, previous: 'idle' })).toBe(false);
  });

  it('見ているターミナルは完了として残さない', () => {
    expect(shouldMarkDone({ ...base, isActive: true })).toBe(false);
  });

  it('リサイズ等による一瞬の実行は完了にしない', () => {
    expect(shouldMarkDone({ ...base, runningMs: 200 })).toBe(false);
    expect(shouldMarkDone({ ...base, runningMs: MIN_RUNNING_MS - 1 })).toBe(false);
    expect(shouldMarkDone({ ...base, runningMs: MIN_RUNNING_MS })).toBe(true);
  });

  it('実行開始が記録されていない場合は完了にしない', () => {
    expect(shouldMarkDone({ ...base, runningMs: null })).toBe(false);
  });

  it('入力待ち・実行中への遷移は完了ではない', () => {
    expect(shouldMarkDone({ ...base, status: 'running' })).toBe(false);
    expect(shouldMarkDone({ ...base, status: 'waiting-input' })).toBe(false);
  });
});
