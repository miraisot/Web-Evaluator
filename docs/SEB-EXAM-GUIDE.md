# Web Evaluator + Safe Exam Browser (SEB) — Exam Guide

This guide covers running a first-time exam on **Web Evaluator** inside **Safe Exam Browser**.

- **Part A** – Instruction sheet for students (read out / print / share)
- **Part B** – How the SEB file works
- **Part C** – How to start, and how to quit, the exam
- **Part D** – How HTML/CSS/JS and React questions are solved inside SEB
- **Part E** – Invigilator / admin checklist (before, during, after)
- **Part F** – Troubleshooting

> Reference files: [`seb/README.md`](../seb/README.md) (SEB settings & allow-list), `seb/web-eval-exam.seb` (hand-out file, git-ignored), `seb/web-eval-exam.template.seb` (same settings, no quit password).
> Exam URL: `https://web-evaluator.vercel.app/`

---

## Part A — Instructions for students

### A1. Before exam day (do this OUTSIDE Safe Exam Browser)

1. **Install Safe Exam Browser** (Windows or macOS) from https://safeexambrowser.org/download_en.html. Install the version the invigilator tells you; use the same on all machines if possible.
2. **Create your Web Evaluator account** in a normal browser at https://web-evaluator.vercel.app/ → *Create account*.
   - Use **exactly the email address** the college/instructor assigned you. Assignments are matched on this email.
   - Enter your **UID** (college ID) correctly — it appears on your submission.
   - Open the **verification email** and confirm it. *The confirmation link cannot be opened inside SEB*, so this must be done beforehand.
3. **Sign in once** in the normal browser to confirm your password works (use *Forgot password* if not).
4. Download the **`web-eval-exam.seb`** file given by your instructor. Do **not** edit or rename its contents.
5. Charge your laptop and bring the charger. Close or uninstall screen-recording, remote-desktop and virtual-machine software.

### A2. On exam day — starting

1. Close **all** other applications (browsers, chat apps, IDEs, screen recorders, messengers, remote tools). SEB may refuse to start while they are running.
2. **Double-click `web-eval-exam.seb`.** SEB opens full-screen and loads Web Evaluator.
   - If asked for a settings password, enter the one the invigilator gives you.
3. **Sign in** with your registered email and password.
4. On the home page, click your assigned exam/assignment to open the **Solve** screen.
5. Read the **problem statement** fully before you start (use the fullscreen reader button if needed).

### A3. Rules during the exam

- ✅ You may only use Web Evaluator. Every other website is blocked.
- ✅ Reference/documentation for your exam (if any) is available **inside** Web Evaluator from the Solve sidebar.
- ❌ No other applications, no phone, no messaging, no AI tools, no sharing of code.
- ❌ No external display, no virtual machine, no screen recording.
- ❌ Do not try to exit, switch windows, or kill SEB. Any such attempt may be treated as malpractice.
- ✋ **If you leave the exam** (SEB closed, laptop restarted or died), you can only continue after the invigilator approves it. Open the exam again, raise your hand, and stay on the "Waiting for the invigilator" screen: it continues by itself. Your work up to the last autosave is kept.
- ❌ Downloads, printing, developer console, back/forward navigation and spell-check are disabled.
- The **timer ("Time left")** is shown in the header. **Your work auto-submits when time ends.**
- 👁 **Your exam activity is recorded** ("● Activity recorded" in the header): text pasted from outside the exam, code that appears without being typed, copying the problem text, time spent outside the exam window, typing activity, extra screens, and snapshots of your code as it grows. Invigilators review this after the exam. Copying and pasting *within* your own exam code is normal and is not counted against you.

### A4. While solving

- Your code is **autosaved every few seconds**. Watch the header: **✓ Saved** = safe; *Saving…* = wait; *Offline (local only)* = network problem (see A6).
- Use **Reload (F5 / Ctrl+R)** only if the preview hangs. Your saved work is kept.
- Do not delete default files (`index.html`, `styles.css`, `script.js`, or the React starter files).
- **"Show expected output"** (if present) opens a reference screenshot in a separate SEB window — close that window to return.

### A5. Submitting and finishing

1. Click **Submit**, confirm the dialog "Submit this version for evaluation?", and wait for the **"Submitted!"** message.
2. You can only submit once. After submitting, the page shows **"Already submitted"**.
3. **Do not leave your seat or quit SEB until the invigilator says so.** Raise your hand — the invigilator will enter the quit password (see Part C).

### A6. If something goes wrong

| Problem | What to do |
|---|---|
| Preview is blank / stuck on "Downloading dependencies" | Wait ~15 s, then press **F5/Ctrl+R** once. Still stuck → raise your hand. |
| Header shows "Offline (local only)" | Keep working (saved locally). Raise your hand if it persists > 1 minute. |
| Login fails | Check email spelling; use *Forgot password* only **before** the exam. Otherwise raise your hand. |
| Laptop crashes / SEB closes | Raise your hand. Reopen the `.seb` file, sign in again — your autosaved work is restored. |
| "No assignment found" | Your email may not match the assigned one. Tell the invigilator. |

---

## Part B — How the SEB file works

A `.seb` file is a settings file for Safe Exam Browser. Opening it launches SEB **locked into exam mode** with those settings applied.

| Setting | Value in `web-eval-exam.seb` |
|---|---|
| Start URL | `https://web-evaluator.vercel.app/` |
| URL filter | **Allow-list only** — everything else blocked |
| Quit | Allowed, but **only with the quit password** |
| Reload | Allowed (helps if preview hangs) |
| Back / forward | Off |
| Developer console | Off |
| Downloads / printing | Off |
| Spell check | Off |
| Displays | One display only |
| Virtual machines | Blocked |
| Cookies | Cleared at start and end (students sign in each session; work is on the server) |
| New tab / link popups | Open in a new SEB window |

### B1. Allowed hosts (everything else is blocked)

| Host | Purpose |
|---|---|
| `web-evaluator.vercel.app` | The app |
| `ymsbimnikmvocomskuvm.supabase.co` | Login, data, autosave, images |
| `cdn.jsdelivr.net/npm/*` | Code editor (Monaco) + npm files for React preview |
| `.data.jsdelivr.com` | npm version lookup for React preview |
| `.2-19-8-sandpack.codesandbox.io` | React preview bundler |
| `.prod-packager-packages.codesandbox.io` | Pre-built React packages |
| `.aiwi8rnkp5.execute-api.eu-west-1.amazonaws.com` | CodeSandbox fallback package builder |

`codesandbox.io`, `unpkg.com` and GitHub are blocked **on purpose** — student code runs in the preview, so any allowed site could be opened there to fetch a ready-made solution.

### B2. Two versions of the file

- **`web-eval-exam.seb`** — the one to hand out. Contains the quit password hash. **Git-ignored** (repo is public).
- **`web-eval-exam.template.seb`** — same settings, no quit password. To make a fresh hand-out file: open it in the *SEB Config Tool* (Windows) or *SEB → Settings* (macOS) → *General → Quit/unlock password* → set → save.

### B3. Protect the hand-out file

The `.seb` file is plain XML; a student opening it in a text editor can see the password hash. **Save it encrypted** with a *settings password* in the SEB Config Tool. Students then need that password to open it, but SEB still starts the exam from it. Distribute the settings password only in the exam room.

> Important: after upgrading `@codesandbox/sandpack-react`, the bundler host changes (`2-19-8` = sandpack-client version). Check `node_modules/@codesandbox/sandpack-client/package.json` and update the host rule.

---

## Part C — Starting and quitting the exam

### C1. Start

Double-click `web-eval-exam.seb` → SEB opens full-screen → student signs in → opens assignment.

### C2. How to quit (students CANNOT quit on their own)

SEB is configured with a **quit password** known only to the invigilator.

1. After the student has **submitted** (confirmed "Submitted!" / "Already submitted") — or when time is over and auto-submit is confirmed.
2. Invigilator goes to the student's machine.
3. Press the SEB quit shortcut: **Ctrl+Q** (Windows) or **Cmd+Q** (macOS), or click the **Quit** button in the SEB taskbar.
4. Invigilator enters the **quit password** and confirms.
5. SEB closes and the student's computer returns to normal.

**Never quit before confirming the submission**, unless it is an emergency. Even then, autosave plus server-side collection (below) protects the work.

### C3. Safety nets for work

- **Autosave** every ~3 s to the server (and local browser storage as a backup).
- **Browser auto-submit** fires when the timer hits 0 (only if the page was opened before the deadline).
- **Server auto-collect:** about 1 minute after the end time, any remaining draft is turned into a submission automatically (marked **"Auto-collected"** in admin). Existing submissions are never overwritten.
- If SEB crashes, reopening the `.seb` file and signing in restores the last autosaved version.

---

## Part D — How questions are solved inside SEB

The Solve screen looks like a mini VS Code: **file tree + Monaco code editor + live preview**, with the problem statement and reference docs in side panels. Everything runs in the browser — nothing to install, no local Node.

### D1. HTML / CSS / JavaScript questions

- Starter files: **`index.html`**, **`styles.css`**, **`script.js`** (cannot be deleted; you may add more files/folders).
- Write code in the editor; the **live preview** updates as you type.
- Use plain HTML, CSS and JS only. External CDN links (Bootstrap, jQuery, Google Fonts, etc.) **will not load** because those hosts are blocked — write everything yourself, and use images/assets provided by the exam (served through the app).
- Link files normally (`<link rel="stylesheet" href="styles.css">`, `<script src="script.js">`).
- Compare with **"Show expected output"** (if enabled) for the target layout.
- Submit when done.

### D2. React questions

- Starter project is Vite-shaped: `index.html`, `package.json`, `src/main.jsx`, `src/App.jsx`, `src/styles.css`, `src/components/`, `src/pages/`, `src/data/` (sample data provided).
- The editor opens on **`src/App.jsx`**; edit components, pages and data files.
- Preview is powered by **Sandpack** (a browser-based bundler). First load takes **~10–15 s** while dependencies download from the allowed hosts — this is normal. Edits then hot-reload.
- Supported dependencies: `react`, `react-dom`, `react-router-dom` (v6). **You cannot `npm install` other packages** — do not try.
- Behind the scenes (you don't need to do anything):
  - `import ... from 'react-router'` is mapped to `react-router-dom`.
  - `BrowserRouter` is mapped to `HashRouter` in the preview, so routes look like `/#/books`. Write normal `BrowserRouter` code.
- A **console pane** at the bottom shows `console.log` output and errors. React Router "Future Flag" warnings are harmless.
- Adding a new file triggers a clean rebuild (brief flash) — normal.
- If the preview is blank after ~20 s, press **F5/Ctrl+R** (reload is allowed). Your code is not lost.
- Submit when done; the **whole file set** is submitted.

### D3. Reference documentation

Docs (cheat sheets, API notes) attached by the admin appear in the Solve sidebar under **Reference / documentation**. Sites like react.dev, MDN, W3Schools, Stack Overflow, GitHub and any AI tool are blocked on purpose.

### D4. Practice before the real exam

For a first-time exam, run a **public practice assignment** (e.g. "SAMPLE · React Practice — not graded") so students learn SEB, login, the editor, saving and submitting before the graded exam.

---

## Part E — Invigilator / admin checklist

### E1. One week before

- [ ] Student roster with **UID + exact email**; assignments created for each email (Admin → Assignments).
- [ ] Projects/problems created (Admin → Projects; React templates can be imported). Each project has start/end time, problem text, optional expected-output image, optional reference docs.
- [ ] Database schema fully applied (`npm run db:apply`) — includes `submission_drafts` (autosave) and `collect_expired_drafts` (server auto-submit, pg_cron job enabled). Run `npm run db:dump` for a backup first.
- [ ] Supabase email delivery / SMTP configured (built-in email is rate-limited to ~3/hour — don't rely on it for 100+ students).
- [ ] Generate the final `web-eval-exam.seb`: set **quit password** and encrypt with a **settings password**. Store both passwords securely (not in the repo).
- [ ] Publish SEB installers/download link and the `.seb` file to students (e.g. LMS).

### E2. Two days before

- [ ] Students signed up and **verified email** (outside SEB). Spot-check Admin for missing accounts.
- [ ] **Practice session** run with real student laptops, if possible.
- [ ] **Dry run on one exam-room machine** with the final `.seb` file:
  - [ ] Login page loads and sign-in works
  - [ ] Editor shows syntax colours (Monaco)
  - [ ] React preview shows the app within ~15 s
  - [ ] Typing updates preview; header shows "✓ Saved"
  - [ ] Submit works
  - [ ] "Show expected output" / asset links open in a separate SEB window
  - [ ] A non-allowed site (e.g. google.com) is blocked
  - [ ] Quit password works

### E3. Exam room setup

- [ ] Stable Wi-Fi/LAN with enough capacity; a backup hotspot.
- [ ] Spare laptops with SEB pre-installed.
- [ ] Printed A-section instructions at each desk or on the projector.
- [ ] Settings password and quit password with the invigilator only.
- [ ] Clock of the room matches the server end time (the timer uses the assignment's end time).

### E4. During the exam

- Confirm every student has **SEB full-screen** and is **signed in with their own account**.
- Announce start time; make sure everyone opens the correct assignment.
- Watch for "Offline" saves, blank previews, login issues (see Part F).
- Do **not** extend time by letting students stay in SEB past the end — change `ends_at` in Admin instead, **before** it passes.
- Auto-submit warns at ~60 s left. After time-out, wait for the "Submitted" screen.

### E5. After the exam

- [ ] Verify each student's submission (Admin → Submissions). Auto-collected ones are labelled.
- [ ] Quit each machine with the quit password only after submission is confirmed.
- [ ] Collect `.seb` files / remove from shared drives; rotate quit password for the next exam.
- [ ] Run grading; export results.

---

## Part F — Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| SEB won't start | Another app running (browser, screen recorder, VM) | Close/kill it; restart SEB |
| Login page blank | Network or allow-list missing a host | Check Wi-Fi; verify the `.seb` is the official one |
| Student can't log in | Email not verified / wrong email / password forgotten | Handle outside SEB: confirm email, reset password |
| "Check your email" never resolves | Verification email can't open inside SEB | Student must verify in a normal browser first |
| Blank editor | `cdn.jsdelivr.net/npm/*` rule missing | Re-check the `.seb` allow-list |
| React preview stuck on "Downloading dependencies" / fetch error | A package host blocked | Add allow rule for `unpkg.com` (bundler fallback); last resort all of `codesandbox.io` — see `seb/README.md` |
| Preview blank after Sandpack upgrade | Bundler host version changed | Update the `.2-19-8-sandpack.codesandbox.io` rule |
| "Offline (local only)" | `submission_drafts` table missing or network | Check DB migration; confirm connectivity. Work is still saved locally |
| Already submitted but needs redo | Submission exists | Admin deletes the submission row; student reopens the assignment |
| Student can't see the assignment | Email mismatch or assignment window not open | Check assignee email / start-end time in Admin → Assignments |
| Need to reset a stuck draft | Corrupt autosave | `delete from public.submission_drafts where assignment_id = '<id>';` and clear `web-eval:*` localStorage keys |

---

## Quick reference card (print for the invigilator)

1. Students sign up + verify email **before** exam, outside SEB.
2. Students close all apps → open `web-eval-exam.seb` → sign in → open assignment.
3. Exam runs; autosave every ~3 s; auto-submit at time end; server auto-collect +1 min.
4. Student **Submits** → sees "Submitted!" → raises hand.
5. Invigilator quits SEB with the **quit password** (Ctrl+Q / Cmd+Q).
6. Verify in Admin → Submissions.
