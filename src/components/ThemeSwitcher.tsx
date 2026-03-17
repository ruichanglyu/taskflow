import { Palette } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';

export function ThemeSwitcher() {
  const { theme, setTheme, themes } = useTheme();

  return (
    <label className="flex items-center gap-2 rounded-full border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-2 text-xs text-[var(--text-muted)]">
      <Palette size={14} className="text-[var(--accent)]" />
      <span className="hidden sm:inline">Theme</span>
      <select
        value={theme}
        onChange={event => setTheme(event.target.value as typeof theme)}
        className="bg-transparent text-[var(--text-primary)] outline-none"
      >
        {themes.map(item => (
          <option key={item.id} value={item.id} className="bg-[var(--surface-strong)] text-[var(--text-primary)]">
            {item.label}
          </option>
        ))}
      </select>
    </label>
  );
}
