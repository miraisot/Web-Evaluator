import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { gradeSubmission, sleep } from '../../lib/aiGrade'
import { fetchAll } from '../../lib/fetchAll'
import type { Submission, Assignment, Project, Profile, Evaluation, Course, Category, Campus } from '../../lib/types'
import { COURSES, courseFor, CATEGORIES, categoryFor, CAMPUSES, rubricFor } from '../../lib/types'
import { assessRisk, RISK_BADGE, summaryKey, type IntegritySummary, type Risk, type RiskLevel } from '../../lib/integrity'

const GRADE_INTERVAL_MS = 5000  // 12 RPM — under Gemini free tier 15 RPM

// The list never needs the student's code (`files`, most of the payload);
// SubmissionView loads it when one submission is opened.
type Row = Omit<Submission, 'files'> & {
  assignment: Assignment & { project: Pick<Project, 'title' | 'project_type' | 'category'> }
  student: Profile | null
  evaluation: Pick<Evaluation, 'total' | 'max_total' | 'graded_at' | 'scores' | 'feedback' | 'feedback_by_criterion' | 'pending_manual'> | null
}

const UNASSIGNED_CAMPUS = '(no campus)'
type CampusKey = Campus | typeof UNASSIGNED_CAMPUS

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function downloadCsv(filename: string, header: string[], rows: string[][]) {
  const csv = [header, ...rows].map(r => r.map(csvCell).join(',')).join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function exportCourse(course: Course, rows: Row[], riskOf: (r: Row) => Risk) {
  const sample = rows.find(r => r.assignment.project.project_type != null)
  const rubric = rubricFor(sample?.assignment.project.project_type)
  const header = [
    'Student Name', 'UID', 'Email', 'Campus', 'Section', 'Semester',
    'Project', 'Submitted At', 'Auto-collected',
    ...rubric.flatMap(c => [`${c.label} (/${c.max})`, `${c.label} feedback`]),
    'Total', 'Max', 'Graded At', 'Overall Summary',
    'Integrity', 'Integrity notes',
  ]
  const data = rows.map(r => {
    const ev = r.evaluation
    const scores = ev?.scores || {}
    const fbc = ev?.feedback_by_criterion || {}
    return [
      r.student?.full_name || '',
      r.student?.uid || '',
      r.student?.email || r.assignment.assignee_email || '',
      r.student?.campus || '',
      r.student?.section || '',
      r.student?.semester || '',
      r.assignment.project.title,
      new Date(r.submitted_at).toISOString(),
      r.auto_collected ? 'yes' : '',
      ...rubric.flatMap(c => [
        scores[c.key] != null ? String(scores[c.key]) : '',
        fbc[c.key] || '',
      ]),
      ev?.total != null ? String(ev.total) : '',
      ev?.max_total != null ? String(ev.max_total) : '',
      ev?.graded_at ? new Date(ev.graded_at).toISOString() : '',
      ev?.feedback || '',
      RISK_BADGE[riskOf(r).level].label,
      riskOf(r).level === 'clean' || riskOf(r).level === 'untracked' ? '' : riskOf(r).reasons.join(' '),
    ]
  })
  const stamp = new Date().toISOString().slice(0, 10)
  downloadCsv(`${course.replace(' ', '-')}-submissions-${stamp}.csv`, header, data)
}

type GradeFilter = 'all' | 'graded' | 'ungraded'
type CourseFilter = 'all' | Course
type CategoryFilter = 'all' | Category
type CampusFilter = 'all' | CampusKey

const CAMPUS_KEYS: CampusKey[] = [...CAMPUSES, UNASSIGNED_CAMPUS]
const STUDENT_CAMPUSES: Campus[] = ['Hi-Tech', 'RGIB', 'JU']
function campusKeyFor(row: Row): CampusKey {
  const c = row.student?.campus
  if (!c) return UNASSIGNED_CAMPUS
  return (STUDENT_CAMPUSES as string[]).includes(c) ? (c as Campus) : UNASSIGNED_CAMPUS
}

// A quiz with paragraph answers still to read counts as ungraded.
function isGraded(r: Row): boolean {
  return !!r.evaluation && !r.evaluation.pending_manual
}

export default function Submissions() {
  const { profile } = useAuth()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [gradeFilter, setGradeFilter] = useState<GradeFilter>('all')
  const [courseFilter, setCourseFilter] = useState<CourseFilter>('all')
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all')
  const [campusFilter, setCampusFilter] = useState<CampusFilter>('all')
  const [grading, setGrading] = useState(false)
  const [gradeProgress, setGradeProgress] = useState<{ done: number; total: number; failed: number; current: string | null }>({ done: 0, total: 0, failed: 0, current: null })
  const [gradeError, setGradeError] = useState<string | null>(null)
  const [cancelGrading, setCancelGrading] = useState(false)
  // Exam integrity: per student + assignment counters (exam_integrity_summary).
  const [summaries, setSummaries] = useState<Map<string, IntegritySummary>>(new Map())
  const [riskFilter, setRiskFilter] = useState<'all' | RiskLevel>('all')
  useEffect(() => {
    fetchAll((from, to) => supabase.from('exam_integrity_summary').select('*')
      .order('assignment_id', { ascending: true }).order('student_id', { ascending: true }).range(from, to))
      .then(data => setSummaries(new Map((data as IntegritySummary[] || []).map(s => [summaryKey(s.assignment_id, s.student_id), s]))))
      .catch(e => console.warn('[submissions] integrity summary unavailable:', e))
  }, [])

  useEffect(() => {
    // Paged: there are more than 1000 submissions, the API's per-request cap.
    fetchAll(
      (from, to) => supabase
        .from('submissions')
        // profiles(*) rather than a column list, so a missing optional column
        // (e.g. uid before its migration runs) can't break the list.
        .select('id, assignment_id, student_id, submitted_at, auto_collected, assignment:assignments(*, project:projects(title, project_type, category)), student:profiles(*), evaluation:evaluations(*)')
        .order('submitted_at', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to),
    )
      .catch(e => { console.error('[submissions] load failed:', e); return [] })
      .then(data => {
        const normalized = ((data as unknown as (Omit<Row, 'evaluation'> & { evaluation: Row['evaluation'] | Row['evaluation'][] })[]) || []).map(r => ({
          ...r,
          // Supabase returns 1:1 relations as an array; flatten to the single row.
          evaluation: Array.isArray(r.evaluation) ? (r.evaluation[0] ?? null) : (r.evaluation ?? null),
        })) as Row[]
        setRows(normalized)
        setLoading(false)
      })
  }, [])

  // Risk per submission, computed once per data load.
  const riskById = useMemo(() => {
    const m = new Map<string, Risk>()
    for (const r of rows) m.set(r.id, assessRisk(summaries.get(summaryKey(r.assignment_id, r.student_id))))
    return m
  }, [rows, summaries])
  const riskOf = (r: Row): Risk => riskById.get(r.id) ?? assessRisk(null)
  const riskCounts = useMemo(() => {
    const c: Record<RiskLevel, number> = { flagged: 0, review: 0, clean: 0, untracked: 0 }
    for (const v of riskById.values()) c[v.level]++
    return c
  }, [riskById])

  const counts = useMemo(() => ({
    all: rows.length,
    graded: rows.filter(isGraded).length,
    ungraded: rows.filter(r => !isGraded(r)).length,
  }), [rows])

  const courseCounts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length }
    for (const course of COURSES) c[course] = 0
    for (const r of rows) c[courseFor(r.assignment.project.project_type)] = (c[courseFor(r.assignment.project.project_type)] || 0) + 1
    return c
  }, [rows])

  const categoryCounts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length }
    for (const g of CATEGORIES) c[g] = 0
    for (const r of rows) {
      const k = categoryFor(r.assignment.project)
      c[k] = (c[k] || 0) + 1
    }
    return c
  }, [rows])

  const campusCounts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length }
    for (const k of CAMPUS_KEYS) c[k] = 0
    for (const r of rows) {
      const k = campusKeyFor(r)
      c[k] = (c[k] || 0) + 1
    }
    return c
  }, [rows])

  const filtered = rows.filter(r => {
    if (gradeFilter === 'graded' && !isGraded(r)) return false
    if (gradeFilter === 'ungraded' && isGraded(r)) return false
    if (courseFilter !== 'all' && courseFor(r.assignment.project.project_type) !== courseFilter) return false
    if (categoryFilter !== 'all' && categoryFor(r.assignment.project) !== categoryFilter) return false
    if (campusFilter !== 'all' && campusKeyFor(r) !== campusFilter) return false
    if (riskFilter !== 'all' && riskOf(r).level !== riskFilter) return false
    if (!q) return true
    const hay = [
      r.student?.email, r.student?.full_name, r.student?.uid, r.student?.campus,
      r.student?.semester, r.student?.section, r.assignment.project.title,
    ].filter(Boolean).join(' ').toLowerCase()
    return hay.includes(q.toLowerCase())
  })

  // Coding: no evaluation yet. Quizzes: choice questions are scored by the
  // database on submit, so only quizzes with paragraph answers still to score.
  const ungradedInView = filtered.filter(r => r.assignment.project.project_type === 'quiz'
    ? !r.evaluation || (r.evaluation.pending_manual ?? 0) > 0
    : !r.evaluation)

  async function runGradeAll() {
    if (grading) return
    setGradeError(null)
    const targets = ungradedInView
    if (targets.length === 0) { setGradeError('No ungraded submissions in current view.'); return }

    const label = targets.length === 1
      ? '1 submission'
      : `${targets.length} submissions (~${Math.ceil(targets.length * GRADE_INTERVAL_MS / 60000)} min)`
    if (!confirm(`Auto-grade ${label} using Gemini? This runs ~1 per 5s to stay under the free-tier rate limit.`)) return

    setCancelGrading(false)
    setGrading(true)
    setGradeProgress({ done: 0, total: targets.length, failed: 0, current: null })

    let done = 0
    let failed = 0
    for (let i = 0; i < targets.length; i++) {
      if (cancelGrading) break
      const r = targets[i]
      setGradeProgress({ done, total: targets.length, failed, current: `${r.assignment.project.title} — ${r.student?.full_name || r.student?.email || r.assignment.assignee_email || ''}` })

      let attempt = 0
      while (true) {
        try {
          const result = await gradeSubmission({
            submissionId: r.id,
            gradedBy: profile?.id ?? null,
          })
          setRows(prev => prev.map(x => x.id === r.id
            ? { ...x, evaluation: { total: result.total, max_total: result.max_total, graded_at: new Date().toISOString(), scores: result.scores, feedback: x.evaluation?.feedback ?? '', feedback_by_criterion: result.feedback_by_criterion, pending_manual: result.pending_manual ?? 0 } }
            : x))
          done += 1
          break
        } catch (e) {
          const err = e as Error & { status?: number; retryAfterMs?: number }
          if (err.status === 429 && attempt < 4) {
            const wait = err.retryAfterMs ?? (2000 * Math.pow(2, attempt))
            await sleep(wait)
            attempt += 1
            continue
          }
          failed += 1
          console.error('[grade-all]', r.id, err)
          break
        }
      }
      setGradeProgress({ done, total: targets.length, failed, current: null })
      if (i < targets.length - 1) await sleep(GRADE_INTERVAL_MS)
    }

    setGrading(false)
    setGradeProgress(p => ({ ...p, current: null }))
    if (failed > 0) setGradeError(`Finished with ${failed} failure(s). Check the console for details.`)
  }

  // Nested grouping: Campus -> Category -> Course -> rows
  const grouped = useMemo(() => {
    const byCampus = new Map<CampusKey, Map<Category, Map<Course, Row[]>>>()
    for (const r of filtered) {
      const campus = campusKeyFor(r)
      const cat = categoryFor(r.assignment.project)
      const course = courseFor(r.assignment.project.project_type)
      let byCat = byCampus.get(campus)
      if (!byCat) { byCat = new Map(); byCampus.set(campus, byCat) }
      let byCourse = byCat.get(cat)
      if (!byCourse) { byCourse = new Map(); byCat.set(cat, byCourse) }
      const list = byCourse.get(course) || []
      list.push(r)
      byCourse.set(course, list)
    }
    // Order: campuses in declared order (unassigned last), then categories, then courses.
    return CAMPUS_KEYS
      .filter(k => byCampus.has(k))
      .map(campus => {
        const byCat = byCampus.get(campus)!
        const cats = CATEGORIES
          .filter(c => byCat.has(c))
          .map(cat => {
            const byCourse = byCat.get(cat)!
            const courses = COURSES
              .filter(c => byCourse.has(c))
              .map(course => [course, byCourse.get(course)!] as const)
            return [cat, courses] as const
          })
        return [campus, cats] as const
      })
  }, [filtered])

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="font-semibold">Submissions</h2>
        <div className="flex items-center gap-1 text-xs">
          {(['all', 'ungraded', 'graded'] as GradeFilter[]).map(f => (
            <button
              key={f}
              onClick={() => setGradeFilter(f)}
              className={`px-2 py-1 rounded border ${gradeFilter === f ? 'bg-vs-accent text-white border-vs-accent' : 'border-vs-border text-vs-mute hover:text-vs-text'}`}
            >
              {f[0].toUpperCase() + f.slice(1)} <span className="opacity-70">({counts[f]})</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 text-xs">
          {(['all', ...CAMPUS_KEYS] as CampusFilter[]).map(c => (
            <button
              key={c}
              onClick={() => setCampusFilter(c)}
              className={`px-2 py-1 rounded border ${campusFilter === c ? 'bg-vs-accent text-white border-vs-accent' : 'border-vs-border text-vs-mute hover:text-vs-text'}`}
            >
              {c === 'all' ? 'All campuses' : c} <span className="opacity-70">({campusCounts[c] ?? 0})</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 text-xs" title="Exam integrity signals from activity tracking">
          {(['all', 'flagged', 'review', 'clean', 'untracked'] as const).map(k => (
            <button
              key={k}
              onClick={() => setRiskFilter(k)}
              className={`px-2 py-1 rounded border ${riskFilter === k ? 'bg-vs-accent text-white border-vs-accent' : 'border-vs-border text-vs-mute hover:text-vs-text'}`}
            >
              {k === 'all' ? 'Any integrity' : RISK_BADGE[k].label}
              {k !== 'all' && <span className="opacity-70"> ({riskCounts[k]})</span>}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 text-xs">
          {(['all', ...CATEGORIES] as CategoryFilter[]).map(e => (
            <button
              key={e}
              onClick={() => setCategoryFilter(e)}
              className={`px-2 py-1 rounded border ${categoryFilter === e ? 'bg-vs-accent text-white border-vs-accent' : 'border-vs-border text-vs-mute hover:text-vs-text'}`}
            >
              {e === 'all' ? 'All categories' : e} <span className="opacity-70">({categoryCounts[e] ?? 0})</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 text-xs">
          {(['all', ...COURSES] as CourseFilter[]).map(c => (
            <button
              key={c}
              onClick={() => setCourseFilter(c)}
              className={`px-2 py-1 rounded border ${courseFilter === c ? 'bg-vs-accent text-white border-vs-accent' : 'border-vs-border text-vs-mute hover:text-vs-text'}`}
            >
              {c === 'all' ? 'All courses' : c} <span className="opacity-70">({courseCounts[c] ?? 0})</span>
            </button>
          ))}
        </div>
        <input
          className="input max-w-sm ml-auto"
          placeholder="Search name, UID, email, campus, section, project…"
          value={q}
          onChange={e => setQ(e.target.value)}
        />
        {grading ? (
          <button
            onClick={() => setCancelGrading(true)}
            className="px-2 py-1 rounded border border-amber-500/50 text-amber-300 text-xs hover:bg-amber-500/10"
            title="Finish the current submission, then stop"
          >
            Stop grading
          </button>
        ) : (
          <button
            onClick={runGradeAll}
            disabled={ungradedInView.length === 0}
            className="px-2 py-1 rounded border border-vs-accent text-vs-accent text-xs hover:bg-vs-accent hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
            title={ungradedInView.length === 0 ? 'Nothing ungraded in current view' : `Auto-grade ${ungradedInView.length} ungraded submission(s) with Gemini`}
          >
            Grade all ({ungradedInView.length})
          </button>
        )}
      </div>
      {(grading || gradeProgress.done > 0 || gradeError) && (
        <div className="text-xs flex items-center gap-3 flex-wrap">
          {grading && (
            <span className="text-vs-mute">
              Grading {gradeProgress.done + gradeProgress.failed}/{gradeProgress.total}
              {gradeProgress.failed > 0 && <span className="text-red-400"> · {gradeProgress.failed} failed</span>}
              {gradeProgress.current && <span className="ml-2 opacity-70">{gradeProgress.current}</span>}
            </span>
          )}
          {!grading && gradeProgress.done > 0 && (
            <span className="text-emerald-300">
              Graded {gradeProgress.done}/{gradeProgress.total}
              {gradeProgress.failed > 0 && <span className="text-red-400"> · {gradeProgress.failed} failed</span>}
            </span>
          )}
          {gradeError && <span className="text-red-400">{gradeError}</span>}
        </div>
      )}
      {loading ? <div className="text-vs-mute">Loading…</div> :
        filtered.length === 0 ? <div className="text-vs-mute">No submissions{q ? ' match.' : ' yet.'}</div> :
        <div className="space-y-10">
          {grouped.map(([campus, cats]) => {
            const campusTotal = cats.reduce((n, [, courses]) => n + courses.reduce((m, [, items]) => m + items.length, 0), 0)
            return (
            <div key={campus} className="space-y-6">
              <div className="flex items-center gap-2 text-base font-semibold text-vs-text border-b-2 border-vs-border pb-1">
                <span>{campus}</span>
                <span className="opacity-60">·</span>
                <span className="text-vs-mute font-normal text-sm">{campusTotal}</span>
              </div>
              {cats.map(([category, courses]) => (
                <div key={category} className="space-y-4 pl-2">
                  <div className="flex items-center gap-2 text-sm font-semibold text-vs-text border-b border-vs-border pb-1">
                    <span>{category}</span>
                    <span className="opacity-60">·</span>
                    <span className="text-vs-mute font-normal">{courses.reduce((n, [, items]) => n + items.length, 0)}</span>
                  </div>
                  {courses.map(([course, items]) => (
                    <div key={course} className="space-y-2 pl-2">
                      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-vs-mute">
                        <span>{course}</span>
                        <span className="opacity-60">·</span>
                        <span>{items.length}</span>
                        <button
                          onClick={() => exportCourse(course, items, riskOf)}
                          className="ml-auto px-2 py-0.5 rounded border border-vs-border normal-case tracking-normal text-vs-mute hover:text-vs-text"
                          title={`Download ${course} rows as CSV`}
                        >
                          Export CSV
                        </button>
                      </div>
                      {items.map(r => (
                <div key={r.id} className="card flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="text-sm font-medium">{r.assignment.project.title}</div>
                <div className="text-sm text-vs-text">
                  {r.student?.full_name || <span className="text-vs-mute">(no name)</span>}
                </div>
                <div className="text-xs text-vs-mute font-mono">{r.student?.email || r.assignment.assignee_email}</div>
                <div className="text-xs text-vs-mute flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                  {r.student?.uid && <span className="font-mono">UID: {r.student.uid}</span>}
                  {r.student?.campus && <span>Campus: {r.student.campus}</span>}
                  {r.student?.section && <span>Section: {r.student.section}</span>}
                  {r.student?.semester && <span>Sem: {r.student.semester}</span>}
                  {r.auto_collected ? (
                    <span className="text-amber-300" title="The student didn't submit; this is their last autosave, collected after the deadline.">
                      Auto-collected · last saved {new Date(r.submitted_at).toLocaleString()}
                    </span>
                  ) : (
                    <span>Submitted {new Date(r.submitted_at).toLocaleString()}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {(() => {
                  const risk = riskOf(r)
                  return (
                    <span className={`text-xs px-2 py-1 rounded border ${RISK_BADGE[risk.level].cls}`} title={risk.reasons.join('\n')}>
                      {RISK_BADGE[risk.level].label}
                    </span>
                  )
                })()}
                {r.evaluation?.pending_manual ? (
                  <span
                    className="text-xs px-2 py-1 rounded bg-amber-500/10 text-amber-300 border border-amber-500/30 font-mono"
                    title="Choice questions were auto-graded; paragraph answers still need a grade."
                  >
                    {r.evaluation.total}/{r.evaluation.max_total} · {r.evaluation.pending_manual} to review
                  </span>
                ) : r.evaluation ? (
                  <span className="text-xs px-2 py-1 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 font-mono">
                    {r.evaluation.total}/{r.evaluation.max_total}
                  </span>
                ) : (
                  <span className="text-xs px-2 py-1 rounded border border-vs-border text-vs-mute">Not graded</span>
                )}
                <Link className="btn-ghost" to={`/admin/submissions/${r.id}`}>
                  {r.evaluation ? 'Review' : 'Grade'}
                </Link>
              </div>
            </div>
                      ))}
                    </div>
                  ))}
                </div>
              ))}
            </div>
            )
          })}
        </div>
      }
    </div>
  )
}
