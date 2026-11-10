import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef, type RefObject } from 'react'
import {
  SandpackProvider,
  SandpackPreview,
  SandpackConsole,
  useSandpack,
} from '@codesandbox/sandpack-react'
import type { FileMap, ProjectAsset } from '../lib/types'

/**
 * Live preview for React projects — Monaco stays as the editor, Sandpack is
 * used headlessly as a browser-side bundler + preview iframe.
 *
 * Student files are mapped into Sandpack's virtual FS. Any file the student
 * hasn't created (entrypoint, index.html, package.json) is auto-filled by the
 * Sandpack "react" template, so a bare `App.jsx` works out of the box.
 */
export default function ReactPreview({
  files,
  assets,
}: {
  files: FileMap
  assets: ProjectAsset[]
}) {
  // Sandpack wants leading-slash paths. Also replace any asset-path references
  // in CSS/JS with their public URL so students can `import logo from 'images/logo.png'`.
  const { sandpackFiles, entry } = useMemo(() => {
    const assetMap = new Map(assets.map(a => [a.name, a.public_url]))
    const out: Record<string, string> = {}
    for (const [name, code] of Object.entries(files)) {
      let body = code
      // Rewrite "images/..." → public URL in common import/attr spots.
      if (assetMap.size && /\.(jsx?|tsx?|css|html)$/i.test(name)) {
        body = body.replace(/(["'`])([^"'`\s]+?)\1/g, (m, q, val) => {
          const u = assetMap.get(val)
          return u ? `${q}${u}${q}` : m
        })
      }
      // Two silent rewrites so the student's exam-compliant code renders in
      // Sandpack without them having to change a line:
      //   1. `from 'react-router'`  →  `from 'react-router-dom'`
      //      v7 of react-router doesn't bundle inside Sandpack's in-browser
      //      resolver, and v6's `react-router` package omits BrowserRouter.
      //      v6's `react-router-dom` has every symbol the spec uses.
      //   2. `BrowserRouter`         →  `HashRouter`
      //      Sandpack's preview iframe isn't served at `/`, so BrowserRouter
      //      (which reads window.location.pathname) matches nothing and
      //      renders blank. HashRouter uses the URL fragment and works in any
      //      hosting context.
      if (/\.(jsx?|tsx?)$/i.test(name)) {
        body = body
          .replace(/(from\s*['"])react-router(['"])/g, '$1react-router-dom$2')
          .replace(/\bBrowserRouter\b/g, 'HashRouter')
      }
      out['/' + name.replace(/^\/+/, '')] = body
    }

    // Entry resolution: Sandpack's `react` template defaults the entry to
    // /index.js regardless of what the student's package.json says. We detect
    // the project's actual entry file in priority order and tell Sandpack
    // explicitly via customSetup.entry. If the project is bare (no entry at
    // all), fall back to seeding /index.js with a minimal bootstrapper.
    const entryCandidates = [
      '/src/main.jsx', '/src/main.tsx', '/src/main.js', '/src/main.ts',
      '/src/index.jsx', '/src/index.tsx', '/src/index.js', '/src/index.ts',
      '/main.jsx', '/main.js',
      '/index.jsx', '/index.tsx', '/index.js', '/index.ts',
    ]
    let entry = entryCandidates.find(p => out[p])
    if (!entry) {
      out['/index.js'] = defaultEntry(out)
      entry = '/index.js'
    }
    return { sandpackFiles: out, entry }
  }, [files, assets])

  // Must keep a stable identity: Sandpack re-derives its whole file state
  // whenever `customSetup` changes, and Solve re-renders every second for
  // the countdown timer.
  const customSetup = useMemo(() => ({
    entry,
    dependencies: {
      // v6 bundles reliably in Sandpack. The `react-router` →
      // `react-router-dom` rewrite above makes the exam-spec import
      // syntax resolve here. React Router v7's ESM-only tree doesn't
      // bundle inside Sandpack's in-browser resolver.
      // Pinned exactly: 6.28+ logs "Future Flag" warnings into the
      // student's console on every load. This overrides the version in the
      // project's own package.json.
      'react-router-dom': '6.27.0',
    },
  }), [entry])

  const wrapperRef = useRef<HTMLDivElement>(null)

  return (
    <SandpackProvider
      key={JSON.stringify(Object.keys(sandpackFiles).sort())}
      template="react"
      files={sandpackFiles}
      customSetup={customSetup}
      options={SANDPACK_OPTIONS}
      style={{ width: '100%', height: '100%' }}
    >
      <StartWhenMounted />
      <div ref={wrapperRef} className="w-full h-full flex flex-col bg-white">
        <div className="flex-1 min-h-0 relative">
          <SandpackPreview
            showNavigator
            showRefreshButton
            showOpenInCodeSandbox={false}
            style={{ height: '100%', width: '100%', border: 'none' }}
          />
        </div>
        <ConsolePanel containerRef={wrapperRef} />
      </div>
    </SandpackProvider>
  )
}

/**
 * Starts the bundler once the provider tree has finished mounting.
 *
 * With Sandpack's own autorun, React StrictMode's dev-only
 * mount → unmount → mount cycle races Sandpack's async client creation
 * against its cleanup (which blanks the iframe with about:blank). The
 * bundler still runs — console output arrives — but the visible iframe
 * stays white. Deferring the start by a tick lets the simulated unmount
 * cancel the first timer, so the bundler starts exactly once.
 *
 * Runs once per mount only: `runSandpack` changes identity whenever the
 * files change, and re-running it would tear down and recreate the client
 * on every keystroke. Later edits reach the bundler through Sandpack's own
 * file watcher.
 */
function StartWhenMounted() {
  const { sandpack } = useSandpack()
  const run = useRef(sandpack.runSandpack)
  run.current = sandpack.runSandpack
  useEffect(() => {
    const t = window.setTimeout(() => { void run.current() }, 0)
    return () => window.clearTimeout(t)
  }, [])
  return null
}

const CONSOLE_PREFS_KEY = 'web-eval:console'
const CONSOLE_MIN_H = 80
const CONSOLE_DEFAULT_H = 160
// Space the preview keeps above the console when it is dragged taller.
const PREVIEW_MIN_H = 120

/**
 * Labelled console under the preview: click the bar to collapse or expand,
 * drag its top edge to resize. Starts collapsed, opens by itself on the
 * first output and on every new error. Once the student collapses it while
 * it has output, only errors reopen it. Open state and height persist.
 */
function ConsolePanel({ containerRef }: { containerRef: RefObject<HTMLDivElement> }) {
  const saved = (() => {
    try { return JSON.parse(localStorage.getItem(CONSOLE_PREFS_KEY) || '{}') } catch { return {} }
  })()
  const [open, setOpen] = useState<boolean>(saved.open ?? false)
  const [height, setHeight] = useState<number>(saved.height ?? CONSOLE_DEFAULT_H)
  const [counts, setCounts] = useState({ total: 0, errors: 0 })
  const consoleRef = useRef<ComponentRef<typeof SandpackConsole>>(null)
  const prev = useRef(counts)
  const dismissed = useRef(false)

  useEffect(() => {
    try { localStorage.setItem(CONSOLE_PREFS_KEY, JSON.stringify({ open, height })) } catch {}
  }, [open, height])

  // Must be stable: SandpackConsole re-runs its effect (and calls this)
  // whenever the callback's identity changes, so an inline function plus
  // the setState below would loop forever.
  const onLogsChange = useCallback((logs: { method: string }[]) => {
    const next = { total: logs.length, errors: logs.filter(l => l.method === 'error').length }
    if (next.total === prev.current.total && next.errors === prev.current.errors) return
    if (next.errors > prev.current.errors) setOpen(true)
    else if (next.total > prev.current.total && !dismissed.current) setOpen(true)
    prev.current = next
    setCounts(next)
  }, [])

  function toggle() {
    if (open && counts.total > 0) dismissed.current = true
    if (!open) dismissed.current = false
    setOpen(!open)
  }

  // Dragging up moves the pointer over the preview iframe, which is a
  // different origin and would swallow the moves. A transparent full-page
  // shield keeps every move in this document until release.
  function startResize(e: React.PointerEvent) {
    e.preventDefault()
    const startY = e.clientY
    const startH = height
    const max = Math.max(CONSOLE_MIN_H, (containerRef.current?.clientHeight ?? 600) - PREVIEW_MIN_H)
    const shield = document.createElement('div')
    shield.style.cssText = 'position:fixed;inset:0;z-index:9999;cursor:row-resize'
    document.body.appendChild(shield)
    const onMove = (ev: PointerEvent) =>
      setHeight(Math.min(max, Math.max(CONSOLE_MIN_H, startH + startY - ev.clientY)))
    const onUp = () => {
      shield.remove()
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <div
      className="shrink-0 relative flex flex-col border-t border-vs-border bg-[#1e1e1e]"
      style={open ? { height } : undefined}
    >
      {open && (
        <div
          onPointerDown={startResize}
          className="absolute -top-1 left-0 right-0 h-2 z-10 cursor-row-resize hover:bg-vs-accent/60 transition-colors"
          title="Drag to resize"
        />
      )}
      <div className="h-7 shrink-0 flex items-center justify-between bg-vs-sidebar text-xs text-vs-mute select-none">
        <button
          onClick={toggle}
          className="flex-1 h-full flex items-center gap-2 px-3 text-left hover:text-vs-text"
          title={open ? 'Collapse console' : 'Expand console'}
        >
          <span>{open ? '▾' : '▸'}</span>
          <span className="uppercase tracking-wide">Console</span>
          {counts.errors > 0 ? (
            <span className="px-1.5 rounded bg-red-900/60 text-red-200">
              {counts.errors} error{counts.errors === 1 ? '' : 's'}
            </span>
          ) : counts.total > 0 ? (
            <span className="px-1.5 rounded bg-vs-panel text-vs-text">{counts.total}</span>
          ) : null}
        </button>
        {open && counts.total > 0 && (
          <button
            onClick={() => { consoleRef.current?.reset(); onLogsChange([]) }}
            className="px-3 h-full hover:text-vs-text"
            title="Clear console"
          >Clear</button>
        )}
      </div>
      {/* Always mounted so output is captured while collapsed. */}
      <div className={open ? 'flex-1 min-h-0 relative' : 'hidden'}>
        <SandpackConsole
          ref={consoleRef}
          style={{ height: '100%', background: '#1e1e1e' }}
          showHeader={false}
          showResetConsoleButton={false}
          resetOnPreviewRestart
          onLogsChange={onLogsChange}
        />
        {counts.total === 0 && (
          <div className="absolute inset-0 grid place-items-center px-4 text-center text-xs text-vs-mute pointer-events-none">
            No output yet. console.log() messages and errors from your code show up here.
          </div>
        )}
      </div>
    </div>
  )
}

const SANDPACK_OPTIONS = {
  // Started by <StartWhenMounted> instead — see the note there.
  autorun: false,
  recompileMode: 'delayed',
  recompileDelay: 400,
} as const

/**
 * Bootstrapper for bare projects. Imports the student's App by its exact
 * filename: a bare `./App` would resolve to the Sandpack template's hidden
 * /App.js ("Hello world") before the student's /App.jsx.
 */
function defaultEntry(files: Record<string, string>): string {
  const app = ['/App.jsx', '/App.tsx', '/App.js', '/App.ts'].find(p => p in files) ?? '/App.js'
  const css = '/styles.css' in files ? `import "./styles.css"\n` : ''
  return `import React from "react"
import { createRoot } from "react-dom/client"
${css}import App from ".${app}"

const el = document.getElementById("root")
if (el) createRoot(el).render(<App />)
`
}
