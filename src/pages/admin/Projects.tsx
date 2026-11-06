import { FormEvent, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import MarkdownEditor from '../../components/MarkdownEditor'
import {
  PROJECT_TYPES,
  PROJECT_TYPE_LABELS,
  type Project,
  type ProjectType,
} from '../../lib/types'

export default function Projects() {
  const [rows, setRows] = useState<Project[]>([])
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [projectType, setProjectType] = useState<ProjectType>('live_preview')
  const [busy, setBusy] = useState(false)

  async function load() {
    const { data } = await supabase.from('projects').select('*').order('created_at', { ascending: false })
    setRows((data as Project[]) || [])
  }
  useEffect(() => { load() }, [])

  async function create(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    const { error } = await supabase
      .from('projects')
      .insert({ title, description: desc, project_type: projectType })
    setBusy(false)
    if (error) return alert(error.message)
    setTitle(''); setDesc(''); setProjectType('live_preview'); load()
  }

  async function remove(id: string) {
    if (!confirm('Delete project and its assets/assignments?')) return
    const { error } = await supabase.from('projects').delete().eq('id', id)
    if (error) return alert(error.message)
    load()
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <form onSubmit={create} className="card md:col-span-1 space-y-3 h-fit">
        <h2 className="font-semibold">New project</h2>
        <div>
          <label className="label">Title</label>
          <input className="input" value={title} onChange={e => setTitle(e.target.value)} required />
        </div>
        <div>
          <label className="label">Project type</label>
          <select
            className="input"
            value={projectType}
            onChange={e => setProjectType(e.target.value as ProjectType)}
          >
            {PROJECT_TYPES.map(t => (
              <option key={t} value={t}>{PROJECT_TYPE_LABELS[t]}</option>
            ))}
          </select>
          <div className="text-[11px] text-vs-mute mt-1">
            {projectType === 'live_preview' && 'HTML / CSS / JS with sandboxed iframe preview.'}
            {projectType === 'code_review' && 'Any-language code (MERN, Python, etc.). No live run; instructor reviews.'}
            {projectType === 'external_link' && 'Student submits a GitHub repo URL + a deployed URL.'}
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

      <div className="md:col-span-2 space-y-3">
        <h2 className="font-semibold">Projects</h2>
        {rows.length === 0 && <div className="text-vs-mute text-sm">No projects yet.</div>}
        {rows.map(p => {
          const t: ProjectType = p.project_type || 'live_preview'
          return (
            <div key={p.id} className="card flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="font-medium flex items-center gap-2 flex-wrap">
                  {p.title}
                  <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-vs-border text-vs-mute">
                    {t === 'live_preview' ? 'live preview' : t === 'code_review' ? 'code review' : 'external link'}
                  </span>
                </div>
                <div className="text-xs text-vs-mute line-clamp-2 whitespace-pre-wrap">{p.description || '—'}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Link to={`/admin/projects/${p.id}`} className="btn-ghost">Edit</Link>
                <button className="btn-ghost text-red-400" onClick={() => remove(p.id)}>Delete</button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
