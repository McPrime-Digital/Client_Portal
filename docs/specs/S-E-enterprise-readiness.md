# S-E — Enterprise readiness: what a top-tier studio requires

**Status: DRAFT.** Research compiled 2026-09-14. Supersedes nothing; it is an
INPUT to sequencing, in the same role `S0-conformance.md` plays for the
invariants.

**The question this answers.** The owner's target customers are named:
*"amazon mgm, apple originals, a24, marvel"*. This document says what those
organisations actually require before unreleased footage touches a vendor's
platform, what is missing from this product today, and in what order to close it.

---

## 0. Evidence discipline — read this before quoting anything below

This document was compiled under a constraint and says so rather than
pretending otherwise. Five research streams were launched; **one completed**,
three were stopped by the owner mid-run to conserve budget, and the session's
web-search allowance (200 calls) was exhausted before they could be re-run.

Every claim below is tagged:

| Tag | Meaning |
|---|---|
| **[SOURCED]** | Verified this session against a named primary or secondary source with a URL |
| **[CODE]** | Verified directly against this repository or the live database |
| **[DOMAIN]** | The author's domain knowledge. **Plausible, commonly true, and NOT verified this session.** Treat as a hypothesis to check before acting on it |
| **[OPEN]** | Named gap. Research was planned and did not complete |

**Do not promote a [DOMAIN] claim to settled fact by quoting this document.**
That is precisely the failure `CLAUDE.md`'s working rules and HANDOFF §12
lesson 1 exist to prevent — a plausible claim inherited from a prior document
and promoted without being checked.

---

## 1. The headline finding, and it reframes the roadmap

**[SOURCED]** For the six buyers named, the binding gate is **not SOC 2 — it is
MPA/TPN content security.** Generic SaaS compliance gets a vendor past the
CISO's questionnaire. TPN gets them past the studio's *content protection*
team, which is a **separate organisation with a separate veto**.

Netflix states it plainly: its Studio & Corporate Security team "will conduct a
security review of **any** vendor or system used to process, store or share
sensitive data"
([Netflix Content Security Requirements](https://partnerhelp.netflixstudios.com/hc/en-us/articles/360001937528-Netflix-Content-Security-Requirements)).
A review-and-approval platform holding unreleased footage is squarely in scope.

**Consequence for this project:** the roadmap has been organised around product
capability. The gate is organised around *content custody*. Those are different
axes, and the second one is the one that decides whether a deal happens.

### 1.1 TPN as it actually stands

**[SOURCED]**

| Item | Status | Detail |
|---|---|---|
| TPN membership + **Blue Shield** self-attestation | **HARD GATE** for anything touching pre-release content | Published in the TPN+ portal; renews annually |
| **Gold Shield** (independent assessor) | **HARD GATE** at the named buyers | Valid 2 years; 3–6 months kickoff → published report; cost negotiated with an accredited assessor, not published |
| MPA BP **Application and Cloud Security Guidelines** | Directly applicable to this product | v5.0 split every control into Site-only / Cloud-only / Hybrid; 48 Common Guidelines topics + 6 additional app/cloud topics, mapped to ISO 27001:2022, NIST SP 800-53 and CSA CCM |
| **Software Application Provider hardening guidelines** | **HARD GATE — must be authored by us** | Added in MPA BP **v5.2 (30 Aug 2023)**: application providers must publish hardening guidance covering security measures and configuration best practices for their application ([TPN](https://trustedpartnernetwork.org/press-releases/tpn-updates-mpa-best-practices-to-include-hardening-guidelines-for-software-application-providers/)) |

TPN replaced the Gold/Blue split with a **four-tier shield system in early
September 2025**: **Blue** (self-assessment published) → **Silver** (assessed,
remediation plan submitted) → **Gold** (all Best Practice remediations completed
and TPN-reviewed) → **Gold Star** (Best Practices *plus* Additional
Recommendations)
([TPN](https://www.ttpn.org/press-releases/tpn-to-launch-enhanced-shield-tier-system-to-strengthen-global-content-security/)).
Current framework version is **5.3.1**.

**TPN does not accept SOC 2 or ISO 27001 as a substitute.** TPN's own position
is that TPN+ "is not a substitute for ISO or other standards bodies not
specific to our industry"; the relationship runs the other way — MPA BP is
*mapped to* ISO 27001
([assessor FAQ](https://www.groundwiresecurity.com/about-tpn-assessment-faq)).
**Budget both.**

**Silver is the commercially important tier.** It exists so a studio can sign a
*conditional* agreement against a dated remediation plan. That is the realistic
first deal shape for this product.

### 1.2 Netflix's published vendor requirements — the most concrete public checklist

**[SOURCED]** The other five buyers' requirements are **[DOMAIN]** substantially
similar in shape, but only Netflix's are public at this specificity:

- **MFA required** on all systems where content is accessed, stored or processed
- **Integrate with Netflix SSO where feasible** — the studio is the IdP, we are the SP
- **Unique per-individual credentials, never shared** — this kills any "one login per production company" pricing model
- Content and business data on **encrypted storage** on every device class
- **Retain all authentication and access logs for the duration of the project plus one year**
- Continuous monitoring / **SIEM** where feasible
- **Monthly vulnerability assessments; annual independent third-party penetration test; annual internal risk assessment**
- Maintain records of **SOC 2, pen tests, vuln scans, code/application reviews, TPN assessments**
- Layered network security, deny-all-by-default, content networks isolated from non-production

---

## 2. The single largest product gap: forensic watermarking

**[SOURCED]** **HARD GATE for pre-release video review.** This is the biggest
build item on the list, and the market confirms it by where it prices the
feature: Frame.io gates session-based watermarking, forensic watermarking and
DRM to **Enterprise**
([Frame.io](https://help.frame.io/en/articles/12091837-forensic-watermarking));
Evercast sells forensic watermarking as a premium feature
([Evercast](https://www.evercast.us/forensic-watermarking)); Moxion enables it
per-project on request ([Moxion](https://help.moxion.io/article/79-watermarking)).
The industry reference implementation is **NAGRA NexGuard for Pre-Release**
([NAGRA](https://nagra.vision/security-solutions/forensic-watermarking/nagra-nexguard-for-pre-release/)).

### 2.1 The distinction procurement will test, and where we sit

**[CODE]** What this repo has today is a **visible burn-in**: `share_links.watermark`
(0085) drives a moving overlay in `components/portal/ScreeningRoom.tsx` bearing
the viewer's email, IP and timestamp, and `app/s/[token]/page.tsx` promises
"your details appear across the picture."

**That is the right primitive and the wrong class of control.** Forensic
watermarking means an **imperceptible per-recipient payload that survives
re-encode, screen capture and camcording, and is recoverable from a leaked
copy**. A visible mark is a deterrent; a forensic mark is an identification.
A studio asks for the second.

**The honest position to hold:** `lib/shareLinks.ts` already says this in its
header — "It is NOT invisible forensic watermarking… Claiming forensic
protection we do not have would be worse than claiming none." That judgement
was right and should not be softened. What changes is that it moves from a
footnote to a **named roadmap item with a licence decision attached**.

**Build vs licence: licence.** `facebookresearch/videoseal` is MIT **[SOURCED,
verified via GitHub API]** and is the credible open route, but it is Python and
GPU-bound — a job-queue worker (0083/0084 make that possible). For a studio
deal, **[DOMAIN]** a named commercial vendor in the chain is usually worth more
than an in-house implementation, because the studio's security team recognises
the vendor.

---

## 3. Identity — the front door is not built

**[SOURCED]** **SSO is a hard gate. Unambiguously.** The commonly cited figure
is that **>80% of deals above $100k ARR require SSO as a procurement gate**
([Start With Identity](https://startwithidentity.com/articles/b2b-saas-security-tools-enterprise-procurement/));
at the studios named it is effectively 100%, and Netflix writes it into its
vendor requirements directly. There is no "we'll add it after signature" path —
the security questionnaire arrives **before** the contract and SAML is item one.

### 3.1 The 2026 checklist

**[SOURCED]**

| Capability | Gate level |
|---|---|
| **SAML 2.0**, SP- **and** IdP-initiated | HARD GATE — studios launch from the Okta/Entra tile |
| **OIDC** as an alternative connection | Strong expectation |
| Signed **and encrypted** assertions; documented cert rotation | HARD GATE |
| Pre-integrated with **Okta, Microsoft Entra ID, Google Workspace** | HARD GATE (~90% of need) |
| **Multiple IdPs per tenant** | Strong expectation — a studio + subsidiaries + a post house on one account |
| **SCIM 2.0** provisioning/deprovisioning/group sync | HARD GATE at studio scale |
| **JIT provisioning** on first SSO login | Strong expectation |
| **SSO enforcement per verified domain** (block password login for `@disney.com`) | HARD GATE — an SSO option users can bypass fails review |
| **Deprovisioning latency** — SCIM deactivate revokes live sessions immediately | HARD GATE — a long-lived JWT that outlives the SCIM delete is a finding |
| **MFA** (TOTP/WebAuthn) + **step-up** for sensitive actions | HARD GATE |
| **Tenant-configurable session lifetime / idle / absolute max** | Strong expectation, effectively hard |
| Separate **staging and production tenants** | Strong expectation |

### 3.2 Where we stand, and the one piece of good news

**[CODE]** A repository grep finds **no SAML, no SCIM, no OIDC, and no MFA
enforcement anywhere in `app/` or `lib/`**. Auth is Supabase email/password.

**The good news is architectural.** `S-R` already decided that **capabilities
resolve from the ROSTER on every request, never from a token** (R-2), and
`CLAUDE.md` records that `app_metadata.role` is a two-valued routing claim that
**nothing may authorize on**. That is exactly the shape an IdP integration
needs: SSO/SCIM must map IdP groups onto `organization_members` and the
capability layer, **never onto a token claim**. The model is IdP-ready. The
front door isn't built.

---

## 4. Audit, retention, legal hold — half-built, and the half that exists is the right half

### 4.1 What is required

**[SOURCED]**

| Item | Gate |
|---|---|
| Immutable / tamper-evident audit log of auth, entitlement change, share creation, download, export, deletion | HARD GATE |
| **Customer-facing, tenant-scoped audit log UI** | HARD GATE |
| **Log export to customer SIEM** (Splunk HEC, Microsoft Sentinel, S3/webhook) | Strong expectation; hard at Disney/WBD scale |
| Netflix: auth/access log retention = **project duration + 1 year** | HARD GATE (contractual) |
| **Legal hold** — suspend all deletion for a matter, per custodian/project | **HARD GATE** at litigation-heavy buyers |
| **E-discovery export** with chain of custody | HARD GATE |
| **WORM storage** for the audit trail | Strong expectation |

Typical enterprise model: **12 months hot/searchable + 7 years immutable
archive**.

### 4.2 Where we stand

**[CODE] What already works, and works well:**

- `activity_log_retention()` (0071) **refuses any delete inside 7 years,
  including a CASCADE**. That is exactly the control an auditor wants,
  implemented at the right layer — the database, not the application.
- `contract_events` is append-only **by TRIGGER rather than by absent policy**,
  so the service role cannot bypass it. Proven against a superuser connection.
  This shape generalises and should be the template for the audit log.

**[CODE] What is missing:**

- **No tenant-wide audit surface.** `activity_log` is read on a client page and
  a project page. There is no "everything that happened in this organisation,
  filtered, exported". The 7-year guard protects a ledger nobody can read
  end-to-end.
- **No legal hold.** Zero matches in the repo. `purge_deleted_rows()` plus
  `deleted_at` is a purge path **with no suspension mechanism**. A hold must be
  a row that `purge_deleted_rows` consults, that the soft-delete path respects,
  and that **survives a tenant admin trying to delete the project**.
- **No tenant data export**, and no certified-deletion path.
- **No error sink.** `CLAUDE.md` records 78 `catch` blocks discarding the error
  and no Sentry. **[SOURCED]** That is a SOC 2 CC7 finding and an MPA logging
  finding, not merely tech debt.

### 4.3 A storage constraint worth knowing before it is promised

**[SOURCED]** **Cloudflare R2 bucket locks are not S3 Object Lock.** They are
**prefix-based, bucket-level retention rules** (max 1,000 per bucket), not
per-object retention with Governance/Compliance modes and per-object Legal Hold
([Cloudflare](https://developers.cloudflare.com/r2/buckets/bucket-locks/)).

If a studio questionnaire says *"S3 Object Lock in Compliance mode with Legal
Hold"*, **R2 does not answer it.** The options are a locked-prefix-per-matter
scheme (workable, ugly, 1,000-rule ceiling) or a secondary archive on a provider
with certified Object Lock.

---

## 5. Data residency — architectural, and more expensive than it looks

**[SOURCED]** EU data residency is a **HARD GATE for EMEA productions** and is
the one item on this list that is genuinely architectural rather than additive.

- **Supabase pins a project to the region chosen at creation time and does not
  move it** ([Supabase](https://supabase.com/docs/guides/security)).
- **Cloudflare R2 offers jurisdictional restrictions** (EU / FedRAMP) set at
  bucket creation — but these are **hints, not S3-style region selection**, and
  **Local Uploads are incompatible with jurisdictional buckets** because they
  transiently route outside the region
  ([Cloudflare](https://developers.cloudflare.com/r2/reference/data-location/)).

So EU residency means: a **separate Supabase project per region**,
EU-jurisdiction R2 buckets, an EU-pinned deployment — and the part vendors
forget, **every AI provider, Resend, Twilio, Stripe and LiveKit is a
subprocessor with its own residency story**.

**Recommendation:** make EU residency a distinct SKU. Half the market does.

---

## 6. Compliance certifications — cost and lead time

**[SOURCED]** Costs from compliance-vendor sources; directionally reliable,
individually soft.

| Certification | 2026 status | Cost (yr 1) | Timeline |
|---|---|---|---|
| **SOC 2 Type II** | HARD GATE | **$25k–$50k** all-in | **4–15 months** (1–6 readiness, 3–12 observation, 2–5 wks fieldwork) |
| SOC 2 TSC selection | Security mandatory; **Availability + Confidentiality expected** for a content platform | marginal | — |
| **ISO 27001:2022** | Strong; **hard gate for EU/UK counterparties** | **$25k–$60k** | ~8 months |
| ISO 27017 / 27018 | Differentiating, cheap | add-on | +1 audit day |
| **CSA STAR L1 (CAIQ, public registry)** | Strong expectation — and it **pre-answers questionnaires** | ~free | 2–6 weeks |
| **ISO/IEC 42001 (AI management)** | **Differentiating, trending to expected** — we ship AI generation + provenance | $85k–$150k total | 5–9 months with 27001 in place |
| **TPN Gold Shield** | HARD GATE | negotiated | 3–6 months |

**[SOURCED]** Two facts worth planning around: **>350 organisations held ISO
42001 certificates globally by mid-2026**, and Fortune 500 buyers now accept
*either* the certificate *or a documented roadmap* — the same pattern that made
SOC 2 baseline. **That window closes.** Accredited cert bodies have multi-month
lead times; book before you are ready.

**Sequencing:** SOC 2 Type II observation window (longest pole — start the clock
today) → CSA STAR L1 CAIQ published → TPN Blue → TPN Gold → ISO 27001 (reuses
~70% of SOC 2 evidence) → ISO 42001.

---

## 7. The hybrid-film layer — where this product is genuinely ahead

This is the section that matters most for the owner's stated thesis, and it is
the one place where the product is **ahead of the named competitors rather than
behind them**.

### 7.1 The law, now in force

**[SOURCED]**

| Regime | Status | What it requires |
|---|---|---|
| **New York synthetic performer disclosure** | **In force 9 June 2026** | Conspicuous disclosure when an advertisement features an AI-generated synthetic performer. Binds any ad reaching NY consumers **wherever the advertiser sits**. $1,000 first violation, $5,000 each after |
| **EU AI Act Article 50** | **In force 2 August 2026** | Machine-readable marking of AI-generated content; deepfake labelling. **Pre-existing systems have until 2 December 2026** for the machine-readable marking duty. Annex III high-risk deferred to 2 Dec 2027 ([artificialintelligenceact.eu](https://artificialintelligenceact.eu/high-level-summary/)) |
| **NO FAKES Act** | Advanced unanimously out of Senate Judiciary Committee, **June 2026** | Federal right over AI-generated replicas of voice and visual likeness |
| **FTC** | Max civil penalty **$53,088 per violation** as of January 2026 | AI content disclosure in advertising |

**[SOURCED]** Platform-side: **Meta automatically labels content carrying C2PA
Content Credentials**, and platforms are moving to display visible labels on
AI-generated content with **stripping metadata resulting in licence
revocation**.

### 7.2 What we already have that nobody else does

**[CODE]** Verified against the repository and live database:

- **0064** aligns `asset_provenance` to **C2PA's vocabulary verbatim** (`action`,
  `digital_source_type` as an IPTC `digitalsourcetype` URL, `chars`,
  `document_id`) and `rights` to the **CAWG `cawg.training-mining` triple**
  (`data_mining`, `ai_inference`, `ai_generative_training`, each
  `allowed|notAllowed|constrained`, defaulting to `notAllowed`).
- **0079** makes a completed release **WRITE** the rights row it proves, with
  only `appearance` and `ai_likeness` permitted to assert a likeness, and a
  voided or declined release resetting consent to false.
- **0088** gives both tables a reader, and gives it **to the client** — the
  party the disclosure laws actually act on.
- **`lib/rights.ts`** holds the discipline that matters: **no row is `unknown`,
  never `cleared`.**

**[DOMAIN]** No review platform, e-signature product or production-management
tool joins consent to asset to training-permission in one record. DocuSign has
no concept of an asset; Frame.io has no concept of a release. The join exists
here because both halves are the same system. **This is the defensible moat and
it should be the centre of the enterprise pitch, not a footnote.**

### 7.3 The gap this creates — and it is now regulatory, not roadmap

**[SOURCED + CODE]** The EU AI Act Art. 50 obligation is **machine-readable
marking of the artifact**. `CLAUDE.md` records that the CAI SDKs are
deliberately not a dependency, so **no C2PA manifest is embedded in any asset
today**. The data model is adopted; the emission is not.

That was a defensible roadmap position. **Since 2 August 2026 it is a
compliance gap**, with a 2 December 2026 backstop for pre-existing systems.

**[SOURCED, verified via GitHub API + npm]** The tooling audit is done and the
answer is clean: `contentauth/c2pa-rs` is **Apache-2.0 / MIT dual**; the `c2pa`
npm package is **MIT with MIT dependencies**; **`contentauth/c2pa-node` is
ARCHIVED and must not be adopted**. The embed path is `c2patool` as a job-queue
worker — which 0083/0084 now make possible.

### 7.4 Union agreements — **[OPEN]**

Research on SAG-AFTRA's current AI terms (employment-based vs independently
created digital replicas, what consent must specify, compensation, reuse,
revocation), the WGA MBA AI provisions, and DGA/IATSE terms **did not
complete**. The primary source returned HTTP 403 to automated fetch.

**[DOMAIN]** The shape to expect: consent must be **specific**, in **writing**,
**separate from the general employment contract**, must describe the intended
use, and must survive as a retained record. If that is right, it maps almost
exactly onto `contracts` + `release_kind` + `subject_file_id` + `ai_training`
as already built — but **this must be verified before it is claimed to a
studio.** Do not put union-compliance language in marketing until somebody has
read the actual agreements.

### 7.5 E&O insurance and copyright — **[OPEN]**

What errors-and-omissions insurers now require for AI-assisted productions, and
the US Copyright Office's position on AI authorship and registration, were not
researched. **[DOMAIN]** Both are live commercial pressures on exactly the
record this product keeps, and both are worth understanding before the
enterprise pitch is written.

---

## 8. What is missing in the three spaces

The owner asked specifically about the **client portal, client space and crew
space**. The answer has two halves.

### 8.1 Against the list we wrote — nothing

**[CODE]** Every feature declared in `lib/studio/spaces.ts` for Crew and Client
is now built (`lib/studio/surfaces.ts` BUILT set), and CRM/Lead-Gen were removed
on 2026-09-14.

**That completeness is against a list somebody imagined once.** It is not
evidence that the spaces are finished.

### 8.2 Against what a studio requires — a lot, and none of it was on the list

Ranked by deal-blocking power. **[SOURCED]** for the requirement, **[CODE]** for
the gap.

| # | Missing | Space | Why it blocks |
|---|---|---|---|
| 1 | **SAML/OIDC SSO + domain enforcement** | Crew (org settings) | Nothing ships without it |
| 2 | **Forensic watermarking** | Client space (guest links, review) | The media-specific gate |
| 3 | **MFA + step-up** | All | Netflix mandates MFA explicitly |
| 4 | **SCIM 2.0 + immediate session revocation** | Crew | Offboarding is a named requirement |
| 5 | **Tenant-wide audit log + SIEM export + configurable retention** | Crew | Netflix: project + 1 year |
| 6 | **Legal hold + e-discovery export** | Crew | Litigation-heavy buyers |
| 7 | **EU data residency** | Platform | Architectural; separate SKU |
| 8 | **Tenant data export + certified deletion** | Crew | Contractual, on termination |
| 9 | **Error sink / centralised monitoring** | Platform | SOC 2 CC7; 78 silent catches today |
| 10 | **C2PA manifest emission** | Suite/pipeline | EU AI Act Art. 50, live since 2 Aug 2026 |
| 11 | **Per-object WORM** for the contract/audit record | Platform | R2 bucket locks do not answer an Object Lock question |
| 12 | **Session policy** (lifetime, idle, absolute) per tenant | Crew | Asked in every questionnaire |
| 13 | **Trust Center** (SOC 2 under NDA, subprocessors, DPA, status, VDP, **MPA v5.2 hardening guide**) | Public | The hardening guide is a *contractual obligation* under MPA BP v5.2 |
| 14 | **Status page + incident history** | Public | Cheap, expected, currently absent |

**The one that is cheapest and highest-leverage: [SOURCED]** publish a **CAIQ v4
to the CSA STAR registry**. It is free, public, and pre-answers the 261
questions that appear inside SIG Core and every bespoke studio questionnaire.
Highest ROI item on this entire document.

### 8.3 Production workflow gaps — **[OPEN]**

The department-by-department analysis (script breakdown, scheduling, budgeting,
call sheets, dailies, VFX turnovers, editorial interchange — EDL/AAF/**OTIO** —
conform, colour/ACES, QC, deliverables/IMF, localization, archive/LTO) **did not
complete.**

**[DOMAIN]** The strategic read that does not depend on that research: this
product owns **review, approval, the record, files, contracts, provenance and
rights**. Incumbents own scheduling (Movie Magic, Yamdu, Scenechronize),
budgeting (Movie Magic, Showbiz), payroll (Wrapbook, Cast & Crew, EP) and shot
tracking (Autodesk Flow/ShotGrid, ftrack) **absolutely**. Competing there is a
losing fight. The integration surface — speaking **OTIO, EDL, AAF, ALE, CDL** —
is more valuable than the feature.

### 8.4 Competitive landscape — **[OPEN]**

Only two data points were verified this session:

- **[SOURCED]** Frame.io gates **custom branding, session-based watermarking,
  forensic watermarking and DRM to Enterprise**; Enterprise splits into Select
  and Prime, with Prime carrying advanced security. **Reviewers on shared links
  are free and unlimited on every plan** — only workspace members bill.
- **[SOURCED]** Evercast and Moxion both sell forensic watermarking as premium
  or per-project.

**[DOMAIN]** The white space worth testing: nobody combines *frame-accurate
review + a defensible approval record + signed releases that write a rights
record + AI provenance* in one system. Each half exists; the join does not.

---

## 9. Contractual terms that force product work

**[SOURCED]** Most MSA terms are paperwork. Three force engineering:

1. **Data export on termination + certified deletion.** Needs a complete tenant
   export in a documented format and a deletion certificate. **This is in
   tension with the 7-year ledger guard** — we must be able to explain why
   `activity_log` survives a deletion request, and that explanation must be in
   the contract, not improvised later.
2. **Breach liability carve-out from the cap.** Expect security/confidentiality
   breach to sit **outside** the liability cap. Target a super-cap (3–5× fees)
   rather than uncapped. **[SOURCED]** Cyber liability insurance **$5M–$10M** is
   typical at enterprise, and carriers now require **evidence of annual human
   penetration testing** above certain limits.
3. **AI terms.** **[SOURCED]** Studios in 2026 require: **no training on
   customer content**, disclosure of models and providers, human-review
   guarantees, and an audit right scoped to data use and bias policy but
   excluding model weights. **This product is unusually well positioned** —
   0079's release→rights chain and the `ai_training` CAWG enum are exactly the
   evidence such a clause asks for.

---

## 10. Honest sequencing

**[SOURCED]** TPN Gold and SOC 2 Type II each take 4–6 months *after* readiness,
and readiness is gated on the product items above. **Realistic path to signature
with any of the six named buyers: 12–18 months from a standing start, and the
first six months are product engineering, not compliance consulting.**

A studio **will** sign a conditional agreement against a dated remediation plan —
TPN's Silver tier exists precisely to make that possible — but it will not sign
against nothing.

### Recommended order

**Phase 1 — cheap, fast, unblocks questionnaires (weeks)**
1. Status page + incident history
2. VDP + `security.txt`
3. CAIQ v4 → CSA STAR registry
4. Trust Center page
5. **Error sink** (also closes a live I-10 violation)
6. Start the SOC 2 Type II observation clock

**Phase 2 — the front door (months)**
7. SAML 2.0 + OIDC, per-tenant, IdP- and SP-initiated
8. Domain-level SSO enforcement
9. MFA + step-up on signature, export, share creation, permission change
10. Session policy per tenant
11. SCIM 2.0 with immediate session revocation

**Phase 3 — the record (months, and this is where we are already strong)**
12. Tenant-wide audit surface over `activity_log`
13. SIEM export
14. **Legal hold** gating `purge_deleted_rows()` and the soft-delete path
15. Tenant export + certified deletion
16. C2PA manifest emission via `c2patool` on the job queue

**Phase 4 — content custody (the gate)**
17. Forensic watermarking (licence, don't build)
18. DRM for pre-release streams
19. MPA v5.2 application hardening guide (authored)
20. TPN Blue → assessment → Silver → Gold

**Phase 5 — geography**
21. EU residency SKU

---

## 11. What must be researched before this document is trusted

**[OPEN]**, in priority order:

1. **SAG-AFTRA / WGA / DGA / IATSE AI terms** — what consent must literally
   contain and what a production must retain. Highest value, because it is the
   one area where the product may already be compliant and nobody has checked.
2. **Production workflow by department** — what to integrate with rather than
   build, and which interchange formats to speak.
3. **Competitive landscape** — Moxion, Autodesk Flow, Iconik, Dalet, Sohonet,
   Wrapbook, Yamdu, Pix, DAX.
4. **E&O insurance requirements for AI-assisted productions** and the US
   Copyright Office position on AI authorship.
5. **The other five buyers' published vendor requirements** — only Netflix's
   were verified.
