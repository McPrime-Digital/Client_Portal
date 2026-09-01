/**
 * Operator SQL runner over the Supabase Management API.
 * Usage: npx tsx scripts/ops/db-query.ts "<sql>"   or   npx tsx scripts/ops/db-query.ts --file path.sql
 * Reads SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF from .env.local. Never logs the token.
 */
import { readFileSync } from 'fs'
const env: Record<string, string> = {}
for (const raw of readFileSync('.env.local', 'utf8').split('\n')) {
  const l = raw.trim(); if (!l || l.startsWith('#')) continue
  const i = l.indexOf('='); if (i < 0) continue
  env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '')
}
const token = env.SUPABASE_ACCESS_TOKEN, ref = env.SUPABASE_PROJECT_REF
if (!token || !ref) { console.error('missing SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF'); process.exit(1) }
async function main() {
  const arg = process.argv[2]
  const sql = arg === '--file' ? readFileSync(process.argv[3], 'utf8') : arg
  if (!sql) { console.error('no sql given'); process.exit(1) }
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  const text = await res.text()
  if (!res.ok) { console.error(`HTTP ${res.status}: ${text.slice(0, 2000)}`); process.exit(1) }
  try { console.log(JSON.stringify(JSON.parse(text), null, 2).slice(0, 8000)) } catch { console.log(text.slice(0, 8000)) }
}
main()
