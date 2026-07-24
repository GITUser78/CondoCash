-- ============================================================================
-- Grants for the PostgREST roles.
--
-- Supabase Cloud configures ALTER DEFAULT PRIVILEGES for the role that runs
-- migrations, so tables created there are reachable by anon / authenticated /
-- service_role automatically — which is why the app worked without this file.
-- Any other instance (a local `supabase start`, a restore into a fresh
-- project, a self-hosted stack) ends up with tables PostgREST cannot touch at
-- all: "permission denied for table profiles". Found by the integration suite
-- running against a local stack.
--
-- Grants only get a role through the door; Row Level Security still decides
-- which rows it may see. anon holds DML privileges here exactly as in a stock
-- Supabase project, and every table in this schema has RLS enabled with
-- policies that keep anonymous callers out.
-- ============================================================================
grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema public
  to anon, authenticated, service_role;

grant usage, select on all sequences in schema public
  to anon, authenticated, service_role;

grant execute on all functions in schema public
  to anon, authenticated, service_role;

-- Anything added by later migrations inherits the same treatment.
alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated, service_role;

alter default privileges in schema public
  grant usage, select on sequences to anon, authenticated, service_role;

alter default privileges in schema public
  grant execute on functions to anon, authenticated, service_role;
