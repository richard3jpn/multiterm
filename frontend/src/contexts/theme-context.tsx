import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

export type Theme = 'dark' | 'light';

interface ThemeContextValue {
  readonly theme: Theme;
  readonly toggleTheme: () => void;
}

const STORAGE_KEY = 'multiterm.theme';

const ThemeContext = createContext<ThemeContextValue | null>(null);

const loadTheme = (): Theme => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
};

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(loadTheme);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // 永続化不可でも動作は継続
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'));
  }, []);

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>;
}

export const useTheme = (): ThemeContextValue => {
  const value = useContext(ThemeContext);
  if (value === null) {
    throw new Error('useTheme は ThemeProvider 配下で使用してください');
  }
  return value;
};
