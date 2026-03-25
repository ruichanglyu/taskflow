import { LayoutDashboard, CheckSquare, FolderKanban, CalendarDays, GanttChart, Target, Dumbbell, Zap, X, GraduationCap } from 'lucide-react';
import { View } from '../types';
import { cn } from '../utils/cn';

interface SidebarProps {
  currentView: View;
  onViewChange: (view: View) => void;
  isOpen: boolean;
  onClose: () => void;
  userEmail?: string;
  userName?: string;
  canvasConnected?: boolean;
  onCanvasClick?: () => void;
}

const navItems: { view: View; label: string; icon: React.ReactNode }[] = [
  { view: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={20} /> },
  { view: 'deadlines', label: 'Deadlines', icon: <Target size={20} /> },
  { view: 'tasks', label: 'Tasks', icon: <CheckSquare size={20} /> },
  { view: 'projects', label: 'Courses', icon: <FolderKanban size={20} /> },
  { view: 'calendar', label: 'Calendar', icon: <CalendarDays size={20} /> },
  { view: 'timeline', label: 'Timeline', icon: <GanttChart size={20} /> },
  { view: 'gym', label: 'Gym', icon: <Dumbbell size={20} /> },
];

export function Sidebar({ currentView, onViewChange, isOpen, onClose, userEmail, userName, canvasConnected, onCanvasClick }: SidebarProps) {
  const displayName = userName || (userEmail ? userEmail.split('@')[0] : 'User');
  const avatarInitial = displayName.charAt(0).toUpperCase();
  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={onClose} />
      )}

      <aside
        className={cn(
          'fixed top-0 left-0 z-50 flex h-full w-72 flex-col border-r border-[var(--border-soft)] bg-[var(--bg-app-soft)] backdrop-blur-xl transition-transform duration-300 lg:translate-x-0 lg:static lg:z-auto',
          isOpen ? 'translate-x-0' : '-translate-x-full'
        )}
        style={{ boxShadow: '24px 0 80px var(--shadow-color)' }}
      >
        {/* Logo */}
        <div className="border-b border-[var(--border-soft)] px-6 py-6">
          <div className="mb-3 flex items-center justify-between">
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border-strong)] bg-[var(--surface-muted)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--text-faint)]">
              Focus OS
            </div>
            <button onClick={onClose} className="lg:hidden text-[var(--text-muted)] hover:text-[var(--text-primary)]">
              <X size={20} />
            </button>
          </div>
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl shadow-lg" style={{ backgroundImage: 'var(--sidebar-gradient)', boxShadow: '0 12px 32px var(--glow-accent)' }}>
              <Zap size={18} className="text-white" />
            </div>
            <div>
              <span className="text-lg font-bold tracking-tight text-[var(--text-primary)]">TaskFlow</span>
              <p className="text-xs text-[var(--text-faint)]">School, schedule, training</p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-1 px-3 py-5">
          {navItems.map(item => (
            <button
              key={item.view}
              onClick={() => { onViewChange(item.view); onClose(); }}
              className={cn(
                'group w-full rounded-2xl px-3 py-3 text-sm font-medium transition-all',
                currentView === item.view
                  ? 'bg-[var(--surface-elevated)] text-[var(--text-primary)] shadow-lg'
                  : 'text-[var(--text-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)]'
              )}
              style={currentView === item.view ? { boxShadow: '0 16px 34px var(--shadow-color)' } : undefined}
            >
              <span className="flex items-center gap-3">
                <span
                  className={cn(
                    'flex h-10 w-10 items-center justify-center rounded-xl border transition-all',
                    currentView === item.view
                      ? 'border-transparent text-[var(--accent-contrast)]'
                      : 'border-[var(--border-soft)] bg-[var(--surface)] text-[var(--text-faint)] group-hover:text-[var(--text-primary)]'
                  )}
                  style={currentView === item.view ? { backgroundImage: 'var(--sidebar-gradient)' } : undefined}
                >
                  {item.icon}
                </span>
                <span className="flex flex-col items-start">
                  <span>{item.label}</span>
                  <span className="text-[11px] font-normal text-[var(--text-faint)]">
                    {item.view === 'dashboard' && 'What matters now'}
                    {item.view === 'deadlines' && 'Due dates and exams'}
                    {item.view === 'tasks' && 'Current execution'}
                    {item.view === 'projects' && 'Course hubs'}
                    {item.view === 'calendar' && 'Time and events'}
                    {item.view === 'timeline' && 'Workload horizon'}
                    {item.view === 'gym' && 'Training and sessions'}
                  </span>
                </span>
              </span>
            </button>
          ))}
        </nav>

        {/* Canvas integration */}
        <div className="px-3 pb-3">
          <button
            onClick={onCanvasClick}
            className="w-full rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] px-3 py-3 text-sm font-medium text-[var(--text-muted)] transition-all hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
          >
            <span className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border-soft)] bg-[var(--surface-muted)]">
                <GraduationCap size={20} />
              </span>
              <span className="flex flex-col items-start">
                <span>Canvas</span>
                <span className="text-[11px] font-normal text-[var(--text-faint)]">Sync classes and deadlines</span>
              </span>
            </span>
            <span className="ml-auto">
              {canvasConnected ? (
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_18px_rgba(52,211,153,0.6)]" title="Connected" />
              ) : (
                <span className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-[9px] text-[var(--text-faint)]">Setup</span>
              )}
            </span>
          </button>
        </div>

        {/* Footer */}
        <div className="border-t border-[var(--border-soft)] px-4 py-4">
          <div className="flex items-center gap-3 rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] px-3 py-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl text-xs font-bold text-white" style={{ backgroundImage: 'var(--avatar-gradient)' }}>
              {avatarInitial}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-[var(--text-primary)] truncate">{displayName}</p>
              {userEmail && <p className="text-xs text-[var(--text-faint)] truncate">{userEmail}</p>}
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
