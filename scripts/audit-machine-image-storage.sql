-- READ ONLY. Run in the SQL Editor of the Supabase project used by the app.
-- No credentials, profile identities or catalogue data are returned.
select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets where id = 'machine-images';

-- Inspect ALL policies: an unrelated permissive policy can also grant access,
-- and a restrictive policy can block an otherwise valid admin INSERT.
select policyname, permissive, roles, cmd, qual, with_check
from pg_policies where schemaname = 'storage' and tablename = 'objects'
order by cmd, policyname;

select p.oid::regprocedure as function_name, p.prosecdef as security_definer,
       p.proconfig as function_settings,
       has_schema_privilege('authenticated', 'public', 'USAGE') as public_schema_usage,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
       pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'is_admin';

select policyname, permissive, roles, cmd, qual, with_check
from pg_policies where schemaname = 'public' and tablename = 'profiles';

select version from supabase_migrations.schema_migrations
where version in ('20260905000020', '20260905000021') order by version;

-- auth.uid() in the SQL Editor usually does NOT represent the browser admin.
-- The app's getUser() + profile check verifies that session during the upload.
