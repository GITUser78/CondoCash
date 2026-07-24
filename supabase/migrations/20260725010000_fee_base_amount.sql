-- ============================================================================
-- Fees get a fixed base per apartment on top of the variable part, so a
-- category can read "10.00 per apartment + 3.00 per dweller" (2 dwellers →
-- 16.00). `calc_type` keeps describing what `rate` is multiplied by; the new
-- `base_amount` is simply added once per apartment.
--
-- Additive and backward compatible: base_amount defaults to 0, so every
-- existing category keeps charging exactly what it charged before.
-- ============================================================================
alter table fee_categories
  add column if not exists base_amount numeric(12,4) not null default 0;

comment on column fee_categories.base_amount is
  'Fixed amount charged once per apartment, added to rate * units.';

-- ---------------------------------------------------------------------------
-- Shared fee maths, so generate_charges() and preview_charges() cannot drift
-- apart (js/calc.js mirrors this for the UI preview).
-- ---------------------------------------------------------------------------
create or replace function fee_amount_for(
  p_base      numeric,
  p_rate      numeric,
  p_calc_type fee_calc_type,
  p_dwellers  int,
  p_area_m2   numeric
)
returns numeric
language sql immutable as $$
  select round(
    coalesce(p_base, 0) +
    coalesce(p_rate, 0) * case p_calc_type
      when 'per_dweller' then coalesce(p_dwellers, 0)
      when 'per_m2'      then coalesce(p_area_m2, 0)
      else                    1              -- 'flat'
    end
  , 2);
$$;

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
    fee_amount_for(fc.base_amount, fc.rate, fc.calc_type, a.num_dwellers, a.area_m2),
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

create or replace function preview_charges(p_condo_id uuid, p_period date)
returns table (apartment_id uuid, apartment_number text, fee_name text, amount numeric)
language sql stable security definer set search_path = public as $$
  select a.id, a.number, fc.name,
    fee_amount_for(fc.base_amount, fc.rate, fc.calc_type, a.num_dwellers, a.area_m2)
  from fee_categories fc
  join apartments a on a.condo_id = fc.condo_id
  where fc.condo_id = p_condo_id and fc.active = true
    and can_access_condo(p_condo_id)
  order by a.number, fc.name;
$$;
