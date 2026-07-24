-- ============================================================================
-- CondoCash — Supabase schema
-- Run this once in the Supabase SQL Editor (Dashboard → SQL → New query).
-- It is idempotent-ish: safe to re-run, but dropping is up to you.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$ begin
  create type user_role as enum ('admin', 'cashier');
exception when duplicate_object then null; end $$;

do $$ begin
  -- how a fee category is turned into a per-apartment amount
  create type fee_calc_type as enum ('per_dweller', 'flat', 'per_m2');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Profiles (1-1 with auth.users)
-- ---------------------------------------------------------------------------
create table if not exists profiles (
  id                 uuid primary key references auth.users(id) on delete cascade,
  full_name          text,
  role               user_role not null default 'cashier',
  preferred_language text not null default 'bg',
  created_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Condos
-- ---------------------------------------------------------------------------
create table if not exists condos (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  address    text,
  currency   text not null default 'BGN',
  created_at timestamptz not null default now()
);

-- Which cashiers may work on which condo (admins see everything anyway)
create table if not exists condo_cashiers (
  condo_id uuid references condos(id) on delete cascade,
  user_id  uuid references profiles(id) on delete cascade,
  primary key (condo_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Helper functions (SECURITY DEFINER so they can read profiles/condo_cashiers
-- without tripping over the policies that are themselves defined in terms of
-- these functions). Defined after the tables they read.
-- ---------------------------------------------------------------------------
create or replace function is_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function can_access_condo(cid uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select is_admin() or exists (
    select 1 from condo_cashiers
    where condo_id = cid and user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- Apartments (owner details are embedded on the apartment)
-- ---------------------------------------------------------------------------
create table if not exists apartments (
  id           uuid primary key default gen_random_uuid(),
  condo_id     uuid not null references condos(id) on delete cascade,
  number       text not null,
  floor        int,
  area_m2      numeric(10,2),
  num_dwellers int not null default 1 check (num_dwellers >= 0),
  owner_name   text,
  owner_email  text,
  owner_phone  text,
  created_at   timestamptz not null default now(),
  unique (condo_id, number)
);
create index if not exists apartments_condo_idx on apartments(condo_id);

-- ---------------------------------------------------------------------------
-- Fee categories (admin-configured, per condo)
-- ---------------------------------------------------------------------------
create table if not exists fee_categories (
  id         uuid primary key default gen_random_uuid(),
  condo_id   uuid not null references condos(id) on delete cascade,
  name       text not null,
  calc_type  fee_calc_type not null,
  rate       numeric(12,4) not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists fee_categories_condo_idx on fee_categories(condo_id);

-- ---------------------------------------------------------------------------
-- Charges  (debits — what an apartment owes for a period/category)
-- ---------------------------------------------------------------------------
create table if not exists charges (
  id              uuid primary key default gen_random_uuid(),
  condo_id        uuid not null references condos(id) on delete cascade,
  apartment_id    uuid not null references apartments(id) on delete cascade,
  fee_category_id uuid references fee_categories(id) on delete set null,
  period          date not null,                -- first day of the month
  description     text,
  amount          numeric(12,2) not null,
  due_date        date,
  created_at      timestamptz not null default now(),
  unique (apartment_id, period, fee_category_id)
);
create index if not exists charges_condo_idx on charges(condo_id);
create index if not exists charges_apartment_idx on charges(apartment_id);

-- ---------------------------------------------------------------------------
-- Payments (credits — money received from an apartment)
-- ---------------------------------------------------------------------------
create table if not exists payments (
  id           uuid primary key default gen_random_uuid(),
  condo_id     uuid not null references condos(id) on delete cascade,
  apartment_id uuid not null references apartments(id) on delete cascade,
  amount       numeric(12,2) not null check (amount > 0),
  paid_on      date not null default current_date,
  method       text,
  note         text,
  recorded_by  uuid references profiles(id),
  created_at   timestamptz not null default now()
);
create index if not exists payments_condo_idx on payments(condo_id);
create index if not exists payments_apartment_idx on payments(apartment_id);

-- ---------------------------------------------------------------------------
-- Expenses (what the cashier pays out of the cash box: cleaning, repairs, …)
-- ---------------------------------------------------------------------------
create table if not exists expenses (
  id          uuid primary key default gen_random_uuid(),
  condo_id    uuid not null references condos(id) on delete cascade,
  spent_on    date not null default current_date,
  category    text,
  description text not null,
  vendor      text,
  receipt_no  text,
  amount      numeric(12,2) not null check (amount > 0),
  recorded_by uuid references profiles(id),
  created_at  timestamptz not null default now()
);
create index if not exists expenses_condo_idx on expenses(condo_id);
create index if not exists expenses_date_idx on expenses(condo_id, spent_on);

-- ---------------------------------------------------------------------------
-- Balances view (charged - paid per apartment). security_invoker => RLS applies.
-- `oldest_due_date` is the due date of the oldest charge that is not yet
-- covered by the apartment's payments (payments are allocated FIFO), which is
-- what the reminder screen keys off.
-- ---------------------------------------------------------------------------
drop view if exists apartment_balances;
create view apartment_balances
with (security_invoker = true) as
with paid as (
  select apartment_id, sum(amount) as total_paid
  from payments group by apartment_id
),
charged as (
  select apartment_id, sum(amount) as total_charged
  from charges group by apartment_id
),
open_charges as (
  select r.apartment_id, min(r.due_date) as oldest_due_date
  from (
    select
      c.apartment_id,
      c.due_date,
      sum(c.amount) over (
        partition by c.apartment_id
        order by c.due_date nulls last, c.created_at
        rows between unbounded preceding and current row
      ) as running_total
    from charges c
  ) r
  left join paid on paid.apartment_id = r.apartment_id
  where r.running_total > coalesce(paid.total_paid, 0)
  group by r.apartment_id
)
select
  a.id         as apartment_id,
  a.condo_id   as condo_id,
  a.number     as number,
  a.owner_name as owner_name,
  a.owner_email as owner_email,
  a.num_dwellers as num_dwellers,
  coalesce(charged.total_charged, 0)                             as total_charged,
  coalesce(paid.total_paid, 0)                                   as total_paid,
  coalesce(charged.total_charged, 0) - coalesce(paid.total_paid, 0) as balance,
  open_charges.oldest_due_date                                   as oldest_due_date
from apartments a
left join charged     on charged.apartment_id = a.id
left join paid        on paid.apartment_id = a.id
left join open_charges on open_charges.apartment_id = a.id;

-- ---------------------------------------------------------------------------
-- Cash box summary per condo: money in (payments), money out (expenses).
-- ---------------------------------------------------------------------------
create or replace view condo_cash_summary
with (security_invoker = true) as
select
  c.id                                                   as condo_id,
  coalesce(ch.total, 0)                                  as total_charged,
  coalesce(p.total, 0)                                   as total_collected,
  coalesce(e.total, 0)                                   as total_spent,
  coalesce(p.total, 0) - coalesce(e.total, 0)            as cash_balance,
  coalesce(ch.total, 0) - coalesce(p.total, 0)           as total_outstanding
from condos c
left join (select condo_id, sum(amount) as total from charges  group by condo_id) ch on ch.condo_id = c.id
left join (select condo_id, sum(amount) as total from payments group by condo_id) p  on p.condo_id  = c.id
left join (select condo_id, sum(amount) as total from expenses group by condo_id) e  on e.condo_id  = c.id;

-- ============================================================================
-- Row Level Security
-- ============================================================================
alter table profiles       enable row level security;
alter table condos         enable row level security;
alter table condo_cashiers enable row level security;
alter table apartments     enable row level security;
alter table fee_categories enable row level security;
alter table charges        enable row level security;
alter table payments       enable row level security;
alter table expenses       enable row level security;

-- profiles ------------------------------------------------------------------
drop policy if exists profiles_select on profiles;
create policy profiles_select on profiles for select
  using (id = auth.uid() or is_admin());

drop policy if exists profiles_update_self on profiles;
create policy profiles_update_self on profiles for update
  using (id = auth.uid() or is_admin())
  with check (id = auth.uid() or is_admin());

drop policy if exists profiles_admin_write on profiles;
create policy profiles_admin_write on profiles for insert
  with check (is_admin());

-- Prevent non-admins from escalating their own role
create or replace function guard_profile_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.role is distinct from old.role) and not is_admin() then
    raise exception 'Only admins can change roles';
  end if;
  return new;
end $$;
drop trigger if exists guard_profile_role_trg on profiles;
create trigger guard_profile_role_trg before update on profiles
  for each row execute function guard_profile_role();

-- condos --------------------------------------------------------------------
drop policy if exists condos_select on condos;
create policy condos_select on condos for select
  using (can_access_condo(id));
drop policy if exists condos_admin_all on condos;
create policy condos_admin_all on condos for all
  using (is_admin()) with check (is_admin());

-- condo_cashiers ------------------------------------------------------------
drop policy if exists cc_select on condo_cashiers;
create policy cc_select on condo_cashiers for select
  using (is_admin() or user_id = auth.uid());
drop policy if exists cc_admin_all on condo_cashiers;
create policy cc_admin_all on condo_cashiers for all
  using (is_admin()) with check (is_admin());

-- apartments ----------------------------------------------------------------
drop policy if exists apt_select on apartments;
create policy apt_select on apartments for select
  using (can_access_condo(condo_id));
drop policy if exists apt_admin_all on apartments;
create policy apt_admin_all on apartments for all
  using (is_admin()) with check (is_admin());

-- fee_categories ------------------------------------------------------------
drop policy if exists fee_select on fee_categories;
create policy fee_select on fee_categories for select
  using (can_access_condo(condo_id));
drop policy if exists fee_admin_all on fee_categories;
create policy fee_admin_all on fee_categories for all
  using (is_admin()) with check (is_admin());

-- charges -------------------------------------------------------------------
drop policy if exists charges_select on charges;
create policy charges_select on charges for select
  using (can_access_condo(condo_id));
drop policy if exists charges_admin_all on charges;
create policy charges_admin_all on charges for all
  using (is_admin()) with check (is_admin());

-- payments ------------------------------------------------------------------
drop policy if exists pay_select on payments;
create policy pay_select on payments for select
  using (can_access_condo(condo_id));
-- Cashiers (and admins) may record payments for condos they can access
drop policy if exists pay_insert on payments;
create policy pay_insert on payments for insert
  with check (can_access_condo(condo_id));
-- The recorder or an admin may amend/delete
drop policy if exists pay_update on payments;
create policy pay_update on payments for update
  using (is_admin() or recorded_by = auth.uid())
  with check (is_admin() or recorded_by = auth.uid());
drop policy if exists pay_delete on payments;
create policy pay_delete on payments for delete
  using (is_admin() or recorded_by = auth.uid());

-- expenses ------------------------------------------------------------------
-- Same rules as payments: cashiers book the money they spend for their condo,
-- and may amend only their own entries; admins may touch everything.
drop policy if exists exp_select on expenses;
create policy exp_select on expenses for select
  using (can_access_condo(condo_id));
drop policy if exists exp_insert on expenses;
create policy exp_insert on expenses for insert
  with check (can_access_condo(condo_id));
drop policy if exists exp_update on expenses;
create policy exp_update on expenses for update
  using (is_admin() or recorded_by = auth.uid())
  with check (is_admin() or recorded_by = auth.uid());
drop policy if exists exp_delete on expenses;
create policy exp_delete on expenses for delete
  using (is_admin() or recorded_by = auth.uid());

-- ============================================================================
-- Auto-create a profile whenever a new auth user signs up
-- ============================================================================
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''), 'cashier')
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- ============================================================================
-- generate_charges(condo, period, due_date?) — admin only.
-- Creates one charge per apartment × active fee category for the given month.
-- Re-running the same month is safe (existing rows are skipped).
-- ============================================================================
create or replace function generate_charges(
  p_condo_id uuid,
  p_period   date,
  p_due_date date default null
)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_count int := 0;
begin
  if not is_admin() then
    raise exception 'Only admins can generate charges';
  end if;

  insert into charges (condo_id, apartment_id, fee_category_id, period, description, amount, due_date)
  select
    fc.condo_id,
    a.id,
    fc.id,
    date_trunc('month', p_period)::date,
    fc.name,
    round(
      case fc.calc_type
        when 'per_dweller' then fc.rate * a.num_dwellers
        when 'per_m2'      then fc.rate * coalesce(a.area_m2, 0)
        else                    fc.rate            -- 'flat'
      end, 2),
    coalesce(
      p_due_date,
      (date_trunc('month', p_period) + interval '1 month' - interval '1 day')::date
    )
  from fee_categories fc
  join apartments a on a.condo_id = fc.condo_id
  where fc.condo_id = p_condo_id
    and fc.active = true
  on conflict (apartment_id, period, fee_category_id) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Preview what generate_charges would produce, without writing anything.
create or replace function preview_charges(p_condo_id uuid, p_period date)
returns table (apartment_id uuid, apartment_number text, fee_name text, amount numeric)
language sql stable security definer set search_path = public as $$
  select a.id, a.number, fc.name,
    round(case fc.calc_type
      when 'per_dweller' then fc.rate * a.num_dwellers
      when 'per_m2'      then fc.rate * coalesce(a.area_m2, 0)
      else                    fc.rate end, 2)
  from fee_categories fc
  join apartments a on a.condo_id = fc.condo_id
  where fc.condo_id = p_condo_id and fc.active = true
    and can_access_condo(p_condo_id)
  order by a.number, fc.name;
$$;
