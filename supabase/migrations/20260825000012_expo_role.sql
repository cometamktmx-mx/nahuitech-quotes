-- The enum value is isolated because PostgreSQL cannot safely use a newly
-- added enum value in policies/functions until a later migration transaction.
alter type public.profile_role add value if not exists 'expo';
