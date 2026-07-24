// ---------------------------------------------------------------------------
// Tiny global app state. Views read it; app.js keeps it up to date.
// ---------------------------------------------------------------------------

export const state = {
  session: null,     // supabase session
  profile: null,     // row from `profiles`
  condos: [],        // condos the signed-in user can access
  condoId: null,     // currently selected condo id
  view: "dashboard", // active tab
};

export const isAdmin = () => state.profile?.role === "admin";
export const condo = () => state.condos.find((c) => c.id === state.condoId) || null;
export const currency = () => condo()?.currency || "BGN";

const LS_CONDO = "condocash.condo";
const LS_LANG = "condocash.lang";

export function rememberCondo(id) {
  state.condoId = id;
  try { localStorage.setItem(LS_CONDO, id ?? ""); } catch {}
}
export function recalledCondo() {
  try { return localStorage.getItem(LS_CONDO) || null; } catch { return null; }
}
export function rememberLang(lang) {
  try { localStorage.setItem(LS_LANG, lang); } catch {}
}
export function recalledLang() {
  try { return localStorage.getItem(LS_LANG); } catch { return null; }
}
