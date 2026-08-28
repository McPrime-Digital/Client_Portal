-- Batch 9: per-project image (a small thumbnail of the product/service).
-- Idempotent — safe to run many times. Paste into Supabase → SQL Editor → Run.

-- Stored as a long-lived Supabase Storage signed URL (set on create/edit by the
-- admin). Small image — shown as a thumbnail on project cards + detail headers.
alter table public.projects add column if not exists image_url text;

-- Force PostgREST to refresh its schema cache so the new column is usable
-- immediately (otherwise you can hit "Could not find the 'image_url' column").
notify pgrst, 'reload schema';
