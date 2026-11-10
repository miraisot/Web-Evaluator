// Backs up the live database into backups/<timestamp>-<project>/ without
// needing pg_dump or Docker. Reads everything in one read-only snapshot, so it
// cannot change the database.
//
//   data.sql      every row of the public tables plus auth users/identities,
//                 as upserts in foreign-key order. Running it puts those rows
//                 back to their dumped values; rows created later are kept.
//   security.sql  the live RLS settings, policies, functions and triggers, to
//                 compare with supabase/schema.sql (db:apply would overwrite
//                 any policy edited by hand in the dashboard) or restore them.
//
// Table structure comes from supabase/schema.sql. Files in Supabase Storage
// (project assets) live outside the database and are not included; neither
// are login sessions, so users sign in again after a restore.
// Connection setup: see scripts/lib/db-env.mjs.
//
//   npm run db:dump

import { mkdirSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const SCHEMAS = ['public']
const EXTRA_TABLES = ['auth.users', 'auth.identities']
const POLICY_SCHEMAS = ['public', 'storage']

const ident = s => '"' + s.replace(/"/g, '""') + '"'

export async function dumpDatabase(db, { label }) {
  await db.query('begin isolation level repeatable read read only')
  try {
    // Every type, function and table name in the output comes out fully
    // qualified, so the files restore under any search_path.
    await db.query("set local search_path = ''")
    await db.query("set local timezone = 'UTC'")
    const tables = await listTablesInDependencyOrder(db)

    const data = [
      `-- Web Eval data backup: ${label}`,
      '-- Restore: run supabase/schema.sql first if the tables are missing, then',
      '-- this file. Rows are upserted by primary key.',
      '',
      'begin;',
    ]
    const counts = []
    for (const t of tables) {
      const n = await dumpTable(db, t, data)
      counts.push({ table: `${t.schema}.${t.name}`, rows: n })
    }
    data.push('', 'commit;', '')

    const security = await dumpSecurity(db, tables, label)
    await db.query('commit')
    return { dataSql: data.join('\n'), securitySql: security, counts }
  } catch (e) {
    await db.query('rollback').catch(() => {})
    throw e
  }
}

async function listTablesInDependencyOrder(db) {
  const { rows: tables } = await db.query(
    `select c.oid::int8::text as oid, n.nspname as schema, c.relname as name, c.relrowsecurity as rls
       from pg_catalog.pg_class c
       join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where c.relkind = 'r'
        and (n.nspname = any($1::text[]) or n.nspname || '.' || c.relname = any($2::text[]))
      order by n.nspname, c.relname`,
    [SCHEMAS, EXTRA_TABLES],
  )
  const { rows: fks } = await db.query(
    `select conrelid::int8::text as child, confrelid::int8::text as parent
       from pg_catalog.pg_constraint where contype = 'f'`,
  )

  // Parents before children, so inserts never hit a missing foreign key.
  const byOid = new Map(tables.map(t => [t.oid, t]))
  const parents = new Map(tables.map(t => [t.oid, new Set()]))
  for (const { child, parent } of fks) {
    if (child !== parent && byOid.has(child) && byOid.has(parent)) parents.get(child).add(parent)
  }
  const ordered = []
  const done = new Set()
  while (ordered.length < tables.length) {
    const ready = tables.filter(t => !done.has(t.oid) && [...parents.get(t.oid)].every(p => done.has(p)))
    // A foreign-key cycle: take the rest in name order rather than loop forever.
    const next = ready.length ? ready : tables.filter(t => !done.has(t.oid))
    for (const t of next) { ordered.push(t); done.add(t.oid) }
    if (!ready.length) break
  }
  return ordered
}

async function dumpTable(db, t, out) {
  const { rows: cols } = await db.query(
    `select a.attname as name,
            pg_catalog.format_type(a.atttypid, a.atttypmod) as type,
            a.attgenerated <> '' as generated,
            a.attidentity = 'a' as identity_always,
            coalesce(a.attnum = any(i.indkey), false) as pk
       from pg_catalog.pg_attribute a
       left join pg_catalog.pg_index i on i.indrelid = a.attrelid and i.indisprimary
      where a.attrelid = $1::int8::oid and a.attnum > 0 and not a.attisdropped
      order by a.attnum`,
    [t.oid],
  )
  // Generated columns are recomputed by Postgres and cannot be inserted.
  const insertable = cols.filter(c => !c.generated)
  const pk = insertable.filter(c => c.pk).map(c => c.name)
  const table = `${ident(t.schema)}.${ident(t.name)}`

  // Postgres quotes every value itself, so any type round-trips exactly.
  const select = insertable.map((c, i) => `pg_catalog.quote_nullable(${ident(c.name)}::text) as c${i}`).join(', ')
  const order = pk.length ? ` order by ${pk.map(ident).join(', ')}` : ''
  const { rows } = await db.query(`select ${select} from ${table}${order}`)

  const columnList = insertable.map(c => ident(c.name)).join(', ')
  const overriding = insertable.some(c => c.identity_always) ? ' overriding system value' : ''
  const nonKey = insertable.filter(c => !c.pk)
  const onConflict = !pk.length
    ? ''
    : nonKey.length
      ? ` on conflict (${pk.map(ident).join(', ')}) do update set ${nonKey.map(c => `${ident(c.name)} = excluded.${ident(c.name)}`).join(', ')}`
      : ` on conflict (${pk.map(ident).join(', ')}) do nothing`

  out.push('', `-- ${t.schema}.${t.name}: ${rows.length} row(s)`)
  for (const r of rows) {
    const values = insertable.map((c, i) => `${r[`c${i}`]}::${c.type}`).join(', ')
    out.push(`insert into ${table} (${columnList})${overriding} values (${values})${onConflict};`)
  }
  return rows.length
}

async function dumpSecurity(db, tables, label) {
  const out = [`-- Web Eval live security definitions: ${label}`, '']

  out.push('-- Row level security')
  for (const t of tables.filter(t => t.schema !== 'auth')) {
    out.push(`alter table ${ident(t.schema)}.${ident(t.name)} ${t.rls ? 'enable' : 'disable'} row level security;`)
  }

  const { rows: policies } = await db.query(
    `select schemaname, tablename, policyname, permissive, cmd, qual, with_check,
            (select string_agg(pg_catalog.quote_ident(r), ', ') from unnest(roles) r) as roles
       from pg_catalog.pg_policies
      where schemaname = any($1::text[])
      order by schemaname, tablename, policyname`,
    [POLICY_SCHEMAS],
  )
  out.push('', '-- Policies')
  for (const p of policies) {
    const on = `${ident(p.schemaname)}.${ident(p.tablename)}`
    out.push(`drop policy if exists ${ident(p.policyname)} on ${on};`)
    out.push(
      `create policy ${ident(p.policyname)} on ${on} as ${p.permissive.toLowerCase()} for ${p.cmd.toLowerCase()} to ${p.roles}` +
      (p.qual ? `\n  using (${p.qual})` : '') +
      (p.with_check ? `\n  with check (${p.with_check})` : '') + ';',
    )
  }

  const { rows: functions } = await db.query(
    `select pg_catalog.pg_get_functiondef(p.oid) as def
       from pg_catalog.pg_proc p
       join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = any($1::text[]) and p.prokind = 'f'
        and not exists (select 1 from pg_catalog.pg_depend d where d.objid = p.oid and d.deptype = 'e')
      order by p.proname`,
    [SCHEMAS],
  )
  out.push('', '-- Functions')
  for (const f of functions) out.push(f.def.trimEnd() + ';', '')

  const { rows: triggers } = await db.query(
    `select t.tgname as name, c.oid::int8::text as oid, pg_catalog.pg_get_triggerdef(t.oid) as def,
            pg_catalog.quote_ident(n.nspname) || '.' || pg_catalog.quote_ident(c.relname) as on_table
       from pg_catalog.pg_trigger t
       join pg_catalog.pg_class c on c.oid = t.tgrelid
       join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where not t.tgisinternal
      order by n.nspname, c.relname, t.tgname`,
  )
  const dumped = new Set(tables.map(t => t.oid))
  out.push('-- Triggers')
  for (const t of triggers.filter(t => dumped.has(t.oid))) {
    out.push(`drop trigger if exists ${ident(t.name)} on ${t.on_table};`, `${t.def};`)
  }
  out.push('')
  return out.join('\n')
}

async function main() {
  const { connectToAppDatabase } = await import('./lib/db-env.mjs')
  const { client, appRef } = await connectToAppDatabase()
  const takenAt = new Date().toISOString()
  const label = `project ${appRef ?? '(unknown)'}, taken ${takenAt}`

  let result
  try {
    result = await dumpDatabase(client, { label })
  } catch (e) {
    console.error(`\n✖ Dump failed: ${e.message}\nNothing was written.`)
    await client.end()
    process.exit(1)
  }
  await client.end()

  // Contains emails and password hashes: readable by you only, never committed.
  const dir = `backups/${takenAt.replace(/[:.]/g, '-')}-${appRef ?? 'db'}`
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  writeFileSync(`${dir}/data.sql`, result.dataSql, { mode: 0o600 })
  writeFileSync(`${dir}/security.sql`, result.securitySql, { mode: 0o600 })

  for (const c of result.counts) console.log(`  ${String(c.rows).padStart(6)}  ${c.table}`)
  console.log(`\nSaved to ${dir}/ (data.sql, security.sql).`)
  console.log('It contains user emails and password hashes: keep it private.')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
