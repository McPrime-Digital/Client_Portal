-- One-time re-seed: replace EXISTING projects' phases with the new
-- 7-phase production pipeline (+ undertext). New projects already get
-- these from the app. ⚠️ This resets phase progress to 0 for existing
-- projects — intended for setup before real client progress is tracked.

do $$
declare p record;
begin
  for p in select id from public.projects loop
    delete from public.project_phases where project_id = p.id;
    insert into public.project_phases
      (project_id, name, description, sort_order, progress, is_complete)
    values
      (p.id, 'Discovery & Brief', 'Concept development and narrative architecture', 0, 0, false),
      (p.id, 'Pre-Production', 'Script design and creative alignment with brand', 1, 0, false),
      (p.id, 'Production G1', 'AI-powered scene generation and environment design', 2, 0, false),
      (p.id, 'Production G2', 'Cinematic visual composition and motion design', 3, 0, false),
      (p.id, 'Post-Production', 'Visual refinement, editing, sound design, voiceover, and audio mastering', 4, 0, false),
      (p.id, 'Revisions', 'Commercial campaign formatting for distribution platforms', 5, 0, false),
      (p.id, 'Final Delivery', 'Final masters delivered across agreed formats', 6, 0, false);
    update public.projects set progress = 0 where id = p.id;
  end loop;
end $$;
