import { LayoutDashboard, CheckSquare, FolderKanban, CalendarDays, GanttChart, Target, Dumbbell, Zap, X, GraduationCap, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
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
  desktopCollapsed?: boolean;
  onToggleDesktopCollapse?: () => void;
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

export function Sidebar({
  currentView,
  onViewChange,
  isOpen,
  onClose,
  userEmail,
  userName,
  avatarUrl,
  canvasConnected,
  onCanvasClick,
  onProfileClick,
  desktopCollapsed = true,
  onToggleDesktopCollapse,
}: SidebarProps) {
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
              data-walkthrough={`nav-${item.view}`}
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

      {/* Desktop sidebar */}
      <aside className={cn(
        'hidden h-full flex-col overflow-visible border-r border-[var(--border-soft)] bg-[var(--bg-app)] py-3 transition-[width] duration-200 lg:relative lg:z-20 lg:flex',
        desktopCollapsed ? 'w-14 items-center' : 'w-56'
      )}>
        <div className={cn(
          'mb-4 flex items-center',
          desktopCollapsed ? 'w-full flex-col gap-2 px-0' : 'px-3'
        )}>
          <div className={cn(
            'flex items-center',
            desktopCollapsed ? 'h-9 w-9 justify-center' : 'gap-2'
          )}>
            <Zap size={20} className="text-[var(--accent)]" />
            {!desktopCollapsed && (
              <span className="text-sm font-semibold text-[var(--text-primary)]">TaskFlow</span>
            )}
          </div>
        </div>

        {/* Nav */}
        <nav className={cn(
          'flex flex-1 gap-1',
          desktopCollapsed ? 'flex-col items-center' : 'flex-col px-2'
        )}>
          <button
            type="button"
            onClick={onToggleDesktopCollapse}
            className={cn(
              'group relative rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)]',
              desktopCollapsed ? 'mb-1 flex h-10 w-10 items-center justify-center' : 'mb-1 flex h-10 w-full items-center gap-3 px-3'
            )}
            aria-label={desktopCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {desktopCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            {!desktopCollapsed && <span className="text-sm font-medium">Collapse</span>}
            {desktopCollapsed && (
              <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 whitespace-nowrap rounded-md border border-[var(--border-soft)] bg-[var(--surface-elevated)] px-2.5 py-1 text-xs font-medium text-[var(--text-primary)] opacity-0 shadow-sm transition duration-100 group-hover:opacity-100">
                Expand sidebar
              </span>
            )}
          </button>

          {navItems.map(item => (
            <button
              key={item.view}
              onClick={() => onViewChange(item.view)}
              data-walkthrough={`nav-${item.view}`}
              className={cn(
                'group relative rounded-lg transition-colors',
                desktopCollapsed ? 'flex h-10 w-10 items-center justify-center' : 'flex h-10 w-full items-center gap-3 px-3',
                currentView === item.view
                  ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                  : 'text-[var(--text-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)]'
              )}
              aria-label={item.label}
            >
              {currentView === item.view && (
                <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-[var(--accent)]" />
              )}
              {item.icon}
              {!desktopCollapsed && (
                <span className="truncate text-sm font-medium">{item.label}</span>
              )}
              {desktopCollapsed && (
                <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 whitespace-nowrap rounded-md border border-[var(--border-soft)] bg-[var(--surface-elevated)] px-2.5 py-1 text-xs font-medium text-[var(--text-primary)] opacity-0 shadow-sm transition duration-100 group-hover:opacity-100">
                  {item.label}
                </span>
              )}
            </button>
          ))}
        </nav>

        {/* Bottom icons */}
        <div className={cn(
          'flex gap-1',
          desktopCollapsed ? 'flex-col items-center' : 'flex-col px-2'
        )}>
          <button
            onClick={onCanvasClick}
            className="group relative flex h-10 w-10 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)]"
            aria-label="Canvas"
          >
            <GraduationCap size={20} />
            {canvasConnected && (
              <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-emerald-400" />
            )}
            {!desktopCollapsed && (
              <span className="absolute left-12 text-sm font-medium">Canvas</span>
            )}
            {desktopCollapsed && (
              <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 whitespace-nowrap rounded-md border border-[var(--border-soft)] bg-[var(--surface-elevated)] px-2.5 py-1 text-xs font-medium text-[var(--text-primary)] opacity-0 shadow-sm transition duration-100 group-hover:opacity-100">
                Canvas
              </span>
            )}
          </button>

          <button
            onClick={onProfileClick}
            className={cn(
              'group relative mt-1 flex items-center overflow-hidden transition-opacity hover:opacity-80',
              desktopCollapsed ? 'h-9 w-9 justify-center rounded-full' : 'h-10 w-full gap-3 rounded-lg px-3 hover:bg-[var(--surface-muted)]'
            )}
            aria-label={displayName}
          >
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className={cn(
                'object-cover',
                desktopCollapsed ? 'h-full w-full rounded-full' : 'h-8 w-8 rounded-full'
              )} />
            ) : (
              <div className={cn(
                'flex items-center justify-center rounded-full bg-[var(--accent)] text-xs font-bold text-white',
                desktopCollapsed ? 'h-full w-full' : 'h-8 w-8'
              )}>
                {avatarInitial}
              </div>
            )}
            {!desktopCollapsed && (
              <div className="min-w-0 flex-1 text-left">
                <p className="truncate text-sm font-medium text-[var(--text-primary)]">{displayName}</p>
                {userEmail && <p className="truncate text-xs text-[var(--text-faint)]">{userEmail}</p>}
              </div>
            )}
            {desktopCollapsed && (
              <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 whitespace-nowrap rounded-md border border-[var(--border-soft)] bg-[var(--surface-elevated)] px-2.5 py-1 text-xs font-medium text-[var(--text-primary)] opacity-0 shadow-sm transition duration-100 group-hover:opacity-100">
                {displayName}
              </span>
            )}
          </button>
        </div>
      </aside>
    </>
  );
}
