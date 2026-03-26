import { createContext, useContext, useEffect, useState, useCallback } from 'react';

export type ThemeId = 'dark' | 'light' | 'matcha' | 'sakura' | 'cloud' | 'lavender';
export type FontId = 'inter' | 'dm-sans' | 'lora' | 'playfair';

export interface ThemePreset {
  id: ThemeId;
  label: string;
  swatch: string; // preview color
  isDark: boolean;
}

export const THEME_PRESETS: ThemePreset[] = [
  { id: 'dark', label: 'Midnight', swatch: '#0f1623', isDark: true },
  { id: 'light', label: 'Light', swatch: '#eef4fb', isDark: false },
  { id: 'matcha', label: 'Matcha', swatch: '#8fae7e', isDark: false },
  { id: 'sakura', label: 'Sakura', swatch: '#e8a0bf', isDark: false },
  { id: 'cloud', label: 'Cloud', swatch: '#89b4e8', isDark: false },
  { id: 'lavender', label: 'Lavender', swatch: '#b4a0d4', isDark: false },
];

export const FONT_OPTIONS: { id: FontId; label: string; family: string }[] = [
  { id: 'inter', label: 'Inter', family: "'Inter', system-ui, sans-serif" },
  { id: 'dm-sans', label: 'DM Sans', family: "'DM Sans', system-ui, sans-serif" },
  { id: 'lora', label: 'Lora', family: "'Lora', Georgia, serif" },
  { id: 'playfair', label: 'Playfair', family: "'Playfair Display', Georgia, serif" },
];

interface ThemeSettings {
  theme: ThemeId;
  font: FontId;
  fontSize: number; // 13-18
}

interface ThemeContextValue extends ThemeSettings {
  setTheme: (theme: ThemeId) => void;
  setFont: (font: FontId) => void;
  setFontSize: (size: number) => void;
  isDark: boolean;
}

const STORAGE_KEY = 'taskflow_theme_settings';

const DEFAULTS: ThemeSettings = {
  theme: 'dark',
  font: 'inter',
  fontSize: 14,
};

function loadSettings(): ThemeSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        theme: THEME_PRESETS.some(p => p.id === parsed.theme) ? parsed.theme : DEFAULTS.theme,
        font: FONT_OPTIONS.some(f => f.id === parsed.font) ? parsed.font : DEFAULTS.font,
        fontSize: typeof parsed.fontSize === 'number' && parsed.fontSize >= 13 && parsed.fontSize <= 18 ? parsed.fontSize : DEFAULTS.fontSize,
      };
    }
  } catch { /* ignore */ }

  // Migrate from old key
  const oldTheme = localStorage.getItem('taskflow_theme');
  if (oldTheme === 'dark' || oldTheme === 'light') {
    return { ...DEFAULTS, theme: oldTheme };
  }

  if (window.matchMedia('(prefers-color-scheme: light)').matches) {
    return { ...DEFAULTS, theme: 'light' };
  }
  return DEFAULTS;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function applySettings(settings: ThemeSettings) {
  document.documentElement.dataset.theme = settings.theme;
  const fontOption = FONT_OPTIONS.find(f => f.id === settings.font);
  document.documentElement.style.setProperty('--font-family', fontOption?.family ?? FONT_OPTIONS[0].family);
  document.documentElement.style.setProperty('--font-size-base', `${settings.fontSize}px`);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<ThemeSettings>(() => {
    const s = loadSettings();
    applySettings(s);
    return s;
  });

  useEffect(() => {
    applySettings(settings);
  }, [settings]);

  const setTheme = useCallback((theme: ThemeId) => {
    setSettings(prev => ({ ...prev, theme }));
  }, []);

  const setFont = useCallback((font: FontId) => {
    setSettings(prev => ({ ...prev, font }));
  }, []);

  const setFontSize = useCallback((fontSize: number) => {
    setSettings(prev => ({ ...prev, fontSize }));
  }, []);

  const isDark = THEME_PRESETS.find(p => p.id === settings.theme)?.isDark ?? false;

  return (
    <ThemeContext.Provider value={{ ...settings, setTheme, setFont, setFontSize, isDark }}>
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
