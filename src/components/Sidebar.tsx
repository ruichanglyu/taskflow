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
  avatarUrl?: string;
  canvasConnected?: boolean;
  onCanvasClick?: () => void;
  onProfileClick?: () => void;
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

export function Sidebar({ currentView, onViewChange, isOpen, onClose, userEmail, userName, avatarUrl, canvasConnected, onCanvasClick, onProfileClick }: SidebarProps) {
  const displayName = userName || (userEmail ? userEmail.split('@')[0] : 'User');
  const avatarInitial = displayName.charAt(0).toUpperCase();
  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div className="fixed inset-0 z-40 bg-black/50" onClick={onClose} />
      )}

      {/* Mobile sidebar — full labels */}
      <aside
        className={cn(
          'fixed top-0 left-0 z-50 flex h-full w-64 flex-col border-r border-[var(--border-soft)] bg-[var(--bg-app)] transition-transform duration-200 lg:hidden',
          isOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex items-center justify-between border-b border-[var(--border-soft)] px-4 py-4">
          <div className="flex items-center gap-2">
            <Zap size={18} className="text-[var(--accent)]" />
            <span className="text-sm font-semibold text-[var(--text-primary)]">TaskFlow</span>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 space-y-0.5 px-2 py-3">
          {navItems.map(item => (
            <button
              key={item.view}
              onClick={() => { onViewChange(item.view); onClose(); }}
              className={cn(
                'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                currentView === item.view
                  ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                  : 'text-[var(--text-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)]'
              )}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>

        <div className="space-y-0.5 border-t border-[var(--border-soft)] px-2 py-3">
          <button
            onClick={() => { onCanvasClick?.(); onClose(); }}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)]"
          >
            <GraduationCap size={20} />
            Canvas
            {canvasConnected && (
              <span className="ml-auto h-2 w-2 rounded-full bg-emerald-400" />
            )}
          </button>
        </div>

        <div className="border-t border-[var(--border-soft)] px-2 py-3">
          <button
            onClick={() => { onProfileClick?.(); onClose(); }}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-[var(--surface-muted)]"
          >
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
            ) : (
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--accent)] text-xs font-bold text-white">
                {avatarInitial}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-[var(--text-primary)]">{displayName}</p>
              {userEmail && <p className="truncate text-xs text-[var(--text-faint)]">{userEmail}</p>}
            </div>
          </button>
        </div>
      </aside>

      {/* Desktop sidebar — icon-only rail */}
      <aside className="hidden lg:flex h-full w-14 flex-col items-center border-r border-[var(--border-soft)] bg-[var(--bg-app)] py-3">
        {/* Logo */}
        <div className="mb-4 flex h-9 w-9 items-center justify-center">
          <Zap size={20} className="text-[var(--accent)]" />
        </div>

        {/* Nav */}
        <nav className="flex flex-1 flex-col items-center gap-1">
          {navItems.map(item => (
            <button
              key={item.view}
              onClick={() => onViewChange(item.view)}
              className={cn(
                'relative flex h-10 w-10 items-center justify-center rounded-lg transition-colors',
                currentView === item.view
                  ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                  : 'text-[var(--text-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)]'
              )}
              title={item.label}
            >
              {currentView === item.view && (
                <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-[var(--accent)]" />
              )}
              {item.icon}
            </button>
          ))}
        </nav>

        {/* Bottom icons */}
        <div className="flex flex-col items-center gap-1">
          <button
            onClick={onCanvasClick}
            className="relative flex h-10 w-10 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)]"
            title="Canvas"
          >
            <GraduationCap size={20} />
            {canvasConnected && (
              <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-emerald-400" />
            )}
          </button>

          <button
            onClick={onProfileClick}
            className="mt-1 flex h-9 w-9 items-center justify-center overflow-hidden rounded-full transition-opacity hover:opacity-80"
            title={displayName}
          >
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className="h-full w-full rounded-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center rounded-full bg-[var(--accent)] text-xs font-bold text-white">
                {avatarInitial}
              </div>
            )}
          </button>
        </div>
      </aside>
    </>
  );
}
