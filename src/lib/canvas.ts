// Canvas LMS API client.
// All requests go through the Supabase Edge Function (canvas-proxy) to avoid CORS.
// The proxy looks up the user's stored Canvas credentials server-side.

import { supabase } from './supabase';

// --- Canvas API response types ---

export interface CanvasCourse {
  id: number;
  name: string;
  course_code: string;
  enrollment_term_id?: number;
  term?: { name: string };
  workflow_state: string;
}

export interface CanvasAssignment {
  id: number;
  name: string;
  description: string | null;
  due_at: string | null;
  html_url: string;
  course_id: number;
  submission_types: string[];
  is_quiz_assignment: boolean;
  has_submitted_submissions?: boolean;
  workflow_state: string;
}

export interface CanvasQuiz {
  id: number;
  title: string;
  description: string | null;
  due_at: string | null;
  html_url: string;
  quiz_type: string; // 'practice_quiz' | 'assignment' | 'graded_survey' | 'survey'
}

// --- Proxy helper ---

async function canvasProxy<T>(path: string): Promise<T> {
  if (!supabase) throw new Error('Supabase not configured');

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const response = await fetch(`${supabaseUrl}/functions/v1/canvas-proxy`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ path }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Canvas request failed' }));
    throw new Error(err.error || `Canvas API error (${response.status})`);
  }

  return response.json() as Promise<T>;
}

// --- API functions ---

export async function fetchCanvasCourses(): Promise<CanvasCourse[]> {
  const courses = await canvasProxy<CanvasCourse[]>(
    '/api/v1/courses?enrollment_state=active&per_page=100&include[]=term'
  );
  // Filter to actual courses (not concluded/deleted)
  return courses.filter(c => c.workflow_state === 'available');
}

export async function fetchCanvasAssignments(courseId: number): Promise<CanvasAssignment[]> {
  const assignments = await canvasProxy<CanvasAssignment[]>(
    `/api/v1/courses/${courseId}/assignments?per_page=100&order_by=due_at`
  );
  // Only include published assignments
  return assignments.filter(a => a.workflow_state === 'published');
}

export async function fetchCanvasQuizzes(courseId: number): Promise<CanvasQuiz[]> {
  return canvasProxy<CanvasQuiz[]>(
    `/api/v1/courses/${courseId}/quizzes?per_page=100`
  );
}

// --- Validation ---

export async function validateCanvasConnection(): Promise<{ valid: boolean; error?: string }> {
  try {
    await canvasProxy<unknown>('/api/v1/users/self');
    return { valid: true };
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : 'Connection failed' };
  }
}
