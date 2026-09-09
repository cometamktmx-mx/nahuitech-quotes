alter table public.whatsapp_messages
  add column if not exists manual_sent_at timestamptz,
  add column if not exists manual_sent_by_user_id uuid references public.profiles(id);
alter table public.whatsapp_messages drop constraint if exists whatsapp_messages_delivery_method_check;
alter table public.whatsapp_messages add constraint whatsapp_messages_delivery_method_check check (delivery_method in ('TEMPLATE','CUSTOMER_INITIATED','MANUAL','NONE'));
