-- ============================================================================
-- 0014_activation_backfill.sql — activate members who already joined
-- Members invited before the activation flip existed (or who joined while the
-- studio side lacked one) are stuck status='invited' even though they set a
-- password and signed in — and every permission reads status. Flip any
-- invited member whose auth user has actually signed in to active, stamping
-- accepted_at from their real first sign-in. Idempotent.
-- ============================================================================

begin;

update public.client_members m
set status = 'active',
    accepted_at = coalesce(m.accepted_at, u.last_sign_in_at, now())
from auth.users u
where u.id = m.user_id
  and m.status = 'invited'
  and u.last_sign_in_at is not null;

update public.organization_members m
set status = 'active',
    accepted_at = coalesce(m.accepted_at, u.last_sign_in_at, now())
from auth.users u
where u.id = m.user_id
  and m.status = 'invited'
  and u.last_sign_in_at is not null;

commit;
