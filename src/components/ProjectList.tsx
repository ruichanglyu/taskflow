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
          <h1 className="text-2xl font-bold text-white">Projects</h1>
          <p className="text-gray-400 mt-1">Organize your work into projects</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors self-start"
        >
          <Plus size={16} /> New Project
        </button>
      </div>

      {/* Add Project Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Project name"
            autoFocus
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-100 placeholder:text-gray-600 focus:outline-none focus:border-indigo-500/50"
          />
          <input
            type="text"
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Brief description"
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-100 placeholder:text-gray-600 focus:outline-none focus:border-indigo-500/50"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-4 py-2 border border-gray-700 text-gray-300 rounded-lg text-sm hover:bg-gray-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim()}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-lg text-sm font-medium transition-colors"
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
            <div key={project.id} className="bg-gray-900 border border-gray-800 rounded-xl p-5 hover:border-gray-700 transition-all group">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: project.color + '20' }}>
                    <FolderOpen size={20} style={{ color: project.color }} />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-white">{project.name}</h3>
                    <p className="text-xs text-gray-500 mt-0.5">{project.description || 'No description'}</p>
                  </div>
                </div>
                <button
                  onClick={() => onDeleteProject(project.id)}
                  className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400 transition-all p-1"
                >
                  <Trash2 size={14} />
                </button>
              </div>

              <div className="mt-4">
                <div className="flex justify-between text-xs text-gray-500 mb-2">
                  <span>Progress</span>
                  <span>{progress}%</span>
                </div>
                <div className="w-full bg-gray-800 rounded-full h-2">
                  <div
                    className="h-2 rounded-full transition-all"
                    style={{ width: `${progress}%`, backgroundColor: project.color }}
                  />
                </div>
              </div>

              <div className="flex gap-3 mt-4 pt-3 border-t border-gray-800">
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-gray-400" />
                  <span className="text-xs text-gray-500">{todo} todo</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-blue-400" />
                  <span className="text-xs text-gray-500">{inProgress} active</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span className="text-xs text-gray-500">{done} done</span>
                </div>
              </div>

              <p className="text-[10px] text-gray-600 mt-3">
                Created {new Date(project.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </p>
            </div>
          );
        })}

        {projects.length === 0 && (
          <div className="col-span-full flex flex-col items-center justify-center py-16 bg-gray-900 border border-gray-800 rounded-xl">
            <FolderOpen size={40} className="text-gray-700 mb-3" />
            <p className="text-gray-500 text-sm">No projects yet</p>
            <p className="text-gray-600 text-xs mt-1">Create your first project to get started</p>
          </div>
        )}
      </div>
    </div>
  );
}
