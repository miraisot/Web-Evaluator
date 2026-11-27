import { supabase } from './supabase'
import { forgetExamTokens } from './examSession'

// Must match `quitURL` in seb/web-eval-exam.template.seb. When Safe Exam
// Browser is asked to load this URL it quits by itself, so students never
// need the quit password.
export const EXAM_DONE_PATH = '/exam/done'

// SEB adds "SEB/<version>" to its user agent and, when the Browser Exam Key is
// on, exposes window.SafeExamBrowser. This is for UX only (deciding whether to
// close SEB after submit) — it is NOT a security check; anyone can fake it.
export function inSafeExamBrowser(): boolean {
  if (typeof window === 'undefined') return false
  return 'SafeExamBrowser' in window || /\bSEB\//.test(navigator.userAgent)
}

// Sign out on this device only, then load the quit URL so SEB closes.
export async function exitExam() {
  forgetExamTokens()
  try { await supabase.auth.signOut({ scope: 'local' }) } catch { /* quitting anyway */ }
  window.location.assign(EXAM_DONE_PATH)
}
