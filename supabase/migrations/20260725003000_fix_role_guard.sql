-- ============================================================================
-- Fix: the role guard also blocked privileged (non end-user) connections, so
-- there was no way to appoint the *first* administrator — neither from the
-- dashboard SQL editor (runs as `postgres`) nor with the service_role key.
-- Both have no JWT, hence auth.uid() is null and is_admin() returned false.
--
-- The guard now only applies to real end-user sessions (auth.uid() is not
-- null). That does not weaken it: a session without a JWT is either the
-- service key / a superuser (already trusted, server-side only) or anon — and
-- anon cannot pass the profiles UPDATE policy for any row in the first place,
-- since that policy requires id = auth.uid() or is_admin().
-- ============================================================================
create or replace function guard_profile_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.role is distinct from old.role)
     and auth.uid() is not null
     and not is_admin() then
    raise exception 'Only admins can change roles';
  end if;
  return new;
end $$;
