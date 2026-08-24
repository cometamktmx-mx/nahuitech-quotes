begin;

create type public.whatsapp_message_status as enum (
  'PENDING',
  'SENDING',
  'SENT',
  'DELIVERED',
  'READ',
  'FAILED'
);

create table public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null unique references public.quotes (id) on delete cascade,
  seller_id uuid not null references auth.users (id),
  customer_whatsapp_snapshot text not null,
  provider text not null default 'TWILIO',
  provider_message_id text,
  status public.whatsapp_message_status not null default 'PENDING',
  error_code text,
  error_message text,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_messages_provider_supported check (provider = 'TWILIO'),
  constraint whatsapp_messages_destination_not_blank check (
    char_length(btrim(customer_whatsapp_snapshot)) > 0
  )
);

create unique index whatsapp_messages_provider_message_id_unique
  on public.whatsapp_messages (provider_message_id)
  where provider_message_id is not null;

create index whatsapp_messages_seller_created_at_idx
  on public.whatsapp_messages (seller_id, created_at desc);

create index whatsapp_messages_status_created_at_idx
  on public.whatsapp_messages (status, created_at desc);

create trigger set_whatsapp_messages_updated_at
before update on public.whatsapp_messages
for each row execute function public.set_updated_at();

comment on table public.whatsapp_messages is
  'Delivery state for a single Twilio WhatsApp attempt per quote. Quote data remains the source of truth for the document.';

alter table public.whatsapp_messages enable row level security;

revoke all on table public.whatsapp_messages from public;
revoke all on table public.whatsapp_messages from anon, authenticated;
grant select on table public.whatsapp_messages to authenticated;
grant usage on type public.whatsapp_message_status to authenticated;

create policy "Sellers can read their own WhatsApp message states and admins can read all"
on public.whatsapp_messages
for select
to authenticated
using (
  seller_id = (select auth.uid())
  or (select public.is_admin())
);

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'quote-pdfs',
  'quote-pdfs',
  false,
  16777216,
  array['application/pdf']::text[]
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Authorized users can read their quote PDFs"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'quote-pdfs'
  and exists (
    select 1
    from public.quotes as q
    where q.id::text = (storage.foldername(name))[2]
      and (
        q.seller_id = (select auth.uid())
        or (select public.is_admin())
      )
  )
);

commit;
