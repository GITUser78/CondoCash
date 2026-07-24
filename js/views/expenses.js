// ---------------------------------------------------------------------------
// Expenses — what the cashier pays out of the cash box (cleaning, repairs,
// electricity for the common parts…), with the running cash position.
// ---------------------------------------------------------------------------
import * as api from "../api.js";
import { t } from "../i18n.js";
import { state } from "../state.js";
import {
  h, table, money, fmtDate, todayISO, monthISO, monthStart, monthEnd,
  field, input, openModal, confirmDelete, toast,
} from "../ui.js";
import { sum } from "../calc.js";
import { monthlyProtocol, print } from "../print.js";

const filters = { month: monthISO() };

export async function render(root, ctx) {
  const condoId = state.condoId;
  const from = monthStart(filters.month);
  const to = monthEnd(filters.month);

  const [expenses, cash, payments] = await Promise.all([
    api.listExpenses(condoId, { from, to }),
    api.cashSummary(condoId),
    api.listPayments(condoId, { from, to }),
  ]);

  const spent = sum(expenses, "amount");
  const received = sum(payments, "amount");

  root.append(
    h("div.stats", {},
      stat(t("cash_in") + " · " + t("period"), money(received), "ok"),
      stat(t("cash_out") + " · " + t("period"), money(spent), "warn"),
      stat(t("cash_balance"), money(cash?.cash_balance ?? 0))),

    h("div.card", {},
      h("div.section-title", {},
        h("h2", {}, t("exp_title")),
        h("div.btn-row", { style: { marginTop: 0 } },
          h("button.btn.secondary.small", {
            onclick: async () => {
              const opening = await api.openingCashBalance(condoId, from);
              print(monthlyProtocol({ from, to, payments, expenses, opening }));
            },
          }, "🖨 " + t("prot_monthly")),
          h("button.btn", { onclick: () => openExpenseModal({ ctx }) }, "＋ " + t("add_expense")))),

      h("div.form-grid.filters", {},
        field(t("period"), input({
          type: "month", value: filters.month,
          onchange: (e) => { filters.month = e.target.value || monthISO(); ctx.refresh(); },
        }))),

      table(
        [{ label: t("exp_date") }, { label: t("exp_category") }, { label: t("exp_desc") },
         { label: t("exp_vendor") }, { label: t("exp_receipt") },
         { label: t("amount"), num: true }, { label: t("actions") }],
        expenses,
        (e) => [
          fmtDate(e.spent_on),
          e.category || "—",
          e.description,
          e.vendor || "—",
          e.receipt_no || "—",
          money(e.amount),
          canEdit(e)
            ? h("div", { style: { display: "flex", gap: ".2rem" } },
                h("button.icon-btn", {
                  title: t("edit"), onclick: () => openExpenseModal({ ctx, expense: e }),
                }, "✎"),
                h("button.icon-btn.danger", {
                  title: t("delete"),
                  onclick: async () => {
                    if (!confirmDelete()) return;
                    await api.deleteExpense(e.id);
                    toast(t("saved"));
                    ctx.refresh();
                  },
                }, "🗑"))
            : h("span.muted", {}, "—"),
        ],
        { foot: ["", "", "", "", t("total"), money(spent), ""] }))
  );
}

function canEdit(expense) {
  return state.profile?.role === "admin" || expense.recorded_by === state.session?.user?.id;
}

function stat(label, value, kind) {
  return h("div.stat", { class: kind || null },
    h("div.label", {}, label), h("div.value", {}, value));
}

function openExpenseModal({ ctx, expense = null }) {
  const date = input({ type: "date", required: true, value: expense?.spent_on || todayISO() });
  const category = input({ value: expense?.category || "", list: "exp-categories" });
  const description = input({ required: true, value: expense?.description || "" });
  const vendor = input({ value: expense?.vendor || "" });
  const receipt = input({ value: expense?.receipt_no || "" });
  const amount = input({ type: "number", step: "0.01", min: "0.01", required: true, value: expense?.amount ?? "" });

  const body = h("div", {},
    h("div.form-grid", {},
      field(t("exp_date"), date),
      field(t("exp_category"), category),
      field(t("exp_amount"), amount),
      field(t("exp_vendor"), vendor),
      field(t("exp_receipt"), receipt)),
    field(t("exp_desc"), description),
    h("datalist", { id: "exp-categories" },
      ["Cleaning", "Repairs", "Electricity", "Lift", "Water", "Materials", "Other"]
        .map((c) => h("option", { value: c }))));

  return openModal({
    title: expense ? t("edit_expense") : t("add_expense"),
    body,
    onSave: async ({ fail }) => {
      if (!description.value.trim() || !Number(amount.value)) { fail(t("required")); return false; }
      await api.saveExpense({
        id: expense?.id,
        condo_id: state.condoId,
        spent_on: date.value,
        category: category.value.trim(),
        description: description.value.trim(),
        vendor: vendor.value.trim(),
        receipt_no: receipt.value.trim(),
        amount: Number(amount.value),
        recorded_by: expense ? expense.recorded_by : state.session.user.id,
      });
      toast(t("exp_recorded"));
      ctx.refresh();
    },
  });
}
