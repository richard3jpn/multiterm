import { describe, expect, it } from 'vitest';
import { statusDotClasses, statusFrameClasses, statusLabel } from './status-style';

describe('状態別スタイル（RDD 2章・5章6項）', () => {
  it('running: 青い境界線（パルスアニメーションなし）', () => {
    const classes = statusFrameClasses('running');
    expect(classes).toContain('border-blue-500');
    expect(classes).not.toContain('animate-pulse');
  });

  it('waiting-input: 黄色発光', () => {
    const classes = statusFrameClasses('waiting-input');
    expect(classes).toContain('border-yellow-400');
    expect(classes).toContain('shadow');
  });

  it('idle: 落ち着いた緑境界線（パルスなし）', () => {
    const classes = statusFrameClasses('idle');
    expect(classes).toContain('border-green-500');
    expect(classes).not.toContain('animate-pulse');
  });

  it('日本語ラベル', () => {
    expect(statusLabel('running')).toBe('実行中');
    expect(statusLabel('waiting-input')).toBe('入力待ち');
    expect(statusLabel('idle')).toBe('待機');
  });

  it('状態ドット: running/idleは静的、waiting-inputのみ点滅', () => {
    expect(statusDotClasses('running')).toBe('bg-blue-500');
    expect(statusDotClasses('waiting-input')).toContain('bg-yellow-400');
    expect(statusDotClasses('waiting-input')).toContain('animate-pulse');
    expect(statusDotClasses('idle')).toBe('bg-green-500');
  });
});
