create extension if not exists "pgcrypto";

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text not null default '',
  color text not null,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  title text not null,
  description text not null default '',
  status text not null check (status in ('todo', 'in-progress', 'done')),
  priority text not null check (priority in ('low', 'medium', 'high')),
  due_date timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

-- Add recurrence column to tasks (idempotent)
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tasks' and column_name = 'recurrence') then
    alter table public.tasks add column recurrence text not null default 'none' check (recurrence in ('none', 'daily', 'weekly', 'monthly'));
  end if;
end $$;

create table if not exists public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  text text not null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists task_comments_task_id_idx on public.task_comments(task_id);

create table if not exists public.subtasks (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  done boolean not null default false,
  position int not null default 0,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists projects_user_id_idx on public.projects(user_id);
create index if not exists tasks_user_id_idx on public.tasks(user_id);
create index if not exists tasks_project_id_idx on public.tasks(project_id);
create index if not exists subtasks_task_id_idx on public.subtasks(task_id);
create index if not exists subtasks_user_id_idx on public.subtasks(user_id);

alter table public.projects enable row level security;
alter table public.tasks enable row level security;

drop policy if exists "Users can read their own projects" on public.projects;
drop policy if exists "Users can insert their own projects" on public.projects;
drop policy if exists "Users can update their own projects" on public.projects;
drop policy if exists "Users can delete their own projects" on public.projects;

create policy "Users can read their own projects"
on public.projects
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can insert their own projects"
on public.projects
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update their own projects"
on public.projects
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete their own projects"
on public.projects
for delete
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can read their own tasks" on public.tasks;
drop policy if exists "Users can insert their own tasks" on public.tasks;
drop policy if exists "Users can update their own tasks" on public.tasks;
drop policy if exists "Users can delete their own tasks" on public.tasks;

create policy "Users can read their own tasks"
on public.tasks
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can insert their own tasks"
on public.tasks
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update their own tasks"
on public.tasks
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete their own tasks"
on public.tasks
for delete
to authenticated
using (auth.uid() = user_id);

alter table public.subtasks enable row level security;

drop policy if exists "Users can read their own subtasks" on public.subtasks;
drop policy if exists "Users can insert their own subtasks" on public.subtasks;
drop policy if exists "Users can update their own subtasks" on public.subtasks;
drop policy if exists "Users can delete their own subtasks" on public.subtasks;

create policy "Users can read their own subtasks"
on public.subtasks
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can insert their own subtasks"
on public.subtasks
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update their own subtasks"
on public.subtasks
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete their own subtasks"
on public.subtasks
for delete
to authenticated
using (auth.uid() = user_id);

alter table public.task_comments enable row level security;

drop policy if exists "Users can read their own comments" on public.task_comments;
drop policy if exists "Users can insert their own comments" on public.task_comments;
drop policy if exists "Users can delete their own comments" on public.task_comments;

create policy "Users can read their own comments"
on public.task_comments
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can insert their own comments"
on public.task_comments
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can delete their own comments"
on public.task_comments
for delete
to authenticated
using (auth.uid() = user_id);

-- Deadlines
create table if not exists public.deadlines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  title text not null,
  status text not null default 'not-started' check (status in ('not-started', 'in-progress', 'done', 'missed')),
  type text not null default 'assignment' check (type in ('assignment', 'exam', 'quiz', 'lab', 'project', 'other')),
  due_date date not null,
  due_time time,
  notes text not null default '',
  created_at timestamptz not null default timezone('utc', now())
);

-- Linking table: deadlines <-> tasks (many-to-many)
create table if not exists public.deadline_tasks (
  deadline_id uuid not null references public.deadlines(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  primary key (deadline_id, task_id)
);

create index if not exists deadlines_user_id_idx on public.deadlines(user_id);
create index if not exists deadlines_project_id_idx on public.deadlines(project_id);
create index if not exists deadlines_due_date_idx on public.deadlines(due_date);
create index if not exists deadline_tasks_deadline_id_idx on public.deadline_tasks(deadline_id);
create index if not exists deadline_tasks_task_id_idx on public.deadline_tasks(task_id);

alter table public.deadlines enable row level security;

drop policy if exists "Users can read their own deadlines" on public.deadlines;
drop policy if exists "Users can insert their own deadlines" on public.deadlines;
drop policy if exists "Users can update their own deadlines" on public.deadlines;
drop policy if exists "Users can delete their own deadlines" on public.deadlines;

create policy "Users can read their own deadlines"
on public.deadlines for select to authenticated
using (auth.uid() = user_id);

create policy "Users can insert their own deadlines"
on public.deadlines for insert to authenticated
with check (auth.uid() = user_id);

create policy "Users can update their own deadlines"
on public.deadlines for update to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete their own deadlines"
on public.deadlines for delete to authenticated
using (auth.uid() = user_id);

alter table public.deadline_tasks enable row level security;

-- For deadline_tasks, allow access if the user owns the deadline
drop policy if exists "Users can read their own deadline_tasks" on public.deadline_tasks;
drop policy if exists "Users can insert their own deadline_tasks" on public.deadline_tasks;
drop policy if exists "Users can delete their own deadline_tasks" on public.deadline_tasks;

create policy "Users can read their own deadline_tasks"
on public.deadline_tasks for select to authenticated
using (exists (select 1 from public.deadlines where id = deadline_id and user_id = auth.uid()));

create policy "Users can insert their own deadline_tasks"
on public.deadline_tasks for insert to authenticated
with check (exists (select 1 from public.deadlines where id = deadline_id and user_id = auth.uid()));

create policy "Users can delete their own deadline_tasks"
on public.deadline_tasks for delete to authenticated
using (exists (select 1 from public.deadlines where id = deadline_id and user_id = auth.uid()));

-- Canvas integration: source tracking on deadlines
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'deadlines' and column_name = 'source_type') then
    alter table public.deadlines add column source_type text not null default 'manual';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'deadlines' and column_name = 'source_id') then
    alter table public.deadlines add column source_id text;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'deadlines' and column_name = 'source_url') then
    alter table public.deadlines add column source_url text;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'deadlines' and column_name = 'source_synced_at') then
    alter table public.deadlines add column source_synced_at timestamptz;
  end if;
end $$;

-- Unique: one Canvas item = one deadline per user
create unique index if not exists deadlines_source_unique
  on public.deadlines(user_id, source_type, source_id)
  where source_type is not null and source_id is not null;

-- Canvas course ID on projects
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'projects' and column_name = 'canvas_course_id') then
    alter table public.projects add column canvas_course_id text;
  end if;
end $$;

create unique index if not exists projects_canvas_course_unique
  on public.projects(user_id, canvas_course_id)
  where canvas_course_id is not null;

-- Canvas connections (per-user OAuth tokens — stored server-side only)
create table if not exists public.canvas_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  base_url text not null,
  access_token text not null,
  refresh_token text,
  token_expires_at timestamptz,
  canvas_user_id text,
  last_synced_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  unique(user_id)
);

-- Migration: if table exists with old api_token column, add new columns
do $$ begin
  -- Add access_token if missing (rename from api_token handled by app logic)
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'canvas_connections' and column_name = 'access_token') then
    alter table public.canvas_connections add column access_token text not null default '';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'canvas_connections' and column_name = 'refresh_token') then
    alter table public.canvas_connections add column refresh_token text;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'canvas_connections' and column_name = 'token_expires_at') then
    alter table public.canvas_connections add column token_expires_at timestamptz;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'canvas_connections' and column_name = 'canvas_user_id') then
    alter table public.canvas_connections add column canvas_user_id text;
  end if;
end $$;

alter table public.canvas_connections enable row level security;

drop policy if exists "Users can read their own canvas_connections" on public.canvas_connections;
drop policy if exists "Users can insert their own canvas_connections" on public.canvas_connections;
drop policy if exists "Users can update their own canvas_connections" on public.canvas_connections;
drop policy if exists "Users can delete their own canvas_connections" on public.canvas_connections;

create policy "Users can read their own canvas_connections"
on public.canvas_connections for select to authenticated
using (auth.uid() = user_id);

create policy "Users can insert their own canvas_connections"
on public.canvas_connections for insert to authenticated
with check (auth.uid() = user_id);

create policy "Users can update their own canvas_connections"
on public.canvas_connections for update to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete their own canvas_connections"
on public.canvas_connections for delete to authenticated
using (auth.uid() = user_id);

-- ============================================================
-- Gym Module
-- ============================================================

-- Workout plans (the overall program)
create table if not exists public.workout_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text not null default '',
  days_per_week int not null default 3,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists workout_plans_user_id_idx on public.workout_plans(user_id);
alter table public.workout_plans enable row level security;
drop policy if exists "Users can read their own workout_plans" on public.workout_plans;
drop policy if exists "Users can insert their own workout_plans" on public.workout_plans;
drop policy if exists "Users can update their own workout_plans" on public.workout_plans;
drop policy if exists "Users can delete their own workout_plans" on public.workout_plans;
create policy "Users can read their own workout_plans" on public.workout_plans for select to authenticated using (auth.uid() = user_id);
create policy "Users can insert their own workout_plans" on public.workout_plans for insert to authenticated with check (auth.uid() = user_id);
create policy "Users can update their own workout_plans" on public.workout_plans for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can delete their own workout_plans" on public.workout_plans for delete to authenticated using (auth.uid() = user_id);

-- Workout day templates (days in the split)
create table if not exists public.workout_day_templates (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.workout_plans(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  position int not null default 0,
  notes text not null default '',
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists wdt_plan_id_idx on public.workout_day_templates(plan_id);
create index if not exists wdt_user_id_idx on public.workout_day_templates(user_id);
alter table public.workout_day_templates enable row level security;
drop policy if exists "Users can read their own workout_day_templates" on public.workout_day_templates;
drop policy if exists "Users can insert their own workout_day_templates" on public.workout_day_templates;
drop policy if exists "Users can update their own workout_day_templates" on public.workout_day_templates;
drop policy if exists "Users can delete their own workout_day_templates" on public.workout_day_templates;
create policy "Users can read their own workout_day_templates" on public.workout_day_templates for select to authenticated using (auth.uid() = user_id);
create policy "Users can insert their own workout_day_templates" on public.workout_day_templates for insert to authenticated with check (auth.uid() = user_id);
create policy "Users can update their own workout_day_templates" on public.workout_day_templates for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can delete their own workout_day_templates" on public.workout_day_templates for delete to authenticated using (auth.uid() = user_id);

-- Exercises (user's exercise library)
create table if not exists public.exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  muscle_group text not null default '',
  notes text not null default '',
  reference_image_url text,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists exercises_user_id_idx on public.exercises(user_id);
alter table public.exercises enable row level security;
drop policy if exists "Users can read their own exercises" on public.exercises;
drop policy if exists "Users can insert their own exercises" on public.exercises;
drop policy if exists "Users can update their own exercises" on public.exercises;
drop policy if exists "Users can delete their own exercises" on public.exercises;
create policy "Users can read their own exercises" on public.exercises for select to authenticated using (auth.uid() = user_id);
create policy "Users can insert their own exercises" on public.exercises for insert to authenticated with check (auth.uid() = user_id);
create policy "Users can update their own exercises" on public.exercises for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can delete their own exercises" on public.exercises for delete to authenticated using (auth.uid() = user_id);

-- Workout day exercises (exercises in a day template)
create table if not exists public.workout_day_exercises (
  id uuid primary key default gen_random_uuid(),
  workout_day_template_id uuid not null references public.workout_day_templates(id) on delete cascade,
  exercise_id uuid not null references public.exercises(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  position int not null default 0,
  target_sets int not null default 3,
  target_reps text not null default '10',
  rest_seconds int not null default 90,
  notes text not null default '',
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists wde_day_template_idx on public.workout_day_exercises(workout_day_template_id);
create index if not exists wde_user_id_idx on public.workout_day_exercises(user_id);
alter table public.workout_day_exercises enable row level security;
drop policy if exists "Users can read their own workout_day_exercises" on public.workout_day_exercises;
drop policy if exists "Users can insert their own workout_day_exercises" on public.workout_day_exercises;
drop policy if exists "Users can update their own workout_day_exercises" on public.workout_day_exercises;
drop policy if exists "Users can delete their own workout_day_exercises" on public.workout_day_exercises;
create policy "Users can read their own workout_day_exercises" on public.workout_day_exercises for select to authenticated using (auth.uid() = user_id);
create policy "Users can insert their own workout_day_exercises" on public.workout_day_exercises for insert to authenticated with check (auth.uid() = user_id);
create policy "Users can update their own workout_day_exercises" on public.workout_day_exercises for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can delete their own workout_day_exercises" on public.workout_day_exercises for delete to authenticated using (auth.uid() = user_id);

-- Workout sessions (actual gym visits)
create table if not exists public.workout_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid not null references public.workout_plans(id) on delete cascade,
  workout_day_template_id uuid not null references public.workout_day_templates(id) on delete cascade,
  started_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  status text not null default 'in-progress' check (status in ('in-progress', 'completed', 'abandoned')),
  notes text not null default '',
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists ws_user_id_idx on public.workout_sessions(user_id);
create index if not exists ws_plan_id_idx on public.workout_sessions(plan_id);
create index if not exists ws_day_template_idx on public.workout_sessions(workout_day_template_id);
alter table public.workout_sessions enable row level security;
drop policy if exists "Users can read their own workout_sessions" on public.workout_sessions;
drop policy if exists "Users can insert their own workout_sessions" on public.workout_sessions;
drop policy if exists "Users can update their own workout_sessions" on public.workout_sessions;
drop policy if exists "Users can delete their own workout_sessions" on public.workout_sessions;
create policy "Users can read their own workout_sessions" on public.workout_sessions for select to authenticated using (auth.uid() = user_id);
create policy "Users can insert their own workout_sessions" on public.workout_sessions for insert to authenticated with check (auth.uid() = user_id);
create policy "Users can update their own workout_sessions" on public.workout_sessions for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can delete their own workout_sessions" on public.workout_sessions for delete to authenticated using (auth.uid() = user_id);

-- Workout exercise logs (exercises performed in a session)
create table if not exists public.workout_exercise_logs (
  id uuid primary key default gen_random_uuid(),
  workout_session_id uuid not null references public.workout_sessions(id) on delete cascade,
  exercise_id uuid not null references public.exercises(id) on delete cascade,
  workout_day_exercise_id uuid references public.workout_day_exercises(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,
  position int not null default 0,
  notes text not null default '',
  photo_url text,
  created_at timestamptz not null default timezone('utc', now())
);

-- Migration: add photo_url column if it doesn't exist
alter table public.workout_exercise_logs add column if not exists photo_url text;

-- Storage bucket for workout photos
insert into storage.buckets (id, name, public) values ('workout-photos', 'workout-photos', true) on conflict do nothing;
drop policy if exists "Users can upload workout photos" on storage.objects;
create policy "Users can upload workout photos" on storage.objects for insert to authenticated with check (bucket_id = 'workout-photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Users can read workout photos" on storage.objects;
create policy "Users can read workout photos" on storage.objects for select to authenticated using (bucket_id = 'workout-photos');
drop policy if exists "Users can delete workout photos" on storage.objects;
create policy "Users can delete workout photos" on storage.objects for delete to authenticated using (bucket_id = 'workout-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create index if not exists wel_session_idx on public.workout_exercise_logs(workout_session_id);
create index if not exists wel_user_id_idx on public.workout_exercise_logs(user_id);
alter table public.workout_exercise_logs enable row level security;
drop policy if exists "Users can read their own workout_exercise_logs" on public.workout_exercise_logs;
drop policy if exists "Users can insert their own workout_exercise_logs" on public.workout_exercise_logs;
drop policy if exists "Users can update their own workout_exercise_logs" on public.workout_exercise_logs;
drop policy if exists "Users can delete their own workout_exercise_logs" on public.workout_exercise_logs;
create policy "Users can read their own workout_exercise_logs" on public.workout_exercise_logs for select to authenticated using (auth.uid() = user_id);
create policy "Users can insert their own workout_exercise_logs" on public.workout_exercise_logs for insert to authenticated with check (auth.uid() = user_id);
create policy "Users can update their own workout_exercise_logs" on public.workout_exercise_logs for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can delete their own workout_exercise_logs" on public.workout_exercise_logs for delete to authenticated using (auth.uid() = user_id);

-- Workout set logs (individual sets)
create table if not exists public.workout_set_logs (
  id uuid primary key default gen_random_uuid(),
  workout_exercise_log_id uuid not null references public.workout_exercise_logs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  set_number int not null,
  weight numeric,
  reps int,
  completed boolean not null default false,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists wsl_exercise_log_idx on public.workout_set_logs(workout_exercise_log_id);
create index if not exists wsl_user_id_idx on public.workout_set_logs(user_id);
alter table public.workout_set_logs enable row level security;
drop policy if exists "Users can read their own workout_set_logs" on public.workout_set_logs;
drop policy if exists "Users can insert their own workout_set_logs" on public.workout_set_logs;
drop policy if exists "Users can update their own workout_set_logs" on public.workout_set_logs;
drop policy if exists "Users can delete their own workout_set_logs" on public.workout_set_logs;
create policy "Users can read their own workout_set_logs" on public.workout_set_logs for select to authenticated using (auth.uid() = user_id);
create policy "Users can insert their own workout_set_logs" on public.workout_set_logs for insert to authenticated with check (auth.uid() = user_id);
create policy "Users can update their own workout_set_logs" on public.workout_set_logs for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can delete their own workout_set_logs" on public.workout_set_logs for delete to authenticated using (auth.uid() = user_id);

-- Storage bucket for profile avatars
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true) on conflict do nothing;
drop policy if exists "Users can upload their avatar" on storage.objects;
create policy "Users can upload their avatar" on storage.objects for insert to authenticated with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Anyone can read avatars" on storage.objects;
create policy "Anyone can read avatars" on storage.objects for select using (bucket_id = 'avatars');
drop policy if exists "Users can update their avatar" on storage.objects;
create policy "Users can update their avatar" on storage.objects for update to authenticated using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Users can delete their avatar" on storage.objects;
create policy "Users can delete their avatar" on storage.objects for delete to authenticated using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
