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
alter table public.profiles add column if not exists batch text; -- e.g. '2025', '2026'

-- Pre-registration list used to assign to a whole campus/batch before
-- students sign up. See supabase/migration_roster.sql for details.
create table if not exists public.student_roster (
  email text primary key,
  name  text,
  uid   text,
  campus text check (campus in ('Hi-Tech', 'RGIB', 'JU')),
  batch  text not null,
  created_at timestamptz not null default now()
);
create index if not exists student_roster_campus_batch_idx
  on public.student_roster (campus, batch);
create index if not exists student_roster_batch_idx
  on public.student_roster (batch);

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
declare r public.student_roster%rowtype;
begin
  select * into r from public.student_roster where lower(email) = lower(new.email);
  insert into public.profiles (id, email, full_name, uid, campus, semester, section, batch)
  values (
    new.id,
    lower(new.email),
    coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), r.name),
    coalesce(nullif(trim(new.raw_user_meta_data->>'uid'), ''), r.uid),
    coalesce(nullif(new.raw_user_meta_data->>'campus', ''), r.campus),
    nullif(new.raw_user_meta_data->>'semester', ''),
    nullif(new.raw_user_meta_data->>'section', ''),
    coalesce(nullif(new.raw_user_meta_data->>'batch', ''), r.batch)
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
alter table public.student_roster     enable row level security;
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

-- student_roster
drop policy if exists roster_admin_all on public.student_roster;
drop policy if exists roster_self_read on public.student_roster;
create policy roster_admin_all on public.student_roster
  for all using (public.is_admin()) with check (public.is_admin());
create policy roster_self_read on public.student_roster
  for select using (lower(email) = public.current_email());

-- projects (admin RW; students read only if they have an active-or-future assignment)
drop policy if exists projects_admin_all      on public.projects;
drop policy if exists projects_assigned_read  on public.projects;
create policy projects_admin_all on public.projects for all using (public.is_admin()) with check (public.is_admin());
create policy projects_assigned_read on public.projects for select using (
  exists (
    select 1 from public.assignments a
    where a.project_id = projects.id
      and (a.is_public or lower(a.assignee_email) = public.current_email())
      -- Hidden until the exam opens, so nobody can read their problem early.
      and now() >= a.starts_at
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
      and now() >= a.starts_at
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
  check (project_type in ('html','react','quiz','live_preview','code_review','external_link'));

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

-- ---------- Quiz support -------------------------------------------
-- Same as supabase/migration_quiz.sql (see its header for the data layout).

-- 'quiz' joins the allowed project types. The older 'live_preview' /
-- 'code_review' / 'external_link' values stay allowed so nothing breaks.
alter table public.projects drop constraint if exists projects_project_type_check;
alter table public.projects
  add constraint projects_project_type_check
  check (project_type in ('html','react','quiz','live_preview','code_review','external_link'));

-- { "questions": [ { "id", "type": "single"|"multiple"|"paragraph",
--                    "prompt" (markdown), "points", "options": [{ "id", "text" }] } ] }
alter table public.projects add column if not exists quiz jsonb;

-- Answer key kept out of `projects`, because students can read their
-- assigned project rows. answers = { "<questionId>": { "correct": ["<optionId>"], "model_answer": "..." } }
create table if not exists public.quiz_answer_keys (
  project_id uuid primary key references public.projects(id) on delete cascade,
  answers jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.quiz_answer_keys enable row level security;
drop policy if exists quiz_keys_admin_all on public.quiz_answer_keys;
create policy quiz_keys_admin_all on public.quiz_answer_keys
  for all using (public.is_admin()) with check (public.is_admin());

-- Number of answers (paragraph questions) still waiting for a human grade.
alter table public.evaluations add column if not exists pending_manual integer not null default 0;

-- Scores one quiz submission. Single / multiple choice questions are scored
-- from the key (multiple = all-or-nothing: exactly the correct set). A wrong
-- answer scores -negative when the question sets "negative" (negative
-- marking); an unanswered question always scores 0. Scores a grader (or the
-- AI) already gave to paragraph questions are kept. No-op for non-quiz
-- submissions.
create or replace function public.grade_quiz_submission(p_submission_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  s record;
  q jsonb;
  qid text;
  pts numeric;
  neg numeric;
  given text[];
  correct text[];
  answer_key jsonb;
  prev jsonb;
  new_scores jsonb := '{}'::jsonb;
  total_pts numeric := 0;
  max_pts numeric := 0;
  pending integer := 0;
begin
  select sub.files, p.id as project_id, p.project_type, p.quiz
    into s
  from public.submissions sub
  join public.assignments a on a.id = sub.assignment_id
  join public.projects p on p.id = a.project_id
  where sub.id = p_submission_id;
  if not found or s.project_type <> 'quiz' then return; end if;

  select answers into answer_key from public.quiz_answer_keys where project_id = s.project_id;
  answer_key := coalesce(answer_key, '{}'::jsonb);
  select scores into prev from public.evaluations where submission_id = p_submission_id;
  prev := coalesce(prev, '{}'::jsonb);

  for q in select value from jsonb_array_elements(coalesce(s.quiz->'questions', '[]'::jsonb)) loop
    qid := q->>'id';
    pts := coalesce(nullif(q->>'points', '')::numeric, 1);
    max_pts := max_pts + pts;

    if q->>'type' = 'paragraph' then
      if prev ? qid then
        new_scores := new_scores || jsonb_build_object(qid, prev->qid);
        total_pts := total_pts + coalesce((prev->>qid)::numeric, 0);
      elsif coalesce(btrim(s.files->>qid), '') = '' then
        -- Left blank: nothing to read, scores 0 without a grader.
        new_scores := new_scores || jsonb_build_object(qid, 0);
      else
        pending := pending + 1;
      end if;
      continue;
    end if;

    select coalesce(array_agg(x order by x), '{}') into given
      from unnest(string_to_array(coalesce(s.files->>qid, ''), ',')) as x where x <> '';
    select coalesce(array_agg(x order by x), '{}') into correct
      from jsonb_array_elements_text(coalesce(answer_key->qid->'correct', '[]'::jsonb)) as x;

    neg := greatest(coalesce(nullif(q->>'negative', '')::numeric, 0), 0);

    if cardinality(correct) > 0 and given = correct then
      new_scores := new_scores || jsonb_build_object(qid, pts);
      total_pts := total_pts + pts;
    elsif cardinality(correct) > 0 and cardinality(given) > 0 and neg > 0 then
      -- Answered and wrong, with negative marking on this question.
      new_scores := new_scores || jsonb_build_object(qid, -neg);
      total_pts := total_pts - neg;
    else
      new_scores := new_scores || jsonb_build_object(qid, 0);
    end if;
  end loop;

  insert into public.evaluations
    (submission_id, scores, total, max_total, feedback, feedback_by_criterion, pending_manual, graded_at, updated_at)
  values
    (p_submission_id, new_scores, total_pts, max_pts, '', '{}'::jsonb, pending, now(), now())
  on conflict (submission_id) do update
    set scores = excluded.scores,
        total = excluded.total,
        max_total = excluded.max_total,
        pending_manual = excluded.pending_manual,
        updated_at = now();
end; $$;
revoke all on function public.grade_quiz_submission(uuid) from public, anon, authenticated;

-- Auto-grade on every new submission (manual submit, browser auto-submit and
-- the server's collect_expired_drafts). A grading error must never block
-- the submission itself, so it is caught and logged.
create or replace function public.on_submission_grade_quiz() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    perform public.grade_quiz_submission(new.id);
  exception when others then
    raise warning 'quiz auto-grade failed for submission %: %', new.id, sqlerrm;
  end;
  return new;
end; $$;
revoke all on function public.on_submission_grade_quiz() from public, anon, authenticated;

drop trigger if exists submissions_grade_quiz on public.submissions;
create trigger submissions_grade_quiz
  after insert on public.submissions
  for each row execute function public.on_submission_grade_quiz();

-- Re-score every submission of a quiz after the admin edits the questions
-- or the key. Paragraph grades are kept. Admin only. Returns the count.
create or replace function public.regrade_quiz_project(p_project_id uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  sid uuid;
  n integer := 0;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  for sid in
    select sub.id from public.submissions sub
    join public.assignments a on a.id = sub.assignment_id
    where a.project_id = p_project_id
  loop
    perform public.grade_quiz_submission(sid);
    n := n + 1;
  end loop;
  return n;
end; $$;
revoke all on function public.regrade_quiz_project(uuid) from public, anon;
grant execute on function public.regrade_quiz_project(uuid) to authenticated;

-- ---------- Promote a first admin -----------------------------------
-- After signing up, run this in SQL editor with your email:
--   update public.profiles set role = 'admin' where email = 'you@example.com';

-- =====================================================================
-- Safe Exam Browser gate (same as migration_seb_gate.sql)
-- =====================================================================
-- Safe Exam Browser gate (exam-integrity plan, step 3).
--
-- An assignment with seb_config_id set can only be taken from an exam session
-- opened by `start_exam_session`, which checks the Config Key hash that the
-- Safe Exam Browser computes for the page (JS API: SafeExamBrowser.security).
-- A normal browser, or SEB started with any other/edited .seb file, gets no
-- session, and then the database hides the problem and refuses drafts and
-- submissions. Every start, refusal and takeover is written to exam_events.
--
-- The session token travels in the `x-exam-session` request header; RLS
-- reads it from PostgREST's request.headers. Only its SHA-256 is stored.
--
-- Assignments without seb_config_id behave exactly as before.
-- Idempotent; the same SQL is appended to schema.sql.

-- ---------- tables ----------------------------------------------------------

create table if not exists public.seb_configs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- Config Key(s) of the hand-out .seb file(s) (64 hex chars each, from the
  -- SEB config tool). More than one when there are variants, e.g. a macOS
  -- file without the content filter. Any of them is accepted.
  config_keys text[] not null check (cardinality(config_keys) > 0),
  -- Optional allow-list of Browser Exam Keys (pins SEB version/build).
  -- Empty = any SEB build that loads this exact config is accepted.
  browser_exam_keys text[] not null default '{}',
  created_at timestamptz not null default now()
);

alter table public.assignments
  add column if not exists seb_config_id uuid references public.seb_configs(id) on delete restrict;
create index if not exists assignments_seb_config_idx on public.assignments (seb_config_id) where seb_config_id is not null;

-- One-time nonces: put into the page URL before SEB computes its key hash,
-- so a captured hash can't be replayed.
create table if not exists public.exam_challenges (
  nonce text primary key,
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  expires_at timestamptz not null
);

create table if not exists public.exam_sessions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  token_hash text not null unique,
  status text not null default 'active' check (status in ('active', 'ended', 'revoked')),
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  ended_at timestamptz,
  end_reason text,
  ip text,
  user_agent text
);
create index if not exists exam_sessions_lookup_idx on public.exam_sessions (assignment_id, student_id, status);

create table if not exists public.exam_events (
  id bigint generated always as identity primary key,
  assignment_id uuid references public.assignments(id) on delete cascade,
  student_id uuid references public.profiles(id) on delete cascade,
  session_id uuid references public.exam_sessions(id) on delete set null,
  kind text not null,
  detail jsonb not null default '{}'::jsonb,
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists exam_events_assignment_idx on public.exam_events (assignment_id, created_at desc);
create index if not exists exam_events_created_idx on public.exam_events (created_at desc);

alter table public.seb_configs     enable row level security;
alter table public.exam_challenges enable row level security;
alter table public.exam_sessions   enable row level security;
alter table public.exam_events     enable row level security;

drop policy if exists seb_configs_admin_all  on public.seb_configs;
drop policy if exists exam_sessions_admin    on public.exam_sessions;
drop policy if exists exam_sessions_admin_up on public.exam_sessions;
drop policy if exists exam_events_admin_read on public.exam_events;
create policy seb_configs_admin_all on public.seb_configs
  for all using (public.is_admin()) with check (public.is_admin());
create policy exam_sessions_admin on public.exam_sessions
  for select using (public.is_admin());
-- Admin "Release" (ends a session so the student can start again elsewhere).
create policy exam_sessions_admin_up on public.exam_sessions
  for update using (public.is_admin()) with check (public.is_admin());
create policy exam_events_admin_read on public.exam_events
  for select using (public.is_admin());
-- exam_challenges: no policies, only the security-definer functions use it.

-- ---------- helpers ---------------------------------------------------------

create or replace function public.request_header(p_name text) returns text
language sql stable set search_path = public as $$
  select (nullif(current_setting('request.headers', true), '')::json) ->> lower(p_name)
$$;

create or replace function public.sha256_hex(p text) returns text
language sql immutable set search_path = public as $$
  select encode(sha256(convert_to(p, 'UTF8')), 'hex')
$$;

create or replace function public.request_ip() returns text
language sql stable set search_path = public as $$
  select coalesce(
    public.request_header('cf-connecting-ip'),
    split_part(coalesce(public.request_header('x-forwarded-for'), ''), ',', 1),
    ''
  )
$$;

-- True when the request carries the token of this student's live exam
-- session for the assignment.
create or replace function public.exam_session_ok(p_assignment uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.exam_sessions s
    join public.assignments a on a.id = s.assignment_id
    where s.assignment_id = p_assignment
      and s.student_id = auth.uid()
      and s.status = 'active'
      and s.token_hash = public.sha256_hex(coalesce(public.request_header('x-exam-session'), ''))
      and now() <= a.ends_at + interval '2 minutes'
  )
$$;
revoke all on function public.exam_session_ok(uuid) from public, anon;
grant execute on function public.exam_session_ok(uuid) to authenticated;

-- Shared check used by the policies below: SEB not required, or the exam
-- window is over (problem no longer secret), or a live session is presented.
create or replace function public.seb_gate_ok(p_assignment uuid, p_seb_config uuid, p_ends_at timestamptz) returns boolean
language sql stable security definer set search_path = public as $$
  select p_seb_config is null
      or now() > p_ends_at + interval '2 minutes'
      or public.exam_session_ok(p_assignment)
$$;
revoke all on function public.seb_gate_ok(uuid, uuid, timestamptz) from public, anon;
grant execute on function public.seb_gate_ok(uuid, uuid, timestamptz) to authenticated;

-- Repeats of the same blocked attempt by the same student are logged at most
-- once a minute, so a script hammering the gate can't flood the log.
drop function if exists public.log_exam_event(uuid, uuid, uuid, text, jsonb);
create function public.log_exam_event(
  p_assignment uuid, p_student uuid, p_session uuid, p_kind text, p_detail jsonb
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_kind like 'blocked\_%' and exists (
    select 1 from public.exam_events e
    where e.assignment_id = p_assignment and e.student_id = p_student and e.kind = p_kind
      and e.created_at > now() - interval '1 minute'
  ) then
    return;
  end if;
  insert into public.exam_events (assignment_id, student_id, session_id, kind, detail, ip, user_agent)
  values (p_assignment, p_student, p_session, p_kind, coalesce(p_detail, '{}'::jsonb),
          public.request_ip(), left(coalesce(public.request_header('user-agent'), ''), 400));
end $$;
revoke all on function public.log_exam_event(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;

-- ---------- student RPCs ----------------------------------------------------

-- Step 1: get a one-time nonce to put in the page URL.
create or replace function public.exam_challenge(p_assignment uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_nonce text;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if not exists (
    select 1 from public.assignments a
    where a.id = p_assignment
      and (a.is_public or lower(a.assignee_email) = public.current_email())
  ) then
    raise exception 'assignment not found';
  end if;
  delete from public.exam_challenges where expires_at < now() or student_id = v_uid and assignment_id = p_assignment;
  v_nonce := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.exam_challenges (nonce, assignment_id, student_id, expires_at)
  values (v_nonce, p_assignment, v_uid, now() + interval '2 minutes');
  return v_nonce;
end $$;
revoke all on function public.exam_challenge(uuid) from public, anon;
grant execute on function public.exam_challenge(uuid) to authenticated;

-- Step 2: prove this page is running in SEB with the exam's config.
-- p_url is the page URL SEB hashed (with ?exam_nonce=…, no #fragment).
-- Returns {ok:true, token} or {ok:false, reason}. Never raises after the
-- sign-in check, so refusals are always logged.
create or replace function public.start_exam_session(
  p_assignment uuid, p_url text, p_config_key_hash text, p_browser_exam_key_hash text
) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  a public.assignments%rowtype;
  cfg public.seb_configs%rowtype;
  v_nonce text;
  v_existing public.exam_sessions%rowtype;
  v_token text;
  v_session uuid;
  v_ua text := coalesce(public.request_header('user-agent'), '');
  v_detail jsonb;
begin
  if v_uid is null then raise exception 'not signed in'; end if;

  select * into a from public.assignments x
  where x.id = p_assignment
    and (x.is_public or lower(x.assignee_email) = public.current_email());
  if not found then
    return json_build_object('ok', false, 'reason', 'not_assigned');
  end if;
  if a.seb_config_id is null then
    return json_build_object('ok', true, 'required', false);
  end if;

  v_detail := jsonb_build_object('seb', (v_ua ~ 'SEB/'), 'has_config_key', coalesce(p_config_key_hash, '') <> '');

  if now() < a.starts_at then
    return json_build_object('ok', false, 'reason', 'not_open', 'starts_at', a.starts_at);
  end if;
  if now() > a.ends_at then
    return json_build_object('ok', false, 'reason', 'closed');
  end if;
  if exists (select 1 from public.submissions s where s.assignment_id = a.id and s.student_id = v_uid) then
    return json_build_object('ok', false, 'reason', 'already_submitted');
  end if;

  -- Nonce must be one we issued to this student for this assignment.
  v_nonce := substring(coalesce(p_url, '') from '[?&]exam_nonce=([0-9a-f]{64})');
  delete from public.exam_challenges c
  where c.nonce = v_nonce and c.student_id = v_uid and c.assignment_id = a.id and c.expires_at >= now()
  returning c.nonce into v_nonce;
  if v_nonce is null then
    perform public.log_exam_event(a.id, v_uid, null, 'blocked_bad_challenge', v_detail);
    return json_build_object('ok', false, 'reason', 'bad_challenge');
  end if;

  select * into cfg from public.seb_configs where id = a.seb_config_id;
  if coalesce(p_config_key_hash, '') = '' then
    perform public.log_exam_event(a.id, v_uid, null, 'blocked_no_seb', v_detail);
    return json_build_object('ok', false, 'reason', 'no_seb');
  end if;
  if not exists (
    select 1 from unnest(cfg.config_keys) k
    where public.sha256_hex(p_url || lower(k)) = lower(p_config_key_hash)
  ) then
    perform public.log_exam_event(a.id, v_uid, null, 'blocked_wrong_config', v_detail);
    return json_build_object('ok', false, 'reason', 'wrong_config');
  end if;
  if cardinality(cfg.browser_exam_keys) > 0 and not exists (
    select 1 from unnest(cfg.browser_exam_keys) k
    where public.sha256_hex(p_url || lower(k)) = lower(coalesce(p_browser_exam_key_hash, ''))
  ) then
    perform public.log_exam_event(a.id, v_uid, null, 'blocked_wrong_browser', v_detail);
    return json_build_object('ok', false, 'reason', 'wrong_browser');
  end if;

  -- One device at a time. A session seen in the last 90 s blocks a new one;
  -- an older one (crash, closed laptop) is replaced.
  select * into v_existing from public.exam_sessions s
  where s.assignment_id = a.id and s.student_id = v_uid and s.status = 'active'
  order by s.last_seen_at desc limit 1;
  if found then
    if v_existing.last_seen_at > now() - interval '90 seconds' then
      perform public.log_exam_event(a.id, v_uid, v_existing.id, 'blocked_second_device',
        v_detail || jsonb_build_object('active_ip', v_existing.ip));
      return json_build_object('ok', false, 'reason', 'active_elsewhere');
    end if;
    update public.exam_sessions
       set status = 'revoked', ended_at = now(), end_reason = 'replaced'
     where assignment_id = a.id and student_id = v_uid and status = 'active';
    perform public.log_exam_event(a.id, v_uid, v_existing.id, 'session_replaced',
      jsonb_build_object('old_ip', v_existing.ip));
  end if;

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.exam_sessions (assignment_id, student_id, token_hash, ip, user_agent)
  values (a.id, v_uid, public.sha256_hex(v_token), public.request_ip(), left(v_ua, 400))
  returning id into v_session;
  perform public.log_exam_event(a.id, v_uid, v_session, 'session_started', v_detail);
  return json_build_object('ok', true, 'required', true, 'token', v_token, 'session_id', v_session);
end $$;
revoke all on function public.start_exam_session(uuid, text, text, text) from public, anon;
grant execute on function public.start_exam_session(uuid, text, text, text) to authenticated;

-- Keeps the session alive; tells the page if it was ended elsewhere.
create or replace function public.exam_heartbeat(p_assignment uuid) returns json
language plpgsql security definer set search_path = public as $$
declare
  s public.exam_sessions%rowtype;
begin
  select * into s from public.exam_sessions x
  where x.assignment_id = p_assignment and x.student_id = auth.uid()
    and x.token_hash = public.sha256_hex(coalesce(public.request_header('x-exam-session'), ''));
  if not found then return json_build_object('ok', false, 'reason', 'none'); end if;
  if s.status <> 'active' then
    return json_build_object('ok', false, 'reason', coalesce(s.end_reason, s.status));
  end if;
  update public.exam_sessions set last_seen_at = now() where id = s.id;
  -- A change of network mid-exam is worth a look.
  if coalesce(s.ip, '') <> '' and public.request_ip() <> '' and public.request_ip() <> s.ip then
    update public.exam_sessions set ip = public.request_ip() where id = s.id;
    perform public.log_exam_event(p_assignment, s.student_id, s.id, 'ip_changed', jsonb_build_object('old_ip', s.ip));
  end if;
  return json_build_object('ok', true);
end $$;
revoke all on function public.exam_heartbeat(uuid) from public, anon;
grant execute on function public.exam_heartbeat(uuid) to authenticated;

-- A submission (manual, auto or auto-collected) ends the student's sessions.
create or replace function public.on_submission_end_sessions() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.exam_sessions
     set status = 'ended', ended_at = now(), end_reason = 'submitted'
   where assignment_id = new.assignment_id and student_id = new.student_id and status = 'active';
  return new;
end $$;
revoke all on function public.on_submission_end_sessions() from public, anon, authenticated;
drop trigger if exists submissions_end_sessions on public.submissions;
create trigger submissions_end_sessions after insert on public.submissions
  for each row execute function public.on_submission_end_sessions();

-- ---------- policies: require the gate for SEB assignments -----------------

drop policy if exists projects_assigned_read on public.projects;
create policy projects_assigned_read on public.projects for select using (
  exists (
    select 1 from public.assignments a
    where a.project_id = projects.id
      and (a.is_public or lower(a.assignee_email) = public.current_email())
      and now() >= a.starts_at
      and public.seb_gate_ok(a.id, a.seb_config_id, a.ends_at)
  )
);

drop policy if exists assets_assigned_read on public.project_assets;
create policy assets_assigned_read on public.project_assets for select using (
  exists (
    select 1 from public.assignments a
    where a.project_id = project_assets.project_id
      and (a.is_public or lower(a.assignee_email) = public.current_email())
      and now() >= a.starts_at
      and public.seb_gate_ok(a.id, a.seb_config_id, a.ends_at)
  )
);

drop policy if exists submissions_self_write on public.submissions;
create policy submissions_self_write on public.submissions for insert with check (
  student_id = auth.uid()
  and exists (
    select 1 from public.assignments a
    where a.id = submissions.assignment_id
      and (a.is_public or lower(a.assignee_email) = public.current_email())
      and now() >= a.starts_at
      and now() <= a.ends_at + interval '30 seconds'
      and (a.seb_config_id is null or public.exam_session_ok(a.id))
  )
);

drop policy if exists drafts_self_rw on public.submission_drafts;
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
        and (a.seb_config_id is null or public.exam_session_ok(a.id))
    )
  );

notify pgrst, 'reload schema';

-- =====================================================================
-- Exam activity tracking (same as migration_exam_tracking.sql)
-- =====================================================================
-- Exam activity tracking (exam-integrity plan, step 5). Needs migration_seb_gate.sql.
--
-- 1. Browser-reported events (pastes, copies, focus loss, typing activity, …)
--    go into exam_events through log_client_events(), which only accepts them
--    for the student's own open assignment (and, for SEB exams, only with a
--    live exam session). Rate- and size-limited.
-- 2. Code history: every autosave is diffed against the last recorded state
--    and, at most every 20 s, the changed files are stored in
--    submission_draft_versions, plus a final version on submit. Lets an admin
--    replay how the answer was written.
-- 3. exam_integrity_summary: per student + assignment counters for the admin
--    (risk badges are computed from it in the app, src/lib/integrity.ts).
-- Idempotent; the same SQL is appended to schema.sql.

-- ---------- 1. client events ------------------------------------------------

alter table public.exam_events add column if not exists client_ts timestamptz;
create index if not exists exam_events_student_idx on public.exam_events (assignment_id, student_id, created_at);

create or replace function public.log_client_events(p_assignment uuid, p_events jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  a public.assignments%rowtype;
  v_session uuid;
  v_existing integer;
  v_ip text := public.request_ip();
  v_ua text := left(coalesce(public.request_header('user-agent'), ''), 400);
  e jsonb;
  n integer := 0;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if jsonb_typeof(p_events) <> 'array' then raise exception 'events must be an array'; end if;
  if jsonb_array_length(p_events) > 100 then raise exception 'too many events in one call'; end if;

  select * into a from public.assignments x
  where x.id = p_assignment
    and (x.is_public or lower(x.assignee_email) = public.current_email())
    and now() >= x.starts_at and now() <= x.ends_at + interval '2 minutes';
  if not found then return 0; end if;

  if a.seb_config_id is not null then
    if not public.exam_session_ok(a.id) then return 0; end if;
    select s.id into v_session from public.exam_sessions s
    where s.assignment_id = a.id and s.student_id = v_uid and s.status = 'active'
      and s.token_hash = public.sha256_hex(coalesce(public.request_header('x-exam-session'), ''));
  end if;

  -- Hard cap per student per assignment, so a script can't fill the table.
  select count(*) into v_existing from public.exam_events
  where assignment_id = a.id and student_id = v_uid and client_ts is not null;
  if v_existing >= 3000 then return 0; end if;

  for e in select * from jsonb_array_elements(p_events) loop
    exit when v_existing + n >= 3000;
    continue when coalesce(e->>'kind', '') not in
      ('paste', 'large_insert', 'copy', 'focus_lost', 'activity', 'multi_screen', 'print_screen', 'tracker_started');
    e := jsonb_set(e, '{detail}', coalesce(e->'detail', '{}'::jsonb));
    continue when jsonb_typeof(e->'detail') <> 'object';
    continue when length((e->'detail')::text) > 6000;
    -- Numeric / boolean fields the summary view casts must be well-formed.
    continue when exists (
      select 1 from jsonb_each(e->'detail') d
      where (d.key in ('chars', 'away_ms', 'keys', 'lines', 'screens')
             and case when jsonb_typeof(d.value) = 'number'
                      then (d.value)::numeric < 0 or (d.value)::numeric > 100000000
                           or (d.value)::numeric <> trunc((d.value)::numeric)
                      else true end)
         or (d.key = 'internal' and jsonb_typeof(d.value) <> 'boolean')
    );
    continue when coalesce(e->>'at', '') <> '' and (e->>'at') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$';
    insert into public.exam_events (assignment_id, student_id, session_id, kind, detail, ip, user_agent, client_ts)
    values (a.id, v_uid, v_session, e->>'kind', e->'detail', v_ip, v_ua,
            coalesce(nullif(e->>'at', '')::timestamptz, now()));
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.log_client_events(uuid, jsonb) from public, anon;
grant execute on function public.log_client_events(uuid, jsonb) to authenticated;

-- ---------- 2. code history -------------------------------------------------

create table if not exists public.submission_draft_versions (
  id bigint generated always as identity primary key,
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  saved_at timestamptz not null default now(),
  changed jsonb not null default '{}'::jsonb,   -- files whose content changed (full new content)
  removed text[] not null default '{}',          -- files deleted since the previous version
  is_final boolean not null default false        -- the submitted version
);
create index if not exists draft_versions_lookup_idx on public.submission_draft_versions (assignment_id, student_id, saved_at);

-- Last recorded state per student + assignment (the base for the next diff).
create table if not exists public.draft_version_heads (
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  files jsonb not null default '{}'::jsonb,
  recorded_at timestamptz not null,
  primary key (assignment_id, student_id)
);

alter table public.submission_draft_versions enable row level security;
alter table public.draft_version_heads enable row level security;
drop policy if exists draft_versions_admin_read on public.submission_draft_versions;
create policy draft_versions_admin_read on public.submission_draft_versions for select using (public.is_admin());
-- draft_version_heads: no policies (only the trigger functions use it).

create or replace function public.record_draft_version(
  p_assignment uuid, p_student uuid, p_files jsonb, p_final boolean
) returns void
language plpgsql security definer set search_path = public as $$
declare
  h public.draft_version_heads%rowtype;
  v_has_head boolean;
  v_changed jsonb;
  v_removed text[];
begin
  p_files := coalesce(p_files, '{}'::jsonb);
  select * into h from public.draft_version_heads
  where assignment_id = p_assignment and student_id = p_student for update;
  v_has_head := found;

  if v_has_head and not p_final and h.recorded_at > now() - interval '20 seconds' then
    return; -- throttle: the next save after 20 s will carry these changes too
  end if;

  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) into v_changed
  from jsonb_each(p_files) as f(k, v)
  where not v_has_head or h.files -> k is distinct from v;
  select coalesce(array_agg(k), '{}') into v_removed
  from jsonb_object_keys(coalesce(h.files, '{}'::jsonb)) as k
  where not (p_files ? k);

  if v_changed = '{}'::jsonb and cardinality(v_removed) = 0 and not p_final then
    return;
  end if;

  insert into public.submission_draft_versions (assignment_id, student_id, changed, removed, is_final)
  values (p_assignment, p_student, v_changed, v_removed, p_final);
  insert into public.draft_version_heads (assignment_id, student_id, files, recorded_at)
  values (p_assignment, p_student, p_files, now())
  on conflict (assignment_id, student_id) do update set files = excluded.files, recorded_at = excluded.recorded_at;
end $$;
revoke all on function public.record_draft_version(uuid, uuid, jsonb, boolean) from public, anon, authenticated;

create or replace function public.on_draft_save_version() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.record_draft_version(new.assignment_id, new.student_id, new.files, false);
  return new;
end $$;
revoke all on function public.on_draft_save_version() from public, anon, authenticated;
drop trigger if exists submission_drafts_version on public.submission_drafts;
create trigger submission_drafts_version after insert or update of files on public.submission_drafts
  for each row execute function public.on_draft_save_version();

create or replace function public.on_submission_final_version() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.record_draft_version(new.assignment_id, new.student_id, new.files, true);
  return new;
end $$;
revoke all on function public.on_submission_final_version() from public, anon, authenticated;
drop trigger if exists submissions_final_version on public.submissions;
create trigger submissions_final_version after insert on public.submissions
  for each row execute function public.on_submission_final_version();

-- ---------- 3. summary for admins -------------------------------------------

drop view if exists public.exam_integrity_summary;
create view public.exam_integrity_summary with (security_invoker = true) as
select
  e.assignment_id,
  e.student_id,
  count(*) filter (where e.kind = 'paste' and not coalesce((e.detail->>'internal')::boolean, false)) as pastes,
  coalesce(max((e.detail->>'chars')::int) filter (where e.kind = 'paste' and not coalesce((e.detail->>'internal')::boolean, false)), 0) as largest_paste,
  coalesce(sum((e.detail->>'chars')::int) filter (where e.kind = 'paste' and not coalesce((e.detail->>'internal')::boolean, false)), 0) as pasted_chars,
  count(*) filter (where e.kind = 'large_insert') as large_inserts,
  coalesce(max((e.detail->>'chars')::int) filter (where e.kind = 'large_insert'), 0) as largest_insert,
  count(*) filter (where e.kind = 'focus_lost') as focus_losses,
  (coalesce(sum((e.detail->>'away_ms')::bigint) filter (where e.kind = 'focus_lost'), 0) / 1000)::bigint as away_seconds,
  coalesce(max((e.detail->>'away_ms')::bigint) filter (where e.kind = 'focus_lost'), 0) / 1000 as longest_away_seconds,
  count(*) filter (where e.kind = 'copy') as copies,
  count(*) filter (where e.kind = 'print_screen') as print_screens,
  bool_or(e.kind = 'multi_screen') as multi_screen,
  coalesce(sum((e.detail->>'keys')::int) filter (where e.kind = 'activity'), 0) as keystrokes,
  count(*) filter (where e.kind = 'activity') as active_minutes,
  count(*) filter (where e.kind = 'blocked_no_seb') as blocked_no_seb,
  count(*) filter (where e.kind in ('blocked_wrong_config', 'blocked_wrong_browser')) as blocked_wrong_config,
  count(*) filter (where e.kind = 'blocked_second_device') as blocked_second_device,
  count(*) filter (where e.kind = 'session_replaced') as device_changes,
  count(*) filter (where e.kind = 'ip_changed') as ip_changes,
  bool_or(e.kind = 'tracker_started') as tracked
from public.exam_events e
where e.assignment_id is not null and e.student_id is not null
group by e.assignment_id, e.student_id;
grant select on public.exam_integrity_summary to authenticated;

notify pgrst, 'reload schema';
