begin;

create type public.profile_role as enum ('admin', 'seller');

create type public.addon_calculation_type as enum ('FIXED', 'PER_BASE');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  role public.profile_role not null default 'seller',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_full_name_not_blank check (char_length(trim(full_name)) > 0)
);

create table public.machines (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  short_description text not null,
  base_price numeric(12, 2) not null,
  number_of_bases integer not null,
  image_url text,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint machines_name_not_blank check (char_length(trim(name)) > 0),
  constraint machines_slug_format check (
    slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  ),
  constraint machines_base_price_non_negative check (base_price >= 0),
  constraint machines_number_of_bases_positive check (number_of_bases > 0),
  constraint machines_sort_order_non_negative check (sort_order >= 0)
);

create table public.addons (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  unit_price numeric(12, 2) not null,
  calculation_type public.addon_calculation_type not null,
  required boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint addons_name_not_blank check (char_length(trim(name)) > 0),
  constraint addons_unit_price_non_negative check (unit_price >= 0)
);

create table public.machine_addons (
  machine_id uuid not null references public.machines (id) on delete cascade,
  addon_id uuid not null references public.addons (id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (machine_id, addon_id)
);

create index machines_active_sort_order_idx
  on public.machines (sort_order, name)
  where active;

create index addons_active_name_idx
  on public.addons (name)
  where active;

create index machine_addons_active_addon_id_idx
  on public.machine_addons (addon_id)
  where active;

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger set_machines_updated_at
before update on public.machines
for each row execute function public.set_updated_at();

create trigger set_addons_updated_at
before update on public.addons
for each row execute function public.set_updated_at();

comment on column public.addons.calculation_type is
  'FIXED adds unit_price once. PER_BASE multiplies unit_price by the selected machine number_of_bases.';

alter table public.profiles enable row level security;
alter table public.machines enable row level security;
alter table public.addons enable row level security;
alter table public.machine_addons enable row level security;

revoke all on table public.profiles, public.machines, public.addons, public.machine_addons from public;
revoke all on table public.profiles, public.machines, public.addons, public.machine_addons from anon, authenticated;

grant usage on type public.profile_role, public.addon_calculation_type to authenticated;
grant select on table public.profiles, public.machines, public.addons, public.machine_addons to authenticated;

create policy "Authenticated users can view their active profile"
on public.profiles
for select
to authenticated
using ((select auth.uid()) = id and active);

create policy "Authenticated users can view active machines"
on public.machines
for select
to authenticated
using (active);

create policy "Authenticated users can view active addons"
on public.addons
for select
to authenticated
using (active);

create policy "Authenticated users can view active compatible addons"
on public.machine_addons
for select
to authenticated
using (
  active
  and exists (
    select 1
    from public.machines
    where machines.id = machine_addons.machine_id
      and machines.active
  )
  and exists (
    select 1
    from public.addons
    where addons.id = machine_addons.addon_id
      and addons.active
  )
);

commit;
