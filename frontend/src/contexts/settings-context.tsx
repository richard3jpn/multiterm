import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  DEFAULT_SETTINGS,
  clampFontSize,
  loadSettings,
  saveSettings,
} from '../features/settings/settings';
import type { TerminalSettings } from '../features/settings/settings';

interface SettingsContextValue {
  readonly settings: TerminalSettings;
  readonly setFontFamilyId: (fontFamilyId: string) => void;
  readonly setFontSize: (fontSize: number) => void;
  readonly setDefaultShellId: (defaultShellId: string | null) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

/** ターミナル表示設定（RDD 9.1章）・既定シェル選択（RDD 9.2章）。localStorageへ永続化 */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<TerminalSettings>(loadSettings);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  const setFontFamilyId = useCallback((fontFamilyId: string) => {
    setSettings((current) => ({ ...current, fontFamilyId }));
  }, []);

  const setFontSize = useCallback((fontSize: number) => {
    setSettings((current) => ({ ...current, fontSize: clampFontSize(fontSize) }));
  }, []);

  const setDefaultShellId = useCallback((defaultShellId: string | null) => {
    setSettings((current) => ({ ...current, defaultShellId }));
  }, []);

  return (
    <SettingsContext.Provider
      value={{ settings, setFontFamilyId, setFontSize, setDefaultShellId }}
    >
      {children}
    </SettingsContext.Provider>
  );
}

export const useSettings = (): SettingsContextValue => {
  const value = useContext(SettingsContext);
  if (value === null) {
    throw new Error('useSettings は SettingsProvider 配下で使用してください');
  }
  return value;
};

export { DEFAULT_SETTINGS };
