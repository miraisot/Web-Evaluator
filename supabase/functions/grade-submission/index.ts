import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const DEFAULT_MODEL = Deno.env.get('GEMINI_MODEL') || 'gemini-flash-lite-latest'

const MAX_FILE_CHARS = 10000
const MAX_TOTAL_CHARS = 50000

type Criterion = { key: string; label: string; max: number; desc: string }

const HTML_RUBRIC: Criterion[] = [
  { key: 'correctness',  label: 'Correctness',  max: 10, desc: 'Met the stated requirements; expected elements/sections present and not broken.' },
  { key: 'design',       label: 'Design / UI',  max: 10, desc: 'Visual appeal, consistent styling, Flexbox/Grid usage, responsive layout.' },
  { key: 'code_quality', label: 'Code Quality', max: 10, desc: 'Semantic markup, well-named classes, clean structure, no obvious bugs.' },
]

const REACT_RUBRIC: Criterion[] = [
  { key: 'correctness',   label: 'Correctness',   max: 10, desc: 'Met the stated requirements; expected features present and the app renders without errors.' },
  { key: 'functionality', label: 'Functionality', max: 10, desc: 'State, data flow, user interactions and conditional rendering actually work.' },
  { key: 'code_quality',  label: 'Code Quality',  max: 10, desc: 'Component structure, hooks used correctly, clean naming, no obvious bugs.' },
]

function rubricFor(projectType: string | undefined | null): Criterion[] {
  return projectType === 'react' ? REACT_RUBRIC : HTML_RUBRIC
}

function clipFiles(files: Record<string, string>): string {
  const entries = Object.entries(files)
  let total = 0
  const parts: string[] = []
  for (const [name, content] of entries) {
    const trimmed = content.length > MAX_FILE_CHARS
      ? content.slice(0, MAX_FILE_CHARS) + `\n/* ...truncated (${content.length - MAX_FILE_CHARS} more chars)... */`
      : content
    const block = `--- FILE: ${name} ---\n${trimmed}`
    if (total + block.length > MAX_TOTAL_CHARS) {
      parts.push(`--- (${entries.length - parts.length} more file(s) omitted for length) ---`)
      break
    }
    parts.push(block)
    total += block.length
  }
  return parts.join('\n\n')
}

function buildPrompt(title: string, description: string, projectType: string, rubric: Criterion[], files: Record<string, string>): string {
  const criteria = rubric.map(c => `- ${c.key} (0-${c.max}): ${c.label} — ${c.desc}`).join('\n')
  const jsonShape = [
    '{',
    ...rubric.map(c => `  "${c.key}": <integer 0-${c.max}>,`),
    ...rubric.map(c => `  "${c.key}_feedback": "<1-2 sentences explaining this score>",`),
    '  "feedback": "<2-3 sentence overall summary for the student. No sign-off.>"',
    '}',
  ].join('\n')

  return `You are an experienced web development instructor grading a student's submission.

PROJECT: ${title}
TYPE: ${projectType}

REQUIREMENTS AND SPECIFICATION:
${(description || '').slice(0, 3000)}

STUDENT'S SUBMITTED FILES:
${clipFiles(files)}

Grade this submission against these criteria:
${criteria}

Return STRICT JSON only, matching exactly this shape:
${jsonShape}`
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'POST only' })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json(400, { error: 'Invalid JSON body' }) }

  const submission_id = typeof body.submission_id === 'string' ? body.submission_id : undefined
  const graded_by = typeof body.graded_by === 'string' ? body.graded_by : null
  const key = (typeof body.gemini_key === 'string' && body.gemini_key) || Deno.env.get('GEMINI_API_KEY') || undefined
  const model = typeof body.model === 'string' && body.model ? body.model : DEFAULT_MODEL

  if (!submission_id) return json(400, { error: 'submission_id required' })
  if (!key) return json(400, { error: 'No Gemini key. Set GEMINI_API_KEY as a Supabase function secret, or pass gemini_key in the body.' })

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data: sub, error: fetchErr } = await supabase
    .from('submissions')
    .select('id, files, assignment:assignments(project:projects(title, description, project_type))')
    .eq('id', submission_id)
    .single()

  if (fetchErr || !sub) return json(404, { error: 'submission not found', detail: fetchErr?.message })

  const project = (sub as { assignment?: { project?: { title: string; description: string; project_type: string } } }).assignment?.project
  if (!project) return json(404, { error: 'project not found for submission' })

  const files = ((sub as { files?: Record<string, string> }).files) || {}
  const rubric = rubricFor(project.project_type)
  const prompt = buildPrompt(project.title, project.description, project.project_type, rubric, files)

  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`

  // flash-lite rejects thinkingConfig entirely; only send it to models that accept it.
  const supportsThinkingConfig = !/flash-lite/i.test(model)
  const generationConfig: Record<string, unknown> = {
    responseMimeType: 'application/json',
    temperature: 0.2,
  }
  if (supportsThinkingConfig) generationConfig.thinkingConfig = { thinkingBudget: 0 }

  let geminiResp: Response
  try {
    geminiResp = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig,
      }),
    })
  } catch (e) {
    return json(500, { error: 'Gemini fetch failed', detail: String(e) })
  }

  if (!geminiResp.ok) {
    const text = await geminiResp.text()
    return json(geminiResp.status === 429 ? 429 : 500, { error: 'Gemini API error', status: geminiResp.status, detail: text.slice(0, 800) })
  }

  const data = await geminiResp.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) return json(500, { error: 'Gemini returned no text', raw: data })

  let parsed: Record<string, unknown>
  try { parsed = JSON.parse(text) } catch { return json(500, { error: 'Gemini returned invalid JSON', text: text.slice(0, 800) }) }

  const scores: Record<string, number> = {}
  const feedback_by_criterion: Record<string, string> = {}
  let total = 0
  let max_total = 0
  for (const c of rubric) {
    const raw = Number(parsed[c.key])
    const clamped = Math.max(0, Math.min(c.max, Math.round(Number.isFinite(raw) ? raw : 0)))
    scores[c.key] = clamped
    const fb = parsed[`${c.key}_feedback`]
    feedback_by_criterion[c.key] = typeof fb === 'string' ? fb.slice(0, 1000) : ''
    total += clamped
    max_total += c.max
  }
  const feedback = typeof parsed.feedback === 'string' ? parsed.feedback.slice(0, 2000) : ''

  const now = new Date().toISOString()
  const { error: upsertErr } = await supabase.from('evaluations').upsert({
    submission_id,
    scores,
    feedback_by_criterion,
    total,
    max_total,
    feedback,
    graded_by,
    graded_at: now,
    updated_at: now,
  }, { onConflict: 'submission_id' })

  if (upsertErr) return json(500, { error: 'DB upsert failed', detail: upsertErr.message })

  return json(200, { ok: true, submission_id, total, max_total, scores, feedback_by_criterion, model })
})
