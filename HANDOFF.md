# Web Eval — React mode handoff

Context for picking up where the previous session left off.

## Repo

- **Path:** `/Users/sunstone/Desktop/WEB EVALUATION`
- **Stack:** Vite + React 18 + TypeScript + Tailwind + Supabase + Monaco + Sandpack
- **What it is:** Admin creates coding assignments; students write code in Monaco; see a live preview; submit. Originally HTML/CSS/JS only.
- **Branch:** `main` — several uncommitted changes from this session (do not blow them away).

## What this session built

Added React project support alongside the existing HTML mode so the platform can host **WEB 301 Mid-Sem Phase 2** (a React + React Router exam, P0–P9).

### Shipped changes (all uncommitted)

| File | What |
|---|---|
| `supabase/schema.sql` | Added `project_type text default 'html' check in ('html','react')` on `projects` |
| `src/lib/types.ts` | Added `ProjectType = 'html' \| 'react'` and `project_type` on `Project` |
| `src/components/CodeEditor.tsx` | Monaco now recognizes `.jsx`, `.tsx`, `.ts`, `.md` |
| `src/components/ReactPreview.tsx` | **NEW** — Sandpack-based React preview (headless bundler; Monaco stays as the editor) |
| `src/pages/Solve.tsx` | Branches on `project_type` — React uses `<ReactPreview>`; type-aware default files, protected file list, default active tab; uses project's starter_files AS-IS when non-empty (prevents duplicate roots) |
| `src/pages/admin/Projects.tsx` | "Import exam template" dropdown + "Import all 10 →" bulk button; project list shows HTML/React pill |
| `src/pages/admin/ProjectEdit.tsx` | HTML/React pill next to project title |
| `src/exam-templates/web301.ts` | **NEW** — all 10 WEB 301 problems (P0–P9) as `ExamTemplate`s with sample datasets + Vite-shaped scaffold |
| `package.json` | `@codesandbox/sandpack-react` added |
| `.claude/launch.json` | **NEW** — Vite dev server config for the browser pane (`dev` on 5173, `dev-alt` on 5174 for when another session holds 5173) |
| `tsconfig.json`, `tsconfig.node.json` | `noEmit` / out-of-tree output so `tsc -b` stops writing `.js` next to sources |

### How to deploy the schema change (one-time)

```sql
alter table public.projects
  add column if not exists project_type text not null default 'html'
  check (project_type in ('html', 'react'));
```

Run in Supabase SQL editor, then reload the schema cache in Supabase → Settings → API if the first write errors with "column project_type not in schema cache".

### How the ReactPreview is wired

- `SandpackProvider` with `template="react"`, `customSetup={{ entry, dependencies }}`.
- Entry file is auto-detected from the project's own files (looks for `src/main.jsx`, `src/index.jsx`, etc., in priority order). Falls back to a seeded `/index.js` only when the project is bare.
- Dependencies: `react-router-dom@^6.26.0`.
- At render time, two silent rewrites happen inside `ReactPreview.tsx` so student code renders unchanged:
  1. `from 'react-router'` → `from 'react-router-dom'`
  2. `BrowserRouter` → `HashRouter`
- The console pane (`SandpackConsole`) is pinned at the bottom with `h-32`.

### WEB 301 template structure (same for all 10 problems)

```
index.html
package.json         (dependencies: react, react-dom, react-router-dom)
src/
  main.jsx           (BrowserRouter + App — fully written)
  App.jsx            (routes wired, state hook, TODO markers)
  styles.css         (basic reset + card/nav/badge classes)
  components/
    Navbar.jsx       (skeleton with TODOs)
    <Item>Card.jsx   (skeleton)
  pages/
    Home.jsx, <List>.jsx, <Item>Details.jsx, <Saved>.jsx  (skeletons)
  data/<dataset>.js  (fully populated with 8-10 realistic rows)
```

Replace `<Item>`, `<List>`, `<Saved>`, `<dataset>` per problem (see `PROBLEMS` array in `src/exam-templates/web301.ts`).

## Blank React preview — RESOLVED (2026-10-23)

Symptom was: Sandpack iframe loads, console shows only the two React Router
"Future Flag" warnings, preview stays pure white.

### Root causes found
1. **React StrictMode vs Sandpack autorun.** `src/main.tsx` wraps the app in
   `<React.StrictMode>`. In dev, StrictMode mounts → unmounts → remounts every
   component; Sandpack's async client creation races its own cleanup (which
   does `iframe.location.replace('about:blank')`). The bundler still runs
   (hence the console warnings) but the visible iframe stays blank.
   Reproduced in isolation: same files render fine without StrictMode and go
   blank with it. Production builds were never affected (no double-mount).
   **Fix:** `ReactPreview.tsx` sets `autorun: false` and a tiny
   `<StartWhenMounted>` child calls `runSandpack()` on a `setTimeout(0)` that
   the simulated unmount cancels → bundler starts exactly once.
2. **Stale emitted `.js` files shadowing the `.tsx` sources.** `tsconfig.json`
   had no `noEmit`, so `npm run build` (`tsc -b`) wrote `src/**/*.js` next to
   every `.tsx`. Vite resolves `.js` before `.tsx`, so the dev server ran the
   stale JS and later `.tsx` edits were silently ignored (why the
   HashRouter/rewrite experiments "didn't land").
   **Fix:** removed the 23 emitted files (+ `vite.config.js`, `vite.config.d.ts`,
   `*.tsbuildinfo`); `tsconfig.json` now has `"noEmit": true`, and
   `tsconfig.node.json` writes its declaration output to `node_modules/.tmp/`.
   If `.js` files ever reappear in `src/`, delete them.
3. **Bare React projects showed Sandpack's "Hello world".** The fallback entry
   imported `./App`, which resolves to the template's hidden `/App.js` before
   the student's `/App.jsx`, and it never imported `styles.css`. **Fix:**
   `defaultEntry()` imports the student's App file by exact name plus
   `./styles.css` when present.

4. **The countdown timer restarted Sandpack every second** (found on the real
   Solve page after fixes 1–3). Solve re-renders every second for "Time left";
   `customSetup` was an inline object, so Sandpack re-derived its file state
   on every render, which changed `runSandpack`'s identity and re-triggered
   the start effect → client torn down and rebuilt each second → blank, with
   an empty console. **Fix:** `customSetup` is memoized on `entry`, `options`
   is a module constant, and `<StartWhenMounted>` runs once per mount (later
   edits go through Sandpack's own file watcher).
5. **Editor opened a non-existent root `App.jsx`.** `defaultActiveFor('react')`
   always returned `App.jsx`, but templates keep it at `src/App.jsx`; typing
   into the empty buffer created a duplicate root file (likely the source of
   the "root-level App.jsx dupes"). **Fix:** `Solve.tsx` picks the first
   existing file from `src/App.jsx`, `src/App.tsx`, `App.jsx`, … .

Also: the entry detection and the two rewrites now live inside the
`useMemo` instead of mutating the memoized object during render.

### Verified
- Signed-in `/solve/d2b9096f-…` (P0): preview renders and stays rendered while
  the timer ticks; editing `src/pages/Home.jsx` updates the preview live;
  editor opens on `src/App.jsx`.
- Throwaway harness (StrictMode + Solve layout): P0 and P9 render, "Books"
  routes to `/#/books`, adding a file (key remount) still renders, bare
  `{ App.jsx, styles.css }` project renders the student's App with CSS.
- `npm run build` passes; no `.js` emitted into `src/`.

## Autosave shows "Offline (local only)" — needs a DB migration

Console: `Could not find the table 'public.submission_drafts' in the schema
cache`. The table is in `supabase/schema.sql` (uncommitted) but was never run
against the database. The app's Supabase project is `ymsbimnikmvocomskuvm`; run
the SQL there. To check: `select to_regclass('public.submission_drafts');`
returns NULL if the table is missing.

**Back up first:** `npm run db:dump` (`scripts/db-dump.mjs`, no pg_dump
needed) writes `backups/<time>-<project>/data.sql` (all public rows + auth
users/identities as primary-key upserts, FK-ordered) and `security.sql` (live
RLS, policies, functions, triggers). Restore = run `data.sql` (after
`schema.sql` on an empty DB). Storage files and login sessions are not
included. `backups/` is gitignored; it holds password hashes.

**Easiest:** `npm run db:apply` (`scripts/apply-schema.mjs`) applies the whole
idempotent `supabase/schema.sql` in one transaction, reloads the API schema
cache and checks every table. It needs `SUPABASE_DB_URL` (Session pooler
string with the DB password) in `.env`; see `.env.example`. It refuses to run
against a different project than `VITE_SUPABASE_URL`.

Or paste this into the SQL editor: Drafts still save to localStorage, so nothing is lost on
the same browser, but cross-device recovery doesn't work until you run:

```sql
create table if not exists public.submission_drafts (
  assignment_id uuid references public.assignments(id) on delete cascade not null,
  student_id uuid references public.profiles(id) on delete cascade not null,
  files jsonb not null,
  folders jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (assignment_id, student_id)
);
alter table public.submission_drafts enable row level security;
drop policy if exists drafts_self_rw    on public.submission_drafts;
drop policy if exists drafts_admin_read on public.submission_drafts;
create policy drafts_self_rw on public.submission_drafts
  for all
  using (student_id = auth.uid())
  with check (
    student_id = auth.uid()
    and exists (
      select 1 from public.assignments a
      where a.id = submission_drafts.assignment_id
        and (a.is_public or lower(a.assignee_email) = public.current_email())
        and now() <= a.ends_at + interval '30 seconds'
    )
  );
create policy drafts_admin_read on public.submission_drafts for select using (public.is_admin());
notify pgrst, 'reload schema';
```

### Known Sandpack quirk
Sandpack's `SandpackProvider` key is `JSON.stringify(Object.keys(sandpackFiles).sort())`. If a new file is added, Sandpack remounts and does a clean rebuild. If only content changes, it hot-reloads. If a rewrite misses, it'd stay broken until file-set changes.

## Server-side auto-submit and UID (2026-10-24)

- **Auto-submit no longer depends on the student's browser.**
  `public.collect_expired_drafts()` turns every draft left in
  `submission_drafts` into a submission one minute after the assignment's
  `ends_at` (past the 30 s grace), with `auto_collected = true` and
  `submitted_at` = time of the last autosave. Existing submissions are never
  overwritten. pg_cron runs it every minute (job `collect-expired-drafts`).
  The browser auto-submit is unchanged and still fires first when the page
  is open. Admin pages label these "Auto-collected".
- **UID:** required on the Create account form, stored in `profiles.uid`
  by the `handle_new_user` trigger (backfilled from signup metadata), shown
  and searchable in admin Submissions and in the submission view.
- **To apply:** run all of `supabase/schema.sql` (idempotent) in the SQL
  editor. If pg_cron can't be enabled from SQL it prints a notice; enable it
  under Dashboard → Integrations → Cron and run the file again. Check with
  `select jobname, schedule from cron.job;`.

## Exam setup (2026-10-24)

- **SAMPLE practice problem is live:** project "SAMPLE · React Practice —
  Movie Watchlist (not graded)", public assignment open until
  2026-10-26 23:59 IST. Template: `WEB301_SAMPLE` in
  `src/exam-templates/web301.ts` (kept out of "Import all 10").
- **Student → problem list:** `exam-data/` (gitignored; student emails).
  Round-robin P0–P9 in the roster's order; `web301-emails-by-problem.txt`
  has one paste-ready email block per problem for Admin → Assignments.
- **Safe Exam Browser:** `seb/web-eval-exam.seb` (hand-out file with the quit
  password, git-ignored), `seb/web-eval-exam.template.seb` (no password,
  tracked) and `seb/README.md` (strict allow-list, dry-run checklist).

## Running locally

```bash
cd "/Users/sunstone/Desktop/WEB EVALUATION"
npm install
npm run dev
```

Open http://localhost:5173, sign in. Admin credentials are stored in Supabase; the user already has an admin account.

- Admin area: `/admin/projects`
- Student view: `/solve/<assignment-id>`
- Test assignment ID currently in use: `d2b9096f-4115-4fcf-b7c2-673461a23e64` (P0 — Library Book Manager)

### Reset a stuck draft

When autosave captures a broken file set, reload won't fix it. Clear:

```sql
delete from public.submission_drafts where assignment_id = '<the-id>';
```

```js
// in browser devtools console on the Solve page:
Object.keys(localStorage).filter(k => k.startsWith('web-eval:')).forEach(k => localStorage.removeItem(k))
location.reload()
```

## Original user requirement

Build an exam platform that:
1. Supports React (not just HTML/CSS/JS)
2. Runs purely in the browser — no local Node, no `npm install`
3. Works inside a Safe Exam Browser (proctored, single-tab)
4. Feels like VS Code (file tree + Monaco + preview) with the compiler invisible underneath

For WEB 301 specifically, each student gets one of P0–P9 based on last digit of their roll number. Exam is 120 minutes, offline, in-class.

## Attribution for commits

```
Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

## File-by-file quick index

- `src/components/ReactPreview.tsx` — **the critical file.** Contains all the Sandpack glue + the two rewrites. If the blank-preview bug persists, this is where to look.
- `src/exam-templates/web301.ts` — 10 problems. If any one problem fails, the shared scaffold builder (`buildStarter`) in this file is the common cause.
- `src/pages/Solve.tsx` — type-aware preview + default files. Pay attention to how `starter_files` is loaded (lines ~103-150).
- `src/pages/admin/Projects.tsx` — admin create form with template picker.
- `supabase/schema.sql` — just one new column; nothing else touched.
