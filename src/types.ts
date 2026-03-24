export type Priority = 'low' | 'medium' | 'high';
export type TaskStatus = 'todo' | 'in-progress' | 'done';
export type Recurrence = 'none' | 'daily' | 'weekly' | 'monthly';
export type DeadlineStatus = 'not-started' | 'in-progress' | 'done' | 'missed';
export type DeadlineType = 'assignment' | 'exam' | 'quiz' | 'lab' | 'project' | 'other';
export type DeadlineSource = 'manual' | 'canvas_assignment' | 'canvas_quiz';
export type View = 'dashboard' | 'tasks' | 'projects' | 'calendar' | 'timeline' | 'deadlines';

export interface Subtask {
  id: string;
  taskId: string;
  title: string;
  done: boolean;
  position: number;
}

export interface TaskComment {
  id: string;
  taskId: string;
  text: string;
  createdAt: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  projectId: string | null;
  createdAt: string;
  dueDate: string | null;
  recurrence: Recurrence;
  subtasks: Subtask[];
  comments: TaskComment[];
}

export interface Deadline {
  id: string;
  title: string;
  projectId: string | null;
  status: DeadlineStatus;
  type: DeadlineType;
  dueDate: string;
  dueTime: string | null;
  notes: string;
  createdAt: string;
  linkedTaskIds: string[];
  sourceType: DeadlineSource;
  sourceId: string | null;
  sourceUrl: string | null;
  sourceSyncedAt: string | null;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  color: string;
  createdAt: string;
  canvasCourseId: string | null;
}

export interface CanvasConnection {
  id: string;
  baseUrl: string;
  canvasUserId: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
}
