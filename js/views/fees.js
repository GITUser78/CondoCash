// ---------------------------------------------------------------------------
// Fees — admin configures the cost categories (per dweller, flat, per m²) and
// generates the monthly charges from them. Cashiers see the configuration
// read-only so they can answer questions at the door.
// ---------------------------------------------------------------------------
import * as api from "../api.js";
import { t } from "../i18n.js";
import { state, isAdmin } from "../state.js";
import {
  h, table, money, fmtDate, fmtMonth, monthISO, monthStart, monthEnd,
  field, input, select, checkbox, openModal, confirmDelete, toast, msg, clear,
} from "../ui.js";
import { monthlyFee, feeAmount, round2 } from "../calc.js";
import { chargesReport, print } from "../print.js";

const CALC_TYPES = () => [
  { value: "per_dweller", label: t("calc_per_dweller") },
  { value: "flat", label: t("calc_flat") },
  { value: "per_m2", label: t("calc_per_m2") },
];
const calcLabel = (v) => CALC_TYPES().find((c) => c.value === v)?.label || v;

let genMonth = monthISO();

export async function render(root, ctx) {
  const condoId = state.condoId;
  const [fees, apartments, charges] = await Promise.all([
    api.listFees(condoId),
    api.listApartments(condoId),
    api.listCharges(condoId, { from: monthStart(genMonth), to: monthStart(genMonth) }),
  ]);

  // What one round of "generate" would cost the whole building.
  const expectedMonthly = round2(apartments.reduce((s, a) => s + monthlyFee(a, fees), 0));

  root.append(
    h("div.card", {},
      h("div.section-title", {},
        h("h2", {}, t("nav_fees")),
        isAdmin()
          ? h("button.btn", { onclick: () => openFeeModal({ ctx }) }, "＋ " + t("add_fee"))
          : null),
      table(
        [{ label: t("fee_name") }, { label: t("fee_calc") }, { label: t("fee_rate"), num: true },
         { label: t("fee_active") }, { label: t("total"), num: true }, { label: t("actions") }],
        fees,
        (f) => [
          f.name,
          calcLabel(f.calc_type),
          money(f.rate),
          f.active ? h("span.pill", {}, "✓") : h("span.muted", {}, "—"),
          money(round2(apartments.reduce((s, a) => s + (f.active ? feeAmount(f, a) : 0), 0))),
          isAdmin()
            ? h("div", { style: { display: "flex", gap: ".2rem" } },
                h("button.icon-btn", { title: t("edit"), onclick: () => openFeeModal({ ctx, fee: f }) }, "✎"),
                h("button.icon-btn.danger", {
                  title: t("delete"),
                  onclick: async () => {
                    if (!confirmDelete()) return;
                    await api.deleteFee(f.id);
                    toast(t("saved"));
                    ctx.refresh();
                  },
                }, "🗑"))
            : h("span.muted", {}, "—"),
        ],
        { foot: ["", "", "", t("total"), money(expectedMonthly), ""] })),

    isAdmin() ? generatePanel({ ctx, condoId, apartments, fees }) : null,

    h("div.card", {},
      h("div.section-title", {},
        h("h3", {}, `${t("charges")} — ${fmtMonth(monthStart(genMonth))}`),
        h("button.btn.secondary.small", {
          onclick: () => print(chargesReport(charges, monthStart(genMonth))),
        }, "🖨 " + t("print"))),
      table(
        [{ label: t("apt_number") }, { label: t("owner") }, { label: t("fee_name") },
         { label: t("charge_due") }, { label: t("amount"), num: true },
         ...(isAdmin() ? [{ label: t("actions") }] : [])],
        [...charges].sort((a, b) =>
          String(a.apartments?.number).localeCompare(String(b.apartments?.number), undefined, { numeric: true })),
        (c) => [
          c.apartments?.number ?? "—",
          c.apartments?.owner_name ?? "—",
          c.fee_categories?.name || c.description || "—",
          fmtDate(c.due_date),
          money(c.amount),
          ...(isAdmin() ? [h("button.icon-btn.danger", {
            title: t("delete"),
            onclick: async () => {
              if (!confirmDelete()) return;
              await api.deleteCharge(c.id);
              toast(t("saved"));
              ctx.refresh();
            },
          }, "🗑")] : []),
        ],
        { foot: ["", "", "", t("total"),
                 money(charges.reduce((s, c) => s + Number(c.amount), 0)),
                 ...(isAdmin() ? [""] : [])] }))
  );
}

// ---------------------------------------------------------------------------
function generatePanel({ ctx, condoId, apartments, fees }) {
  const month = input({
    type: "month", value: genMonth,
    onchange: (e) => { genMonth = e.target.value || monthISO(); ctx.refresh(); },
  });
  const due = input({ type: "date" });
  const out = h("div");

  const preview = async () => {
    clear(out).append(h("div.muted", {}, t("loading")));
    const rows = await api.previewCharges(condoId, monthStart(genMonth));
    const total = rows.reduce((s, r) => s + Number(r.amount), 0);
    clear(out).append(
      h("p.muted", {}, t("preview_total", { total: money(total) })),
      table(
        [{ label: t("apt_number") }, { label: t("fee_name") }, { label: t("amount"), num: true }],
        rows,
        (r) => [r.apartment_number, r.fee_name, money(r.amount)]));
  };

  const run = async (btn) => {
    btn.disabled = true;
    try {
      const count = await api.generateCharges(condoId, monthStart(genMonth), due.value || null);
      clear(out).append(msg(count ? t("gen_done", { count }) : t("gen_none"), count ? "ok" : "error"));
      if (count) { toast(t("gen_done", { count })); ctx.refresh(); }
    } catch (err) {
      clear(out).append(msg(err.message || String(err), "error"));
    } finally {
      btn.disabled = false;
    }
  };

  return h("div.card", {},
    h("h3", {}, t("generate_charges")),
    h("p.muted", {}, t("gen_hint")),
    h("div.form-grid", {},
      field(t("gen_period"), month),
      field(t("gen_due"), due)),
    h("div.btn-row", {},
      h("button.btn", { onclick: (e) => run(e.currentTarget) }, t("gen_run")),
      h("button.btn.secondary", { onclick: preview }, t("gen_preview"))),
    fees.some((f) => f.active) && apartments.length
      ? null
      : msg(t("gen_hint"), "error"),
    out);
}

// ---------------------------------------------------------------------------
function openFeeModal({ ctx, fee = null }) {
  const name = input({ required: true, value: fee?.name || "" });
  const calc = select(CALC_TYPES(), { value: fee?.calc_type || "per_dweller" });
  const rate = input({ type: "number", step: "0.0001", min: "0", required: true, value: fee?.rate ?? "" });
  const active = checkbox(t("fee_active"), fee ? fee.active : true);

  const body = h("div", {},
    h("div.form-grid", {},
      field(t("fee_name"), name),
      field(t("fee_calc"), calc),
      field(t("fee_rate"), rate)),
    active.el);

  return openModal({
    title: fee ? t("edit_fee") : t("add_fee"),
    body,
    onSave: async ({ fail }) => {
      if (!name.value.trim() || rate.value === "") { fail(t("required")); return false; }
      await api.saveFee({
        id: fee?.id,
        condo_id: state.condoId,
        name: name.value.trim(),
        calc_type: calc.value,
        rate: Number(rate.value),
        active: active.box.checked,
      });
      toast(t("saved"));
      ctx.refresh();
    },
  });
}
