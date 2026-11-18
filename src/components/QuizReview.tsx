import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Evaluation, FileMap, Quiz, QuizKey } from '../lib/types'
import { autoScore, decodeChoice, negativeMarks, normalizeQuiz, quizMaxPoints, QUESTION_TYPE_LABEL } from '../lib/quiz'
import Markdown from './Markdown'
import { AI_MARK_KEY, aiGradedIds, gradeSubmission } from '../lib/aiGrade'

interface Props {
  submissionId: string
  projectId: string
  answers: FileMap
  evaluation: Evaluation | null
  graderId: string | null
  onSaved: (e: Evaluation | null) => void
}

// Admin view of one quiz submission: every question with the student's
// answer next to the key, per-question points (choice questions pre-filled
// by the auto-grader, paragraph questions graded here).
export default function QuizReview({ submissionId, projectId, answers, evaluation, graderId, onSaved }: Props) {
  const [quiz, setQuiz] = useState<Quiz | null>(null)
  const [key, setKey] = useState<QuizKey>({})
  const [scores, setScores] = useState<Record<string, string>>({})
  const [feedback, setFeedback] = useState('')
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiIds, setAiIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    (async () => {
      const [{ data: p }, { data: k }] = await Promise.all([
        supabase.from('projects').select('quiz').eq('id', projectId).maybeSingle(),
        supabase.from('quiz_answer_keys').select('answers').eq('project_id', projectId).maybeSingle(),
      ])
      const qz = normalizeQuiz((p as { quiz?: Quiz } | null)?.quiz)
      const ak = ((k as { answers?: QuizKey } | null)?.answers) || {}
      setQuiz(qz)
      setKey(ak)
      const s: Record<string, string> = {}
      for (const q of qz.questions) {
        const saved = evaluation?.scores?.[q.id]
        if (saved != null) s[q.id] = String(saved)
        else {
          const auto = autoScore(q, ak, answers)
          s[q.id] = auto == null ? '' : String(auto)
        }
      }
      setScores(s)
      setFeedback(evaluation?.feedback || '')
      const fbc = { ...(evaluation?.feedback_by_criterion || {}) }
      setAiIds(aiGradedIds(fbc))
      delete fbc[AI_MARK_KEY]
      setNotes(fbc)
    })()
  }, [projectId, submissionId, evaluation?.id, evaluation?.updated_at])

  const paragraphAnswered = quiz?.questions.some(q => q.type === 'paragraph' && (answers[q.id] || '').trim()) ?? false

  // Gemini scores the paragraph answers that have no score yet (or, when
  // asked, re-scores the ones it scored before). Faculty grades are kept.
  async function runAi() {
    const ungradedParas = quiz?.questions.filter(q => q.type === 'paragraph' && (answers[q.id] || '').trim() && evaluation?.scores?.[q.id] == null).length ?? 0
    const force = ungradedParas === 0
    if (force && !confirm('Every paragraph answer already has a score. Re-run AI grading on the answers the AI scored before? Scores you entered yourself stay as they are.')) return
    setAiBusy(true); setErr(null)
    try {
      await gradeSubmission({ submissionId, force })
      const { data } = await supabase.from('evaluations').select('*').eq('submission_id', submissionId).maybeSingle()
      onSaved((data as Evaluation | null) ?? null)
    } catch (e) {
      const er = e as Error & { status?: number }
      setErr(er.status === 429 ? 'Gemini rate limit hit. Try again in a minute.' : er.message)
    } finally {
      setAiBusy(false)
    }
  }

  const max = useMemo(() => (quiz ? quizMaxPoints(quiz) : 0), [quiz])
  const total = useMemo(
    () => Object.values(scores).reduce((n, v) => n + (Number.isFinite(Number(v)) ? Number(v) : 0), 0),
    [scores],
  )
  const ungraded = quiz?.questions.filter(q => scores[q.id] === '' || scores[q.id] === '-' || scores[q.id] == null).length ?? 0

  function setScore(id: string, raw: string, maxPts: number, minPts = 0) {
    if (raw === '' || raw === '-') { setScores(s => ({ ...s, [id]: raw === '-' ? '-' : '' })); return }
    const n = Number(raw)
    if (!Number.isFinite(n)) return
    setScores(s => ({ ...s, [id]: String(Math.max(minPts, Math.min(maxPts, n))) }))
  }

  async function save() {
    if (!quiz) return
    if (ungraded > 0 && !confirm(`${ungraded} question(s) have no score yet and will count as 0. Save anyway?`)) return
    setSaving(true); setErr(null)
    const payload = {
      submission_id: submissionId,
      scores: Object.fromEntries(quiz.questions.map(q => [q.id, Number(scores[q.id]) || 0])),
      total,
      max_total: max,
      feedback,
      // Saving by hand means a faculty member has reviewed every score, so
      // the AI markers are dropped.
      feedback_by_criterion: Object.fromEntries(Object.entries(notes).filter(([k, v]) => k !== AI_MARK_KEY && v.trim())),
      pending_manual: 0,
      graded_by: graderId,
      graded_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    const { data, error } = await supabase
      .from('evaluations')
      .upsert(payload, { onConflict: 'submission_id' })
      .select()
      .single()
    setSaving(false)
    if (error) { setErr(error.message); return }
    onSaved(data as Evaluation)
    setAiIds(new Set())
    setSavedAt(new Date().toLocaleTimeString())
  }

  if (!quiz) return <div className="text-vs-mute text-sm">Loading quiz…</div>

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center gap-3 sticky top-0 z-10">
        <h3 className="font-semibold">Quiz answers</h3>
        <span className="text-sm text-vs-mute">
          Total: <span className="text-vs-text font-mono">{total}</span> / {max}
        </span>
        {evaluation && !evaluation.graded_by && (
          <span className="text-xs text-sky-300" title="Choice questions were scored automatically when the student submitted.">Auto-graded</span>
        )}
        {ungraded > 0 && <span className="text-xs text-amber-300">{ungraded} to grade</span>}
        <div className="ml-auto flex items-center gap-3">
          {savedAt && <span className="text-xs text-emerald-300">Saved at {savedAt}</span>}
          {err && <span className="text-xs text-red-400">{err}</span>}
          {paragraphAnswered && (
            <button
              className="btn-ghost"
              onClick={runAi}
              disabled={aiBusy || saving}
              title="Score the paragraph answers with Gemini against the model answer. You can change any score before saving."
            >{aiBusy ? 'AI grading…' : '✨ AI grade paragraphs'}</button>
          )}
          <button className="btn" onClick={save} disabled={saving || aiBusy}>
            {saving ? 'Saving…' : evaluation?.graded_by ? 'Update grade' : 'Save grade'}
          </button>
        </div>
      </div>

      {quiz.questions.map((q, i) => {
        const chosen = decodeChoice(answers[q.id])
        const correct = key[q.id]?.correct || []
        const auto = autoScore(q, key, answers)
        const text = answers[q.id] || ''
        return (
          <div key={q.id} className="card space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-vs-mute">
              <span className="font-semibold text-vs-text text-sm">Q{i + 1}.</span>
              <span>{QUESTION_TYPE_LABEL[q.type]}</span>
              {q.type === 'paragraph' && aiIds.has(q.id) && (
                <span
                  className="rounded border border-sky-700 bg-sky-900/30 px-1.5 py-px text-[10px] text-sky-200"
                  title="Scored by Gemini. Check it, change it if needed, then save."
                >AI</span>
              )}
              {q.type !== 'paragraph' && (
                auto === (Number(q.points) || 0) && auto > 0
                  ? <span className="text-emerald-300">✓ correct</span>
                  : chosen.length === 0
                  ? <span className="text-vs-mute">not answered</span>
                  : <span className="text-red-400">✗ wrong{negativeMarks(q) > 0 ? ` (−${negativeMarks(q)})` : ''}</span>
              )}
              {negativeMarks(q) > 0 && chosen.length === 0 && (
                <span className="text-vs-mute" title="Negative marking applies to wrong answers only">· −{negativeMarks(q)} if wrong</span>
              )}
              <label className="ml-auto flex items-center gap-1">
                Score
                <input
                  type="number"
                  min={-negativeMarks(q)}
                  max={q.points}
                  step={0.25}
                  className={`input !w-20 text-xs ${scores[q.id] === '' ? '!border-amber-600' : ''} ${Number(scores[q.id]) < 0 ? '!text-red-300' : ''}`}
                  value={scores[q.id] ?? ''}
                  onChange={e => setScore(q.id, e.target.value, Number(q.points) || 0, -negativeMarks(q))}
                  placeholder="—"
                />
                <span>/ {q.points}</span>
              </label>
            </div>
            <Markdown source={q.prompt} />

            {q.type === 'paragraph' ? (
              <div className="grid md:grid-cols-2 gap-3">
                <div>
                  <div className="label">Student answer</div>
                  <div className="bg-vs-bg border border-vs-border rounded p-3 text-sm whitespace-pre-wrap break-words min-h-[4rem]">
                    {text.trim() ? text : <span className="text-vs-mute italic">No answer</span>}
                  </div>
                </div>
                <div>
                  <div className="label">Model answer / notes</div>
                  <div className="bg-vs-bg border border-vs-border rounded p-3 text-sm whitespace-pre-wrap break-words min-h-[4rem] text-vs-mute">
                    {key[q.id]?.model_answer?.trim() || '—'}
                  </div>
                </div>
              </div>
            ) : (
              <ul className="space-y-1.5">
                {q.options.map((o, oi) => {
                  const picked = chosen.includes(o.id)
                  const isCorrect = correct.includes(o.id)
                  return (
                    <li
                      key={o.id}
                      className={`flex items-start gap-2 rounded border px-3 py-1.5 text-sm ${
                        isCorrect ? 'border-emerald-700 bg-emerald-900/20'
                        : picked ? 'border-red-700 bg-red-900/20'
                        : 'border-vs-border'}`}
                    >
                      <span className="w-4 text-vs-mute">{String.fromCharCode(65 + oi)}.</span>
                      <span className="flex-1 whitespace-pre-wrap break-words">{o.text}</span>
                      {picked && <span className="text-xs text-vs-text">← student</span>}
                      {isCorrect && <span className="text-xs text-emerald-300">correct</span>}
                    </li>
                  )
                })}
              </ul>
            )}

            <input
              className="input text-xs"
              value={notes[q.id] ?? ''}
              onChange={e => setNotes(n => ({ ...n, [q.id]: e.target.value }))}
              placeholder="Comment for this question (optional)"
            />
          </div>
        )
      })}

      <div className="card space-y-2">
        <label className="label">Overall summary (optional)</label>
        <textarea
          className="input"
          rows={2}
          value={feedback}
          onChange={e => setFeedback(e.target.value)}
          placeholder="One-sentence takeaway for the student."
        />
      </div>
    </div>
  )
}
