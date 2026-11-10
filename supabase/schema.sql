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
alter table public.profiles add column if not exists uid text;   -- university ID from signup

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
alter table public.projects add column if not exists expected_output_url text;
alter table public.projects add column if not exists expected_output_path text;
alter table public.projects add column if not exists project_type text not null default 'html'
  check (project_type in ('html', 'react'));
alter table public.projects add column if not exists category text not null default 'Assignments'
  check (category in ('Assignments', 'Bi-Weekly', 'Mid-Term'));
-- Admin-curated reference / documentation shown to students in the Solve
-- sidebar. Markdown. Kept inside the app on purpose so it works under Safe
-- Exam Browser without widening the URL allow-list.
alter table public.projects add column if not exists reference_md text;

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
-- true when the server turned a leftover draft into this submission
alter table public.submissions add column if not exists auto_collected boolean not null default false;

-- Admin's grading of a submission. One evaluation per submission.
-- scores is a free-form jsonb (e.g. { correctness: 8, design: 7, code_quality: 9 })
-- so the rubric can evolve without migrations.
create table if not exists public.evaluations (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid references public.submissions(id) on delete cascade not null unique,
  scores jsonb not null default '{}'::jsonb,
  total numeric not null default 0,
  max_total numeric not null default 30,
  feedback text not null default '',
  -- Per-criterion feedback keyed by rubric key, e.g.
  -- {"correctness":"...","design":"...","code_quality":"..."}
  feedback_by_criterion jsonb not null default '{}'::jsonb,
  graded_by uuid references public.profiles(id) on delete set null,
  graded_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Keep an older deployed table in sync (idempotent).
alter table public.evaluations
  add column if not exists feedback_by_criterion jsonb not null default '{}'::jsonb;
create index if not exists evaluations_submission_idx on public.evaluations (submission_id);

-- Server-side autosave of in-progress work. Survives browser/device changes.
-- Row is upserted on every change (debounced client-side) and deleted on submit.
create table if not exists public.submission_drafts (
  assignment_id uuid references public.assignments(id) on delete cascade not null,
  student_id uuid references public.profiles(id) on delete cascade not null,
  files jsonb not null,
  folders jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (assignment_id, student_id)
);

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
  insert into public.profiles (id, email, full_name, uid, campus, semester, section)
  values (
    new.id,
    lower(new.email),
    nullif(new.raw_user_meta_data->>'full_name', ''),
    nullif(trim(new.raw_user_meta_data->>'uid'), ''),
    nullif(new.raw_user_meta_data->>'campus', ''),
    nullif(new.raw_user_meta_data->>'semester', ''),
    nullif(new.raw_user_meta_data->>'section', '')
  )
  on conflict (id) do nothing;
  return new;
end; $$;

-- Backfill UIDs entered at signup before the uid column existed.
update public.profiles p
set uid = nullif(trim(u.raw_user_meta_data->>'uid'), '')
from auth.users u
where u.id = p.id and p.uid is null and nullif(trim(u.raw_user_meta_data->>'uid'), '') is not null;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- RLS ------------------------------------------------------

alter table public.profiles           enable row level security;
alter table public.projects           enable row level security;
alter table public.project_assets     enable row level security;
alter table public.assignments        enable row level security;
alter table public.submissions        enable row level security;
alter table public.submission_drafts  enable row level security;
alter table public.evaluations        enable row level security;

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

-- submission_drafts (student RW own draft, admin read, within the assignment window)
drop policy if exists drafts_self_rw      on public.submission_drafts;
drop policy if exists drafts_admin_read   on public.submission_drafts;
create policy drafts_self_rw on public.submission_drafts
  for all
  using (student_id = auth.uid())
  with check (
    student_id = auth.uid()
    and exists (
      select 1 from public.assignments a
      where a.id = submission_drafts.assignment_id
        and (a.is_public or lower(a.assignee_email) = public.current_email())
        and now() <= a.ends_at + interval '30 seconds'
    )
  );
create policy drafts_admin_read on public.submission_drafts for select using (public.is_admin());

-- evaluations: admin RW, student may read their own grade
drop policy if exists evaluations_admin_all   on public.evaluations;
drop policy if exists evaluations_self_read   on public.evaluations;
create policy evaluations_admin_all on public.evaluations
  for all using (public.is_admin()) with check (public.is_admin());
create policy evaluations_self_read on public.evaluations for select using (
  exists (
    select 1 from public.submissions s
    where s.id = evaluations.submission_id and s.student_id = auth.uid()
  )
);

-- ---------- Server-side auto-submit ---------------------------------
-- The browser auto-submits only while the Solve page is open at the deadline.
-- This collects every draft left behind (laptop closed, crash, reboot, no
-- network) into a submission once the deadline has passed, so the last
-- autosave (saved every ~3 s) always arrives. Students who already
-- submitted keep their submission.
create or replace function public.collect_expired_drafts() returns integer
language plpgsql security definer set search_path = public as $$
declare collected integer;
begin
  -- 1 minute: past the 30-second grace the draft and submission policies allow.
  insert into public.submissions (assignment_id, student_id, files, submitted_at, auto_collected)
  select d.assignment_id, d.student_id, d.files, d.updated_at, true
  from public.submission_drafts d
  join public.assignments a on a.id = d.assignment_id
  where now() > a.ends_at + interval '1 minute'
  on conflict (assignment_id, student_id) do nothing;
  get diagnostics collected = row_count;

  delete from public.submission_drafts d
  using public.assignments a
  where a.id = d.assignment_id and now() > a.ends_at + interval '1 minute';

  return collected;
end; $$;
revoke all on function public.collect_expired_drafts() from public, anon, authenticated;

-- Run it every minute with pg_cron. Re-running replaces the job (same name).
-- A failure here only skips the schedule (with a notice); the rest of this
-- file still applies. Alternative: Dashboard → Integrations → Cron.
do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron is not available here: drafts will not be auto-collected.';
    return;
  end if;
  create extension if not exists pg_cron with schema pg_catalog;
  grant usage on schema cron to postgres;
  grant all privileges on all tables in schema cron to postgres;
  perform cron.schedule('collect-expired-drafts', '* * * * *', 'select public.collect_expired_drafts()');
exception when others then
  raise notice 'Could not schedule draft collection (%). Enable pg_cron under Dashboard → Integrations → Cron and run this file again.', sqlerrm;
end $$;

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
