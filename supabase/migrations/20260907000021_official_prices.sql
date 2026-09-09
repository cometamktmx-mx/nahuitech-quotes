begin;

-- Commercial source of truth: public prices INCLUDING 16% IVA.
-- Resolve existing identities only; never insert duplicate machines.
do $$
begin
  if (select count(*) from public.machines where slug in (
    'hyro-set-omen','hyro-set-pro-8','hyro-set-pro-6','hyro-set-compact-4',
    'hyro-set-basic-4','hyro-set-tri-basic','hyro-set-intro','nahui-pre-set-dtf','nahui-flash-on'
  )) <> 9 then raise exception 'Official price mapping requires all nine existing machine slugs.'; end if;
end $$;

update public.machines m set base_price = s.price
from (values
 ('hyro-set-omen',250000.00), ('hyro-set-pro-8',212000.00),
 ('hyro-set-pro-6',159000.00), ('hyro-set-compact-4',106000.00),
 ('hyro-set-basic-4',59990.00), ('hyro-set-tri-basic',45990.00),
 ('hyro-set-intro',100000.00), ('nahui-pre-set-dtf',34990.00),
 ('nahui-flash-on',69990.00)
) s(slug,price) where m.slug=s.slug;

update public.machines set name='Nahui Preset DTG', short_description='Equipo de presecado DTG'
where slug='nahui-pre-set-dtf';
update public.machines set name='Hyro Set OME' where slug='hyro-set-omen';

update public.machine_variants v set active=false
from public.machines m where v.machine_id=m.id
and m.slug in ('hyro-set-basic-4','hyro-set-tri-basic') and v.variant_type='AUTOMATIC';
update public.machines set variant_selection_required=false,
allowed_variant_types=array['SEMI_AUTOMATIC'::public.machine_variant_type]
where slug in ('hyro-set-basic-4','hyro-set-tri-basic');

insert into public.machine_variants(machine_id,variant_type,display_name,price,active,sort_order)
select m.id,s.kind::public.machine_variant_type,
case s.kind when 'AUTOMATIC' then 'Automática' else 'Semiautomática' end,s.price,true,
case s.kind when 'AUTOMATIC' then 0 else 1 end
from public.machines m join (values
 ('hyro-set-omen','AUTOMATIC',250000.00), ('hyro-set-omen','SEMI_AUTOMATIC',127000.00),
 ('hyro-set-pro-8','AUTOMATIC',212000.00), ('hyro-set-pro-8','SEMI_AUTOMATIC',181000.00),
 ('hyro-set-pro-6','AUTOMATIC',159000.00), ('hyro-set-pro-6','SEMI_AUTOMATIC',136000.00),
 ('hyro-set-compact-4','AUTOMATIC',106000.00), ('hyro-set-compact-4','SEMI_AUTOMATIC',90000.00),
 ('hyro-set-basic-4','SEMI_AUTOMATIC',59990.00)
) s(slug,kind,price) on m.slug=s.slug
on conflict(machine_id,variant_type) do update set price=excluded.price,active=true;

do $$
begin
  if round(250000.00/1.16,2) <> 215517.24
     or round(212000.00/1.16,2) <> 182758.62
     or round(159000.00/1.16,2) <> 137068.97
     or round(106000.00/1.16,2) <> 91379.31
     or round(100000.00/1.16,2) <> 86206.90
     or round(34990.00/1.16,2) <> 30163.79
     or round(69990.00/1.16,2) <> 60336.21
  then raise exception 'Official gross/net VAT table does not match expected values.'; end if;
end $$;

-- Tri-Basic / Intro / Preset / Flash retain their single-equipment model.
-- No historical quote or snapshot is updated.
commit;
