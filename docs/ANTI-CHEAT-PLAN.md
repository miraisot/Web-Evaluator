# Exam integrity plan — Web Evaluator + Safe Exam Browser

Status (2026-11-27): steps 1–6 built — problems hidden until start; SEB file
closes itself; SEB Config Key gate with exam sessions, one device at a time,
blocked-attempt log, admin *Exam security* page; activity tracking (pastes,
non-typed inserts, copying the problem, time away, typing per minute, extra
screens, Print Screen), code history with replay, per-submission risk badge
(Flagged / Review / Clean) with reasons, filter and CSV column. Step 7
(similarity between students) not started. Thresholds: `src/lib/integrity.ts`.
Setup: `seb/README.md` → "Exam lock".

## 1. What is wrong today (found in the code)

| # | Gap | Where | Effect |
|---|-----|-------|--------|
| G1 | `sendBrowserExamKey` is **false** | `seb/web-eval-exam.template.seb:9` | The server has no way to tell SEB from Chrome. Any browser can sign in and take the exam. |
| G2 | The app never checks for SEB at all | `src/pages/Solve.tsx`, `supabase/schema.sql` | Even with keys on, nothing would reject a non-SEB request. |
| G3 | The browser talks to Supabase directly (anon key + student JWT) | `src/lib/supabase.ts` | A check in the React app is useless: a student can call the Supabase REST API from any browser/script with their login token. Enforcement must live in the database / an Edge Function. |
| G4 | Problem statements are readable **any time** — no `starts_at` check | `projects_assigned_read`, `assets_assigned_read` (`schema.sql:227-245`) | A student can sign in from a normal browser the night before and read their problem. |
| G5 | A student-made `.seb` file works the same as yours | — | They can build a config with no URL filter / no quit password and nothing detects it. |
| G6 | The quit password is given to students | process | Once one student knows it, every student knows it. The hash in the file is also crackable. |
| G7 | No record of *how* the work was produced | — | Only the final code is stored. No paste log, no timeline, no session log, no similarity check. |
| G8 | One account can be open on several devices at once | — | A friend can sign in to the same account elsewhere. |

The core idea of the fix: **the database refuses exam traffic unless it comes from a session that was opened by your exact SEB config, on one device, inside the exam room, inside the time window — and logs everything that happens in that session.**

---

## 2. Phase 1 — Lock the exam to *your* SEB file (fixes G1–G6)

### 2.1 Turn on SEB keys
In the template `.seb`:
- `sendBrowserExamKey` → `true`
- `examKeySalt` → a fresh random value per exam (regenerate the file for each exam)
- `quitURL` → `https://web-evaluator.vercel.app/exam/done` and `quitURLConfirm` → `false`
- keep `allowQuit` = true but set a **staff-only** quit password that students are never told (emergency use only)

SEB then sends two headers on every request and exposes the same values to page JS (`SafeExamBrowser.security.configKey`, `.browserExamKey`):
- **Config Key** = hash of *your settings*. If a student edits the file or makes their own, the Config Key changes. → **fixes G5**
- **Browser Exam Key** = hash of settings + SEB app binary + salt. Pins the SEB version too.

Each header is `SHA256(full request URL + key)`, so it can't be replayed for another URL.

### 2.2 Exam-session gate (new Edge Function `start-exam-session`)
The SEB page calls this once when the student opens an assignment. It:
1. Verifies the Supabase JWT (who is it).
2. Recomputes `SHA256(url + expectedConfigKey)` and compares with `X-SafeExamBrowser-ConfigKeyHash` (and the BEK header against an allow-list of accepted BEKs — one per SEB version/OS you allow).
3. Checks the assignment window (`starts_at ≤ now ≤ ends_at`), that the student is assigned, and has not submitted.
4. Optional: checks the client IP is in the exam-room network range (in-class exam → very strong signal).
5. Checks there is no other **active** session for this student + assignment (→ **fixes G8**; a second device is refused and logged, admin can "release" the old one).
6. Inserts a row into `exam_sessions` and returns a short-lived session token.

Expected Config Key / BEK values are stored per assignment in a new admin-only table (`assignment_seb_keys`), pasted in by admin after building the `.seb` (SEB Config Tool shows the Config Key).

### 2.3 Database refuses everything without a live session (fixes G2, G3, G4)
- New helper `public.has_live_exam_session(assignment_id)` → true only if `exam_sessions` has an active, non-expired row for `auth.uid()` that matches the session token sent in a request header (PostgREST exposes headers via `current_setting('request.headers')`).
- Change RLS:
  - `projects_assigned_read`, `project_assets` read, quiz question reads → also require `now() >= starts_at` **and** `has_live_exam_session(...)` for exam-type assignments. Practice assignments can keep a flag `requires_seb = false`.
  - `submission_drafts` write and `submissions` insert → require `has_live_exam_session(...)`.
- Result: from Chrome, a student can still sign in but sees "This exam must be opened in the Safe Exam Browser file given by your invigilator", and every direct API call is rejected by Postgres.
- Session heartbeat: the page pings every 20–30 s; a session with no heartbeat for >2 min goes `stale` (useful signal, and lets admin see who dropped).

### 2.4 Quitting without telling students the password (fixes G6)
- After **Submit** or **auto-submit**, the app navigates to `/exam/done`. Because that is the `quitURL`, SEB closes itself — no password needed.
- If a student needs to leave early (illness etc.), the invigilator enters the staff password, or an admin clicks "Allow exit" in the dashboard, which marks the session and shows a quit button that goes to the quit URL.
- Once a session is `submitted`, the gate never opens a new one for that assignment.

---

## 3. Phase 2 — Integrity evidence during the exam (fixes G7)

New table `exam_events (id, session_id, student_id, assignment_id, type, payload jsonb, client_ts, server_ts)` — insert-only for the student (through the live session), read-only for admin. Never shown to students.

### 3.1 What to record
| Signal | How | Why it matters |
|---|---|---|
| Session start/end, IP, user-agent, SEB version, key match result | Edge Function | Proves the exam was taken in your SEB, in the room |
| Rejected attempts (wrong key / no SEB / 2nd device / outside window) | Edge Function | Shows *attempts* to cheat even when blocked |
| **Paste events** in Monaco (size, file, time; content hash + first ~200 chars) | `editor.onDidPaste` / `onDidChangeModelContent` | Large pastes of code that was never typed = strongest signal |
| Large insert without paste (> N chars in one edit) | model change events | Catches drag-drop / IME / autotyper tricks |
| Typing stats per minute (keys, deletes, chars added) | Monaco events, batched | Real coding has edits and backspaces; pasted/AI code does not |
| Idle gaps | heartbeat | 20 min idle then a full solution appears |
| Focus/blur, visibility, window resize, fullscreen exit | DOM events | In SEB these should never fire; if they do, something is off |
| Heartbeat gaps / reconnects / IP change mid-exam | heartbeat | Laptop moved to another network, hotspot use |
| Copy events out of the problem statement | `copy` listener | Copying the question to send elsewhere |
| Code snapshots | already autosaved — keep a **history** (`submission_draft_versions`) instead of overwriting | Lets you replay how the code grew |

Clipboard: in SEB set `enablePrivateClipboard` = true so nothing from outside SEB can be pasted at all; paste logging then mostly catches in-exam copying between files (normal) vs. suspicious bulk pastes.

### 3.2 Batching
Events are buffered in the browser and flushed every 10 s and on `visibilitychange`, so it doesn't slow the editor. Flush writes go through the same live-session RLS.

---

## 4. Phase 3 — After the exam: detection & review

### 4.1 Per-submission risk score (computed by a SQL function or Edge Function)
Example weights (tune after the first exam):
- not via verified SEB session at any time → **critical**
- 2nd-device / wrong-key attempts → high
- single paste > 300 chars that ends up in the final code → high
- > 60 % of final code arrived by paste/bulk insert → high
- heartbeat gap > 3 min or IP change → medium
- focus/blur events in SEB → medium
- very low edit-to-final ratio (almost no deletes) → low/medium

Shown as a coloured badge (Clean / Review / Flagged) next to each row in **Admin → Submissions**, with a filter.

### 4.2 Similarity across students
- Normalise each submission (strip comments/whitespace, rename identifiers, or compare token streams/AST) and compare all pairs **within the same problem** (P0 vs P0, etc.).
- Flag pairs above a threshold; show side-by-side diff. A small Edge Function or a script using a winnowing/fingerprint approach (MOSS-style) is enough for class sizes.
- Also compare against the starter code so the scaffold doesn't count as "similar".

### 4.3 Evidence view (Admin → Submission → "Integrity" tab)
- Timeline: session start → snapshots → pastes → gaps → submit, with a **replay slider** over the snapshots.
- Event list with filters, paste contents, similarity matches.
- Invigilator notes and a decision field: `cleared / warning / malpractice`, who decided and when. That record is your "detailed setup" for disciplinary cases.

### 4.4 Live invigilator dashboard (during the exam)
Per room: who is in a verified session, last heartbeat, live flags (2nd device attempt, big paste, offline), buttons: *release session*, *allow exit*, *extend time for one student*, *add note*.

---

## 5. Process / policy (no code)
- New `.seb` + new `examKeySalt` for **every** exam; keep it out of git (already ignored) and hand it out on the day (LMS/USB), not in advance.
- Settings password on the `.seb` file (already recommended in `seb/README.md`).
- Exam-room Wi-Fi with a known public IP; add that IP range to the assignment.
- Seat plan: record roll no. ↔ seat ↔ machine; adjacent students get different problems (already round-robin P0–P9 — make sure neighbours differ).
- Publish the rules + "all activity is logged" to students beforehand; deterrence is half the value.
- Written malpractice procedure: what flag levels mean, who reviews, how the student is heard.

---

## 6. Suggested order of work

| Step | Work | Size |
|------|------|------|
| 1 | Fix G4 now: add `now() >= starts_at` to project/asset/quiz read policies | small, do first |
| 2 | `.seb` changes (BEK on, salt, quitURL, private clipboard) + `/exam/done` route | small |
| 3 | `exam_sessions`, `assignment_seb_keys`, `start-exam-session` Edge Function, heartbeat | medium |
| 4 | RLS: require live session for exam reads/writes; `requires_seb` flag per assignment; "open in SEB" screen | medium |
| 5 | `exam_events` + Monaco paste/typing/focus logging + draft version history | medium |
| 6 | Admin: integrity tab, risk badges, live dashboard | medium–large |
| 7 | Similarity checker per problem | medium |

Steps 1–4 close the "log in without SEB / use own SEB file" holes. Steps 5–7 are the cheating-evidence system.

## 7. Limits to be honest about
- SEB keys stop *software* tricks; they don't stop a phone camera or a person whispering. Invigilation and seating still matter.
- A modified/cracked SEB build changes the Browser Exam Key, so the BEK allow-list catches most of these — keep the list to exact versions you tested.
- Paste and typing signals are **evidence for review**, not proof. A human decides.
