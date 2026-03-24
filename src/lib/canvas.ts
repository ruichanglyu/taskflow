// Canvas LMS API client.
// All requests go through the Supabase Edge Function (canvas-proxy) to avoid CORS.
// Authentication uses OAuth2 — tokens are stored server-side only.

import { supabase } from './supabase';
import type { CanvasConnection } from '../types';

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

// --- OAuth2 ---

const CANVAS_CLIENT_ID = import.meta.env.VITE_CANVAS_CLIENT_ID as string | undefined;

/**
 * Build the Canvas OAuth2 authorization URL.
 * The user visits this to grant TaskFlow access. Canvas redirects back with ?code=...
 */
export function buildCanvasOAuthUrl(canvasBaseUrl: string): string | null {
  if (!CANVAS_CLIENT_ID) return null;

  const cleanBase = canvasBaseUrl.replace(/\/+$/, '');
  const redirectUri = `${window.location.origin}/canvas/callback`;

  // State encodes the Canvas base URL so we know where to exchange the code
  const state = btoa(JSON.stringify({ baseUrl: cleanBase }));

  const params = new URLSearchParams({
    client_id: CANVAS_CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri,
    state,
    scope: 'url:GET|/api/v1/users/self url:GET|/api/v1/courses url:GET|/api/v1/courses/:course_id/assignments url:GET|/api/v1/courses/:course_id/quizzes',
  });

  return `${cleanBase}/login/oauth2/auth?${params.toString()}`;
}

/**
 * Exchange an OAuth authorization code for tokens via the edge function.
 * Returns the saved connection on success.
 */
export async function exchangeOAuthCode(code: string, baseUrl: string): Promise<CanvasConnection> {
  if (!supabase) throw new Error('Supabase not configured');

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const redirectUri = `${window.location.origin}/canvas/callback`;

  const response = await fetch(`${supabaseUrl}/functions/v1/canvas-oauth`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ code, base_url: baseUrl, redirect_uri: redirectUri }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Failed to connect Canvas');
  }

  return data.connection as CanvasConnection;
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
  return courses.filter(c => c.workflow_state === 'available');
}

export async function fetchCanvasAssignments(courseId: number): Promise<CanvasAssignment[]> {
  const assignments = await canvasProxy<CanvasAssignment[]>(
    `/api/v1/courses/${courseId}/assignments?per_page=100&order_by=due_at`
  );
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

// --- Config check ---

export function isCanvasOAuthConfigured(): boolean {
  return Boolean(CANVAS_CLIENT_ID);
}
