import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import CodeEditor from '../components/CodeEditor'
import Preview from '../components/Preview'
import Markdown from '../components/Markdown'
import CodeReviewMode from '../components/CodeReviewMode'
import ExternalLinkMode, {
  EMPTY_LINK_DRAFT,
  isGithubUrl,
  type ExternalLinkDraft,
} from '../components/ExternalLinkMode'
import type { Assignment, FileMap, Project, ProjectAsset, ProjectType } from '../lib/types'

type AssignmentRow = Assignment & { project: Project }

const DEFAULT_FILES: FileMap = {
  'index.html': '',
  'styles.css': '',
  'script.js': '',
}

// Starter files for a code_review (MERN) project if the admin didn't set any.
const DEFAULT_CODE_REVIEW_FILES: FileMap = {
  'server.js': '// Entry point — your Express app lives here.\n',
  'package.json': JSON.stringify({ name: 'submission', version: '1.0.0', main: 'server.js' }, null, 2),
}

function draftKey(id: string) { return `web-eval:draft:${id}` }
function linkDraftKey(id: string) { return `web-eval:link-draft:${id}` }

export default function Solve() {
  const { assignmentId } = useParams()
  const nav = useNavigate()
  const { profile } = useAuth()

  const [assignment, setAssignment] = useState<AssignmentRow | null>(null)
  const [assets, setAssets] = useState<ProjectAsset[]>([])
  const [files, setFiles] = useState<FileMap>(DEFAULT_FILES)
  const [linkDraft, setLinkDraft] = useState<ExternalLinkDraft>(EMPTY_LINK_DRAFT)
  const [folders, setFolders] = useState<string[]>([])  // empty folders the student made
  const [active, setActive] = useState<string>('index.html')
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [remaining, setRemaining] = useState<string>('')
  const [alreadySubmittedAt, setAlreadySubmittedAt] = useState<string | null>(null)
  const [problemOpen, setProblemOpen] = useState(false)   // fullscreen reader
  const [problemCollapsed, setProblemCollapsed] = useState(false)
  const [autoSubmitted, setAutoSubmitted] = useState<null | 'ok' | 'fail'>(null)
  const [autoSubmitError, setAutoSubmitError] = useState<string | null>(null)

  // Panel layout (persisted in localStorage so it survives reloads)
  const LAYOUT_KEY = 'web-eval:layout'
  const initialLayout = (() => {
    try { return JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}') } catch { return {} }
  })()
  const [sidebarW, setSidebarW] = useState<number>(initialLayout.sidebarW ?? 320)
  const [previewW, setPreviewW] = useState<number>(initialLayout.previewW ?? 560)
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(initialLayout.sidebarOpen ?? true)
  const [previewOpen, setPreviewOpen] = useState<boolean>(initialLayout.previewOpen ?? true)
  const [previewFull, setPreviewFull] = useState<boolean>(false)
  useEffect(() => {
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify({ sidebarW, previewW, sidebarOpen, previewOpen })) } catch {}
  }, [sidebarW, previewW, sidebarOpen, previewOpen])

  // Keep latest files/profile for the auto-submit timer without re-arming it.
  const filesRef = useRef(files)
  useEffect(() => { filesRef.current = files }, [files])
  const didSubmitRef = useRef(false)
  const warnedRef = useRef(false)
  const [warnLast60, setWarnLast60] = useState(false)

  // Fetch assignment + project + assets
  useEffect(() => {
    (async () => {
      if (!assignmentId) return
      const { data, error } = await supabase
        .from('assignments')
        .select('*, project:projects(*)')
        .eq('id', assignmentId)
        .maybeSingle()
      if (error) { setErr(error.message); setLoading(false); return }
      if (!data) { setErr('Assignment not found or not visible'); setLoading(false); return }
      const row = data as unknown as AssignmentRow
      setAssignment(row)

      // Block if the student has already submitted this assignment.
      const { data: existing } = await supabase
        .from('submissions')
        .select('submitted_at')
        .eq('assignment_id', row.id)
        .maybeSingle()
      if (existing) {
        setAlreadySubmittedAt((existing as { submitted_at: string }).submitted_at)
        setLoading(false)
        return
      }

      const projectType: ProjectType = (row.project as Project).project_type || 'live_preview'

      // External link projects don't use asset library; skip the fetch.
      if (projectType === 'live_preview') {
        const { data: a } = await supabase
          .from('project_assets')
          .select('*')
          .eq('project_id', row.project_id)
        setAssets((a as ProjectAsset[]) || [])
      } else {
        setAssets([])
      }

      // Pick the right default starter set for the project type.
      const defaultsForType = projectType === 'live_preview'
        ? DEFAULT_FILES
        : projectType === 'code_review'
          ? DEFAULT_CODE_REVIEW_FILES
          : {}

      // Load file draft (used by live_preview + code_review)
      const draft = localStorage.getItem(draftKey(assignmentId))
      const starter = { ...defaultsForType, ...(row.project.starter_files || {}) }
      if (draft) {
        try {
          const parsed = JSON.parse(draft)
          // Backwards compat: old drafts were just FileMap
          if (parsed.files) { setFiles(parsed.files); setFolders(parsed.folders || []) }
          else setFiles(parsed as FileMap)
        } catch { setFiles(starter) }
      } else setFiles(starter)

      // Load external-link draft (used only by external_link)
      if (projectType === 'external_link') {
        const ld = localStorage.getItem(linkDraftKey(assignmentId))
        if (ld) {
          try { setLinkDraft({ ...EMPTY_LINK_DRAFT, ...JSON.parse(ld) }) } catch { /* ignore */ }
        }
      }
      setLoading(false)
    })()
  }, [assignmentId])

  // Persist draft (files + empty folders)
  useEffect(() => {
    if (!assignmentId || loading) return
    localStorage.setItem(draftKey(assignmentId), JSON.stringify({ files, folders }))
  }, [files, folders, assignmentId, loading])

  // Persist external-link draft
  useEffect(() => {
    if (!assignmentId || loading) return
    localStorage.setItem(linkDraftKey(assignmentId), JSON.stringify(linkDraft))
  }, [linkDraft, assignmentId, loading])

  // Keep latest linkDraft for auto-submit without re-arming the countdown.
  const linkDraftRef = useRef(linkDraft)
  useEffect(() => { linkDraftRef.current = linkDraft }, [linkDraft])

  // Esc closes the problem modal or exits preview fullscreen
  useEffect(() => {
    if (!problemOpen && !previewFull) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (problemOpen) setProblemOpen(false)
      else if (previewFull) setPreviewFull(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [problemOpen, previewFull])

  // Live countdown to ends_at — also fires auto-submit when it hits 0.
  useEffect(() => {
    if (!assignment || !profile) return
    const end = new Date(assignment.ends_at).getTime()
    // Only auto-submit if the page was opened BEFORE the deadline.
    // Reopening a closed assignment shouldn't trigger a (doomed) insert.
    const openedBeforeDeadline = Date.now() < end
    const tick = () => {
      const ms = end - Date.now()
      if (ms <= 0) {
        setRemaining('Time up')
        if (openedBeforeDeadline && !didSubmitRef.current) {
          didSubmitRef.current = true
          void autoSubmit()
        }
        return
      }
      const h = Math.floor(ms / 3_600_000)
      const m = Math.floor((ms % 3_600_000) / 60_000)
      const s = Math.floor((ms % 60_000) / 1_000)
      setRemaining(`${h}h ${m}m ${s}s`)
      // One-time nudge at ~60 seconds left so students know auto-submit is coming.
      if (ms <= 60_000 && !warnedRef.current) {
        warnedRef.current = true
        // Non-blocking toast via title + a flash in the header is enough;
        // we also show a dedicated banner below.
        setWarnLast60(true)
      }
    }
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignment, profile])

  async function autoSubmit() {
    if (!assignment || !profile) return
    const projectType: ProjectType = assignment.project.project_type || 'live_preview'
    // Build the insert payload based on project type.
    const basePayload = { assignment_id: assignment.id, student_id: profile.id }
    const payload: Record<string, unknown> = projectType === 'external_link'
      ? {
          ...basePayload,
          files: {},
          submission_type: 'external_link',
          repo_url: linkDraftRef.current.repo_url.trim() || null,
          deployed_url: linkDraftRef.current.deployed_url.trim() || null,
          notes: linkDraftRef.current.notes.trim() || null,
        }
      : {
          ...basePayload,
          files: filesRef.current,
          submission_type: 'code',
        }
    // eslint-disable-next-line no-console
    console.log('[auto-submit] firing at', new Date().toISOString(), {
      assignment_id: assignment.id,
      student_id: profile.id,
      ends_at: assignment.ends_at,
      project_type: projectType,
    })
    const { error } = await supabase.from('submissions').insert(payload)
    if (error) {
      // eslint-disable-next-line no-console
      console.error('[auto-submit] failed:', error)
      setAutoSubmitted('fail')
      setAutoSubmitError(`${error.code ? `[${error.code}] ` : ''}${error.message}${error.hint ? ` — ${error.hint}` : ''}`)
      try {
        localStorage.setItem(
          `web-eval:expired:${assignment.id}`,
          JSON.stringify({ files: filesRef.current, at: new Date().toISOString() })
        )
      } catch {}
    } else {
      // eslint-disable-next-line no-console
      console.log('[auto-submit] success')
      setAutoSubmitted('ok')
      try { localStorage.removeItem(draftKey(assignment.id)) } catch {}
    }
  }

  const fileNames = useMemo(() => Object.keys(files), [files])

  // Group files into a flat folder tree.
  const tree = useMemo(() => {
    const g = new Map<string, string[]>()
    for (const name of fileNames) {
      const i = name.lastIndexOf('/')
      const dir = i === -1 ? '' : name.slice(0, i)
      if (!g.has(dir)) g.set(dir, [])
      g.get(dir)!.push(name)
    }
    // Include empty folders the student created
    for (const f of folders) if (!g.has(f)) g.set(f, [])
    return Array.from(g.entries()).sort((a, b) =>
      a[0] === '' ? -1 : b[0] === '' ? 1 : a[0].localeCompare(b[0])
    )
  }, [fileNames, folders])

  function cleanPath(p: string) {
    return p.split('/').map(s => s.trim()).filter(Boolean).join('/')
  }

  // Drag a vertical splitter: pass the setter + which side the value lives on.
  // "left"  = width of the left panel (handle at its right edge)
  // "right" = width of the right panel (handle at its left edge)
  function startDrag(
    e: React.PointerEvent,
    side: 'left' | 'right',
    get: () => number,
    set: (v: number) => void,
    min = 180,
    max = 900,
  ) {
    e.preventDefault()
    const startX = e.clientX
    const startW = get()
    const id = e.pointerId
    const target = e.currentTarget as HTMLElement
    try { target.setPointerCapture(id) } catch {}
    document.body.style.cursor = 'col-resize'
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX
      const delta = side === 'left' ? dx : -dx
      const next = Math.min(max, Math.max(min, startW + delta))
      set(next)
    }
    const onUp = () => {
      document.body.style.cursor = ''
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      try { target.releasePointerCapture(id) } catch {}
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  function updateFile(name: string, v: string) {
    setFiles(f => ({ ...f, [name]: v }))
  }
  function addFile(preselectedDir = '') {
    const base = preselectedDir ? `${preselectedDir}/` : ''
    const name = prompt(`New file name (e.g. ${base}about.html, ${base}extra.css):`, base)?.trim()
    if (!name) return
    const clean = cleanPath(name)
    if (!clean) return
    if (files[clean] != null) return alert('That file already exists')
    setFiles(f => ({ ...f, [clean]: '' }))
    setActive(clean)
  }
  function addFolder() {
    const raw = prompt('New folder (e.g. components or styles/mobile):')?.trim()
    if (!raw) return
    const clean = cleanPath(raw)
    if (!clean) return
    setFolders(fs => fs.includes(clean) ? fs : [...fs, clean])
  }
  function removeFile(name: string) {
    if (['index.html', 'styles.css', 'script.js'].includes(name)) return alert('Cannot delete default files')
    if (!confirm(`Delete ${name}?`)) return
    setFiles(f => { const n = { ...f }; delete n[name]; return n })
    if (active === name) setActive('index.html')
  }
  function removeFolder(dir: string) {
    const inside = fileNames.filter(n => n.startsWith(dir + '/'))
    if (inside.length && !confirm(`Delete folder "${dir}" and its ${inside.length} file(s)?`)) return
    if (!inside.length && !confirm(`Delete empty folder "${dir}"?`)) return
    setFiles(f => {
      const n = { ...f }
      for (const name of inside) delete n[name]
      return n
    })
    setFolders(fs => fs.filter(x => x !== dir && !x.startsWith(dir + '/')))
    if (inside.includes(active)) setActive('index.html')
  }

  async function submit() {
    if (!assignment || !profile) return
    const end = new Date(assignment.ends_at).getTime()
    const start = new Date(assignment.starts_at).getTime()
    const now = Date.now()
    if (now < start) return alert('Not open yet')
    if (now > end) return alert('Submission window closed')

    const projectType: ProjectType = assignment.project.project_type || 'live_preview'

    // Validate the external-link form before confirming.
    if (projectType === 'external_link') {
      if (!linkDraft.repo_url.trim()) return alert('Please paste your GitHub repository URL.')
      if (!isGithubUrl(linkDraft.repo_url)) return alert('GitHub URL must be a valid https URL on github.com.')
    }

    if (!confirm('Submit this version for evaluation?')) return
    setSubmitting(true)
    const basePayload = { assignment_id: assignment.id, student_id: profile.id }
    const payload: Record<string, unknown> = projectType === 'external_link'
      ? {
          ...basePayload,
          files: {},
          submission_type: 'external_link',
          repo_url: linkDraft.repo_url.trim(),
          deployed_url: linkDraft.deployed_url.trim() || null,
          notes: linkDraft.notes.trim() || null,
        }
      : {
          ...basePayload,
          files,
          submission_type: 'code',
        }
    const { error } = await supabase.from('submissions').insert(payload)
    setSubmitting(false)
    if (error) return alert(error.message)
    didSubmitRef.current = true
    localStorage.removeItem(draftKey(assignment.id))
    localStorage.removeItem(linkDraftKey(assignment.id))
    alert('Submitted!')
    nav('/')
  }

  if (loading) return <div className="p-6 text-vs-mute">Loading…</div>
  if (err) return <div className="p-6 text-red-400">{err}</div>
  if (!assignment) return null

  const projectType: ProjectType = assignment.project.project_type || 'live_preview'

  if (alreadySubmittedAt) {
    return (
      <div className="min-h-screen grid place-items-center p-6">
        <div className="card max-w-md text-center space-y-4">
          <div className="text-4xl">✓</div>
          <h1 className="text-lg font-semibold">Already submitted</h1>
          <p className="text-sm text-vs-mute">
            You submitted <span className="text-vs-text">{assignment.project.title}</span> on{' '}
            <span className="text-vs-text">{new Date(alreadySubmittedAt).toLocaleString()}</span>.
            Only one submission per assignment is allowed.
          </p>
          <Link to="/" className="btn inline-block">Back to home</Link>
        </div>
      </div>
    )
  }

  // ---------- External link mode: lightweight form-only page -----------
  if (projectType === 'external_link') {
    return (
      <div className="h-screen flex flex-col">
        <header className="h-10 shrink-0 border-b border-vs-border px-3 flex items-center justify-between text-sm">
          <div className="flex items-center gap-3">
            <Link to="/" className="text-vs-mute hover:text-vs-text">← Back</Link>
            <span className="font-medium truncate max-w-md">{assignment.project.title}</span>
            <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-vs-border text-vs-mute">
              external link
            </span>
          </div>
          <div className="flex items-center gap-4">
            <span className={`text-vs-mute ${remaining === 'Time up' ? 'text-red-400' : ''}`}>
              Time left: <span className="text-vs-text">{remaining}</span>
            </span>
            <button className="btn" onClick={submit} disabled={submitting || remaining === 'Time up'}>
              {submitting ? 'Submitting…' : 'Submit'}
            </button>
          </div>
        </header>
        {autoSubmitted && (
          <div className={`shrink-0 px-4 py-2 text-sm flex items-start justify-between gap-4
            ${autoSubmitted === 'ok'
              ? 'bg-emerald-900/30 border-b border-emerald-700 text-emerald-200'
              : 'bg-red-900/30 border-b border-red-700 text-red-200'}`}>
            <div className="flex-1 min-w-0">
              {autoSubmitted === 'ok'
                ? <span>⏱ Time's up — your submission was auto-submitted.</span>
                : (
                  <>
                    <div>⏱ Time's up — auto-submit failed. Your draft is saved locally.</div>
                    {autoSubmitError && (
                      <div className="mt-1 text-xs font-mono text-red-300/90 break-all">
                        Server said: {autoSubmitError}
                      </div>
                    )}
                  </>
                )}
            </div>
            <button className="btn-ghost shrink-0" onClick={() => nav('/')}>Back to home</button>
          </div>
        )}
        <div className="flex-1 min-h-0">
          <ExternalLinkMode
            problemStatement={assignment.project.description || ''}
            value={linkDraft}
            onChange={setLinkDraft}
            disabled={remaining === 'Time up' || submitting}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col">
      {/* Top bar */}
      <header className="h-10 shrink-0 border-b border-vs-border px-3 flex items-center justify-between text-sm">
        <div className="flex items-center gap-3">
          <Link to="/" className="text-vs-mute hover:text-vs-text">← Back</Link>
          <span className="font-medium truncate max-w-md">{assignment.project.title}</span>
          {projectType === 'code_review' && (
            <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-vs-border text-vs-mute">
              code review
            </span>
          )}
        </div>
        <div className="flex items-center gap-4">
          <span className={`text-vs-mute ${remaining === 'Time up' ? 'text-red-400' : ''}`}>
            Time left: <span className="text-vs-text">{remaining}</span>
          </span>
          <button className="btn" onClick={submit} disabled={submitting || remaining === 'Time up'}>
            {submitting ? 'Submitting…' : 'Submit'}
          </button>
        </div>
      </header>

      {/* Already-closed banner (opened a stale link after deadline) */}
      {remaining === 'Time up' && !autoSubmitted && new Date(assignment.ends_at).getTime() < Date.now() - 31_000 && (
        <div className="shrink-0 px-4 py-2 text-sm bg-vs-panel border-b border-vs-border text-vs-mute flex items-center justify-between">
          <span>⏱ This assignment closed on {new Date(assignment.ends_at).toLocaleString()}. You can view your draft but can no longer submit.</span>
          <button className="btn-ghost" onClick={() => nav('/')}>Back to home</button>
        </div>
      )}

      {/* Last-minute warning */}
      {warnLast60 && !autoSubmitted && remaining !== 'Time up' && (
        <div className="shrink-0 px-4 py-2 text-sm bg-amber-900/30 border-b border-amber-700 text-amber-200 flex items-center justify-between">
          <span>⏰ Less than a minute left — your work will auto-submit at the deadline.</span>
          <button className="btn-ghost" onClick={() => setWarnLast60(false)}>Dismiss</button>
        </div>
      )}

      {/* Auto-submit banner */}
      {autoSubmitted && (
        <div className={`shrink-0 px-4 py-2 text-sm flex items-start justify-between gap-4
          ${autoSubmitted === 'ok'
            ? 'bg-emerald-900/30 border-b border-emerald-700 text-emerald-200'
            : 'bg-red-900/30 border-b border-red-700 text-red-200'}`}>
          <div className="flex-1 min-w-0">
            {autoSubmitted === 'ok' ? (
              <span>⏱ Time's up — your work was auto-submitted.</span>
            ) : (
              <>
                <div>⏱ Time's up — auto-submit failed. Your draft is saved locally.</div>
                {autoSubmitError && (
                  <div className="mt-1 text-xs font-mono text-red-300/90 break-all">
                    Server said: {autoSubmitError}
                  </div>
                )}
              </>
            )}
          </div>
          <button className="btn-ghost shrink-0" onClick={() => nav('/')}>Back to home</button>
        </div>
      )}

      <div className="flex-1 flex min-h-0 relative">
        {/* Sidebar: problem + assets + files */}
        {sidebarOpen && !previewFull && (
        <aside
          className="shrink-0 border-r border-vs-border bg-vs-sidebar flex flex-col min-h-0"
          style={{ width: sidebarW }}
        >
          <div className="border-b border-vs-border">
            <button
              onClick={() => setProblemCollapsed(c => !c)}
              className="w-full flex items-center justify-between px-3 py-2 hover:bg-vs-panel transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-vs-mute text-xs">{problemCollapsed ? '▸' : '▾'}</span>
                <span className="text-xs uppercase tracking-wide text-vs-mute">Problem</span>
              </div>
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => { e.stopPropagation(); setProblemOpen(true) }}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); setProblemOpen(true) } }}
                className="text-[11px] text-vs-accent hover:underline cursor-pointer"
              >⤢ Expand</span>
            </button>
            {!problemCollapsed && (
              <div className="px-3 pb-3 max-h-72 overflow-auto">
                {assignment.project.description
                  ? <Markdown source={assignment.project.description} />
                  : <div className="text-xs text-vs-mute">—</div>}
                {assignment.project.description && assignment.project.description.length > 400 && (
                  <button
                    className="mt-2 text-xs text-vs-accent hover:underline"
                    onClick={() => setProblemOpen(true)}
                  >Read full problem →</button>
                )}
              </div>
            )}
          </div>

          <div className="p-3 border-b border-vs-border">
            <div className="flex items-center justify-between mb-1">
              <div className="text-xs uppercase tracking-wide text-vs-mute">Files</div>
              <div className="flex gap-2">
                <button className="text-xs text-vs-accent hover:underline" onClick={() => addFile()}>+ file</button>
                <button className="text-xs text-vs-accent hover:underline" onClick={addFolder}>+ folder</button>
              </div>
            </div>
            <ul className="space-y-0.5 text-sm">
              {tree.map(([dir, items]) => (
                <li key={dir || '__root__'}>
                  {dir !== '' && (
                    <div className="group flex items-center justify-between text-vs-mute text-xs mt-2 mb-0.5">
                      <div className="truncate">📁 {dir}</div>
                      <div className="opacity-0 group-hover:opacity-100 flex gap-1">
                        <button className="hover:text-vs-text" onClick={() => addFile(dir)} title="New file in folder">+</button>
                        <button className="hover:text-red-400" onClick={() => removeFolder(dir)} title="Delete folder">×</button>
                      </div>
                    </div>
                  )}
                  <ul className={dir === '' ? '' : 'pl-3'}>
                    {items.map(n => {
                      const label = dir === '' ? n : n.slice(dir.length + 1)
                      return (
                        <li key={n} className="flex items-center justify-between group">
                          <button
                            className={`text-left px-2 py-1 rounded flex-1 truncate ${active === n ? 'bg-vs-panel text-vs-text' : 'text-vs-text/80 hover:bg-vs-panel'}`}
                            onClick={() => setActive(n)}
                            title={n}
                          >
                            {label}
                          </button>
                          <button onClick={() => removeFile(n)} className="opacity-0 group-hover:opacity-100 text-xs text-vs-mute hover:text-red-400 px-1">×</button>
                        </li>
                      )
                    })}
                  </ul>
                </li>
              ))}
            </ul>
          </div>

          <div className="p-3 overflow-auto flex-1 min-h-0">
            <div className="text-xs uppercase tracking-wide text-vs-mute mb-2">Assets</div>
            {assets.length === 0 ? (
              <div className="text-xs text-vs-mute">No assets provided.</div>
            ) : (
              <ul className="space-y-0.5 font-mono text-xs">
                {(() => {
                  const groups = new Map<string, ProjectAsset[]>()
                  for (const a of assets) {
                    const i = a.name.indexOf('/')
                    const k = i === -1 ? '/' : a.name.slice(0, i)
                    if (!groups.has(k)) groups.set(k, [])
                    groups.get(k)!.push(a)
                  }
                  return Array.from(groups.entries())
                    .sort((x, y) => (x[0] === '/' ? 1 : y[0] === '/' ? -1 : x[0].localeCompare(y[0])))
                    .map(([key, items]) => (
                      <li key={key}>
                        <div className="text-vs-mute mt-2 mb-0.5">{key === '/' ? '(root)' : `📁 ${key}`}</div>
                        <ul className="pl-3 space-y-0.5">
                          {items.map(a => {
                            const label = key === '/' ? a.name : a.name.slice(key.length + 1)
                            return (
                              <li key={a.id} className="flex items-center gap-2 group">
                                <button
                                  className="truncate text-left flex-1 hover:text-vs-text text-vs-text/80"
                                  title={`Click to copy: ${a.name}`}
                                  onClick={() => navigator.clipboard.writeText(a.name)}
                                >{label}</button>
                                <a href={a.public_url} target="_blank" rel="noreferrer"
                                  className="opacity-0 group-hover:opacity-100 text-vs-accent">↗</a>
                              </li>
                            )
                          })}
                        </ul>
                      </li>
                    ))
                })()}
              </ul>
            )}
            <div className="text-[11px] text-vs-mute mt-3 leading-relaxed">
              Click a file to copy its path. Reference it like <code className="text-vs-text">&lt;img src="images/logo.png"&gt;</code>.
            </div>
          </div>
        </aside>
        )}

        {/* Sidebar drag handle */}
        {sidebarOpen && !previewFull && (
          <div
            onPointerDown={e => startDrag(e, 'left', () => sidebarW, setSidebarW, 220, 560)}
            className="w-1 cursor-col-resize bg-transparent hover:bg-vs-accent/60 transition-colors"
            title="Drag to resize"
          />
        )}

        {/* Editor */}
        {!previewFull && (
        <section className="flex-1 flex flex-col min-w-0">
          <div className="h-8 border-b border-vs-border bg-vs-sidebar flex items-center text-xs overflow-x-auto">
            {!sidebarOpen && (
              <button
                onClick={() => setSidebarOpen(true)}
                className="px-2 h-full text-vs-mute hover:text-vs-text border-r border-vs-border"
                title="Show sidebar"
              >▸</button>
            )}
            {fileNames.map(n => {
              const base = n.includes('/') ? n.slice(n.lastIndexOf('/') + 1) : n
              return (
                <button
                  key={n}
                  className={`px-3 h-full border-r border-vs-border whitespace-nowrap ${active === n ? 'bg-vs-bg text-vs-text' : 'text-vs-mute hover:text-vs-text'}`}
                  onClick={() => setActive(n)}
                  title={n}
                >
                  {base}
                </button>
              )
            })}
            <div className="ml-auto flex items-center gap-1 pr-2">
              {sidebarOpen && (
                <button
                  onClick={() => setSidebarOpen(false)}
                  className="px-2 h-7 rounded hover:bg-vs-panel text-vs-mute hover:text-vs-text"
                  title="Hide sidebar"
                >◀ Sidebar</button>
              )}
              {previewOpen ? (
                <button
                  onClick={() => setPreviewOpen(false)}
                  className="px-2 h-7 rounded hover:bg-vs-panel text-vs-mute hover:text-vs-text"
                  title="Hide preview"
                >Preview ▶</button>
              ) : (
                <button
                  onClick={() => setPreviewOpen(true)}
                  className="px-2 h-7 rounded hover:bg-vs-panel text-vs-mute hover:text-vs-text"
                  title="Show preview"
                >◀ Preview</button>
              )}
            </div>
          </div>
          <div className="flex-1 min-h-0">
            <CodeEditor file={active} value={files[active] ?? ''} onChange={v => updateFile(active, v)} />
          </div>
        </section>
        )}

        {/* Preview drag handle */}
        {previewOpen && !previewFull && (
          <div
            onPointerDown={e => startDrag(e, 'right', () => previewW, setPreviewW, 240, 1200)}
            className="w-1 cursor-col-resize bg-transparent hover:bg-vs-accent/60 transition-colors"
            title="Drag to resize"
          />
        )}

        {/* Preview panel (normal or fullscreen) */}
        {previewOpen && (
          <section
            className={previewFull
              ? "fixed inset-0 z-40 bg-white flex flex-col"
              : "border-l border-vs-border flex flex-col min-w-0 shrink-0"}
            style={previewFull ? undefined : { width: previewW }}
          >
            <div className="h-8 shrink-0 border-b border-vs-border bg-vs-sidebar flex items-center justify-between px-2 text-xs text-vs-mute">
              <div className="px-2">{projectType === 'code_review' ? 'Info' : 'Preview'}</div>
              <div className="flex items-center gap-1">
                {projectType !== 'code_review' && (
                  <button
                    onClick={() => setPreviewFull(f => !f)}
                    className="px-2 h-7 rounded hover:bg-vs-panel text-vs-mute hover:text-vs-text"
                    title={previewFull ? 'Exit fullscreen (Esc)' : 'Fullscreen preview'}
                  >{previewFull ? '⤡ Exit' : '⤢ Fullscreen'}</button>
                )}
                {!previewFull && (
                  <button
                    onClick={() => setPreviewOpen(false)}
                    className="px-2 h-7 rounded hover:bg-vs-panel text-vs-mute hover:text-vs-text"
                    title={projectType === 'code_review' ? 'Hide panel' : 'Hide preview'}
                  >✕</button>
                )}
              </div>
            </div>
            <div className="flex-1 min-h-0">
              {projectType === 'code_review'
                ? <CodeReviewMode />
                : <Preview files={files} assets={assets} />}
            </div>
          </section>
        )}
      </div>

      {/* Problem reader modal */}
      {problemOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6"
          onClick={() => setProblemOpen(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="w-full max-w-3xl max-h-[85vh] bg-vs-sidebar border border-vs-border rounded-lg shadow-2xl flex flex-col"
          >
            <header className="flex items-center justify-between px-6 py-3 border-b border-vs-border">
              <div>
                <div className="text-[11px] uppercase tracking-wide text-vs-mute">Problem statement</div>
                <h2 className="font-semibold text-vs-text">{assignment.project.title}</h2>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-vs-mute">Esc to close</span>
                <button
                  className="btn-ghost"
                  onClick={() => setProblemOpen(false)}
                >Close ✕</button>
              </div>
            </header>
            <div className="overflow-auto px-8 py-6">
              {assignment.project.description
                ? <Markdown source={assignment.project.description} className="prose-md-lg" />
                : <div className="text-vs-mute">No description provided.</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
