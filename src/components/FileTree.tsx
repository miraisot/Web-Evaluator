import { useMemo, useState } from 'react'
import { buildTree, type TreeFolder } from '../lib/fileTree'

// Nested file tree for the editor sidebar and the admin submission view.
// Folders collapse on click; the add/delete actions appear on hover only
// when their handlers are given, so leaving them out makes it read-only.
export default function FileTree({
  files, folders = [], active, onOpen, onAddFile, onAddFolder, onDeleteFile, onDeleteFolder,
}: {
  files: string[]
  folders?: string[]
  active: string
  onOpen: (path: string) => void
  onAddFile?: (dir: string) => void
  onAddFolder?: (dir: string) => void
  onDeleteFile?: (path: string) => void
  onDeleteFolder?: (dir: string) => void
}) {
  const root = useMemo(() => buildTree(files, folders), [files, folders])
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  function toggle(path: string) {
    setCollapsed(c => {
      const next = new Set(c)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const indent = (depth: number) => ({ paddingLeft: 8 + depth * 12 })

  function renderFolder(folder: TreeFolder, depth: number): JSX.Element[] {
    const rows: JSX.Element[] = []
    for (const sub of folder.folders) {
      const open = !collapsed.has(sub.path)
      rows.push(
        <li key={`d:${sub.path}`} className="group flex items-center rounded hover:bg-vs-panel" style={indent(depth)}>
          <button
            className="flex-1 min-w-0 flex items-center gap-1 py-1 text-left text-vs-text/80"
            onClick={() => toggle(sub.path)}
            title={sub.path}
          >
            <span className="w-3 shrink-0 text-[10px] text-vs-mute">{open ? '▾' : '▸'}</span>
            <span className="truncate">📁 {sub.name}</span>
          </button>
          <span className="shrink-0 flex gap-1 pr-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 text-xs text-vs-mute">
            {onAddFile && (
              <button className="hover:text-vs-text" onClick={() => onAddFile(sub.path)} title={`New file in ${sub.path}`}>+ file</button>
            )}
            {onAddFolder && (
              <button className="hover:text-vs-text" onClick={() => onAddFolder(sub.path)} title={`New folder in ${sub.path}`}>+ folder</button>
            )}
            {onDeleteFolder && (
              <button className="hover:text-red-400" onClick={() => onDeleteFolder(sub.path)} title={`Delete ${sub.path}`}>×</button>
            )}
          </span>
        </li>,
      )
      if (open) rows.push(...renderFolder(sub, depth + 1))
    }
    for (const path of folder.files) {
      rows.push(
        <li key={`f:${path}`} className="group flex items-center">
          <button
            className={`flex-1 min-w-0 truncate text-left py-1 rounded ${active === path ? 'bg-vs-panel text-vs-text' : 'text-vs-text/80 hover:bg-vs-panel'}`}
            style={{ paddingLeft: 8 + depth * 12 + 16 }}
            onClick={() => onOpen(path)}
            title={path}
          >{path.slice(path.lastIndexOf('/') + 1)}</button>
          {onDeleteFile && (
            <button
              onClick={() => onDeleteFile(path)}
              className="shrink-0 opacity-0 group-hover:opacity-100 focus:opacity-100 text-xs text-vs-mute hover:text-red-400 px-1"
              title={`Delete ${path}`}
            >×</button>
          )}
        </li>,
      )
    }
    return rows
  }

  return <ul className="space-y-0.5 text-sm">{renderFolder(root, 0)}</ul>
}
