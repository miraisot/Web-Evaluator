-- =====================================================================
-- Web Eval - Supabase schema
-- Run in Supabase SQL editor. Idempotent-ish: drops & recreates policies.
-- =====================================================================

-- ---------- Tables ---------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  role text not null default 'student' check (role in ('student','admin')),
  full_name text,
  campus text check (campus in ('Hi-Tech', 'RGIB', 'JU')),
  semester text,
  section text,
  created_at timestamptz default now()
);
-- Add columns if an older schema is already in place
alter table public.profiles add column if not exists full_name text;
alter table public.profiles add column if not exists campus text;
alter table public.profiles add column if not exists semester text;
alter table public.profiles add column if not exists section text;

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  starter_files jsonb not null default jsonb_build_object(
    'index.html', E'<!doctype html>\n<html>\n<head>\n  <link rel="stylesheet" href="styles.css"/>\n</head>\n<body>\n  <h1>Hello</h1>\n  <script src="script.js"></script>\n</body>\n</html>',
    'styles.css', E'body { font-family: system-ui; }',
    'script.js', E'// your JS here'
  ),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now()
);

create table if not exists public.project_assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade not null,
  name text not null,
  storage_path text not null,
  public_url text not null,
  content_type text,
  size_bytes bigint,
  created_at timestamptz default now()
);

create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade not null,
  assignee_email text,   -- null when is_public = true
  is_public boolean not null default false,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now(),
  check (is_public or assignee_email is not null)
);
alter table public.assignments add column if not exists is_public boolean not null default false;
alter table public.assignments alter column assignee_email drop not null;
-- Replace the old composite unique (null emails break unique constraints) with
-- two partial unique indexes: one per (project, email) for private, and one
-- "only one public row per project".
alter table public.assignments drop constraint if exists assignments_project_id_assignee_email_key;
create unique index if not exists assignments_project_email_uniq
  on public.assignments (project_id, lower(assignee_email))
  where assignee_email is not null;
create unique index if not exists assignments_project_public_uniq
  on public.assignments (project_id) where is_public = true;
create index if not exists assignments_email_idx on public.assignments (lower(assignee_email));

create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid references public.assignments(id) on delete cascade not null,
  student_id uuid references public.profiles(id) on delete cascade not null,
  files jsonb not null,
  submitted_at timestamptz default now()
);
create index if not exists submissions_assignment_idx on public.submissions (assignment_id);
-- One submission per student per assignment
create unique index if not exists submissions_one_per_student on public.submissions (assignment_id, student_id);

-- ---------- Helpers --------------------------------------------------

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.current_email() returns text
language sql stable security definer set search_path = public as $$
  select lower(email) from public.profiles where id = auth.uid();
$$;

-- Auto-create profile row on signup, pulling the extra fields the client
-- supplied via supabase.auth.signUp({ options: { data: {...} } }).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, campus, semester, section)
  values (
    new.id,
    lower(new.email),
    nullif(new.raw_user_meta_data->>'full_name', ''),
    nullif(new.raw_user_meta_data->>'campus', ''),
    nullif(new.raw_user_meta_data->>'semester', ''),
    nullif(new.raw_user_meta_data->>'section', '')
  )
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- RLS ------------------------------------------------------

alter table public.profiles         enable row level security;
alter table public.projects         enable row level security;
alter table public.project_assets   enable row level security;
alter table public.assignments      enable row level security;
alter table public.submissions      enable row level security;

-- profiles
drop policy if exists profiles_self_read   on public.profiles;
drop policy if exists profiles_self_update on public.profiles;
drop policy if exists profiles_admin_read  on public.profiles;
drop policy if exists profiles_admin_write on public.profiles;
create policy profiles_self_read   on public.profiles for select using (id = auth.uid());
create policy profiles_self_update on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid() and role = (select role from public.profiles where id = auth.uid()));
create policy profiles_admin_read  on public.profiles for select using (public.is_admin());
create policy profiles_admin_write on public.profiles for update using (public.is_admin()) with check (public.is_admin());

-- projects (admin RW; students read only if they have an active-or-future assignment)
drop policy if exists projects_admin_all      on public.projects;
drop policy if exists projects_assigned_read  on public.projects;
create policy projects_admin_all on public.projects for all using (public.is_admin()) with check (public.is_admin());
create policy projects_assigned_read on public.projects for select using (
  exists (
    select 1 from public.assignments a
    where a.project_id = projects.id
      and (a.is_public or lower(a.assignee_email) = public.current_email())
  )
);

-- project_assets (same visibility as parent project)
drop policy if exists assets_admin_all     on public.project_assets;
drop policy if exists assets_assigned_read on public.project_assets;
create policy assets_admin_all on public.project_assets for all using (public.is_admin()) with check (public.is_admin());
create policy assets_assigned_read on public.project_assets for select using (
  exists (
    select 1 from public.assignments a
    where a.project_id = project_assets.project_id
      and (a.is_public or lower(a.assignee_email) = public.current_email())
  )
);

-- assignments
drop policy if exists assignments_admin_all on public.assignments;
drop policy if exists assignments_self_read on public.assignments;
create policy assignments_admin_all on public.assignments for all using (public.is_admin()) with check (public.is_admin());
create policy assignments_self_read on public.assignments for select using (
  is_public or lower(assignee_email) = public.current_email()
);

-- submissions
drop policy if exists submissions_admin_read on public.submissions;
drop policy if exists submissions_self_read  on public.submissions;
drop policy if exists submissions_self_write on public.submissions;
create policy submissions_admin_read on public.submissions for select using (public.is_admin());
create policy submissions_self_read  on public.submissions for select using (student_id = auth.uid());
-- 30-second grace window on the upper bound so auto-submits fired exactly at
-- the deadline aren't rejected due to clock drift between client and server.
create policy submissions_self_write on public.submissions for insert with check (
  student_id = auth.uid()
  and exists (
    select 1 from public.assignments a
    where a.id = submissions.assignment_id
      and (a.is_public or lower(a.assignee_email) = public.current_email())
      and now() >= a.starts_at
      and now() <= a.ends_at + interval '30 seconds'
  )
);

-- ---------- Storage bucket for assets --------------------------------
-- Run once; safe to re-run.
insert into storage.buckets (id, name, public)
values ('project-assets', 'project-assets', true)
on conflict (id) do nothing;

-- Admin can write / overwrite / remove project-assets; anyone can read.
drop policy if exists "assets public read"   on storage.objects;
drop policy if exists "assets admin write"   on storage.objects;
drop policy if exists "assets admin update"  on storage.objects;
drop policy if exists "assets admin delete"  on storage.objects;
create policy "assets public read" on storage.objects for select
  using (bucket_id = 'project-assets');
create policy "assets admin write" on storage.objects for insert
  with check (bucket_id = 'project-assets' and public.is_admin());
create policy "assets admin update" on storage.objects for update
  using (bucket_id = 'project-assets' and public.is_admin())
  with check (bucket_id = 'project-assets' and public.is_admin());
create policy "assets admin delete" on storage.objects for delete
  using (bucket_id = 'project-assets' and public.is_admin());

-- ---------- MERN Assignment Support ---------------------------------
-- Adds `project_type` to projects, and submission-type columns to submissions.
-- All changes are additive and backwards compatible: existing rows auto-migrate
-- to `project_type = 'live_preview'` and `submission_type = 'code'`.

alter table public.projects
  add column if not exists project_type text not null default 'live_preview';
-- Guard the allowed values. Dropped-and-recreated so re-running the schema
-- replaces an older constraint if we ever extend the enum.
alter table public.projects drop constraint if exists projects_project_type_check;
alter table public.projects
  add constraint projects_project_type_check
  check (project_type in ('live_preview','code_review','external_link'));

alter table public.submissions
  add column if not exists submission_type text not null default 'code';
alter table public.submissions drop constraint if exists submissions_submission_type_check;
alter table public.submissions
  add constraint submissions_submission_type_check
  check (submission_type in ('code','external_link'));

alter table public.submissions add column if not exists repo_url text;
alter table public.submissions add column if not exists deployed_url text;
alter table public.submissions add column if not exists notes text;

-- Shape sanity: an external_link submission needs at least a repo_url.
alter table public.submissions drop constraint if exists submissions_external_link_shape;
alter table public.submissions
  add constraint submissions_external_link_shape
  check (
    submission_type <> 'external_link'
    or repo_url is not null
  );

-- Existing RLS policies on submissions do NOT inspect submission shape
-- (only time window + ownership), so they already cover both types. No
-- policy change is required.

-- ---------- Promote a first admin -----------------------------------
-- After signing up, run this in SQL editor with your email:
--   update public.profiles set role = 'admin' where email = 'you@example.com';
