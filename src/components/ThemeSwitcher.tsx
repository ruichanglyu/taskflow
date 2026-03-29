import { Palette } from 'lucide-react';
import { useState } from 'react';
import { ThemeSettings } from './ThemeSettings';

export function ThemeSwitcher() {
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setSettingsOpen(true)}
        className="flex items-center justify-center rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] p-2.5 text-[var(--text-muted)] shadow-sm transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
        aria-label="Appearance settings"
        title="Appearance"
      >
        <Palette size={16} />
      </button>

      <ThemeSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}
