import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import CodeEditor from '../../components/CodeEditor'
import FileTree from '../../components/FileTree'
import Preview from '../../components/Preview'
import ReactPreview from '../../components/ReactPreview'
import type { Evaluation, Profile, ProjectAsset, ProjectType, Submission } from '../../lib/types'
import { rubricFor } from '../../lib/types'

type Row = Submission & {
  assignment: {
    assignee_email: string
    project_id: string
    project: { title: string; project_type?: ProjectType }
  }
  student: Profile | null
}

export default function SubmissionView() {
  const { id } = useParams()
  const { profile } = useAuth()
  const [row, setRow] = useState<Row | null>(null)
  const [assets, setAssets] = useState<ProjectAsset[]>([])
  const [active, setActive] = useState('index.html')
  const [missing, setMissing] = useState(false)

  // Grading state
  const [evalRow, setEvalRow] = useState<Evaluation | null>(null)
  const rubric = useMemo(() => rubricFor(row?.assignment.project.project_type), [row?.assignment.project.project_type])
  const rubricMax = useMemo(() => rubric.reduce((n, r) => n + r.max, 0), [rubric])
  const [scores, setScores] = useState<Record<string, string>>({})
  const [feedback, setFeedback] = useState('')
  const [criterionFeedback, setCriterionFeedback] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    (async () => {
      if (!id) return
      const { data } = await supabase
        .from('submissions')
        .select('*, assignment:assignments(assignee_email, project_id, project:projects(title, project_type)), student:profiles(*)')
        .eq('id', id)
        .maybeSingle()
      if (!data) { setMissing(true); return }
      const r = data as unknown as Row
      setRow(r)
      const names = Object.keys(r.files || {})
      const preferred = r.assignment.project.project_type === 'react'
        ? ['src/App.jsx', 'src/App.tsx', 'App.jsx', 'App.tsx']
        : ['index.html']
      const first = preferred.find(n => names.includes(n)) ?? names[0]
      if (first) setActive(first)
      const { data: a } = await supabase.from('project_assets').select('*').eq('project_id', r.assignment.project_id)
      setAssets((a as ProjectAsset[]) || [])

      const { data: ev } = await supabase.from('evaluations').select('*').eq('submission_id', id).maybeSingle()
      const rubricForThis = rubricFor(r.assignment.project.project_type)
      if (ev) {
        const e = ev as Evaluation
        setEvalRow(e)
        setFeedback(e.feedback || '')
        setScores(Object.fromEntries(rubricForThis.map(r => [r.key, e.scores?.[r.key] != null ? String(e.scores[r.key]) : ''])))
        setCriterionFeedback(Object.fromEntries(rubricForThis.map(r => [r.key, e.feedback_by_criterion?.[r.key] || ''])))
      } else {
        setScores(Object.fromEntries(rubricForThis.map(r => [r.key, ''])))
        setCriterionFeedback(Object.fromEntries(rubricForThis.map(r => [r.key, ''])))
      }
    })()
  }, [id])

  const files = row?.files || {}
  const names = useMemo(() => Object.keys(files), [files])

  const total = useMemo(() => rubric.reduce((n, r) => {
    const v = Number(scores[r.key])
    return n + (Number.isFinite(v) ? v : 0)
  }, 0), [scores, rubric])

  function setScore(key: string, raw: string, max: number) {
    if (raw === '') { setScores(s => ({ ...s, [key]: '' })); return }
    const n = Number(raw)
    if (!Number.isFinite(n)) return
    const clamped = Math.max(0, Math.min(max, n))
    setScores(s => ({ ...s, [key]: String(clamped) }))
  }

  async function save() {
    if (!row || !profile) return
    setSaving(true); setErr(null)
    const payload = {
      submission_id: row.id,
      scores: Object.fromEntries(rubric.map(r => [r.key, Number(scores[r.key]) || 0])),
      total,
      max_total: rubricMax,
      feedback,
      feedback_by_criterion: Object.fromEntries(rubric.map(r => [r.key, criterionFeedback[r.key] || ''])),
      graded_by: profile.id,
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
    setEvalRow(data as Evaluation)
    setSavedAt(new Date().toLocaleTimeString())
  }

  async function clearGrade() {
    if (!evalRow) return
    if (!confirm('Clear this grade?')) return
    const { error } = await supabase.from('evaluations').delete().eq('id', evalRow.id)
    if (error) { setErr(error.message); return }
    setEvalRow(null)
    setFeedback('')
    setScores(Object.fromEntries(rubric.map(r => [r.key, ''])))
    setCriterionFeedback(Object.fromEntries(rubric.map(r => [r.key, ''])))
    setSavedAt(null)
  }

  if (missing) {
    return (
      <div className="space-y-2 text-sm">
        <div className="text-vs-mute">Submission not found. It may have been deleted.</div>
        <Link to="/admin/submissions" className="text-vs-accent hover:underline">← Back to submissions</Link>
      </div>
    )
  }
  if (!row) return <div className="text-vs-mute">Loading…</div>

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-sm">
        <Link to="/admin/submissions" className="text-vs-mute hover:text-vs-text">← Submissions</Link>
        <span className="font-semibold">{row.assignment.project.title}</span>
        {row.student?.full_name && <span>{row.student.full_name}</span>}
        {row.student?.uid && <span className="text-vs-mute font-mono">UID: {row.student.uid}</span>}
        <span className="text-vs-mute font-mono">{row.student?.email || row.assignment.assignee_email}</span>
        {row.auto_collected && (
          <span className="text-amber-300 text-xs" title="The student didn't submit; this is their last autosave, collected after the deadline.">
            Auto-collected
          </span>
        )}
        {evalRow && (
          <span className="text-emerald-300 text-xs" title={`Graded ${new Date(evalRow.graded_at).toLocaleString()}`}>
            Graded · {evalRow.total}/{evalRow.max_total}
          </span>
        )}
        <span className="ml-auto text-vs-mute">
          {row.auto_collected ? 'Last saved ' : ''}{new Date(row.submitted_at).toLocaleString()}
        </span>
      </div>

      <div className="flex border border-vs-border rounded overflow-hidden" style={{ height: '60vh' }}>
        <aside className="w-48 border-r border-vs-border bg-vs-sidebar overflow-auto">
          <div className="text-xs uppercase text-vs-mute p-3 pb-1">Files</div>
          <div className="px-1 pb-2">
            <FileTree files={names} active={active} onOpen={setActive} />
          </div>
        </aside>
        <section className="flex-1 min-w-0">
          <CodeEditor file={active} value={files[active] ?? ''} readOnly />
        </section>
        <section className="w-[40%] border-l border-vs-border">
          {row.assignment.project.project_type === 'react'
            ? <ReactPreview files={files} assets={assets} />
            : <Preview files={files} assets={assets} />}
        </section>
      </div>

      <div className="card space-y-3">
        <div className="flex items-center gap-3">
          <h3 className="font-semibold">Evaluation</h3>
          <span className="text-sm text-vs-mute">
            Total: <span className="text-vs-text font-mono">{total}</span> / {rubricMax}
          </span>
          {evalRow?.graded_at && (
            <span className="text-xs text-vs-mute ml-auto">
              Last graded {new Date(evalRow.updated_at || evalRow.graded_at).toLocaleString()}
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {rubric.map(r => (
            <div key={r.key} className="space-y-1.5">
              <label className="label" title={r.desc}>{r.label} (0–{r.max})</label>
              <input
                type="number"
                min={0}
                max={r.max}
                step={0.5}
                className="input"
                value={scores[r.key] ?? ''}
                onChange={e => setScore(r.key, e.target.value, r.max)}
                placeholder="—"
              />
              <textarea
                className="input text-xs"
                rows={3}
                value={criterionFeedback[r.key] ?? ''}
                onChange={e => setCriterionFeedback(s => ({ ...s, [r.key]: e.target.value }))}
                placeholder={`Why this score for ${r.label.toLowerCase()}…`}
              />
            </div>
          ))}
        </div>

        <div>
          <label className="label">Overall summary (optional)</label>
          <textarea
            className="input"
            rows={2}
            value={feedback}
            onChange={e => setFeedback(e.target.value)}
            placeholder="One-sentence takeaway for the student."
          />
        </div>

        <div className="flex items-center gap-3">
          <button className="btn" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : evalRow ? 'Update grade' : 'Save grade'}
          </button>
          {evalRow && (
            <button className="btn-ghost" onClick={clearGrade} disabled={saving}>Clear grade</button>
          )}
          {savedAt && <span className="text-xs text-emerald-300">Saved at {savedAt}</span>}
          {err && <span className="text-xs text-red-400">{err}</span>}
        </div>
      </div>
    </div>
  )
}
