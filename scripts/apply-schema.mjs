// Applies supabase/schema.sql to the Supabase Postgres database in a single
// transaction, then reloads PostgREST's schema cache so the API sees new
// tables immediately. schema.sql is idempotent, so re-running is safe; if any
// statement fails, nothing is changed and the failing line is printed.
// Connection setup: see scripts/lib/db-env.mjs.
//
//   npm run db:apply

import { readFileSync } from 'node:fs'
import { connectToAppDatabase, fail } from './lib/db-env.mjs'

const SCHEMA = 'supabase/schema.sql'
const EXPECTED_TABLES = ['profiles', 'projects', 'project_assets', 'assignments', 'submissions', 'submission_drafts']

const sql = readFileSync(SCHEMA, 'utf8')
const { client } = await connectToAppDatabase()

try {
  await client.query('begin')
  await client.query(sql)
  await client.query("notify pgrst, 'reload schema'")
  await client.query('commit')
  console.log(`Applied ${SCHEMA} and reloaded the API schema cache.`)
} catch (e) {
  await client.query('rollback').catch(() => {})
  const line = e.position ? sql.slice(0, Number(e.position)).split('\n').length : null
  console.error(`\n✖ ${SCHEMA}${line ? `:${line}` : ''}: ${e.message}`)
  if (line) console.error(`  > ${sql.split('\n')[line - 1].trim()}`)
  console.error('Rolled back; the database is unchanged.')
  await client.end()
  process.exit(1)
}

const { rows } = await client.query(
  `select t, to_regclass('public.' || t) is not null as present from unnest($1::text[]) as t`,
  [EXPECTED_TABLES],
)
await client.end()

for (const r of rows) console.log(`  ${r.present ? '✓' : '✖'} public.${r.t}`)
if (rows.some(r => !r.present)) fail('Some tables are still missing.')
console.log('\nDone. Reload the Solve page; the header should show "Saved" after an edit.')
