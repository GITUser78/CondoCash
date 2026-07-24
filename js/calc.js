// ---------------------------------------------------------------------------
// Fee maths — mirrors generate_charges() in supabase/schema.sql so the UI can
// preview what an apartment will be charged without hitting the database.
// ---------------------------------------------------------------------------

export function feeAmount(fee, apartment) {
  const rate = Number(fee.rate || 0);
  switch (fee.calc_type) {
    case "per_dweller": return round2(rate * (apartment.num_dwellers || 0));
    case "per_m2":      return round2(rate * Number(apartment.area_m2 || 0));
    default:            return round2(rate); // flat
  }
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
