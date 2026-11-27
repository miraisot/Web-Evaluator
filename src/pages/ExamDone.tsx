// The SEB quit URL. Inside Safe Exam Browser this page never shows (SEB quits
// as soon as it's requested); in a normal browser it just says the exam is over.
export default function ExamDone() {
  return (
    <div className="min-h-screen grid place-items-center p-6">
      <div className="card max-w-md text-center space-y-3">
        <div className="text-4xl">✓</div>
        <h1 className="text-lg font-semibold">Exam finished</h1>
        <p className="text-sm text-vs-mute">Your work has been submitted. You can close this window.</p>
      </div>
    </div>
  )
}
