# Supabase Auth email templates — Genreline fallbacks

Paste-ready replacements for the six templates in
**Supabase Dashboard → Authentication → Email Templates**.

## Why these exist, and why they are not tenant-branded

Since Batch 10.3 **the application does not use Supabase's mailer at all** —
invites and password resets are minted with `auth.admin.generateLink()` and
delivered by `lib/email/`, so they carry the sending studio's name, logo and
Reply-To. These templates should therefore never fire.

They are kept, and kept correct, for the case where one does: a flow triggered
from the Supabase dashboard, a feature added later that calls Supabase's auth
methods directly, or a misconfiguration. The old contents were one tenant's
branding ("McPrime Digital"), so that fallback shipped the wrong company's name
to whoever received it.

**They carry the PRODUCT's voice, not a studio's, and that is forced rather
than chosen.** Supabase Auth templates are **global per project** — one template
serves every tenant, so a studio's name cannot appear in one without appearing
in all of them. There is no configuration that changes this; it is the whole
reason CM-5 moved real invites off this mailer. Where no tenant can be resolved,
the honest answer is the product, never a guess — the same conclusion the
pre-auth pages reached in Batch 9.7.

**Tenant-neutral is not the same as thin, and the first draft got that wrong.**
It stripped the substance out of the copy along with the studio's name, which
nothing required. These now carry the same weight as the real templates in
`lib/email/messages.ts` — what the portal does, what the link is for, what to do
if you did not expect it — with the studio's name simply absent. If one of these
ever fires it is the first thing someone sees, so being brief is not a virtue.

## Mapping

| Supabase template | File |
|---|---|
| Confirm signup | `supabase-01-confirm-signup.html` |
| Invite user | `supabase-02-invite-user.html` |
| Magic Link | `supabase-03-magic-link.html` |
| Change Email Address | `supabase-04-change-email.html` |
| Reset Password | `supabase-05-reset-password.html` |
| Reauthentication | `supabase-06-reauthentication.html` |

Each file is a complete standalone document — paste the whole thing, replacing
everything in the editor. Set the **subject** in the field above the body;
suggested subjects are the `<title>` of each file.

## Variables

Only Supabase's own, and only where that template actually provides them:

- `{{ .ConfirmationURL }}` — all except Reauthentication
- `{{ .NewEmail }}` — Change Email Address only
- `{{ .Token }}` — Reauthentication only (a code, not a link)

Do not add `{{ .SiteURL }}` or a hardcoded hostname to these. Four domains are
planned (S0-B PI-3); Supabase resolves the URL from its own Site URL setting.

## Keeping them in step

The design matches `lib/email/layout.ts` — same palette, same 560px card, same
accent rule — so a fallback is visually indistinguishable from a real message.
If that layout changes, these do not follow automatically. They are dashboard
configuration and cannot be version-controlled any other way; this directory is
the closest thing to a record of what is pasted in there.

**Changing the sending domain does not touch these files, but it does touch
Supabase.** Its Site URL and Redirect URL allowlist are separate settings —
miss them and every link in these emails breaks silently (S0-B §5).
