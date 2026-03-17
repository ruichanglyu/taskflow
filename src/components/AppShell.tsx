import { useState } from 'react';
import { LogOut, Menu } from 'lucide-react';
import { User } from '@supabase/supabase-js';
import { View } from '../types';
import { useStore } from '../hooks/useStore';
import { Sidebar } from './Sidebar';
import { Dashboard } from './Dashboard';
import { TaskBoard } from './TaskBoard';
import { ProjectList } from './ProjectList';
import { supabase } from '../lib/supabase';

interface AppShellProps {
  user: User;
}

export function AppShell({ user }: AppShellProps) {
  const [currentView, setCurrentView] = useState<View>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const store = useStore(user.id);

  const handleSignOut = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
  };

  return (
    <div className="flex h-screen overflow-hidden bg-gray-950 text-gray-100">
      <Sidebar
        currentView={currentView}
        onViewChange={setCurrentView}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center gap-4 border-b border-gray-800 bg-gray-950/80 px-4 py-4 backdrop-blur-sm sm:px-6">
          <button
            onClick={() => setSidebarOpen(true)}
            className="text-gray-400 transition-colors hover:text-white lg:hidden"
          >
            <Menu size={22} />
          </button>
          <div className="flex-1" />
          <div className="hidden items-center gap-2 rounded-full bg-gray-800/60 px-3 py-1.5 sm:flex">
            <div className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
            <span className="text-xs text-gray-400">
              {store.tasks.filter(task => task.status !== 'done').length} active tasks
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium text-white">
                {user.user_metadata.full_name || user.email || 'TaskFlow user'}
              </p>
              <p className="text-xs text-gray-500">{user.email}</p>
            </div>
            <button
              onClick={handleSignOut}
              className="flex items-center gap-2 rounded-full border border-gray-700 px-3 py-2 text-sm text-gray-300 transition hover:border-gray-600 hover:text-white"
            >
              <LogOut size={16} />
              <span className="hidden sm:inline">Log out</span>
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          {currentView === 'dashboard' && (
            <Dashboard tasks={store.tasks} projects={store.projects} />
          )}
          {currentView === 'tasks' && (
            <TaskBoard
              tasks={store.tasks}
              projects={store.projects}
              onAddTask={store.addTask}
              onUpdateStatus={store.updateTaskStatus}
              onDeleteTask={store.deleteTask}
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
        </main>
      </div>
    </div>
  );
}
