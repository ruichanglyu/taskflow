import { useEffect, useRef, useCallback } from 'react';
import { Task } from '../types';

function getPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) return Promise.resolve('denied' as NotificationPermission);
  if (Notification.permission === 'granted') return Promise.resolve('granted');
  if (Notification.permission === 'denied') return Promise.resolve('denied');
  return Notification.requestPermission();
}

export function useNotifications(tasks: Task[]) {
  const notifiedRef = useRef<Set<string>>(new Set());

  const requestPermission = useCallback(async () => {
    return getPermission();
  }, []);

  useEffect(() => {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    const now = new Date();
    const oneDayMs = 86400000;

    for (const task of tasks) {
      if (task.status === 'done' || !task.dueDate) continue;
      const due = new Date(task.dueDate);
      const diff = due.getTime() - now.getTime();
      const key = `${task.id}-${task.dueDate}`;

      // Overdue
      if (diff < 0 && !notifiedRef.current.has(`overdue-${key}`)) {
        notifiedRef.current.add(`overdue-${key}`);
        new Notification('Task Overdue', {
          body: `"${task.title}" was due ${formatTimeAgo(due)}`,
          icon: '/favicon.ico',
          tag: `overdue-${task.id}`,
        });
      }
      // Due within 24 hours
      else if (diff > 0 && diff < oneDayMs && !notifiedRef.current.has(`soon-${key}`)) {
        notifiedRef.current.add(`soon-${key}`);
        new Notification('Task Due Soon', {
          body: `"${task.title}" is due ${formatTimeUntil(due)}`,
          icon: '/favicon.ico',
          tag: `soon-${task.id}`,
        });
      }
    }
  }, [tasks]);

  return { requestPermission };
}

function formatTimeAgo(date: Date): string {
  const diff = Date.now() - date.getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatTimeUntil(date: Date): string {
  const diff = date.getTime() - Date.now();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return 'in less than 1h';
  if (hours < 24) return `in ${hours}h`;
  return 'tomorrow';
}
