begin;

create table public.salespeople (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text,
  phone text,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint salespeople_full_name_not_blank check (char_length(btrim(full_name)) > 0),
  constraint salespeople_email_not_blank_when_present check (
    email is null or char_length(btrim(email)) > 0
  ),
  constraint salespeople_phone_not_blank_when_present check (
    phone is null or char_length(btrim(phone)) > 0
  ),
  constraint salespeople_sort_order_non_negative check (sort_order >= 0)
);

create index salespeople_active_sort_name_idx
  on public.salespeople (sort_order, full_name)
  where active;

create trigger set_salespeople_updated_at
before update on public.salespeople
for each row execute function public.set_updated_at();

alter table public.profiles
  add column salesperson_id uuid references public.salespeople(id) on delete set null;

create index profiles_salesperson_id_idx
  on public.profiles (salesperson_id)
  where salesperson_id is not null;

alter table public.quotes
  add column salesperson_id uuid references public.salespeople(id) on delete set null,
  add column salesperson_name_snapshot text;

create index quotes_salesperson_created_at_idx
  on public.quotes (salesperson_id, created_at desc)
  where salesperson_id is not null;

comment on table public.salespeople is
  'Commercial salespeople. They are independent from authentication accounts and may be selected by an Expo terminal.';

comment on column public.profiles.salesperson_id is
  'Optional commercial salesperson linked to an authenticated seller account.';

comment on column public.quotes.seller_id is
  'Legacy authenticated user attribution retained for compatibility. New commercial attribution lives in salesperson_id.';

comment on column public.quotes.salesperson_id is
  'Commercial salesperson who attended the customer. It is independent from the technical authenticated creator.';

comment on column public.quotes.salesperson_name_snapshot is
  'Historical commercial salesperson name used by PDF, history, and WhatsApp.';

alter table public.salespeople enable row level security;

revoke all on table public.salespeople from public, anon, authenticated;
grant select, insert, update, delete on table public.salespeople to authenticated;

create policy "Admins can manage salespeople"
on public.salespeople
for all
to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

create policy "Seller flow can view active salespeople"
on public.salespeople
for select
to authenticated
using (
  active
  and exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and active
      and role in ('seller'::public.profile_role, 'expo'::public.profile_role)
  )
);

commit;
