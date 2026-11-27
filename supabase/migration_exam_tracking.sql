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
