import { inSafeExamBrowser } from '../lib/seb'

// The SEB quit URL. With a .seb file built from seb/web-eval-exam.template.seb,
// Safe Exam Browser quits as soon as this page is requested, so it never shows.
// If it does show inside SEB, the file is outdated (no quitURL): the student
// can't close SEB themselves, so tell them to call the invigilator.
export default function ExamDone() {
  const stuckInSeb = inSafeExamBrowser()
  return (
    <div className="min-h-screen grid place-items-center p-6">
      <div className="card max-w-md text-center space-y-3">
        <div className="text-4xl">✓</div>
        <h1 className="text-lg font-semibold">Exam finished</h1>
        <p className="text-sm text-vs-mute">Your work has been submitted.</p>
        {stuckInSeb ? (
          <div className="rounded border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200 space-y-1">
            <p className="font-semibold">Raise your hand: the invigilator will close Safe Exam Browser.</p>
            <p className="text-xs text-amber-200/80">Stay in your seat. Your work is already saved.</p>
          </div>
        ) : (
          <p className="text-sm text-vs-mute">You can close this window.</p>
        )}
      </div>
    </div>
  )
}
