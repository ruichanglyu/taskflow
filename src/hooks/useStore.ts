import { useState, useEffect, useCallback } from 'react';
import { Task, Project, TaskStatus, Priority } from '../types';

const PROJECT_COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444', '#14b8a6'];

const STORAGE_KEY_TASKS = 'taskflow_tasks';
const STORAGE_KEY_PROJECTS = 'taskflow_projects';

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : fallback;
  } catch {
    return fallback;
  }
}

function saveToStorage<T>(key: string, data: T): void {
  localStorage.setItem(key, JSON.stringify(data));
}

// Seed data
const seedProjects: Project[] = [
  { id: 'p1', name: 'Website Redesign', description: 'Revamp the company website with modern design', color: '#6366f1', createdAt: new Date(Date.now() - 7 * 86400000).toISOString() },
  { id: 'p2', name: 'Mobile App', description: 'Build the React Native mobile application', color: '#ec4899', createdAt: new Date(Date.now() - 14 * 86400000).toISOString() },
  { id: 'p3', name: 'API Integration', description: 'Integrate third-party APIs and services', color: '#10b981', createdAt: new Date(Date.now() - 3 * 86400000).toISOString() },
];

const seedTasks: Task[] = [
  { id: 't1', title: 'Design homepage mockup', description: 'Create wireframes and high-fidelity mockups for the new homepage', status: 'done', priority: 'high', projectId: 'p1', createdAt: new Date(Date.now() - 6 * 86400000).toISOString(), dueDate: new Date(Date.now() - 1 * 86400000).toISOString() },
  { id: 't2', title: 'Set up CI/CD pipeline', description: 'Configure GitHub Actions for automated testing and deployment', status: 'in-progress', priority: 'high', projectId: 'p1', createdAt: new Date(Date.now() - 5 * 86400000).toISOString(), dueDate: new Date(Date.now() + 2 * 86400000).toISOString() },
  { id: 't3', title: 'User authentication flow', description: 'Implement login, signup, and password reset', status: 'in-progress', priority: 'high', projectId: 'p2', createdAt: new Date(Date.now() - 4 * 86400000).toISOString(), dueDate: new Date(Date.now() + 3 * 86400000).toISOString() },
  { id: 't4', title: 'Design system components', description: 'Build reusable UI components library', status: 'todo', priority: 'medium', projectId: 'p1', createdAt: new Date(Date.now() - 3 * 86400000).toISOString(), dueDate: new Date(Date.now() + 5 * 86400000).toISOString() },
  { id: 't5', title: 'Payment gateway integration', description: 'Integrate Stripe for payment processing', status: 'todo', priority: 'high', projectId: 'p3', createdAt: new Date(Date.now() - 2 * 86400000).toISOString(), dueDate: new Date(Date.now() + 7 * 86400000).toISOString() },
  { id: 't6', title: 'Write unit tests', description: 'Add comprehensive test coverage for core modules', status: 'todo', priority: 'medium', projectId: 'p2', createdAt: new Date(Date.now() - 1 * 86400000).toISOString(), dueDate: new Date(Date.now() + 10 * 86400000).toISOString() },
  { id: 't7', title: 'Performance optimization', description: 'Audit and optimize page load times and bundle size', status: 'todo', priority: 'low', projectId: 'p1', createdAt: new Date().toISOString(), dueDate: null },
  { id: 't8', title: 'Push notifications', description: 'Implement push notification service for mobile', status: 'todo', priority: 'medium', projectId: 'p2', createdAt: new Date().toISOString(), dueDate: new Date(Date.now() + 14 * 86400000).toISOString() },
  { id: 't9', title: 'API documentation', description: 'Write comprehensive API docs with examples', status: 'done', priority: 'low', projectId: 'p3', createdAt: new Date(Date.now() - 10 * 86400000).toISOString(), dueDate: new Date(Date.now() - 3 * 86400000).toISOString() },
];

export function useStore() {
  const [tasks, setTasks] = useState<Task[]>(() => loadFromStorage(STORAGE_KEY_TASKS, seedTasks));
  const [projects, setProjects] = useState<Project[]>(() => loadFromStorage(STORAGE_KEY_PROJECTS, seedProjects));

  useEffect(() => { saveToStorage(STORAGE_KEY_TASKS, tasks); }, [tasks]);
  useEffect(() => { saveToStorage(STORAGE_KEY_PROJECTS, projects); }, [projects]);

  const addTask = useCallback((title: string, description: string, priority: Priority, projectId: string | null, dueDate: string | null) => {
    const task: Task = {
      id: generateId(),
      title,
      description,
      status: 'todo',
      priority,
      projectId,
      createdAt: new Date().toISOString(),
      dueDate,
    };
    setTasks(prev => [task, ...prev]);
  }, []);

  const updateTaskStatus = useCallback((id: string, status: TaskStatus) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, status } : t));
  }, []);

  const deleteTask = useCallback((id: string) => {
    setTasks(prev => prev.filter(t => t.id !== id));
  }, []);

  const addProject = useCallback((name: string, description: string) => {
    const project: Project = {
      id: generateId(),
      name,
      description,
      color: PROJECT_COLORS[projects.length % PROJECT_COLORS.length],
      createdAt: new Date().toISOString(),
    };
    setProjects(prev => [project, ...prev]);
  }, [projects.length]);

  const deleteProject = useCallback((id: string) => {
    setProjects(prev => prev.filter(p => p.id !== id));
    setTasks(prev => prev.map(t => t.projectId === id ? { ...t, projectId: null } : t));
  }, []);

  return { tasks, projects, addTask, updateTaskStatus, deleteTask, addProject, deleteProject };
}
