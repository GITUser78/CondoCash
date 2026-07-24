// ---------------------------------------------------------------------------
// All database access lives here. Every call goes through Supabase/PostgREST;
// permissions are enforced by the RLS policies in supabase/schema.sql.
// ---------------------------------------------------------------------------
import { sb, unwrap } from "./supabase.js";

// ---------- auth / profile -------------------------------------------------
export async function signIn(email, password) {
  return unwrap(await sb().auth.signInWithPassword({ email, password }));
}
export async function signOut() {
  await sb().auth.signOut();
}
export async function getSession() {
  const { data } = await sb().auth.getSession();
  return data.session;
}
export async function getProfile(userId) {
  return unwrap(
    await sb().from("profiles").select("*").eq("id", userId).maybeSingle()
  );
}
export async function updateProfile(id, patch) {
  return unwrap(await sb().from("profiles").update(patch).eq("id", id).select().single());
}
export async function listProfiles() {
  return unwrap(await sb().from("profiles").select("*").order("full_name"));
}

// ---------- condos ---------------------------------------------------------
export async function listCondos() {
  return unwrap(await sb().from("condos").select("*").order("name"));
}
export async function saveCondo(row) {
  const q = row.id
    ? sb().from("condos").update(strip(row)).eq("id", row.id)
    : sb().from("condos").insert(strip(row));
  return unwrap(await q.select().single());
}
export async function deleteCondo(id) {
  return unwrap(await sb().from("condos").delete().eq("id", id));
}
export async function listCondoCashiers(condoId) {
  return unwrap(
    await sb().from("condo_cashiers").select("condo_id, user_id").eq("condo_id", condoId)
  );
}
export async function listAllCondoCashiers() {
  return unwrap(await sb().from("condo_cashiers").select("condo_id, user_id"));
}
export async function setCondoCashier(condoId, userId, on) {
  if (on) {
    return unwrap(
      await sb().from("condo_cashiers").upsert({ condo_id: condoId, user_id: userId })
    );
  }
  return unwrap(
    await sb().from("condo_cashiers").delete().eq("condo_id", condoId).eq("user_id", userId)
  );
}

// ---------- apartments -----------------------------------------------------
export async function listApartments(condoId) {
  return unwrap(
    await sb().from("apartments").select("*").eq("condo_id", condoId).order("number")
  );
}
export async function saveApartment(row) {
  const q = row.id
    ? sb().from("apartments").update(strip(row)).eq("id", row.id)
    : sb().from("apartments").insert(strip(row));
  return unwrap(await q.select().single());
}
export async function deleteApartment(id) {
  return unwrap(await sb().from("apartments").delete().eq("id", id));
}

// ---------- fee categories -------------------------------------------------
export async function listFees(condoId) {
  return unwrap(
    await sb().from("fee_categories").select("*").eq("condo_id", condoId).order("name")
  );
}
export async function saveFee(row) {
  const q = row.id
    ? sb().from("fee_categories").update(strip(row)).eq("id", row.id)
    : sb().from("fee_categories").insert(strip(row));
  return unwrap(await q.select().single());
}
export async function deleteFee(id) {
  return unwrap(await sb().from("fee_categories").delete().eq("id", id));
}

// ---------- charges --------------------------------------------------------
export async function listCharges(condoId, { from, to, apartmentId } = {}) {
  let q = sb()
    .from("charges")
    .select("*, apartments(number, owner_name), fee_categories(name)")
    .eq("condo_id", condoId);
  if (from) q = q.gte("period", from);
  if (to) q = q.lte("period", to);
  if (apartmentId) q = q.eq("apartment_id", apartmentId);
  return unwrap(await q.order("period", { ascending: false }));
}
export async function saveCharge(row) {
  const q = row.id
    ? sb().from("charges").update(strip(row)).eq("id", row.id)
    : sb().from("charges").insert(strip(row));
  return unwrap(await q.select().single());
}
export async function deleteCharge(id) {
  return unwrap(await sb().from("charges").delete().eq("id", id));
}
export async function generateCharges(condoId, period, dueDate) {
  return unwrap(
    await sb().rpc("generate_charges", {
      p_condo_id: condoId,
      p_period: period,
      p_due_date: dueDate || null,
    })
  );
}
export async function previewCharges(condoId, period) {
  return unwrap(
    await sb().rpc("preview_charges", { p_condo_id: condoId, p_period: period })
  );
}

// ---------- payments -------------------------------------------------------
export async function listPayments(condoId, { from, to, apartmentId, limit } = {}) {
  let q = sb()
    .from("payments")
    .select("*, apartments(number, owner_name)")
    .eq("condo_id", condoId);
  if (from) q = q.gte("paid_on", from);
  if (to) q = q.lte("paid_on", to);
  if (apartmentId) q = q.eq("apartment_id", apartmentId);
  q = q.order("paid_on", { ascending: false }).order("created_at", { ascending: false });
  if (limit) q = q.limit(limit);
  return unwrap(await q);
}
export async function savePayment(row) {
  const q = row.id
    ? sb().from("payments").update(strip(row)).eq("id", row.id)
    : sb().from("payments").insert(strip(row));
  return unwrap(await q.select("*, apartments(number, owner_name)").single());
}
export async function deletePayment(id) {
  return unwrap(await sb().from("payments").delete().eq("id", id));
}

// ---------- expenses -------------------------------------------------------
export async function listExpenses(condoId, { from, to, limit } = {}) {
  let q = sb().from("expenses").select("*").eq("condo_id", condoId);
  if (from) q = q.gte("spent_on", from);
  if (to) q = q.lte("spent_on", to);
  q = q.order("spent_on", { ascending: false }).order("created_at", { ascending: false });
  if (limit) q = q.limit(limit);
  return unwrap(await q);
}
export async function saveExpense(row) {
  const q = row.id
    ? sb().from("expenses").update(strip(row)).eq("id", row.id)
    : sb().from("expenses").insert(strip(row));
  return unwrap(await q.select().single());
}
export async function deleteExpense(id) {
  return unwrap(await sb().from("expenses").delete().eq("id", id));
}

// ---------- balances / summaries ------------------------------------------
export async function listBalances(condoId) {
  return unwrap(
    await sb().from("apartment_balances").select("*").eq("condo_id", condoId).order("number")
  );
}
export async function cashSummary(condoId) {
  return unwrap(
    await sb().from("condo_cash_summary").select("*").eq("condo_id", condoId).maybeSingle()
  );
}

/**
 * Cash on hand the day before `beforeISO` — everything collected minus
 * everything spent up to that point. Used as the opening balance of a protocol.
 */
export async function openingCashBalance(condoId, beforeISO) {
  const until = new Date(beforeISO);
  until.setDate(until.getDate() - 1);
  const to = until.toISOString().slice(0, 10);
  const [payments, expenses] = await Promise.all([
    listPayments(condoId, { to }),
    listExpenses(condoId, { to }),
  ]);
  const total = (rows) => rows.reduce((s, r) => s + Number(r.amount), 0);
  return total(payments) - total(expenses);
}

/** Drop undefined keys and empty strings so Postgres gets nulls, not "". */
function strip(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === undefined || k === "id") continue;
    out[k] = v === "" ? null : v;
  }
  return out;
}
