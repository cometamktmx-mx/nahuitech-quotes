begin;

alter type public.addon_calculation_type add value if not exists 'QUANTITY';

create type public.machine_delivery_policy as enum (
  'FLEXIBLE',
  'INSTALLATION_REQUIRED',
  'SHIPPING_ONLY'
);

alter table public.machines
  add column delivery_policy public.machine_delivery_policy not null default 'FLEXIBLE';

alter table public.machine_addons
  add column unit_price_override numeric(12, 2),
  add column description_override text,
  add constraint machine_addons_unit_price_override_non_negative
    check (unit_price_override is null or unit_price_override >= 0);

alter table public.quote_addons
  add column description_snapshot text;

grant usage on type public.machine_delivery_policy to authenticated;

comment on column public.machines.delivery_policy is
  'FLEXIBLE allows seller choice; INSTALLATION_REQUIRED forces INSTALLATION; SHIPPING_ONLY forces SHIPPING.';

comment on column public.machine_addons.unit_price_override is
  'Optional price for this machine/add-on combination. When null, addons.unit_price is used.';

comment on column public.machine_addons.description_override is
  'Optional customer-facing text for this machine/add-on combination. When null, addons.description is used.';

comment on column public.quote_addons.description_snapshot is
  'Historical add-on explanation as offered in this quote. It is never rebuilt from the live catalog.';

commit;
