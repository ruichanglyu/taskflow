import { CheckCircle2, Clock, AlertCircle, TrendingUp, FolderKanban, ListTodo } from 'lucide-react';
import { Task, Project } from '../types';
import { cn } from '../utils/cn';

interface DashboardProps {
  tasks: Task[];
  projects: Project[];
}

function StatCard({ icon, label, value, color, bg }: { icon: React.ReactNode; label: string; value: number; color: string; bg: string }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 hover:border-gray-700 transition-colors">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-400 mb-1">{label}</p>
          <p className="text-3xl font-bold text-white">{value}</p>
        </div>
        <div className={cn('w-12 h-12 rounded-xl flex items-center justify-center', bg)}>
          <span className={color}>{icon}</span>
        </div>
      </div>
    </div>
  );
}

export function Dashboard({ tasks, projects }: DashboardProps) {
  const todo = tasks.filter(t => t.status === 'todo');
  const inProgress = tasks.filter(t => t.status === 'in-progress');
  const done = tasks.filter(t => t.status === 'done');
  const highPriority = tasks.filter(t => t.priority === 'high' && t.status !== 'done');

  const completionRate = tasks.length > 0 ? Math.round((done.length / tasks.length) * 100) : 0;

  const recentTasks = [...tasks].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 5);

  const statusColor = (status: string) => {
    if (status === 'done') return 'text-emerald-400 bg-emerald-400/10';
    if (status === 'in-progress') return 'text-blue-400 bg-blue-400/10';
    return 'text-gray-400 bg-gray-400/10';
  };

  const priorityColor = (p: string) => {
    if (p === 'high') return 'text-red-400';
    if (p === 'medium') return 'text-yellow-400';
    return 'text-gray-500';
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="text-gray-400 mt-1">Overview of your tasks and projects</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={<ListTodo size={22} />} label="Total Tasks" value={tasks.length} color="text-indigo-400" bg="bg-indigo-400/10" />
        <StatCard icon={<Clock size={22} />} label="In Progress" value={inProgress.length} color="text-blue-400" bg="bg-blue-400/10" />
        <StatCard icon={<CheckCircle2 size={22} />} label="Completed" value={done.length} color="text-emerald-400" bg="bg-emerald-400/10" />
        <StatCard icon={<AlertCircle size={22} />} label="High Priority" value={highPriority.length} color="text-red-400" bg="bg-red-400/10" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Completion Progress */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp size={18} className="text-indigo-400" />
            <h3 className="text-sm font-semibold text-white">Completion Rate</h3>
          </div>
          <div className="flex items-center justify-center py-4">
            <div className="relative w-32 h-32">
              <svg className="w-32 h-32 -rotate-90" viewBox="0 0 120 120">
                <circle cx="60" cy="60" r="50" fill="none" stroke="#1f2937" strokeWidth="10" />
                <circle
                  cx="60" cy="60" r="50" fill="none" stroke="#6366f1" strokeWidth="10"
                  strokeDasharray={`${completionRate * 3.14} ${314 - completionRate * 3.14}`}
                  strokeLinecap="round"
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-2xl font-bold text-white">{completionRate}%</span>
              </div>
            </div>
          </div>
          <div className="flex justify-between text-xs text-gray-500 mt-2">
            <span>{done.length} done</span>
            <span>{todo.length + inProgress.length} remaining</span>
          </div>
        </div>

        {/* Recent Tasks */}
        <div className="lg:col-span-2 bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-4">Recent Tasks</h3>
          <div className="space-y-3">
            {recentTasks.map(task => (
              <div key={task.id} className="flex items-center justify-between py-2 border-b border-gray-800 last:border-0">
                <div className="flex items-center gap-3 min-w-0">
                  <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full', statusColor(task.status))}>
                    {task.status === 'in-progress' ? 'In Progress' : task.status === 'todo' ? 'To Do' : 'Done'}
                  </span>
                  <span className="text-sm text-gray-200 truncate">{task.title}</span>
                </div>
                <span className={cn('text-xs font-medium capitalize', priorityColor(task.priority))}>
                  {task.priority}
                </span>
              </div>
            ))}
            {recentTasks.length === 0 && (
              <p className="text-sm text-gray-500 text-center py-4">No tasks yet</p>
            )}
          </div>
        </div>
      </div>

      {/* Projects Overview */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <FolderKanban size={18} className="text-indigo-400" />
          <h3 className="text-sm font-semibold text-white">Projects Overview</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map(project => {
            const projectTasks = tasks.filter(t => t.projectId === project.id);
            const projectDone = projectTasks.filter(t => t.status === 'done').length;
            const progress = projectTasks.length > 0 ? Math.round((projectDone / projectTasks.length) * 100) : 0;

            return (
              <div key={project.id} className="bg-gray-800/50 rounded-lg p-4 border border-gray-700/50">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: project.color }} />
                  <h4 className="text-sm font-medium text-white truncate">{project.name}</h4>
                </div>
                <div className="w-full bg-gray-700 rounded-full h-1.5 mb-2">
                  <div className="h-1.5 rounded-full transition-all" style={{ width: `${progress}%`, backgroundColor: project.color }} />
                </div>
                <div className="flex justify-between text-xs text-gray-500">
                  <span>{projectTasks.length} tasks</span>
                  <span>{progress}%</span>
                </div>
              </div>
            );
          })}
          {projects.length === 0 && (
            <p className="text-sm text-gray-500 col-span-full text-center py-4">No projects yet</p>
          )}
        </div>
      </div>
    </div>
  );
}
