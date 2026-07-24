// ---------------------------------------------------------------------------
// Unit tests for the pure logic: fee maths, date helpers, i18n and the document
// builders. Runs in a real browser (see run_unit.py) because that is the only
// JS runtime this project needs — there is no build step and no Node.
// ---------------------------------------------------------------------------
import { feeAmount, feeUnits, monthlyFee, round2, sum } from "../../js/calc.js";
import {
  isoDate, todayISO, monthISO, monthStart, monthEnd, daysBetween, money,
} from "../../js/ui.js";
import { t, setLang, getLang, translations, LANGUAGES } from "../../js/i18n.js";
import { monthlyProtocol, reminderNotices, ledgerDoc } from "../../js/print.js";
import { state } from "../../js/state.js";

const results = [];

function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, error: err && err.message ? err.message : String(err) });
  }
}

function eq(actual, expected, note) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${note ? note + ": " : ""}expected ${b}, got ${a}`);
}

function ok(cond, note) {
  if (!cond) throw new Error(note || "expected a truthy value");
}

// ---------------------------------------------------------------------------
// Fee maths — the shared fixture, so js/calc.js and the SQL agree.
// ---------------------------------------------------------------------------
const fixture = await (await fetch("/tests/fixtures/fee_cases.json")).json();

for (const c of fixture.cases) {
  test(`calc: ${c.name}`, () => {
    const fee = { base_amount: c.base_amount, rate: c.rate, calc_type: c.calc_type, active: true };
    const apartment = { num_dwellers: c.num_dwellers, area_m2: c.area_m2 };
    eq(feeAmount(fee, apartment), c.expected);
  });
}

test("calc: feeUnits per calc_type", () => {
  const apt = { num_dwellers: 3, area_m2: 40 };
  eq(feeUnits({ calc_type: "per_dweller" }, apt), 3);
  eq(feeUnits({ calc_type: "per_m2" }, apt), 40);
  eq(feeUnits({ calc_type: "flat" }, apt), 1);
});

test("calc: monthlyFee sums only active categories", () => {
  const apt = { num_dwellers: 2, area_m2: 50 };
  const fees = [
    { base_amount: 10, rate: 3, calc_type: "per_dweller", active: true },   // 16.00
    { base_amount: 0, rate: 4.5, calc_type: "flat", active: true },         //  4.50
    { base_amount: 99, rate: 99, calc_type: "flat", active: false },        // ignored
  ];
  eq(monthlyFee(apt, fees), 20.5);
});

test("calc: round2 rounds half away from zero at cent precision", () => {
  eq(round2(9.375), 9.38);
  eq(round2(1.005), 1.01);
  eq(round2(2.675), 2.68);
  eq(round2(0), 0);
});

test("calc: sum adds a column", () => {
  eq(sum([{ amount: "10.10" }, { amount: 5.4 }, { amount: null }], "amount"), 15.5);
});

// ---------------------------------------------------------------------------
// Dates — these are the helpers that were silently shifting a day via UTC.
// ---------------------------------------------------------------------------
test("dates: isoDate uses the local calendar day, not UTC", () => {
  // 00:30 local is the previous day in UTC for any positive offset; the old
  // toISOString() implementation returned 2026-07-31 here.
  eq(isoDate(new Date(2026, 7, 1, 0, 30)), "2026-08-01");
  eq(isoDate(new Date(2026, 0, 1, 23, 59)), "2026-01-01");
  eq(isoDate(new Date(2026, 11, 31, 0, 0)), "2026-12-31");
});

test("dates: monthEnd returns the real last day of the month", () => {
  eq(monthEnd("2026-07"), "2026-07-31");
  eq(monthEnd("2026-06"), "2026-06-30");
  eq(monthEnd("2026-02"), "2026-02-28");
  eq(monthEnd("2028-02"), "2028-02-29", "leap year");
  eq(monthEnd("2026-12"), "2026-12-31");
});

test("dates: monthStart and monthISO", () => {
  eq(monthStart("2026-07"), "2026-07-01");
  eq(monthISO(new Date(2026, 0, 15)), "2026-01");
  eq(monthISO(new Date(2026, 11, 1)), "2026-12");
});

test("dates: todayISO agrees with isoDate(now)", () => {
  eq(todayISO(), isoDate(new Date()));
  ok(/^\d{4}-\d{2}-\d{2}$/.test(todayISO()), "todayISO shape");
});

test("dates: daysBetween counts whole days, signed", () => {
  eq(daysBetween("2026-06-30", "2026-07-25"), 25);
  eq(daysBetween("2026-07-25", "2026-07-25"), 0);
  ok(daysBetween("2026-08-31", "2026-07-25") < 0, "future due date is negative");
});

// ---------------------------------------------------------------------------
// i18n — a missing key silently falls back to English, so drift is invisible
// in the UI. This is the only place it becomes visible.
// ---------------------------------------------------------------------------
test("i18n: every language defines exactly the same keys", () => {
  const en = Object.keys(translations.en).sort();
  for (const lang of Object.keys(LANGUAGES)) {
    const keys = Object.keys(translations[lang]).sort();
    const missing = en.filter((k) => !keys.includes(k));
    const extra = keys.filter((k) => !en.includes(k));
    if (missing.length || extra.length) {
      throw new Error(`${lang}: missing [${missing}] extra [${extra}]`);
    }
  }
});

test("i18n: no translation is left empty", () => {
  for (const [lang, dict] of Object.entries(translations)) {
    for (const [key, value] of Object.entries(dict)) {
      if (!String(value).trim()) throw new Error(`${lang}.${key} is empty`);
    }
  }
});

test("i18n: placeholders are substituted, unknown keys fall back", () => {
  const before = getLang();
  setLang("en");
  ok(t("gen_done", { count: 3 }).includes("3"), "count substituted");
  ok(t("rem_days_overdue", { days: 12 }).includes("12"), "days substituted");
  eq(t("__no_such_key__"), "__no_such_key__");
  setLang("bg");
  ok(t("sign_in") !== "sign_in", "bulgarian resolves");
  setLang(before);
});

// ---------------------------------------------------------------------------
// Printable documents — the money that ends up on paper.
// ---------------------------------------------------------------------------
state.condos = [{ id: "c1", name: "Test", address: "", currency: "EUR" }];
state.condoId = "c1";
state.profile = { full_name: "Tester", role: "admin" };
setLang("en");

test("print: monthly protocol closes with opening + in - out", () => {
  const doc = monthlyProtocol({
    from: "2026-07-01", to: "2026-07-31",
    payments: [
      { paid_on: "2026-07-05", amount: 30, apartments: { number: "1", owner_name: "A" } },
      { paid_on: "2026-07-09", amount: 20, apartments: { number: "2", owner_name: "B" } },
    ],
    expenses: [{ spent_on: "2026-07-10", amount: 30, description: "Cleaner" }],
    opening: 100,
  });
  const text = doc.textContent;
  ok(text.includes(money(120, "EUR")), `closing balance 120 missing from: ${text.slice(-160)}`);
  ok(text.includes(money(50, "EUR")), "money in 50 missing");
  ok(text.includes(money(30, "EUR")), "money out 30 missing");
});

test("print: reminder notices produce one page per debtor", () => {
  const debtors = [
    { number: "1", owner_name: "A", total_charged: 30, total_paid: 10, balance: 20, oldest_due_date: "2026-06-30" },
    { number: "2", owner_name: "B", total_charged: 40, total_paid: 0, balance: 40, oldest_due_date: "2026-05-31" },
  ];
  const doc = reminderNotices(debtors);
  eq(doc.querySelectorAll(".print-page").length, 2);
  eq(doc.querySelectorAll(".break-after").length, 1, "page break between, not after the last");
  ok(doc.textContent.includes(money(40, "EUR")), "second debtor's balance shown");
});

test("print: ledger running balance ends at charges minus payments", () => {
  const doc = ledgerDoc({ number: "1", owner_name: "A" }, [
    { date: "2026-06-30", description: "Cleaning", debit: 16, credit: 0 },
    { date: "2026-07-05", description: "Paid", debit: 0, credit: 10 },
    { date: "2026-07-31", description: "Cleaning", debit: 16, credit: 0 },
  ]);
  ok(doc.textContent.includes(money(22, "EUR")), "closing balance 22 missing");
});

// ---------------------------------------------------------------------------
// Report back to run_unit.py.
// ---------------------------------------------------------------------------
await fetch("/__results__", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(results),
});

document.body.textContent =
  `${results.filter((r) => r.ok).length}/${results.length} passed`;
