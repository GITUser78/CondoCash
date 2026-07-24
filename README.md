# CondoCash 🏢

A small web app for the cashier of a condominium (etazhna sobstvenost): keep the
apartment and dweller register, configure the monthly fees, book payments and
expenses, chase open payments, and print the protocols the general assembly
expects.

Bilingual (Български / English), no build step — plain ES modules, a Supabase
(PostgreSQL) backend, and the browser's print dialog for documents/PDFs.

## Roles

| | Administrator | Cashier |
|---|---|---|
| Condos, cashier assignments, users | ✅ | — |
| Apartments, dwellers, owners | ✅ create/edit | 👁 read |
| Fee categories & charge generation | ✅ | 👁 read |
| Payments | ✅ | ✅ |
| Expenses from the cash box | ✅ | ✅ (own entries editable) |
| Dashboard, statements, protocols | ✅ | ✅ |

Cashiers only ever see the condos an administrator has assigned to them. All of
this is enforced in the database by Row Level Security, not just in the UI.

## Setup

1. **Create a Supabase project** (free tier is enough).
2. **Run the schema** — it creates the tables, the RLS policies, the balance
   views and the `generate_charges()` / `preview_charges()` functions. Either:

   ```bash
   supabase link --project-ref <your-project-ref>
   supabase db push
   ```

   …or, without the CLI, open *SQL Editor → New query* in the dashboard and run
   every file in [`supabase/migrations/`](supabase/migrations/) in filename
   order.
3. **Configure the client**: copy
   [`js/config.example.js`](js/config.example.js) to `js/config.js` and fill in
   your project URL and anon key from *Project Settings → API*. `js/config.js`
   is git-ignored, so a clone never carries someone else's backend; the anon key
   itself is meant to be public in the browser — access is governed by RLS.
4. **Create the first user**: *Authentication → Users → Add user* (or let the
   person sign up). A `profiles` row is created automatically with the role
   `cashier`; promote the first administrator once, from the SQL editor:

   ```sql
   update profiles set role = 'admin', full_name = 'Your Name'
   where id = (select id from auth.users where email = 'you@example.com');
   ```

   (This works because `guard_profile_role()` only guards real end-user
   sessions — see `20260725003000_fix_role_guard.sql`. Everyone else stays a
   cashier until an administrator promotes them in *Users*.)

5. **Serve the folder** over HTTP (ES modules do not load from `file://`):

   ```bash
   python3 -m http.server 8000
   # → http://localhost:8000
   ```

   Any static host works too (Netlify, GitHub Pages, nginx…). The Supabase
   client library is loaded from a CDN at runtime, so the app needs internet
   access.

## Deployment

Every push to `main` is published to GitHub Pages by
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml). Because
`js/config.js` is git-ignored, the workflow writes it from two repository
secrets (*Settings → Secrets and variables → Actions*):

| Secret | Value |
|---|---|
| `SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `SUPABASE_ANON_KEY` | the anon / public key |

Both are served to the browser, as any Supabase client app must — RLS is what
protects the data. Rotating the key means updating the secret and re-running the
workflow. For a private deployment, disable Pages and copy your local
`js/config.js` onto the host instead.

## Daily use

**Administrator, once per building**

1. *Condos* → add the building, then assign the cashier(s) to it.
2. *Apartments & owners* → add every apartment with its **number of dwellers**,
   area and owner contact details.
3. *Fees* → add the cost categories. Each one is charged per apartment as
   **base amount + rate × units**, where the unit is a **dweller**, the
   **apartment itself** (flat) or a **m²**. So a category with a base of 10.00
   and a rate of 3.00 per dweller charges an apartment with two dwellers
   10.00 + 2 × 3.00 = **16.00**. Leave the base at 0 for a purely variable fee,
   or the rate at 0 for a purely fixed one.

**Every month**

4. *Fees → Generate monthly charges*: pick the month (and optionally a due
   date — the end of the month is used otherwise) and press *Preview* to check
   the amounts, then *Generate*. Re-running the same month is safe: existing
   charges are not duplicated.

**Cashier, continuously**

5. *Dashboard* lists everyone who owes money, oldest debt first, with the days
   overdue highlighted. Book a payment straight from that row.
6. *Expenses* records what is paid out of the cash box, so *cash on hand* always
   reflects reality.

## Printing protocols

*Protocols* collects every document; each opens in the browser print dialog, so
"Save as PDF" produces a file. Each page carries the building name, the period
and signature lines for cashier and chairperson.

- **Monthly cash protocol** — income, expenses, opening/closing cash balance.
- **List of debtors** — every apartment with an outstanding balance.
- **Reminder notices** — one page per debtor, ready to put in a letterbox.
- **Charges for a month** — what was charged, per apartment and fee.
- **Apartment & dweller register** — the register incl. the monthly fee.
- **Account statement** — all charges and payments of a single apartment.

Receipts print from the payments list (🖨 on the row) or right after booking a
payment.

## Project layout

```
index.html            app shell (everything is rendered from JS)
css/styles.css        UI styles + the print stylesheet
js/config.example.js  template → copy to js/config.js (git-ignored)
js/app.js             boot, auth, chrome, view dispatch
js/api.js             every database call
js/supabase.js        lazy-loaded Supabase client
js/state.js           session/profile/selected condo
js/ui.js              DOM helpers, formatting, modals, printing
js/calc.js            fee maths (mirrors generate_charges() in SQL)
js/print.js           the printable documents
js/i18n.js            Bulgarian + English strings
js/views/*.js         one module per tab
supabase/migrations/  tables, RLS policies, views, functions (supabase db push)
supabase/config.toml  Supabase CLI project config
```

## Notes

- Payments are not allocated to individual charges; a balance per apartment is
  kept, and the "oldest unpaid" date is derived by matching payments against
  charges oldest-first (see the `apartment_balances` view).
- Deleting an apartment deletes its charges and payments (cascade). Deactivate a
  fee category instead of deleting it to keep past charges explainable.
