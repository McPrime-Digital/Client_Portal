-- ═══════════════════════════════════════════════════════════════════════════
-- 0079 · a signed release WRITES the rights record it proves
-- The hybrid-film join between 0064 (provenance) and 0068 (signatures).
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ── THE GAP THIS CLOSES, AND WHY NOBODY ELSE CLOSES IT ────────────────────
--
-- 0064 gave `rights` the CAWG training-mining triple and `talent_consent`, and
-- left them as fields a person types. 0068 gave the studio a way to get a
-- document signed. Between them sat the actual question a hybrid production has
-- to answer: **what makes `talent_consent = true` TRUE?**
--
-- A checkbox does not. An e-signature product cannot close this either, because
-- to it a talent release is an opaque PDF — it has no concept of an asset, a
-- likeness, or a training permission, so the signature and the rights record
-- live in two systems that never meet. DocuSign will not write your C2PA
-- assertions; Frame.io will not tell you whether the face in shot 47 agreed to
-- be modelled.
--
-- Here they are one system, so the trigger below makes the rights record a
-- CONSEQUENCE of the signature rather than a claim beside it. When the last
-- signer signs an AI-likeness release, the asset's rights row says so, with the
-- contract id as the evidence.
--
-- ── WHAT A RELEASE DECLARES ───────────────────────────────────────────────
--
-- `release_kind` names the instrument: an appearance release, an AI-likeness or
-- digital-double release, a location agreement, a music licence. `ai_training`
-- carries what the signer actually agreed to for generative training, in CAWG's
-- own vocabulary (allowed | notAllowed | constrained) so it lands in `rights`
-- without translation — and so it can be serialised into a C2PA
-- `cawg.training-mining` assertion the day assets carry manifests.
--
-- **THE DEFAULT IS notAllowed**, as it is on `rights` itself. Consent is
-- granted, never assumed, and a release that is silent about AI training is a
-- release that did not grant it. That is the whole reason this column exists
-- separately from the contract body: prose can be ambiguous, an enum cannot.
--
-- ── ONLY ON COMPLETION, AND ONLY FORWARDS ─────────────────────────────────
--
-- The trigger fires when a contract reaches `completed` — every signer signed.
-- A partially signed release grants nothing. It never sets a permission back to
-- a weaker value by accident either: it writes what the release says, and a
-- VOIDED or DECLINED contract resets `talent_consent` to false, because a
-- withdrawn release is not a quiet one.
--
-- SECURITY DEFINER: the writer runs inside whatever transaction completed the
-- signature — including the anonymous signing-link path, which has no session at
-- all. An INVOKER trigger would silently write nothing for exactly the case this
-- exists to serve (a background actor signing an AI-likeness release).
--
-- I-12: forward-only, additive.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

alter table public.contracts
  add column if not exists release_kind    text,
  add column if not exists subject_file_id uuid references public.files(id) on delete set null,
  add column if not exists ai_training     text not null default 'notAllowed';

comment on column public.contracts.release_kind is
  'What instrument this is: appearance | ai_likeness | location | music. NULL '
  'means an ordinary agreement that grants no asset rights.';
comment on column public.contracts.subject_file_id is
  'The asset the release covers. Without it a release is still a valid signed '
  'document — it simply has no rights row to write.';
comment on column public.contracts.ai_training is
  'CAWG cawg.training-mining: what the signer agreed to for generative '
  'training of this asset. Defaults to notAllowed — a release silent about AI '
  'training did not grant it.';

alter table public.contracts drop constraint if exists contracts_release_kind_check;
alter table public.contracts add constraint contracts_release_kind_check
  check (release_kind is null
         or release_kind in ('appearance', 'ai_likeness', 'location', 'music'));

alter table public.contracts drop constraint if exists contracts_ai_training_check;
alter table public.contracts add constraint contracts_ai_training_check
  check (ai_training in ('allowed', 'notAllowed', 'constrained'));

-- One rights row per asset, so the release can UPSERT rather than accumulate a
-- second opinion about the same file.
create unique index if not exists rights_file_unique_idx
  on public.rights (file_id) where file_id is not null;

create index if not exists contracts_subject_file_idx
  on public.contracts (subject_file_id) where subject_file_id is not null;

create or replace function public.apply_release_to_rights()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.release_kind is null or new.subject_file_id is null then
    return null;
  end if;

  if new.status = 'completed' and coalesce(old.status, '') <> 'completed' then
    insert into public.rights (
      organization_id, file_id, license, commercial_ok, talent_consent,
      ai_generative_training, data_mining, ai_inference, notes
    )
    values (
      new.organization_id, new.subject_file_id,
      new.release_kind,
      true,
      -- A location agreement and a music licence carry no person's likeness, so
      -- they must not assert one. Only the two instruments that DO are allowed
      -- to set it, which is the difference between a record and a rubber stamp.
      new.release_kind in ('appearance', 'ai_likeness'),
      new.ai_training,
      new.ai_training,
      new.ai_training,
      'Granted by signed ' || new.release_kind || ' release ' || new.id::text
    )
    on conflict (file_id) where file_id is not null
    do update set
      license                = excluded.license,
      commercial_ok          = excluded.commercial_ok,
      talent_consent         = excluded.talent_consent,
      ai_generative_training = excluded.ai_generative_training,
      data_mining            = excluded.data_mining,
      ai_inference           = excluded.ai_inference,
      notes                  = excluded.notes;

  elsif new.status in ('voided', 'declined')
        and coalesce(old.status, '') not in ('voided', 'declined') then
    -- A withdrawn release is not a quiet one. The row stays, saying no.
    update public.rights
       set talent_consent         = false,
           ai_generative_training = 'notAllowed',
           data_mining            = 'notAllowed',
           ai_inference           = 'notAllowed',
           notes = 'Release ' || new.id::text || ' was ' || new.status
     where file_id = new.subject_file_id;
  end if;

  return null;
end
$function$;

comment on function public.apply_release_to_rights() is
  '0079. Makes the rights record a CONSEQUENCE of the signature rather than a '
  'claim beside it. Fires only on completion; a withdrawn release resets '
  'consent to false rather than leaving it standing.';

drop trigger if exists contracts_apply_release on public.contracts;
create trigger contracts_apply_release
  after update of status on public.contracts
  for each row execute function public.apply_release_to_rights();

commit;

-- ── verification ───────────────────────────────────────────────────────────
-- -- completing an ai_likeness release must create a rights row with
-- -- talent_consent true and the agreed training permission;
-- -- voiding it afterwards must set talent_consent back to false.
