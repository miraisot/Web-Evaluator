-- Hide a problem (project row, its quiz questions and its asset list) from
-- students until the assignment's starts_at. Before this, a student could sign
-- in from any browser before the exam and read their problem statement.
-- Admins are unaffected (projects_admin_all / assets_admin_all).
-- Idempotent; the same change is in schema.sql.

drop policy if exists projects_assigned_read on public.projects;
create policy projects_assigned_read on public.projects for select using (
  exists (
    select 1 from public.assignments a
    where a.project_id = projects.id
      and (a.is_public or lower(a.assignee_email) = public.current_email())
      and now() >= a.starts_at
  )
);

drop policy if exists assets_assigned_read on public.project_assets;
create policy assets_assigned_read on public.project_assets for select using (
  exists (
    select 1 from public.assignments a
    where a.project_id = project_assets.project_id
      and (a.is_public or lower(a.assignee_email) = public.current_email())
      and now() >= a.starts_at
  )
);

notify pgrst, 'reload schema';
