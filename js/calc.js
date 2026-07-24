// ---------------------------------------------------------------------------
// Fee maths — mirrors generate_charges() in supabase/schema.sql so the UI can
// preview what an apartment will be charged without hitting the database.
// ---------------------------------------------------------------------------

/** How many units the rate is multiplied by for this apartment. */
export function feeUnits(fee, apartment) {
  switch (fee.calc_type) {
    case "per_dweller": return apartment.num_dwellers || 0;
    case "per_m2":      return Number(apartment.area_m2 || 0);
    default:            return 1; // flat
  }
}

/** base per apartment + rate × units — mirrors fee_amount_for() in SQL. */
export function feeAmount(fee, apartment) {
  return round2(Number(fee.base_amount || 0) + Number(fee.rate || 0) * feeUnits(fee, apartment));
}

/** Total monthly amount for one apartment across all active fee categories. */
export function monthlyFee(apartment, fees) {
  return round2(
    fees.filter((f) => f.active).reduce((s, f) => s + feeAmount(f, apartment), 0)
  );
}

export function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

export const sum = (rows, key) => round2(rows.reduce((s, r) => s + Number(r[key] || 0), 0));
