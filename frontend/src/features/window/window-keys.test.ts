import { describe, expect, it } from 'vitest';
import { resolveDigitShortcut } from './window-keys';

const event = (over: Partial<Parameters<typeof resolveDigitShortcut>[0]>) => ({
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  code: 'Digit1',
  ...over,
});

describe('Alt+数字 / Alt+Shift+数字 の判定（RDD 9.6章・14章）', () => {
  it('Altのみはペイン移動', () => {
    expect(resolveDigitShortcut(event({ altKey: true, code: 'Digit3' }))).toEqual({
      kind: 'pane',
      index: 3,
    });
  });

  it('Alt+Shiftはウィンドウ切り替え', () => {
    expect(resolveDigitShortcut(event({ altKey: true, shiftKey: true, code: 'Digit2' }))).toEqual({
      kind: 'window',
      index: 2,
    });
  });

  it('Altなしは対象外', () => {
    expect(resolveDigitShortcut(event({}))).toBeNull();
  });

  it('CtrlやMetaが混ざると対象外（ブラウザのタブ切り替えと衝突させない）', () => {
    expect(resolveDigitShortcut(event({ altKey: true, ctrlKey: true }))).toBeNull();
    expect(resolveDigitShortcut(event({ altKey: true, metaKey: true }))).toBeNull();
  });

  it('数字キー以外は対象外', () => {
    expect(resolveDigitShortcut(event({ altKey: true, code: 'KeyA' }))).toBeNull();
    expect(resolveDigitShortcut(event({ altKey: true, code: 'Numpad1' }))).toBeNull();
  });

  it('0と範囲外は対象外', () => {
    expect(resolveDigitShortcut(event({ altKey: true, code: 'Digit0' }))).toBeNull();
  });

  it('1〜9のすべてを受け付ける', () => {
    for (let n = 1; n <= 9; n += 1) {
      expect(resolveDigitShortcut(event({ altKey: true, code: `Digit${n}` }))).toEqual({
        kind: 'pane',
        index: n,
      });
    }
  });
});
