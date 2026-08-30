# Genreline — S0-B: Product Identity & Domain

**Status:** Settled. Supersedes the product name in all prior specs.
**Date:** 2026-08-30
**Supersedes:** the product name "Throughline" wherever it appears in `S0`, `S0-A`, `S1-P`, `S-V`, `S1`, `S2` and `HANDOFF`.
**Rule:** per the working agreement, prior documents are not edited. Their text stands as the record of what was believed at the time. This entry governs.

---

## 1. The decisions

**PI-1 — The product is Genreline.** "Throughline" was the working name through the spec phase and is retired. Every new document, identifier, UI string and email uses Genreline.

**PI-2 — Genreline is its own product, not McPrime Digital's.** It began as McPrime's internal portal and is no longer that. `S0` P-1 already established McPrime as tenant zero and a dependent user rather than the customer; PI-2 completes it — McPrime is now one tenant among the intended many, with no special claim on the product.

**PI-3 — The production domain is `genreline.com`.** `genreline.studio`, `genreline.io` and `genreline.ai` are planned. The application must therefore treat its own hostname as configuration, never as a literal.

**PI-4 — Client-facing surfaces carry a "Powered by Genreline" attribution, removable as a paid plan feature.** Default is shown. Removal is an entitlement, resolved through the plan axis in `S-V` §8, never a per-org boolean or a code branch.

---

## 2. The distinction that governs every renaming decision

There are **two identities in this product and they are not the same rename.**

| Identity | What it is | Who sees it |
|---|---|---|
| **Product identity** | Genreline. The SaaS the studio bought. | The studio |
| **Tenant identity** | McPrime Digital, Studio Two, etc. The studio's own brand. | The studio's clients |

The live site currently shows tenant identity hardcoded: `genreline.com/login` renders "McPrime Digital — Client Portal", the McPrime logo, and "© 2026 McPrime Digital." `S0` P-1 already calls this a defect — *hardcoded McPrime identity is a defect, not a shortcut* — and `S-V` §13.1 lists per-tenant identity as v1 foundation work.

**The trap to avoid.** Replacing "McPrime Digital" with "Genreline" on the portal would swap one wrong name for another. A client of McPrime bought from McPrime. They have no relationship with Genreline beyond the attribution line in PI-4.

**The rule: the portal wears the tenant's brand. The product wears its own.**

---

## 3. Where each name belongs

| Surface | Name shown | Source |
|---|---|---|
| Marketing site, signup, pricing | Genreline | Product constant |
| Billing emails, receipts, plan and quota notices | Genreline | Product constant |
| Studio-side app chrome — nav, page titles, footer | Genreline, with the studio's logo as tenant context | Both |
| **Client portal — login, dashboard, page titles** | **The tenant's name and logo**, plus the PI-4 attribution | `organizations`, `business_settings` |
| **Notification sender identity — email, SMS, push** | **The tenant's name** | `S-V` §X-6: per-tenant sender identity, never a hardcoded company name |
| Invoices, bank details, remittance | The tenant's | `business_settings`, per-tenant since 0018 |
| Activity ledger, approval certificates | The tenant's | Same |

The data for every tenant-identity row already exists. `business_settings` became per-tenant in migration 0018 and `organizations` carries name, logo and branding. **The pages are not reading it.** This is a wiring gap, not a schema gap.

---

## 4. Attribution as an entitlement

PI-4 is deliberately built as a plan feature rather than a flag, because the entitlement model already exists and a flag would have to be unpicked later.

- A feature key governs removal. **Unmapped means denied means the badge shows** — the default-deny polarity established in `S2` §5 works in the product's favour here without a special case.
- No org-level boolean. No code branch testing for a tenant id. `S0` P-1 and the house-org lesson from Batch 7 item 5 both apply: a carve-out written as a stated, plan-resolved value is a decision; the same carve-out written as an id comparison is a defect.
- Billing for it is not wired in v1. `lib/billing/plans.ts` currently has zero importers. Defining the key now and leaving it unsold is seam-marking, not scope creep.

---

## 5. Domain portability

Four domains are planned. That makes the hostname a moving part, and `S0` §3's prime directive applies in spirit: nothing that will change should be written down in forty places.

**Requirement.** One source of truth for the application's public origin — a single environment variable, read everywhere. No literal hostname in any route, email template, invite link, password-reset link, push payload, CORS rule or redirect.

**The operational half, which is not in code.** Supabase Auth holds its own Site URL and redirect allowlist as project configuration. Changing domains without updating those breaks every invite link and every password-reset link, silently, for everyone. That is a deploy-time checklist item, not something a migration or a build can catch.

**Seam noted for later.** Per-tenant custom domains — `studio-two.genreline.com`, or a studio's own domain — are a v2 concern. Carrying the origin as configuration now is what makes that a feature rather than a rewrite, the same argument `AD-002` made for the `region` column.

---

## 6. What the rename touches

**Mechanical.** Product-name strings, page metadata and titles, the README, `CLAUDE.md`, package name, repo description.

**Not mechanical — prose that uses the word literally.** `S-V` §1 states the thesis as *"Nobody owns the throughline."* That sentence is an argument, not a label, and a find-replace would turn it into nonsense. Any spec prose using the word as a common noun is rewritten by hand or left as historical text.

**Separate work, same files.** The per-tenant identity fix in §3 shares files with the rename but is a different change: reading tenant branding from the database rather than substituting one constant for another. They land in separate commits so either can be reverted alone.

---

## 7. Carried forward

**Legal entity is unresolved and sits on the critical path.** Genreline is not yet under a company; the intent is to place it under the software company. `S-V` §13 defines v1 done as "studio two is live and paying," and a subscription invoice needs an entity to issue it. This is not urgent this month and it is not optional before first revenue.

Consequences to settle when it lands: the copyright line on product surfaces, the entity named on a subscription invoice, and whether `business_settings`-style records are needed for Genreline itself as distinct from any tenant.

---

*End of S0-B. Governs product identity, domain and attribution. Does not alter any architecture decision in S0 or S0-A.*
