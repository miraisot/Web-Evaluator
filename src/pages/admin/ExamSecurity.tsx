import { FormEvent, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { SebConfig } from '../../lib/types'
import ExamActivity from '../../components/ExamActivity'
import { parseCidrList } from '../../lib/cidr'

const HEX64 = /^[0-9a-f]{64}$/

// Safe Exam Browser configs (one per hand-out .seb file) and live exam
// activity. An assignment linked to a config can only be taken in SEB started
// with exactly that .seb file (Admin → Assignments → "Safe Exam Browser").
export default function ExamSecurity() {
  const [configs, setConfigs] = useState<SebConfig[]>([])
  const [usage, setUsage] = useState<Record<string, number>>({})
  const [name, setName] = useState('')
  const [configKey, setConfigKey] = useState('')
  const [beks, setBeks] = useState('')
  const [nets, setNets] = useState('')
  const [editNets, setEditNets] = useState<{ id: string; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  async function load() {
    const { data } = await supabase.from('seb_configs').select('*').order('created_at', { ascending: false })
    const list = (data as SebConfig[]) || []
    setConfigs(list)
    const counts: Record<string, number> = {}
    await Promise.all(list.map(async c => {
      const { count } = await supabase.from('assignments').select('id', { count: 'exact', head: true }).eq('seb_config_id', c.id)
      counts[c.id] = count || 0
    }))
    setUsage(counts)
  }
  useEffect(() => { void load() }, [])

  async function add(e: FormEvent) {
    e.preventDefault()
    const keys = [...new Set(configKey.split(/[\s,;]+/).map(s => s.trim().toLowerCase()).filter(Boolean))]
    if (!keys.length) return alert('Paste at least one Config Key.')
    const badKey = keys.find(k => !HEX64.test(k))
    if (badKey) return alert(`Not a Config Key (64 hexadecimal characters, copy it from the SEB config tool): ${badKey}`)
    const bekList = [...new Set(beks.split(/[\s,;]+/).map(s => s.trim().toLowerCase()).filter(Boolean))]
    const bad = bekList.find(k => !HEX64.test(k))
    if (bad) return alert(`Not a Browser Exam Key (64 hex characters): ${bad}`)
    const netList = parseCidrList(nets)
    if (netList.errors.length) return alert(`Allowed networks:\n${netList.errors.join('\n')}`)
    setBusy(true)
    const { error } = await supabase.from('seb_configs').insert({
      name: name.trim() || 'Exam', config_keys: keys, browser_exam_keys: bekList, allowed_ip_ranges: netList.cidrs,
    })
    setBusy(false)
    if (error) return alert(error.message)
    setName(''); setConfigKey(''); setBeks(''); setNets('')
    void load()
  }

  async function saveNets() {
    if (!editNets) return
    const netList = parseCidrList(editNets.text)
    if (netList.errors.length) return alert(`Allowed networks:\n${netList.errors.join('\n')}`)
    const { error } = await supabase.from('seb_configs').update({ allowed_ip_ranges: netList.cidrs }).eq('id', editNets.id)
    if (error) return alert(error.message)
    setEditNets(null)
    void load()
  }

  async function remove(c: SebConfig) {
    if (usage[c.id]) return alert(`${usage[c.id]} assignment(s) use this config. Change them to another config (or "not required") first.`)
    if (!confirm(`Delete the config "${c.name}"?`)) return
    const { error } = await supabase.from('seb_configs').delete().eq('id', c.id)
    if (error) return alert(error.message)
    void load()
  }

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <form onSubmit={add} className="card space-y-3 h-fit">
          <h2 className="font-semibold">Add a Safe Exam Browser config</h2>
          <p className="text-[11px] text-vs-mute">
            Build the hand-out .seb from <code>seb/web-eval-exam.template.seb</code> with a new exam key salt,
            save it, then copy its <b>Config Key</b> from the config tool (Exam section) here. See <code>seb/README.md</code>.
          </p>
          <div>
            <label className="label">Name</label>
            <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="WEB 301 End-Sem, Dec 2026" />
          </div>
          <div>
            <label className="label">Config Key(s)</label>
            <textarea className="input min-h-[70px] font-mono text-xs" value={configKey} onChange={e => setConfigKey(e.target.value)}
              placeholder="64 hex characters. One per line if you hand out more than one .seb variant (e.g. Windows and macOS)." required />
          </div>
          <div>
            <label className="label">Allowed Browser Exam Keys (optional)</label>
            <textarea className="input min-h-[70px] font-mono text-xs" value={beks} onChange={e => setBeks(e.target.value)}
              placeholder="One per line. Leave empty to accept any SEB version." />
            <div className="text-[11px] text-vs-mute mt-1">Pins exact SEB versions/builds. The key differs per SEB version and OS.</div>
          </div>
          <div>
            <label className="label">Allowed networks (optional)</label>
            <textarea className="input min-h-[70px] font-mono text-xs" value={nets} onChange={e => setNets(e.target.value)}
              placeholder={'Public IP / range of the exam-room Wi-Fi, one per line, e.g.\n203.0.113.0/24\n2001:db8:42::/48'} />
            <div className="text-[11px] text-vs-mute mt-1">
              Leave empty to allow any network. When set, the exam can only be started from these addresses
              (not from home or a phone hotspot). See <code>seb/README.md</code> → "Allowed networks".
            </div>
          </div>
          <button className="btn w-full" disabled={busy}>{busy ? '…' : 'Add config'}</button>
        </form>

        <div className="md:col-span-2 space-y-3">
          <h2 className="font-semibold">Safe Exam Browser configs</h2>
          {configs.length === 0 && <div className="text-sm text-vs-mute">None yet. Exams don't require Safe Exam Browser until you add a config and link assignments to it.</div>}
          {configs.map(c => (
            <div key={c.id} className="card flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="text-sm font-medium">{c.name}</div>
                <div className="text-xs text-vs-mute font-mono truncate">
                  Config Key{c.config_keys.length > 1 ? 's' : ''} {c.config_keys.map(k => `${k.slice(0, 12)}…`).join(', ')}
                </div>
                <div className="text-xs text-vs-mute">
                  {c.browser_exam_keys.length ? `${c.browser_exam_keys.length} allowed Browser Exam Key(s)` : 'Any SEB version'}
                  {' · '}{usage[c.id] ?? 0} assignment(s)
                </div>
                {editNets?.id === c.id ? (
                  <div className="mt-2 space-y-2">
                    <textarea className="input min-h-[60px] font-mono text-xs" value={editNets.text} autoFocus
                      onChange={e => setEditNets({ id: c.id, text: e.target.value })}
                      placeholder="One IP / range per line. Empty = any network." />
                    <div className="flex gap-2">
                      <button className="btn text-xs" onClick={() => void saveNets()}>Save networks</button>
                      <button className="btn-ghost text-xs" onClick={() => setEditNets(null)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-vs-mute font-mono break-all">
                    {(c.allowed_ip_ranges ?? []).length
                      ? <>Networks: {c.allowed_ip_ranges.join(', ')}</>
                      : <span className="font-sans">Any network</span>}
                  </div>
                )}
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                {editNets?.id !== c.id && (
                  <button className="btn-ghost text-xs" onClick={() => setEditNets({ id: c.id, text: (c.allowed_ip_ranges ?? []).join('\n') })}>Edit networks</button>
                )}
                <button className="btn-ghost text-red-400" onClick={() => void remove(c)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h2 className="font-semibold mb-3">Exam activity</h2>
        <ExamActivity />
      </div>
    </div>
  )
}
