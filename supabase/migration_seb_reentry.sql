-- Re-entry needs invigilator approval. Needs migration_seb_gate.sql,
-- migration_exam_tracking.sql and migration_seb_networks.sql (run after them).
--
-- Before: a student who left a locked exam (quit SEB, laptop died) could get
-- back in on their own after 90 s. Now any new session for an exam the student
-- already had a session for needs an invigilator's approval:
--   * start_exam_session returns `needs_approval` and opens a pending request
--     (logged `reentry_requested`; `blocked_second_device` too if the earlier
--     session is still alive);
--   * the student's page waits (exam_reentry_status) and continues by itself;
--   * an invigilator approves or denies on Admin → Exam security
--     (decide_exam_reentry, logged with who decided). Approving ends the
--     earlier session, and the next attempt uses the approval once.
-- A reload inside the same SEB window is not a re-entry: it resumes with the
-- token it already holds. Idempotent; the same SQL is appended to schema.sql.

create table if not exists public.exam_reentry_requests (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied', 'used')),
  requested_at timestamptz not null default now(),
  last_attempt_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.profiles(id) on delete set null,
  used_at timestamptz,
  ip text,
  user_agent text,
  other_device_active boolean not null default false
);
-- At most one open (pending or approved) request per student per exam.
create unique index if not exists exam_reentry_open_uniq
  on public.exam_reentry_requests (assignment_id, student_id) where status in ('pending', 'approved');
create index if not exists exam_reentry_pending_idx on public.exam_reentry_requests (status, requested_at desc);

alter table public.exam_reentry_requests enable row level security;
drop policy if exists exam_reentry_admin_read on public.exam_reentry_requests;
create policy exam_reentry_admin_read on public.exam_reentry_requests for select using (public.is_admin());
-- Writes only through the functions below.

-- ---------- start_exam_session: + re-entry approval ------------------------
-- Same as migration_seb_networks.sql except the one-device block.
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
  v_ip inet := public.request_client_inet();
  v_req public.exam_reentry_requests%rowtype;
  v_live boolean;
  v_reentry boolean := false;
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

  -- Allowed networks (exam-room Wi-Fi). No / unparsable address = refused.
  if not public.seb_network_ok(cfg.allowed_ip_ranges, v_ip) then
    perform public.log_exam_event(a.id, v_uid, null, 'blocked_wrong_network',
      v_detail || jsonb_build_object('client_ip', coalesce(host(v_ip), ''), 'ip_found', v_ip is not null));
    return json_build_object('ok', false, 'reason', 'wrong_network');
  end if;

  -- Re-entry needs an invigilator. A student who already had a session for
  -- this exam (left SEB, laptop died, opened it elsewhere) gets a pending
  -- request instead of a session; an invigilator approves it on Admin → Exam
  -- security, and the next attempt uses that approval once. A reload in the
  -- same SEB window never gets here: it resumes with its stored token.
  if exists (select 1 from public.exam_sessions s where s.assignment_id = a.id and s.student_id = v_uid) then
    select * into v_req from public.exam_reentry_requests r
    where r.assignment_id = a.id and r.student_id = v_uid and r.status = 'approved'
    order by r.decided_at desc limit 1 for update;
    if found then
      update public.exam_reentry_requests set status = 'used', used_at = now() where id = v_req.id;
      update public.exam_sessions
         set status = 'revoked', ended_at = now(), end_reason = 'reentry_approved'
       where assignment_id = a.id and student_id = v_uid and status = 'active';
      v_reentry := true;
    else
      v_live := exists (
        select 1 from public.exam_sessions s
        where s.assignment_id = a.id and s.student_id = v_uid and s.status = 'active'
          and s.last_seen_at > now() - interval '90 seconds');
      if v_live then
        perform public.log_exam_event(a.id, v_uid, null, 'blocked_second_device', v_detail);
      end if;
      select * into v_req from public.exam_reentry_requests r
      where r.assignment_id = a.id and r.student_id = v_uid and r.status = 'pending' for update;
      if found then
        update public.exam_reentry_requests
           set last_attempt_at = now(), ip = public.request_ip(), user_agent = left(v_ua, 400),
               other_device_active = v_live
         where id = v_req.id;
      else
        insert into public.exam_reentry_requests (assignment_id, student_id, ip, user_agent, other_device_active)
        values (a.id, v_uid, public.request_ip(), left(v_ua, 400), v_live);
        perform public.log_exam_event(a.id, v_uid, null, 'reentry_requested',
          v_detail || jsonb_build_object('other_device_active', v_live));
      end if;
      return json_build_object('ok', false, 'reason', 'needs_approval', 'other_device_active', v_live);
    end if;
  end if;

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.exam_sessions (assignment_id, student_id, token_hash, ip, user_agent)
  values (a.id, v_uid, public.sha256_hex(v_token), public.request_ip(), left(v_ua, 400))
  returning id into v_session;
  perform public.log_exam_event(a.id, v_uid, v_session, 'session_started', v_detail || jsonb_build_object('reentry', v_reentry));
  return json_build_object('ok', true, 'required', true, 'token', v_token, 'session_id', v_session);
end $$;
revoke all on function public.start_exam_session(uuid, text, text, text) from public, anon;
grant execute on function public.start_exam_session(uuid, text, text, text) to authenticated;

-- ---------- student: is my request approved yet? ---------------------------
create or replace function public.exam_reentry_status(p_assignment uuid) returns json
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select json_build_object('status', r.status, 'requested_at', r.requested_at)
       from public.exam_reentry_requests r
      where r.assignment_id = p_assignment and r.student_id = auth.uid()
      order by r.requested_at desc limit 1),
    json_build_object('status', 'none'))
$$;
revoke all on function public.exam_reentry_status(uuid) from public, anon;
grant execute on function public.exam_reentry_status(uuid) to authenticated;

-- ---------- invigilator: approve / deny ------------------------------------
create or replace function public.decide_exam_reentry(p_request uuid, p_approve boolean) returns json
language plpgsql security definer set search_path = public as $$
declare
  r public.exam_reentry_requests%rowtype;
  v_by text;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  select * into r from public.exam_reentry_requests where id = p_request for update;
  if not found then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  if r.status <> 'pending' then return json_build_object('ok', false, 'reason', 'already_' || r.status); end if;
  update public.exam_reentry_requests
     set status = case when p_approve then 'approved' else 'denied' end,
         decided_at = now(), decided_by = auth.uid()
   where id = r.id;
  if p_approve then
    -- The earlier device stops at once (its page shows "session ended").
    update public.exam_sessions
       set status = 'revoked', ended_at = now(), end_reason = 'reentry_approved'
     where assignment_id = r.assignment_id and student_id = r.student_id and status = 'active';
  end if;
  select email into v_by from public.profiles where id = auth.uid();
  perform public.log_exam_event(r.assignment_id, r.student_id, null,
    case when p_approve then 'reentry_approved' else 'reentry_denied' end,
    jsonb_build_object('by', coalesce(v_by, ''), 'waited_s', extract(epoch from now() - r.requested_at)::int));
  return json_build_object('ok', true);
end $$;
revoke all on function public.decide_exam_reentry(uuid, boolean) from public, anon;
grant execute on function public.decide_exam_reentry(uuid, boolean) to authenticated;

-- ---------- summary for admins: + re-entry counters -------------------------
-- Same as migration_seb_networks.sql plus three columns at the end.
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
  bool_or(e.kind = 'tracker_started') as tracked,
  count(*) filter (where e.kind = 'blocked_wrong_network') as blocked_wrong_network,
  count(*) filter (where e.kind = 'left_allowed_network') as left_allowed_network,
  count(*) filter (where e.kind = 'reentry_requested') as reentry_requests,
  count(*) filter (where e.kind = 'reentry_approved') as reentries,
  count(*) filter (where e.kind = 'reentry_denied') as reentries_denied
from public.exam_events e
where e.assignment_id is not null and e.student_id is not null
group by e.assignment_id, e.student_id;
grant select on public.exam_integrity_summary to authenticated;

notify pgrst, 'reload schema';
