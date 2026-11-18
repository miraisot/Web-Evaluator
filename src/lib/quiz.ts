import type { FileMap, Quiz, QuizKey, QuizQuestion, QuizQuestionType } from './types'

// Answers are stored as a FileMap (question id -> string) so quizzes reuse
// the same drafts / autosave / submission / auto-collect pipeline as code:
//   single    -> "<optionId>"
//   multiple  -> "<optionId>,<optionId>"   (sorted, no spaces)
//   paragraph -> the text itself
// supabase/migration_quiz.sql grades with the same encoding.

export function newId(prefix = ''): string {
  return prefix + Math.random().toString(36).slice(2, 10)
}

export function emptyQuiz(): Quiz {
  return { questions: [] }
}

export function normalizeQuiz(q: Quiz | null | undefined): Quiz {
  return { questions: Array.isArray(q?.questions) ? q!.questions : [] }
}

export function newQuestion(type: QuizQuestionType): QuizQuestion {
  return {
    id: newId('q'),
    type,
    prompt: '',
    points: 1,
    options: type === 'paragraph' ? [] : [
      { id: newId('o'), text: '' },
      { id: newId('o'), text: '' },
      { id: newId('o'), text: '' },
      { id: newId('o'), text: '' },
    ],
  }
}

export function decodeChoice(raw: string | undefined): string[] {
  return (raw || '').split(',').filter(Boolean)
}

export function encodeChoice(ids: string[]): string {
  return [...new Set(ids)].sort().join(',')
}

export function isAnswered(q: QuizQuestion, answers: FileMap): boolean {
  const raw = answers[q.id]
  if (q.type === 'paragraph') return !!raw && raw.trim().length > 0
  return decodeChoice(raw).length > 0
}

export function quizMaxPoints(quiz: Quiz): number {
  return quiz.questions.reduce((n, q) => n + (Number(q.points) || 0), 0)
}

/**
 * Auto score for one choice question (mirror of the SQL grader).
 * Returns null for paragraph questions: those need a human.
 */
export function autoScore(q: QuizQuestion, key: QuizKey, answers: FileMap): number | null {
  if (q.type === 'paragraph') return null
  const correct = [...(key[q.id]?.correct || [])].sort()
  const given = decodeChoice(answers[q.id]).sort()
  if (correct.length === 0) return 0
  const same = correct.length === given.length && correct.every((c, i) => c === given[i])
  return same ? (Number(q.points) || 0) : 0
}

/** Problems that would make the quiz unanswerable or ungradable. */
export function validateQuiz(quiz: Quiz, key: QuizKey): string[] {
  const issues: string[] = []
  quiz.questions.forEach((q, i) => {
    const n = `Q${i + 1}`
    if (!q.prompt.trim()) issues.push(`${n}: question text is empty`)
    if (!(Number(q.points) > 0)) issues.push(`${n}: points must be more than 0`)
    if (q.type === 'paragraph') return
    if (q.options.length < 2) issues.push(`${n}: needs at least 2 options`)
    if (q.options.some(o => !o.text.trim())) issues.push(`${n}: an option is empty`)
    const correct = (key[q.id]?.correct || []).filter(id => q.options.some(o => o.id === id))
    if (q.type === 'single' && correct.length !== 1) issues.push(`${n}: mark exactly one correct option`)
    if (q.type === 'multiple' && correct.length < 1) issues.push(`${n}: mark at least one correct option`)
  })
  return issues
}

/** Drops key entries for deleted questions / options. */
export function cleanKey(quiz: Quiz, key: QuizKey): QuizKey {
  const out: QuizKey = {}
  for (const q of quiz.questions) {
    const k = key[q.id]
    if (!k) continue
    if (q.type === 'paragraph') {
      if (k.model_answer?.trim()) out[q.id] = { model_answer: k.model_answer }
    } else {
      const ids = new Set(q.options.map(o => o.id))
      const correct = (k.correct || []).filter(id => ids.has(id))
      out[q.id] = { correct: q.type === 'single' ? correct.slice(0, 1) : correct }
    }
  }
  return out
}

export const QUESTION_TYPE_LABEL: Record<QuizQuestionType, string> = {
  single: 'Single choice',
  multiple: 'Multiple choice',
  paragraph: 'Paragraph',
}
