import { useState } from 'react';
import { X, RefreshCw, Unplug, ExternalLink, Check, AlertCircle } from 'lucide-react';
import { CanvasConnection } from '../types';
import { SyncResult } from '../hooks/useCanvas';
import { cn } from '../utils/cn';

interface CanvasConnectProps {
  connection: CanvasConnection | null;
  isSyncing: boolean;
  error: string | null;
  lastSyncResult: SyncResult | null;
  onConnect: (baseUrl: string, apiToken: string) => Promise<boolean>;
  onDisconnect: () => void;
  onSync: () => void;
  onClose: () => void;
  onClearError: () => void;
}

export function CanvasConnect({
  connection,
  isSyncing,
  error,
  lastSyncResult,
  onConnect,
  onDisconnect,
  onSync,
  onClose,
  onClearError,
}: CanvasConnectProps) {
  const [baseUrl, setBaseUrl] = useState('');
  const [apiToken, setApiToken] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!baseUrl.trim() || !apiToken.trim()) return;
    setIsConnecting(true);
    const ok = await onConnect(baseUrl.trim(), apiToken.trim());
    setIsConnecting(false);
    if (ok) {
      setBaseUrl('');
      setApiToken('');
    }
  };

  const handleDisconnect = () => {
    if (confirm('Disconnect Canvas? Imported deadlines will remain but won\'t sync anymore.')) {
      onDisconnect();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl border border-[var(--border-soft)] bg-[var(--surface-elevated)] shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[var(--border-soft)] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-500/15">
              <span className="text-base">🎓</span>
            </div>
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">Canvas LMS</h2>
          </div>
          <button onClick={onClose} className="text-[var(--text-faint)] transition-colors hover:text-[var(--text-primary)]">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Error banner */}
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-400">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <p className="flex-1">{error}</p>
              <button onClick={onClearError} className="text-red-400/60 hover:text-red-400">
                <X size={14} />
              </button>
            </div>
          )}

          {connection ? (
            <>
              {/* Connected state */}
              <div className="rounded-lg border border-emerald-400/20 bg-emerald-400/10 p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-emerald-400">
                  <Check size={16} />
                  Connected to Canvas
                </div>
                <p className="mt-1.5 text-xs text-[var(--text-muted)]">{connection.baseUrl}</p>
                {connection.lastSyncedAt && (
                  <p className="mt-1 text-xs text-[var(--text-faint)]">
                    Last synced: {new Date(connection.lastSyncedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </p>
                )}
              </div>

              {/* Sync result */}
              {lastSyncResult && (
                <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface-muted)] p-4 space-y-2">
                  <p className="text-xs font-medium text-[var(--text-secondary)]">Last sync results</p>
                  <div className="grid grid-cols-2 gap-2 text-xs text-[var(--text-muted)]">
                    <span>Courses matched: {lastSyncResult.coursesMatched}</span>
                    <span>Courses created: {lastSyncResult.coursesCreated}</span>
                    <span>Deadlines created: {lastSyncResult.deadlinesCreated}</span>
                    <span>Deadlines updated: {lastSyncResult.deadlinesUpdated}</span>
                  </div>
                  {lastSyncResult.errors.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {lastSyncResult.errors.map((err, i) => (
                        <p key={i} className="text-[10px] text-red-400">{err}</p>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3">
                <button
                  onClick={onSync}
                  disabled={isSyncing}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium text-[var(--accent-contrast)] transition-colors disabled:opacity-50"
                  style={{ backgroundColor: 'var(--accent-strong)' }}
                >
                  <RefreshCw size={15} className={cn(isSyncing && 'animate-spin')} />
                  {isSyncing ? 'Syncing...' : 'Sync Now'}
                </button>
                <button
                  onClick={handleDisconnect}
                  className="flex items-center gap-2 rounded-lg border border-[var(--border-soft)] px-4 py-2.5 text-sm font-medium text-red-400 transition hover:bg-red-400/10"
                >
                  <Unplug size={15} />
                  Disconnect
                </button>
              </div>
            </>
          ) : (
            <>
              {/* Connection form */}
              <div className="space-y-2">
                <p className="text-sm text-[var(--text-muted)]">
                  Connect your Canvas LMS to automatically import courses, assignments, and quizzes as deadlines.
                </p>
                <p className="text-xs text-[var(--text-faint)]">
                  You'll need your Canvas URL and a personal access token.
                  <a
                    href="https://community.canvaslms.com/t5/Student-Guide/How-do-I-manage-API-access-tokens-as-a-student/ta-p/273"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-1 inline-flex items-center gap-0.5 text-[var(--accent)] hover:underline"
                  >
                    How to get a token <ExternalLink size={10} />
                  </a>
                </p>
              </div>

              <form onSubmit={handleConnect} className="space-y-3">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">Canvas URL</label>
                  <input
                    type="url"
                    value={baseUrl}
                    onChange={e => setBaseUrl(e.target.value)}
                    placeholder="https://canvas.yourschool.edu"
                    required
                    className="w-full rounded-lg border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">Access Token</label>
                  <input
                    type="password"
                    value={apiToken}
                    onChange={e => setApiToken(e.target.value)}
                    placeholder="Paste your Canvas access token"
                    required
                    className="w-full rounded-lg border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
                  />
                </div>
                <div className="flex gap-3 pt-1">
                  <button
                    type="button"
                    onClick={onClose}
                    className="flex-1 rounded-lg border border-[var(--border-soft)] py-2.5 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-muted)]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!baseUrl.trim() || !apiToken.trim() || isConnecting}
                    className="flex flex-1 items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium text-[var(--accent-contrast)] transition-colors disabled:opacity-40"
                    style={{ backgroundColor: 'var(--accent-strong)' }}
                  >
                    {isConnecting ? 'Connecting...' : 'Connect'}
                  </button>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
