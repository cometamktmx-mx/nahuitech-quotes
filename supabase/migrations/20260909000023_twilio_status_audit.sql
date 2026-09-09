begin;

alter table public.whatsapp_messages
  add column if not exists failed_at timestamptz;

comment on column public.whatsapp_messages.customer_whatsapp_snapshot is
  'Canonical E.164 destination snapshot. The Twilio address is derived as whatsapp:+E164.';
comment on column public.whatsapp_messages.failed_at is
  'Time Twilio reported failed or undelivered delivery.';

commit;
