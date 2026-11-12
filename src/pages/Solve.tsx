import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import CodeEditor from '../components/CodeEditor'
import Preview from '../components/Preview'
import ReactPreview from '../components/ReactPreview'
import Markdown from '../components/Markdown'
import FileTree from '../components/FileTree'
import type { Assignment, FileMap, Project, ProjectAsset, ProjectType } from '../lib/types'
// Bundled reference docs served from inside the app so they work under
// Safe Exam Browser without widening the URL allow-list.
import reactReferenceMd from '../docs/react-reference.md?raw'

type AssignmentRow = Assignment & { project: Project }

const DEFAULT_FILES_HTML: FileMap = {
  'index.html': '',
  'styles.css': '',
  'script.js': '',
}

const DEFAULT_FILES_REACT: FileMap = {
  'App.jsx':
    `export default function App() {\n  return <h1>Hello React</h1>\n}\n`,
  'styles.css': '',
}

const PROTECTED_FILES_HTML = ['index.html', 'styles.css', 'script.js']
const PROTECTED_FILES_REACT = ['App.jsx']

function defaultFilesFor(type: ProjectType): FileMap {
  return type === 'react' ? { ...DEFAULT_FILES_REACT } : { ...DEFAULT_FILES_HTML }
}
function protectedFilesFor(type: ProjectType): string[] {
  return type === 'react' ? PROTECTED_FILES_REACT : PROTECTED_FILES_HTML
}
// First of these that exists in the project. Template projects keep App
// under src/, and opening a missing root App.jsx would create a duplicate
// the moment the student starts typing.
const ACTIVE_CANDIDATES_REACT = ['src/App.jsx', 'src/App.tsx', 'App.jsx', 'App.tsx', 'src/main.jsx']
function defaultActiveFor(type: ProjectType, files: FileMap): string {
  const candidates = type === 'react' ? ACTIVE_CANDIDATES_REACT : ['index.html']
  return candidates.find(n => n in files) ?? Object.keys(files).sort()[0] ?? candidates[0]
}

function draftKey(id: string) { return `web-eval:draft:${id}` }

// Slim strip at the window edge that brings a hidden panel back.
function PanelRail({ label, icon, title, side, onOpen }: {
  label: string
  icon: string
  title: string
  side: 'left' | 'right'
  onOpen: () => void
}) {
  return (
    <button
      onClick={onOpen}
      title={title}
      className={`shrink-0 w-7 flex flex-col items-center gap-2 pt-2 bg-vs-sidebar border-vs-border text-vs-mute hover:text-vs-text hover:bg-vs-panel transition-colors ${side === 'left' ? 'border-r' : 'border-l'}`}
    >
      <span>{icon}</span>
      <span className="text-[11px] uppercase tracking-wide" style={{ writingMode: 'vertical-rl' }}>{label}</span>
    </button>
  )
}

export default function Solve() {
  const { assignmentId } = useParams()
  const nav = useNavigate()
  const { profile } = useAuth()

  const [assignment, setAssignment] = useState<AssignmentRow | null>(null)
  const [assets, setAssets] = useState<ProjectAsset[]>([])
  const [files, setFiles] = useState<FileMap>(DEFAULT_FILES_HTML)
  const [folders, setFolders] = useState<string[]>([])  // empty folders the student made
  const [active, setActive] = useState<string>('index.html')
  const [openTabs, setOpenTabs] = useState<string[]>([])  // editor tabs, in order
  const tabBarRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [remaining, setRemaining] = useState<string>('')
  const [alreadySubmittedAt, setAlreadySubmittedAt] = useState<string | null>(null)
  const [problemOpen, setProblemOpen] = useState(false)   // fullscreen reader
  const [problemCollapsed, setProblemCollapsed] = useState(false)
  const [assetsCollapsed, setAssetsCollapsed] = useState(false)
  const [referenceOpen, setReferenceOpen] = useState(false)   // fullscreen reader
  const [expectedOpen, setExpectedOpen] = useState(false)
  const [autoSubmitted, setAutoSubmitted] = useState<null | 'ok' | 'fail'>(null)
  const [autoSubmitError, setAutoSubmitError] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'offline'>('idle')
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)

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
  const foldersRef = useRef(folders)
  useEffect(() => { foldersRef.current = folders }, [folders])
  const didSubmitRef = useRef(false)
  const warnedRef = useRef(false)
  const [warnLast60, setWarnLast60] = useState(false)
  // Autosave bookkeeping — "dirty" means we have unsaved local edits.
  const dirtyRef = useRef(false)
  const inFlightRef = useRef(false)
  const skipNextChangeRef = useRef(false) // suppress the first save after initial load

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

      const { data: a } = await supabase
        .from('project_assets')
        .select('*')
        .eq('project_id', row.project_id)
      setAssets((a as ProjectAsset[]) || [])

      // Resolve starting content: prefer whichever draft is newer — the
      // server-side draft (survives browser/device changes) or the local
      // one (survives transient network loss between autosaves).
      const type: ProjectType = row.project.project_type || 'html'
      // If the project ships its own starter files, use them AS-IS. Only
      // fall back to the built-in default scaffold when there are none —
      // otherwise we'd end up with duplicate roots (e.g. /App.jsx AND
      // /src/App.jsx) which confuses Sandpack's entry resolution.
      const projectStarter = row.project.starter_files || {}
      const starter = Object.keys(projectStarter).length > 0
        ? projectStarter
        : defaultFilesFor(type)
      let serverDraft: { files: FileMap; folders: string[]; updated_at: string } | null = null
      if (profile) {
        const { data: d } = await supabase
          .from('submission_drafts')
          .select('files, folders, updated_at')
          .eq('assignment_id', assignmentId)
          .eq('student_id', profile.id)
          .maybeSingle()
        if (d) {
          serverDraft = {
            files: (d as { files: FileMap }).files || {},
            folders: ((d as { folders?: string[] }).folders) || [],
            updated_at: (d as { updated_at: string }).updated_at,
          }
        }
      }

      let localDraft: { files: FileMap; folders: string[]; at?: string } | null = null
      try {
        const raw = localStorage.getItem(draftKey(assignmentId))
        if (raw) {
          const parsed = JSON.parse(raw)
          if (parsed && parsed.files) localDraft = { files: parsed.files, folders: parsed.folders || [], at: parsed.at }
          else if (parsed) localDraft = { files: parsed as FileMap, folders: [] }
        }
      } catch {}

      let use: { files: FileMap; folders: string[] } | null = null
      if (serverDraft && localDraft?.at) {
        use = new Date(localDraft.at) > new Date(serverDraft.updated_at)
          ? { files: localDraft.files, folders: localDraft.folders }
          : { files: serverDraft.files, folders: serverDraft.folders }
      } else if (serverDraft) {
        use = { files: serverDraft.files, folders: serverDraft.folders }
      } else if (localDraft) {
        use = { files: localDraft.files, folders: localDraft.folders }
      }

      const initialFiles = use ? use.files : starter
      setFiles(initialFiles)
      if (use) setFolders(use.folders)
      const first = defaultActiveFor(type, initialFiles)
      setActive(first)
      setOpenTabs(first in initialFiles ? [first] : [])
      if (serverDraft) {
        setLastSavedAt(new Date(serverDraft.updated_at))
        setSaveStatus('saved')
      }
      // The initial setFiles above would otherwise mark the draft dirty; skip.
      skipNextChangeRef.current = true
      setLoading(false)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentId, profile?.id])

  // Persist draft locally (fast, synchronous safety net) and mark dirty for
  // the server-side autosave below. The `at` timestamp lets the next load
  // compare freshness against the server copy.
  useEffect(() => {
    if (!assignmentId || loading) return
    try {
      localStorage.setItem(
        draftKey(assignmentId),
        JSON.stringify({ files, folders, at: new Date().toISOString() }),
      )
    } catch {}
    if (skipNextChangeRef.current) { skipNextChangeRef.current = false; return }
    dirtyRef.current = true
    setSaveStatus(s => (s === 'offline' ? 'offline' : 'saving'))
  }, [files, folders, assignmentId, loading])

  // Server-side autosave: every 3s, if dirty and not already in flight, upsert
  // the current snapshot. Also flush on page hide / unload so a last-moment
  // tab close still ships the latest state.
  useEffect(() => {
    if (!assignmentId || !profile || loading || alreadySubmittedAt) return
    let cancelled = false

    async function flush() {
      if (!dirtyRef.current || inFlightRef.current) return
      inFlightRef.current = true
      dirtyRef.current = false
      const payload = {
        assignment_id: assignmentId,
        student_id: profile!.id,
        files: filesRef.current,
        folders: foldersRef.current,
        updated_at: new Date().toISOString(),
      }
      const { error } = await supabase
        .from('submission_drafts')
        .upsert(payload, { onConflict: 'assignment_id,student_id' })
      inFlightRef.current = false
      if (cancelled) return
      if (error) {
        // Keep dirty so we retry; show "offline" so the student knows the
        // local save is still happening even if the server didn't take it.
        dirtyRef.current = true
        setSaveStatus('offline')
        // eslint-disable-next-line no-console
        console.warn('[autosave] failed, will retry:', error.message)
      } else {
        setLastSavedAt(new Date())
        setSaveStatus(dirtyRef.current ? 'saving' : 'saved')
      }
    }

    const interval = setInterval(flush, 3000)
    const onVisibility = () => { if (document.visibilityState === 'hidden') void flush() }
    const onBeforeUnload = () => { void flush() }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onBeforeUnload)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      cancelled = true
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onBeforeUnload)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [assignmentId, profile, loading, alreadySubmittedAt])

  // Esc closes the problem/expected/reference modal or exits preview fullscreen
  useEffect(() => {
    if (!problemOpen && !previewFull && !expectedOpen && !referenceOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (expectedOpen) setExpectedOpen(false)
      else if (referenceOpen) setReferenceOpen(false)
      else if (problemOpen) setProblemOpen(false)
      else if (previewFull) setPreviewFull(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [problemOpen, previewFull, expectedOpen, referenceOpen])

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
    // eslint-disable-next-line no-console
    console.log('[auto-submit] firing at', new Date().toISOString(), {
      assignment_id: assignment.id,
      student_id: profile.id,
      ends_at: assignment.ends_at,
      file_count: Object.keys(filesRef.current).length,
    })
    const { error } = await supabase
      .from('submissions')
      .insert({ assignment_id: assignment.id, student_id: profile.id, files: filesRef.current })
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
      await supabase.from('submission_drafts').delete()
        .eq('assignment_id', assignment.id).eq('student_id', profile.id)
    }
  }

  const fileNames = useMemo(() => Object.keys(files), [files])

  // Keep the active tab in view when it's opened from the sidebar. Sets
  // scrollLeft directly: scrollIntoView could also scroll the page itself.
  useEffect(() => {
    const bar = tabBarRef.current
    const el = bar?.querySelector<HTMLElement>(`[data-tab="${CSS.escape(active)}"]`)
    if (!bar || !el) return
    if (el.offsetLeft < bar.scrollLeft) bar.scrollLeft = el.offsetLeft
    else if (el.offsetLeft + el.offsetWidth > bar.scrollLeft + bar.clientWidth) {
      bar.scrollLeft = el.offsetLeft + el.offsetWidth - bar.clientWidth
    }
  }, [active, openTabs])

  // Group files into a flat folder tree.
  // Normalises a typed path: trims segments, drops empty and "." ones, and
  // resolves ".." like a shell, never above the project root.
  function cleanPath(p: string) {
    const out: string[] = []
    for (const seg of p.split('/').map(s => s.trim())) {
      if (!seg || seg === '.') continue
      if (seg === '..') out.pop()
      else out.push(seg)
    }
    return out.join('/')
  }
  const isFolderPath = (p: string) => folders.includes(p) || fileNames.some(n => n.startsWith(p + '/'))
  // True when some parent segment of `p` is an existing file (e.g. "App.jsx/x").
  const isInsideFile = (p: string) => {
    const segs = p.split('/')
    return segs.slice(0, -1).some((_, i) => files[segs.slice(0, i + 1).join('/')] != null)
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
  function openFile(name: string) {
    setOpenTabs(t => (t.includes(name) ? t : [...t, name]))
    setActive(name)
  }
  // Closes editor tabs; the files themselves stay. If the active tab goes,
  // its right-hand neighbour takes over, else the left one, else none.
  function closeTabs(names: string[]) {
    const next = openTabs.filter(t => !names.includes(t))
    if (names.includes(active)) {
      const i = openTabs.indexOf(active)
      const after = openTabs.slice(i + 1).find(t => next.includes(t))
      const before = openTabs.slice(0, Math.max(i, 0)).reverse().find(t => next.includes(t))
      setActive(after ?? before ?? '')
    }
    setOpenTabs(next)
  }
  function addFile(preselectedDir = '') {
    const base = preselectedDir ? `${preselectedDir}/` : ''
    const name = prompt(`New file name (e.g. ${base}about.html, ${base}extra.css):`, base)?.trim()
    if (!name) return
    const clean = cleanPath(name)
    if (!clean) return
    if (files[clean] != null) return alert('That file already exists')
    if (isFolderPath(clean)) return alert('A folder with that name already exists')
    if (isInsideFile(clean)) return alert("That path goes inside a file. Files can only go in folders.")
    setFiles(f => ({ ...f, [clean]: '' }))
    openFile(clean)
  }
  // `parentDir` is where the folder goes; the typed name may nest further
  // (e.g. "ui/buttons"), and any missing folders on the way are created.
  function addFolder(parentDir = '') {
    const where = parentDir ? `inside ${parentDir}/` : 'at the top level'
    const raw = prompt(`New folder ${where} (you can nest, e.g. components/ui):`)?.trim()
    if (!raw) return
    const clean = cleanPath(parentDir ? `${parentDir}/${raw}` : raw)
    if (!clean) return
    if (files[clean] != null) return alert('A file with that name already exists')
    if (isFolderPath(clean)) return alert('That folder already exists')
    if (isInsideFile(clean)) return alert("That path goes inside a file. Folders can only go in folders.")
    setFolders(fs => [...fs, clean])
  }
  function removeFile(name: string) {
    const type: ProjectType = assignment?.project.project_type || 'html'
    if (protectedFilesFor(type).includes(name)) return alert('Cannot delete default files')
    if (!confirm(`Delete ${name}?`)) return
    const rest = { ...files }
    delete rest[name]
    setFiles(rest)
    // Keep the folder even when its last file goes, as editors do.
    const dir = name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : ''
    if (dir) setFolders(fs => (fs.includes(dir) ? fs : [...fs, dir]))
    closeTabs([name])
  }
  function removeFolder(dir: string) {
    const inside = fileNames.filter(n => n.startsWith(dir + '/'))
    if (inside.length && !confirm(`Delete folder "${dir}" and its ${inside.length} file(s)?`)) return
    if (!inside.length && !confirm(`Delete empty folder "${dir}"?`)) return
    const rest = { ...files }
    for (const name of inside) delete rest[name]
    setFiles(rest)
    // Drop the folder and everything under it, but keep its parent folder.
    const parent = dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : ''
    setFolders(fs => {
      const kept = fs.filter(x => x !== dir && !x.startsWith(dir + '/'))
      return parent && !kept.includes(parent) ? [...kept, parent] : kept
    })
    closeTabs(inside)
  }

  async function submit() {
    if (!assignment || !profile) return
    const end = new Date(assignment.ends_at).getTime()
    const start = new Date(assignment.starts_at).getTime()
    const now = Date.now()
    if (now < start) return alert('Not open yet')
    if (now > end) return alert('Submission window closed')
    if (!confirm('Submit this version for evaluation?')) return
    setSubmitting(true)
    const { error } = await supabase
      .from('submissions')
      .insert({ assignment_id: assignment.id, student_id: profile.id, files })
    setSubmitting(false)
    if (error) return alert(error.message)
    didSubmitRef.current = true
    localStorage.removeItem(draftKey(assignment.id))
    await supabase.from('submission_drafts').delete()
      .eq('assignment_id', assignment.id).eq('student_id', profile.id)
    alert('Submitted!')
    nav('/')
  }

  if (loading) return <div className="p-6 text-vs-mute">Loading…</div>
  if (err) return <div className="p-6 text-red-400">{err}</div>
  if (!assignment) return null

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

  return (
    // overflow-hidden: the page itself must never scroll, or scrolling past
    // the end inside the preview iframe chains up and shifts the whole UI.
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Top bar */}
      <header className="h-10 shrink-0 border-b border-vs-border px-3 flex items-center justify-between text-sm">
        <div className="flex items-center gap-3">
          <Link to="/" className="text-vs-mute hover:text-vs-text">← Back</Link>
          <span className="font-medium truncate max-w-md">{assignment.project.title}</span>
        </div>
        <div className="flex items-center gap-4">
          {assignment.project.expected_output_url && (
            <button
              className="btn-ghost"
              onClick={() => setExpectedOpen(true)}
              title="View a reference screenshot of what you need to build"
            >
              🖼 Show expected output
            </button>
          )}
          <span
            className={
              saveStatus === 'offline'
                ? 'text-amber-300 text-xs'
                : saveStatus === 'saving'
                ? 'text-vs-mute text-xs'
                : saveStatus === 'saved'
                ? 'text-emerald-300 text-xs'
                : 'text-vs-mute text-xs'
            }
            title={
              saveStatus === 'offline'
                ? 'Server save failed — retrying. Your work is still kept locally.'
                : lastSavedAt
                ? `Last saved to server: ${lastSavedAt.toLocaleTimeString()}`
                : 'Changes are saved automatically to your account'
            }
          >
            {saveStatus === 'saving' ? '⏳ Saving…'
              : saveStatus === 'saved' ? '✓ Saved'
              : saveStatus === 'offline' ? '⚠ Offline (local only)'
              : '· Autosave on'}
          </span>
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
          <div className="shrink-0 border-b border-vs-border">
            <div className="flex items-center hover:bg-vs-panel transition-colors">
              <button
                onClick={() => setProblemCollapsed(c => !c)}
                className="flex-1 flex items-center gap-2 pl-3 py-2 text-left"
              >
                <span className="text-vs-mute text-xs">{problemCollapsed ? '▸' : '▾'}</span>
                <span className="text-xs uppercase tracking-wide text-vs-mute">Problem</span>
              </button>
              <button
                onClick={() => setProblemOpen(true)}
                className="px-2 py-2 text-[11px] text-vs-accent hover:underline"
              >⤢ Expand</button>
              <button
                onClick={() => setSidebarOpen(false)}
                className="px-2 py-2 mr-1 text-vs-mute hover:text-vs-text"
                title="Hide sidebar"
              >«</button>
            </div>
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

          {/* Files take the remaining height and scroll, so a deep folder
              tree can't push the Assets section out of the sidebar. */}
          <div className="flex-1 min-h-0 flex flex-col border-b border-vs-border">
            <div className="shrink-0 flex items-center justify-between px-3 pt-3 pb-1">
              <div className="text-xs uppercase tracking-wide text-vs-mute">Files</div>
              <div className="flex gap-2">
                <button className="text-xs text-vs-accent hover:underline" onClick={() => addFile()}>+ file</button>
                <button className="text-xs text-vs-accent hover:underline" onClick={() => addFolder()}>+ folder</button>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-auto px-2 pb-3">
              <FileTree
                files={fileNames}
                folders={folders}
                active={active}
                onOpen={openFile}
                onAddFile={addFile}
                onAddFolder={addFolder}
                onDeleteFile={removeFile}
                onDeleteFolder={removeFolder}
              />
            </div>
          </div>

          {(() => {
            const isReact = assignment.project.project_type === 'react'
            const adminRef = assignment.project.reference_md?.trim()
            // React projects always have the bundled React quick reference.
            // Admins can prepend project-specific notes with reference_md.
            const combinedRef = isReact
              ? (adminRef
                  ? `${adminRef}\n\n---\n\n${reactReferenceMd}`
                  : reactReferenceMd)
              : (adminRef || '')
            const hasRef = combinedRef.length > 0
            const badge = isReact
              ? (adminRef ? '· project notes + React docs' : '· React docs')
              : (adminRef ? '· available' : '')
            return (
              <div className="shrink-0 border-b border-vs-border">
                <div className="flex items-center">
                  <div className="flex-1 flex items-center gap-2 pl-3 py-2">
                    <span className="text-xs uppercase tracking-wide text-vs-mute">📖 Reference</span>
                    {badge && <span className="text-[11px] text-vs-mute">{badge}</span>}
                    {!hasRef && (
                      <span className="text-[11px] text-vs-mute italic">none</span>
                    )}
                  </div>
                  {hasRef && (
                    <button
                      onClick={() => setReferenceOpen(true)}
                      className="px-2 py-2 text-[11px] text-vs-accent hover:underline"
                      title="Open reference in full view"
                    >⤢ Expand</button>
                  )}
                </div>
              </div>
            )
          })()}

          <div className="shrink-0">
            <button
              onClick={() => setAssetsCollapsed(c => !c)}
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-vs-panel transition-colors"
            >
              <span className="text-vs-mute text-xs">{assetsCollapsed ? '▸' : '▾'}</span>
              <span className="text-xs uppercase tracking-wide text-vs-mute">Assets</span>
              {assets.length > 0 && <span className="text-[11px] text-vs-mute">({assets.length})</span>}
            </button>
            {!assetsCollapsed && (
              <div className="px-3 pb-3 max-h-48 overflow-auto">
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
            )}
          </div>
        </aside>
        )}

        {!sidebarOpen && !previewFull && (
          <PanelRail label="Sidebar" icon="»" title="Show sidebar" side="left" onOpen={() => setSidebarOpen(true)} />
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
          <div ref={tabBarRef} className="relative h-8 shrink-0 border-b border-vs-border bg-vs-sidebar flex items-stretch text-xs overflow-x-auto">
            {openTabs.map(n => {
              const base = n.includes('/') ? n.slice(n.lastIndexOf('/') + 1) : n
              return (
                <div
                  key={n}
                  data-tab={n}
                  className={`group flex items-center border-r border-vs-border whitespace-nowrap ${active === n ? 'bg-vs-bg text-vs-text' : 'text-vs-mute hover:text-vs-text'}`}
                  onAuxClick={e => { if (e.button === 1) closeTabs([n]) }}
                >
                  <button className="pl-3 pr-1 h-full" onClick={() => setActive(n)} title={n}>
                    {base}
                  </button>
                  <button
                    onClick={() => closeTabs([n])}
                    className={`mr-1 w-5 h-5 grid place-items-center rounded hover:bg-vs-panel hover:text-vs-text ${active === n ? '' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'}`}
                    title={`Close ${base}`}
                    aria-label={`Close ${n}`}
                  >×</button>
                </div>
              )
            })}
          </div>
          <div className="flex-1 min-h-0">
            {active && files[active] != null
              ? <CodeEditor file={active} value={files[active]} onChange={v => updateFile(active, v)} />
              : (
                <div className="h-full grid place-items-center text-sm text-vs-mute">
                  No file open. Pick a file from the sidebar.
                </div>
              )}
          </div>
        </section>
        )}

        {!previewOpen && (
          <PanelRail label="Preview" icon="«" title="Show preview" side="right" onOpen={() => setPreviewOpen(true)} />
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
              <div className="px-2">Preview</div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPreviewFull(f => !f)}
                  className="px-2 h-7 rounded hover:bg-vs-panel text-vs-mute hover:text-vs-text"
                  title={previewFull ? 'Exit fullscreen (Esc)' : 'Fullscreen preview'}
                >{previewFull ? '⤡ Exit' : '⤢ Fullscreen'}</button>
                {!previewFull && (
                  <button
                    onClick={() => setPreviewOpen(false)}
                    className="px-2 h-7 rounded hover:bg-vs-panel text-vs-mute hover:text-vs-text"
                    title="Hide preview"
                  >»</button>
                )}
              </div>
            </div>
            <div className="flex-1 min-h-0">
              {assignment.project.project_type === 'react'
                ? <ReactPreview files={files} assets={assets} />
                : <Preview files={files} assets={assets} />}
            </div>
          </section>
        )}
      </div>

      {/* Expected output modal */}
      {expectedOpen && assignment.project.expected_output_url && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-6"
          onClick={() => setExpectedOpen(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="w-full max-w-5xl max-h-[90vh] bg-vs-sidebar border border-vs-border rounded-lg shadow-2xl flex flex-col"
          >
            <header className="flex items-center justify-between px-6 py-3 border-b border-vs-border">
              <div>
                <div className="text-[11px] uppercase tracking-wide text-vs-mute">Expected output</div>
                <h2 className="font-semibold text-vs-text">{assignment.project.title}</h2>
              </div>
              <div className="flex items-center gap-3">
                <a
                  className="text-xs text-vs-accent hover:underline"
                  href={assignment.project.expected_output_url}
                  target="_blank"
                  rel="noreferrer"
                >Open in new tab ↗</a>
                <span className="text-xs text-vs-mute">Esc to close</span>
                <button
                  className="btn-ghost"
                  onClick={() => setExpectedOpen(false)}
                >Close ✕</button>
              </div>
            </header>
            <div className="overflow-auto p-4 flex items-start justify-center bg-vs-bg">
              <img
                src={assignment.project.expected_output_url}
                alt="Expected output"
                className="max-w-full h-auto rounded"
              />
            </div>
          </div>
        </div>
      )}

      {/* Reference reader modal */}
      {referenceOpen && (() => {
        const isReact = assignment.project.project_type === 'react'
        const adminRef = assignment.project.reference_md?.trim()
        const combinedRef = isReact
          ? (adminRef ? `${adminRef}\n\n---\n\n${reactReferenceMd}` : reactReferenceMd)
          : (adminRef || '')
        if (!combinedRef) return null
        return (
          <div
            className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6"
            onClick={() => setReferenceOpen(false)}
          >
            <div
              onClick={e => e.stopPropagation()}
              className="w-full max-w-3xl max-h-[85vh] bg-vs-sidebar border border-vs-border rounded-lg shadow-2xl flex flex-col"
            >
              <header className="flex items-center justify-between px-6 py-3 border-b border-vs-border">
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-vs-mute">📖 Reference</div>
                  <h2 className="font-semibold text-vs-text">{assignment.project.title}</h2>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-vs-mute">Esc to close</span>
                  <button
                    className="btn-ghost"
                    onClick={() => setReferenceOpen(false)}
                  >Close ✕</button>
                </div>
              </header>
              <div className="overflow-auto px-8 py-6">
                <Markdown source={combinedRef} className="prose-md-lg" />
              </div>
            </div>
          </div>
        )
      })()}

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
