import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Students who left a locked exam and want back in. Approve lets them in once
// (and ends any session still open elsewhere); Deny keeps them out. Polls
// every 5 s so the invigilator sees a raised hand quickly.

interface RequestRow {
  id: string
  requested_at: string
  last_attempt_at: string
  ip: string | null
  user_agent: string | null
  other_device_active: boolean
  student: { email: string; full_name: string | null; uid: string | null } | null
  assignment: { project: { title: string } | null } | null
}

const SELECT = 'id, requested_at, last_attempt_at, ip, user_agent, other_device_active, student:profiles!exam_reentry_requests_student_id_fkey(email, full_name, uid), assignment:assignments(project:projects(title))'

const ago = (iso: string) => {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  return s < 60 ? `${s} s ago` : `${Math.floor(s / 60)} min ago`
}

export default function ReentryRequests() {
  const [rows, setRows] = useState<RequestRow[]>([])
  const [busy, setBusy] = useState<string | null>(null)

  async function load() {
    const { data } = await supabase.from('exam_reentry_requests').select(SELECT)
      .eq('status', 'pending').order('requested_at', { ascending: true }).limit(100)
    setRows((data as unknown as RequestRow[]) || [])
  }
  useEffect(() => {
    void load()
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [])

  async function decide(r: RequestRow, approve: boolean) {
    const who = r.student?.email ?? 'this student'
    if (!approve && !confirm(`Deny re-entry for ${who}? They stay out until they ask again and you approve.`)) return
    setBusy(r.id)
    const { data, error } = await supabase.rpc('decide_exam_reentry', { p_request: r.id, p_approve: approve })
    setBusy(null)
    if (error) return alert(error.message)
    const res = data as { ok: boolean; reason?: string }
    if (!res.ok) alert(res.reason === 'not_found' ? 'That request no longer exists.' : `Already decided (${res.reason?.replace('already_', '')}).`)
    void load()
  }

  return (
    <div className={rows.length ? 'rounded border border-amber-500/50 bg-amber-500/5 p-3' : ''}>
      <h3 className="text-sm font-semibold mb-2">
        Waiting to re-enter ({rows.length})
        {rows.length > 0 && <span className="ml-2 text-xs font-normal text-amber-300">Check the student in the room before approving.</span>}
      </h3>
      {rows.length === 0
        ? <div className="text-xs text-vs-mute">No one is waiting. Students who leave a locked exam appear here and can't continue until you approve.</div>
        : (
          <div className="space-y-2">
            {rows.map(r => (
              <div key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-vs-border pt-2 first:border-0 first:pt-0">
                <div className="min-w-0 flex-1">
                  <div className="text-sm">
                    <span className="font-mono">{r.student?.email}</span>
                    {r.student?.full_name && <span className="ml-2">{r.student.full_name}</span>}
                    {r.student?.uid && <span className="ml-2 text-vs-mute font-mono">UID {r.student.uid}</span>}
                  </div>
                  <div className="text-xs text-vs-mute">
                    {r.assignment?.project?.title} · asked {ago(r.requested_at)}
                    {r.ip ? ` · IP ${r.ip}` : ''}
                  </div>
                  {r.other_device_active && (
                    <div className="text-xs text-red-300">
                      Their exam is still open on another device: this may be a second device. Approving closes the other one.
                    </div>
                  )}
                </div>
                <button className="btn text-xs" disabled={busy === r.id} onClick={() => void decide(r, true)}>Approve</button>
                <button className="btn-ghost text-xs text-red-400" disabled={busy === r.id} onClick={() => void decide(r, false)}>Deny</button>
              </div>
            ))}
          </div>
        )}
    </div>
  )
}
