// ---------------------------------------------------------------------------
// Payments — record money received from an apartment, review and print receipts.
// Available to cashiers and admins.
// ---------------------------------------------------------------------------
import * as api from "../api.js";
import { t } from "../i18n.js";
import { state } from "../state.js";
import {
  h, table, money, fmtDate, todayISO, monthISO, monthStart, monthEnd,
  field, input, select, openModal, confirmDelete, toast, msg,
} from "../ui.js";
import { receiptDoc, print } from "../print.js";
import { sum } from "../calc.js";

const filters = { month: monthISO(), apartmentId: "" };

export async function render(root, ctx) {
  const condoId = state.condoId;
  const [apartments, payments, balances] = await Promise.all([
    api.listApartments(condoId),
    api.listPayments(condoId, {
      from: monthStart(filters.month),
      to: monthEnd(filters.month),
      apartmentId: filters.apartmentId || undefined,
    }),
    api.listBalances(condoId),
  ]);

  const total = sum(payments, "amount");

  root.append(
    h("div.card", {},
      h("div.section-title", {},
        h("h2", {}, t("nav_payments")),
        h("button.btn", { onclick: () => openPaymentModal({ apartments, balances, ctx }) },
          "＋ " + t("add_payment"))),
      h("div.form-grid.filters", {},
        field(t("period"), input({
          type: "month", value: filters.month,
          onchange: (e) => { filters.month = e.target.value || monthISO(); ctx.refresh(); },
        })),
        field(t("pay_apartment"), select(
          [{ value: "", label: t("all") },
           ...apartments.map((a) => ({ value: a.id, label: `${a.number} — ${a.owner_name || ""}`.trim() }))],
          {
            value: filters.apartmentId,
            onchange: (e) => { filters.apartmentId = e.target.value; ctx.refresh(); },
          })))),

    h("div.card", {},
      h("div.section-title", {}, h("h3", {}, t("recent_payments")), h("strong", {}, `${t("total")}: ${money(total)}`)),
      table(
        [{ label: t("pay_date") }, { label: t("pay_apartment") }, { label: t("owner") },
         { label: t("pay_method") }, { label: t("pay_note") },
         { label: t("pay_amount"), num: true }, { label: t("actions") }],
        payments,
        (p) => [
          fmtDate(p.paid_on),
          p.apartments?.number ?? "—",
          p.apartments?.owner_name ?? "—",
          p.method || "—",
          p.note || "",
          money(p.amount),
          h("div", { style: { display: "flex", gap: ".2rem" } },
            h("button.icon-btn", {
              title: t("print_receipt"),
              onclick: () => printReceipt(p, balances),
            }, "🖨"),
            canEdit(p) ? h("button.icon-btn", {
              title: t("edit"),
              onclick: () => openPaymentModal({ apartments, balances, ctx, payment: p }),
            }, "✎") : null,
            canEdit(p) ? h("button.icon-btn.danger", {
              title: t("delete"),
              onclick: async () => {
                if (!confirmDelete()) return;
                await api.deletePayment(p.id);
                toast(t("saved"));
                ctx.refresh();
              },
            }, "🗑") : null),
        ]))
  );
}

function canEdit(payment) {
  return state.profile?.role === "admin" || payment.recorded_by === state.session?.user?.id;
}

function printReceipt(payment, balances) {
  const b = balances.find((x) => x.apartment_id === payment.apartment_id);
  print(receiptDoc(payment, b ? Number(b.balance) : null));
}

/**
 * Shared payment dialog — also used from the dashboard's reminder list.
 * `preselect` is an apartment id.
 */
export function openPaymentModal({ apartments, balances = [], ctx, payment = null, preselect = null }) {
  const aptSelect = select(
    apartments.map((a) => {
      const b = balances.find((x) => x.apartment_id === a.id);
      const owed = b && Number(b.balance) > 0 ? ` (${money(b.balance)})` : "";
      return { value: a.id, label: `${a.number} — ${a.owner_name || ""}${owed}`.trim() };
    }),
    { required: true, value: payment?.apartment_id || preselect || apartments[0]?.id }
  );
  const amount = input({ type: "number", step: "0.01", min: "0.01", required: true, value: payment?.amount ?? "" });
  const date = input({ type: "date", required: true, value: payment?.paid_on || todayISO() });
  const method = input({ value: payment?.method || "", list: "pay-methods" });
  const note = input({ value: payment?.note || "" });

  // Prefill the amount with what the apartment currently owes.
  const syncAmount = () => {
    if (payment || amount.value) return;
    const b = balances.find((x) => x.apartment_id === aptSelect.value);
    if (b && Number(b.balance) > 0) amount.value = Number(b.balance).toFixed(2);
  };
  aptSelect.addEventListener("change", () => { amount.value = ""; syncAmount(); });
  syncAmount();

  const body = h("div", {},
    h("div.form-grid", {},
      field(t("pay_apartment"), aptSelect),
      field(t("pay_amount"), amount),
      field(t("pay_date"), date),
      field(t("pay_method"), method)),
    field(t("pay_note"), note),
    h("datalist", { id: "pay-methods" },
      ["Cash", "Bank transfer", "Card"].map((m) => h("option", { value: m }))));

  return openModal({
    title: payment ? t("edit") : t("add_payment"),
    body,
    onSave: async ({ fail }) => {
      if (!aptSelect.value || !Number(amount.value)) { fail(t("required")); return false; }
      const saved = await api.savePayment({
        id: payment?.id,
        condo_id: state.condoId,
        apartment_id: aptSelect.value,
        amount: Number(amount.value),
        paid_on: date.value,
        method: method.value,
        note: note.value,
        recorded_by: payment ? payment.recorded_by : state.session.user.id,
      });
      toast(t("pay_recorded"));
      ctx.refresh();
      if (!payment) offerReceipt(saved, balances);
    },
  });
}

/** After booking a payment, offer the receipt straight away. */
function offerReceipt(saved, balances) {
  const b = balances.find((x) => x.apartment_id === saved.apartment_id);
  const after = b ? Number(b.balance) - Number(saved.amount) : null;
  openModal({
    title: t("pay_recorded"),
    body: h("div", {},
      msg(`${saved.apartments?.number ?? ""} — ${money(saved.amount)}`, "ok"),
      h("p.muted", {}, t("prot_receipt"))),
    saveLabel: t("print_receipt"),
    onSave: () => { print(receiptDoc(saved, after)); },
  });
}
