// ---------------------------------------------------------------------------
// Apartments & owners. Admins maintain the register (this is where the number
// of dwellers per apartment is kept, which drives the per-dweller fees);
// cashiers get a read-only list plus each apartment's account statement.
// ---------------------------------------------------------------------------
import * as api from "../api.js";
import { t } from "../i18n.js";
import { state, isAdmin } from "../state.js";
import {
  h, table, money, fmtDate, field, input, openModal, confirmDelete, toast, clear,
} from "../ui.js";
import { monthlyFee } from "../calc.js";
import { apartmentRegister, ledgerDoc, print } from "../print.js";

let search = "";

export async function render(root, ctx) {
  const condoId = state.condoId;
  const [apartments, fees, balances] = await Promise.all([
    api.listApartments(condoId),
    api.listFees(condoId),
    api.listBalances(condoId),
  ]);

  const q = search.trim().toLowerCase();
  const rows = q
    ? apartments.filter((a) =>
        [a.number, a.owner_name, a.owner_email, a.owner_phone]
          .some((v) => String(v || "").toLowerCase().includes(q)))
    : apartments;

  const balanceOf = (id) => Number(balances.find((b) => b.apartment_id === id)?.balance || 0);
  const totalDwellers = apartments.reduce((s, a) => s + (a.num_dwellers || 0), 0);
  const totalMonthly = apartments.reduce((s, a) => s + monthlyFee(a, fees), 0);

  root.append(
    h("div.card", {},
      h("div.section-title", {},
        h("h2", {}, t("nav_apartments")),
        h("div.btn-row", { style: { marginTop: 0 } },
          h("button.btn.secondary.small", {
            onclick: () => print(apartmentRegister(apartments, (a) => monthlyFee(a, fees))),
          }, "🖨 " + t("print")),
          isAdmin()
            ? h("button.btn", { onclick: () => openApartmentModal({ ctx }) }, "＋ " + t("add_apartment"))
            : null)),

      h("div", { style: { maxWidth: "320px", marginBottom: ".7rem" } },
        input({
          type: "search", placeholder: t("search"), value: search,
          oninput: (e) => { search = e.target.value; },
          onsearch: (e) => { search = e.target.value; ctx.refresh(); },
          onchange: (e) => { search = e.target.value; ctx.refresh(); },
        })),

      table(
        [{ label: t("apt_number") }, { label: t("apt_floor"), num: true },
         { label: t("apt_area"), num: true }, { label: t("apt_dwellers"), num: true },
         { label: t("owner_name") }, { label: t("owner_phone") },
         { label: t("monthly_fee"), num: true },
         { label: t("balance"), num: true }, { label: t("actions") }],
        rows,
        (a) => {
          const bal = balanceOf(a.id);
          return [
            a.number,
            a.floor ?? "—",
            a.area_m2 ?? "—",
            a.num_dwellers,
            a.owner_name || "—",
            a.owner_phone || "—",
            money(monthlyFee(a, fees)),
            { v: money(bal), class: bal > 0.004 ? "owe" : "", num: true },
            h("div", { style: { display: "flex", gap: ".2rem" } },
              h("button.icon-btn", {
                title: t("view_ledger"), onclick: () => openLedger(a),
              }, "📄"),
              isAdmin() ? h("button.icon-btn", {
                title: t("edit"), onclick: () => openApartmentModal({ ctx, apartment: a }),
              }, "✎") : null,
              isAdmin() ? h("button.icon-btn.danger", {
                title: t("delete"),
                onclick: async () => {
                  if (!confirmDelete()) return;
                  await api.deleteApartment(a.id);
                  toast(t("saved"));
                  ctx.refresh();
                },
              }, "🗑") : null),
          ];
        },
        { foot: ["", "", "", String(totalDwellers), "", t("total"), money(totalMonthly), "", ""] })
    )
  );
}

// ---------------------------------------------------------------------------
function openApartmentModal({ ctx, apartment = null }) {
  const number = input({ required: true, value: apartment?.number || "" });
  const floor = input({ type: "number", value: apartment?.floor ?? "" });
  const area = input({ type: "number", step: "0.01", min: "0", value: apartment?.area_m2 ?? "" });
  const dwellers = input({ type: "number", min: "0", required: true, value: apartment?.num_dwellers ?? 1 });
  const owner = input({ value: apartment?.owner_name || "" });
  const email = input({ type: "email", value: apartment?.owner_email || "" });
  const phone = input({ value: apartment?.owner_phone || "" });

  const body = h("div.form-grid", {},
    field(t("apt_number"), number),
    field(t("apt_floor"), floor),
    field(t("apt_area"), area),
    field(t("apt_dwellers"), dwellers),
    field(t("owner_name"), owner),
    field(t("owner_email"), email),
    field(t("owner_phone"), phone));

  return openModal({
    title: apartment ? t("edit_apartment") : t("add_apartment"),
    body,
    onSave: async ({ fail }) => {
      if (!number.value.trim()) { fail(t("required")); return false; }
      await api.saveApartment({
        id: apartment?.id,
        condo_id: state.condoId,
        number: number.value.trim(),
        floor: floor.value === "" ? null : Number(floor.value),
        area_m2: area.value === "" ? null : Number(area.value),
        num_dwellers: Number(dwellers.value || 0),
        owner_name: owner.value.trim(),
        owner_email: email.value.trim(),
        owner_phone: phone.value.trim(),
      });
      toast(t("saved"));
      ctx.refresh();
    },
  });
}

// ---------------------------------------------------------------------------
// Account statement: charges and payments of one apartment, oldest first.
// ---------------------------------------------------------------------------
export async function openLedger(apartment) {
  const box = h("div", {}, h("div.empty", {}, t("loading")));
  openModal({
    title: `${t("ledger")} — ${t("ledger_for", { apt: apartment.number })}`,
    body: box,
    wide: true,
  });

  const [charges, payments] = await Promise.all([
    api.listCharges(state.condoId, { apartmentId: apartment.id }),
    api.listPayments(state.condoId, { apartmentId: apartment.id }),
  ]);

  const entries = [
    ...charges.map((c) => ({
      date: c.due_date || c.period,
      description: c.fee_categories?.name || c.description || t("charges"),
      debit: Number(c.amount), credit: 0,
    })),
    ...payments.map((p) => ({
      date: p.paid_on,
      description: [t("paid"), p.method, p.note].filter(Boolean).join(" · "),
      debit: 0, credit: Number(p.amount),
    })),
  ].sort((a, b) => String(a.date).localeCompare(String(b.date)));

  let running = 0;
  const rows = entries.map((e) => ({ ...e, running: (running += e.debit - e.credit) }));

  clear(box).append(
    table(
      [{ label: t("date") }, { label: t("description") }, { label: t("debit"), num: true },
       { label: t("credit"), num: true }, { label: t("running_balance"), num: true }],
      rows,
      (r) => [fmtDate(r.date), r.description,
              r.debit ? money(r.debit) : "", r.credit ? money(r.credit) : "", money(r.running)],
      { foot: ["", "", "", t("closing_balance"), money(running)] }),
    h("div.btn-row", {},
      h("button.btn.secondary", {
        type: "button",
        onclick: () => print(ledgerDoc(apartment, entries)),
      }, "🖨 " + t("print")))
  );
}
