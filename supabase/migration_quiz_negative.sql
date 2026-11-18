-- =====================================================================
-- Quiz negative marking. Replaces grade_quiz_submission() only; no table,
-- column or data changes. Questions opt in with "negative": <marks> in
-- projects.quiz (choice questions). Idempotent; also folded into
-- migration_quiz.sql and schema.sql. Existing evaluations change only when
-- an admin re-scores a quiz (regrade_quiz_project) or a new submission lands.
-- =====================================================================

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
