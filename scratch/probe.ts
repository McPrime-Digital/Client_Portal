import { createClient } from '@supabase/supabase-js'
import { loadEnv, requireEnv } from '../scripts/harness-constants'
const env = loadEnv()
const admin = createClient(requireEnv(env,'NEXT_PUBLIC_SUPABASE_URL'), requireEnv(env,'SUPABASE_SERVICE_ROLE_KEY'), { auth:{persistSession:false,autoRefreshToken:false} })
const show = (label: string, v: unknown) => console.log(label.padEnd(44), JSON.stringify(v))
async function main() {
  const primeos = await admin.from('usage_events').select('*',{count:'exact',head:true}).eq('kind','primeos')
  show('usage_events kind=primeos', { count: primeos.count, error: primeos.error?.message })
  const aitok = await admin.from('usage_events').select('*',{count:'exact',head:true}).eq('kind','ai.text.tokens')
  show('usage_events kind=ai.text.tokens', { count: aitok.count, error: aitok.error?.message })
  const all = await admin.from('usage_events').select('kind, units, cost_cents, created_at').order('created_at',{ascending:false}).limit(100)
  const counts: Record<string, number> = {}
  for (const r of all.data ?? []) counts[r.kind] = (counts[r.kind] ?? 0) + 1
  show('usage_events last100 by kind', counts)
  const budgets = await admin.from('org_budgets').select('organization_id, hard_stop, monthly_cap_cents')
  show('org_budgets', budgets.data ?? budgets.error?.message)
  const credits = await admin.from('org_credits').select('organization_id, balance_cents')
  show('org_credits', credits.data ?? credits.error?.message)
  const orgs = await admin.from('organizations').select('id, name, type, region, plan')
  show('organizations', orgs.data ?? orgs.error?.message)
  const om = await admin.from('organization_members').select('organization_id, user_id, email, role, roles, status')
  show('organization_members', (om.data ?? []).map(m=>({org:String(m.organization_id).slice(0,8),u:m.user_id?String(m.user_id).slice(0,8):null,e:m.email,r:m.role,rr:m.roles,s:m.status})))
  const cl = await admin.from('clients').select('id, organization_id, email, user_id')
  show('clients', (cl.data ?? []).map(c=>({id:String(c.id).slice(0,8),org:String(c.organization_id).slice(0,8),e:c.email,u:c.user_id?String(c.user_id).slice(0,8):null})))
  show('clients with NULL user_id', (cl.data ?? []).filter(c=>!c.user_id).length + ' of ' + (cl.data??[]).length)
  const cm = await admin.from('client_members').select('client_id, user_id, role, status')
  show('client_members', (cm.data ?? []).map(m=>({c:String(m.client_id).slice(0,8),u:m.user_id?String(m.user_id).slice(0,8):null,r:m.role,s:m.status})))
  const led = await admin.from('credit_ledger').select('reason, delta_cents').limit(20)
  show('credit_ledger', led.data ?? led.error?.message)
}
main().catch(e=>{console.error('PROBE FAILED', e.message); process.exit(1)})
