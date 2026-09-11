create table if not exists public.whatsapp_inbound_auto_replies (
  id uuid primary key default gen_random_uuid(),
  message_sid text not null unique,
  from_phone text not null,
  to_phone text,
  received_at timestamptz not null default now(),
  replied_at timestamptz,
  reply_message_sid text,
  status text not null,
  error_code text,
  error_message text
);
create index if not exists whatsapp_inbound_auto_replies_from_received_idx on public.whatsapp_inbound_auto_replies (from_phone, received_at desc);
create index if not exists whatsapp_inbound_auto_replies_received_idx on public.whatsapp_inbound_auto_replies (received_at desc);
alter table public.whatsapp_inbound_auto_replies enable row level security;
revoke all on public.whatsapp_inbound_auto_replies from anon, authenticated;
