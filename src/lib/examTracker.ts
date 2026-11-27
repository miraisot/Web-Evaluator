// Records how an exam answer is produced, for the admin's integrity review:
// pastes (with a sample of the text), large inserts that weren't typed,
// copying the problem text, time spent away from the exam window, typing
// activity per minute, extra screens and the Print Screen key.
//
// Events are batched and sent every 10 s to `log_client_events`, which only
// accepts them for the student's own open assignment (see
// supabase/migration_exam_tracking.sql). These are signals for a human to
// review, not proof: e.g. pasting text the student copied inside the exam
// itself is marked `internal` and doesn't count.

import type { OnMount } from '@monaco-editor/react'
import { supabase } from './supabase'

type MonacoEditor = Parameters<OnMount>[0]
type Detail = Record<string, string | number | boolean>
interface TrackedEvent { kind: string; at: string; detail: Detail }

export interface ExamTracker {
  /** Hook the Monaco editor (large inserts, copies made inside the editor). */
  attachEditor(editor: MonacoEditor): void
  /** Send everything recorded so far (call before submitting: the server
   *  stops accepting events once the exam session has ended). */
  flushNow(): Promise<void>
  stop(): void
}

const FLUSH_MS = 10_000
const ACTIVITY_MS = 60_000
const AWAY_MIN_MS = 2_000          // shorter blurs are noise
const LARGE_INSERT_CHARS = 150     // typed-looking insert this big = suspicious
const SAMPLE_CHARS = 1_500
const norm = (s: string) => s.replace(/\s+/g, ' ').trim()

export function startExamTracker(opts: {
  assignmentId: string
  activeFile: () => string
  problemText: () => string
}): ExamTracker {
  const queue: TrackedEvent[] = []
  const recentCopies: string[] = []      // text copied inside the exam page
  let keys = 0
  let awaySince: number | null = null
  let lastPasteAt = 0
  let stopped = false
  const disposers: (() => void)[] = []

  const push = (kind: string, detail: Detail = {}) => {
    if (stopped) return
    if (queue.length >= 500) queue.shift()
    queue.push({ kind, at: new Date().toISOString(), detail })
  }

  let flushing = false
  async function flush() {
    if (flushing || !queue.length) return
    flushing = true
    const batch = queue.splice(0, 100)
    const { error } = await supabase.rpc('log_client_events', { p_assignment: opts.assignmentId, p_events: batch })
    if (error) queue.unshift(...batch.slice(0, Math.max(0, 500 - queue.length))) // retry later
    flushing = false
  }

  const rememberCopy = (text: string) => {
    const t = norm(text)
    if (!t) return
    recentCopies.push(t)
    if (recentCopies.length > 30) recentCopies.shift()
  }
  const isInternal = (text: string) => {
    const t = norm(text)
    if (!t) return true
    if (recentCopies.some(c => c === t || (t.length > 20 && c.includes(t)))) return true
    // Copying sample data / text from the problem statement is allowed.
    return t.length > 10 && norm(opts.problemText()).includes(t)
  }

  // --- away from the exam window --------------------------------------------
  const markAway = () => { if (awaySince === null) awaySince = Date.now() }
  const markBack = () => {
    if (awaySince === null) return
    const away = Date.now() - awaySince
    awaySince = null
    if (away >= AWAY_MIN_MS) push('focus_lost', { away_ms: Math.round(away) })
  }
  // Clicking into the preview iframe blurs the window too; hasFocus() stays
  // true then, because focus is still inside this page.
  const onBlur = () => setTimeout(() => { if (!document.hasFocus()) markAway() }, 0)
  const onFocus = () => markBack()
  const onVisibility = () => (document.visibilityState === 'hidden' ? markAway() : markBack())

  // --- clipboard ------------------------------------------------------------
  const selectedText = (target: EventTarget | null): string => {
    const el = target as HTMLInputElement | HTMLTextAreaElement | null
    if (el && typeof el.selectionStart === 'number' && typeof el.value === 'string' && el.selectionEnd !== null) {
      return el.value.slice(el.selectionStart, el.selectionEnd)
    }
    return window.getSelection()?.toString() || ''
  }
  const onCopy = (e: ClipboardEvent) => {
    let text = ''
    try { text = e.clipboardData?.getData('text/plain') || '' } catch { /* not readable */ }
    if (!text) text = selectedText(e.target)
    if (!text) return
    rememberCopy(text)
    const inEditor = (e.target as Element | null)?.closest?.('.monaco-editor')
    if (!inEditor) push('copy', { chars: text.length, source: (e.target as Element | null)?.closest?.('[data-exam-problem]') ? 'problem' : 'page', [e.type === 'cut' ? 'cut' : 'copy']: true })
  }
  const onPaste = (e: ClipboardEvent) => {
    let text = ''
    try { text = e.clipboardData?.getData('text/plain') || '' } catch { /* not readable */ }
    if (!text) return
    lastPasteAt = Date.now()
    const internal = isInternal(text)
    if (internal ? text.length < 200 : text.length < 15) return
    push('paste', {
      chars: text.length,
      lines: text.split('\n').length,
      file: opts.activeFile(),
      internal,
      sample: text.slice(0, SAMPLE_CHARS),
    })
  }

  // --- typing activity --------------------------------------------------------
  const onKeyDown = (e: KeyboardEvent) => { if (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Enter') keys++ }
  const onKeyUp = (e: KeyboardEvent) => { if (e.key === 'PrintScreen') push('print_screen', {}) }

  window.addEventListener('blur', onBlur)
  window.addEventListener('focus', onFocus)
  document.addEventListener('visibilitychange', onVisibility)
  document.addEventListener('copy', onCopy)
  document.addEventListener('cut', onCopy)
  document.addEventListener('paste', onPaste, true)
  document.addEventListener('keydown', onKeyDown, true)
  document.addEventListener('keyup', onKeyUp, true)
  disposers.push(() => {
    window.removeEventListener('blur', onBlur)
    window.removeEventListener('focus', onFocus)
    document.removeEventListener('visibilitychange', onVisibility)
    document.removeEventListener('copy', onCopy)
    document.removeEventListener('cut', onCopy)
    document.removeEventListener('paste', onPaste, true)
    document.removeEventListener('keydown', onKeyDown, true)
    document.removeEventListener('keyup', onKeyUp, true)
  })

  const activityTimer = setInterval(() => {
    if (keys > 0) push('activity', { keys })
    keys = 0
  }, ACTIVITY_MS)
  const flushTimer = setInterval(() => { void flush() }, FLUSH_MS)
  const onPageHide = () => { markBack(); if (keys > 0) push('activity', { keys }); keys = 0; void flush() }
  window.addEventListener('pagehide', onPageHide)
  disposers.push(() => { clearInterval(activityTimer); clearInterval(flushTimer); window.removeEventListener('pagehide', onPageHide) })

  // Start marker (lets the admin tell "no events" from "not tracked") + screens.
  const extended = (window.screen as Screen & { isExtended?: boolean }).isExtended
  push('tracker_started', { screens: extended ? 2 : 1, width: window.screen.width, height: window.screen.height })
  if (extended) push('multi_screen', { screens: 2 })
  void flush()

  return {
    attachEditor(editor) {
      const d1 = editor.onDidChangeModelContent(ev => {
        if (ev.isFlush || ev.isUndoing || ev.isRedoing) return
        if (Date.now() - lastPasteAt < 1000) return // the paste listener already logged it
        for (const c of ev.changes) {
          if (c.text.length >= LARGE_INSERT_CHARS) {
            push('large_insert', { chars: c.text.length, file: opts.activeFile(), sample: c.text.slice(0, SAMPLE_CHARS) })
          }
        }
      })
      // Copies inside the editor (Monaco may not expose the text to the
      // document-level copy event): remember the selection on Ctrl/Cmd+C/X.
      const d2 = editor.onKeyDown(ev => {
        const k = ev.browserEvent.key.toLowerCase()
        if ((ev.ctrlKey || ev.metaKey) && (k === 'c' || k === 'x')) {
          const model = editor.getModel()
          for (const sel of editor.getSelections() || []) {
            const t = model?.getValueInRange(sel)
            if (t) rememberCopy(t)
          }
        }
      })
      disposers.push(() => { d1.dispose(); d2.dispose() })
    },
    async flushNow() {
      markBack()
      if (keys > 0) push('activity', { keys })
      keys = 0
      for (let i = 0; i < 5 && queue.length; i++) {
        while (flushing) await new Promise(r => setTimeout(r, 50))
        const before = queue.length
        await flush()
        if (queue.length >= before) break // failed; don't block submitting
      }
    },
    stop() {
      onPageHide()
      stopped = true
      disposers.splice(0).forEach(d => d())
    },
  }
}
