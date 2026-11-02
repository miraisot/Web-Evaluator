import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { Assignment, Project } from '../lib/types'

type Row = Assignment & { project: Pick<Project, 'title' | 'description'> }

export default function Home() {
  const { profile, signOut } = useAuth()
  const [rows, setRows] = useState<Row[]>([])
  const [submittedAt, setSubmittedAt] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)

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
        <h2 className="text-lg mb-4">Your assignments</h2>
        {loading ? <div className="text-vs-mute">Loading…</div> :
          visibleRows.length === 0 ? <div className="text-vs-mute">Nothing assigned yet.</div> :
          <ul className="space-y-3">
            {visibleRows.map(r => {
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
