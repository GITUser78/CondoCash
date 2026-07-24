# Tests

No test framework, no `node_modules`, no Docker — the app is plain ES modules,
so the browser is the runtime and Python drives it.

```bash
python3 tests/run_tests.py              # everything
python3 tests/run_tests.py --unit       # pure logic, no backend needed
python3 tests/run_tests.py --integration
```

## Unit — `tests/unit/`

`run_unit.py` serves the repository, opens `tests/unit/index.html` in headless
Firefox (or Chromium), and waits for the page to POST its results back; the
exit code is 0 only if every assertion passed. Covers:

- **fee maths** (`js/calc.js`) against `tests/fixtures/fee_cases.json`
- **date helpers** (`js/ui.js`) — `isoDate`, `monthEnd`, `daysBetween`, …
  including regressions for the UTC off-by-one that shifted charges into the
  wrong month
- **i18n** — that every language defines the same keys with no empty strings
  (a missing key falls back to English silently, so drift is otherwise
  invisible), plus placeholder substitution
- **printable documents** (`js/print.js`) — protocol totals, one page per
  reminder notice, ledger running balance

## Integration — `tests/integration/`

`test_api.py` talks to a real Supabase project over PostgREST, because RLS and
the SQL functions cannot be tested any other way. It creates two throwaway
users and two scratch condos and removes them again in a `finally` block.
Covers:

- **fee maths in SQL** against the *same* fixture the unit tests use, so
  `fee_amount_for()` and `js/calc.js` cannot drift apart
- **charge generation** — amounts match the preview, and re-running a month is
  a no-op instead of double-billing
- **`apartment_balances`** — the FIFO "oldest unpaid due date" as payments
  arrive
- **`condo_cash_summary`** — money in minus money out
- **RLS matrix** — a cashier sees only assigned condos, cannot create condos or
  apartments, may amend only their own payments, cannot generate charges and
  cannot promote themselves to admin; anonymous callers see nothing

### Configuration

Environment variables win; otherwise the script falls back to `js/config.js`
for the URL and anon key and to the Supabase CLI for the service-role key.

| Variable | Purpose |
|---|---|
| `SUPABASE_URL` | project URL |
| `SUPABASE_ANON_KEY` | anon / public key |
| `SUPABASE_SERVICE_ROLE_KEY` | needed to create and delete the throwaway users |

Without them the suite prints `SKIPPED` and exits 0.

> **Point this at a development project.** The tests only ever touch rows they
> created themselves, but they do write to whatever project they are given, and
> a run that dies between setup and teardown can leave a scratch condo behind
> (named `__test_a_<tag>__` / `__test_b_<tag>__`).

## Adding a fee case

Add it to `tests/fixtures/fee_cases.json` — both suites pick it up: the unit
tests check `js/calc.js`, the integration tests check the SQL.
