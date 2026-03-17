import { useState } from 'react';
import { Menu } from 'lucide-react';
import { View } from './types';
import { useStore } from './hooks/useStore';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './components/Dashboard';
import { TaskBoard } from './components/TaskBoard';
import { ProjectList } from './components/ProjectList';

export default function App() {
  const [currentView, setCurrentView] = useState<View>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const store = useStore();

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100 overflow-hidden">
      <Sidebar
        currentView={currentView}
        onViewChange={setCurrentView}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar */}
        <header className="flex items-center gap-4 px-4 sm:px-6 py-4 border-b border-gray-800 bg-gray-950/80 backdrop-blur-sm sticky top-0 z-10">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden text-gray-400 hover:text-white transition-colors"
          >
            <Menu size={22} />
          </button>
          <div className="flex-1" />
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-gray-800/60 rounded-full">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs text-gray-400">
                {store.tasks.filter(t => t.status !== 'done').length} active tasks
              </span>
            </div>
          </div>
        </header>

        {/* Main Content */}
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
