# Throughline — End-to-End Architecture & Wiring

> How **every feature and sub-feature** connects — data, routes, realtime, storage, AI jobs —
> and how they thread into each other so the whole is worth far more than the parts.
> Companion to [`throughline-master-plan.md`](./throughline-master-plan.md). Stack: Next.js 16 (RSC) ·
> Supabase (Postgres + RLS + Realtime) · Cloudflare R2 · job-queue/worker · LiveKit · Stripe · model APIs.

The core idea: Throughline is not a pile of features — it's **seven spines** that every feature plugs
into, plus a handful of **golden threads** that run a unit of value all the way across the product.
Build the spines once; every feature inherits tenancy, realtime, cost, and provenance for free.

---

## 0. Topology (request → result)

```
Browser (RSC + "use client" islands, Zustand)
   │  cookies/session
   ▼
proxy.ts (edge) ── refresh session · role routing · org resolution
   │
   ├──► Server Components / Server Actions ──► Supabase (RLS as user)
   ├──► Route Handlers (/api/*) ──► supabaseAdmin (service role) for authorized writes
   │
   ├──► Job Queue (Inngest/Trigger) ──► Workers ──► model APIs / ffmpeg-transcode ──► R2
   ├──► R2 (presigned PUT/GET, /raw proxy, HLS packager)
   ├──► LiveKit (WebRTC: meetings + live co-direction data channels)
   └──► Stripe (subscriptions + invoice/release webhooks)

Realtime back-channel: Postgres changes + broadcast + presence ──► every open client
```

Two hard rules that never bend (already true in the repo): **direct browser→R2 uploads** (no server
buffering), and **RLS is the authorization boundary** — service role only on authorized server paths.

---

## 1. SPINE — Tenancy & Identity (everything hangs off this)

**Tables:** `organizations(id, name, subdomain, logo_url, branding, plan, …)`. Every domain table carries
`organization_id` **from birth**. Identity lives in `app_metadata` (role, client_id — never user_metadata;
see [`role.ts`](../lib/auth/role.ts)). `team_members(org_id, user_id, role)` and
`client_contacts(client_company_id, user_id, role_type)` extend it into RBAC.

**Wiring:**
- `proxy.ts` resolves the active org (single-tenant default while `NEXT_PUBLIC_ENABLE_SAAS_FLOWS=false`;
  subdomain/user-profile when true) and stamps it on the request.
- RLS helper `current_org()` + `is_admin()` / `is_team_member()` gate every policy:
  `using (organization_id = current_org() and …)`.
- **Connects to:** *all* features — it's the membrane that keeps tenants apart and decides who sees Crew
  vs Client vs Workspace. Storage keys are org-prefixed (`<org>/<client>/<project>/…`) so even R2 is partitioned.

## 2. SPINE — The Event/Activity bus (the nervous system)

**Table:** `activity_log` (already exists) — append-only, hash-chained for tamper-evidence (Provenance reads it too).
Every meaningful action calls `recordActivity()` → `log_activity` (service-role only, now locked down).

**Wiring:**
- Insert → Supabase Realtime fires → `lib/realtimeBus.ts` fans out → notifications bell, presence, badge
  counts, live lists, and the **page-in-view** dock all update with **no refresh** (the "realtime everywhere" rule).
- **Connects to:** review comments, approvals, generations, payments, task moves, lead events — they all
  *emit* to this bus, and every surface *subscribes*. One write, the whole app reacts.

## 3. SPINE — The Graph (universal runtime for film **and** automation)

The single most leveraged system. A node-DAG editor (React Flow) whose runs execute on the job-queue/worker
layer. **Film generation and automations are the same engine** — only the node library differs.

**Tables:** `graphs(org_id, project_id, kind:'film'|'automation')`, `graph_nodes(graph_id, type, config, position)`,
`graph_edges(from, to)`, `graph_runs(graph_id, status, cost_cents, started_at)`, `graph_run_steps(run_id, node_id, status, input, output, asset_id)`.

**Wiring:**
- Edit on canvas → autosave nodes/edges. "Run" → enqueue a `graph_run` → worker walks the DAG, each node
  calls its handler (a model API, an enrich step, a transcode, an HTTP call), writing `graph_run_steps`.
- Long jobs never touch a request handler — they live in the worker; status streams back via Realtime.
- **Connects to:** Generation Hub & Remaster (film nodes), Lead-Gen (automation nodes), Continuity (a lock
  node), Provenance (a sign node), Storyboard (frames are graph outputs), Control Tower (every run meters cost).

## 4. SPINE — Credit & Cost (what makes enterprise say yes)

**Tables:** `usage_events(org_id, kind, units, cost_cents, ref)`, `org_budgets(org_id, monthly_cap_cents, alert_pct)`,
`org_credits(org_id, balance)`.

**Wiring:**
- *Every* metered action (a model call, a transcode, a LiveKit minute) writes a `usage_event` at the worker
  boundary. The **Control Tower** aggregates them live (Realtime) into spend, budget %, and per-project margin.
- Budget gates: a node won't run past a cap without an approval (a `task` routed to an Approver).
- **Connects to:** Monetization — the same meter becomes usage-based invoice lines via Stripe; and the Graph,
  which checks budget before dispatching expensive nodes.

## 5. SPINE — Provenance & Rights (the trust layer)

**Tables:** `asset_provenance(asset_id, model, prompt, seed, parent_asset_id, signature, created_by)`,
`rights(asset_id, license, commercial_ok, talent_consent, expires_at)`.

**Wiring:**
- A Graph "sign" node (or the commit step) writes provenance + a C2PA-style signature on every generated asset,
  recording lineage (which model, prompt, parent version, who). Rights/clearance are attached here.
- **Connects to:** the DAM (provenance = an asset's permanent record), Review/Guest links (a reviewer sees
  "broadcast-cleared"), Release-on-payment (won't release un-cleared masters), and the audit trail.

## 6. SPINE — Storage & Media (R2 + transcode)

**Tables:** `files` (exists; gets `parent_file_id` for version stacking, `asset_id`, `organization_id`).

**Wiring:**
- Upload: `presign → browser PUT → commit` (unchanged). New: a **transcode worker** produces proxies + HLS
  (AES-128 for high-value cuts) and frame-accurate thumbnails; outputs land back in R2.
- Read: `getSignedDownloadUrl` (inline) and the same-origin `/raw` proxy (parse types) already branch on
  `bucket==='r2'`. Frame-accurate review streams the proxy; final masters stay locked until release.
- **Connects to:** Version stacking & side-by-side compare (parent/child files), Generation Hub (outputs),
  Remaster (in/out), Review (proxies), Deliverables (masters), Watermarking (overlay + forensic mark).

## 7. SPINE — Realtime & Presence (Supabase + LiveKit)

**Wiring:** Supabase Realtime carries data/presence (already in `presence-store.ts`, heartbeat, broadcast).
**LiveKit** carries live A/V + low-latency data channels.
- **Connects to:** Live Co-Direction (synced playhead + cursors over LiveKit data), Meetings, Team Chat
  typing/read receipts, and the page-in-view dock that survives navigation (global overlay above the route tree, Zustand-persisted).

---

## 8. Feature wiring by space

Each feature below lists **model → route → realtime → storage/jobs → links** (the links are the value).

### 🎬 Workspace

**Storyboard ⇄ Workflow (split, page-in-view)**
- Model: `storyboards`, `storyboard_frames(image_path, script, notes, sort_order, visible_to_client)`.
- Route: Server Action for reorder/visibility; frames render from R2 signed URLs.
- Realtime: drag-reorder + visibility toggles broadcast to all viewers; client view filtered by `visible_to_client`.
- Links: frames are **Graph outputs** (Thread A); the WF pane *is* the Graph for this project; the whole
  session docks via the **page-in-view** overlay [Spine 7].

**The Graph** — [Spine 3]. **Generation Hub** — a palette of model nodes (Kling/Runway/Higgsfield/…) keyed by
org-stored API keys; every generation = a `graph_run_step` → asset → provenance → DAM, metered by [Spine 4].
**Remaster** — a node calling Topaz/fal upscale; in/out via R2 [Spine 6]. **Continuity** — a lock node holding
character/style/LUT refs injected into downstream generation prompts; keeps shots coherent. **Model Arena** —
fan-out node: same prompt → N models in parallel → side-by-side compare → pick promotes the winner asset.
**DAM** — search/tag/collections over `files`+`asset_provenance` with lineage. **Provenance & Rights** — [Spine 5].

### 🤝 Client

**Overview / Projects** — `projects` (gets `organization_id`, `client_company_id`); progress from
`project_phases` + `project_completion()`. **Review & Approvals** — `video_comments(file_id, timecode_smpte,
drawing_json, author)`; the player captures SMPTE timecode + canvas markup; **Live Co-Direction** over LiveKit
[Spine 7]; approvals write to `activity_log` [Spine 2] and flip a version to **signed/locked** (e-sign cert PDF).
**Deliverables / Vault** — `files` with version stacking + compare [Spine 6]; **Guest Review Links** —
`review_links(token, expires, password_hash, can_download)` → public `/review/[token]` route, RLS-scoped,
no account. **Invoices & Payments** + **Release-on-payment** — Stripe webhook → on `paid`, unlock the master's
signed URL [Thread B]. **Companies & Contacts** — `client_companies`, `client_contacts` with Viewer/Approver RBAC.

### 👥 Crew

**Team Chat** — `messages.is_internal=true`, strictly filtered from client UI. **Tasks** — `tasks.assigned_to`
→ `team_members`. **CRM · Pipeline** — `leads`, `deals(stage)` feeding the Client space on win. **Lead-Gen
Pipelines** — automation graphs [Spine 3]: scrape→enrich→qualify→outreach (Instantly/Smartlead) → create a
`deal` [Thread C]. **Control Tower** — [Spine 4]. **Meetings** — LiveKit rooms + a meeting log on the project
timeline. **Team Directory** — `team_members` + presence.

---

## 9. Golden threads (the back-to-back value)

These named flows cross many features — they're why the app compounds in value.

- **Thread A — Prompt → Shot:** Workspace prompt → Graph generation node (Model Arena pick) → Continuity lock
  applied → Remaster 4K → Provenance signs → asset lands in DAM → auto-placed as a **storyboard frame** →
  cost metered to Control Tower → activity event lights the bell. *One prompt touches 6 systems.*

- **Thread B — Cut → Review → Approve → Pay → Release:** Workspace publishes a cut → Client **frame-accurate
  review** (timecoded + markup, live) → **e-sign approval** locks the version + PDF cert → invoice issued →
  Stripe `paid` webhook → R2 master **unlocks** → deliverable appears → audit trail + provenance prove the chain.

- **Thread C — Lead → Deal → Client → Project:** Crew lead-gen **graph** scrapes/enriches/qualifies → outreach
  reply → `deal` won → spins up a **client company + contacts** → a **project** in the Client space → work begins
  in Workspace. *The automation engine feeds your own funnel — dogfooding the product.*

- **Thread D — Cost → Budget → Bill:** every Graph run / transcode / LiveKit minute writes a `usage_event` →
  Control Tower shows live spend & margin → caps gate expensive runs → at month close the same meter becomes
  usage-based Stripe invoice lines (Layer-2 SaaS).

- **Thread E — Any event → live everywhere:** any write → `activity_log` → Realtime fan-out → bell, badges,
  presence, lists, and page-in-view update instantly, on every open device. The product always feels *alive*.

---

## 10. Multi-tenancy & security wiring (threaded through all of the above)

- **Column:** `organization_id` on every table; **RLS:** `organization_id = current_org()` + role checks via
  `is_admin()`/`is_team_member()`/contact role. **Storage:** org-prefixed R2 keys. **Jobs:** every queue payload
  carries `org_id`; workers use it for metering + key namespacing. **AI keys:** stored per-org (encrypted),
  never shared across tenants. **Provenance/audit:** per-org ledgers. **Billing:** per-org budgets & subscription.
- Enterprise layer rides the same rails: forensic watermark (per-viewer mark at the transcode/stream boundary),
  content moderation (a Graph gate before client delivery), brand guardrails (a check node), SSO/SCIM (Supabase
  SAML on Pro), data export (per-org dump). None of these are bolt-ons — they're nodes/policies on existing spines.

---

## 11. Build order → which spine each phase lights up

| Phase | Lights up |
|---|---|
| **0 Foundations** | Tenancy [1] + Event bus [2] + page-in-view shell [7] + the 3-space IA |
| **1 Revenue wedge** | Storage/media [6] + Provenance [5] (frame review, versioning, watermark, release-on-pay → Thread B) |
| **2 Workspace core** | The Graph [3] (Storyboard⇄Workflow, Continuity v1) |
| **3 AI engine** | Generation Hub + Model Arena + Remaster + Cost spine [4] → Thread A & D |
| **4 Enterprise + Crew** | Rights/forensic, DAM, CRM, team chat, IAM |
| **5 Automation domain** | Lead-gen graphs + outreach + LiveKit/Cal.com → Thread C |
| **6 Monetization** | Subscriptions, white-label, flip the SaaS flag |

Build the spine, hang the feature, connect the thread. That sequence is what turns a portal into Throughline.
