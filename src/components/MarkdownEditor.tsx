import { useRef, useState, KeyboardEvent } from 'react'
import Markdown from './Markdown'

interface Props {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  minHeight?: number
}

export default function MarkdownEditor({ value, onChange, placeholder, minHeight = 240 }: Props) {
  const [tab, setTab] = useState<'write' | 'preview' | 'split'>('write')
  const ref = useRef<HTMLTextAreaElement>(null)

  // Wrap current selection with before/after, or insert at caret.
  function wrap(before: string, after = '', placeholder = '') {
    const ta = ref.current; if (!ta) return
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const scrollTop = ta.scrollTop
    const selected = value.slice(start, end) || placeholder
    const next = value.slice(0, start) + before + selected + after + value.slice(end)
    onChange(next)
    // Restore selection around the inserted text and preserve scroll position
    // (React's value update resets the native cursor to the end, which causes
    // focus() to scroll to the bottom of long content).
    requestAnimationFrame(() => {
      const t = ref.current; if (!t) return
      const sStart = start + before.length
      const sEnd = sStart + selected.length
      t.focus()
      t.setSelectionRange(sStart, sEnd)
      t.scrollTop = scrollTop
    })
  }

  // Prefix the start of each selected line (bulleted/numbered/quote/heading).
  function prefixLines(prefix: string | ((i: number) => string)) {
    const ta = ref.current; if (!ta) return
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const scrollTop = ta.scrollTop
    const lineStart = value.lastIndexOf('\n', start - 1) + 1
    const lineEnd = (() => { const i = value.indexOf('\n', end); return i === -1 ? value.length : i })()
    const block = value.slice(lineStart, lineEnd)
    const lines = block.split('\n')
    const newBlock = lines.map((l, i) =>
      (typeof prefix === 'function' ? prefix(i) : prefix) + (l || '')
    ).join('\n')
    const next = value.slice(0, lineStart) + newBlock + value.slice(lineEnd)
    onChange(next)
    requestAnimationFrame(() => {
      const t = ref.current; if (!t) return
      t.focus()
      t.setSelectionRange(lineStart, lineStart + newBlock.length)
      t.scrollTop = scrollTop
    })
  }

  function insertLink() {
    const url = prompt('URL:'); if (!url) return
    wrap('[', `](${url})`, 'link text')
  }
  function insertImage() {
    const url = prompt('Image URL:'); if (!url) return
    wrap('![', `](${url})`, 'alt text')
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    const mod = e.metaKey || e.ctrlKey
    if (!mod) return
    const k = e.key.toLowerCase()
    const map: Record<string, () => void> = {
      b: () => wrap('**', '**', 'bold'),
      i: () => wrap('*', '*', 'italic'),
      k: insertLink,
      e: () => wrap('`', '`', 'code'),
    }
    if (map[k]) { e.preventDefault(); map[k]() }
  }

  const Btn = ({ label, title, onClick }: { label: string; title: string; onClick: () => void }) => (
    <button type="button" title={title} onClick={onClick}
      className="px-2 h-7 rounded hover:bg-vs-panel text-vs-text text-sm">{label}</button>
  )

  return (
    <div className="border border-vs-border rounded overflow-hidden bg-vs-bg">
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 flex-wrap bg-vs-sidebar border-b border-vs-border px-1 py-1">
        <Btn label="H1" title="Heading 1" onClick={() => prefixLines('# ')} />
        <Btn label="H2" title="Heading 2" onClick={() => prefixLines('## ')} />
        <Btn label="H3" title="Heading 3" onClick={() => prefixLines('### ')} />
        <span className="w-px h-5 bg-vs-border mx-1" />
        <Btn label="B"  title="Bold (⌘B)"   onClick={() => wrap('**', '**', 'bold')} />
        <Btn label="I"  title="Italic (⌘I)" onClick={() => wrap('*', '*', 'italic')} />
        <Btn label="S"  title="Strikethrough" onClick={() => wrap('~~', '~~', 'strike')} />
        <span className="w-px h-5 bg-vs-border mx-1" />
        <Btn label="• List"   title="Bulleted list"   onClick={() => prefixLines('- ')} />
        <Btn label="1. List"  title="Numbered list"   onClick={() => prefixLines(i => `${i + 1}. `)} />
        <Btn label="☑"        title="Task list"       onClick={() => prefixLines('- [ ] ')} />
        <Btn label="❝"        title="Quote"           onClick={() => prefixLines('> ')} />
        <span className="w-px h-5 bg-vs-border mx-1" />
        <Btn label="</>" title="Inline code (⌘E)" onClick={() => wrap('`', '`', 'code')} />
        <Btn label="{ }" title="Code block"       onClick={() => wrap('\n```\n', '\n```\n', 'code')} />
        <Btn label="🔗"  title="Link (⌘K)"        onClick={insertLink} />
        <Btn label="🖼"  title="Image"            onClick={insertImage} />
        <Btn label="―"  title="Horizontal rule"  onClick={() => wrap('\n\n---\n\n')} />

        {/* Tab switcher */}
        <div className="ml-auto flex items-center gap-0.5 bg-vs-bg rounded border border-vs-border p-0.5">
          {(['write','split','preview'] as const).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`px-2 py-0.5 text-xs rounded ${tab === t ? 'bg-vs-accent text-white' : 'text-vs-mute hover:text-vs-text'}`}
            >{t[0].toUpperCase() + t.slice(1)}</button>
          ))}
        </div>
      </div>

      {/* Panes */}
      <div className={`${tab === 'split' ? 'grid grid-cols-2 divide-x divide-vs-border' : ''}`}>
        {(tab === 'write' || tab === 'split') && (
          <textarea
            ref={ref}
            value={value}
            onChange={e => onChange(e.target.value)}
            onKeyDown={onKey}
            placeholder={placeholder}
            spellCheck
            className="w-full bg-vs-bg text-vs-text p-3 text-sm font-mono focus:outline-none resize-y"
            style={{ minHeight }}
          />
        )}
        {(tab === 'preview' || tab === 'split') && (
          <div className="p-3 overflow-auto bg-vs-sidebar" style={{ minHeight }}>
            {value.trim()
              ? <Markdown source={value} />
              : <div className="text-xs text-vs-mute">Nothing to preview yet.</div>}
          </div>
        )}
      </div>
    </div>
  )
}
