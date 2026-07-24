// ---------------------------------------------------------------------------
// Printable documents ("protocols"). Every builder returns a detached DOM tree
// that printDocument() drops into #print-root; the print stylesheet then hides
// the app chrome. Nothing here talks to the database — callers pass the data.
// ---------------------------------------------------------------------------
import { h, money, fmtDate, fmtMonth, table, printDocument, todayISO } from "./ui.js";
import { t } from "./i18n.js";
import { condo, state } from "./state.js";

/** Common header/footer wrapper for one printed page. */
export function page({ title, subtitle, body, signatures = true, breakAfter = false }) {
  const c = condo();
  return h("section.print-page", { class: breakAfter ? "break-after" : null },
    h("header.print-head", {},
      h("div.print-condo", {},
        h("div.print-condo-name", {}, c?.name || t("app_name")),
        c?.address ? h("div.print-condo-addr", {}, c.address) : null),
      h("div.print-meta", {}, t("prot_generated_on", { date: fmtDate(todayISO()) }))),
    h("h1.print-title", {}, title),
    subtitle ? h("div.print-subtitle", {}, subtitle) : null,
    h("div.print-body", {}, body),
    signatures ? signatureBlock() : null);
}

function signatureBlock() {
  return h("div.print-signatures", {},
    sigLine(t("prot_sig_cashier"), state.profile?.full_name || ""),
    sigLine(t("prot_sig_chair"), ""),
    sigLine(t("prot_sig_date"), fmtDate(todayISO())));
}

function sigLine(label, value) {
  return h("div.sig", {},
    h("div.sig-line", {}, value),
    h("div.sig-label", {}, label));
}

function totalsRow(label, value, cls) {
  return h("div.print-total", { class: cls || null },
    h("span", {}, label), h("strong", {}, value));
}

// ---------------------------------------------------------------------------
// 1. Monthly cash protocol — income, expenses, cash balance for a period.
// ---------------------------------------------------------------------------
export function monthlyProtocol({ from, to, payments, expenses, opening }) {
  const inSum = payments.reduce((s, p) => s + Number(p.amount), 0);
  const outSum = expenses.reduce((s, e) => s + Number(e.amount), 0);

  const income = payments.length
    ? table(
        [{ label: t("date") }, { label: t("pay_apartment") }, { label: t("owner") },
         { label: t("pay_method") }, { label: t("pay_note") }, { label: t("amount"), num: true }],
        [...payments].sort((a, b) => a.paid_on.localeCompare(b.paid_on)),
        (p) => [fmtDate(p.paid_on), p.apartments?.number ?? "—", p.apartments?.owner_name ?? "—",
                p.method || "—", p.note || "", money(p.amount)],
        { foot: ["", "", "", "", t("total"), money(inSum)] })
    : h("div.print-empty", {}, t("prot_no_data"));

  const spend = expenses.length
    ? table(
        [{ label: t("date") }, { label: t("exp_category") }, { label: t("exp_desc") },
         { label: t("exp_vendor") }, { label: t("exp_receipt") }, { label: t("amount"), num: true }],
        [...expenses].sort((a, b) => a.spent_on.localeCompare(b.spent_on)),
        (e) => [fmtDate(e.spent_on), e.category || "—", e.description, e.vendor || "—",
                e.receipt_no || "—", money(e.amount)],
        { foot: ["", "", "", "", t("total"), money(outSum)] })
    : h("div.print-empty", {}, t("prot_no_data"));

  const body = h("div", {},
    h("h2.print-h2", {}, t("prot_income")), income,
    h("h2.print-h2", {}, t("prot_expenses")), spend,
    h("h2.print-h2", {}, t("prot_summary")),
    h("div.print-summary", {},
      totalsRow(t("opening_balance"), money(opening)),
      totalsRow(t("cash_in"), money(inSum)),
      totalsRow(t("cash_out"), money(outSum)),
      totalsRow(t("closing_balance"), money(opening + inSum - outSum), "strong")));

  return page({
    title: t("prot_monthly"),
    subtitle: `${t("period")}: ${fmtDate(from)} – ${fmtDate(to)}`,
    body,
  });
}

// ---------------------------------------------------------------------------
// 2. Debtor list
// ---------------------------------------------------------------------------
export function debtorList(rows) {
  const debtors = rows.filter((r) => Number(r.balance) > 0.004);
  const total = debtors.reduce((s, r) => s + Number(r.balance), 0);
  const body = debtors.length
    ? table(
        [{ label: t("apt_number") }, { label: t("owner") }, { label: t("apt_dwellers"), num: true },
         { label: t("charged"), num: true }, { label: t("paid"), num: true },
         { label: t("due_since") }, { label: t("balance"), num: true }],
        debtors,
        (r) => [r.number, r.owner_name || "—", r.num_dwellers ?? "—",
                money(r.total_charged), money(r.total_paid), fmtDate(r.oldest_due_date),
                money(r.balance)],
        { foot: ["", "", "", "", "", t("total"), money(total)] })
    : h("div.print-empty", {}, t("dash_up_to_date"));
  return page({ title: t("prot_debtors"), body });
}

// ---------------------------------------------------------------------------
// 3. Apartment & dweller register (incl. the monthly fee each apartment pays)
// ---------------------------------------------------------------------------
export function apartmentRegister(apartments, monthlyFor) {
  const totalDwellers = apartments.reduce((s, a) => s + (a.num_dwellers || 0), 0);
  const totalMonthly = apartments.reduce((s, a) => s + monthlyFor(a), 0);
  const body = table(
    [{ label: t("apt_number") }, { label: t("apt_floor"), num: true }, { label: t("apt_area"), num: true },
     { label: t("apt_dwellers"), num: true }, { label: t("owner_name") }, { label: t("owner_phone") },
     { label: t("owner_email") }, { label: t("total"), num: true }],
    apartments,
    (a) => [a.number, a.floor ?? "—", a.area_m2 ?? "—", a.num_dwellers, a.owner_name || "—",
            a.owner_phone || "—", a.owner_email || "—", money(monthlyFor(a))],
    { foot: ["", "", "", String(totalDwellers), "", "", t("total"), money(totalMonthly)] });
  return page({ title: t("prot_apartments"), body });
}

// ---------------------------------------------------------------------------
// 4. Charges for a month
// ---------------------------------------------------------------------------
export function chargesReport(charges, period) {
  const total = charges.reduce((s, c) => s + Number(c.amount), 0);
  const body = charges.length
    ? table(
        [{ label: t("apt_number") }, { label: t("owner") }, { label: t("fee_name") },
         { label: t("charge_due") }, { label: t("amount"), num: true }],
        [...charges].sort((a, b) =>
          String(a.apartments?.number).localeCompare(String(b.apartments?.number), undefined, { numeric: true })),
        (c) => [c.apartments?.number ?? "—", c.apartments?.owner_name ?? "—",
                c.fee_categories?.name || c.description || "—", fmtDate(c.due_date), money(c.amount)],
        { foot: ["", "", "", t("total"), money(total)] })
    : h("div.print-empty", {}, t("prot_no_data"));
  return page({ title: t("prot_charges"), subtitle: fmtMonth(period), body });
}

// ---------------------------------------------------------------------------
// 5. Account statement for one apartment (charges + payments, running balance)
// ---------------------------------------------------------------------------
export function ledgerDoc(apartment, entries) {
  let running = 0;
  const rows = entries.map((e) => {
    running += Number(e.debit || 0) - Number(e.credit || 0);
    return { ...e, running };
  });
  const body = rows.length
    ? table(
        [{ label: t("date") }, { label: t("description") }, { label: t("debit"), num: true },
         { label: t("credit"), num: true }, { label: t("running_balance"), num: true }],
        rows,
        (r) => [fmtDate(r.date), r.description,
                r.debit ? money(r.debit) : "", r.credit ? money(r.credit) : "", money(r.running)],
        { foot: ["", "", "", t("closing_balance"), money(running)] })
    : h("div.print-empty", {}, t("prot_no_data"));
  return page({
    title: t("ledger"),
    subtitle: `${t("ledger_for", { apt: apartment.number })} — ${apartment.owner_name || ""}`,
    body,
  });
}

// ---------------------------------------------------------------------------
// 6. Receipt for a single payment
// ---------------------------------------------------------------------------
export function receiptDoc(payment, balanceAfter) {
  const apt = payment.apartments || {};
  const body = h("div.receipt", {},
    h("dl.kv", {},
      h("dt", {}, t("receipt_no")), h("dd", {}, String(payment.id).slice(0, 8).toUpperCase()),
      h("dt", {}, t("date")), h("dd", {}, fmtDate(payment.paid_on)),
      h("dt", {}, t("receipt_received_from")), h("dd", {}, apt.owner_name || "—"),
      h("dt", {}, t("receipt_for_apartment")), h("dd", {}, apt.number || "—"),
      h("dt", {}, t("pay_method")), h("dd", {}, payment.method || "—"),
      payment.note ? h("dt", {}, t("pay_note")) : null,
      payment.note ? h("dd", {}, payment.note) : null),
    h("div.print-summary", {},
      totalsRow(t("receipt_amount"), money(payment.amount), "strong"),
      balanceAfter !== null && balanceAfter !== undefined
        ? totalsRow(t("receipt_remaining"), money(balanceAfter))
        : null));
  return page({ title: t("receipt_title"), body });
}

// ---------------------------------------------------------------------------
// 7. Reminder notices — one page per debtor.
// ---------------------------------------------------------------------------
export function reminderNotices(debtors) {
  const today = todayISO();
  const pages = debtors.map((d, i) => {
    const body = h("div.letter", {},
      h("p", {}, `${d.owner_name || ""}`),
      h("p", {}, t("rem_letter_intro", { apt: d.number, date: fmtDate(today) })),
      h("div.print-summary", {},
        totalsRow(t("charged"), money(d.total_charged)),
        totalsRow(t("paid"), money(d.total_paid)),
        totalsRow(t("balance"), money(d.balance), "strong")),
      d.oldest_due_date
        ? h("p", {}, t("rem_letter_due_since", { date: fmtDate(d.oldest_due_date) }))
        : null,
      h("p", {}, t("rem_letter_ask")),
      h("p", {}, t("rem_letter_thanks")));
    return page({
      title: t("rem_letter_title"),
      subtitle: `${t("apt_number")} ${d.number}`,
      body,
      breakAfter: i < debtors.length - 1,
    });
  });
  return h("div", {}, pages);
}

// Convenience: build + print in one call.
export function print(node) {
  printDocument(node);
}
