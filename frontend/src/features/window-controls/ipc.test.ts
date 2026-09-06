import { describe, expect, it } from 'vitest';
import { isNearEdge, RESIZE_INSET } from './ipc';

describe('窓の枠の判定（RDD 16.7）', () => {
  const width = 800;
  const height = 600;

  it('4辺のどこでも枠と見なす', () => {
    expect(isNearEdge(0, 300, width, height)).toBe(true);
    expect(isNearEdge(300, 0, width, height)).toBe(true);
    expect(isNearEdge(width - 1, 300, width, height)).toBe(true);
    expect(isNearEdge(300, height - 1, width, height)).toBe(true);
  });

  it('角も枠と見なす', () => {
    expect(isNearEdge(0, 0, width, height)).toBe(true);
    expect(isNearEdge(width - 1, height - 1, width, height)).toBe(true);
  });

  it('内側は枠ではない', () => {
    expect(isNearEdge(400, 300, width, height)).toBe(false);
    expect(isNearEdge(RESIZE_INSET, RESIZE_INSET, width, height)).toBe(false);
  });

  it('境界のちょうど内と外', () => {
    // inset の1px内側までが枠
    expect(isNearEdge(RESIZE_INSET - 1, 300, width, height)).toBe(true);
    expect(isNearEdge(RESIZE_INSET, 300, width, height)).toBe(false);
    expect(isNearEdge(width - RESIZE_INSET, 300, width, height)).toBe(true);
    expect(isNearEdge(width - RESIZE_INSET - 1, 300, width, height)).toBe(false);
  });

  it('窓が枠の幅より小さいときは全面が枠になる（掴めなくならない）', () => {
    expect(isNearEdge(3, 3, 6, 6)).toBe(true);
  });
});
