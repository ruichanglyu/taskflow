import { useState } from 'react';
import { Plus, Trash2, ChevronDown, Search, Filter } from 'lucide-react';
import { Task, Project, TaskStatus, Priority } from '../types';
import { cn } from '../utils/cn';
import { AddTaskModal } from './AddTaskModal';

interface TaskBoardProps {
  tasks: Task[];
  projects: Project[];
  onAddTask: (title: string, description: string, priority: Priority, projectId: string | null, dueDate: string | null) => void;
  onUpdateStatus: (id: string, status: TaskStatus) => void;
  onDeleteTask: (id: string) => void;
}

const statusColumns: { status: TaskStatus; label: string; color: string; dotColor: string }[] = [
  { status: 'todo', label: 'To Do', color: 'border-gray-600', dotColor: 'bg-gray-400' },
  { status: 'in-progress', label: 'In Progress', color: 'border-blue-600', dotColor: 'bg-blue-400' },
  { status: 'done', label: 'Done', color: 'border-emerald-600', dotColor: 'bg-emerald-400' },
];

const priorityBadge = (p: Priority) => {
  if (p === 'high') return 'bg-red-500/10 text-red-400 border-red-500/20';
  if (p === 'medium') return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20';
  return 'bg-gray-500/10 text-gray-400 border-gray-500/20';
};

function TaskCard({
  task,
  projects,
  onUpdateStatus,
  onDelete,
}: {
  task: Task;
  projects: Project[];
  onUpdateStatus: (id: string, status: TaskStatus) => void;
  onDelete: (id: string) => void;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const project = projects.find(p => p.id === task.projectId);

  const dueLabel = task.dueDate
    ? new Date(task.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : null;

  const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && task.status !== 'done';

  return (
    <div className="bg-gray-800/60 border border-gray-700/50 rounded-lg p-4 hover:border-gray-600 transition-all group">
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-sm font-medium text-gray-100 leading-snug">{task.title}</h4>
        <div className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-500 hover:text-gray-300 p-1"
          >
            <ChevronDown size={14} />
          </button>
          {showMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
              <div className="absolute right-0 top-6 z-20 bg-gray-800 border border-gray-700 rounded-lg shadow-xl py-1 w-36">
                {statusColumns.map(col => (
                  <button
                    key={col.status}
                    onClick={() => { onUpdateStatus(task.id, col.status); setShowMenu(false); }}
                    className={cn(
                      'w-full text-left px-3 py-1.5 text-xs hover:bg-gray-700 transition-colors',
                      task.status === col.status ? 'text-indigo-400' : 'text-gray-300'
                    )}
                  >
                    {col.label}
                  </button>
                ))}
                <hr className="border-gray-700 my-1" />
                <button
                  onClick={() => { onDelete(task.id); setShowMenu(false); }}
                  className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-gray-700 flex items-center gap-2"
                >
                  <Trash2 size={12} /> Delete
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {task.description && (
        <p className="text-xs text-gray-500 mt-1.5 line-clamp-2">{task.description}</p>
      )}

      <div className="flex items-center gap-2 mt-3 flex-wrap">
        <span className={cn('text-[10px] font-medium px-2 py-0.5 rounded-full border capitalize', priorityBadge(task.priority))}>
          {task.priority}
        </span>

        {project && (
          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-700/50 text-gray-300 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: project.color }} />
            {project.name}
          </span>
        )}

        {dueLabel && (
          <span className={cn('text-[10px] font-medium px-2 py-0.5 rounded-full', isOverdue ? 'bg-red-500/10 text-red-400' : 'bg-gray-700/50 text-gray-400')}>
            {dueLabel}
          </span>
        )}
      </div>
    </div>
  );
}

export function TaskBoard({ tasks, projects, onAddTask, onUpdateStatus, onDeleteTask }: TaskBoardProps) {
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState('');
  const [filterPriority, setFilterPriority] = useState<Priority | 'all'>('all');
  const [filterProject, setFilterProject] = useState<string>('all');

  const filteredTasks = tasks.filter(t => {
    const matchesSearch = t.title.toLowerCase().includes(search.toLowerCase()) || t.description.toLowerCase().includes(search.toLowerCase());
    const matchesPriority = filterPriority === 'all' || t.priority === filterPriority;
    const matchesProject = filterProject === 'all' || t.projectId === filterProject;
    return matchesSearch && matchesPriority && matchesProject;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Tasks</h1>
          <p className="text-gray-400 mt-1">Manage and track your tasks</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors self-start"
        >
          <Plus size={16} /> New Task
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            placeholder="Search tasks..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-gray-900 border border-gray-800 rounded-lg text-sm text-gray-200 placeholder:text-gray-600 focus:outline-none focus:border-indigo-500/50 transition-colors"
          />
        </div>
        <div className="flex gap-2">
          <div className="relative">
            <Filter size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <select
              value={filterPriority}
              onChange={e => setFilterPriority(e.target.value as Priority | 'all')}
              className="pl-8 pr-8 py-2 bg-gray-900 border border-gray-800 rounded-lg text-sm text-gray-300 focus:outline-none focus:border-indigo-500/50 appearance-none cursor-pointer"
            >
              <option value="all">All Priorities</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
          <select
            value={filterProject}
            onChange={e => setFilterProject(e.target.value)}
            className="px-3 py-2 bg-gray-900 border border-gray-800 rounded-lg text-sm text-gray-300 focus:outline-none focus:border-indigo-500/50 appearance-none cursor-pointer"
          >
            <option value="all">All Projects</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Kanban Columns */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {statusColumns.map(col => {
          const columnTasks = filteredTasks.filter(t => t.status === col.status);
          return (
            <div key={col.status} className="bg-gray-900/50 rounded-xl border border-gray-800 p-4">
              <div className="flex items-center gap-2 mb-4">
                <div className={cn('w-2.5 h-2.5 rounded-full', col.dotColor)} />
                <h3 className="text-sm font-semibold text-gray-200">{col.label}</h3>
                <span className="ml-auto text-xs text-gray-600 bg-gray-800 px-2 py-0.5 rounded-full">{columnTasks.length}</span>
              </div>
              <div className="space-y-3 min-h-[120px]">
                {columnTasks.map(task => (
                  <TaskCard key={task.id} task={task} projects={projects} onUpdateStatus={onUpdateStatus} onDelete={onDeleteTask} />
                ))}
                {columnTasks.length === 0 && (
                  <div className="flex items-center justify-center h-24 border-2 border-dashed border-gray-800 rounded-lg">
                    <p className="text-xs text-gray-600">No tasks</p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {showModal && (
        <AddTaskModal
          projects={projects}
          onAdd={(title, desc, priority, projectId, dueDate) => { onAddTask(title, desc, priority, projectId, dueDate); setShowModal(false); }}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}
