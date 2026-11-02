import { supabase } from './supabase'

export type GradeResult = {
  scores: Record<string, number>
  feedback_by_criterion: Record<string, string>
  total: number
  max_total: number
}

export async function gradeSubmission(opts: {
  submissionId: string
  gradedBy?: string | null
}): Promise<GradeResult> {
  const { data, error } = await supabase.functions.invoke('grade-submission', {
    body: { submission_id: opts.submissionId, graded_by: opts.gradedBy ?? null },
  })
  if (error) {
    const err: Error & { status?: number } = new Error(error.message || 'Grade function failed')
    const ctx = (error as unknown as { context?: Response }).context
    if (ctx?.status) err.status = ctx.status
    throw err
  }
  const body = data as { ok?: boolean; error?: string; status?: number; total?: number; max_total?: number; scores?: Record<string, number>; feedback_by_criterion?: Record<string, string> }
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
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}
