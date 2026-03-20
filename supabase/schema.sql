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
