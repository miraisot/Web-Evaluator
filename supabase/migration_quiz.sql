-- =====================================================================
-- Quiz support (project_type = 'quiz')
-- Idempotent. Also included at the end of schema.sql, so `npm run db:apply`
-- applies it; paste this file into the SQL editor to apply it on its own.
--
-- Layout:
--   projects.quiz          jsonb  questions only (students can read it)
--   quiz_answer_keys       table  correct options + model answers (admin only)
--   submissions.files      jsonb  the student's answers: { "<questionId>": "<answer>" }
--                                 single   -> "<optionId>"
--                                 multiple -> "<optionId>,<optionId>"
--                                 paragraph-> free text
--   evaluations            auto-filled by a trigger when a quiz submission
--                          arrives; pending_manual = paragraph answers still
--                          to be graded by an admin.
-- =====================================================================

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
