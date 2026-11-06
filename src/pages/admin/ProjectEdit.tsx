import { ChangeEvent, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import CodeEditor from '../../components/CodeEditor'
import MarkdownEditor from '../../components/MarkdownEditor'
import {
  PROJECT_TYPES,
  PROJECT_TYPE_LABELS,
  type FileMap,
  type Project,
  type ProjectAsset,
  type ProjectType,
} from '../../lib/types'

function AssetTree({ assets, onRemove }: { assets: ProjectAsset[]; onRemove: (a: ProjectAsset) => void }) {
  // Group by top-level folder; files at root go under "/"
  const groups = useMemo(() => {
    const g = new Map<string, ProjectAsset[]>()
    for (const a of assets) {
      const idx = a.name.indexOf('/')
      const key = idx === -1 ? '/' : a.name.slice(0, idx)
      if (!g.has(key)) g.set(key, [])
      g.get(key)!.push(a)
    }
    // Folders first, then root
    return Array.from(g.entries()).sort((x, y) =>
      x[0] === '/' ? 1 : y[0] === '/' ? -1 : x[0].localeCompare(y[0])
    )
  }, [assets])

  return (
    <div className="space-y-4">
      {groups.map(([key, items]) => (
        <div key={key}>
          <div className="text-xs uppercase tracking-wide text-vs-mute mb-2">
            {key === '/' ? '(root)' : `📁 ${key}`} · <span className="normal-case">{items.length}</span>
          </div>
          <ul className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {items.map(a => (
              <li key={a.id} className="border border-vs-border rounded p-2 text-sm flex items-center gap-3">
                {a.content_type?.startsWith('image/') ? (
                  <img src={a.public_url} alt="" className="w-12 h-12 object-cover rounded bg-vs-bg" />
                ) : (
                  <div className="w-12 h-12 grid place-items-center bg-vs-bg rounded text-xs text-vs-mute">
                    {(a.name.split('.').pop() || 'file').slice(0,4)}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-xs" title={a.name}>{a.name}</div>
                  <div className="text-[11px] text-vs-mute">{a.size_bytes ? `${(a.size_bytes/1024).toFixed(1)} KB` : ''}</div>
                  <div className="flex gap-2 mt-0.5">
                    <a className="text-vs-accent hover:underline text-xs" href={a.public_url} target="_blank" rel="noreferrer">view</a>
                    <button
                      className="text-xs text-vs-mute hover:text-vs-text"
                      onClick={() => navigator.clipboard.writeText(a.name)}
                    >copy path</button>
                    <button className="text-xs text-red-400 hover:underline" onClick={() => onRemove(a)}>remove</button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

export default function ProjectEdit() {
  const { id } = useParams()
  const [project, setProject] = useState<Project | null>(null)
  const [files, setFiles] = useState<FileMap>({})
  const [active, setActive] = useState('index.html')
  const [assets, setAssets] = useState<ProjectAsset[]>([])
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [folder, setFolder] = useState('')  // optional target folder for next upload

  async function load() {
    if (!id) return
    const { data: p } = await supabase.from('projects').select('*').eq('id', id).maybeSingle()
    if (p) {
      setProject(p as Project)
      setFiles((p as Project).starter_files || {})
    }
    const { data: a } = await supabase.from('project_assets').select('*').eq('project_id', id).order('name')
    setAssets((a as ProjectAsset[]) || [])
  }
  useEffect(() => { load() }, [id])


  async function save() {
    if (!project) return
    setSaving(true)
    const { error } = await supabase
      .from('projects')
      .update({
        title: project.title,
        description: project.description,
        starter_files: files,
        project_type: project.project_type || 'live_preview',
      })
      .eq('id', project.id)
    setSaving(false)
    if (error) return alert(error.message)
    alert('Saved')
  }

  // Normalize "images/" , "/images", "images//sub" -> "images/sub"
  function cleanFolder(f: string) {
    return f.split('/').map(s => sanitizeSegment(s)).filter(Boolean).join('/')
  }
  // Make a path segment safe for Supabase Storage keys: no spaces, colons, etc.
  function sanitizeSegment(s: string) {
    return s.trim()
      .normalize('NFKD').replace(/[̀-ͯ]/g, '')      // strip diacritics
      .replace(/[^a-zA-Z0-9._-]+/g, '-')                      // non-safe -> dash
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
  }
  function sanitizePath(p: string) {
    return p.split('/').map(sanitizeSegment).filter(Boolean).join('/')
  }

  async function upload(e: ChangeEvent<HTMLInputElement>) {
    if (!id || !e.target.files?.length) return
    setUploading(true)
    const base = cleanFolder(folder)
    for (const file of Array.from(e.target.files)) {
      // Preserve subdirectory structure when the user picks a whole folder
      // (webkitRelativePath = "chosenDir/sub/img.png"), stripping the top-level
      // chosen dir so the student references "sub/img.png".
      const rel: string = file.webkitRelativePath || ''
      const relTailRaw = rel ? rel.split('/').slice(1).join('/') : file.name
      const relTail = sanitizePath(relTailRaw)
      const assetName = base ? `${base}/${relTail}` : relTail
      const storagePath = `${id}/${assetName}`
      const { error } = await supabase.storage.from('project-assets').upload(storagePath, file, {
        cacheControl: '3600',
        upsert: true,
        contentType: file.type || 'application/octet-stream',
      })
      if (error) { alert(`${assetName}: ${error.message}`); continue }
      const { data: pub } = supabase.storage.from('project-assets').getPublicUrl(storagePath)

      // Upsert (same name replaces old record)
      await supabase.from('project_assets').delete()
        .eq('project_id', id).eq('name', assetName)
      const { error: insErr } = await supabase.from('project_assets').insert({
        project_id: id,
        name: assetName,
        storage_path: storagePath,
        public_url: pub.publicUrl,
        content_type: file.type || null,
        size_bytes: file.size,
      })
      if (insErr) alert(`${assetName} record: ${insErr.message}`)
    }
    setUploading(false)
    e.target.value = ''
    load()
  }

  async function removeAsset(a: ProjectAsset) {
    if (!confirm(`Remove asset "${a.name}"?`)) return
    await supabase.storage.from('project-assets').remove([a.storage_path])
    await supabase.from('project_assets').delete().eq('id', a.id)
    load()
  }

  const [starterFolders, setStarterFolders] = useState<string[]>([])

  function cleanStarterPath(p: string) {
    return p.split('/').map(s => s.trim()).filter(Boolean).join('/')
  }
  function addStarterFile(preselectedDir = '') {
    const base = preselectedDir ? `${preselectedDir}/` : ''
    const raw = prompt(`Starter file (e.g. ${base}about.html, ${base}extra.css):`, base)?.trim()
    if (!raw) return
    const name = cleanStarterPath(raw)
    if (!name) return
    if (files[name] != null) return alert('Already exists')
    setFiles(f => ({ ...f, [name]: '' }))
    setActive(name)
  }
  function addStarterFolder() {
    const raw = prompt('New folder (e.g. components or styles/mobile):')?.trim()
    if (!raw) return
    const dir = cleanStarterPath(raw)
    if (!dir) return
    setStarterFolders(fs => fs.includes(dir) ? fs : [...fs, dir])
  }
  function removeFile(name: string) {
    if (!confirm(`Remove ${name} from starter files?`)) return
    setFiles(f => { const n = { ...f }; delete n[name]; return n })
    if (active === name) setActive(Object.keys(files).find(k => k !== name) || 'index.html')
  }
  function removeStarterFolder(dir: string) {
    const inside = Object.keys(files).filter(n => n.startsWith(dir + '/'))
    if (inside.length && !confirm(`Delete folder "${dir}" and its ${inside.length} file(s)?`)) return
    setFiles(f => { const n = { ...f }; inside.forEach(k => delete n[k]); return n })
    setStarterFolders(fs => fs.filter(x => x !== dir && !x.startsWith(dir + '/')))
  }

  const starterTree = useMemo(() => {
    const g = new Map<string, string[]>()
    for (const name of Object.keys(files)) {
      const i = name.lastIndexOf('/')
      const dir = i === -1 ? '' : name.slice(0, i)
      if (!g.has(dir)) g.set(dir, [])
      g.get(dir)!.push(name)
    }
    for (const f of starterFolders) if (!g.has(f)) g.set(f, [])
    return Array.from(g.entries()).sort((a, b) =>
      a[0] === '' ? -1 : b[0] === '' ? 1 : a[0].localeCompare(b[0])
    )
  }, [files, starterFolders])

  if (!project) return <div className="text-vs-mute">Loading…</div>

  const projectType: ProjectType = project.project_type || 'live_preview'
  const showStarterFiles = projectType !== 'external_link'
  const showAssets = projectType === 'live_preview'

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/admin/projects" className="text-vs-mute hover:text-vs-text text-sm">← Projects</Link>
        <h2 className="font-semibold">{project.title}</h2>
        <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-vs-border text-vs-mute">
          {projectType === 'live_preview' ? 'live preview' : projectType === 'code_review' ? 'code review' : 'external link'}
        </span>
        <button className="btn ml-auto" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="card space-y-3">
          <div>
            <label className="label">Title</label>
            <input className="input" value={project.title} onChange={e => setProject({ ...project, title: e.target.value })} />
          </div>
          <div>
            <label className="label">Project type</label>
            <select
              className="input"
              value={projectType}
              onChange={e => setProject({ ...project, project_type: e.target.value as ProjectType })}
            >
              {PROJECT_TYPES.map(t => (
                <option key={t} value={t}>{PROJECT_TYPE_LABELS[t]}</option>
              ))}
            </select>
            <div className="text-[11px] text-vs-mute mt-1">
              {projectType === 'live_preview' && 'HTML / CSS / JS with sandboxed iframe preview.'}
              {projectType === 'code_review' && 'Any-language code. Instructor reviews manually.'}
              {projectType === 'external_link' && 'Student submits GitHub repo URL + deployed URL.'}
            </div>
          </div>
          <div>
            <label className="label">Problem statement (markdown)</label>
            <MarkdownEditor
              value={project.description}
              onChange={v => setProject({ ...project, description: v })}
              placeholder={"# Project title\n\nDescribe what the student should build…"}
              minHeight={240}
            />
          </div>
        </div>

        {showStarterFiles && (
        <div className="md:col-span-2 card">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-medium">Starter files</h3>
            <div className="flex gap-3">
              <button className="text-sm text-vs-accent" onClick={() => addStarterFile()}>+ file</button>
              <button className="text-sm text-vs-accent" onClick={addStarterFolder}>+ folder</button>
            </div>
          </div>
          <div className="flex border border-vs-border rounded overflow-hidden" style={{ height: 360 }}>
            <ul className="w-56 border-r border-vs-border bg-vs-sidebar text-sm overflow-auto p-1 space-y-0.5">
              {starterTree.map(([dir, items]) => (
                <li key={dir || '__root__'}>
                  {dir !== '' && (
                    <div className="group flex items-center justify-between text-xs text-vs-mute mt-2 mb-0.5 px-2">
                      <span className="truncate">📁 {dir}</span>
                      <span className="opacity-0 group-hover:opacity-100 flex gap-2">
                        <button className="hover:text-vs-text" onClick={() => addStarterFile(dir)} title="New file">+</button>
                        <button className="hover:text-red-400" onClick={() => removeStarterFolder(dir)} title="Delete folder">×</button>
                      </span>
                    </div>
                  )}
                  <ul className={dir === '' ? '' : 'pl-2'}>
                    {items.map(n => {
                      const label = dir === '' ? n : n.slice(dir.length + 1)
                      return (
                        <li key={n} className="flex items-center group">
                          <button
                            className={`flex-1 text-left px-3 py-1.5 truncate ${active === n ? 'bg-vs-panel text-vs-text' : 'text-vs-text/80 hover:bg-vs-panel'}`}
                            onClick={() => setActive(n)}
                            title={n}
                          >{label}</button>
                          <button onClick={() => removeFile(n)} className="opacity-0 group-hover:opacity-100 text-xs text-vs-mute hover:text-red-400 px-2">×</button>
                        </li>
                      )
                    })}
                  </ul>
                </li>
              ))}
            </ul>
            <div className="flex-1 min-w-0">
              <CodeEditor file={active} value={files[active] ?? ''} onChange={v => setFiles(f => ({ ...f, [active]: v }))} />
            </div>
          </div>
        </div>
        )}
      </div>

      {projectType === 'external_link' && (
        <div className="card text-sm text-vs-mute">
          <div className="font-medium text-vs-text mb-1">External link project</div>
          Students will submit a GitHub repository URL, a deployed URL and optional notes.
          No starter files or asset library are needed for this project type.
        </div>
      )}

      {projectType === 'code_review' && (
        <div className="card text-sm text-vs-mute">
          <div className="font-medium text-vs-text mb-1">Code review project</div>
          Student code is not executed by the platform. Starter files you set above
          (e.g. <code className="text-vs-text">server.js</code>, <code className="text-vs-text">package.json</code>)
          are shown to the student in Monaco; submissions are reviewed manually.
        </div>
      )}

      {showAssets && (
      <div className="card">
        <div className="flex flex-wrap items-end gap-3 mb-4">
          <div className="flex-1 min-w-[200px]">
            <label className="label">Destination folder (optional)</label>
            <input
              className="input"
              placeholder="e.g. images or images/products"
              value={folder}
              onChange={e => setFolder(e.target.value)}
            />
            <div className="text-[11px] text-vs-mute mt-1">
              Leave blank to upload to the root. Students reference as{' '}
              <code className="text-vs-text">{folder ? `${folder}/filename.png` : 'filename.png'}</code>.
            </div>
          </div>
          <label className="btn-ghost cursor-pointer whitespace-nowrap">
            {uploading ? 'Uploading…' : '+ Upload files'}
            <input type="file" multiple hidden onChange={upload} disabled={uploading} />
          </label>
          <label className="btn-ghost cursor-pointer whitespace-nowrap">
            + Upload folder
            {/* webkitdirectory lets the browser pick an entire folder tree */}
            <input
              type="file"
              hidden
              onChange={upload}
              disabled={uploading}
              multiple
              {...({ webkitdirectory: 'true', directory: 'true' } as Record<string, string>)}
            />
          </label>
        </div>

        {assets.length === 0 ? (
          <div className="text-vs-mute text-sm">
            No assets yet. Upload images (PNG, JPG, SVG, WebP), fonts, JSON, PDFs — anything.
            Create a folder by typing its name above and uploading into it, or pick a whole folder from disk.
          </div>
        ) : (
          <AssetTree assets={assets} onRemove={removeAsset} />
        )}
      </div>
      )}
    </div>
  )
}
