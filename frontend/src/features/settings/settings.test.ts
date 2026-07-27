import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_FONT_SIZE,
  DEFAULT_SETTINGS,
  FONT_PRESETS,
  clampFontSize,
  loadSettings,
  resolveFontFamily,
  saveSettings,
} from './settings';

describe('ターミナル設定（RDD 9.1章）', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('フォントプリセットは等幅の複数種（既定は先頭のsystem-mono）', () => {
    const ids = FONT_PRESETS.map((p) => p.id);
    expect(ids[0]).toBe('system-mono');
    expect(ids.length).toBeGreaterThanOrEqual(8);
    // 代表的な等幅フォントが含まれること
    expect(ids).toEqual(
      expect.arrayContaining(['cascadia-code', 'jetbrains-mono', 'consolas', 'courier-new']),
    );
    // id は重複しない
    expect(new Set(ids).size).toBe(ids.length);
    // すべてのプリセットが monospace へフォールバックする
    for (const preset of FONT_PRESETS) {
      expect(preset.family.toLowerCase()).toContain('mono');
    }
  });

  it('clampFontSize: 10〜20の整数にクランプ、不正値は既定13', () => {
    expect(clampFontSize(14)).toBe(14);
    expect(clampFontSize(9)).toBe(10);
    expect(clampFontSize(21)).toBe(20);
    expect(clampFontSize(14.6)).toBe(15);
    expect(clampFontSize('16')).toBe(DEFAULT_FONT_SIZE);
    expect(clampFontSize(NaN)).toBe(DEFAULT_FONT_SIZE);
    expect(clampFontSize(undefined)).toBe(DEFAULT_FONT_SIZE);
  });

  it('resolveFontFamily: 未知idは既定プリセットにフォールバック', () => {
    expect(resolveFontFamily('consolas')).toContain('Consolas');
    expect(resolveFontFamily('evil-font; }')).toBe(FONT_PRESETS[0].family);
  });

  it('保存して読み戻せる（受け入れ基準④: localStorage保存）', () => {
    saveSettings({ fontFamilyId: 'courier-new', fontSize: 18, defaultShellId: 'zsh' });
    expect(loadSettings()).toEqual({
      fontFamilyId: 'courier-new',
      fontSize: 18,
      defaultShellId: 'zsh',
    });
  });

  it('未保存・壊れたデータは既定値', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    localStorage.setItem('multiterm.settings.v1', '{broken');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('不正なフィールドは各既定値に矯正される', () => {
    localStorage.setItem(
      'multiterm.settings.v1',
      JSON.stringify({ fontFamilyId: 'bogus', fontSize: 99, defaultShellId: 42 }),
    );
    expect(loadSettings()).toEqual({
      fontFamilyId: 'system-mono',
      fontSize: 20,
      defaultShellId: null,
    });
  });
});
