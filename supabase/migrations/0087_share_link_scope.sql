-- ═══════════════════════════════════════════════════════════════════════════
-- 0087 · a screening link is as visible as the thing it points at
-- Correcting 0085 before it has a second row.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ── THE DEFECT ───────────────────────────────────────────────────────────
--
-- 0085's crew policy is `organization_id = current_org() and is_org_member()`
-- and stops there. That is the Class B shape MINUS its project conjunct, so a
-- contractor scoped to one production could list every screening link the studio
-- had ever minted — titles, expiry, view counts — for productions RLS otherwise
-- hides from them completely.
--
-- **That is S-R R-6's leak wearing a UI convention**, one table further along:
-- "a disabled tile telling a freelance editor the studio has a production called
-- Netflix Pilot is an information leak". A row reading "Netflix Pilot · reel 3 ·
-- 4 views" is the same leak with the production's cutting schedule attached.
--
-- Batch 26 took this predicate to fourteen policies and 0059 established the
-- second half of the rule — **USING and WITH CHECK together**, because INSERT is
-- the one command USING cannot reach and a scoped member could otherwise MINT a
-- link against a production they cannot see. Both halves are applied here.
--
-- ── THE SUBJECT IS POLYMORPHIC, SO THE PREDICATE BRANCHES ────────────────
--
-- `subject_kind` carries three values and each reaches project scope by a
-- different route. Only 'file' is minted today; writing all three now is
-- deliberate — the day the other two ship, the person shipping them will be
-- thinking about a player, not about a policy.
--
-- ── THE VIEWS ARE REACHED *THROUGH* THE LINK ─────────────────────────────
--
-- 0038's idiom, and the reason is that it cannot go stale: restating the scope
-- predicate on `share_link_views` would be a second copy that keeps working
-- after somebody changes the first. `exists (select 1 from share_links ...)`
-- inside a policy is itself subject to that table's RLS, so the views inherit
-- whatever the link admits — including this migration's change, and the next.
--
-- I-12: forward-only; every create policy preceded by a drop.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── what a share link's subject means, as one function ─────────────────────
-- A function rather than an inlined CASE because the policy needs it in USING
-- and in WITH CHECK, and two copies of a branching predicate is two things to
-- keep in step. STABLE and SECURITY DEFINER for the same reason the other
-- scoping helpers are: it must read `organization_members` for a caller whose
-- own policies would otherwise bound the answer.
create or replace function public.org_share_subject_visible(
  p_kind text, p_subject uuid
)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select case p_kind
    when 'file'    then public.org_file_visible(p_subject)
    when 'project' then public.org_project_visible(p_subject)
    when 'approval' then exists (
      select 1 from public.approvals a
       where a.id = p_subject
         and (a.project_id is null or public.org_project_visible(a.project_id))
    )
    -- An unknown kind resolves to FALSE, never TRUE. A CHECK constraint holds
    -- the three values today; if a fourth is ever added, the failure should be
    -- "nobody can see it" and not "everybody can".
    else false
  end
$function$;

comment on function public.org_share_subject_visible(text, uuid) is
  '0087. A screening link is exactly as visible as the asset it points at. '
  'Returns FALSE for an unrecognised subject_kind — a new kind must fail closed.';

grant execute on function public.org_share_subject_visible(text, uuid) to authenticated;

-- ── the link ───────────────────────────────────────────────────────────────
drop policy if exists share_links_crew_all on public.share_links;
create policy share_links_crew_all on public.share_links
  for all to authenticated
  using (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
    and public.org_share_subject_visible(subject_kind, subject_id)
  )
  with check (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
    -- 0059's half. Without it a scoped contractor could mint a link against a
    -- production they cannot read, and then watch it through the guest page.
    and public.org_share_subject_visible(subject_kind, subject_id)
  );

-- ── the views, through the link ────────────────────────────────────────────
drop policy if exists share_link_views_crew_read on public.share_link_views;
create policy share_link_views_crew_read on public.share_link_views
  for select to authenticated
  using (exists (select 1 from public.share_links sl where sl.id = link_id));

commit;

-- ── verification ───────────────────────────────────────────────────────────
-- -- as a contractor scoped to project A: a link on project B must be INVISIBLE
-- -- and an insert against project B's file must be REFUSED.
