import { Moon, Sun, Settings } from 'lucide-react';
import { useState } from 'react';
import { useTheme } from '../hooks/useTheme';
import { ThemeSettings } from './ThemeSettings';

export function ThemeSwitcher() {
  const { isDark, setMode } = useTheme();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const toggleDarkLight = () => {
    setMode(isDark ? 'light' : 'dark');
  };

  return (
    <>
      <div className="flex items-center gap-1.5">
        <button
          onClick={toggleDarkLight}
          className="flex items-center justify-center rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] p-2.5 text-[var(--text-muted)] shadow-sm transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
          aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
        >
          {isDark ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <button
          onClick={() => setSettingsOpen(true)}
          className="flex items-center justify-center rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] p-2.5 text-[var(--text-muted)] shadow-sm transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
          aria-label="Appearance settings"
        >
          <Settings size={16} />
        </button>
      </div>

      <ThemeSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}
