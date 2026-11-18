import { supabase } from './supabase'

export type GradeResult = {
  scores: Record<string, number>
  feedback_by_criterion: Record<string, string>
  total: number
  max_total: number
  /** Quiz only: paragraph answers still without a score. */
  pending_manual?: number
  /** Quiz only: how many paragraph answers Gemini scored in this call. */
  ai_graded?: number
}

/** feedback_by_criterion key listing quiz question ids scored by Gemini. */
export const AI_MARK_KEY = '__ai'

export function aiGradedIds(notes: Record<string, string> | null | undefined): Set<string> {
  return new Set((notes?.[AI_MARK_KEY] || '').split(',').filter(Boolean))
}

export async function gradeSubmission(opts: {
  submissionId: string
  gradedBy?: string | null
  /** Quiz: re-score paragraph answers Gemini already scored (never a faculty grade). */
  force?: boolean
}): Promise<GradeResult> {
  const { data, error } = await supabase.functions.invoke('grade-submission', {
    body: { submission_id: opts.submissionId, graded_by: opts.gradedBy ?? null, force: opts.force ?? false },
  })
  if (error) {
    const err: Error & { status?: number } = new Error(error.message || 'Grade function failed')
    const ctx = (error as unknown as { context?: Response }).context
    if (ctx?.status) err.status = ctx.status
    throw err
  }
  const body = data as { ok?: boolean; error?: string; status?: number; total?: number; max_total?: number; scores?: Record<string, number>; feedback_by_criterion?: Record<string, string>; pending_manual?: number; ai_graded?: number }
  if (!body?.ok) {
    const err: Error & { status?: number } = new Error(body?.error || 'Grade function returned no ok')
    if (typeof body?.status === 'number') err.status = body.status
    throw err
  }
  return {
    scores: body.scores || {},
    feedback_by_criterion: body.feedback_by_criterion || {},
    total: body.total ?? 0,
    max_total: body.max_total ?? 0,
    pending_manual: body.pending_manual,
    ai_graded: body.ai_graded,
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}
