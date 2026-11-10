import Editor from '@monaco-editor/react'

const langForFile = (name: string) => {
  if (name.endsWith('.html')) return 'html'
  if (name.endsWith('.css')) return 'css'
  if (name.endsWith('.jsx') || name.endsWith('.tsx')) return 'typescript'
  if (name.endsWith('.ts')) return 'typescript'
  if (name.endsWith('.js') || name.endsWith('.mjs')) return 'javascript'
  if (name.endsWith('.json')) return 'json'
  if (name.endsWith('.md')) return 'markdown'
  return 'plaintext'
}

export default function CodeEditor({
  file, value, onChange, readOnly,
}: {
  file: string
  value: string
  onChange?: (v: string) => void
  readOnly?: boolean
}) {
  return (
    <Editor
      height="100%"
      theme="vs-dark"
      language={langForFile(file)}
      path={file}
      value={value}
      onChange={(v) => onChange?.(v ?? '')}
      options={{
        fontSize: 13,
        minimap: { enabled: false },
        tabSize: 2,
        wordWrap: 'on',
        scrollBeyondLastLine: false,
        automaticLayout: true,
        readOnly: !!readOnly,
      }}
    />
  )
}
