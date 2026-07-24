// ---------------------------------------------------------------------------
// Dashboard — the cashier's home screen: what the cash box holds, who owes
// money, and which of those debts are already overdue (the reminder list).
// ---------------------------------------------------------------------------
import * as api from "../api.js";
import { t } from "../i18n.js";
import { state } from "../state.js";
import {
  h, table, money, fmtDate, todayISO, daysBetween, toast,
} from "../ui.js";
import { debtorList, reminderNotices, print } from "../print.js";
import { openPaymentModal } from "./payments.js";

export async function render(root, ctx) {
  const condoId = state.condoId;
  const [balances, cash, apartments] = await Promise.all([
    api.listBalances(condoId),
    api.cashSummary(condoId),
    api.listApartments(condoId),
  ]);

  const today = todayISO();
  const debtors = balances
    .filter((b) => Number(b.balance) > 0.004)
    .map((b) => ({
      ...b,
      overdueDays: b.oldest_due_date ? daysBetween(b.oldest_due_date, today) : null,
    }))
    .sort((a, b) => (b.overdueDays ?? -1) - (a.overdueDays ?? -1) || Number(b.balance) - Number(a.balance));

  const overdue = debtors.filter((d) => (d.overdueDays ?? -1) > 0);
  const totalOwed = debtors.reduce((s, d) => s + Number(d.balance), 0);
  const overdueSum = overdue.reduce((s, d) => s + Number(d.balance), 0);

  root.append(
    h("div.stats", {},
      stat(t("dash_total_owed"), money(totalOwed), totalOwed > 0 ? "warn" : "ok"),
      stat(t("dash_apartments_owing"), `${debtors.length} / ${apartments.length}`),
      stat(t("dash_overdue"), money(overdueSum), overdue.length ? "danger" : "ok"),
      stat(t("cash_balance"), money(cash?.cash_balance ?? 0),
        Number(cash?.cash_balance ?? 0) < 0 ? "danger" : "ok"),
      stat(t("dash_collected"), money(cash?.total_collected ?? 0))),

    h("div.card", {},
      h("div.section-title", {},
        h("h2", {}, t("dash_title")),
        h("div.btn-row", { style: { marginTop: 0 } },
          h("button.btn.secondary.small", {
            onclick: () => print(debtorList(balances)),
          }, "🖨 " + t("prot_debtors")),
          h("button.btn.secondary.small", {
            disabled: !debtors.length,
            onclick: () => {
              if (!debtors.length) return toast(t("dash_up_to_date"));
              print(reminderNotices(debtors));
            },
          }, "🖨 " + t("rem_print_notices")))),

      debtors.length
        ? table(
            [{ label: t("apt_number") }, { label: t("owner") }, { label: t("charged"), num: true },
             { label: t("paid"), num: true }, { label: t("balance"), num: true },
             { label: t("due_since") }, { label: t("actions") }],
            debtors,
            (d) => [
              d.number,
              d.owner_name || "—",
              money(d.total_charged),
              money(d.total_paid),
              { v: money(d.balance), class: "owe", num: true },
              dueCell(d),
              h("button.btn.small", {
                onclick: () => openPaymentModal({
                  apartments, balances, ctx, preselect: d.apartment_id,
                }),
              }, t("record_payment_short")),
            ],
            { rowClass: (d) => ((d.overdueDays ?? -1) > 0 ? "row-overdue" : "") })
        : h("div.empty", {}, t("dash_up_to_date")))
  );
}

function dueCell(d) {
  if (!d.oldest_due_date) return h("span.muted", {}, "—");
  const label = fmtDate(d.oldest_due_date);
  if (d.overdueDays > 0) {
    return h("span", {}, label,
      h("span.overdue-badge", {}, t("rem_days_overdue", { days: d.overdueDays })));
  }
  if (d.overdueDays === 0) return h("span", {}, label, h("span.pill", {}, t("rem_due_today")));
  return h("span.muted", {}, label);
}

function stat(label, value, kind) {
  return h("div.stat", { class: kind || null },
    h("div.label", {}, label), h("div.value", {}, value));
}
