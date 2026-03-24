import { useEffect, useMemo, useState } from 'react';
import { Plus, Upload, ChevronDown, ChevronUp, Filter, StickyNote, Link2, Trash2, X, Pencil, CheckCircle2, AlertCircle, Search } from 'lucide-react';
import { Deadline, DeadlineStatus, DeadlineType, Project, Task } from '../types';
import { cn } from '../utils/cn';

interface DeadlinesPageProps {
  deadlines: Deadline[];
  projects: Project[];
  tasks: Task[];
  initialCourseFilter?: string | null;
  initialDetailId?: string | null;
  onAdd: (title: string, projectId: string | null, type: DeadlineType, dueDate: string, dueTime: string | null, notes: string) => Promise<boolean>;
  onAddProject: (name: string, description: string) => Promise<string | null> | void;
  onUpdate: (id: string, updates: Partial<Pick<Deadline, 'title' | 'projectId' | 'status' | 'type' | 'dueDate' | 'dueTime' | 'notes'>>) => Promise<boolean>;
  onDelete: (id: string) => void;
  onLinkTask: (deadlineId: string, taskId: string) => Promise<boolean>;
  onUnlinkTask: (deadlineId: string, taskId: string) => void;
  onCreateTask: (title: string, description: string, projectId: string | null, dueDate: string | null) => Promise<string | null>;
  onNavigateToCourse?: (projectId: string) => void;
  onNavigateToTasks?: (projectId: string) => void;
}

type SortField = 'dueDate' | 'title' | 'type' | 'status' | 'course';
type SortDir = 'asc' | 'desc';
type ImportStatus = 'idle' | 'success' | 'error';
type DeadlineQuickFilter = 'all' | 'today' | 'this-week' | 'overdue';
type DeadlineViewMode = 'table' | 'compact' | 'course';

interface ParsedImportRow {
  title: string;
  course: string;
  dueDate: string;
  dueTime: string | null;
  status: DeadlineStatus;
  type: DeadlineType;
  notes: string;
}

interface ImportPreview {
  fileName: string;
  rows: ParsedImportRow[];
  skippedRows: string[];
}

const STATUS_OPTIONS: { value: DeadlineStatus; label: string; color: string }[] = [
  { value: 'not-started', label: 'Not Started', color: 'text-[var(--text-faint)] bg-[var(--surface-muted)]' },
  { value: 'in-progress', label: 'In Progress', color: 'text-blue-400 bg-blue-400/10' },
  { value: 'done', label: 'Done', color: 'text-emerald-400 bg-emerald-400/10' },
  { value: 'missed', label: 'Missed', color: 'text-red-400 bg-red-400/10' },
];

const TYPE_OPTIONS: { value: DeadlineType; label: string }[] = [
  { value: 'assignment', label: 'Assignment' },
  { value: 'exam', label: 'Exam' },
  { value: 'quiz', label: 'Quiz' },
  { value: 'lab', label: 'Lab' },
  { value: 'project', label: 'Project' },
  { value: 'other', label: 'Other' },
];

function statusMeta(status: DeadlineStatus) {
  return STATUS_OPTIONS.find(s => s.value === status) ?? STATUS_OPTIONS[0];
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(timeStr: string) {
  const [h, m] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hr = h % 12 || 12;
  return `${hr}:${m.toString().padStart(2, '0')} ${ampm}`;
}

function daysUntil(dateStr: string) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const due = new Date(dateStr + 'T00:00:00');
  return Math.ceil((due.getTime() - now.getTime()) / 86400000);
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(cell);
      cell = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i++;
      row.push(cell);
      if (row.some(value => value.length > 0)) {
        rows.push(row);
      }
      row = [];
      cell = '';
      continue;
    }

    cell += char;
  }

  row.push(cell);
  if (row.some(value => value.length > 0)) {
    rows.push(row);
  }

  return rows;
}

function normalizeHeader(value: string) {
  return value.trim().toLowerCase();
}

function normalizeStatus(value: string): DeadlineStatus {
  const status = value.trim().toLowerCase();
  if (status === 'done') return 'done';
  if (status === 'missed') return 'missed';
  if (status === 'in progress' || status === 'in-progress') return 'in-progress';
  return 'not-started';
}

function normalizeType(value: string): DeadlineType {
  const type = value.trim().toLowerCase();
  if (type === 'assignment') return 'assignment';
  if (type === 'exam') return 'exam';
  if (type === 'quiz') return 'quiz';
  if (type === 'lab') return 'lab';
  if (type === 'project') return 'project';
  return 'other';
}

function normalizeDate(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }

  const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;

  const [, month, day, year] = match;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function normalizeTime(value: string): { dueTime: string | null; notePrefix: string | null } {
  const raw = value.trim();
  if (!raw) return { dueTime: null, notePrefix: null };

  if (raw.toLowerCase() === 'in class') {
    return { dueTime: null, notePrefix: 'In class' };
  }

  const normalized = raw
    .replace(/\s+/g, ' ')
    .replace(/(\d)(AM|PM)$/i, '$1 $2')
    .trim()
    .toUpperCase();

  const match = normalized.match(/^(\d{1,2}):(\d{2})\s?(AM|PM)$/);
  if (!match) {
    return { dueTime: null, notePrefix: raw };
  }

  let hours = Number(match[1]);
  const minutes = match[2];
  const period = match[3];

  if (hours === 12) {
    hours = period === 'AM' ? 0 : 12;
  } else if (period === 'PM') {
    hours += 12;
  }

  return {
    dueTime: `${String(hours).padStart(2, '0')}:${minutes}`,
    notePrefix: null,
  };
}

function buildDeadlineSignature(course: string, title: string, dueDate: string, dueTime: string | null) {
  return [
    course.trim().toLowerCase(),
    title.trim().toLowerCase(),
    dueDate,
    dueTime ?? '',
  ].join('::');
}

function parseDeadlineCsv(fileName: string, text: string): ImportPreview {
  const rows = parseCsv(text);
  if (rows.length === 0) {
    throw new Error('The CSV file is empty.');
  }

  const headers = rows[0].map(normalizeHeader);
  const required = ['status', 'course', 'date', 'time', 'title', 'type', 'notes'];
  const missing = required.filter(key => !headers.includes(key));

  if (missing.length > 0) {
    throw new Error(`Missing required columns: ${missing.join(', ')}`);
  }

  const indexOf = (name: string) => headers.indexOf(name);
  const parsedRows: ParsedImportRow[] = [];
  const skippedRows: string[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const title = (row[indexOf('title')] ?? '').trim();
    const course = (row[indexOf('course')] ?? '').trim();
    const rawDate = row[indexOf('date')] ?? '';
    const rawTime = row[indexOf('time')] ?? '';
    const rawNotes = (row[indexOf('notes')] ?? '').trim();

    if (!title && !course && !rawDate) {
      continue;
    }

    const dueDate = normalizeDate(rawDate);
    if (!title || !dueDate) {
      skippedRows.push(`Row ${i + 1}: missing title or invalid date`);
      continue;
    }

    const { dueTime, notePrefix } = normalizeTime(rawTime);
    const notes = [notePrefix, rawNotes].filter(Boolean).join('\n');

    parsedRows.push({
      title,
      course,
      dueDate,
      dueTime,
      status: normalizeStatus(row[indexOf('status')] ?? ''),
      type: normalizeType(row[indexOf('type')] ?? ''),
      notes,
    });
  }

  return { fileName, rows: parsedRows, skippedRows };
}

export function DeadlinesPage({ deadlines, projects, tasks, initialCourseFilter = null, initialDetailId = null, onAdd, onAddProject, onUpdate, onDelete, onLinkTask, onUnlinkTask, onCreateTask, onNavigateToCourse, onNavigateToTasks }: DeadlinesPageProps) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(initialDetailId);
  const [sortField, setSortField] = useState<SortField>('dueDate');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [search, setSearch] = useState('');
  const [filterCourse, setFilterCourse] = useState<string>(initialCourseFilter ?? '');
  const [filterType, setFilterType] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [showFilters, setShowFilters] = useState(false);
  const [importStatus, setImportStatus] = useState<ImportStatus>('idle');
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [quickFilter, setQuickFilter] = useState<DeadlineQuickFilter>('all');
  const [viewMode, setViewMode] = useState<DeadlineViewMode>('table');

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null;
    return sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />;
  };

  useEffect(() => {
    setFilterCourse(initialCourseFilter ?? '');
  }, [initialCourseFilter]);

  useEffect(() => {
    setDetailId(initialDetailId);
  }, [initialDetailId]);

  const filtered = useMemo(() => {
    let result = [...deadlines];
    const searchTerm = search.trim().toLowerCase();
    if (searchTerm) {
      result = result.filter(d => {
        const projectName = projects.find(p => p.id === d.projectId)?.name.toLowerCase() ?? '';
        return (
          d.title.toLowerCase().includes(searchTerm) ||
          d.notes.toLowerCase().includes(searchTerm) ||
          d.type.toLowerCase().includes(searchTerm) ||
          projectName.includes(searchTerm)
        );
      });
    }
    if (filterCourse) result = result.filter(d => d.projectId === filterCourse);
    if (filterType) result = result.filter(d => d.type === filterType);
    if (filterStatus) result = result.filter(d => d.status === filterStatus);
    if (quickFilter !== 'all') {
      result = result.filter(d => {
        const days = daysUntil(d.dueDate);
        if (quickFilter === 'today') return days === 0 && d.status !== 'done' && d.status !== 'missed';
        if (quickFilter === 'this-week') return days >= 0 && days <= 7 && d.status !== 'done' && d.status !== 'missed';
        if (quickFilter === 'overdue') return days < 0 && d.status !== 'done' && d.status !== 'missed';
        return true;
      });
    }

    result.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'dueDate': cmp = a.dueDate.localeCompare(b.dueDate); break;
        case 'title': cmp = a.title.localeCompare(b.title); break;
        case 'type': cmp = a.type.localeCompare(b.type); break;
        case 'status': cmp = a.status.localeCompare(b.status); break;
        case 'course': {
          const aP = projects.find(p => p.id === a.projectId)?.name ?? '';
          const bP = projects.find(p => p.id === b.projectId)?.name ?? '';
          cmp = aP.localeCompare(bP);
          break;
        }
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });

    return result;
  }, [deadlines, search, filterCourse, filterType, filterStatus, quickFilter, sortField, sortDir, projects]);

  const groupedByCourse = useMemo(() => {
    return filtered.reduce<Record<string, Deadline[]>>((groups, deadline) => {
      const key = projects.find(project => project.id === deadline.projectId)?.name ?? 'No Course';
      groups[key] = groups[key] ?? [];
      groups[key].push(deadline);
      return groups;
    }, {});
  }, [filtered, projects]);

  const activeFilters = [search, filterCourse, filterType, filterStatus].filter(Boolean).length;
  const detailDeadline = detailId ? deadlines.find(d => d.id === detailId) : null;
  const upcomingCount = deadlines.filter(d => {
    const days = daysUntil(d.dueDate);
    return d.status !== 'done' && d.status !== 'missed' && days >= 0;
  }).length;
  const overdueCount = deadlines.filter(d => daysUntil(d.dueDate) < 0 && d.status !== 'done' && d.status !== 'missed').length;
  const inProgressCount = deadlines.filter(d => d.status === 'in-progress').length;

  const handleImport = async (preview: ImportPreview) => {
    const projectIdsByCourse = new Map<string, string | null>();
    const existingProjectsByName = new Map(
      projects.map(project => [project.name.trim().toLowerCase(), project.id] as const)
    );
    const existingSignatures = new Set(
      deadlines.map(deadline => {
        const courseName = projects.find(project => project.id === deadline.projectId)?.name ?? '';
        return buildDeadlineSignature(courseName, deadline.title, deadline.dueDate, deadline.dueTime);
      })
    );

    let importedCount = 0;
    let createdCourses = 0;
    let skippedDuplicates = 0;

    for (const row of preview.rows) {
      const normalizedCourse = row.course.trim().toLowerCase();
      let projectId: string | null = null;

      if (normalizedCourse) {
        if (projectIdsByCourse.has(normalizedCourse)) {
          projectId = projectIdsByCourse.get(normalizedCourse) ?? null;
        } else if (existingProjectsByName.has(normalizedCourse)) {
          projectId = existingProjectsByName.get(normalizedCourse) ?? null;
          projectIdsByCourse.set(normalizedCourse, projectId);
        } else {
          const createdProjectId = await onAddProject(row.course.trim(), '');
          if (createdProjectId) {
            projectId = createdProjectId;
            projectIdsByCourse.set(normalizedCourse, createdProjectId);
            existingProjectsByName.set(normalizedCourse, createdProjectId);
            createdCourses++;
          }
        }
      }

      const signature = buildDeadlineSignature(row.course, row.title, row.dueDate, row.dueTime);
      if (existingSignatures.has(signature)) {
        skippedDuplicates++;
        continue;
      }

      const ok = await onAdd(row.title, projectId, row.type, row.dueDate, row.dueTime, row.notes);
      if (ok) {
        importedCount++;
        existingSignatures.add(signature);
      }
    }

    const parts = [`Imported ${importedCount} deadlines`];
    if (createdCourses > 0) parts.push(`created ${createdCourses} courses`);
    if (skippedDuplicates > 0) parts.push(`skipped ${skippedDuplicates} duplicates`);
    if (preview.skippedRows.length > 0) parts.push(`ignored ${preview.skippedRows.length} invalid rows`);

    setImportStatus(importedCount > 0 ? 'success' : 'error');
    setImportMessage(parts.join(' • '));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">Deadlines</h1>
          <p className="mt-1 text-[var(--text-muted)]">Track what's due and when</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFilters(f => !f)}
            className={cn(
              'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition',
              showFilters || activeFilters > 0
                ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--accent-soft)]'
                : 'border-[var(--border-soft)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]'
            )}
          >
            <Filter size={14} />
            Filters{activeFilters > 0 && ` (${activeFilters})`}
          </button>
          <button
            onClick={() => setShowImportModal(true)}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--border-soft)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
          >
            <Upload size={14} />
            Import CSV
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-xs font-medium text-[var(--accent-contrast)] cursor-pointer"
            style={{ backgroundColor: 'var(--accent-strong)' }}
          >
            <Plus size={14} />
            Add Deadline
          </button>
        </div>
      </div>

      {importMessage && (
        <div
          className={cn(
            'flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm',
            importStatus === 'success'
              ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100'
              : 'border-amber-400/20 bg-amber-400/10 text-amber-100'
          )}
        >
          {importStatus === 'success' ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <AlertCircle size={16} className="mt-0.5 shrink-0" />}
          <div className="flex-1">{importMessage}</div>
          <button
            onClick={() => { setImportMessage(null); setImportStatus('idle'); }}
            className="text-xs opacity-80 transition hover:opacity-100"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] px-4 py-3">
          <div className="text-[10px] uppercase tracking-wide text-[var(--text-faint)]">Upcoming</div>
          <div className="mt-1 text-lg font-semibold text-[var(--text-primary)]">{upcomingCount}</div>
        </div>
        <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] px-4 py-3">
          <div className="text-[10px] uppercase tracking-wide text-[var(--text-faint)]">In progress</div>
          <div className="mt-1 text-lg font-semibold text-blue-400">{inProgressCount}</div>
        </div>
        <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] px-4 py-3">
          <div className="text-[10px] uppercase tracking-wide text-[var(--text-faint)]">Overdue</div>
          <div className="mt-1 text-lg font-semibold text-red-400">{overdueCount}</div>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search titles, notes, type, or course..."
            className="w-full rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] py-2.5 pl-9 pr-4 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
          />
        </div>
        {activeFilters > 0 && (
          <button
            onClick={() => { setSearch(''); setFilterCourse(''); setFilterType(''); setFilterStatus(''); setQuickFilter('all'); }}
            className="rounded-xl border border-[var(--border-soft)] px-4 py-2.5 text-sm text-[var(--text-secondary)] transition hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
          >
            Clear filters
          </button>
        )}
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {([
            { value: 'all', label: 'All' },
            { value: 'today', label: 'Today' },
            { value: 'this-week', label: 'This Week' },
            { value: 'overdue', label: 'Overdue' },
          ] as { value: DeadlineQuickFilter; label: string }[]).map(option => (
            <button
              key={option.value}
              type="button"
              onClick={() => setQuickFilter(option.value)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-xs font-medium transition',
                quickFilter === option.value
                  ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                  : 'border-[var(--border-soft)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]'
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setViewMode('table')}
            className={cn(
              'rounded-lg border px-3 py-1.5 text-xs font-medium transition',
              viewMode === 'table'
                ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                : 'border-[var(--border-soft)] text-[var(--text-secondary)]'
            )}
          >
            Table
          </button>
          <button
            type="button"
            onClick={() => setViewMode('compact')}
            className={cn(
              'rounded-lg border px-3 py-1.5 text-xs font-medium transition',
              viewMode === 'compact'
                ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                : 'border-[var(--border-soft)] text-[var(--text-secondary)]'
            )}
          >
            Compact
          </button>
          <button
            type="button"
            onClick={() => setViewMode('course')}
            className={cn(
              'rounded-lg border px-3 py-1.5 text-xs font-medium transition',
              viewMode === 'course'
                ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                : 'border-[var(--border-soft)] text-[var(--text-secondary)]'
            )}
          >
            By Course
          </button>
        </div>
      </div>

      {/* Filters */}
      {showFilters && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] p-3">
          <select
            value={filterCourse}
            onChange={e => setFilterCourse(e.target.value)}
            className="rounded-md border border-[var(--border-soft)] bg-[var(--surface-muted)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)] focus:border-[var(--accent)] focus:outline-none"
          >
            <option value="">All Courses</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <select
            value={filterType}
            onChange={e => setFilterType(e.target.value)}
            className="rounded-md border border-[var(--border-soft)] bg-[var(--surface-muted)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)] focus:border-[var(--accent)] focus:outline-none"
          >
            <option value="">All Types</option>
            {TYPE_OPTIONS.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            className="rounded-md border border-[var(--border-soft)] bg-[var(--surface-muted)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)] focus:border-[var(--accent)] focus:outline-none"
          >
            <option value="">All Statuses</option>
            {STATUS_OPTIONS.map(s => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          {activeFilters > 0 && <span className="text-xs text-[var(--text-faint)]">Refine the list with filters above.</span>}
        </div>
      )}

      {viewMode === 'course' ? (
        <div className="space-y-4">
          {Object.entries(groupedByCourse).length === 0 ? (
            <div className="rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] px-4 py-10 text-center text-sm text-[var(--text-faint)]">
              No deadlines match your filters.
            </div>
          ) : (
            Object.entries(groupedByCourse).map(([courseName, courseDeadlines]) => (
              <div key={courseName} className="rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)]">
                <div className="flex items-center justify-between border-b border-[var(--border-soft)] px-4 py-3">
                  <div>
                    <div className="text-sm font-semibold text-[var(--text-primary)]">{courseName}</div>
                    <div className="mt-0.5 text-xs text-[var(--text-faint)]">{courseDeadlines.length} deadlines</div>
                  </div>
                  {courseDeadlines[0]?.projectId && (
                    <button
                      type="button"
                      onClick={() => onNavigateToCourse?.(courseDeadlines[0].projectId!)}
                      className="text-xs font-medium text-[var(--accent)] transition hover:underline"
                    >
                      Open course
                    </button>
                  )}
                </div>
                <div className="divide-y divide-[var(--border-soft)]">
                  {courseDeadlines.map(dl => (
                    <button
                      key={dl.id}
                      type="button"
                      onClick={() => setDetailId(dl.id)}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-[var(--surface-muted)]"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-[var(--text-primary)]">{dl.title}</div>
                        <div className="mt-1 flex flex-wrap gap-2 text-xs text-[var(--text-faint)]">
                          <span>{formatDate(dl.dueDate)}</span>
                          {dl.dueTime && <span>{formatTime(dl.dueTime)}</span>}
                          <span className="uppercase tracking-wide">{dl.type}</span>
                        </div>
                      </div>
                      <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium', statusMeta(dl.status).color)}>
                        {statusMeta(dl.status).label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
      <>
      <div className="grid gap-3 md:hidden">
        {filtered.length === 0 ? (
          <div className="rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] px-4 py-10 text-center text-sm text-[var(--text-faint)]">
            {deadlines.length === 0 ? 'No deadlines yet. Click "Add Deadline" to get started.' : 'No deadlines match your filters.'}
          </div>
        ) : (
          filtered.map(dl => {
            const project = projects.find(p => p.id === dl.projectId);
            const days = daysUntil(dl.dueDate);
            const sm = statusMeta(dl.status);
            const isOverdue = days < 0 && dl.status !== 'done' && dl.status !== 'missed';

            return (
              <button
                key={dl.id}
                type="button"
                onClick={() => setDetailId(dl.id)}
                className="rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] p-4 text-left transition hover:border-[var(--border-strong)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-[var(--text-primary)]">{dl.title}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--text-faint)]">
                      {project && <span>{project.name}</span>}
                      <span className="uppercase tracking-wide">{dl.type}</span>
                    </div>
                  </div>
                  <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', sm.color)}>{sm.label}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <span className={cn(isOverdue ? 'text-red-400' : 'text-[var(--text-secondary)]')}>{formatDate(dl.dueDate)}</span>
                  {dl.dueTime && <span className="text-[var(--text-faint)]">{formatTime(dl.dueTime)}</span>}
                  {dl.linkedTaskIds.length > 0 && <span className="text-indigo-400">{dl.linkedTaskIds.length} linked</span>}
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* Table */}
      <div className="hidden overflow-hidden rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] md:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-[var(--border-soft)] bg-[var(--surface-muted)]/95 backdrop-blur">
                <th className="w-10 px-3 py-2.5" />
                <th
                  className="px-3 py-2.5 text-left text-xs font-medium text-[var(--text-muted)] cursor-pointer select-none"
                  onClick={() => handleSort('status')}
                >
                  <span className="flex items-center gap-1">Status <SortIcon field="status" /></span>
                </th>
                <th
                  className="px-3 py-2.5 text-left text-xs font-medium text-[var(--text-muted)] cursor-pointer select-none"
                  onClick={() => handleSort('course')}
                >
                  <span className="flex items-center gap-1">Course <SortIcon field="course" /></span>
                </th>
                <th
                  className="px-3 py-2.5 text-left text-xs font-medium text-[var(--text-muted)] cursor-pointer select-none"
                  onClick={() => handleSort('dueDate')}
                >
                  <span className="flex items-center gap-1">Date <SortIcon field="dueDate" /></span>
                </th>
                <th className="px-3 py-2.5 text-left text-xs font-medium text-[var(--text-muted)]">Time</th>
                <th
                  className="px-3 py-2.5 text-left text-xs font-medium text-[var(--text-muted)] cursor-pointer select-none"
                  onClick={() => handleSort('title')}
                >
                  <span className="flex items-center gap-1">Title <SortIcon field="title" /></span>
                </th>
                <th
                  className="px-3 py-2.5 text-left text-xs font-medium text-[var(--text-muted)] cursor-pointer select-none"
                  onClick={() => handleSort('type')}
                >
                  <span className="flex items-center gap-1">Type <SortIcon field="type" /></span>
                </th>
                <th className="px-3 py-2.5 text-left text-xs font-medium text-[var(--text-muted)]">Notes</th>
                <th className="px-3 py-2.5 text-left text-xs font-medium text-[var(--text-muted)]">Links</th>
                <th className="w-10 px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-sm text-[var(--text-faint)]">
                    {deadlines.length === 0 ? 'No deadlines yet. Click "Add Deadline" to get started.' : 'No deadlines match your filters.'}
                  </td>
                </tr>
              ) : (
                filtered.map(dl => {
                  const project = projects.find(p => p.id === dl.projectId);
                  const days = daysUntil(dl.dueDate);
                  const sm = statusMeta(dl.status);
                  const isOverdue = days < 0 && dl.status !== 'done' && dl.status !== 'missed';

                  return (
                    <tr
                      key={dl.id}
                      className={cn(
                        'border-b border-[var(--border-soft)] last:border-b-0 transition-colors hover:bg-[var(--surface-muted)] group',
                        dl.status === 'done' && 'opacity-60',
                        viewMode === 'compact' && 'text-xs'
                      )}
                    >
                      <td className="px-3 py-2.5">
                        <button
                          onClick={() => setDetailId(dl.id)}
                          className="text-[var(--text-faint)] hover:text-[var(--accent)] transition opacity-0 group-hover:opacity-100"
                        >
                          <Pencil size={13} />
                        </button>
                      </td>
                      <td className="px-3 py-2.5">
                        <select
                          value={dl.status}
                          onChange={e => onUpdate(dl.id, { status: e.target.value as DeadlineStatus })}
                          className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium border-0 cursor-pointer focus:outline-none', sm.color)}
                        >
                          {STATUS_OPTIONS.map(s => (
                            <option key={s.value} value={s.value}>{s.label}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2.5">
                        {project ? (
                          <button
                            type="button"
                            onClick={() => onNavigateToCourse?.(project.id)}
                            className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] transition hover:text-[var(--accent)]"
                          >
                            <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: project.color }} />
                            <span className="truncate max-w-[100px]">{project.name}</span>
                          </button>
                        ) : (
                          <span className="text-xs text-[var(--text-faint)]">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span className={cn('text-xs', isOverdue ? 'text-red-400 font-medium' : 'text-[var(--text-secondary)]')}>
                          {formatDate(dl.dueDate)}
                        </span>
                        {dl.status !== 'done' && dl.status !== 'missed' && (
                          <span className={cn(
                            'ml-1.5 text-[10px]',
                            days < 0 ? 'text-red-400' : days <= 2 ? 'text-yellow-400' : 'text-[var(--text-faint)]'
                          )}>
                            {days === 0 ? 'today' : days === 1 ? 'tmrw' : days < 0 ? `${Math.abs(days)}d ago` : `${days}d`}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-[var(--text-faint)]">
                        {dl.dueTime ? formatTime(dl.dueTime) : '—'}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <span className={cn('text-sm', dl.status === 'done' ? 'text-[var(--text-faint)] line-through' : 'text-[var(--text-primary)]')}>
                            {dl.title}
                          </span>
                          {dl.sourceType !== 'manual' && (
                            <span className="shrink-0 rounded bg-orange-500/10 px-1.5 py-0.5 text-[9px] font-medium text-orange-400" title={dl.sourceUrl ?? undefined}>
                              Canvas
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-faint)]">
                          {dl.type}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        {dl.notes ? (
                          <span className="flex items-center gap-1 text-xs text-[var(--text-faint)]" title={dl.notes}>
                            <StickyNote size={11} />
                            <span className="truncate max-w-[120px]">{dl.notes}</span>
                          </span>
                        ) : (
                          <span className="text-xs text-[var(--text-faint)]">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {dl.linkedTaskIds.length > 0 ? (
                          <button
                            type="button"
                            onClick={() => dl.projectId && onNavigateToTasks?.(dl.projectId)}
                            className="flex items-center gap-1 text-xs text-indigo-400 transition hover:underline"
                          >
                            <Link2 size={11} />
                            {dl.linkedTaskIds.length}
                          </button>
                        ) : (
                          <span className="text-xs text-[var(--text-faint)]">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <button
                          onClick={() => onDelete(dl.id)}
                          className="text-[var(--text-faint)] hover:text-red-400 transition opacity-0 group-hover:opacity-100"
                        >
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
      </>
      )}

      {/* Summary footer */}
      <div className="flex flex-wrap gap-4 text-xs text-[var(--text-faint)]">
        <span>{deadlines.length} total</span>
        <span>{deadlines.filter(d => d.status === 'not-started').length} not started</span>
        <span>{deadlines.filter(d => d.status === 'in-progress').length} in progress</span>
        <span>{deadlines.filter(d => d.status === 'done').length} done</span>
        <span className="text-red-400">{deadlines.filter(d => daysUntil(d.dueDate) < 0 && d.status !== 'done' && d.status !== 'missed').length} overdue</span>
      </div>

      {/* Add Modal */}
      {showAddModal && (
        <AddDeadlineModal
          projects={projects}
          onAdd={async (title, projectId, type, dueDate, dueTime, notes) => {
            const ok = await onAdd(title, projectId, type, dueDate, dueTime, notes);
            if (ok) setShowAddModal(false);
          }}
          onClose={() => setShowAddModal(false)}
        />
      )}

      {showImportModal && (
        <ImportDeadlinesModal
          existingDeadlines={deadlines}
          existingProjects={projects}
          onImport={handleImport}
          onClose={() => setShowImportModal(false)}
        />
      )}

      {/* Detail Modal */}
      {detailDeadline && (
        <DeadlineDetailModal
          deadline={detailDeadline}
          projects={projects}
          tasks={tasks}
          onUpdate={async (updates) => {
            return onUpdate(detailDeadline.id, updates);
          }}
          onLinkTask={(taskId) => onLinkTask(detailDeadline.id, taskId)}
          onUnlinkTask={(taskId) => onUnlinkTask(detailDeadline.id, taskId)}
          onCreateTask={async (title) => {
            const taskId = await onCreateTask(title, '', detailDeadline.projectId, detailDeadline.dueDate);
            if (taskId) {
              await onLinkTask(detailDeadline.id, taskId);
            }
            return !!taskId;
          }}
          onNavigateToCourse={onNavigateToCourse}
          onNavigateToTasks={onNavigateToTasks}
          onClose={() => setDetailId(null)}
        />
      )}
    </div>
  );
}

function ImportDeadlinesModal({ existingDeadlines, existingProjects, onImport, onClose }: {
  existingDeadlines: Deadline[];
  existingProjects: Project[];
  onImport: (preview: ImportPreview) => Promise<void>;
  onClose: () => void;
}) {
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const existingSignatures = useMemo(() => {
    return new Set(
      existingDeadlines.map(deadline => {
        const courseName = existingProjects.find(project => project.id === deadline.projectId)?.name ?? '';
        return buildDeadlineSignature(courseName, deadline.title, deadline.dueDate, deadline.dueTime);
      })
    );
  }, [existingDeadlines, existingProjects]);

  const duplicateCount = useMemo(() => {
    if (!preview) return 0;
    return preview.rows.filter(row =>
      existingSignatures.has(buildDeadlineSignature(row.course, row.title, row.dueDate, row.dueTime))
    ).length;
  }, [existingSignatures, preview]);

  const handleFile = async (file: File | null) => {
    if (!file) return;
    setIsParsing(true);
    setError(null);

    try {
      const text = await file.text();
      setPreview(parseDeadlineCsv(file.name, text));
    } catch (err) {
      setPreview(null);
      setError(err instanceof Error ? err.message : 'Could not parse the CSV file.');
    } finally {
      setIsParsing(false);
    }
  };

  const handleImport = async () => {
    if (!preview) return;
    setIsImporting(true);
    setError(null);

    try {
      await onImport(preview);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed.');
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-3xl rounded-2xl border border-[var(--border-soft)] bg-[var(--surface-elevated)] shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[var(--border-soft)] px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">Import Deadlines from CSV</h2>
            <p className="mt-1 text-sm text-[var(--text-muted)]">Upload your semester tracker and we’ll map it into Deadlines and Courses.</p>
          </div>
          <button onClick={onClose} className="text-[var(--text-faint)] transition hover:text-[var(--text-primary)]">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <label className="block rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--surface)] p-6 text-center transition hover:border-[var(--accent)]">
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={e => void handleFile(e.target.files?.[0] ?? null)}
            />
            <Upload size={20} className="mx-auto mb-2 text-[var(--text-faint)]" />
            <div className="text-sm font-medium text-[var(--text-primary)]">Choose a CSV file</div>
            <div className="mt-1 text-xs text-[var(--text-faint)]">Expected columns: Status, Course, Date, Time, Title, Type, Notes</div>
          </label>

          {isParsing && (
            <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text-muted)]">
              Reading your file...
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
              {error}
            </div>
          )}

          {preview && (
            <>
              <div className="grid gap-3 sm:grid-cols-4">
                <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] px-4 py-3">
                  <div className="text-xs text-[var(--text-faint)]">File</div>
                  <div className="mt-1 truncate text-sm font-medium text-[var(--text-primary)]">{preview.fileName}</div>
                </div>
                <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] px-4 py-3">
                  <div className="text-xs text-[var(--text-faint)]">Rows ready</div>
                  <div className="mt-1 text-sm font-medium text-[var(--text-primary)]">{preview.rows.length}</div>
                </div>
                <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] px-4 py-3">
                  <div className="text-xs text-[var(--text-faint)]">Duplicates</div>
                  <div className="mt-1 text-sm font-medium text-[var(--text-primary)]">{duplicateCount}</div>
                </div>
                <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] px-4 py-3">
                  <div className="text-xs text-[var(--text-faint)]">Invalid rows</div>
                  <div className="mt-1 text-sm font-medium text-[var(--text-primary)]">{preview.skippedRows.length}</div>
                </div>
              </div>

              <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface)]">
                <div className="border-b border-[var(--border-soft)] px-4 py-3 text-sm font-medium text-[var(--text-primary)]">
                  Preview
                </div>
                <div className="max-h-72 overflow-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--border-soft)] bg-[var(--surface-muted)] text-left text-xs text-[var(--text-muted)]">
                        <th className="px-3 py-2">Course</th>
                        <th className="px-3 py-2">Date</th>
                        <th className="px-3 py-2">Time</th>
                        <th className="px-3 py-2">Title</th>
                        <th className="px-3 py-2">Type</th>
                        <th className="px-3 py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.slice(0, 8).map((row, index) => (
                        <tr key={`${row.title}-${index}`} className="border-b border-[var(--border-soft)] last:border-b-0">
                          <td className="px-3 py-2 text-[var(--text-secondary)]">{row.course || '—'}</td>
                          <td className="px-3 py-2 text-[var(--text-secondary)]">{formatDate(row.dueDate)}</td>
                          <td className="px-3 py-2 text-[var(--text-faint)]">{row.dueTime ? formatTime(row.dueTime) : '—'}</td>
                          <td className="px-3 py-2 text-[var(--text-primary)]">{row.title}</td>
                          <td className="px-3 py-2 text-[var(--text-faint)] uppercase">{row.type}</td>
                          <td className="px-3 py-2 text-[var(--text-faint)]">{statusMeta(row.status).label}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {preview.rows.length > 8 && (
                  <div className="border-t border-[var(--border-soft)] px-4 py-2 text-xs text-[var(--text-faint)]">
                    Showing 8 of {preview.rows.length} rows.
                  </div>
                )}
              </div>

              {preview.skippedRows.length > 0 && (
                <div className="rounded-xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
                  <div className="font-medium">Some rows will be skipped</div>
                  <ul className="mt-2 space-y-1 text-xs text-amber-100/90">
                    {preview.skippedRows.slice(0, 5).map(message => (
                      <li key={message}>{message}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex gap-3 border-t border-[var(--border-soft)] px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-[var(--border-soft)] py-2.5 text-sm font-medium text-[var(--text-secondary)] transition hover:bg-[var(--surface-muted)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleImport()}
            disabled={!preview || isImporting}
            className="flex-1 rounded-lg py-2.5 text-sm font-medium text-[var(--accent-contrast)] transition disabled:cursor-not-allowed disabled:opacity-40"
            style={{ backgroundColor: 'var(--accent-strong)' }}
          >
            {isImporting ? 'Importing...' : 'Import Deadlines'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Add Deadline Modal ─── */

function AddDeadlineModal({ projects, onAdd, onClose }: {
  projects: Project[];
  onAdd: (title: string, projectId: string | null, type: DeadlineType, dueDate: string, dueTime: string | null, notes: string) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState('');
  const [projectId, setProjectId] = useState('');
  const [type, setType] = useState<DeadlineType>('assignment');
  const [dueDate, setDueDate] = useState('');
  const [dueTime, setDueTime] = useState('');
  const [notes, setNotes] = useState('');

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-[var(--border-soft)] bg-[var(--surface-elevated)] shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[var(--border-soft)] px-5 py-4">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">New Deadline</h2>
          <button onClick={onClose} className="text-[var(--text-faint)] hover:text-[var(--text-primary)]"><X size={18} /></button>
        </div>
        <form
          onSubmit={e => { e.preventDefault(); if (title.trim() && dueDate) onAdd(title.trim(), projectId || null, type, dueDate, dueTime || null, notes.trim()); }}
          className="p-5 space-y-4"
        >
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">Title *</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. CS 1332 Exam 1"
              autoFocus
              className="w-full rounded-lg border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">Course</label>
              <select
                value={projectId}
                onChange={e => setProjectId(e.target.value)}
                className="w-full cursor-pointer appearance-none rounded-lg border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text-secondary)] focus:border-[var(--accent)] focus:outline-none"
              >
                <option value="">No Course</option>
                {projects.map(p => (<option key={p.id} value={p.id}>{p.name}</option>))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">Type</label>
              <select
                value={type}
                onChange={e => setType(e.target.value as DeadlineType)}
                className="w-full cursor-pointer appearance-none rounded-lg border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text-secondary)] focus:border-[var(--accent)] focus:outline-none"
              >
                {TYPE_OPTIONS.map(t => (<option key={t.value} value={t.value}>{t.label}</option>))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">Due Date *</label>
              <input
                type="date"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
                className="w-full rounded-md border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-1.5 text-sm text-[var(--text-secondary)] focus:border-[var(--accent)] focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">Due Time</label>
              <input
                type="time"
                value={dueTime}
                onChange={e => setDueTime(e.target.value)}
                className="w-full rounded-md border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-1.5 text-sm text-[var(--text-secondary)] focus:border-[var(--accent)] focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Add details, room number, topics..."
              rows={2}
              className="w-full resize-none rounded-lg border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
            />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-[var(--border-soft)] py-2.5 text-sm font-medium text-[var(--text-secondary)] transition hover:bg-[var(--surface-muted)]">
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim() || !dueDate}
              className="flex-1 rounded-lg py-2.5 text-sm font-medium text-[var(--accent-contrast)] transition disabled:cursor-not-allowed disabled:opacity-40"
              style={{ backgroundColor: 'var(--accent-strong)' }}
            >
              Add Deadline
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─── Deadline Detail Modal ─── */

function DeadlineDetailModal({ deadline, projects, tasks, onUpdate, onLinkTask, onUnlinkTask, onCreateTask, onNavigateToCourse, onNavigateToTasks, onClose }: {
  deadline: Deadline;
  projects: Project[];
  tasks: Task[];
  onUpdate: (updates: Partial<Pick<Deadline, 'title' | 'projectId' | 'status' | 'type' | 'dueDate' | 'dueTime' | 'notes'>>) => Promise<boolean>;
  onLinkTask: (taskId: string) => Promise<boolean>;
  onUnlinkTask: (taskId: string) => void;
  onCreateTask: (title: string) => Promise<boolean>;
  onNavigateToCourse?: (projectId: string) => void;
  onNavigateToTasks?: (projectId: string) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(deadline.title);
  const [projectId, setProjectId] = useState(deadline.projectId ?? '');
  const [type, setType] = useState<DeadlineType>(deadline.type);
  const [status, setStatus] = useState<DeadlineStatus>(deadline.status);
  const [dueDate, setDueDate] = useState(deadline.dueDate);
  const [dueTime, setDueTime] = useState(deadline.dueTime ?? '');
  const [notes, setNotes] = useState(deadline.notes);
  const [isSaving, setIsSaving] = useState(false);
  const [linkDropdown, setLinkDropdown] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [isCreatingTask, setIsCreatingTask] = useState(false);

  const linkedTasks = tasks.filter(t => deadline.linkedTaskIds.includes(t.id));
  const availableTasks = tasks.filter(t => !deadline.linkedTaskIds.includes(t.id));
  const project = projects.find(p => p.id === deadline.projectId);

  const handleSave = async () => {
    if (!title.trim() || !dueDate || isSaving) return;
    setIsSaving(true);
    const ok = await onUpdate({
      title: title.trim(),
      projectId: projectId || null,
      status,
      type,
      dueDate,
      dueTime: dueTime || null,
      notes: notes.trim(),
    });
    setIsSaving(false);
    if (ok) onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl border border-[var(--border-soft)] bg-[var(--surface-elevated)] shadow-2xl max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[var(--border-soft)] px-5 py-4">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">Deadline Details</h2>
            {project && (
              <span className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ backgroundColor: project.color + '20', color: project.color }}>
                <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: project.color }} />
                {project.name}
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-[var(--text-faint)] hover:text-[var(--text-primary)]"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          {project && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onNavigateToCourse?.(project.id)}
                className="rounded-lg border border-[var(--border-soft)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition hover:border-[var(--border-strong)] hover:text-[var(--accent)]"
              >
                Open course
              </button>
              <button
                type="button"
                onClick={() => onNavigateToTasks?.(project.id)}
                className="rounded-lg border border-[var(--border-soft)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition hover:border-[var(--border-strong)] hover:text-[var(--accent)]"
              >
                View course tasks
              </button>
            </div>
          )}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">Title</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="w-full rounded-lg border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">Status</label>
              <select
                value={status}
                onChange={e => setStatus(e.target.value as DeadlineStatus)}
                className="w-full cursor-pointer appearance-none rounded-lg border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text-secondary)] focus:border-[var(--accent)] focus:outline-none"
              >
                {STATUS_OPTIONS.map(s => (<option key={s.value} value={s.value}>{s.label}</option>))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">Type</label>
              <select
                value={type}
                onChange={e => setType(e.target.value as DeadlineType)}
                className="w-full cursor-pointer appearance-none rounded-lg border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text-secondary)] focus:border-[var(--accent)] focus:outline-none"
              >
                {TYPE_OPTIONS.map(t => (<option key={t.value} value={t.value}>{t.label}</option>))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">Course</label>
              <select
                value={projectId}
                onChange={e => setProjectId(e.target.value)}
                className="w-full cursor-pointer appearance-none rounded-lg border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text-secondary)] focus:border-[var(--accent)] focus:outline-none"
              >
                <option value="">No Course</option>
                {projects.map(p => (<option key={p.id} value={p.id}>{p.name}</option>))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">Date</label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={e => setDueDate(e.target.value)}
                  className="w-full rounded-md border border-[var(--border-soft)] bg-[var(--surface-muted)] px-2 py-1.5 text-xs text-[var(--text-secondary)] focus:border-[var(--accent)] focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">Time</label>
                <input
                  type="time"
                  value={dueTime}
                  onChange={e => setDueTime(e.target.value)}
                  className="w-full rounded-md border border-[var(--border-soft)] bg-[var(--surface-muted)] px-2 py-1.5 text-xs text-[var(--text-secondary)] focus:border-[var(--accent)] focus:outline-none"
                />
              </div>
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Add details..."
              rows={3}
              className="w-full resize-none rounded-lg border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
            />
          </div>

          {/* Linked Tasks */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-[var(--text-muted)]">Linked Tasks</label>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setLinkDropdown(v => !v)}
                  className="flex items-center gap-1 text-[10px] text-[var(--accent)] hover:underline"
                >
                  <Link2 size={10} /> Link a task
                </button>
                {linkDropdown && availableTasks.length > 0 && (
                  <div className="absolute right-0 top-full mt-1 z-10 w-56 rounded-lg border border-[var(--border-soft)] bg-[var(--surface-elevated)] shadow-lg max-h-40 overflow-y-auto">
                    {availableTasks.map(t => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={async () => {
                          await onLinkTask(t.id);
                          setLinkDropdown(false);
                        }}
                        className="w-full text-left px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-muted)] transition truncate"
                      >
                        {t.title}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {/* Create new linked task */}
            <div className="flex items-center gap-2 mb-2">
              <input
                type="text"
                value={newTaskTitle}
                onChange={e => setNewTaskTitle(e.target.value)}
                onKeyDown={async e => {
                  if (e.key === 'Enter' && newTaskTitle.trim() && !isCreatingTask) {
                    e.preventDefault();
                    setIsCreatingTask(true);
                    const ok = await onCreateTask(newTaskTitle.trim());
                    if (ok) setNewTaskTitle('');
                    setIsCreatingTask(false);
                  }
                }}
                placeholder="Create a linked task..."
                className="flex-1 rounded-md border border-[var(--border-soft)] bg-[var(--surface-muted)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
              />
              <button
                type="button"
                disabled={!newTaskTitle.trim() || isCreatingTask}
                onClick={async () => {
                  if (!newTaskTitle.trim() || isCreatingTask) return;
                  setIsCreatingTask(true);
                  const ok = await onCreateTask(newTaskTitle.trim());
                  if (ok) setNewTaskTitle('');
                  setIsCreatingTask(false);
                }}
                className="rounded-md border border-[var(--border-soft)] p-1.5 text-[var(--text-faint)] transition hover:border-[var(--border-strong)] hover:text-[var(--accent)] disabled:opacity-40"
              >
                <Plus size={12} />
              </button>
            </div>
            <div className="space-y-1.5">
              {linkedTasks.map(t => (
                <div key={t.id} className="flex items-center justify-between rounded-md bg-[var(--surface-muted)] px-2.5 py-1.5 group">
                  <span className="text-xs text-[var(--text-secondary)] truncate">{t.title}</span>
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      'text-[9px] font-medium px-1.5 py-0.5 rounded-full',
                      t.status === 'done' ? 'text-emerald-400 bg-emerald-400/10' : t.status === 'in-progress' ? 'text-blue-400 bg-blue-400/10' : 'text-[var(--text-faint)] bg-[var(--surface-muted)]'
                    )}>
                      {t.status === 'in-progress' ? 'In Progress' : t.status === 'todo' ? 'To Do' : 'Done'}
                    </span>
                    <button
                      type="button"
                      onClick={() => onUnlinkTask(t.id)}
                      className="text-[var(--text-faint)] opacity-0 group-hover:opacity-100 hover:text-red-400 transition"
                    >
                      <X size={11} />
                    </button>
                  </div>
                </div>
              ))}
              {linkedTasks.length === 0 && (
                <p className="text-[10px] text-[var(--text-faint)] py-1">No linked tasks. Link existing tasks or create new ones from here.</p>
              )}
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-[var(--border-soft)] py-2.5 text-sm font-medium text-[var(--text-secondary)] transition hover:bg-[var(--surface-muted)]">
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!title.trim() || !dueDate || isSaving}
              className="flex-1 rounded-lg py-2.5 text-sm font-medium text-[var(--accent-contrast)] transition disabled:cursor-not-allowed disabled:opacity-40"
              style={{ backgroundColor: 'var(--accent-strong)' }}
            >
              {isSaving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
