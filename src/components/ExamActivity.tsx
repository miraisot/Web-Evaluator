import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { assessRisk, RISK_BADGE, type IntegritySummary } from '../lib/integrity'
import CodeReplay from './CodeReplay'

// Exam sessions and logged attempts (exam_sessions / exam_events), for the
// admin. Scoped to one student's assignment when assignmentId+studentId are
// given (submission view); otherwise the most recent activity everywhere.

export interface ExamEventRow {
  id: number
  kind: string
  detail: Record<string, unknown>
  ip: string | null
  user_agent: string | null
  created_at: string
  assignment_id: string | null
  student: { email: string; full_name: string | null; uid: string | null } | null
  assignment: { project: { title: string } | null } | null
}

interface SessionRow {
  id: string
  status: 'active' | 'ended' | 'revoked'
  started_at: string
  last_seen_at: string
  ended_at: string | null
  end_reason: string | null
  ip: string | null
  student: { email: string; full_name: string | null } | null
  assignment: { project: { title: string } | null } | null
}

export const EVENT_LABELS: Record<string, { label: string; tone: 'bad' | 'warn' | 'ok' }> = {
  blocked_no_seb:        { label: 'Blocked: not in Safe Exam Browser', tone: 'bad' },
  blocked_wrong_config:  { label: 'Blocked: wrong / edited .seb file', tone: 'bad' },
  blocked_wrong_browser: { label: 'Blocked: SEB version not allowed', tone: 'bad' },
  blocked_second_device: { label: 'Blocked: second device', tone: 'bad' },
  blocked_bad_challenge: { label: 'Blocked: invalid or replayed check', tone: 'bad' },
  blocked_wrong_network: { label: 'Blocked: not on the exam-room network', tone: 'bad' },
  left_allowed_network:  { label: 'Left the exam-room network mid-exam', tone: 'bad' },
  session_replaced:      { label: 'Session moved to a new device', tone: 'warn' },
  ip_changed:            { label: 'Network (IP) changed mid-exam', tone: 'warn' },
  session_started:       { label: 'Exam session started', tone: 'ok' },
  paste:                 { label: 'Pasted text from outside the exam', tone: 'warn' },
  large_insert:          { label: 'Large block appeared without typing', tone: 'bad' },
  copy:                  { label: 'Copied text from the exam page', tone: 'warn' },
  focus_lost:            { label: 'Left the exam window', tone: 'warn' },
  multi_screen:          { label: 'Second screen connected', tone: 'warn' },
  print_screen:          { label: 'Pressed Print Screen', tone: 'warn' },
  activity:              { label: 'Typing activity', tone: 'ok' },
  tracker_started:       { label: 'Activity tracking started', tone: 'ok' },
}

/** Paste of text the student copied inside the exam itself: normal editing. */
const isInternalPaste = (e: Pick<ExamEventRow, 'kind' | 'detail'>) => e.kind === 'paste' && e.detail?.internal === true
const toneOf = (e: Pick<ExamEventRow, 'kind' | 'detail'>) => (isInternalPaste(e) ? 'ok' : eventLabel(e.kind).tone)
const labelOf = (e: Pick<ExamEventRow, 'kind' | 'detail'>) => (isInternalPaste(e) ? 'Pasted text copied inside the exam' : eventLabel(e.kind).label)

function EventDetail({ e }: { e: ExamEventRow }) {
  const d = e.detail || {}
  const n = (k: string) => (typeof d[k] === 'number' ? (d[k] as number) : null)
  const parts: string[] = []
  if (e.kind === 'paste' || e.kind === 'large_insert') {
    if (n('chars') != null) parts.push(`${n('chars')} chars`)
    if (n('lines') != null) parts.push(`${n('lines')} lines`)
    if (typeof d.file === 'string' && d.file) parts.push(`into ${d.file}`)
  } else if (e.kind === 'focus_lost' && n('away_ms') != null) {
    parts.push(`away ${Math.round(n('away_ms')! / 1000)} s`)
  } else if (e.kind === 'copy') {
    if (n('chars') != null) parts.push(`${n('chars')} chars`)
    if (typeof d.source === 'string') parts.push(`from ${d.source === 'problem' ? 'the problem text' : 'the page'}`)
  } else if (e.kind === 'activity' && n('keys') != null) {
    parts.push(`${n('keys')} keystrokes this minute`)
  }
  const sample = typeof d.sample === 'string' ? d.sample : ''
  return (
    <div>
      {parts.join(' · ')}
      {sample && (
        <details className="mt-1">
          <summary className="cursor-pointer text-vs-accent">Show text</summary>
          <pre className="mt-1 p-2 bg-vs-bg border border-vs-border rounded whitespace-pre-wrap break-all max-h-60 overflow-auto">{sample}</pre>
        </details>
      )}
    </div>
  )
}

const toneClass = { bad: 'text-red-400', warn: 'text-amber-300', ok: 'text-emerald-400' }

export function eventLabel(kind: string) {
  return EVENT_LABELS[kind] || { label: kind, tone: 'warn' as const }
}

const EVENT_SELECT = 'id, kind, detail, ip, user_agent, created_at, assignment_id, student:profiles(email, full_name, uid), assignment:assignments(project:projects(title))'
const SESSION_SELECT = 'id, status, started_at, last_seen_at, ended_at, end_reason, ip, student:profiles(email, full_name), assignment:assignments(project:projects(title))'

export default function ExamActivity({ assignmentId, studentId }: { assignmentId?: string; studentId?: string }) {
  const scoped = Boolean(assignmentId && studentId)
  const [events, setEvents] = useState<ExamEventRow[]>([])
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [onlyFlags, setOnlyFlags] = useState(!scoped)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [summary, setSummary] = useState<IntegritySummary | null>(null)

  async function load() {
    let ev = supabase.from('exam_events').select(EVENT_SELECT).order('created_at', { ascending: false }).limit(scoped ? 1000 : 300)
    let se = supabase.from('exam_sessions').select(SESSION_SELECT).order('started_at', { ascending: false }).limit(scoped ? 50 : 200)
    if (scoped) {
      ev = ev.eq('assignment_id', assignmentId!).eq('student_id', studentId!)
      se = se.eq('assignment_id', assignmentId!).eq('student_id', studentId!)
    } else {
      se = se.eq('status', 'active')
    }
    const sum = scoped
      ? supabase.from('exam_integrity_summary').select('*').eq('assignment_id', assignmentId!).eq('student_id', studentId!).maybeSingle()
      : Promise.resolve({ data: null })
    const [{ data: e }, { data: s }, { data: su }] = await Promise.all([ev, se, sum])
    setSummary((su as IntegritySummary | null) ?? null)
    setEvents((e as unknown as ExamEventRow[]) || [])
    setSessions((s as unknown as SessionRow[]) || [])
    setLoading(false)
  }
  useEffect(() => {
    void load()
    if (scoped) return
    const t = setInterval(load, 15_000) // live during an exam
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentId, studentId])

  async function release(s: SessionRow) {
    if (!confirm(`End ${s.student?.email ?? 'this student'}'s exam session? They can then open the exam again (for example on another laptop). Their saved work is kept.`)) return
    const { error } = await supabase.from('exam_sessions')
      .update({ status: 'revoked', ended_at: new Date().toISOString(), end_reason: 'released_by_admin' })
      .eq('id', s.id)
    if (error) return alert(error.message)
    void load()
  }

  const q = query.trim().toLowerCase()
  const shownEvents = events.filter(e =>
    (!onlyFlags || toneOf(e) !== 'ok') &&
    (!q || (e.student?.email || '').toLowerCase().includes(q) || (e.student?.uid || '').toLowerCase().includes(q)))
  const risk = assessRisk(summary)

  if (loading) return <div className="text-sm text-vs-mute">Loading exam activity…</div>

  return (
    <div className="space-y-4">
      {scoped && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className={`text-xs px-2 py-1 rounded border ${RISK_BADGE[risk.level].cls}`}>{RISK_BADGE[risk.level].label}</span>
            <span className="text-xs text-vs-mute">Signals for review, not proof. Check the log and the code replay before deciding.</span>
          </div>
          <ul className="text-sm list-disc pl-5 space-y-0.5">
            {risk.reasons.map(r => <li key={r}>{r}</li>)}
          </ul>
          {summary?.tracked && (
            <div className="text-xs text-vs-mute flex flex-wrap gap-x-4">
              <span>Keystrokes: {summary.keystrokes}</span>
              <span>Active minutes: {summary.active_minutes}</span>
              <span>Outside pastes: {summary.pastes} ({summary.pasted_chars} chars)</span>
              <span>Time away: {summary.away_seconds} s ({summary.focus_losses}×)</span>
            </div>
          )}
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold mb-2">{scoped ? 'Exam sessions' : `Active exam sessions (${sessions.length})`}</h3>
        {sessions.length === 0
          ? <div className="text-xs text-vs-mute">None.</div>
          : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-vs-mute text-left">
                  <tr><th className="py-1 pr-3">Student</th>{!scoped && <th className="pr-3">Exam</th>}<th className="pr-3">Status</th><th className="pr-3">Started</th><th className="pr-3">Last seen</th><th className="pr-3">IP</th><th /></tr>
                </thead>
                <tbody>
                  {sessions.map(s => {
                    const stale = s.status === 'active' && Date.now() - new Date(s.last_seen_at).getTime() > 90_000
                    return (
                      <tr key={s.id} className="border-t border-vs-border">
                        <td className="py-1 pr-3 font-mono">{s.student?.email}</td>
                        {!scoped && <td className="pr-3">{s.assignment?.project?.title}</td>}
                        <td className={`pr-3 ${s.status === 'active' ? (stale ? 'text-amber-300' : 'text-emerald-400') : 'text-vs-mute'}`}>
                          {s.status === 'active' ? (stale ? 'active (not responding)' : 'active') : `${s.status}${s.end_reason ? ` · ${s.end_reason}` : ''}`}
                        </td>
                        <td className="pr-3">{new Date(s.started_at).toLocaleTimeString()}</td>
                        <td className="pr-3">{new Date(s.last_seen_at).toLocaleTimeString()}</td>
                        <td className="pr-3 font-mono">{s.ip}</td>
                        <td className="text-right">
                          {s.status === 'active' && <button className="btn-ghost text-xs" onClick={() => void release(s)}>Release</button>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
      </div>

      <div>
        <div className="flex flex-wrap items-center gap-3 mb-2">
          <h3 className="text-sm font-semibold">{scoped ? 'Exam log' : 'Recent exam activity'}</h3>
          <label className="text-xs text-vs-mute flex items-center gap-1">
            <input type="checkbox" checked={onlyFlags} onChange={e => setOnlyFlags(e.target.checked)} /> Only blocked attempts and warnings
          </label>
          {!scoped && (
            <input className="input max-w-[220px] ml-auto" placeholder="Search email or UID…" value={query} onChange={e => setQuery(e.target.value)} />
          )}
        </div>
        {shownEvents.length === 0
          ? <div className="text-xs text-vs-mute">Nothing logged.</div>
          : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-vs-mute text-left">
                  <tr><th className="py-1 pr-3">Time</th>{!scoped && <th className="pr-3">Student</th>}{!scoped && <th className="pr-3">Exam</th>}<th className="pr-3">What happened</th><th className="pr-3">Details</th><th className="pr-3">IP</th><th>Browser</th></tr>
                </thead>
                <tbody>
                  {shownEvents.map(e => {
                    return (
                      <tr key={e.id} className="border-t border-vs-border align-top">
                        <td className="py-1 pr-3 whitespace-nowrap">{new Date(e.created_at).toLocaleString()}</td>
                        {!scoped && <td className="pr-3 font-mono">{e.student?.email}{e.student?.uid ? ` · ${e.student.uid}` : ''}</td>}
                        {!scoped && <td className="pr-3">{e.assignment?.project?.title}</td>}
                        <td className={`pr-3 ${toneClass[toneOf(e)]}`}>{labelOf(e)}</td>
                        <td className="pr-3 max-w-[360px]"><EventDetail e={e} /></td>
                        <td className="pr-3 font-mono">{e.ip}</td>
                        <td className="text-vs-mute max-w-[260px] truncate" title={e.user_agent || ''}>{e.user_agent}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
      </div>

      {scoped && (
        <div>
          <h3 className="text-sm font-semibold mb-2">Code replay</h3>
          <CodeReplay assignmentId={assignmentId!} studentId={studentId!} events={events} />
        </div>
      )}
    </div>
  )
}
