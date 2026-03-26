import { X, Check, Sun, Moon } from 'lucide-react';
import { useTheme, PALETTE_OPTIONS, FONT_OPTIONS, type PaletteId, type FontId } from '../hooks/useTheme';
import { cn } from '../utils/cn';

const SWATCH_COLORS: Record<string, [string, string]> = {
  neutral: ['#94a3b8', '#38bdf8'],
  matcha: ['#d4e4c8', '#7a9e65'],
  sakura: ['#f8d7e8', '#d4829e'],
  cloud: ['#d0e2ff', '#6a9fd8'],
  lavender: ['#e0d4f0', '#9b7ec8'],
};

interface ThemeSettingsProps {
  open: boolean;
  onClose: () => void;
}

export function ThemeSettings({ open, onClose }: ThemeSettingsProps) {
  const { palette, mode, font, fontSize, setPalette, setMode, setFont, setFontSize } = useTheme();

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-[90] bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 z-[91] flex w-full max-w-md flex-col border-l border-[var(--border-soft)] bg-[var(--surface-elevated)] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-soft)] px-6 py-5">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">Appearance</h2>
          <button onClick={onClose} className="rounded-xl p-1.5 text-[var(--text-muted)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)]">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-8 overflow-y-auto px-6 py-6">
          {/* Dark / Light toggle */}
          <div>
            <label className="mb-3 block text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--text-faint)]">Mode</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setMode('light')}
                className={cn(
                  'flex items-center justify-center gap-2 rounded-2xl border-2 px-4 py-3 text-sm font-medium transition-all',
                  mode === 'light'
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--text-primary)]'
                    : 'border-[var(--border-soft)] text-[var(--text-muted)] hover:border-[var(--border-strong)]'
                )}
              >
                <Sun size={16} />
                Light
              </button>
              <button
                onClick={() => setMode('dark')}
                className={cn(
                  'flex items-center justify-center gap-2 rounded-2xl border-2 px-4 py-3 text-sm font-medium transition-all',
                  mode === 'dark'
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--text-primary)]'
                    : 'border-[var(--border-soft)] text-[var(--text-muted)] hover:border-[var(--border-strong)]'
                )}
              >
                <Moon size={16} />
                Dark
              </button>
            </div>
          </div>

          {/* Palette */}
          <div>
            <label className="mb-3 block text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--text-faint)]">Color Palette</label>
            <div className="grid grid-cols-5 gap-2">
              {PALETTE_OPTIONS.map(opt => {
                const colors = SWATCH_COLORS[opt.id] ?? opt.colors;
                const isActive = palette === opt.id;
                return (
                  <button
                    key={opt.id}
                    onClick={() => setPalette(opt.id as PaletteId)}
                    className={cn(
                      'flex flex-col items-center gap-2 rounded-2xl border-2 px-1 py-3 transition-all',
                      isActive
                        ? 'border-[var(--accent)]'
                        : 'border-transparent hover:border-[var(--border-strong)]'
                    )}
                  >
                    <div
                      className="relative h-10 w-10 overflow-hidden rounded-xl ring-1 ring-black/10"
                      style={{ background: `linear-gradient(135deg, ${colors[0]} 0%, ${colors[1]} 100%)` }}
                    >
                      {isActive && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                          <Check size={14} className="text-white drop-shadow" />
                        </div>
                      )}
                    </div>
                    <span className={cn(
                      'text-[10px] font-medium',
                      isActive ? 'text-[var(--text-primary)]' : 'text-[var(--text-faint)]'
                    )}>
                      {opt.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Font */}
          <div>
            <label className="mb-3 block text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--text-faint)]">Font</label>
            <div className="space-y-1.5">
              {FONT_OPTIONS.map(opt => (
                <button
                  key={opt.id}
                  onClick={() => setFont(opt.id as FontId)}
                  className={cn(
                    'flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition-all',
                    font === opt.id
                      ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                      : 'border-[var(--border-soft)] hover:border-[var(--border-strong)]'
                  )}
                >
                  <span
                    className={cn(
                      'text-sm',
                      font === opt.id ? 'font-medium text-[var(--accent)]' : 'text-[var(--text-secondary)]'
                    )}
                    style={{ fontFamily: opt.family }}
                  >
                    {opt.label}
                  </span>
                  <span className="text-xs text-[var(--text-faint)]" style={{ fontFamily: opt.family }}>
                    Aa Bb 123
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Font Size */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <label className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--text-faint)]">Size</label>
              <span className="text-xs font-medium text-[var(--text-muted)]">{fontSize}px</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[11px] text-[var(--text-faint)]">A</span>
              <input
                type="range"
                min={13}
                max={18}
                step={1}
                value={fontSize}
                onChange={e => setFontSize(Number(e.target.value))}
                className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-[var(--border-soft)] accent-[var(--accent)] [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--accent)] [&::-webkit-slider-thumb]:shadow-md"
              />
              <span className="text-base text-[var(--text-faint)]">A</span>
            </div>
          </div>

          {/* Preview */}
          <div>
            <label className="mb-3 block text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--text-faint)]">Preview</label>
            <div className="rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] p-4">
              <div className="mb-2 text-sm font-semibold text-[var(--text-primary)]">How it looks</div>
              <p className="text-sm text-[var(--text-secondary)]">
                This is how your text and surfaces will appear across the app.
              </p>
              <div className="mt-3 flex gap-2">
                <span className="rounded-full px-2.5 py-1 text-[10px] font-medium" style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}>Accent</span>
                <span className="rounded-full border border-[var(--border-soft)] bg-[var(--surface-muted)] px-2.5 py-1 text-[10px] font-medium text-[var(--text-muted)]">Muted</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
