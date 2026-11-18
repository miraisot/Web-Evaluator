import type { Quiz, QuizKey, QuizQuestion, QuizQuestionType } from '../lib/types'
import { newId, newQuestion, quizMaxPoints, QUESTION_TYPE_LABEL } from '../lib/quiz'
import MarkdownEditor from './MarkdownEditor'

interface Props {
  quiz: Quiz
  answerKey: QuizKey
  onChange: (quiz: Quiz, key: QuizKey) => void
}

const TYPES: QuizQuestionType[] = ['single', 'multiple', 'paragraph']

// Admin editor for quiz questions + their answer key. Pure UI: the parent
// owns the state and saves it (questions -> projects.quiz, key -> quiz_answer_keys).
export default function QuizBuilder({ quiz, answerKey, onChange }: Props) {
  const qs = quiz.questions

  function setQuestions(next: QuizQuestion[], key: QuizKey = answerKey) {
    onChange({ ...quiz, questions: next }, key)
  }
  function patch(id: string, p: Partial<QuizQuestion>) {
    setQuestions(qs.map(q => (q.id === id ? { ...q, ...p } : q)))
  }
  function add(type: QuizQuestionType) {
    setQuestions([...qs, newQuestion(type)])
  }
  function remove(id: string) {
    if (!confirm('Delete this question?')) return
    const key = { ...answerKey }
    delete key[id]
    setQuestions(qs.filter(q => q.id !== id), key)
  }
  function duplicate(q: QuizQuestion) {
    const idMap = new Map(q.options.map(o => [o.id, newId('o')]))
    const copy: QuizQuestion = {
      ...q,
      id: newId('q'),
      options: q.options.map(o => ({ id: idMap.get(o.id)!, text: o.text })),
    }
    const k = answerKey[q.id]
    const key = k
      ? { ...answerKey, [copy.id]: { ...k, correct: (k.correct || []).map(id => idMap.get(id)!).filter(Boolean) } }
      : answerKey
    const i = qs.findIndex(x => x.id === q.id)
    setQuestions([...qs.slice(0, i + 1), copy, ...qs.slice(i + 1)], key)
  }
  function move(id: string, dir: -1 | 1) {
    const i = qs.findIndex(q => q.id === id)
    const j = i + dir
    if (j < 0 || j >= qs.length) return
    const next = [...qs]
    ;[next[i], next[j]] = [next[j], next[i]]
    setQuestions(next)
  }
  function changeType(q: QuizQuestion, type: QuizQuestionType) {
    if (type === q.type) return
    const key = { ...answerKey }
    if (type === 'paragraph') {
      delete key[q.id]
      setQuestions(qs.map(x => (x.id === q.id ? { ...x, type, options: [] } : x)), key)
      return
    }
    const options = q.options.length ? q.options : newQuestion(type).options
    // Single choice keeps at most one correct option.
    const correct = (key[q.id]?.correct || []).slice(0, type === 'single' ? 1 : undefined)
    key[q.id] = { correct }
    setQuestions(qs.map(x => (x.id === q.id ? { ...x, type, options } : x)), key)
  }
  function toggleCorrect(q: QuizQuestion, optionId: string) {
    const cur = answerKey[q.id]?.correct || []
    const correct = q.type === 'single'
      ? [optionId]
      : cur.includes(optionId) ? cur.filter(x => x !== optionId) : [...cur, optionId]
    onChange(quiz, { ...answerKey, [q.id]: { ...answerKey[q.id], correct } })
  }
  function setModelAnswer(q: QuizQuestion, text: string) {
    onChange(quiz, { ...answerKey, [q.id]: { model_answer: text } })
  }
  function addOption(q: QuizQuestion) {
    patch(q.id, { options: [...q.options, { id: newId('o'), text: '' }] })
  }
  function setOptionText(q: QuizQuestion, optionId: string, text: string) {
    patch(q.id, { options: q.options.map(o => (o.id === optionId ? { ...o, text } : o)) })
  }
  function removeOption(q: QuizQuestion, optionId: string) {
    const key = answerKey[q.id]
      ? { ...answerKey, [q.id]: { ...answerKey[q.id], correct: (answerKey[q.id].correct || []).filter(x => x !== optionId) } }
      : answerKey
    setQuestions(qs.map(x => (x.id === q.id ? { ...x, options: x.options.filter(o => o.id !== optionId) } : x)), key)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 text-sm">
        <span className="text-vs-mute">
          {qs.length} question{qs.length === 1 ? '' : 's'} · {quizMaxPoints(quiz)} point{quizMaxPoints(quiz) === 1 ? '' : 's'}
        </span>
      </div>

      {qs.length === 0 && (
        <div className="text-sm text-vs-mute border border-dashed border-vs-border rounded p-6 text-center">
          No questions yet. Add one below.
        </div>
      )}

      {qs.map((q, i) => {
        const correct = answerKey[q.id]?.correct || []
        return (
          <div key={q.id} className="border border-vs-border rounded p-4 space-y-3 bg-vs-bg/40">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-sm">Q{i + 1}</span>
              <select
                className="input !w-auto text-xs"
                value={q.type}
                onChange={e => changeType(q, e.target.value as QuizQuestionType)}
              >
                {TYPES.map(t => <option key={t} value={t}>{QUESTION_TYPE_LABEL[t]}</option>)}
              </select>
              <label className="flex items-center gap-1 text-xs text-vs-mute">
                Points
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  className="input !w-20 text-xs"
                  value={q.points}
                  onChange={e => patch(q.id, { points: Math.max(0, Number(e.target.value) || 0) })}
                />
              </label>
              <div className="ml-auto flex items-center gap-1 text-xs">
                <button type="button" className="btn-ghost !px-2 !py-1" onClick={() => move(q.id, -1)} disabled={i === 0} title="Move up">↑</button>
                <button type="button" className="btn-ghost !px-2 !py-1" onClick={() => move(q.id, 1)} disabled={i === qs.length - 1} title="Move down">↓</button>
                <button type="button" className="btn-ghost !px-2 !py-1" onClick={() => duplicate(q)} title="Duplicate">⧉</button>
                <button type="button" className="btn-ghost !px-2 !py-1 text-red-400" onClick={() => remove(q.id)} title="Delete">✕</button>
              </div>
            </div>

            <MarkdownEditor
              value={q.prompt}
              onChange={v => patch(q.id, { prompt: v })}
              placeholder={q.type === 'paragraph'
                ? 'Explain the difference between let, const and var.'
                : 'Which HTML tag is used for the largest heading?'}
              minHeight={90}
            />

            {q.type === 'paragraph' ? (
              <div>
                <label className="label">Model answer / grading notes (graders only)</label>
                <textarea
                  className="input text-sm"
                  rows={3}
                  value={answerKey[q.id]?.model_answer ?? ''}
                  onChange={e => setModelAnswer(q, e.target.value)}
                  placeholder="Key points a full-marks answer should cover…"
                />
                <div className="text-[11px] text-vs-mute mt-1">Students type a free-text answer. Gemini scores it against this model answer when they submit (partial marks allowed); you can check and change the score in Submissions. A clear model answer gives better AI scores.</div>
              </div>
            ) : (
              <div className="space-y-1.5">
                <div className="text-[11px] text-vs-mute">
                  {q.type === 'single'
                    ? 'Select the one correct option.'
                    : 'Tick every correct option. Students get the points only if they pick exactly these.'}
                </div>
                {q.options.map((o, oi) => (
                  <div key={o.id} className="flex items-center gap-2">
                    <input
                      type={q.type === 'single' ? 'radio' : 'checkbox'}
                      name={`correct-${q.id}`}
                      checked={correct.includes(o.id)}
                      onChange={() => toggleCorrect(q, o.id)}
                      title="Correct answer"
                      className="accent-emerald-500"
                    />
                    <span className="text-xs text-vs-mute w-4">{String.fromCharCode(65 + oi)}</span>
                    <input
                      className={`input text-sm ${correct.includes(o.id) ? '!border-emerald-600' : ''}`}
                      value={o.text}
                      onChange={e => setOptionText(q, o.id, e.target.value)}
                      placeholder={`Option ${String.fromCharCode(65 + oi)}`}
                    />
                    <button
                      type="button"
                      className="text-xs text-vs-mute hover:text-red-400 px-1"
                      onClick={() => removeOption(q, o.id)}
                      disabled={q.options.length <= 2}
                      title={q.options.length <= 2 ? 'At least 2 options' : 'Remove option'}
                    >✕</button>
                  </div>
                ))}
                <button type="button" className="text-xs text-vs-accent hover:underline" onClick={() => addOption(q)}>+ option</button>
              </div>
            )}
          </div>
        )
      })}

      <div className="flex flex-wrap gap-2">
        {TYPES.map(t => (
          <button key={t} type="button" className="btn-ghost text-sm" onClick={() => add(t)}>
            + {QUESTION_TYPE_LABEL[t]}
          </button>
        ))}
      </div>
    </div>
  )
}
