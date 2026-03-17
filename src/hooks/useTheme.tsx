import { createContext, useContext, useEffect, useState } from 'react';

export type ThemeId = 'midnight' | 'blush' | 'ocean' | 'paper';

interface ThemeDefinition {
  id: ThemeId;
  label: string;
}

interface ThemeContextValue {
  theme: ThemeId;
  setTheme: (theme: ThemeId) => void;
  themes: ThemeDefinition[];
}

const STORAGE_KEY = 'taskflow_theme';

const THEMES: ThemeDefinition[] = [
  { id: 'midnight', label: 'Midnight' },
  { id: 'blush', label: 'Blush' },
  { id: 'ocean', label: 'Ocean' },
  { id: 'paper', label: 'Paper' },
];

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getInitialTheme(): ThemeId {
  const storedTheme = localStorage.getItem(STORAGE_KEY);
  if (storedTheme === 'midnight' || storedTheme === 'blush' || storedTheme === 'ocean' || storedTheme === 'paper') {
    return storedTheme;
  }

  return 'midnight';
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<ThemeId>(() => getInitialTheme());

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, themes: THEMES }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider.');
  }

  return context;
}
