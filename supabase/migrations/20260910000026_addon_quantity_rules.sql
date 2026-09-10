update public.addons
set calculation_type = 'QUANTITY', updated_at = now()
where id in (
  'd2486323-5daa-418a-8cc3-f25215f1357b'::uuid,
  'a3efa6fd-05cb-4917-96d1-67a0d81c7a45'::uuid
);
