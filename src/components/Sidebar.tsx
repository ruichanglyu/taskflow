import { LayoutDashboard, CheckSquare, FolderKanban, CalendarDays, GanttChart, Target, Zap, X } from 'lucide-react';
import { View } from '../types';
import { cn } from '../utils/cn';

interface SidebarProps {
  currentView: View;
  onViewChange: (view: View) => void;
  isOpen: boolean;
  onClose: () => void;
  userEmail?: string;
  userName?: string;
}

const navItems: { view: View; label: string; icon: React.ReactNode }[] = [
  { view: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={20} /> },
  { view: 'deadlines', label: 'Deadlines', icon: <Target size={20} /> },
  { view: 'tasks', label: 'Tasks', icon: <CheckSquare size={20} /> },
  { view: 'projects', label: 'Projects', icon: <FolderKanban size={20} /> },
  { view: 'calendar', label: 'Calendar', icon: <CalendarDays size={20} /> },
  { view: 'timeline', label: 'Timeline', icon: <GanttChart size={20} /> },
];

export function Sidebar({ currentView, onViewChange, isOpen, onClose, userEmail, userName }: SidebarProps) {
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
          'fixed top-0 left-0 z-50 h-full w-64 border-r border-[var(--border-soft)] bg-[var(--bg-app)] flex flex-col transition-transform duration-300 lg:translate-x-0 lg:static lg:z-auto',
          isOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Logo */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-[var(--border-soft)]">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ backgroundImage: 'var(--sidebar-gradient)' }}>
              <Zap size={18} className="text-white" />
            </div>
            <span className="text-lg font-bold tracking-tight text-[var(--text-primary)]">TaskFlow</span>
          </div>
          <button onClick={onClose} className="lg:hidden text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X size={20} />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map(item => (
            <button
              key={item.view}
              onClick={() => { onViewChange(item.view); onClose(); }}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all',
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

        {/* Footer */}
        <div className="border-t border-[var(--border-soft)] px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white" style={{ backgroundImage: 'var(--avatar-gradient)' }}>
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
