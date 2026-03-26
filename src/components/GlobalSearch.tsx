import { useState, useEffect, useRef, useMemo } from 'react';
import { Search, X, CheckSquare, FolderKanban, Target, ArrowRight } from 'lucide-react';
import { Task, Project, Deadline, View } from '../types';
import { cn } from '../utils/cn';

interface GlobalSearchProps {
  tasks: Task[];
  projects: Project[];
  deadlines?: Deadline[];
  onClose: () => void;
  onNavigate: (view: View) => void;
}

interface SearchResult {
  type: 'task' | 'project' | 'deadline';
  id: string;
  title: string;
  subtitle: string;
  view: View;
}

export function GlobalSearch({ tasks, projects, deadlines = [], onClose, onNavigate }: GlobalSearchProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = useMemo<SearchResult[]>(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();

    const taskResults: SearchResult[] = tasks
      .filter(t => t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q))
      .slice(0, 8)
      .map(t => ({
        type: 'task' as const,
        id: t.id,
        title: t.title,
        subtitle: `${t.status === 'in-progress' ? 'In Progress' : t.status === 'todo' ? 'To Do' : 'Done'} · ${t.priority} priority`,
        view: 'tasks' as View,
      }));

    const projectResults: SearchResult[] = projects
      .filter(p => p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q))
      .slice(0, 4)
      .map(p => ({
        type: 'project' as const,
        id: p.id,
        title: p.name,
        subtitle: p.description || 'No description',
        view: 'projects' as View,
      }));

    const deadlineResults: SearchResult[] = deadlines
      .filter(d => d.title.toLowerCase().includes(q) || d.notes.toLowerCase().includes(q))
      .slice(0, 4)
      .map(d => ({
        type: 'deadline' as const,
        id: d.id,
        title: d.title,
        subtitle: `${d.type} · Due ${d.dueDate}`,
        view: 'deadlines' as View,
      }));

    return [...deadlineResults, ...taskResults, ...projectResults];
  }, [query, tasks, projects, deadlines]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && results[selectedIndex]) {
      onNavigate(results[selectedIndex].view);
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/75" />
      <div
        className="relative w-full max-w-lg rounded-xl border border-[var(--border-soft)] bg-[var(--surface-elevated)] shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-[var(--border-soft)] px-4 py-3">
          <Search size={18} className="text-[var(--text-faint)]" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search tasks, projects..."
            className="flex-1 bg-transparent text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:outline-none"
          />
          <button onClick={onClose} className="text-[var(--text-faint)] hover:text-[var(--text-primary)]">
            <X size={16} />
          </button>
        </div>

        <div className="max-h-80 overflow-y-auto p-2">
          {query.trim() === '' ? (
            <div className="px-3 py-8 text-center text-sm text-[var(--text-faint)]">
              Type to search across tasks and projects
            </div>
          ) : results.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-[var(--text-faint)]">
              No results for "{query}"
            </div>
          ) : (
            results.map((result, i) => (
              <button
                key={`${result.type}-${result.id}`}
                onClick={() => onNavigate(result.view)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
                  i === selectedIndex ? 'bg-[var(--accent-soft)] text-[var(--accent)]' : 'text-[var(--text-secondary)] hover:bg-[var(--surface-muted)]'
                )}
              >
                {result.type === 'task' ? (
                  <CheckSquare size={16} className="shrink-0" />
                ) : result.type === 'deadline' ? (
                  <Target size={16} className="shrink-0" />
                ) : (
                  <FolderKanban size={16} className="shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{result.title}</p>
                  <p className="text-xs text-[var(--text-faint)] truncate">{result.subtitle}</p>
                </div>
                <ArrowRight size={14} className="shrink-0 text-[var(--text-faint)]" />
              </button>
            ))
          )}
        </div>

        <div className="border-t border-[var(--border-soft)] px-4 py-2 flex items-center gap-4 text-[10px] text-[var(--text-faint)]">
          <span><kbd className="rounded border border-[var(--border-soft)] px-1 py-0.5">↑↓</kbd> Navigate</span>
          <span><kbd className="rounded border border-[var(--border-soft)] px-1 py-0.5">↵</kbd> Open</span>
          <span><kbd className="rounded border border-[var(--border-soft)] px-1 py-0.5">Esc</kbd> Close</span>
        </div>
      </div>
    </div>
  );
}
