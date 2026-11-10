export interface TreeFolder {
  name: string          // last path segment ('' for the root)
  path: string          // full path ('' for the root)
  folders: TreeFolder[]
  files: string[]       // full file paths
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1)

// Nested folder tree from file paths plus extra folders that may be empty.
// Every ancestor of a path becomes a folder; folders come before files and
// both sort by name.
export function buildTree(names: string[], extraFolders: string[] = []): TreeFolder {
  const root: TreeFolder = { name: '', path: '', folders: [], files: [] }
  const byPath = new Map<string, TreeFolder>([['', root]])

  const folderAt = (path: string): TreeFolder => {
    const existing = byPath.get(path)
    if (existing) return existing
    const i = path.lastIndexOf('/')
    const parent = folderAt(i === -1 ? '' : path.slice(0, i))
    const folder: TreeFolder = { name: path.slice(i + 1), path, folders: [], files: [] }
    parent.folders.push(folder)
    byPath.set(path, folder)
    return folder
  }

  for (const name of names) {
    const i = name.lastIndexOf('/')
    folderAt(i === -1 ? '' : name.slice(0, i)).files.push(name)
  }
  for (const f of extraFolders) if (f) folderAt(f)

  const sort = (f: TreeFolder) => {
    f.folders.sort((a, b) => byName(a.name, b.name))
    f.files.sort((a, b) => byName(baseName(a), baseName(b)))
    f.folders.forEach(sort)
  }
  sort(root)
  return root
}
