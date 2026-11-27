// Turns the per-student counters in `exam_integrity_summary` into a risk level
// with plain-language reasons. These are signals for a human to review, not
// proof of cheating. Thresholds are deliberately simple so they can be tuned
// after the first exams.

export interface IntegritySummary {
  assignment_id: string
  student_id: string
  pastes: number
  largest_paste: number
  pasted_chars: number
  large_inserts: number
  largest_insert: number
  focus_losses: number
  away_seconds: number
  longest_away_seconds: number
  copies: number
  print_screens: number
  multi_screen: boolean | null
  keystrokes: number
  active_minutes: number
  blocked_no_seb: number
  blocked_wrong_config: number
  blocked_second_device: number
  device_changes: number
  ip_changes: number
  tracked: boolean | null
  blocked_wrong_network?: number
  left_allowed_network?: number
}

export type RiskLevel = 'flagged' | 'review' | 'clean' | 'untracked'

export interface Risk { level: RiskLevel; reasons: string[] }

const secs = (s: number) => (s < 60 ? `${s} s` : `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ''}`)

export const RISK_RULES = {
  flagPasteChars: 300,
  flagInsertChars: 300,
  flagLongestAwaySec: 60,
  flagTotalAwaySec: 180,
  reviewFocusLosses: 3,
  reviewTotalAwaySec: 30,
}

export function assessRisk(s: IntegritySummary | null | undefined): Risk {
  if (!s || !s.tracked) {
    // Blocked attempts can exist without tracking (they never got in).
    if (s && (s.blocked_wrong_config || s.blocked_second_device || s.blocked_wrong_network)) {
      return { level: 'flagged', reasons: blockedReasons(s) }
    }
    return { level: 'untracked', reasons: ['No activity data (taken before tracking existed, or never opened).'] }
  }
  const flag: string[] = []
  const review: string[] = []
  const R = RISK_RULES

  if (s.largest_paste >= R.flagPasteChars) flag.push(`Pasted ${s.largest_paste} characters from outside the exam at once (${s.pastes} paste(s), ${s.pasted_chars} chars in total).`)
  else if (s.pastes > 0) review.push(`${s.pastes} paste(s) from outside the exam, ${s.pasted_chars} characters in total.`)

  if (s.largest_insert >= R.flagInsertChars) flag.push(`${s.largest_insert} characters appeared at once without typing or pasting (drag-and-drop or auto-typer).`)
  else if (s.large_inserts > 0) review.push(`${s.large_inserts} large block(s) inserted without typing.`)

  if (s.longest_away_seconds >= R.flagLongestAwaySec || s.away_seconds >= R.flagTotalAwaySec) {
    flag.push(`Left the exam window ${s.focus_losses} time(s), ${secs(s.away_seconds)} in total (longest ${secs(s.longest_away_seconds)}).`)
  } else if (s.focus_losses >= R.reviewFocusLosses || s.away_seconds >= R.reviewTotalAwaySec) {
    review.push(`Left the exam window ${s.focus_losses} time(s), ${secs(s.away_seconds)} in total.`)
  }

  flag.push(...blockedReasons(s))
  if (s.left_allowed_network) flag.push(`Switched to a network outside the exam room ${s.left_allowed_network} time(s) during the exam.`)
  if (s.blocked_no_seb) review.push(`Tried to open the exam outside Safe Exam Browser ${s.blocked_no_seb} time(s).`)
  if (s.copies) review.push(`Copied text from the exam page ${s.copies} time(s).`)
  if (s.multi_screen) review.push('A second screen was connected.')
  if (s.print_screens) review.push(`Pressed Print Screen ${s.print_screens} time(s).`)
  if (s.device_changes) review.push(`Moved to another device ${s.device_changes} time(s) during the exam.`)
  if (s.ip_changes) review.push(`Network (IP address) changed ${s.ip_changes} time(s) during the exam.`)

  if (flag.length) return { level: 'flagged', reasons: [...flag, ...review] }
  if (review.length) return { level: 'review', reasons: review }
  return { level: 'clean', reasons: [`${s.keystrokes} keystrokes over ${s.active_minutes} active minute(s); nothing unusual.`] }
}

function blockedReasons(s: IntegritySummary): string[] {
  const out: string[] = []
  if (s.blocked_wrong_config) out.push(`Tried to open the exam with a different or edited .seb file ${s.blocked_wrong_config} time(s).`)
  if (s.blocked_second_device) out.push(`Tried to open the exam on a second device ${s.blocked_second_device} time(s) while the first was active.`)
  if (s.blocked_wrong_network) out.push(`Tried to open the exam from outside the exam-room network ${s.blocked_wrong_network} time(s).`)
  return out
}

export const RISK_BADGE: Record<RiskLevel, { label: string; cls: string }> = {
  flagged:   { label: 'Flagged',     cls: 'bg-red-500/10 text-red-300 border-red-500/40' },
  review:    { label: 'Review',      cls: 'bg-amber-500/10 text-amber-300 border-amber-500/40' },
  clean:     { label: 'Clean',       cls: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' },
  untracked: { label: 'Not tracked', cls: 'border-vs-border text-vs-mute' },
}

export const summaryKey = (assignmentId: string, studentId: string) => `${assignmentId}:${studentId}`
