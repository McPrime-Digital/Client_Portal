-- ═══════════════════════════════════════════════════════════════════════════
-- 0086 · counting a view without losing one
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `max_views` is a security control on a screener, so the counter behind it has
-- to be exact. PostgREST cannot express `view_count = view_count + 1`, so the
-- application would have to read-then-write — and two people opening the same
-- link in the same second would both read 4, both write 5, and a link limited to
-- five views would have served six.
--
-- One statement, in the database, where the increment is atomic.
--
-- It also returns the NEW count, so the caller can refuse the view it just
-- counted when the limit has been passed — checking before incrementing is the
-- same race one step earlier.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

create or replace function public.increment_share_view(p_link uuid)
returns int
language sql
security definer
set search_path to 'public'
as $function$
  update public.share_links
     set view_count = view_count + 1
   where id = p_link
  returning view_count;
$function$;

comment on function public.increment_share_view(uuid) is
  '0086. Atomic, because max_views is a security control: a read-then-write in '
  'the application lets two simultaneous viewers both consume the same slot.';

revoke all on function public.increment_share_view(uuid) from public, anon, authenticated;

commit;
