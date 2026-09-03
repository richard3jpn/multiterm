import { describe, expect, it } from 'vitest';
import {
  statusDotClasses,
  statusFrameClasses,
  statusHeaderClasses,
  statusLabel,
} from './status-style';

describe('状態別スタイル（RDD 2章・5章6項）', () => {
  it('running: 黄の境界線（パルスアニメーションなし）', () => {
    const classes = statusFrameClasses('running');
    expect(classes).toContain('border-amber-400');
    expect(classes).not.toContain('animate-pulse');
  });

  it('waiting-input: 赤発光', () => {
    const classes = statusFrameClasses('waiting-input');
    expect(classes).toContain('border-red-500');
    expect(classes).toContain('shadow');
  });

  it('idle: 落ち着いた青境界線（パルスなし）', () => {
    const classes = statusFrameClasses('idle');
    expect(classes).toContain('border-blue-500');
    expect(classes).not.toContain('animate-pulse');
  });

  it('日本語ラベル', () => {
    expect(statusLabel('running')).toBe('実行中');
    expect(statusLabel('waiting-input')).toBe('入力待ち');
    expect(statusLabel('idle')).toBe('待機');
  });

  it('状態ドット: running/idleは静的、waiting-inputのみ点滅', () => {
    expect(statusDotClasses('running')).toBe('bg-amber-400');
    expect(statusDotClasses('waiting-input')).toContain('bg-red-500');
    expect(statusDotClasses('waiting-input')).toContain('animate-pulse');
    expect(statusDotClasses('idle')).toBe('bg-blue-500');
  });

  it('ヘッダー帯は枠と同じ状態色を敷く', () => {
    expect(statusHeaderClasses('running')).toContain('amber');
    expect(statusHeaderClasses('waiting-input')).toContain('red');
    expect(statusHeaderClasses('idle')).toContain('blue');
  });

  it('実行中と待機は別の色相（見分けられること）', () => {
    expect(statusDotClasses('running')).not.toBe(statusDotClasses('idle'));
    expect(statusFrameClasses('running')).not.toContain('blue');
    expect(statusFrameClasses('idle')).not.toContain('amber');
  });

  it('赤・黄・青の3系統で組む（緑・紫・シアンは使わない）', () => {
    const all = [
      statusFrameClasses('running'),
      statusFrameClasses('waiting-input'),
      statusFrameClasses('idle'),
      statusDotClasses('running'),
      statusDotClasses('waiting-input'),
      statusDotClasses('idle'),
      statusHeaderClasses('running'),
      statusHeaderClasses('waiting-input'),
      statusHeaderClasses('idle'),
    ].join(' ');
    for (const banned of ['green', 'purple', 'cyan']) {
      expect(all).not.toContain(banned);
    }
  });
});
