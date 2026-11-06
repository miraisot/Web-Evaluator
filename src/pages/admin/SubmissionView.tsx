import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import CodeEditor from '../../components/CodeEditor'
import Preview from '../../components/Preview'
import Markdown from '../../components/Markdown'
import type { ProjectAsset, ProjectType, Submission } from '../../lib/types'

type Row = Submission & {
  assignment: {
    assignee_email: string
    project_id: string
    project: {
      title: string
      description: string
      project_type: ProjectType | null
    }
  }
}

export default function SubmissionView() {
  const { id } = useParams()
  const [row, setRow] = useState<Row | null>(null)
  const [assets, setAssets] = useState<ProjectAsset[]>([])
  const [active, setActive] = useState('index.html')

  useEffect(() => {
    (async () => {
      if (!id) return
      const { data } = await supabase
        .from('submissions')
        .select('*, assignment:assignments(assignee_email, project_id, project:projects(title, description, project_type))')
        .eq('id', id)
        .maybeSingle()
      if (!data) return
      const r = data as unknown as Row
      setRow(r)
      const first = Object.keys(r.files || {})[0]
      if (first) setActive(first)
      // Only live_preview submissions need the asset library for the iframe.
      const projectType = r.assignment.project.project_type || 'live_preview'
      if (projectType === 'live_preview') {
        const { data: a } = await supabase.from('project_assets').select('*').eq('project_id', r.assignment.project_id)
        setAssets((a as ProjectAsset[]) || [])
      }
    })()
  }, [id])

  const files = row?.files || {}
  const names = useMemo(() => Object.keys(files), [files])

  if (!row) return <div className="text-vs-mute">Loading…</div>

  const projectType: ProjectType = row.assignment.project.project_type || 'live_preview'
  const submissionType = row.submission_type || 'code'

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-sm">
        <Link to="/admin/submissions" className="text-vs-mute hover:text-vs-text">← Submissions</Link>
        <span className="font-semibold">{row.assignment.project.title}</span>
        <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-vs-border text-vs-mute">
          {projectType === 'live_preview' ? 'live preview' : projectType === 'code_review' ? 'code review' : 'external link'}
        </span>
        <span className="text-vs-mute font-mono">{row.assignment.assignee_email}</span>
        <span className="ml-auto text-vs-mute">{new Date(row.submitted_at).toLocaleString()}</span>
      </div>

      {submissionType === 'external_link' ? (
        // ---------- External link submission view ----------
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4" style={{ minHeight: '72vh' }}>
          <div className="md:col-span-2 card space-y-3 overflow-auto">
            <div className="text-xs uppercase tracking-wide text-vs-mute">Problem statement</div>
            {row.assignment.project.description
              ? <Markdown source={row.assignment.project.description} />
              : <div className="text-vs-mute text-sm">—</div>}
          </div>
          <div className="md:col-span-3 card space-y-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-vs-mute">GitHub repository</div>
              {row.repo_url ? (
                <a href={row.repo_url} target="_blank" rel="noreferrer"
                  className="text-vs-accent hover:underline break-all">
                  {row.repo_url}
                </a>
              ) : <div className="text-vs-mute text-sm">— not provided —</div>}
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-vs-mute">Deployed URL</div>
              {row.deployed_url ? (
                <a href={row.deployed_url} target="_blank" rel="noreferrer"
                  className="text-vs-accent hover:underline break-all">
                  {row.deployed_url}
                </a>
              ) : <div className="text-vs-mute text-sm">— not provided —</div>}
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-vs-mute">Notes from student</div>
              {row.notes
                ? <div className="whitespace-pre-wrap text-sm text-vs-text/90">{row.notes}</div>
                : <div className="text-vs-mute text-sm">—</div>}
            </div>
            <div className="flex gap-2 pt-2 border-t border-vs-border">
              {row.repo_url && (
                <a className="btn-ghost" href={row.repo_url} target="_blank" rel="noreferrer">Open repo ↗</a>
              )}
              {row.deployed_url && (
                <a className="btn-ghost" href={row.deployed_url} target="_blank" rel="noreferrer">Open deployed app ↗</a>
              )}
            </div>
          </div>
        </div>
      ) : (
        // ---------- Code submission view (live_preview or code_review) ----------
        <div className="flex border border-vs-border rounded overflow-hidden" style={{ height: '72vh' }}>
          <aside className="w-48 border-r border-vs-border bg-vs-sidebar overflow-auto">
            <div className="text-xs uppercase text-vs-mute p-3 pb-1">Files</div>
            <ul>
              {names.map(n => (
                <li key={n}>
                  <button
                    className={`w-full text-left text-sm px-3 py-1.5 ${active === n ? 'bg-vs-panel text-vs-text' : 'text-vs-text/80 hover:bg-vs-panel'}`}
                    onClick={() => setActive(n)}
                  >{n}</button>
                </li>
              ))}
            </ul>
          </aside>
          <section className="flex-1 min-w-0">
            <CodeEditor file={active} value={files[active] ?? ''} readOnly />
          </section>
          {projectType === 'live_preview' ? (
            <section className="w-[40%] border-l border-vs-border">
              <Preview files={files} assets={assets} />
            </section>
          ) : (
            <section className="w-[32%] border-l border-vs-border bg-vs-sidebar overflow-auto">
              <div className="p-4 space-y-3 text-sm">
                <div className="text-xs uppercase tracking-wide text-vs-mute">Problem statement</div>
                {row.assignment.project.description
                  ? <Markdown source={row.assignment.project.description} />
                  : <div className="text-vs-mute">—</div>}
                <div className="text-[11px] text-vs-mute border-t border-vs-border pt-2">
                  Code review mode — student code is not executed by the platform.
                </div>
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
