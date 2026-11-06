// External Link Submission mode — rendered by `src/pages/Solve.tsx`
// when the project's project_type is 'external_link'. Students build
// their MERN (or any) project outside the platform, deploy it, and
// submit a GitHub repository URL + a deployed URL + optional notes.
// The platform never executes their code.

import { useEffect, useState } from 'react'
import Markdown from './Markdown'

export interface ExternalLinkDraft {
  repo_url: string
  deployed_url: string
  notes: string
}

export const EMPTY_LINK_DRAFT: ExternalLinkDraft = {
  repo_url: '',
  deployed_url: '',
  notes: '',
}

// Loose URL validators — mirror the DB constraint that only requires
// `repo_url` to be present for an external_link submission.
export function isHttpUrl(s: string) {
  try {
    const u = new URL(s.trim())
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

export function isGithubUrl(s: string) {
  try {
    const u = new URL(s.trim())
    return (u.protocol === 'http:' || u.protocol === 'https:')
      && /(^|\.)github\.com$/i.test(u.hostname)
  } catch {
    return false
  }
}

interface Props {
  problemStatement: string
  value: ExternalLinkDraft
  onChange: (v: ExternalLinkDraft) => void
  disabled?: boolean
}

export default function ExternalLinkMode({ problemStatement, value, onChange, disabled }: Props) {
  const [touched, setTouched] = useState({ repo: false, deployed: false })
  // Live-validate so the submit button in the parent header can be gated
  // on `isValid` if desired; here we only surface inline hints.
  useEffect(() => {
    // nothing to do; validators are pure
  }, [value])

  const repoOk = isGithubUrl(value.repo_url)
  const deployedOk = !value.deployed_url || isHttpUrl(value.deployed_url)

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-3xl mx-auto p-6 space-y-6">
        <div>
          <div className="text-xs uppercase tracking-wide text-vs-mute mb-2">Problem statement</div>
          <div className="card">
            {problemStatement
              ? <Markdown source={problemStatement} />
              : <div className="text-vs-mute text-sm">No description provided.</div>}
          </div>
        </div>

        <div className="card space-y-4">
          <div>
            <div className="font-medium">Your submission</div>
            <div className="text-xs text-vs-mute">
              Build the project outside this platform (local, Replit, Codespaces…),
              deploy it (Vercel / Render / Railway) and paste the links below.
            </div>
          </div>

          <div>
            <label className="label">
              GitHub repository URL <span className="text-red-400">*</span>
            </label>
            <input
              className="input"
              placeholder="https://github.com/your-username/your-repo"
              value={value.repo_url}
              onChange={e => onChange({ ...value, repo_url: e.target.value })}
              onBlur={() => setTouched(t => ({ ...t, repo: true }))}
              disabled={disabled}
              required
            />
            {touched.repo && value.repo_url && !repoOk && (
              <div className="text-xs text-red-400 mt-1">
                Must be a valid https URL on github.com.
              </div>
            )}
          </div>

          <div>
            <label className="label">Deployed URL</label>
            <input
              className="input"
              placeholder="https://your-app.vercel.app"
              value={value.deployed_url}
              onChange={e => onChange({ ...value, deployed_url: e.target.value })}
              onBlur={() => setTouched(t => ({ ...t, deployed: true }))}
              disabled={disabled}
            />
            {touched.deployed && value.deployed_url && !deployedOk && (
              <div className="text-xs text-red-400 mt-1">
                Must be a valid http(s) URL.
              </div>
            )}
            <div className="text-[11px] text-vs-mute mt-1">
              Optional but strongly recommended &mdash; your instructor can open and test the app directly.
            </div>
          </div>

          <div>
            <label className="label">Notes for your instructor (optional)</label>
            <textarea
              className="input min-h-[120px]"
              placeholder="Anything you'd like the reviewer to know &mdash; test credentials, known issues, which commit to grade…"
              value={value.notes}
              onChange={e => onChange({ ...value, notes: e.target.value })}
              disabled={disabled}
            />
          </div>

          <div className="text-[11px] text-vs-mute leading-relaxed border-t border-vs-border pt-3">
            Your draft is saved locally in your browser. Click <span className="text-vs-text">Submit</span>
            in the top bar when you&rsquo;re ready. Only one submission per assignment is allowed.
          </div>
        </div>
      </div>
    </div>
  )
}
