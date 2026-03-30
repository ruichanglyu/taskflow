import { createContext, useContext, useEffect, useState, useCallback } from 'react';

export type PaletteId = 'neutral' | 'matcha' | 'sakura' | 'lavender' | 'ember' | 'honey' | 'mocha';
export type ModeId = 'light' | 'dark' | 'system';
export type FontId = 'inter' | 'dm-sans' | 'lora' | 'playfair';

// Keep old ThemeId as union for backward compat
export type ThemeId = 'dark' | 'light' | 'matcha' | 'sakura' | 'lavender' | 'ember' | 'honey' | 'mocha';

export interface PaletteOption {
  id: PaletteId;
  label: string;
  colors: [string, string]; // gradient swatch colors
}

export const PALETTE_OPTIONS: PaletteOption[] = [
  { id: 'neutral', label: 'Default', colors: ['#94a3b8', '#38bdf8'] },
  { id: 'matcha', label: 'Matcha', colors: ['#d4e4c8', '#7a9e65'] },
  { id: 'sakura', label: 'Sakura', colors: ['#f8d7e8', '#d4829e'] },
  { id: 'lavender', label: 'Lavender', colors: ['#e0d4f0', '#9b7ec8'] },
  { id: 'ember', label: 'Ember', colors: ['#ffd8bf', '#f97316'] },
  { id: 'honey', label: 'Honey', colors: ['#fdf0d5', '#eab308'] },
  { id: 'mocha', label: 'Mocha', colors: ['#e8d8c8', '#8d6444'] },
];

export const FONT_OPTIONS: { id: FontId; label: string; family: string }[] = [
  { id: 'inter', label: 'Inter', family: "'Inter', system-ui, sans-serif" },
  { id: 'dm-sans', label: 'DM Sans', family: "'DM Sans', system-ui, sans-serif" },
  { id: 'lora', label: 'Lora', family: "'Lora', Georgia, serif" },
  { id: 'playfair', label: 'Playfair', family: "'Playfair Display', Georgia, serif" },
];

interface ThemeSettings {
  palette: PaletteId;
  mode: ModeId;
  font: FontId;
  fontSize: number;
}

interface ThemeContextValue extends ThemeSettings {
  setPalette: (p: PaletteId) => void;
  setMode: (m: ModeId) => void;
  setFont: (f: FontId) => void;
  setFontSize: (s: number) => void;
  // compat
  theme: ThemeId;
  setTheme: (t: ThemeId) => void;
  isDark: boolean;
  effectiveMode: 'light' | 'dark';
}

const STORAGE_KEY = 'taskflow_theme_settings';

const DEFAULTS: ThemeSettings = {
  palette: 'neutral',
  mode: 'dark',
  font: 'inter',
  fontSize: 14,
};

function getSystemMode(): 'light' | 'dark' {
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches) {
    return 'light';
  }
  return 'dark';
}

function resolveMode(mode: ModeId): 'light' | 'dark' {
  return mode === 'system' ? getSystemMode() : mode;
}

function loadSettings(): ThemeSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // New format
      if (parsed.palette && parsed.mode) {
        const validModes = ['light', 'dark', 'system'];
        return {
          palette: PALETTE_OPTIONS.some(p => p.id === parsed.palette) ? parsed.palette : DEFAULTS.palette,
          mode: validModes.includes(parsed.mode) ? parsed.mode : DEFAULTS.mode,
          font: FONT_OPTIONS.some(f => f.id === parsed.font) ? parsed.font : DEFAULTS.font,
          fontSize: typeof parsed.fontSize === 'number' && parsed.fontSize >= 13 && parsed.fontSize <= 18 ? parsed.fontSize : DEFAULTS.fontSize,
        };
      }
      // Old format migration
      if (parsed.theme) {
        const oldTheme = parsed.theme as string;
        if (oldTheme === 'dark') return { ...DEFAULTS, palette: 'neutral', mode: 'dark', font: parsed.font ?? DEFAULTS.font, fontSize: parsed.fontSize ?? DEFAULTS.fontSize };
        if (oldTheme === 'light') return { ...DEFAULTS, palette: 'neutral', mode: 'light', font: parsed.font ?? DEFAULTS.font, fontSize: parsed.fontSize ?? DEFAULTS.fontSize };
        if (['matcha', 'sakura', 'lavender', 'ember', 'honey', 'mocha'].includes(oldTheme)) {
          return { ...DEFAULTS, palette: oldTheme as PaletteId, mode: 'light', font: parsed.font ?? DEFAULTS.font, fontSize: parsed.fontSize ?? DEFAULTS.fontSize };
        }
      }
    }
  } catch { /* ignore */ }

  const oldTheme = localStorage.getItem('taskflow_theme');
  if (oldTheme === 'light') return { ...DEFAULTS, mode: 'light' };

  if (window.matchMedia('(prefers-color-scheme: light)').matches) {
    return { ...DEFAULTS, mode: 'light' };
  }
  return DEFAULTS;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function applySettings(settings: ThemeSettings) {
  const effective = resolveMode(settings.mode);
  document.documentElement.dataset.palette = settings.palette;
  document.documentElement.dataset.mode = effective;
  // Legacy compat: also set data-theme for any old selectors
  if (settings.palette === 'neutral') {
    document.documentElement.dataset.theme = effective;
  } else {
    document.documentElement.dataset.theme = settings.palette + '-' + effective;
  }
  const fontOption = FONT_OPTIONS.find(f => f.id === settings.font);
  document.documentElement.style.setProperty('--font-family', fontOption?.family ?? FONT_OPTIONS[0].family);
  document.documentElement.style.setProperty('--font-size-base', `${settings.fontSize}px`);
  document.documentElement.style.fontSize = `${settings.fontSize}px`;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<ThemeSettings>(() => {
    const s = loadSettings();
    applySettings(s);
    return s;
  });

  const [systemMode, setSystemMode] = useState<'light' | 'dark'>(getSystemMode);

  // Listen for OS theme changes when mode is 'system'
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      setSystemMode(e.matches ? 'dark' : 'light');
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Re-apply when settings or system mode changes
  useEffect(() => {
    applySettings(settings);
  }, [settings, systemMode]);

  const setPalette = useCallback((palette: PaletteId) => {
    setSettings(prev => ({ ...prev, palette }));
  }, []);

  const setMode = useCallback((mode: ModeId) => {
    setSettings(prev => ({ ...prev, mode }));
  }, []);

  const setFont = useCallback((font: FontId) => {
    setSettings(prev => ({ ...prev, font }));
  }, []);

  const setFontSize = useCallback((fontSize: number) => {
    setSettings(prev => ({ ...prev, fontSize }));
  }, []);

  // Compat
  const effectiveMode = settings.mode === 'system' ? systemMode : settings.mode;
  const theme: ThemeId = settings.palette === 'neutral' ? effectiveMode : settings.palette;
  const setTheme = useCallback((t: ThemeId) => {
    if (t === 'dark') setSettings(prev => ({ ...prev, palette: 'neutral', mode: 'dark' }));
    else if (t === 'light') setSettings(prev => ({ ...prev, palette: 'neutral', mode: 'light' }));
    else setSettings(prev => ({ ...prev, palette: t as PaletteId, mode: 'light' }));
  }, []);

  return (
    <ThemeContext.Provider value={{
      ...settings, setPalette, setMode, setFont, setFontSize,
      theme, setTheme, isDark: effectiveMode === 'dark', effectiveMode,
    }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within a ThemeProvider.');
  return context;
}
