import { FormEvent, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { Assignment, Project, Category, Course } from '../../lib/types'
import { CATEGORIES, categoryFor, COURSES, courseFor } from '../../lib/types'

type Row = Assignment & { project: Pick<Project, 'title' | 'project_type' | 'category'> }

// local datetime <-> ISO
const toLocalInput = (iso: string) => {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// "2h 15m" / "1d 3h" / "45m"
const formatDuration = (a: Date, b: Date) => {
  let ms = b.getTime() - a.getTime()
  if (ms <= 0) return ''
  const d = Math.floor(ms / 86_400_000); ms -= d * 86_400_000
  const h = Math.floor(ms / 3_600_000);  ms -= h * 3_600_000
  const m = Math.floor(ms / 60_000)
  return [d && `${d}d`, h && `${h}h`, m && `${m}m`].filter(Boolean).join(' ') || '< 1m'
}

// Format a datetime-local input value in a clear 12-hour format like
// "Mon, Oct 20, 2026 · 12:15 PM"
const prettyLocal = (v: string) => {
  if (!v) return ''
  const d = new Date(v)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, {
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  })
}

export default function Assignments() {
  const [projects, setProjects] = useState<Project[]>([])
  const [rows, setRows] = useState<Row[]>([])
  const [projectId, setProjectId] = useState('')
  const [emails, setEmails] = useState('')
  const [isPublic, setIsPublic] = useState(false)
  const [starts, setStarts] = useState(toLocalInput(new Date().toISOString()))
  const [ends, setEnds] = useState(toLocalInput(new Date(Date.now()+2*3600_000).toISOString()))
  const [busy, setBusy] = useState(false)
  const [filterProject, setFilterProject] = useState('')
  const [query, setQuery] = useState('')
  // Bulk time change: selected assignment ids and the new window for them.
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkStarts, setBulkStarts] = useState('')
  const [bulkEnds, setBulkEnds] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)

  async function load() {
    const [{ data: p }, { data: a }] = await Promise.all([
      supabase.from('projects').select('id, title, project_type, category').order('created_at', { ascending: false }),
      supabase.from('assignments').select('*, project:projects(title, project_type, category)').order('created_at', { ascending: false }),
    ])
    setProjects((p as Project[]) || [])
    setRows((a as unknown as Row[]) || [])
  }
  useEffect(() => { load() }, [])

  async function create(e: FormEvent) {
    e.preventDefault()
    if (!projectId) return alert('Pick a project')
    const startsISO = new Date(starts).toISOString()
    const endsISO = new Date(ends).toISOString()
    if (new Date(endsISO) <= new Date(startsISO)) return alert('End must be after start')
    setBusy(true)
    // Re-saving an existing assignment only moves its times, in place. Never
    // delete and re-insert: deleting an assignment also deletes the students'
    // drafts and submissions for it.
    const times = { starts_at: startsISO, ends_at: endsISO }
    if (isPublic) {
      // At most one public row per project.
      const { data: existing, error: readErr } = await supabase.from('assignments')
        .select('id').eq('project_id', projectId).eq('is_public', true).maybeSingle()
      if (readErr) { setBusy(false); return alert(readErr.message) }
      const { error } = existing
        ? await supabase.from('assignments').update(times).eq('id', existing.id)
        : await supabase.from('assignments').insert({
            project_id: projectId, assignee_email: null, is_public: true, ...times,
          })
      setBusy(false)
      if (error) return alert(error.message)
      alert(existing ? 'Times updated for everyone.' : 'Published to everyone.')
    } else {
      const list = [...new Set(emails.split(/[\s,;\n]+/).map(s => s.trim().toLowerCase()).filter(Boolean))]
      if (!list.length) { setBusy(false); return alert('Add at least one email, or tick "Publish to everyone"') }
      const { data: existing, error: readErr } = await supabase.from('assignments')
        .select('id, assignee_email').eq('project_id', projectId).eq('is_public', false)
      if (readErr) { setBusy(false); return alert(readErr.message) }
      const idByEmail = new Map((existing || []).map(a => [String(a.assignee_email).toLowerCase(), a.id as string]))
      const updateIds = list.filter(email => idByEmail.has(email)).map(email => idByEmail.get(email)!)
      const inserts = list.filter(email => !idByEmail.has(email)).map(email => ({
        project_id: projectId, assignee_email: email, is_public: false, ...times,
      }))
      if (updateIds.length) {
        const { error } = await supabase.from('assignments').update(times).in('id', updateIds)
        if (error) { setBusy(false); return alert(error.message) }
      }
      if (inserts.length) {
        const { error } = await supabase.from('assignments').insert(inserts)
        if (error) { setBusy(false); return alert(error.message) }
      }
      setBusy(false)
      setEmails('')
      alert(`Times updated for ${updateIds.length}, newly assigned ${inserts.length}.`)
    }
    load()
  }

  async function remove(a: Row) {
    const whose = a.is_public ? "every student's" : "this student's"
    if (!confirm(`Remove this assignment? This also permanently deletes ${whose} saved draft and submission for it.`)) return
    await supabase.from('assignments').delete().eq('id', a.id)
    load()
  }

  const q = query.trim().toLowerCase()
  const shown = rows.filter(r =>
    (!filterProject || r.project_id === filterProject) &&
    (!q || r.project.title.toLowerCase().includes(q) || (r.assignee_email || '').toLowerCase().includes(q)))

  const grouped = useMemo(() => {
    const byCat = new Map<Category, Map<Course, Row[]>>()
    for (const r of shown) {
      const cat = categoryFor(r.project)
      const course = courseFor(r.project.project_type)
      let inner = byCat.get(cat)
      if (!inner) { inner = new Map(); byCat.set(cat, inner) }
      const list = inner.get(course) || []
      list.push(r)
      inner.set(course, list)
    }
    return CATEGORIES
      .filter(c => byCat.has(c))
      .map(cat => {
        const inner = byCat.get(cat)!
        const courses = COURSES.filter(c => inner.has(c)).map(course => [course, inner.get(course)!] as const)
        return [cat, courses] as const
      })
  }, [shown])

  // Distinct start→end windows, so a whole exam sitting can be picked at once.
  const windows = useMemo(() => {
    const m = new Map<string, Row[]>()
    for (const r of rows) {
      const key = `${new Date(r.starts_at).toISOString()}|${new Date(r.ends_at).toISOString()}`
      m.set(key, [...(m.get(key) || []), r])
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length)
  }, [rows])

  // Fills the new-times inputs from a row the first time something is picked.
  function prefill(r: Row) {
    if (!bulkStarts) setBulkStarts(toLocalInput(r.starts_at))
    if (!bulkEnds) setBulkEnds(toLocalInput(r.ends_at))
  }
  function toggle(r: Row) {
    setSelected(sel => {
      const next = new Set(sel)
      if (next.has(r.id)) next.delete(r.id)
      else next.add(r.id)
      return next
    })
    prefill(r)
  }
  function selectAllShown() {
    setSelected(sel => new Set([...sel, ...shown.map(r => r.id)]))
    if (shown[0]) prefill(shown[0])
  }
  function selectWindow(key: string) {
    const group = windows.find(([k]) => k === key)?.[1]
    if (!group) return
    setSelected(new Set(group.map(r => r.id)))
    setBulkStarts(toLocalInput(group[0].starts_at))
    setBulkEnds(toLocalInput(group[0].ends_at))
  }
  function clearSelection() {
    setSelected(new Set()); setBulkStarts(''); setBulkEnds('')
  }

  // Moves the selected assignments' times in place: the same rows stay, so
  // students' drafts and submissions are untouched.
  async function applyBulk() {
    if (!bulkStarts || !bulkEnds) return alert('Set the new start and end')
    const startsISO = new Date(bulkStarts).toISOString()
    const endsISO = new Date(bulkEnds).toISOString()
    if (new Date(endsISO) <= new Date(startsISO)) return alert('End must be after start')
    const ids = [...selected]
    if (!confirm(`Change the times of ${ids.length} assignment(s) to ${prettyLocal(bulkStarts)} → ${prettyLocal(bulkEnds)}?`)) return
    setBulkBusy(true)
    for (let i = 0; i < ids.length; i += 100) {
      const { error } = await supabase.from('assignments')
        .update({ starts_at: startsISO, ends_at: endsISO }).in('id', ids.slice(i, i + 100))
      if (error) { setBulkBusy(false); load(); return alert(`Stopped after ${i} of ${ids.length}: ${error.message}`) }
    }
    setBulkBusy(false)
    alert(`Times changed for ${ids.length} assignment(s).`)
    clearSelection()
    load()
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <form onSubmit={create} className="card space-y-3 h-fit">
        <h2 className="font-semibold">Assign a project</h2>
        <div>
          <label className="label">Project</label>
          <select className="input" value={projectId} onChange={e => setProjectId(e.target.value)} required>
            <option value="">— pick —</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
        </div>
        <div className="border border-vs-border rounded p-3 bg-vs-bg">
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isPublic}
              onChange={e => setIsPublic(e.target.checked)}
              className="mt-0.5"
            />
            <div className="flex-1">
              <div className="text-sm text-vs-text">Publish to everyone</div>
              <div className="text-[11px] text-vs-mute mt-0.5">
                Every signed-in student sees this assignment during the window. No email list needed.
              </div>
            </div>
          </label>
        </div>

        {!isPublic && (
          <div>
            <label className="label">Assignee emails</label>
            <textarea className="input min-h-[100px]" value={emails} onChange={e => setEmails(e.target.value)}
              placeholder="one@example.com, two@example.com&#10;three@example.com" />
            <div className="text-[11px] text-vs-mute mt-1">Separate with commas, spaces, or newlines.</div>
          </div>
        )}
        <div className="space-y-3">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="label mb-0">Opens at</label>
              <button
                type="button"
                className="text-[11px] text-vs-accent hover:underline"
                onClick={() => setStarts(toLocalInput(new Date().toISOString()))}
              >Set to now</button>
            </div>
            <input className="input" type="datetime-local" value={starts} onChange={e => setStarts(e.target.value)} />
            <div className="text-[11px] text-vs-mute mt-1">{prettyLocal(starts) || '—'}</div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="label mb-0">Closes at</label>
              <div className="flex gap-2 text-[11px]">
                {[
                  { label: '+30m', ms: 30 * 60_000 },
                  { label: '+1h',  ms: 60 * 60_000 },
                  { label: '+2h',  ms: 120 * 60_000 },
                  { label: '+1d',  ms: 24 * 60 * 60_000 },
                ].map(({ label, ms }) => (
                  <button
                    key={label}
                    type="button"
                    className="text-vs-accent hover:underline"
                    onClick={() => {
                      const base = new Date(starts || new Date()).getTime()
                      setEnds(toLocalInput(new Date(base + ms).toISOString()))
                    }}
                  >{label}</button>
                ))}
              </div>
            </div>
            <input className="input" type="datetime-local" value={ends} onChange={e => setEnds(e.target.value)} />
            <div className="text-[11px] text-vs-mute mt-1">
              {prettyLocal(ends) || '—'}
              {starts && ends && new Date(ends) > new Date(starts) && (
                <span className="ml-2 text-vs-text">({formatDuration(new Date(starts), new Date(ends))})</span>
              )}
            </div>
          </div>
        </div>
        <button className="btn w-full" disabled={busy}>{busy ? '…' : 'Assign'}</button>
      </form>

      <div className="md:col-span-2 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-semibold">Assignments</h2>
          <input
            className="input max-w-[220px] ml-auto"
            placeholder="Search title or email…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          <select className="input max-w-[280px]" value={filterProject} onChange={e => setFilterProject(e.target.value)}>
            <option value="">All projects</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-sm">
          <select className="input max-w-[360px]" value="" onChange={e => selectWindow(e.target.value)}>
            <option value="">Select by time slot…</option>
            {windows.map(([key, group]) => (
              <option key={key} value={key}>
                {prettyLocal(group[0].starts_at)} → {prettyLocal(group[0].ends_at)} · {group.length}
              </option>
            ))}
          </select>
          <button className="btn-ghost" onClick={selectAllShown} disabled={!shown.length}>
            Select all shown ({shown.length})
          </button>
        </div>

        {selected.size > 0 && (
          <div className="card flex flex-wrap items-end gap-3 border-vs-accent">
            <div className="text-sm font-medium self-center">{selected.size} selected</div>
            <div>
              <label className="label">New start</label>
              <input type="datetime-local" className="input" value={bulkStarts} onChange={e => setBulkStarts(e.target.value)} />
            </div>
            <div>
              <label className="label">New end</label>
              <input type="datetime-local" className="input" value={bulkEnds} onChange={e => setBulkEnds(e.target.value)} />
            </div>
            <button className="btn" onClick={applyBulk} disabled={bulkBusy}>{bulkBusy ? '…' : 'Change times'}</button>
            <button className="btn-ghost" onClick={clearSelection} disabled={bulkBusy}>Clear</button>
            <div className="w-full text-[11px] text-vs-mute">
              Updates the selected assignments in place. Students' drafts and submissions are kept.
            </div>
          </div>
        )}

        {shown.length === 0 && <div className="text-vs-mute text-sm">No assignments.</div>}
        <div className="space-y-6">
          {grouped.map(([cat, courses]) => (
            <div key={cat} className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-vs-text border-b border-vs-border pb-1">
                <span>{cat}</span>
                <span className="opacity-60">·</span>
                <span className="text-vs-mute font-normal">{courses.reduce((n, [, items]) => n + items.length, 0)}</span>
              </div>
              {courses.map(([course, items]) => (
                <div key={course} className="space-y-2 pl-2">
                  <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-vs-mute">
                    <span>{course}</span>
                    <span className="opacity-60">·</span>
                    <span>{items.length}</span>
                  </div>
                  {items.map(a => (
                    <div key={a.id} className="card flex items-center justify-between gap-4">
                      <input
                        type="checkbox"
                        className="shrink-0"
                        checked={selected.has(a.id)}
                        onChange={() => toggle(a)}
                        aria-label={`Select ${a.assignee_email || 'public'} · ${a.project.title}`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm">
                          {a.is_public
                            ? <span className="inline-block mr-2 px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide bg-emerald-900/40 border border-emerald-700 text-emerald-300">Public</span>
                            : <span className="font-mono">{a.assignee_email}</span>}
                          <span className="text-vs-mute">· {a.project.title}</span>
                        </div>
                        <div className="text-xs text-vs-mute">
                          {prettyLocal(a.starts_at)} → {prettyLocal(a.ends_at)}
                          <span className="ml-2 text-vs-text/70">({formatDuration(new Date(a.starts_at), new Date(a.ends_at))})</span>
                        </div>
                      </div>
                      <button className="btn-ghost text-red-400" onClick={() => remove(a)}>Remove</button>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
