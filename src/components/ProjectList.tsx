import { useState } from 'react';
import { Plus, Trash2, FolderOpen } from 'lucide-react';
import { Task, Project } from '../types';

interface ProjectListProps {
  projects: Project[];
  tasks: Task[];
  onAddProject: (name: string, description: string) => void;
  onDeleteProject: (id: string) => void;
}

export function ProjectList({ projects, tasks, onAddProject, onDeleteProject }: ProjectListProps) {
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onAddProject(name.trim(), description.trim());
    setName('');
    setDescription('');
    setShowForm(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">Courses</h1>
          <p className="mt-1 text-[var(--text-muted)]">Organize your work by course</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="self-start rounded-lg px-4 py-2.5 text-sm font-medium text-[var(--accent-contrast)] transition-colors"
          style={{ backgroundColor: 'var(--accent-strong)' }}
        >
          <Plus size={16} /> New Course
        </button>
      </div>

      {/* Add Project Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="space-y-3 rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] p-5">
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Project name"
            autoFocus
            className="w-full rounded-lg border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
          />
          <input
            type="text"
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Brief description"
            className="w-full rounded-lg border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-lg border border-[var(--border-soft)] px-4 py-2 text-sm text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-muted)]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim()}
              className="rounded-lg px-4 py-2 text-sm font-medium text-[var(--accent-contrast)] transition-colors disabled:opacity-40"
              style={{ backgroundColor: 'var(--accent-strong)' }}
            >
              Create
            </button>
          </div>
        </form>
      )}

      {/* Project Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {projects.map(project => {
          const projectTasks = tasks.filter(t => t.projectId === project.id);
          const done = projectTasks.filter(t => t.status === 'done').length;
          const inProgress = projectTasks.filter(t => t.status === 'in-progress').length;
          const todo = projectTasks.filter(t => t.status === 'todo').length;
          const progress = projectTasks.length > 0 ? Math.round((done / projectTasks.length) * 100) : 0;

          return (
            <div key={project.id} className="group rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] p-5 transition-all hover:border-[var(--border-strong)]">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: project.color + '20' }}>
                    <FolderOpen size={20} style={{ color: project.color }} />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-white">{project.name}</h3>
                    <p className="mt-0.5 text-xs text-[var(--text-faint)]">{project.description || 'No description'}</p>
                  </div>
                </div>
                <button
                  onClick={() => onDeleteProject(project.id)}
                  className="p-1 text-[var(--text-faint)] opacity-0 transition-all group-hover:opacity-100 hover:text-red-400"
                >
                  <Trash2 size={14} />
                </button>
              </div>

              <div className="mt-4">
                <div className="mb-2 flex justify-between text-xs text-[var(--text-faint)]">
                  <span>Progress</span>
                  <span>{progress}%</span>
                </div>
                <div className="h-2 w-full rounded-full bg-[var(--surface-muted)]">
                  <div
                    className="h-2 rounded-full transition-all"
                    style={{ width: `${progress}%`, backgroundColor: project.color }}
                  />
                </div>
              </div>

              <div className="mt-4 flex gap-3 border-t border-[var(--border-soft)] pt-3">
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-gray-400" />
                  <span className="text-xs text-[var(--text-faint)]">{todo} todo</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-blue-400" />
                  <span className="text-xs text-[var(--text-faint)]">{inProgress} active</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span className="text-xs text-[var(--text-faint)]">{done} done</span>
                </div>
              </div>

              <p className="mt-3 text-[10px] text-[var(--text-faint)]">
                Created {new Date(project.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </p>
            </div>
          );
        })}

        {projects.length === 0 && (
          <div className="col-span-full flex flex-col items-center justify-center rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] py-16">
            <FolderOpen size={40} className="mb-3 text-[var(--text-faint)]" />
            <p className="text-sm text-[var(--text-muted)]">No projects yet</p>
            <p className="mt-1 text-xs text-[var(--text-faint)]">Create your first project to get started</p>
          </div>
        )}
      </div>
    </div>
  );
}
