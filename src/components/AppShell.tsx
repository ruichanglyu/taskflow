import { useState, useEffect, useCallback } from 'react';
import { LogOut, Menu, Search, CheckCircle2, AlertCircle, X } from 'lucide-react';
import { User } from '@supabase/supabase-js';
import { useLocation, useNavigate } from 'react-router-dom';
import { View } from '../types';
import { useStore } from '../hooks/useStore';
import { useDeadlines } from '../hooks/useDeadlines';
import { useCanvas } from '../hooks/useCanvas';
import { useNotifications } from '../hooks/useNotifications';
import { Sidebar } from './Sidebar';
import { Dashboard } from './Dashboard';
import { DeadlinesPage } from './DeadlinesPage';
import { TaskBoard } from './TaskBoard';
import { ProjectList } from './ProjectList';
import { CalendarView } from './CalendarView';
import { TimelineView } from './TimelineView';
import { GlobalSearch } from './GlobalSearch';
import { CanvasConnect } from './CanvasConnect';
import { GymPage } from './GymPage';
import { useGym } from '../hooks/useGym';
import { supabase } from '../lib/supabase';
import { ThemeSwitcher } from './ThemeSwitcher';
import { ProfileModal } from './ProfileModal';

interface AppShellProps {
  user: User;
}

type ToastTone = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  message?: string;
}

const VIEW_PATHS: Record<View, string> = {
  dashboard: '/dashboard',
  deadlines: '/deadlines',
  tasks: '/tasks',
  projects: '/courses',
  calendar: '/calendar',
  timeline: '/timeline',
  gym: '/gym',
};

function getViewFromPath(pathname: string): View {
  if (pathname === '/deadlines') return 'deadlines';
  if (pathname === '/tasks') return 'tasks';
  if (pathname === '/courses') return 'projects';
  if (pathname === '/calendar') return 'calendar';
  if (pathname === '/timeline') return 'timeline';
  if (pathname === '/gym') return 'gym';
  return 'dashboard';
}

export function AppShell({ user }: AppShellProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const currentView = getViewFromPath(location.pathname);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const store = useStore(user.id);
  const deadlineStore = useDeadlines(user.id);
  const canvasStore = useCanvas(user.id, store.projects);
  const gym = useGym(user.id);
  const { requestPermission } = useNotifications(store.tasks);
  const searchParams = new URLSearchParams(location.search);
  const projectFocusId = searchParams.get('project');
  const deadlineCourseFilterId = searchParams.get('course');
  const deadlineFocusId = searchParams.get('deadline');
  const taskProjectFilterId = searchParams.get('project') ?? 'all';

  const pushToast = useCallback((tone: ToastTone, title: string, message?: string) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts(prev => [...prev, { id, tone, title, message }]);
    window.setTimeout(() => {
      setToasts(prev => prev.filter(toast => toast.id !== id));
    }, 4200);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(toast => toast.id !== id));
  }, []);

  // After Canvas sync, reload deadlines + projects
  const handleCanvasSync = async () => {
    const result = await canvasStore.sync();
    if (result) {
      await Promise.all([deadlineStore.loadDeadlines(), store.loadData()]);
      pushToast('success', 'Canvas sync complete', 'Courses and deadlines were refreshed.');
    } else {
      pushToast('error', 'Canvas sync failed', canvasStore.error ?? 'Please check your Canvas connection and try again.');
    }
  };

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

  // Force refresh user session after profile updates
  const handleUserUpdated = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.refreshSession();
  }, []);

  const handleViewChange = useCallback((view: View) => {
    navigate(VIEW_PATHS[view]);
  }, [navigate]);

  const openCourse = useCallback((projectId: string) => {
    navigate(`/courses?project=${encodeURIComponent(projectId)}`);
  }, [navigate]);

  const openCourseTasks = useCallback((projectId: string) => {
    navigate(`/tasks?project=${encodeURIComponent(projectId)}`);
  }, [navigate]);

  const openCourseDeadlines = useCallback((projectId: string) => {
    navigate(`/deadlines?course=${encodeURIComponent(projectId)}`);
  }, [navigate]);

  const openDeadline = useCallback((deadlineId: string) => {
    const deadline = deadlineStore.deadlines.find(item => item.id === deadlineId);
    const params = new URLSearchParams();
    params.set('deadline', deadlineId);
    if (deadline?.projectId) params.set('course', deadline.projectId);
    navigate(`/deadlines?${params.toString()}`);
  }, [deadlineStore.deadlines, navigate]);

  useEffect(() => {
    if (location.pathname === '/') {
      navigate('/dashboard', { replace: true });
      return;
    }

    if (!Object.values(VIEW_PATHS).includes(location.pathname as View extends never ? never : string)) {
      navigate('/dashboard', { replace: true });
    }
  }, [location.pathname, navigate]);

  const handleAddDeadline = useCallback(async (...args: Parameters<typeof deadlineStore.addDeadline>) => {
    const ok = await deadlineStore.addDeadline(...args);
    if (ok) {
      pushToast('success', 'Deadline added', 'Your deadline was added to the tracker.');
    } else {
      pushToast('error', 'Could not add deadline', deadlineStore.error ?? 'Please try again.');
    }
    return ok;
  }, [deadlineStore, pushToast]);

  const handleUpdateDeadline = useCallback(async (...args: Parameters<typeof deadlineStore.updateDeadline>) => {
    const ok = await deadlineStore.updateDeadline(...args);
    if (ok) {
      pushToast('success', 'Deadline updated');
    } else {
      pushToast('error', 'Could not update deadline', deadlineStore.error ?? 'Please try again.');
    }
    return ok;
  }, [deadlineStore, pushToast]);

  const handleDeleteDeadline = useCallback(async (id: string) => {
    await deadlineStore.deleteDeadline(id);
    if (!deadlineStore.error) {
      pushToast('success', 'Deadline deleted');
    } else {
      pushToast('error', 'Could not delete deadline', deadlineStore.error);
    }
  }, [deadlineStore, pushToast]);

  const handleDeleteAllDeadlines = useCallback(async () => {
    const ok = await deadlineStore.deleteAllDeadlines();
    if (ok) {
      pushToast('success', 'All deadlines deleted');
    } else {
      pushToast('error', 'Could not delete deadlines', deadlineStore.error ?? 'Please try again.');
    }
    return ok;
  }, [deadlineStore, pushToast]);

  const handleLinkTask = useCallback(async (...args: Parameters<typeof deadlineStore.linkTask>) => {
    const ok = await deadlineStore.linkTask(...args);
    if (ok) {
      pushToast('success', 'Task linked', 'This deadline is now connected to a task.');
    } else {
      pushToast('error', 'Could not link task', deadlineStore.error ?? 'Please try again.');
    }
    return ok;
  }, [deadlineStore, pushToast]);

  const handleUnlinkTask = useCallback(async (...args: Parameters<typeof deadlineStore.unlinkTask>) => {
    await deadlineStore.unlinkTask(...args);
    if (!deadlineStore.error) {
      pushToast('info', 'Task unlinked');
    } else {
      pushToast('error', 'Could not unlink task', deadlineStore.error);
    }
  }, [deadlineStore, pushToast]);

  const handleAddTask = useCallback(async (...args: Parameters<typeof store.addTask>) => {
    const taskId = await store.addTask(...args);
    if (taskId) {
      pushToast('success', 'Task created');
    } else {
      pushToast('error', 'Could not create task', store.error ?? 'Please try again.');
    }
    return taskId;
  }, [store, pushToast]);

  const handleUpdateTask = useCallback(async (...args: Parameters<typeof store.updateTask>) => {
    const ok = await store.updateTask(...args);
    if (ok) {
      pushToast('success', 'Task updated');
    } else {
      pushToast('error', 'Could not update task', store.error ?? 'Please try again.');
    }
    return ok;
  }, [store, pushToast]);

  const handleDeleteTask = useCallback(async (id: string) => {
    await store.deleteTask(id);
    if (!store.error) {
      pushToast('success', 'Task deleted');
    } else {
      pushToast('error', 'Could not delete task', store.error);
    }
  }, [store, pushToast]);

  const handleAddProject = useCallback(async (...args: Parameters<typeof store.addProject>) => {
    const projectId = await store.addProject(...args);
    if (projectId) {
      pushToast('success', 'Course created');
    } else {
      pushToast('error', 'Could not create course', store.error ?? 'Please try again.');
    }
    return projectId;
  }, [store, pushToast]);

  const handleDeleteProject = useCallback(async (id: string) => {
    await store.deleteProject(id);
    if (!store.error) {
      pushToast('success', 'Course deleted');
    } else {
      pushToast('error', 'Could not delete course', store.error);
    }
  }, [store, pushToast]);

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--bg-app)] text-[var(--text-primary)]">
      <Sidebar
        currentView={currentView}
        onViewChange={handleViewChange}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        userEmail={user.email}
        userName={user.user_metadata.full_name}
        avatarUrl={user.user_metadata.avatar_url}
        canvasConnected={!!canvasStore.connection}
        onCanvasClick={() => { setSidebarOpen(false); setCanvasOpen(true); }}
        onProfileClick={() => { setSidebarOpen(false); setProfileOpen(true); }}
      />

      <div className="relative flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center gap-4 border-b border-[var(--border-soft)] bg-[var(--bg-app-soft)] px-4 py-4 backdrop-blur-xl sm:px-6">
          <button
            onClick={() => setSidebarOpen(true)}
            className="rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] p-2 text-[var(--text-muted)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] lg:hidden"
          >
            <Menu size={22} />
          </button>

          {/* Search trigger */}
          <button
            onClick={() => setSearchOpen(true)}
            className="hidden items-center gap-2 rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-faint)] shadow-sm transition hover:border-[var(--border-strong)] sm:flex"
          >
            <Search size={14} />
            <span>Search...</span>
            <kbd className="ml-4 rounded-xl border border-[var(--border-soft)] bg-[var(--surface-muted)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-faint)]">⌘K</kbd>
          </button>

          <div className="flex-1" />
          <div className="hidden items-center gap-2 rounded-full border border-[var(--border-soft)] bg-[var(--surface)] px-3 py-1.5 shadow-sm sm:flex">
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
              className="flex items-center gap-2 rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-secondary)] shadow-sm transition hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
            >
              <LogOut size={16} />
              <span className="hidden sm:inline">Log out</span>
            </button>
          </div>
        </header>

        <main className="relative flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          {(store.error || deadlineStore.error || canvasStore.error) && (
            <div className="mb-6 flex items-start justify-between gap-3 rounded-2xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-white/90">
              <p>{store.error || deadlineStore.error || canvasStore.error}</p>
              <button
                onClick={() => { store.clearError(); deadlineStore.clearError(); canvasStore.clearError(); }}
                className="shrink-0 rounded-full border border-rose-300/20 px-2 py-1 text-xs text-white/70 transition hover:bg-rose-300/10 hover:text-white"
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
              initialCourseFilter={currentView === 'deadlines' ? deadlineCourseFilterId : null}
              initialDetailId={currentView === 'deadlines' ? deadlineFocusId : null}
              onAdd={handleAddDeadline}
              onAddProject={handleAddProject}
              onUpdate={handleUpdateDeadline}
              onDelete={handleDeleteDeadline}
              onDeleteAll={handleDeleteAllDeadlines}
              onLinkTask={handleLinkTask}
              onUnlinkTask={handleUnlinkTask}
              onCreateTask={async (title, desc, projId, dueDate) => handleAddTask(title, desc, 'medium', projId, dueDate, 'none')}
              onNavigateToCourse={openCourse}
              onNavigateToTasks={openCourseTasks}
            />
          )}
          {currentView === 'tasks' && (
            <TaskBoard
              tasks={store.tasks}
              projects={store.projects}
              deadlines={deadlineStore.deadlines}
              initialProjectFilter={currentView === 'tasks' ? taskProjectFilterId : 'all'}
              onAddTask={handleAddTask}
              onUpdateStatus={store.updateTaskStatus}
              onUpdateTask={handleUpdateTask}
              onDeleteTask={handleDeleteTask}
              onAddSubtask={store.addSubtask}
              onToggleSubtask={store.toggleSubtask}
              onDeleteSubtask={store.deleteSubtask}
              onAddComment={store.addComment}
              onDeleteComment={store.deleteComment}
              onOpenDeadline={openDeadline}
            />
          )}
          {currentView === 'projects' && (
            <ProjectList
              projects={store.projects}
              tasks={store.tasks}
              deadlines={deadlineStore.deadlines}
              initialProjectId={currentView === 'projects' ? projectFocusId : null}
              onAddProject={handleAddProject}
              onDeleteProject={handleDeleteProject}
              onOpenTasks={openCourseTasks}
              onOpenDeadlines={openCourseDeadlines}
            />
          )}
          {currentView === 'calendar' && (
            <CalendarView userId={user.id} deadlines={deadlineStore.deadlines} />
          )}
          {currentView === 'timeline' && (
            <TimelineView
              tasks={store.tasks}
              projects={store.projects}
              deadlines={deadlineStore.deadlines}
              onUpdateDueDate={store.updateTaskDueDate}
            />
          )}
          {currentView === 'gym' && (
            <GymPage
              plans={gym.plans}
              dayTemplates={gym.dayTemplates}
              exercises={gym.exercises}
              dayExercises={gym.dayExercises}
              sessions={gym.sessions}
              exerciseLogs={gym.exerciseLogs}
              setLogs={gym.setLogs}
              activePlan={gym.activePlan}
              activeSession={gym.activeSession}
              onAddPlan={gym.addPlan}
              onUpdatePlan={gym.updatePlan}
              onDeletePlan={gym.deletePlan}
              onAddDayTemplate={gym.addDayTemplate}
              onUpdateDayTemplate={gym.updateDayTemplate}
              onDeleteDayTemplate={gym.deleteDayTemplate}
              onAddExercise={gym.addExercise}
              onUpdateExercise={gym.updateExercise}
              onDeleteExercise={gym.deleteExercise}
              onAddDayExercise={gym.addDayExercise}
              onUpdateDayExercise={gym.updateDayExercise}
              onDeleteDayExercise={gym.deleteDayExercise}
              onStartSession={gym.startSession}
              onCompleteSession={gym.completeSession}
              onDeleteSession={gym.deleteSession}
              onUpdateSetLog={gym.updateSetLog}
              getLastPerformance={gym.getLastPerformance}
              onUploadExercisePhoto={gym.uploadExercisePhoto}
              onUploadExerciseImage={gym.uploadExerciseImage}
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
          onNavigate={(view) => { handleViewChange(view); setSearchOpen(false); }}
        />
      )}

      {canvasOpen && (
        <CanvasConnect
          connection={canvasStore.connection}
          isSyncing={canvasStore.isSyncing}
          error={canvasStore.error}
          lastSyncResult={canvasStore.lastSyncResult}
          onDisconnect={canvasStore.disconnect}
          onSync={handleCanvasSync}
          onClose={() => setCanvasOpen(false)}
          onClearError={canvasStore.clearError}
        />
      )}

      <ProfileModal
        user={user}
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        tasks={store.tasks}
        deadlines={deadlineStore.deadlines}
        projects={store.projects}
        onUserUpdated={handleUserUpdated}
      />

      <div className="pointer-events-none fixed right-4 top-20 z-[80] flex w-full max-w-sm flex-col gap-2 sm:right-6">
        {toasts.map(toast => (
          <div
            key={toast.id}
            className="pointer-events-auto overflow-hidden rounded-2xl border shadow-xl backdrop-blur"
            style={{
              borderColor: toast.tone === 'error' ? 'rgba(248,113,113,0.2)' : toast.tone === 'success' ? 'rgba(52,211,153,0.2)' : 'rgba(99,102,241,0.2)',
              backgroundColor: toast.tone === 'error' ? 'rgba(69,10,10,0.88)' : toast.tone === 'success' ? 'rgba(6,47,32,0.9)' : 'rgba(24,24,39,0.94)',
            }}
          >
            <div className="flex items-start gap-3 px-4 py-3 text-sm">
              <div className="mt-0.5 shrink-0">
                {toast.tone === 'error' ? <AlertCircle size={16} className="text-rose-200" /> : <CheckCircle2 size={16} className={toast.tone === 'success' ? 'text-emerald-200' : 'text-indigo-200'} />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-medium text-white">{toast.title}</div>
                {toast.message && <div className="mt-0.5 text-xs text-white/75">{toast.message}</div>}
              </div>
              <button
                type="button"
                onClick={() => dismissToast(toast.id)}
                className="rounded-full p-1 text-white/60 transition hover:bg-white/10 hover:text-white"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
