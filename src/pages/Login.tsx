import { FormEvent, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { CAMPUSES, SECTIONS, SEMESTERS } from '../lib/types'

type Mode = 'signin' | 'signup' | 'forgot'

export default function Login() {
  const { session, loading } = useAuth()
  const [mode, setMode] = useState<Mode>('signin')

  // Shared
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  // Signup extras
  const [fullName, setFullName] = useState('')
  const [uid, setUid] = useState('')
  const [campus, setCampus] = useState('')
  const [semester, setSemester] = useState('')
  const [section, setSection] = useState('')

  const [err, setErr] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [resending, setResending] = useState(false)

  if (!loading && session) return <Navigate to="/" replace />

  function switchMode(next: Mode) {
    setMode(next); setErr(null); setInfo(null); setSentTo(null)
  }

  // ---------- Post-signup / forgot "check your email" screen ----------
  if (sentTo) {
    async function resend() {
      setResending(true); setErr(null); setInfo(null)
      if (mode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(sentTo!, {
          redirectTo: `${window.location.origin}/reset-password`,
        })
        setResending(false)
        if (error) setErr(error.message)
        else setInfo('Reset email resent.')
      } else {
        const { error } = await supabase.auth.resend({ type: 'signup', email: sentTo! })
        setResending(false)
        if (error) setErr(error.message)
        else setInfo('Verification email resent.')
      }
    }
    return (
      <div className="min-h-screen grid place-items-center p-6">
        <div className="card w-full max-w-md space-y-4 text-center">
          <div className="text-4xl">📬</div>
          <h1 className="text-lg font-semibold">Check your email</h1>
          <p className="text-sm text-vs-mute">
            We sent a {mode === 'forgot' ? 'password reset' : 'verification'} link to{' '}
            <span className="text-vs-text font-mono">{sentTo}</span>.
          </p>
          <p className="text-xs text-vs-mute">
            Didn't get it? Check your spam folder, or
            <button onClick={resend} disabled={resending}
              className="text-vs-accent hover:underline disabled:opacity-50 ml-1">
              {resending ? 'resending…' : 'resend the email'}
            </button>.
          </p>
          {info && <div className="text-xs text-emerald-300">{info}</div>}
          {err && <div className="text-xs text-amber-300">{err}</div>}
          <button type="button" onClick={() => switchMode('signin')} className="btn-ghost w-full">
            Back to sign in
          </button>
        </div>
      </div>
    )
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setErr(null); setInfo(null); setBusy(true)

    if (mode === 'signin') {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      setBusy(false)
      if (error) setErr(error.message)
      return
    }

    if (mode === 'forgot') {
      const redirectTo = `${window.location.origin}/reset-password`
      // eslint-disable-next-line no-console
      console.log('[forgot-password] requesting reset for', email, '→', redirectTo)
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })
      setBusy(false)
      if (error) {
        // eslint-disable-next-line no-console
        console.error('[forgot-password] supabase error:', error)
        if (/sending|smtp|rate|limit/i.test(error.message)) {
          setErr(
            `${error.message}. This is a Supabase email-delivery problem, not a bug in the form. ` +
            `Check Auth → Email Templates and Auth → URL Configuration in the Supabase dashboard, ` +
            `and set up custom SMTP if you haven't (built-in email is rate-limited to ~3/hour).`
          )
        } else {
          setErr(error.message)
        }
      } else {
        setSentTo(email)
      }
      return
    }

    // signup
    if (password !== confirmPassword) {
      setBusy(false); setErr('Passwords do not match'); return
    }
    if (!fullName.trim()) {
      setBusy(false); setErr('Please enter your name'); return
    }
    const cleanUid = uid.replace(/\s+/g, '').toUpperCase()
    if (!cleanUid) {
      setBusy(false); setErr('Please enter your UID'); return
    }

    const { data, error } = await supabase.auth.signUp({
      email, password,
      options: {
        emailRedirectTo: `${window.location.origin}/`,
        data: {
          full_name: fullName.trim(),
          uid: cleanUid,
          campus: campus.trim(),
          semester: semester.trim(),
          section: section.trim(),
        },
      },
    })
    setBusy(false)
    if (error) { setErr(error.message); return }
    if (!data.session) setSentTo(email)   // Email confirmation ON
  }

  return (
    <div className="min-h-screen grid place-items-center p-6">
      <form onSubmit={submit} className="card w-full max-w-md space-y-3">
        <h1 className="text-lg font-semibold">
          Web Eval — {mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Reset password'}
        </h1>

        {mode === 'signup' && (
          <>
            <div>
              <label className="label">Full name</label>
              <input className="input" value={fullName} onChange={e => setFullName(e.target.value)} required />
            </div>
            <div>
              <label className="label">UID</label>
              <input
                className="input font-mono uppercase placeholder:normal-case placeholder:font-sans"
                value={uid}
                onChange={e => setUid(e.target.value)}
                placeholder="Your university ID"
                autoComplete="off"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label">Campus</label>
                <select className="input" value={campus} onChange={e => setCampus(e.target.value)} required>
                  <option value="">— choose —</option>
                  {CAMPUSES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Section</label>
                <select className="input" value={section} onChange={e => setSection(e.target.value)}>
                  <option value="">— choose —</option>
                  {SECTIONS.map(s => <option key={s} value={s}>{s === 'Dummy' ? 'Dummy' : `Section ${s}`}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="label">Semester</label>
              <select className="input" value={semester} onChange={e => setSemester(e.target.value)}>
                <option value="">— choose —</option>
                {SEMESTERS.map(s => <option key={s} value={s}>{s === 'Dummy' ? 'Dummy' : `Semester ${s}`}</option>)}
              </select>
            </div>
            <button
              type="button"
              className="text-[11px] text-vs-accent hover:underline"
              onClick={() => { setCampus('Dummy'); setSection('Dummy'); setSemester('Dummy') }}
            >Fill all three with Dummy</button>
          </>
        )}

        <div>
          <label className="label">Email</label>
          <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" />
        </div>

        {mode !== 'forgot' && (
          <div>
            <label className="label">Password</label>
            <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)}
              required minLength={6}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} />
          </div>
        )}

        {mode === 'signup' && (
          <div>
            <label className="label">Confirm password</label>
            <input className="input" type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
              required minLength={6} autoComplete="new-password" />
            {password && confirmPassword && password !== confirmPassword && (
              <div className="text-[11px] text-red-400 mt-1">Passwords don't match</div>
            )}
          </div>
        )}

        {err && <div className="text-red-400 text-sm">{err}</div>}
        {info && <div className="text-emerald-300 text-sm">{info}</div>}

        <button className="btn w-full" disabled={busy}>
          {busy ? '…' :
            mode === 'signin' ? 'Sign in' :
            mode === 'signup' ? 'Create account' :
            'Send reset link'}
        </button>

        {/* Mode toggles */}
        <div className="flex items-center justify-between pt-1 text-xs">
          {mode === 'signin' && (
            <>
              <button type="button" onClick={() => switchMode('signup')} className="text-vs-mute hover:text-vs-text">
                No account? <span className="text-vs-accent">Sign up</span>
              </button>
              <button type="button" onClick={() => switchMode('forgot')} className="text-vs-accent hover:underline">
                Forgot password?
              </button>
            </>
          )}
          {mode === 'signup' && (
            <button type="button" onClick={() => switchMode('signin')} className="text-vs-mute hover:text-vs-text">
              Have an account? <span className="text-vs-accent">Sign in</span>
            </button>
          )}
          {mode === 'forgot' && (
            <button type="button" onClick={() => switchMode('signin')} className="text-vs-mute hover:text-vs-text">
              ← Back to sign in
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
