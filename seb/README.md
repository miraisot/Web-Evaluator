# Safe Exam Browser config

Two files with the same settings:

- `web-eval-exam.seb`: **the one to hand out.** Starts SEB on
  https://web-evaluator.vercel.app/, blocks every site except the ones the
  platform needs, and has a quit password. It's git-ignored: the repo is
  public and a short password can be recovered from its hash.
- `web-eval-exam.template.seb`: same settings, no quit password (tracked).
  To make a new hand-out file, open it in the SEB Config Tool (Windows) or
  SEB → Settings (macOS), set *General → Quit/unlock password*, and save.

## Exam keys and quitting (added 2026-11-27)

- **The app checks the Config Key** (see "Exam lock" below). Every hand-out
  file has its own Config Key, shown in the config tool's *Exam* section;
  copy it **after** saving the file (it changes with any setting).
- **New `examKeySalt` for every exam:** in the Config Tool, *Exam → Browser
  Exam Key → Generate* before saving the hand-out file. The salt in the
  tracked template is public, so don't reuse it.
- **Students don't need the quit password any more.** `quitURL` is
  `https://web-evaluator.vercel.app/exam/done`: after Submit (or auto-submit)
  the app signs the student out and loads that URL, and SEB closes by itself.
  On the "Already submitted" screen there's an *Exit exam* button that does
  the same. Keep a quit password in the hand-out file for staff emergencies
  only, and don't tell it to students. If the app moves to another domain,
  change `quitURL` too.
- **Private clipboard is on** (`enablePrivateClipboard`): text copied outside
  SEB can't be pasted in.

## Exam lock: only this .seb file can open the exam

An assignment can be set to **require Safe Exam Browser** (Admin →
Assignments → *Safe Exam Browser*). Then:

- Opening it from Chrome, Edge, etc. shows "Safe Exam Browser required" and
  the database refuses to show the problem or accept drafts/submissions.
- Opening it in SEB with any other or edited .seb file is refused the same
  way (its Config Key doesn't match).
- One device at a time: a second laptop on the same account is refused
  while the first is active. If a laptop dies, the student can continue on
  another after ~90 s, or immediately after an invigilator presses
  **Release** (Admin → Exam security).
- Every refusal is logged with time, IP and browser: Admin → **Exam
  security** (live, refreshes every 15 s) and the *Exam integrity* box on
  each submission.

**Set it up for an exam**

1. Build the hand-out .seb from the template (new exam key salt, staff quit
   password, settings password), save it, copy its **Config Key**.
2. Admin → **Exam security** → *Add a Safe Exam Browser config*: a name and
   the Config Key.
3. Admin → **Assignments**: when assigning, pick *Safe Exam Browser:
   Required: <config>*; for existing assignments, select them (e.g. *Select
   by time slot*) and use the bulk bar's *Safe Exam Browser* → *Apply*.
4. Dry run on an exam-room machine (checklist below), including: open the
   exam in Chrome → refused; open in SEB with the file → works.

**SEB versions.** The check uses SEB's JavaScript API: SEB **3.4+ for
Windows**, **3.1+ for macOS/iOS**. Older versions are refused as "not in
Safe Exam Browser".

**macOS students.** On macOS, `URLFilterEnableContentFilter = true` forces
SEB's old web view, which has no JavaScript API, so Mac students would always
be refused. For Macs, save a variant of the file with *Filter embedded
content* off (keep `browserWindowWebView` = 3, "Prefer modern") and add its
Config Key to the same config (one key per line). Trade-off: without the
content filter, code running inside the preview can load from sites outside
the allow-list; the main window is still restricted.

**Limits.** The Config Key can be derived from the .seb file by someone who
knows SEB's algorithm, so a very technical student could fake it with a
script. The one-time code per attempt stops simple replay, and the log shows
the browser and IP of every session, but invigilation still matters.

## Before the exam

1. **Save the hand-out file encrypted** (recommended). It's plain XML, so a
   student who opens it in a text editor sees the password hash. Open it in
   the SEB Config Tool and save with a *settings password*; students then need
   that password to read it, but SEB still starts the exam from it.
2. **Have students sign up before the exam, outside SEB**, with the exact
   email they were assigned. The confirmation email can't be opened inside SEB.
3. **Do a dry run** on one exam-room machine with this file:
   - [ ] the login page loads and you can sign in
   - [ ] the editor shows code with syntax colours (Monaco)
   - [ ] a React assignment's preview shows the app within ~15 s
   - [ ] typing updates the preview; the header shows "✓ Saved"
   - [ ] Submit works
   - [ ] "Show expected output" / asset ↗ links open in a separate SEB window

## What's allowed (everything else is blocked)

| Rule | Why |
|---|---|
| `web-evaluator.vercel.app` | the app |
| `ymsbimnikmvocomskuvm.supabase.co` | login, data, autosave, asset images |
| `cdn.jsdelivr.net/npm/*` | code editor (Monaco) and npm files for the React preview. `/gh/` (GitHub files) stays blocked |
| `.data.jsdelivr.com` | npm version lookups for the React preview |
| `.2-19-8-sandpack.codesandbox.io` | React preview bundler (exact host) |
| `.prod-packager-packages.codesandbox.io` | pre-built React packages (exact host) |
| `.aiwi8rnkp5.execute-api.eu-west-1.amazonaws.com` | CodeSandbox's fallback package builder (exact host) |

`codesandbox.io` itself, `unpkg.com` and GitHub stay blocked on purpose:
student code runs inside the preview, so any allowed site could be opened
there (an online IDE or a GitHub file with a prepared solution).

Documentation for the student (React cheatsheet, API notes, etc.) is served
by the app itself — the admin attaches it per-project under *Reference /
documentation*, and students open it from the Solve sidebar. No extra
hostnames needed here: keeping docs inside the app is deliberate, so
`react.dev` / `developer.mozilla.org` stay blocked and their search can't
be used to find prepared solutions.

## If the dry run shows a problem

- **React preview stuck on "Downloading dependencies" or shows a fetch
  error:** add an *allow* rule for `unpkg.com` (the bundler's fallback CDN) and
  try again. As a last resort, `codesandbox.io` (all of it), but read the
  note above first.
- **Blank editor:** check the `cdn.jsdelivr.net/npm/*` rule is active.
- **After upgrading `@codesandbox/sandpack-react`:** the bundler host follows
  its version (`2-19-8` = sandpack-client 2.19.8). Check
  `node_modules/@codesandbox/sandpack-client/package.json` and update the rule.

## Other settings

Reload allowed (handy if the preview hangs), back/forward off, developer
console off, spell check off, downloads and printing off, one display, no
virtual machines, cookies cleared at start and end (students sign in each
session; their work is still on the server). Links that open a new tab open
in a new SEB window.
