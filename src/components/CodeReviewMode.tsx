// Code Review Mode banner — rendered inside the student editor view
// when the project's project_type is 'code_review'. The student still
// writes multi-file code in Monaco (so this component is a thin UI
// element shown in place of the live preview panel), but the platform
// does NOT execute that code. An instructor reviews the submission
// manually. See `src/pages/Solve.tsx` for how it is wired in.

export default function CodeReviewMode() {
  return (
    <div className="h-full flex flex-col bg-vs-sidebar text-vs-text">
      <div className="h-8 shrink-0 border-b border-vs-border bg-vs-sidebar flex items-center px-3 text-xs text-vs-mute">
        Code review mode
      </div>
      <div className="flex-1 overflow-auto p-5 space-y-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-vs-mute mb-2">
            How this works
          </div>
          <div className="text-sm leading-relaxed">
            This is a <span className="text-vs-text font-medium">code review</span> assignment.
            Your code is <span className="text-vs-text font-medium">not executed</span> by the
            platform &mdash; your instructor will review the files you submit manually.
          </div>
        </div>

        <div className="border border-vs-border rounded p-3 text-sm bg-vs-bg/40 space-y-2">
          <div className="text-vs-text font-medium">Checklist before submitting</div>
          <ul className="list-disc pl-5 text-vs-text/80 space-y-1 text-[13px]">
            <li>Your code is complete and runnable in a standard Node.js environment.</li>
            <li>All required files are present (e.g. <code>server.js</code>, <code>package.json</code>, routes, models).</li>
            <li>No secrets or <code>.env</code> values are hard-coded.</li>
            <li>You have added short comments where the logic is non-obvious.</li>
          </ul>
        </div>

        <div className="text-[11px] text-vs-mute leading-relaxed">
          Tip: You can create any file structure you need from the sidebar
          (<span className="text-vs-text">+ file</span> and
          <span className="text-vs-text"> + folder</span>). Monaco auto-detects the
          language from each file's extension.
        </div>
      </div>
    </div>
  )
}
