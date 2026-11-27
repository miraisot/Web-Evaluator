import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import CodeEditor from './CodeEditor'
import type { FileMap } from '../lib/types'

// Replays how a student's answer grew, from submission_draft_versions (one
// snapshot of the changed files at most every 20 s, plus the submitted
// version). Bars show total code size per snapshot so sudden jumps stand out;
// pastes / large inserts / time away between two snapshots are listed.

interface VersionRow {
  id: number
  saved_at: string
  changed: FileMap
  removed: string[]
  is_final: boolean
}

interface EventLite { kind: string; created_at: string; detail: Record<string, unknown> }

const SIGNAL_KINDS = new Set(['paste', 'large_insert', 'focus_lost', 'copy'])
const size = (f: FileMap) => Object.values(f).reduce((n, v) => n + (typeof v === 'string' ? v.length : 0), 0)

export default function CodeReplay({ assignmentId, studentId, events }: {
  assignmentId: string
  studentId: string
  events: EventLite[]
}) {
  const [versions, setVersions] = useState<VersionRow[] | null>(null)
  const [idx, setIdx] = useState(0)
  const [file, setFile] = useState<string>('')

  useEffect(() => {
    supabase.from('submission_draft_versions')
      .select('id, saved_at, changed, removed, is_final')
      .eq('assignment_id', assignmentId).eq('student_id', studentId)
      .order('saved_at', { ascending: true }).order('id', { ascending: true })
      .limit(2000)
      .then(({ data }) => {
        const v = (data as VersionRow[]) || []
        setVersions(v)
        setIdx(Math.max(0, v.length - 1))
      })
  }, [assignmentId, studentId])

  // Full file state after each snapshot.
  const states = useMemo(() => {
    const out: FileMap[] = []
    let cur: FileMap = {}
    for (const v of versions || []) {
      cur = { ...cur, ...v.changed }
      for (const r of v.removed) delete cur[r]
      out.push(cur)
    }
    return out
  }, [versions])

  const v = versions?.[idx]
  const state = states[idx] || {}
  const names = Object.keys(state).sort()
  useEffect(() => {
    if (!v) return
    // Show what changed in this snapshot; otherwise keep the current file.
    const changed = Object.keys(v.changed).filter(n => n in state)
    setFile(f => changed[0] || (f && f in state ? f : names[0] || ''))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, versions])

  if (versions === null) return <div className="text-xs text-vs-mute">Loading code history…</div>
  if (!versions.length) return <div className="text-xs text-vs-mute">No code history (taken before history was recorded, or a quiz).</div>

  const sizes = states.map(size)
  const maxSize = Math.max(1, ...sizes)
  const prevAt = idx > 0 ? new Date(versions[idx - 1].saved_at).getTime() : 0
  const at = new Date(v!.saved_at).getTime()
  const between = events.filter(e => {
    if (!SIGNAL_KINDS.has(e.kind) || (e.kind === 'paste' && e.detail?.internal === true)) return false
    const t = new Date(e.created_at).getTime()
    return t > prevAt && t <= at + 15_000 // events are flushed up to ~10 s late
  })
  const grew = idx > 0 ? sizes[idx] - sizes[idx - 1] : sizes[0]
  const firstAt = new Date(versions[0].saved_at).getTime()
  const mins = (t: number) => `${Math.round((t - firstAt) / 60000)} min`

  return (
    <div className="space-y-2">
      <div className="flex items-end gap-px h-16 border-b border-vs-border" title="Total code size at each snapshot">
        {sizes.map((n, i) => (
          <button
            key={versions[i].id}
            onClick={() => setIdx(i)}
            className={`flex-1 min-w-[2px] ${i === idx ? 'bg-vs-accent' : versions[i].is_final ? 'bg-emerald-500/70' : 'bg-vs-mute/40 hover:bg-vs-mute/70'}`}
            style={{ height: `${Math.max(4, (n / maxSize) * 100)}%` }}
            aria-label={`Snapshot ${i + 1}`}
          />
        ))}
      </div>
      <input type="range" min={0} max={versions.length - 1} value={idx} onChange={e => setIdx(Number(e.target.value))} className="w-full" />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span className="font-medium">Snapshot {idx + 1} / {versions.length}{v!.is_final ? ' · submitted version' : ''}</span>
        <span className="text-vs-mute">{new Date(v!.saved_at).toLocaleTimeString()} (+{mins(at)})</span>
        <span className={grew >= 300 ? 'text-red-300' : 'text-vs-mute'}>{grew >= 0 ? '+' : ''}{grew} chars since previous</span>
        <span className="text-vs-mute">Changed: {Object.keys(v!.changed).join(', ') || '—'}{v!.removed.length ? ` · removed ${v!.removed.join(', ')}` : ''}</span>
        <button className="btn-ghost" disabled={idx === 0} onClick={() => setIdx(i => i - 1)}>◀</button>
        <button className="btn-ghost" disabled={idx === versions.length - 1} onClick={() => setIdx(i => i + 1)}>▶</button>
      </div>
      {between.length > 0 && (
        <div className="text-xs text-amber-300">
          Since the previous snapshot: {between.map(e => {
            const d = e.detail || {}
            if (e.kind === 'focus_lost') return `left the window ${Math.round(Number(d.away_ms || 0) / 1000)} s`
            if (e.kind === 'copy') return `copied ${d.chars} chars from the page`
            return `${e.kind === 'paste' ? 'pasted' : 'inserted without typing'} ${d.chars} chars${d.file ? ` into ${d.file}` : ''}`
          }).join('; ')}
        </div>
      )}
      <div className="flex border border-vs-border rounded overflow-hidden" style={{ height: '45vh' }}>
        <aside className="w-48 border-r border-vs-border bg-vs-sidebar overflow-auto text-xs">
          {names.map(n => (
            <button key={n} onClick={() => setFile(n)}
              className={`block w-full text-left px-3 py-1 truncate ${n === file ? 'bg-vs-panel text-vs-text' : 'text-vs-mute hover:text-vs-text'}`}>
              {n in v!.changed ? '● ' : ''}{n}
            </button>
          ))}
        </aside>
        <section className="flex-1 min-w-0">
          {file && <CodeEditor file={`replay/${file}`} value={state[file] ?? ''} readOnly />}
        </section>
      </div>
    </div>
  )
}
