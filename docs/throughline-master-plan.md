# Throughline — Master Plan

> A creative production & automation workspace ("studio OS"). Built by an **AI-native
> production company** that produces AI commercial films and original films made entirely
> with AI, plus enterprise-grade automations. Pivoted from the McPrime single-tenant client portal.
>
> **Status:** planning. No build started. This doc is the source of truth for scope + sequencing.

## Locked names
- **Product:** Throughline
- **Internal/team space:** Crew
- **AI compress/enhance/upscale tool:** Remaster

## The 3-space architecture (left rail = spaces, not boxes of links)
- **Crew** — internal/team only: team chat, collaboration, task assignment, meetings, CRM/pipeline, Control Tower.
- **Client** — client-facing: messages/files/invoices/approvals + client multi-user personas (Viewer/Approver).
- **Workspace** — the work: Storyboard + Workflow side-by-side, The Graph, Continuity, Model Arena, Remaster, AI generation hub.

Persistent **page-in-view**: SB&WF can maximize (full session) / minimize (tab) / hover → zoomed-out
floating panel that survives refresh + navigation everywhere. Global overlay above the route tree
(Zustand + persisted). Single-key SB↔WF switch.

---

## Feature master list

Legend: 🟢 build first (revenue wedge) · 🟡 soon · 🟠 defer · 🔴 skip/thin for now · 🧱 foundation · ⏳ pending · (native) build in-house · (adapt) source-and-adapt from a repo

### 🧱 Foundations (before any feature)
- **F1 — Capture live Supabase schema → baseline migration.** Repo has no schema source-of-truth today. PREREQ. (native)
- **F2 — `organizations` table + `organization_id` on all tables + RLS rewrite**, behind `NEXT_PUBLIC_ENABLE_SAAS_FLOWS` (off). (native)
- **F3 — Convention:** every new table carries `organization_id` from birth.
- **F4 — Persistent page-in-view shell** + Zustand session store + single-key switch. (native)
- **F5 — 3-space navigation shell / IA reskin** (Crew/Client/Workspace). (native)
- **F6 — Credit-metering substrate** (Control Tower foundation; required before the AI hub). (native)
- **F7 — Provenance/audit ledger schema** (hash-chained, tamper-evident). (native)

### 🎬 Workspace
- 🟢 Frame-accurate timecoded comments + canvas annotation (FileViewer) — THE wedge (adapt)
- 🟢 Version stacking + side-by-side compare (`parent_file_id`) (native+adapt)
- 🟢 Dynamic canvas watermarking (viewer identity overlay) (native)
- 🟢 Release-on-payment (Stripe webhook → R2 unlock) — wiring; pieces already exist (native)
- 🟡 Storyboard + Workflow side-by-side (toggle client visibility) — dual-use film + automation (adapt)
- 🟡 The Graph — node pipeline; film generation AND automation on one canvas (base: React Flow) (adapt)
- 🟡 Continuity — character/style/palette/LUT consistency across shots & models (native + adapt)
- 🟡 Model Arena — multi-model generate/compare/route/fallback (native)
- 🟡 AI generation hub — aggregate model API keys; long-running jobs via queue+worker (adapt+native)
- 🟡 Remaster — AI compress/enhance/upscale via external model APIs (adapt)
- 🟡 Formal sign-off + PDF approval certificate (extend activity_log) (native)
- 🟡 DAM — FileVault → tagging/search/collections/metadata/lineage (native+adapt)
- 🟠 Script commenting (PDF.js) (adapt)
- 🔴 Encrypted HLS streaming (AES-128) — needs transcode service; defer (native infra)

### 👥 Crew
- 🟡 Team members + roles (Producer/Editor/Writer/Automation specialist) (native)
- 🟡 Internal vs client chat (`is_internal` flag, strict client filtering) (native)
- 🟡 Task assignment (`assigned_to`) (native)
- 🟡 CRM pipeline (prospect → deal → client) — feeds Client space (native+adapt)
- 🟡 Control Tower — AI cost governance, budgets, spend caps, per-project cost/margin (native)
- 🟠 Lead-gen pipelines on The Graph (scrape → enrich → qualify → handoff) (adapt)
- 🟠 Outreach via Instantly/Smartlead API integration (NOT built in-house) (adapt)
- 🟠 Meetings via LiveKit (also powers Live Co-Direction); scheduler via embedded Cal.com (adapt)

### 🤝 Client
- ✅ Existing portal (messages/files/invoices/approvals)
- 🟡 Guest review links `/review/[token]` (external stakeholders, no account) (adapt)
- 🟠 Client companies + contacts — multi-user personas (Viewer/Approver) (native)

### ✨ Elevation tier (app → category-definer)
- The Graph · Continuity · Provenance & Rights Vault (C2PA-style) · Control Tower · Model Arena · Live Co-Direction (LiveKit)

### 🛡️ Enterprise-grade layer (researched; from Frame.io/Synthesia/Cloudinary/Canva Enterprise)
- Forensic + session-based watermarking, DRM (upgrade of visible watermark; per-viewer leak tracing)
- AI content moderation (screen generations before they reach clients)
- Brand Kit + Brand Guardrails (enforce brand colors/fonts/tone on outputs)
- Model governance (approved-model allowlists per org)
- Enterprise IAM — SSO/SAML + SCIM, MFA, custom RBAC, AES-256 at rest
- Pooled credits + usage-based billing (Control Tower → invoicing)
- Data export / portability + backup (anti-lock-in + compliance)
- Auto-showcase / portfolio page generation (marketing flywheel)

### 💳 Monetization (Layer 2, last)
- 🟠 SaaS onboarding/registration + plans (Starter/Pro/Agency) (native)
- 🟠 Stripe subscriptions + billing-lock screen (native)
- 🟠 White-label / custom domains per org (schema already has branding fields) (native)
- 🟠 Flip `NEXT_PUBLIC_ENABLE_SAAS_FLOWS` → true

---

## Architecture decisions (the stack additions beyond Supabase + R2)
Supabase (Postgres+RLS+Auth+Realtime) + R2 carry multi-tenancy, auth, realtime, and cheap huge media.
Two layers must be ADDED:
1. **Job queue + worker** (long-running AI gen + Graph runs): Inngest / Trigger.dev / QStash + worker host. Can double as the Graph's durable-execution engine.
2. **Media transcode** (HLS/frame-accurate proxies): Cloudflare Stream / Mux / ffmpeg worker.

Other choices to lock:
- **Video/realtime:** LiveKit (Cloud vs self-host) — conferencing + co-direction.
- **Model access:** direct model APIs vs aggregator (fal.ai / Replicate as meta-providers).
- **GPU/upscale (Remaster):** external APIs (Replicate / fal.ai / Topaz), not self-hosted GPUs.
- **Worker hosting:** Vercel (app) + external worker (Railway / Fly.io / Cloudflare).
- **SSO/SAML:** Supabase SAML (paid tier).
- **Graph canvas base:** React Flow.
- **Scheduler:** Cal.com (embed/self-host). **Outreach:** Instantly/Smartlead.

Security: enterprise-grade WITH discipline. Real risks = RLS bugs + service-role overuse (bypasses RLS).
Mitigations: org_id-from-birth, rigorous per-table policies, service-role server-only.

---

## Pre-build checklist (must happen before feature build starts)

### A. Decisions to lock
- [ ] Lead feature: Continuity vs The Graph vs Provenance
- [ ] MVP scope: which enterprise-layer items are MVP vs later
- [ ] Rough plan tiers + what meters (informs credit/billing design)
- [ ] Confirm: lead-gen on Graph, LiveKit conferencing, Cal.com scheduler, CRM in Crew

### B. Architecture choices (see above)
- [ ] Job queue/worker · transcode · LiveKit Cloud vs self-host · model access · worker host

### C. Foundational engineering (F1–F7)
- [ ] F1 capture live schema → baseline migration
- [ ] F2 organizations + organization_id + RLS rewrite (flag off)
- [ ] F4 page-in-view shell · F5 3-space IA · F6 credit substrate · F7 provenance ledger

### D. Accounts/keys to provision (owner; Claude guides)
- [ ] Supabase plan (SAML/limits) · model API keys (Replicate/fal.ai/Kling/Runway/Higgsfield/Topaz)
- [ ] Job-queue (Inngest/Trigger) · transcode (Mux/CF Stream) · LiveKit
- [ ] Outreach (Instantly/Smartlead) · Cal.com · domain(s) for white-label

### E. Process
- [ ] Phase plan + task board · staging env / branch strategy

---

## Proposed phase plan
0. **Foundations** — F1 → F2 → F5/F4 (schema, tenancy, the 3-space shell + page-in-view)
1. **Revenue wedge** — frame-accurate review + versioning/compare + watermarking + release-on-payment (single-tenant)
2. **Workspace core** — Storyboard/Workflow + The Graph skeleton + Continuity v1
3. **AI engine** — generation hub + Model Arena + Remaster + Control Tower (credit metering)
4. **Enterprise + Crew** — Provenance/Rights, forensic watermark, DAM, CRM, team chat, IAM
5. **Automation domain** — lead-gen pipelines, outreach integration, LiveKit/Cal.com
6. **Monetization (Layer 2)** — onboarding, subscriptions, white-label, flip the SaaS flag
