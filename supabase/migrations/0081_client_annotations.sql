-- ═══════════════════════════════════════════════════════════════════════════
-- 0081 · a client can draw on their own material
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 0080 gave clients SELECT on `review_annotations` and nothing more, which makes
-- a review session half a feature: the client watches the studio draw and then
-- describes what they mean in words. **The reason to run a review session at all
-- is that the person giving the note can point at the thing.** Frame.io's whole
-- value is the client circling a shot; taking that away leaves a video call with
-- extra steps.
--
-- ── WHAT THEY MAY MARK, AND WHAT THEY MAY NOT ────────────────────────────
--
-- Their own company's material, on a production they can see — the same two
-- conjuncts `files_client_read` already uses, reached through the file rather
-- than restated. A client cannot annotate another company's asset, cannot
-- annotate a file outside their project scope, and cannot touch a mark somebody
-- else made.
--
-- INSERT and a NARROW UPDATE, deliberately split:
--
--   · INSERT — they may add a note.
--   · UPDATE — only their own row (`created_by = auth.uid()`), so they can
--     retract or correct their own mark and nobody else's. A client editing the
--     studio's annotation, or another client's, would make the record of a
--     review argument unreliable in exactly the way the approval record refuses
--     to be.
--
-- No DELETE policy: removal is the soft delete on UPDATE, so a retracted note
-- leaves a row. A review where notes can vanish without trace is a review
-- somebody can rewrite afterwards.
--
-- I-12: forward-only, every create policy preceded by a drop.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

drop policy if exists review_annotations_client_write on public.review_annotations;
create policy review_annotations_client_write on public.review_annotations
  for insert to authenticated
  with check (
    file_id is not null
    and created_by = auth.uid()
    and exists (
      select 1 from public.files f
      where f.id = file_id
        and public.is_client_member(f.client_id)
        and (f.project_id is null or public.client_project_visible(f.project_id))
    )
  );

drop policy if exists review_annotations_client_own_update on public.review_annotations;
create policy review_annotations_client_own_update on public.review_annotations
  for update to authenticated
  using (
    created_by = auth.uid()
    and file_id is not null
    and exists (
      select 1 from public.files f
      where f.id = file_id
        and public.is_client_member(f.client_id)
        and (f.project_id is null or public.client_project_visible(f.project_id))
    )
  )
  with check (created_by = auth.uid());

commit;

-- ── verification ───────────────────────────────────────────────────────────
-- -- a client member may insert against their own company's file and NOT
-- -- against another company's; and may not edit a mark they did not make.
