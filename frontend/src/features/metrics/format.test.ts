import { describe, expect, it } from 'vitest';
import { formatCpuPercent, formatMemory, toMachineCpuPercent } from './format';

describe('CPU使用率の換算（RDD 17章）', () => {
  it('コア数で割ってマシン全体に対する割合にする', () => {
    expect(toMachineCpuPercent(100, 8)).toBeCloseTo(12.5);
    expect(toMachineCpuPercent(800, 8)).toBeCloseTo(100);
  });

  it('コア数が取れないときは0にする（0除算しない）', () => {
    expect(toMachineCpuPercent(100, 0)).toBe(0);
    expect(toMachineCpuPercent(100, -1)).toBe(0);
  });

  it('小数1桁まで見せる（動いているのに0%と出さない）', () => {
    expect(formatCpuPercent(100, 8)).toBe('12.5%');
    expect(formatCpuPercent(4, 8)).toBe('0.5%');
    expect(formatCpuPercent(0, 8)).toBe('0.0%');
  });
});

describe('メモリ量の表示（RDD 17章）', () => {
  it('1MB未満はKB', () => {
    expect(formatMemory(512 * 1024)).toBe('512 KB');
    expect(formatMemory(0)).toBe('0 KB');
  });

  it('1MB以上1GB未満はMB（整数）', () => {
    expect(formatMemory(42 * 1024 * 1024)).toBe('42 MB');
    expect(formatMemory(1024 * 1024)).toBe('1 MB');
  });

  it('1GB以上はGB（小数1桁）', () => {
    expect(formatMemory(2.5 * 1024 * 1024 * 1024)).toBe('2.5 GB');
    expect(formatMemory(1024 * 1024 * 1024)).toBe('1.0 GB');
  });

  it('負の値は0扱いにする（計測が壊れても表示を壊さない）', () => {
    expect(formatMemory(-1)).toBe('0 KB');
  });
});
