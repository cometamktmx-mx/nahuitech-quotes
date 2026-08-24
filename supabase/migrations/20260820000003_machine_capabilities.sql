begin;

alter table public.machines
  alter column number_of_bases drop not null;

alter table public.machines
  drop constraint machines_number_of_bases_positive,
  add constraint machines_number_of_bases_positive
    check (number_of_bases is null or number_of_bases > 0);

alter table public.machines
  add column supports_addons boolean not null default true;

comment on column public.machines.number_of_bases is
  'NULL means the machine does not use bases; otherwise the value must be a positive integer.';

comment on column public.machines.supports_addons is
  'Whether the machine can be configured with add-ons.';

create or replace function public.validate_machine_addon_capability()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  machine_supports_addons boolean;
  machine_number_of_bases integer;
  addon_calculation_type public.addon_calculation_type;
begin
  select m.supports_addons, m.number_of_bases
    into machine_supports_addons, machine_number_of_bases
  from public.machines as m
  where m.id = new.machine_id;

  if not found then
    raise exception 'Machine % does not exist.', new.machine_id;
  end if;

  select a.calculation_type
    into addon_calculation_type
  from public.addons as a
  where a.id = new.addon_id;

  if not found then
    raise exception 'Add-on % does not exist.', new.addon_id;
  end if;

  if not machine_supports_addons then
    raise exception 'Machine % does not support add-ons.', new.machine_id;
  end if;

  if addon_calculation_type = 'PER_BASE'
    and machine_number_of_bases is null then
    raise exception 'A PER_BASE add-on requires a machine with number_of_bases.';
  end if;

  return new;
end;
$$;

create or replace function public.validate_machine_capability_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not new.supports_addons and exists (
    select 1
    from public.machine_addons as ma
    where ma.machine_id = new.id
  ) then
    raise exception 'A machine without add-on support cannot have machine_addons records.';
  end if;

  if new.number_of_bases is null and exists (
    select 1
    from public.machine_addons as ma
    join public.addons as a on a.id = ma.addon_id
    where ma.machine_id = new.id
      and a.calculation_type = 'PER_BASE'
  ) then
    raise exception 'A machine with PER_BASE add-ons requires number_of_bases.';
  end if;

  return new;
end;
$$;

create trigger validate_machine_addon_capability
before insert or update of machine_id, addon_id on public.machine_addons
for each row execute function public.validate_machine_addon_capability();

create trigger validate_machine_capability_update
before update of supports_addons, number_of_bases on public.machines
for each row execute function public.validate_machine_capability_update();

commit;
