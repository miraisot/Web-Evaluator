-- =====================================================================
-- Migration: student_roster + batch on profiles
-- Lets admins assign by (campus, batch) — the UI fills the email list
-- from this roster, then the assignment system stays per-email as before.
-- Idempotent: safe to run on top of existing schema.sql.
-- =====================================================================

-- ---------- Profile batch ------------------------------------------------
alter table public.profiles add column if not exists batch text;

-- ---------- Roster table -------------------------------------------------
-- Pre-registration list: these students exist before they sign up, so the
-- admin can assign to a whole campus/batch without waiting on anyone's
-- first login. On signup the handle_new_user trigger will match the roster
-- row by email and copy its (name, uid, campus, batch) into the profile.
create table if not exists public.student_roster (
  email text primary key,              -- lowercased
  name  text,
  uid   text,
  campus text check (campus in ('Hi-Tech', 'RGIB', 'JU')),
  batch  text not null,                -- '2025', '2026', ...
  created_at timestamptz not null default now()
);
create index if not exists student_roster_campus_batch_idx
  on public.student_roster (campus, batch);
create index if not exists student_roster_batch_idx
  on public.student_roster (batch);

alter table public.student_roster enable row level security;
drop policy if exists roster_admin_all on public.student_roster;
drop policy if exists roster_self_read on public.student_roster;
create policy roster_admin_all on public.student_roster
  for all using (public.is_admin()) with check (public.is_admin());
-- Students may read only their own roster row (useful for signup matching).
create policy roster_self_read on public.student_roster
  for select using (lower(email) = public.current_email());

-- ---------- Signup trigger: inherit roster details ----------------------
-- Replaces handle_new_user from schema.sql. When a new auth user signs up
-- with an email that's already in the roster, carry over the roster's
-- name/uid/campus/batch so the admin doesn't have to re-enter them.
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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Backfill batch on existing profiles --------------------------
update public.profiles p
set batch = r.batch
from public.student_roster r
where lower(p.email) = r.email and p.batch is null;
