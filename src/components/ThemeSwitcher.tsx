import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <button
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className="flex items-center justify-center rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] p-2.5 text-[var(--text-muted)] shadow-sm transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
      aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
    >
      {isDark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
