# Genreline — S-C: Communications & Sender Identity

**Status:** Draft for approval.
**Date:** 2026-08-31
**Number is provisional** — `S-C` follows the `S-V` precedent for a cross-cutting
spec rather than a phase. Renumber freely; nothing references it yet.
**Depends on:** `S0` P-1 · `S0-B` (PI-2, PI-4) · `S-V` §X-6 and §13.1 · `S1` §5.2 · `S2` §5
**Implements:** `S-V` §X-6 — per-tenant sender identity, which names hardcoded
company names as the thing it exists to prevent.
**Applied state at writing:** Batch 9 shipped. Notification *content* names the
sending studio on every path. The *envelope* does not. `genreline.com` is
verified in Resend; `NOTIFY_FROM_EMAIL` still holds a McPrime address.

---

## 0. What this document is for

Batch 9 made the product stop calling itself McPrime. It did not decide **who
the product's messages are from**, and that is a different question with a
different answer per audience.

Today every outbound email in the system is From one tenant, and there are
**two independent email systems** that neither share a template nor a sender.
This spec settles the identity model, converges the two systems, and marks the
seam for per-tenant sending domains without building them.

---

## 1. The decisions

**CM-1 — There are two voices, and the audience decides which one speaks.**
Genreline speaks as itself to the studio it sells to. The studio speaks as
itself to everyone downstream of it. No message carries both as the sender.

**CM-2 — The studio's clients never receive mail branded Genreline.** A client
of Studio Two bought from Studio Two. Their only permitted contact with the
product's identity is the `S0-B` PI-4 attribution inside the portal. Putting
Genreline in the From line of a project notification is the same defect as
leaving McPrime there — `S0-B` §2's trap, one layer out.

**CM-3 — Sender identity is resolved, never configured per deployment.** One
resolver answers "who is this from" for every channel, from the tenant. An
environment variable may supply the *sending address*; it may never supply the
*identity*. `NOTIFY_FROM_EMAIL` holding `"McPrime Digital <…>"` is the current
counter-example and is a live `S-V` §13.1 violation.

**CM-4 — Branding degrades, it does not fall back to a tenant.** Where the
studio cannot be resolved, the message is neutral or is not sent. It is never
signed with another studio's name — the Batch 9 lesson (HANDOFF §12.3: *a
fallback is not a smaller version of the bug*).

**CM-5 — Auth email moves off Supabase's mailer.** Supabase Auth templates are
global per project, so an invite sent through them can never be per-tenant.
Invites, password resets and magic links are generated with
`auth.admin.generateLink()` and delivered by the application through Resend,
against the same template system as every other message.

**CM-6 — Per-tenant sending domains are a v1 seam, not v1 work.** Layer 1
(display name + Reply-To + branded body on the product's own domain) serves
every tenant with no per-tenant setup. Layer 2 (the studio's own domain) is
built when a studio asks, on the same code path.

---

## 2. The branding matrix

| Sender | Recipient | Identity shown | Examples |
|---|---|---|---|
| **Genreline** | studio owners, org admins | Genreline | welcome, billing, receipts, plan and quota notices, credit top-ups, platform incidents |
| **The studio** | its client companies | the studio | project update, approval requested, file delivered, invoice issued, new message, 5h nudge |
| **The studio** | its own crew | the studio, Genreline as context | crew invite, role change, project assignment |
| **The studio** | a client company's teammates | the studio | teammate invite, approval request |

**The hybrid, stated so it is not argued twice.** An invite reads *"Studio Two
invited you"*, with Genreline named once as context in the footer. The studio
is the subject; the product is context. The recipient is joining a studio's
workspace, not buying software. This is the only place both names appear, and
Genreline never appears in the From line. The inviting *person* is not named —
see §9 q2.

**Not yet real:** there is no self-serve signup, so the Genreline welcome email
has no trigger. `scripts/provision-tenant.ts` is the only path that creates a
studio. The row stays in the matrix because the template is shared work.

---

## 3. Two email systems, and how they converge

| | System A — app notifications | System B — auth email |
|---|---|---|
| Trigger | `lib/notify.ts` → `sendEmailAlert` | `auth.admin.inviteUserByEmail`, `resetPasswordForEmail` |
| Transport | direct `fetch` to the Resend API (`notify.ts:145`) | Supabase Auth's mailer |
| Sender | `NOTIFY_FROM_EMAIL` | Supabase project SMTP settings |
| Template | **none — plain text, no `html` field** | Supabase dashboard, **global per project** |
| Per-tenant capable | yes, once a template exists | **no, structurally** |
| Call sites | 1 | 6 invite paths + 1 reset |

They converge on System A. `generateLink()` returns
`data.properties.action_link` without sending; the application then sends it
like any other message (CM-5). Supabase SMTP should still be pointed at Resend
in the interim, so auth mail is not on Supabase's default sender and its rate
limits while System B is still live.

**Consequence worth stating:** after CM-5, the Supabase email templates become
dead configuration. Leave them in place — a misconfiguration that silently
re-enables Supabase's mailer should produce a plain email, not a failure.

---

## 4. Layer 1 and Layer 2

Layer 2 is an override on Layer 1's code path, not a replacement. One resolver:

```
senderFor(brand) →
  org has a verified sending domain?
    yes → "Studio Two <notifications@studiotwo.com>"     Layer 2
    no  → "Studio Two <notifications@genreline.com>"     Layer 1  (default)
  replyTo → business_settings.business_email, omitted when blank
```

**Layer 1 — every tenant, today, no per-tenant setup.**
Display name, Reply-To, and a body carrying the studio's logo, name and colour.
Resend permits any display name on a verified domain, and because the From
domain and the DKIM signing domain are both `genreline.com`, Gmail shows no
"via" annotation. The recipient sees *Studio Two* in the inbox list, the
studio's logo in the message, and replies reach the studio.

**Layer 2 — per studio, on request.**
`notifications@studiotwo.com`. Requires the studio to publish DNS records;
Resend's domains API makes this a self-serve "connect your domain" flow. Buys
full white-label and moves deliverability reputation to the studio. Needed by
no one today — there is one production tenant.

**What Layer 1 does not buy.** The address is visibly `@genreline.com` to anyone
who looks past the display name. That is the honest limit, and it is why Layer 2
exists rather than being argued away.

---

## 5. Per channel

**Email.** Sections 3 and 4 above.

**SMS** (`lib/sms.ts`). Alphanumeric sender IDs are unavailable in the US and
Canada, so the sending number cannot carry identity there. **Branding goes in
the body**: `"Studio Two: New message on Cascade Films…"`. This is portable
everywhere and is the only per-tenant SMS branding that works today. A Twilio
Messaging Service with per-tenant numbers is Layer 2's SMS equivalent.
Note the existing constraint from Batch 8.2: `phone` is the client *company's*
one number, so fan-out dedupes by number.

**Push** — **done, Batch 9.3.** Title carries the studio name; `icon` carries
`organizations.logo_url`. `public/sw.js` falls through to the browser default
when the payload has no icon, never to a brand asset.

**In-app** — **done, Batch 9.2/9.3.** Bell rows, chat sender names and the
activity ledger all resolve through `lib/tenantBrand.ts`.

---

## 6. What must be built

**Schema.** Three additive columns, one migration:

| Column | Why |
|---|---|
| `organizations.mail_domain text` | Layer 2's sending domain |
| `organizations.mail_domain_verified_at timestamptz` | verification is a state, not a boolean; null means Layer 1 |
| `organizations.brand_color text` | the template's accent; falls back to the product's |

`organizations.logo_url` already exists and needs no migration — but **nothing
in the application writes it**, which is why all three rows are null. That is a
missing upload route, not a missing column.

**Code, in dependency order.**

1. **Org logo upload.** `organizations.logo_url` has no writer.
   `app/api/portal/avatar/route.ts` is the pattern — Supabase Storage, signed
   at `LONG_EXPIRY` (ten years, `avatar/route.ts:7`), which is long enough that
   a logo will not rot in an archived inbox.
2. **The template.** One HTML layout, a function of `TenantBrand`. Studio logo
   or initial fallback, studio name, accent colour, the PI-4 attribution in the
   footer gated on the same `showsAttribution` the sidebar uses. A Genreline
   variant of the same layout for CM-1's vendor voice.
3. **`senderFor()`** — §4's resolver. Returns `{ from, replyTo? }`.
   `sendEmailAlert` grows `html` and `replyTo`; it keeps `text` as the plain-text
   alternative rather than replacing it.
4. **Invites onto `generateLink()`** — six call sites, all of which already
   resolve a tenant. Depends on 2 and 3.

**Environment.** `NOTIFY_FROM_EMAIL` becomes the Layer 1 *address* only; the
display name is composed per send. Its value must be a neutral product address
on a Resend-verified domain.

---

## 7. Deliverability, as constraints rather than advice

- **Resend will not send from an unverified domain.** Layer 2's domain must be
  verified *before* any send resolves to it, which is what
  `mail_domain_verified_at` records. An unverified value must resolve to Layer 1,
  not to a failed send.
- **Reply-To may be absent.** `business_settings.business_email` is `''` for the
  house org today. Emit no `Reply-To` header rather than an empty one.
- **The display name is free text and reaches a recipient's inbox list.** It is
  tenant-controlled input on an outbound channel; length-cap it and strip
  newlines, or it is a header-injection surface.
- Transactional mail does not need `List-Unsubscribe`. If digests ship, it does.

---

## 8. Deliberately not in v1

Per-tenant custom portal domains (`portal.studiotwo.com`) — `S0-B` §5 routes
these to v2, and they pair with Layer 2 rather than preceding it. Per-tenant
template *authoring* (a studio editing its own email copy) — the branded layout
covers the need; template editing is a support burden with no demand.
Localisation.

---

## 9. Open questions

1. **Who owns `organizations.plan`, and does any of this gate on it?** HANDOFF
   §11 q9. Layer 2 is a plausible plan feature; if it is, it resolves through
   `planAllows()` like `attribution.hide`, never a boolean.
2. **ANSWERED 2026-08-31 — the studio, not the person.** A crew invite reads
   *"Studio Two invited you"*. The roster carries the inviter's name and the
   template does not use it: the invitation is to the studio's workspace, and
   the person who happened to click the button is not the authority the
   recipient is being asked to trust. It also survives that person leaving.
3. **What is the Genreline vendor address?** `notifications@genreline.com` is
   assumed throughout and is already `lib/product.ts`'s VAPID contact. Billing
   mail may warrant a separate one, which S0-B §7's legal entity affects.
4. **Do bounces and complaints need handling?** Resend webhooks exist. Nothing
   consumes them, and a hard-bounced client address currently fails silently
   forever — adjacent to I-10.

---

*End of S-C. Governs sender identity and message branding across email, SMS,
push and in-app. Does not alter any architecture decision in S0, S0-A or S0-B.*
