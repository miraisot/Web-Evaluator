// Shared connection setup for the db:* scripts.
//
// Needs SUPABASE_DB_URL in .env: Supabase dashboard → Connect → "Session
// pooler" connection string (port 5432), with your database password filled
// in. It has no VITE_ prefix, so Vite never ships it to the browser.
//
// Optional SUPABASE_DB_CA: path to the server certificate from
// Project Settings → Database → SSL Configuration, to verify the server.

import { existsSync, readFileSync } from 'node:fs'
import pg from 'pg'

export function fail(msg) {
  console.error(`\n✖ ${msg}\n`)
  process.exit(1)
}

// Connects to the database of the project the app itself uses
// (VITE_SUPABASE_URL), and refuses to connect anywhere else.
export async function connectToAppDatabase() {
  if (existsSync('.env')) process.loadEnvFile('.env')

  const url = process.env.SUPABASE_DB_URL
  if (!url) {
    fail(`SUPABASE_DB_URL is not set.

Add it to .env (one line, no quotes):

  SUPABASE_DB_URL=postgresql://postgres.<project-ref>:<db-password>@aws-0-<region>.pooler.supabase.com:5432/postgres

Copy it from Supabase dashboard → Connect → "Session pooler". Forgot the
password? Project Settings → Database → Reset database password.`)
  }
  if (url.includes('[YOUR-PASSWORD]')) {
    fail('SUPABASE_DB_URL still contains [YOUR-PASSWORD]; replace it with your database password.')
  }

  const appRef = process.env.VITE_SUPABASE_URL?.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1]
  if (appRef && !url.includes(appRef)) {
    fail(`SUPABASE_DB_URL is for a different project than the app.
The app (VITE_SUPABASE_URL) uses project "${appRef}"; copy the connection
string from that project's dashboard.`)
  }

  const ca = process.env.SUPABASE_DB_CA
  const ssl = ca ? { ca: readFileSync(ca, 'utf8') } : { rejectUnauthorized: false }
  const client = new pg.Client({ connectionString: url, ssl })
  try {
    await client.connect()
  } catch (e) {
    fail(`Could not connect: ${e.message}
Use the "Session pooler" string (the direct db.<ref>.supabase.co host is
IPv6-only and fails on many networks), and check the password.`)
  }
  console.log(`Connected to project ${appRef ?? '(unknown)'}${ca ? '' : ' (TLS without certificate check; set SUPABASE_DB_CA to verify)'}.`)
  return { client, appRef }
}
