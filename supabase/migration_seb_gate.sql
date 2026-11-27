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
