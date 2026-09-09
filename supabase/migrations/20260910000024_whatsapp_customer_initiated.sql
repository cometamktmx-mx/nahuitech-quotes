alter table public.whatsapp_messages
  add column if not exists delivery_method text not null default 'TEMPLATE',
  add column if not exists inbound_message_sid text,
  add column if not exists inbound_phone text;

alter table public.whatsapp_messages
  drop constraint if exists whatsapp_messages_delivery_method_check;
alter table public.whatsapp_messages
  add constraint whatsapp_messages_delivery_method_check
  check (delivery_method in ('TEMPLATE', 'CUSTOMER_INITIATED'));
create unique index if not exists whatsapp_messages_inbound_sid_uidx
  on public.whatsapp_messages (inbound_message_sid) where inbound_message_sid is not null;

create table if not exists public.quote_delivery_tokens (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null unique references public.quotes(id) on delete cascade,
  token text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  constraint quote_delivery_tokens_token_check check (token ~ '^[A-Za-z0-9_-]{10,32}$')
);
create index if not exists quote_delivery_tokens_expires_idx on public.quote_delivery_tokens (expires_at);
alter table public.quote_delivery_tokens enable row level security;
revoke all on public.quote_delivery_tokens from anon, authenticated;
