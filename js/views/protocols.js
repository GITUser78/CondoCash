// ---------------------------------------------------------------------------
// Protocols — the print centre. Pick a document and a period, and the app
// renders a clean, signable page (print or "save as PDF" from the browser).
// ---------------------------------------------------------------------------
import * as api from "../api.js";
import { t } from "../i18n.js";
import { state } from "../state.js";
import {
  h, field, input, select, todayISO, monthISO, monthStart, monthEnd, clear, msg,
} from "../ui.js";
import { monthlyFee } from "../calc.js";
import {
  monthlyProtocol, debtorList, apartmentRegister, chargesReport, ledgerDoc,
  reminderNotices, print,
} from "../print.js";

const DOCS = () => [
  { id: "monthly",    label: t("prot_monthly"),    desc: t("prot_monthly_desc"),    period: "range" },
  { id: "debtors",    label: t("prot_debtors"),    desc: t("prot_debtors_desc"),    period: "none" },
  { id: "reminders",  label: t("rem_print_notice"), desc: t("rem_letter_ask"),      period: "none" },
  { id: "charges",    label: t("prot_charges"),    desc: t("prot_charges_desc"),    period: "month" },
  { id: "apartments", label: t("prot_apartments"), desc: t("prot_apartments_desc"), period: "none" },
  { id: "ledger",     label: t("prot_ledger"),     desc: t("prot_ledger_desc"),     period: "apartment" },
];

const sel = { doc: "monthly", from: monthStart(monthISO()), to: todayISO(), month: monthISO(), apartmentId: "" };

export async function render(root) {
  const apartments = await api.listApartments(state.condoId);
  if (!sel.apartmentId) sel.apartmentId = apartments[0]?.id || "";

  const optionsBox = h("div");
  const status = h("div");

  const docSelect = select(DOCS().map((d) => ({ value: d.id, label: d.label })), {
    value: sel.doc,
    onchange: (e) => { sel.doc = e.target.value; drawOptions(); },
  });

  function drawOptions() {
    const doc = DOCS().find((d) => d.id === sel.doc);
    clear(status);
    const parts = [h("p.muted", {}, doc.desc)];
    if (doc.period === "range") {
      parts.push(h("div.form-grid", {},
        field(t("from_date"), input({
          type: "date", value: sel.from, onchange: (e) => { sel.from = e.target.value; },
        })),
        field(t("to_date"), input({
          type: "date", value: sel.to, onchange: (e) => { sel.to = e.target.value; },
        }))));
      parts.push(h("div.btn-row", {},
        quick(t("this_month"), () => monthRange(monthISO())),
        quick(t("last_month"), () => {
          const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1);
          return monthRange(monthISO(d));
        }),
        quick(t("this_year"), () => {
          const y = new Date().getFullYear();
          return { from: `${y}-01-01`, to: `${y}-12-31` };
        })));
    } else if (doc.period === "month") {
      parts.push(h("div.form-grid", {},
        field(t("gen_period"), input({
          type: "month", value: sel.month, onchange: (e) => { sel.month = e.target.value; },
        }))));
    } else if (doc.period === "apartment") {
      parts.push(h("div.form-grid", {},
        field(t("pay_apartment"), select(
          apartments.map((a) => ({ value: a.id, label: `${a.number} — ${a.owner_name || ""}`.trim() })),
          { value: sel.apartmentId, onchange: (e) => { sel.apartmentId = e.target.value; } }))));
    }
    clear(optionsBox).append(...parts);
  }

  function quick(label, range) {
    return h("button.btn.secondary.small", {
      type: "button",
      onclick: () => { Object.assign(sel, range()); drawOptions(); },
    }, label);
  }

  drawOptions();

  root.append(
    h("div.card", {},
      h("h2", {}, t("prot_title")),
      h("p.muted", {}, t("prot_hint")),
      h("div.form-grid", {}, field(t("prot_kind"), docSelect)),
      optionsBox,
      h("div.btn-row", {},
        h("button.btn", {
          onclick: async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            clear(status);
            try {
              await open(apartments, status);
            } catch (err) {
              status.append(msg(err.message || String(err), "error"));
            } finally {
              btn.disabled = false;
            }
          },
        }, "🖨 " + t("prot_generate"))),
      status)
  );
}

function monthRange(ym) {
  return { from: monthStart(ym), to: monthEnd(ym) };
}

async function open(apartments, status) {
  const condoId = state.condoId;
  switch (sel.doc) {
    case "monthly": {
      const [payments, expenses, opening] = await Promise.all([
        api.listPayments(condoId, { from: sel.from, to: sel.to }),
        api.listExpenses(condoId, { from: sel.from, to: sel.to }),
        api.openingCashBalance(condoId, sel.from),
      ]);
      return print(monthlyProtocol({ from: sel.from, to: sel.to, payments, expenses, opening }));
    }
    case "debtors": {
      const balances = await api.listBalances(condoId);
      return print(debtorList(balances));
    }
    case "reminders": {
      const balances = await api.listBalances(condoId);
      const today = todayISO();
      const debtors = balances
        .filter((b) => Number(b.balance) > 0.004)
        .map((b) => ({ ...b, oldest_due_date: b.oldest_due_date }))
        .sort((a, b) => String(a.number).localeCompare(String(b.number), undefined, { numeric: true }));
      if (!debtors.length) return status.append(msg(t("rem_none"), "ok"));
      return print(reminderNotices(debtors, today));
    }
    case "charges": {
      const period = monthStart(sel.month);
      const charges = await api.listCharges(condoId, { from: period, to: period });
      if (!charges.length) return status.append(msg(t("prot_no_data"), "error"));
      return print(chargesReport(charges, period));
    }
    case "apartments": {
      const fees = await api.listFees(condoId);
      return print(apartmentRegister(apartments, (a) => monthlyFee(a, fees)));
    }
    case "ledger": {
      const apartment = apartments.find((a) => a.id === sel.apartmentId);
      if (!apartment) return status.append(msg(t("required"), "error"));
      const [charges, payments] = await Promise.all([
        api.listCharges(condoId, { apartmentId: apartment.id }),
        api.listPayments(condoId, { apartmentId: apartment.id }),
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
      return print(ledgerDoc(apartment, entries));
    }
  }
}
