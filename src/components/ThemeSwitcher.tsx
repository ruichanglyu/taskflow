import { Palette, Sun, Moon, Monitor, Check } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { useTheme, PALETTE_OPTIONS, FONT_OPTIONS, type PaletteId, type ModeId, type FontId } from '../hooks/useTheme';
import { cn } from '../utils/cn';

const SWATCH_COLORS: Record<string, [string, string]> = {
  neutral: ['#94a3b8', '#38bdf8'],
  matcha: ['#d4e4c8', '#7a9e65'],
  sakura: ['#f8d7e8', '#d4829e'],
  lavender: ['#e0d4f0', '#9b7ec8'],
  ember: ['#ffd8bf', '#f97316'],
  honey: ['#fdf0d5', '#eab308'],
  mocha: ['#e8d8c8', '#8d6444'],
};

const MODE_OPTIONS: { id: ModeId; label: string; icon: React.ReactNode }[] = [
  { id: 'light', label: 'Light', icon: <Sun size={16} /> },
  { id: 'dark', label: 'Dark', icon: <Moon size={16} /> },
  { id: 'system', label: 'System', icon: <Monitor size={16} /> },
];

const PAGE_ZOOM_LABELS: Record<number, string> = {
  13: '90%',
  14: '100%',
  15: '110%',
  16: '115%',
  17: '120%',
  18: '125%',
};

export function ThemeSwitcher() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { palette, mode, font, fontSize, setPalette, setMode, setFont, setFontSize } = useTheme();

  // Click outside to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Escape to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(prev => !prev)}
        className={cn(
          'flex items-center justify-center rounded-lg p-2 text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)]',
          open && 'bg-[var(--surface-muted)] text-[var(--text-primary)]'
        )}
        aria-label="Appearance settings"
        title="Appearance"
      >
        <Palette size={16} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 w-72 rounded-lg border border-[var(--border-soft)] bg-[var(--surface-elevated)] shadow-lg">
          {/* Mode */}
          <div className="p-3 pb-2">
            <div className="grid grid-cols-3 gap-1.5">
              {MODE_OPTIONS.map(opt => (
                <button
                  key={opt.id}
                  onClick={() => setMode(opt.id)}
                  className={cn(
                    'flex flex-col items-center gap-1.5 rounded-lg px-2 py-2.5 text-xs font-medium transition-colors',
                    mode === opt.id
                      ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                      : 'text-[var(--text-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)]'
                  )}
                >
                  {/* Mini preview */}
                  <div
                    className={cn(
                      'flex h-10 w-full items-end rounded border overflow-hidden',
                      mode === opt.id ? 'border-[var(--accent)]' : 'border-[var(--border-soft)]'
                    )}
                  >
                    <div className={cn(
                      'h-full w-full',
                      opt.id === 'light' ? 'bg-white' : opt.id === 'dark' ? 'bg-zinc-900' : 'bg-gradient-to-r from-white to-zinc-900'
                    )}>
                      <div className={cn(
                        'mx-1 mt-1.5 h-1 w-3 rounded-full',
                        opt.id === 'light' ? 'bg-zinc-300' : opt.id === 'dark' ? 'bg-zinc-700' : 'bg-zinc-400'
                      )} />
                      <div className={cn(
                        'mx-1 mt-1 h-1 w-5 rounded-full',
                        opt.id === 'light' ? 'bg-zinc-200' : opt.id === 'dark' ? 'bg-zinc-800' : 'bg-zinc-500'
                      )} />
                    </div>
                  </div>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="border-t border-[var(--border-soft)]" />

          {/* Colors */}
          <div className="p-3">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-[var(--text-faint)]">Colors</div>
            <div className="flex flex-wrap gap-2">
              {PALETTE_OPTIONS.map(opt => {
                const colors = SWATCH_COLORS[opt.id] ?? opt.colors;
                const isActive = palette === opt.id;
                return (
                  <button
                    key={opt.id}
                    onClick={() => setPalette(opt.id as PaletteId)}
                    className="group relative"
                    title={opt.label}
                  >
                    <div
                      className={cn(
                        'h-7 w-7 rounded-full ring-2 ring-offset-2 ring-offset-[var(--surface-elevated)] transition-all',
                        isActive ? 'ring-[var(--accent)]' : 'ring-transparent hover:ring-[var(--border-strong)]'
                      )}
                      style={{ background: `linear-gradient(135deg, ${colors[0]} 0%, ${colors[1]} 100%)` }}
                    >
                      {isActive && (
                        <div className="flex h-full w-full items-center justify-center">
                          <Check size={12} className="text-white drop-shadow" />
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="border-t border-[var(--border-soft)]" />

          {/* Page zoom + Font */}
          <div className="p-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-faint)]">Page zoom</span>
              <span className="text-xs text-[var(--text-muted)]">{PAGE_ZOOM_LABELS[fontSize] ?? `${fontSize}px`}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-[var(--text-faint)]">A</span>
              <input
                type="range"
                min={13}
                max={18}
                step={1}
                value={fontSize}
                onChange={e => setFontSize(Number(e.target.value))}
                className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-[var(--border-soft)] accent-[var(--accent)] [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--accent)]"
              />
              <span className="text-sm text-[var(--text-faint)]">A</span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-faint)]">Font</span>
              <select
                value={font}
                onChange={e => setFont(e.target.value as FontId)}
                className="rounded border border-[var(--border-soft)] bg-[var(--surface)] px-2 py-1 text-xs text-[var(--text-secondary)] outline-none"
              >
                {FONT_OPTIONS.map(opt => (
                  <option key={opt.id} value={opt.id}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
