import { useState, useEffect } from 'react';
import { LogOut, Menu, Search } from 'lucide-react';
import { User } from '@supabase/supabase-js';
import { View } from '../types';
import { useStore } from '../hooks/useStore';
import { useDeadlines } from '../hooks/useDeadlines';
import { useNotifications } from '../hooks/useNotifications';
import { Sidebar } from './Sidebar';
import { Dashboard } from './Dashboard';
import { DeadlinesPage } from './DeadlinesPage';
import { TaskBoard } from './TaskBoard';
import { ProjectList } from './ProjectList';
import { CalendarView } from './CalendarView';
import { TimelineView } from './TimelineView';
import { GlobalSearch } from './GlobalSearch';
import { supabase } from '../lib/supabase';
import { ThemeSwitcher } from './ThemeSwitcher';

interface AppShellProps {
  user: User;
}

export function AppShell({ user }: AppShellProps) {
  const [currentView, setCurrentView] = useState<View>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const store = useStore(user.id);
  const deadlineStore = useDeadlines(user.id);
  const { requestPermission } = useNotifications(store.tasks);

  // Request notification permission on first load
  useEffect(() => {
    requestPermission();
  }, [requestPermission]);

  // Global keyboard shortcut: Cmd/Ctrl+K for search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const handleSignOut = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
  };

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--bg-app)] text-[var(--text-primary)]">
      <Sidebar
        currentView={currentView}
        onViewChange={setCurrentView}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        userEmail={user.email}
        userName={user.user_metadata.full_name}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center gap-4 border-b border-[var(--border-soft)] bg-[var(--bg-app-soft)] px-4 py-4 backdrop-blur-sm sm:px-6">
          <button
            onClick={() => setSidebarOpen(true)}
            className="text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)] lg:hidden"
          >
            <Menu size={22} />
          </button>

          {/* Search trigger */}
          <button
            onClick={() => setSearchOpen(true)}
            className="hidden sm:flex items-center gap-2 rounded-lg border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-1.5 text-sm text-[var(--text-faint)] transition hover:border-[var(--border-strong)]"
          >
            <Search size={14} />
            <span>Search...</span>
            <kbd className="ml-4 rounded border border-[var(--border-soft)] bg-[var(--surface)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-faint)]">⌘K</kbd>
          </button>

          <div className="flex-1" />
          <div className="hidden items-center gap-2 rounded-full bg-[var(--surface-muted)] px-3 py-1.5 sm:flex">
            <div className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
            <span className="text-xs text-[var(--text-muted)]">
              {store.tasks.filter(task => task.status !== 'done').length} active tasks
            </span>
          </div>
          <div className="flex items-center gap-3">
            <ThemeSwitcher />
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium text-[var(--text-primary)]">
                {user.user_metadata.full_name || user.email || 'TaskFlow user'}
              </p>
              <p className="text-xs text-[var(--text-faint)]">{user.email}</p>
            </div>
            <button
              onClick={handleSignOut}
              className="flex items-center gap-2 rounded-full border border-[var(--border-soft)] px-3 py-2 text-sm text-[var(--text-secondary)] transition hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
            >
              <LogOut size={16} />
              <span className="hidden sm:inline">Log out</span>
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          {store.error && (
            <div className="mb-6 flex items-start justify-between gap-3 rounded-2xl border border-rose-400/20 bg-rose-400/10 p-4 text-sm text-rose-100">
              <p>{store.error}</p>
              <button
                onClick={store.clearError}
                className="shrink-0 rounded-full border border-rose-300/20 px-2 py-1 text-xs text-rose-100 transition hover:bg-rose-300/10"
              >
                Dismiss
              </button>
            </div>
          )}

          {store.isLoading ? (
            <div className="flex min-h-[50vh] items-center justify-center rounded-3xl border border-[var(--border-soft)] bg-[var(--surface-muted)] text-sm text-[var(--text-muted)]">
              Syncing your workspace...
            </div>
          ) : (
            <>
          {currentView === 'dashboard' && (
            <Dashboard tasks={store.tasks} projects={store.projects} deadlines={deadlineStore.deadlines} />
          )}
          {currentView === 'deadlines' && (
            <DeadlinesPage
              deadlines={deadlineStore.deadlines}
              projects={store.projects}
              tasks={store.tasks}
              onAdd={deadlineStore.addDeadline}
              onUpdate={deadlineStore.updateDeadline}
              onDelete={deadlineStore.deleteDeadline}
              onLinkTask={deadlineStore.linkTask}
              onUnlinkTask={deadlineStore.unlinkTask}
            />
          )}
          {currentView === 'tasks' && (
            <TaskBoard
              tasks={store.tasks}
              projects={store.projects}
              onAddTask={store.addTask}
              onUpdateStatus={store.updateTaskStatus}
              onUpdateTask={store.updateTask}
              onDeleteTask={store.deleteTask}
              onAddSubtask={store.addSubtask}
              onToggleSubtask={store.toggleSubtask}
              onDeleteSubtask={store.deleteSubtask}
              onAddComment={store.addComment}
              onDeleteComment={store.deleteComment}
            />
          )}
          {currentView === 'projects' && (
            <ProjectList
              projects={store.projects}
              tasks={store.tasks}
              onAddProject={store.addProject}
              onDeleteProject={store.deleteProject}
            />
          )}
          {currentView === 'calendar' && (
            <CalendarView userId={user.id} />
          )}
          {currentView === 'timeline' && (
            <TimelineView
              tasks={store.tasks}
              projects={store.projects}
              onUpdateDueDate={store.updateTaskDueDate}
            />
          )}
            </>
          )}
        </main>
      </div>

      {searchOpen && (
        <GlobalSearch
          tasks={store.tasks}
          projects={store.projects}
          deadlines={deadlineStore.deadlines}
          onClose={() => setSearchOpen(false)}
          onNavigate={(view) => { setCurrentView(view); setSearchOpen(false); }}
        />
      )}
    </div>
  );
}
