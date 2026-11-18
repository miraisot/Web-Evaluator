import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { Assignment, Project } from '../lib/types'

type Row = Assignment & { project: Pick<Project, 'title' | 'description'> }

type Filter = 'all' | 'new' | 'submitted'

export default function Home() {
  const { profile, signOut } = useAuth()
  const [rows, setRows] = useState<Row[]>([])
  const [submittedAt, setSubmittedAt] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('new')

  useEffect(() => {
    (async () => {
      const [{ data: a }, { data: s }] = await Promise.all([
        supabase
          .from('assignments')
          .select('*, project:projects(title, description)')
          .order('starts_at', { ascending: true }),
        supabase
          .from('submissions')
          .select('assignment_id, submitted_at'),
      ])
      setRows((a as unknown as Row[]) || [])
      const map: Record<string, string> = {}
      for (const row of (s as { assignment_id: string; submitted_at: string }[] | null) || []) {
        map[row.assignment_id] = row.submitted_at
      }
      setSubmittedAt(map)
      setLoading(false)
    })()
  }, [])

  const now = Date.now()

  // Hide assignments whose window closed, unless the student already submitted —
  // keep those visible so they can still see what they turned in.
  const visibleRows = rows.filter(r => {
    const end = new Date(r.ends_at).getTime()
    if (now <= end) return true
    return Boolean(submittedAt[r.id])
  })

  // "New" = still open and not yet submitted. Everything else that's in the
  // visible set is either submitted or upcoming; the Submitted tab is the
  // obvious counterpart, All shows both plus upcoming.
  const counts = useMemo(() => {
    let nNew = 0, nSub = 0
    for (const r of visibleRows) {
      if (submittedAt[r.id]) nSub++
      else {
        const start = new Date(r.starts_at).getTime()
        const end = new Date(r.ends_at).getTime()
        if (now >= start && now <= end) nNew++
      }
    }
    return { all: visibleRows.length, new: nNew, submitted: nSub }
  }, [visibleRows, submittedAt, now])

  const filteredRows = visibleRows.filter(r => {
    if (filter === 'all') return true
    const submitted = Boolean(submittedAt[r.id])
    if (filter === 'submitted') return submitted
    const start = new Date(r.starts_at).getTime()
    const end = new Date(r.ends_at).getTime()
    return !submitted && now >= start && now <= end
  })

  return (
    <div className="min-h-screen">
      <header className="border-b border-vs-border px-4 py-3 flex items-center justify-between">
        <div className="font-semibold">Web Eval</div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-vs-mute">{profile?.email}</span>
          {profile?.role === 'admin' && <Link className="btn-ghost" to="/admin">Admin</Link>}
          <button className="btn-ghost" onClick={signOut}>Sign out</button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto p-6">
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <h2 className="text-lg">Your assignments</h2>
          <div className="inline-flex rounded border border-vs-border overflow-hidden text-xs">
            {([
              ['all', `All (${counts.all})`],
              ['new', `New (${counts.new})`],
              ['submitted', `Submitted (${counts.submitted})`],
            ] as const).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setFilter(k)}
                className={`px-3 py-1.5 transition-colors ${filter === k ? 'bg-vs-panel text-vs-text' : 'text-vs-mute hover:text-vs-text'}`}
              >{label}</button>
            ))}
          </div>
        </div>
        {loading ? <div className="text-vs-mute">Loading…</div> :
          filteredRows.length === 0 ? (
            <div className="text-vs-mute">
              {filter === 'new' ? 'No new assignments right now.'
                : filter === 'submitted' ? 'Nothing submitted yet.'
                : 'Nothing assigned yet.'}
            </div>
          ) :
          <ul className="space-y-3">
            {filteredRows.map(r => {
              const start = new Date(r.starts_at).getTime()
              const end = new Date(r.ends_at).getTime()
              const open = now >= start && now <= end
              const upcoming = now < start
              const submitted = submittedAt[r.id]
              return (
                <li key={r.id} className="card">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="font-medium">{r.project.title}</div>
                      <div className="text-xs text-vs-mute mt-1">
                        {new Date(r.starts_at).toLocaleString()} → {new Date(r.ends_at).toLocaleString()}
                      </div>
                      {submitted && (
                        <div className="text-xs text-emerald-400 mt-1">
                          ✓ Submitted on {new Date(submitted).toLocaleString()}
                        </div>
                      )}
                    </div>
                    <div className="shrink-0">
                      {submitted
                        ? <span className="inline-block px-3 py-1.5 rounded border border-emerald-700 bg-emerald-900/30 text-emerald-300 text-sm">Submitted</span>
                        : open
                          ? <Link className="btn" to={`/solve/${r.id}`}>Open</Link>
                          : upcoming
                            ? <span className="text-xs text-vs-mute">Not yet open</span>
                            : <span className="text-xs text-red-400">Closed</span>}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        }
      </main>
    </div>
  )
}
