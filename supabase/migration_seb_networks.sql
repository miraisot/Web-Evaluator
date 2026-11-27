-- Allowed networks for Safe Exam Browser configs. Needs migration_seb_gate.sql
-- and migration_exam_tracking.sql.
--
-- Students take exams on their own laptops in the exam room. A config can
-- list the public IP range(s) of the exam-room Wi-Fi; then
-- start_exam_session refuses (reason `wrong_network`, logged as
-- `blocked_wrong_network`) a start from any other network, e.g. from home or
-- over a phone hotspot. If the IP changes mid-exam to one outside the ranges,
-- exam_heartbeat logs `left_allowed_network` but does NOT end the session
-- (Wi-Fi blips, roaming between access points).
--
-- Empty allowed_ip_ranges (the default) = no restriction, behaviour unchanged.
--
-- Which header holds the client IP on hosted Supabase:
--   PostgREST exposes the HTTP headers as request.headers. Hosted Supabase
--   sits behind Cloudflare and its API gateway. `x-forwarded-for` is NOT safe
--   for this: a client-sent X-Forwarded-For is kept and the gateway appends
--   the real address, so the FIRST entry is whatever the caller wrote
--   (observed: `x-forwarded-for: spoofed,68.65.164.215` with
--   `cf-connecting-ip: 68.65.164.215`, github.com/orgs/supabase/discussions/34647).
--   `cf-connecting-ip` is set by Cloudflare to the address that connected to
--   it and is what we trust. Fallback, if it is ever missing: the LAST
--   x-forwarded-for entry (the one the gateway added), never the first.
--   This was not verified against our own project with a live request; check
--   it in the dry run (README, "Allowed networks").
-- public.request_ip() (used for logging) is left as it is.
--
-- Idempotent; the same SQL is appended to schema.sql.

alter table public.seb_configs
  add column if not exists allowed_ip_ranges cidr[] not null default '{}';

-- NULL when the text is not an IP address.
create or replace function public.try_inet(p text) returns inet
language plpgsql immutable set search_path = public as $$
begin
  if p is null or btrim(p) = '' then return null; end if;
  return btrim(p)::inet;
exception when others then
  return null;
end $$;

-- The client address we trust for the network check (see header comment).
create or replace function public.request_client_inet() returns inet
language sql stable set search_path = public as $$
  select coalesce(
    public.try_inet(public.request_header('cf-connecting-ip')),
    public.try_inet((regexp_split_to_array(coalesce(public.request_header('x-forwarded-for'), ''), '\s*,\s*'))
                    [cardinality(regexp_split_to_array(coalesce(public.request_header('x-forwarded-for'), ''), '\s*,\s*'))])
  )
$$;

-- True when the config has no ranges, or the address is in one of them.
-- A missing / unparsable address is never on an allowed network.
create or replace function public.seb_network_ok(p_ranges cidr[], p_ip inet) returns boolean
language sql immutable set search_path = public as $$
  select coalesce(cardinality(p_ranges), 0) = 0
      or (p_ip is not null and p_ip <<= any(p_ranges))
$$;

-- ---------- start_exam_session: + network check -----------------------------
-- Same as migration_seb_gate.sql, plus the "Allowed networks" step after the
-- SEB checks (so a non-SEB attempt is still reported as no_seb).
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

-- ---------- exam_heartbeat: + left_allowed_network ---------------------------
-- Same as migration_seb_gate.sql. When the IP changes, ip_changed is logged as
-- before and, if the config has allowed ranges and the new address is outside
-- them (or can't be read), left_allowed_network too. The session continues.
create or replace function public.exam_heartbeat(p_assignment uuid) returns json
language plpgsql security definer set search_path = public as $$
declare
  s public.exam_sessions%rowtype;
  v_ip text := public.request_ip();
  v_ranges cidr[];
  v_client inet;
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
  if coalesce(s.ip, '') <> '' and v_ip <> '' and v_ip <> s.ip then
    update public.exam_sessions set ip = v_ip where id = s.id;
    perform public.log_exam_event(p_assignment, s.student_id, s.id, 'ip_changed', jsonb_build_object('old_ip', s.ip));
    select c.allowed_ip_ranges into v_ranges
    from public.assignments a join public.seb_configs c on c.id = a.seb_config_id
    where a.id = p_assignment;
    v_client := public.request_client_inet();
    if not public.seb_network_ok(v_ranges, v_client) then
      perform public.log_exam_event(p_assignment, s.student_id, s.id, 'left_allowed_network',
        jsonb_build_object('old_ip', s.ip, 'client_ip', coalesce(host(v_client), '')));
    end if;
  end if;
  return json_build_object('ok', true);
end $$;
revoke all on function public.exam_heartbeat(uuid) from public, anon;
grant execute on function public.exam_heartbeat(uuid) to authenticated;

-- ---------- summary for admins: + network counters --------------------------
-- Same as migration_exam_tracking.sql plus blocked_wrong_network and
-- left_allowed_network (new columns at the end).
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
  count(*) filter (where e.kind = 'left_allowed_network') as left_allowed_network
from public.exam_events e
where e.assignment_id is not null and e.student_id is not null
group by e.assignment_id, e.student_id;
grant select on public.exam_integrity_summary to authenticated;

notify pgrst, 'reload schema';
