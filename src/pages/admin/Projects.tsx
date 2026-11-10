import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import MarkdownEditor from '../../components/MarkdownEditor'
import type { Project, ProjectType, Category, Course } from '../../lib/types'
import { CATEGORIES, categoryFor, COURSES, courseFor } from '../../lib/types'
import { WEB301_TEMPLATES } from '../../exam-templates/web301'

const REACT_STARTER = {
  'App.jsx':
    `export default function App() {\n  return (\n    <div style={{ padding: 24, fontFamily: 'system-ui' }}>\n      <h1>Hello React</h1>\n      <p>Edit App.jsx to get started.</p>\n    </div>\n  )\n}\n`,
  'styles.css': `body { margin: 0; }\n`,
}

// Persist the create-form draft so switching to another admin tab
// (Assignments / Submissions) and back doesn't wipe what the user typed.
const DRAFT_KEY = 'admin:newProjectDraft:v2'
type Draft = { title: string; desc: string; type: ProjectType; templateId: string; category: Category }
function loadDraft(): Draft {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY)
    if (!raw) return { title: '', desc: '', type: 'html', templateId: '', category: 'Assignments' }
    const d = JSON.parse(raw) as Partial<Draft>
    return {
      title: d.title ?? '',
      desc: d.desc ?? '',
      type: d.type === 'react' ? 'react' : 'html',
      templateId: d.templateId ?? '',
      category: (CATEGORIES as string[]).includes(d.category || '') ? (d.category as Category) : 'Assignments',
    }
  } catch {
    return { title: '', desc: '', type: 'html', templateId: '', category: 'Assignments' }
  }
}

export default function Projects() {
  const [rows, setRows] = useState<Project[]>([])
  const initial = loadDraft()
  const [title, setTitle] = useState(initial.title)
  const [desc, setDesc] = useState(initial.desc)
  const [type, setType] = useState<ProjectType>(initial.type)
  const [templateId, setTemplateId] = useState<string>(initial.templateId)
  const [category, setCategory] = useState<Category>(initial.category)
  const [busy, setBusy] = useState(false)
  const [bulkBusy, setBulkBusy] = useState(false)

  // Save draft on every change; clear it after a successful create.
  useEffect(() => {
    try {
      if (!title && !desc && !templateId && type === 'html' && category === 'Assignments') {
        sessionStorage.removeItem(DRAFT_KEY)
      } else {
        sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ title, desc, type, templateId, category }))
      }
    } catch { /* storage disabled — ignore */ }
  }, [title, desc, type, templateId, category])

  function applyTemplate(id: string) {
    setTemplateId(id)
    if (!id) return
    const tpl = WEB301_TEMPLATES.find(t => t.id === id)
    if (!tpl) return
    setType('react')
    setTitle(tpl.title)
    setDesc(tpl.description)
  }

  async function load() {
    const { data } = await supabase.from('projects').select('*').order('created_at', { ascending: false })
    setRows((data as Project[]) || [])
  }
  useEffect(() => { load() }, [])

  async function create(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    const payload: Record<string, unknown> = {
      title,
      description: desc,
      project_type: type,
      category,
    }
    if (templateId) {
      const tpl = WEB301_TEMPLATES.find(t => t.id === templateId)
      if (tpl) payload.starter_files = tpl.starter_files
    } else if (type === 'react') {
      // Only seed the basic React starter when no exam template is picked.
      payload.starter_files = REACT_STARTER
    }
    // HTML starters come from the DB default.
    const { error } = await supabase.from('projects').insert(payload)
    setBusy(false)
    if (error) return alert(error.message)
    setTitle(''); setDesc(''); setType('html'); setTemplateId(''); setCategory('Assignments')
    try { sessionStorage.removeItem(DRAFT_KEY) } catch { /* ignore */ }
    load()
  }

  async function importAllWeb301() {
    if (!confirm(`Create all ${WEB301_TEMPLATES.length} WEB 301 projects (P0–P9)?`)) return
    setBulkBusy(true)
    let ok = 0, failed = 0
    for (const tpl of WEB301_TEMPLATES) {
      const { error } = await supabase.from('projects').insert({
        title: tpl.title,
        description: tpl.description,
        project_type: 'react',
        category,
        starter_files: tpl.starter_files,
      })
      if (error) { failed++; console.error(tpl.id, error.message) }
      else ok++
    }
    setBulkBusy(false)
    alert(`Imported ${ok} / ${WEB301_TEMPLATES.length}` + (failed ? ` — ${failed} failed (see console)` : ''))
    load()
  }

  async function remove(id: string) {
    if (!confirm('Delete project and its assets/assignments?')) return
    const { error } = await supabase.from('projects').delete().eq('id', id)
    if (error) return alert(error.message)
    load()
  }

  async function updateCategory(id: string, next: Category) {
    const prev = rows
    setRows(rs => rs.map(r => r.id === id ? { ...r, category: next } : r))
    const { error } = await supabase.from('projects').update({ category: next }).eq('id', id)
    if (error) { setRows(prev); alert(error.message) }
  }

  const grouped = useMemo(() => {
    const byCat = new Map<Category, Map<Course, Project[]>>()
    for (const p of rows) {
      const cat = categoryFor(p)
      const course = courseFor(p.project_type)
      let inner = byCat.get(cat)
      if (!inner) { inner = new Map(); byCat.set(cat, inner) }
      const list = inner.get(course) || []
      list.push(p)
      inner.set(course, list)
    }
    return CATEGORIES
      .filter(c => byCat.has(c))
      .map(cat => {
        const inner = byCat.get(cat)!
        const courses = COURSES.filter(c => inner.has(c)).map(course => [course, inner.get(course)!] as const)
        return [cat, courses] as const
      })
  }, [rows])

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <form onSubmit={create} className="card md:col-span-1 space-y-3 h-fit">
        <h2 className="font-semibold">New project</h2>
        <div>
          <label className="label">Import exam template (optional)</label>
          <select
            className="input"
            value={templateId}
            onChange={e => applyTemplate(e.target.value)}
          >
            <option value="">— None (blank project) —</option>
            <optgroup label="WEB 301 Mid-Sem Phase 2">
              {WEB301_TEMPLATES.map(t => (
                <option key={t.id} value={t.id}>{t.title}</option>
              ))}
            </optgroup>
          </select>
          <div className="flex items-center justify-between mt-1">
            <div className="text-[11px] text-vs-mute">
              {templateId
                ? 'Picking a template fills title, problem statement and starter files.'
                : 'Pick one of the WEB 301 problems to pre-fill the form.'}
            </div>
            <button
              type="button"
              className="text-[11px] text-vs-accent hover:underline"
              onClick={importAllWeb301}
              disabled={bulkBusy}
            >{bulkBusy ? 'Importing…' : 'Import all 10 →'}</button>
          </div>
        </div>
        <div>
          <label className="label">Title</label>
          <input className="input" value={title} onChange={e => setTitle(e.target.value)} required />
        </div>
        <div>
          <label className="label">Category</label>
          <select className="input" value={category} onChange={e => setCategory(e.target.value as Category)}>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Project type</label>
          <div className="flex gap-2">
            <label className={`flex-1 cursor-pointer border rounded px-3 py-2 text-sm ${type === 'html' ? 'border-vs-accent text-vs-text' : 'border-vs-border text-vs-mute'}`}>
              <input type="radio" className="mr-2" name="ptype" checked={type === 'html'} onChange={() => setType('html')} />
              HTML / CSS / JS
            </label>
            <label className={`flex-1 cursor-pointer border rounded px-3 py-2 text-sm ${type === 'react' ? 'border-vs-accent text-vs-text' : 'border-vs-border text-vs-mute'}`}>
              <input type="radio" className="mr-2" name="ptype" checked={type === 'react'} onChange={() => setType('react')} />
              React
            </label>
          </div>
          <div className="text-[11px] text-vs-mute mt-1">
            {type === 'react'
              ? 'Preview compiles JSX in the browser (via Sandpack). React Router is pre-installed.'
              : 'Classic iframe srcdoc preview — index.html, styles.css, script.js.'}
          </div>
        </div>
        <div>
          <label className="label">Problem statement (markdown)</label>
          <MarkdownEditor
            value={desc}
            onChange={setDesc}
            placeholder={"# Build an e-commerce landing page\n\nIt should have:\n- a hero section\n- a product grid\n- a sticky header"}
            minHeight={200}
          />
        </div>
        <button className="btn w-full" disabled={busy}>{busy ? '…' : 'Create project'}</button>
      </form>

      <div className="md:col-span-2 space-y-6">
        <h2 className="font-semibold">Projects</h2>
        {rows.length === 0 && <div className="text-vs-mute text-sm">No projects yet.</div>}
        {grouped.map(([cat, courses]) => (
          <div key={cat} className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-vs-text border-b border-vs-border pb-1">
              <span>{cat}</span>
              <span className="opacity-60">·</span>
              <span className="text-vs-mute font-normal">{courses.reduce((n, [, ps]) => n + ps.length, 0)}</span>
            </div>
            {courses.map(([course, ps]) => (
              <div key={course} className="space-y-2 pl-2">
                <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-vs-mute">
                  <span>{course}</span>
                  <span className="opacity-60">·</span>
                  <span>{ps.length}</span>
                </div>
                {ps.map(p => (
                  <div key={p.id} className="card flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="font-medium flex items-center gap-2">
                        {p.title}
                        <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide ${p.project_type === 'react' ? 'bg-cyan-900/40 text-cyan-200' : 'bg-vs-panel text-vs-mute'}`}>
                          {p.project_type === 'react' ? 'React' : 'HTML'}
                        </span>
                      </div>
                      <div className="text-xs text-vs-mute line-clamp-2 whitespace-pre-wrap">{p.description || '—'}</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <select
                        className="input text-xs !py-1 w-28"
                        value={categoryFor(p)}
                        onChange={e => updateCategory(p.id, e.target.value as Category)}
                        title="Category"
                      >
                        {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <Link to={`/admin/projects/${p.id}`} className="btn-ghost">Edit</Link>
                      <button className="btn-ghost text-red-400" onClick={() => remove(p.id)}>Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
