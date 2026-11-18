import { useRef } from 'react'
import type { FileMap, Quiz } from '../lib/types'
import { decodeChoice, encodeChoice, hasNegativeMarking, isAnswered, negativeMarks, quizMaxPoints, QUESTION_TYPE_LABEL } from '../lib/quiz'
import Markdown from './Markdown'

interface Props {
  title: string
  instructions: string
  quiz: Quiz
  answers: FileMap
  onChange: (questionId: string, value: string) => void
  disabled?: boolean
}

// Student view of a quiz. Answers are a FileMap keyed by question id, so the
// Solve page's autosave / submit / auto-collect work unchanged.
export default function QuizTaker({ title, instructions, quiz, answers, onChange, disabled }: Props) {
  const refs = useRef<Record<string, HTMLDivElement | null>>({})
  const answered = quiz.questions.filter(q => isAnswered(q, answers)).length
  const total = quiz.questions.length

  function jump(id: string) {
    refs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="flex-1 flex min-h-0">
      {/* Question navigator */}
      <aside className="hidden md:flex w-56 shrink-0 border-r border-vs-border bg-vs-sidebar flex-col min-h-0">
        <div className="px-3 pt-3 pb-2 text-xs uppercase tracking-wide text-vs-mute">
          Questions · {answered}/{total} answered
        </div>
        <div className="px-3 pb-3 grid grid-cols-5 gap-1.5 overflow-auto">
          {quiz.questions.map((q, i) => (
            <button
              key={q.id}
              onClick={() => jump(q.id)}
              className={`h-8 rounded text-xs border ${isAnswered(q, answers)
                ? 'bg-emerald-900/40 border-emerald-700 text-emerald-200'
                : 'border-vs-border text-vs-mute hover:text-vs-text'}`}
              title={`Q${i + 1} · ${QUESTION_TYPE_LABEL[q.type]}`}
            >{i + 1}</button>
          ))}
        </div>
        <div className="mt-auto px-3 py-3 border-t border-vs-border text-[11px] text-vs-mute leading-relaxed">
          Answers save automatically. Multiple-choice questions score only when you pick every correct option and nothing else.
          {hasNegativeMarking(quiz) && <> Questions marked <span className="text-red-300">−</span> lose marks for a wrong answer; leaving them blank costs nothing.</>}
        </div>
      </aside>

      <main className="flex-1 min-w-0 overflow-auto">
        <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
          <div className="space-y-2">
            <h1 className="text-lg font-semibold">{title}</h1>
            <div className="text-xs text-vs-mute">
              {total} question{total === 1 ? '' : 's'} · {quizMaxPoints(quiz)} points
              {hasNegativeMarking(quiz) && <span className="text-red-300"> · negative marking on some questions</span>}
            </div>
            {instructions.trim() && <Markdown source={instructions} />}
          </div>

          {total === 0 && <div className="card text-sm text-vs-mute">This quiz has no questions yet.</div>}

          {quiz.questions.map((q, i) => {
            const chosen = decodeChoice(answers[q.id])
            return (
              <div
                key={q.id}
                ref={el => { refs.current[q.id] = el }}
                className="card space-y-3 scroll-mt-4"
              >
                <div className="flex items-center gap-2 text-xs text-vs-mute">
                  <span className="font-semibold text-vs-text text-sm">Q{i + 1}.</span>
                  <span>{QUESTION_TYPE_LABEL[q.type]}</span>
                  {q.type === 'multiple' && <span>· select all that apply</span>}
                  <span className="ml-auto">
                    {q.points} pt{q.points === 1 ? '' : 's'}
                    {negativeMarks(q) > 0 && (
                      <span className="text-red-300" title="Marks taken off for a wrong answer. Leaving it blank costs nothing."> · −{negativeMarks(q)} if wrong</span>
                    )}
                  </span>
                </div>
                <Markdown source={q.prompt} className="prose-md-lg" />

                {q.type === 'paragraph' ? (
                  <div>
                    <textarea
                      className="input text-sm leading-relaxed"
                      rows={6}
                      value={answers[q.id] ?? ''}
                      onChange={e => onChange(q.id, e.target.value)}
                      disabled={disabled}
                      placeholder="Type your answer…"
                    />
                    <div className="text-[11px] text-vs-mute mt-1 text-right">
                      {(answers[q.id] || '').trim().split(/\s+/).filter(Boolean).length} words
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {q.options.map((o, oi) => {
                      const on = chosen.includes(o.id)
                      return (
                        <label
                          key={o.id}
                          className={`flex items-start gap-3 rounded border px-3 py-2 text-sm cursor-pointer transition-colors ${on
                            ? 'border-vs-accent bg-vs-accent/10 text-vs-text'
                            : 'border-vs-border hover:bg-vs-panel'} ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
                        >
                          <input
                            type={q.type === 'single' ? 'radio' : 'checkbox'}
                            name={`q-${q.id}`}
                            className="mt-1"
                            checked={on}
                            disabled={disabled}
                            onChange={() => {
                              if (q.type === 'single') onChange(q.id, o.id)
                              else onChange(q.id, encodeChoice(on ? chosen.filter(x => x !== o.id) : [...chosen, o.id]))
                            }}
                          />
                          <span className="text-vs-mute w-4 shrink-0">{String.fromCharCode(65 + oi)}.</span>
                          <span className="whitespace-pre-wrap break-words">{o.text}</span>
                        </label>
                      )
                    })}
                    {chosen.length > 0 && !disabled && (
                      <button
                        className="text-[11px] text-vs-mute hover:text-vs-text"
                        onClick={() => onChange(q.id, '')}
                      >Clear selection</button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </main>
    </div>
  )
}
