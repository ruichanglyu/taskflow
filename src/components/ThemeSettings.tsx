import { X, Check } from 'lucide-react';
import { useTheme, THEME_PRESETS, FONT_OPTIONS, type ThemeId, type FontId } from '../hooks/useTheme';
import { cn } from '../utils/cn';

interface ThemeSettingsProps {
  open: boolean;
  onClose: () => void;
}

// Each preset gets a pair of colors for the swatch (gradient pill)
const SWATCH_COLORS: Record<string, [string, string]> = {
  dark: ['#1e293b', '#38bdf8'],
  light: ['#e2e8f0', '#0284c7'],
  matcha: ['#d4e4c8', '#7a9e65'],
  sakura: ['#f8d7e8', '#d4829e'],
  cloud: ['#d0e2ff', '#6a9fd8'],
  lavender: ['#e0d4f0', '#9b7ec8'],
};

export function ThemeSettings({ open, onClose }: ThemeSettingsProps) {
  const { theme, font, fontSize, setTheme, setFont, setFontSize } = useTheme();

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-[90] bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed right-0 top-0 z-[91] flex h-full w-80 flex-col border-l border-[var(--border-soft)] bg-[var(--surface-elevated)] shadow-2xl sm:w-96">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-soft)] px-5 py-4">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">Appearance</h2>
          <button onClick={onClose} className="rounded-xl p-1.5 text-[var(--text-muted)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)]">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-8 overflow-y-auto px-5 py-6">
          {/* Theme Presets */}
          <div>
            <label className="mb-3 block text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--text-faint)]">Theme</label>
            <div className="grid grid-cols-3 gap-3">
              {THEME_PRESETS.map(preset => {
                const colors = SWATCH_COLORS[preset.id] ?? [preset.swatch, preset.swatch];
                const isActive = theme === preset.id;
                return (
                  <button
                    key={preset.id}
                    onClick={() => setTheme(preset.id as ThemeId)}
                    className={cn(
                      'group flex flex-col items-center gap-2.5 rounded-2xl border-2 px-2 py-3.5 transition-all',
                      isActive
                        ? 'border-[var(--accent)] shadow-lg'
                        : 'border-transparent hover:border-[var(--border-strong)]'
                    )}
                    style={isActive ? { boxShadow: `0 0 20px ${colors[1]}33` } : undefined}
                  >
                    {/* Color pill */}
                    <div
                      className="relative h-12 w-12 overflow-hidden rounded-2xl ring-2 ring-white/20"
                      style={{ background: `linear-gradient(135deg, ${colors[0]} 0%, ${colors[1]} 100%)` }}
                    >
                      {isActive && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                          <Check size={16} className="text-white drop-shadow" />
                        </div>
                      )}
                    </div>
                    <span className={cn(
                      'text-xs font-medium',
                      isActive ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'
                    )}>
                      {preset.label}
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
                  <span
                    className="text-xs text-[var(--text-faint)]"
                    style={{ fontFamily: opt.family }}
                  >
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
