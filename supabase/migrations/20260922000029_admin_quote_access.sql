begin;

-- Patch only the role gates in the installed functions. Preserve pricing,
-- attribution, multi-machine calculations, SECURITY DEFINER and existing grants.
-- Abort atomically if a function no longer has the expected guard.
do $migration$
declare
  target record;
  definition text;
  old_guard text;
  new_guard text;
  patched_count integer := 0;
begin
  for target in
    select p.oid, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('create_quote', 'create_multi_quote',
                       'preview_quote_coupon', 'preview_multi_quote_coupon')
  loop
    definition := pg_get_functiondef(target.oid);
    if target.proname = 'preview_multi_quote_coupon' then
      old_guard := 'p.role in (''seller'',''expo'')';
      new_guard := 'p.role in (''seller'',''expo'',''admin'')';
    elsif target.proname = 'preview_quote_coupon' then
      old_guard := 'and v_role is distinct from ''expo''::public.profile_role then';
      new_guard := 'and v_role is distinct from ''expo''::public.profile_role
    and v_role is distinct from ''admin''::public.profile_role then';
    else
      old_guard := 'and v_creator_role is distinct from ''expo''::public.profile_role then';
      new_guard := 'and v_creator_role is distinct from ''expo''::public.profile_role
    and v_creator_role is distinct from ''admin''::public.profile_role then';
    end if;

    if (length(definition) - length(replace(definition, old_guard, ''))) <> length(old_guard) then
      raise exception 'Expected exactly one role guard in %', target.proname;
    end if;

    -- Admin follows the existing Expo branch: an active commercial salesperson
    -- is required. auth.uid() remains the creator; no profile is modified.
    execute replace(definition, old_guard, new_guard);
    patched_count := patched_count + 1;
  end loop;

  if patched_count <> 4 then
    raise exception 'Expected four quote functions, found %', patched_count;
  end if;
end;
$migration$;

commit;
