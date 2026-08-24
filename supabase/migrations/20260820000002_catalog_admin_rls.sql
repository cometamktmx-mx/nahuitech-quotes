begin;

grant insert, update, delete on table public.machines, public.addons, public.machine_addons to authenticated;

create policy "Active admins can manage machines"
on public.machines
for all
to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

create policy "Active admins can manage addons"
on public.addons
for all
to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

create policy "Active admins can manage machine addons"
on public.machine_addons
for all
to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

commit;
