#!/usr/bin/env python3
"""Integration tests against a real Supabase project.

Covers what only the database can answer: the SQL fee maths (against the same
fixture the JS unit tests use), charge generation and its idempotency, the
apartment_balances FIFO "oldest unpaid" date, the cash-box view, and the RLS
policy matrix for a cashier versus an administrator.

Everything is created inside throwaway condos and throwaway users, and removed
again in a finally block — including on failure.

Configuration, in order of precedence:
    SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY  (env)
    js/config.js for url + anon key, and the Supabase CLI for the service key.

    python3 tests/integration/test_api.py

WARNING: point this at a development project. It writes and deletes rows (only
its own), and creates two auth users per run.
"""
import json
import os
import pathlib
import re
import secrets
import subprocess
import sys
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
FIXTURE = json.loads((ROOT / "tests/fixtures/fee_cases.json").read_text())["cases"]
TAG = secrets.token_hex(4)  # keeps parallel runs from colliding


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
def from_config_js():
    path = ROOT / "js/config.js"
    if not path.exists():
        return None, None
    text = path.read_text()
    url = re.search(r'SUPABASE_URL\s*=\s*"([^"]+)"', text)
    key = re.search(r'SUPABASE_ANON_KEY\s*=\s*"([^"]+)"', text)
    url = url.group(1) if url else None
    key = key.group(1) if key else None
    if url and url.startswith("http") and key and len(key) > 20:
        return url, key
    return None, None


def service_key_from_cli(url):
    cli = pathlib.Path.home() / ".local/bin/supabase"
    cli = str(cli) if cli.exists() else ("supabase" if os.environ.get("PATH") else None)
    ref = re.sub(r"^https://([^.]+)\..*$", r"\1", url or "")
    if not cli or not ref:
        return None
    try:
        out = subprocess.run([cli, "projects", "api-keys", "--project-ref", ref, "--output", "json"],
                             capture_output=True, text=True, stdin=subprocess.DEVNULL, timeout=90).stdout
        keys = json.loads(out[out.index("["):])
        return next(k["api_key"] for k in keys if k.get("name") == "service_role")
    except Exception:
        return None


def config():
    url = os.environ.get("SUPABASE_URL")
    anon = os.environ.get("SUPABASE_ANON_KEY")
    if not (url and anon):
        url, anon = from_config_js()
    service = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or service_key_from_cli(url)
    return url, anon, service


# ---------------------------------------------------------------------------
# Thin REST client
# ---------------------------------------------------------------------------
class Api:
    def __init__(self, base, anon):
        self.base = base.rstrip("/")
        self.anon = anon

    def call(self, path, method="GET", body=None, token=None, prefer=None):
        """Returns (status, parsed_body). Never raises on HTTP errors."""
        req = urllib.request.Request(self.base + path, method=method)
        req.add_header("apikey", self.anon)
        req.add_header("Authorization", f"Bearer {token or self.anon}")
        req.add_header("Content-Type", "application/json")
        if prefer:
            req.add_header("Prefer", prefer)
        data = json.dumps(body).encode() if body is not None else None
        try:
            with urllib.request.urlopen(req, data, timeout=60) as r:
                raw = r.read().decode()
                return r.status, (json.loads(raw) if raw.strip() else None)
        except urllib.error.HTTPError as e:
            raw = e.read().decode()
            try:
                return e.code, json.loads(raw)
            except ValueError:
                return e.code, raw

    def rest(self, path, method="GET", body=None, token=None, ret=True):
        status, out = self.call("/rest/v1" + path, method, body,
                                token, "return=representation" if ret else None)
        return status, out

    def rpc(self, fn, args, token=None):
        return self.call(f"/rest/v1/rpc/{fn}", "POST", args, token)

    def sign_in(self, email, password):
        status, out = self.call("/auth/v1/token?grant_type=password", "POST",
                                {"email": email, "password": password})
        assert status == 200, f"sign-in failed: {out}"
        return out["access_token"]

    def create_user(self, service, email, password, full_name):
        status, out = self.call("/auth/v1/admin/users", "POST", {
            "email": email, "password": password, "email_confirm": True,
            "user_metadata": {"full_name": full_name},
        }, token=service)
        assert status in (200, 201), f"create user failed: {out}"
        return out["id"]

    def delete_user(self, service, uid):
        self.call(f"/auth/v1/admin/users/{uid}", "DELETE", token=service)


# ---------------------------------------------------------------------------
# Test registry
# ---------------------------------------------------------------------------
TESTS = []
FAILURES = []


def test(name):
    def wrap(fn):
        TESTS.append((name, fn))
        return fn
    return wrap


def eq(actual, expected, note=""):
    if actual != expected:
        raise AssertionError(f"{note + ': ' if note else ''}expected {expected!r}, got {actual!r}")


def close(actual, expected, note="", tol=0.005):
    if abs(float(actual) - float(expected)) > tol:
        raise AssertionError(f"{note + ': ' if note else ''}expected {expected}, got {actual}")


# ---------------------------------------------------------------------------
# Suite
# ---------------------------------------------------------------------------
class Ctx:
    """Everything the tests share: clients, tokens, and the scratch data."""


C = Ctx()


@test("fee maths in SQL matches the shared fixture")
def _(api=None):
    _, preview = C.api.rpc("preview_charges",
                           {"p_condo_id": C.condo_a, "p_period": "2026-08-01"}, C.admin)
    got = {(r["apartment_number"], r["fee_name"]): float(r["amount"]) for r in preview}
    for i, case in enumerate(FIXTURE):
        key = (str(i + 1), f"case-{i}")
        close(got[key], case["expected"], case["name"])


@test("generate_charges writes the same amounts preview promised")
def _():
    status, count = C.api.rpc("generate_charges",
                              {"p_condo_id": C.condo_a, "p_period": "2026-08-01"}, C.admin)
    eq(status, 200)
    eq(count, len(FIXTURE) ** 2, "one charge per apartment x fee")
    _, charges = C.api.rest(
        f"/charges?condo_id=eq.{C.condo_a}&select=amount,description,apartments(number)",
        token=C.admin)
    got = {(c["apartments"]["number"], c["description"]): float(c["amount"]) for c in charges}
    for i, case in enumerate(FIXTURE):
        close(got[(str(i + 1), f"case-{i}")], case["expected"], case["name"])


@test("re-generating the same month creates no duplicates")
def _():
    _, before = C.api.rest(f"/charges?condo_id=eq.{C.condo_a}&select=id", token=C.admin)
    _, count = C.api.rpc("generate_charges",
                         {"p_condo_id": C.condo_a, "p_period": "2026-08-01"}, C.admin)
    eq(count, 0, "second run must be a no-op")
    _, after = C.api.rest(f"/charges?condo_id=eq.{C.condo_a}&select=id", token=C.admin)
    eq(len(after), len(before))


@test("apartment_balances tracks the oldest unpaid due date as payments arrive")
def _():
    def balance():
        _, rows = C.api.rest(
            f"/apartment_balances?apartment_id=eq.{C.apt_b}&select=balance,oldest_due_date",
            token=C.admin)
        return rows[0]

    b = balance()
    close(b["balance"], 20, "two months of a 10.00 flat fee")
    eq(b["oldest_due_date"], "2026-01-31", "nothing paid yet")

    C.api.rest("/payments", "POST", {
        "condo_id": C.condo_b, "apartment_id": C.apt_b, "amount": 10,
        "paid_on": "2026-02-03", "method": "Cash",
    }, C.admin)
    b = balance()
    close(b["balance"], 10)
    eq(b["oldest_due_date"], "2026-02-28", "January is settled, February is now the oldest")

    C.api.rest("/payments", "POST", {
        "condo_id": C.condo_b, "apartment_id": C.apt_b, "amount": 10,
        "paid_on": "2026-03-01", "method": "Cash",
    }, C.admin)
    b = balance()
    close(b["balance"], 0)
    eq(b["oldest_due_date"], None, "fully paid up, nothing to chase")


@test("condo_cash_summary = payments in minus expenses out")
def _():
    C.api.rest("/expenses", "POST", {
        "condo_id": C.condo_b, "spent_on": "2026-03-02",
        "description": "Cleaning", "amount": 4.5,
    }, C.admin)
    _, rows = C.api.rest(f"/condo_cash_summary?condo_id=eq.{C.condo_b}&select=*", token=C.admin)
    s = rows[0]
    close(s["total_collected"], 20)
    close(s["total_spent"], 4.5)
    close(s["cash_balance"], 15.5)
    close(s["total_outstanding"], 0)


@test("RLS: a cashier sees only the condos assigned to them")
def _():
    _, rows = C.api.rest(f"/condos?id=eq.{C.condo_b}&select=id", token=C.cashier)
    eq(rows, [], "condo_b was never assigned to this cashier")
    _, rows = C.api.rest(f"/condos?id=eq.{C.condo_a}&select=id", token=C.cashier)
    eq(len(rows), 1, "condo_a is assigned")


@test("RLS: a cashier cannot create condos or apartments")
def _():
    status, _ = C.api.rest("/condos", "POST", {"name": f"nope-{TAG}"}, C.cashier)
    eq(status, 403, "creating a condo")
    status, _ = C.api.rest("/apartments", "POST",
                           {"condo_id": C.condo_a, "number": "999", "num_dwellers": 1}, C.cashier)
    eq(status, 403, "creating an apartment")


@test("RLS: a cashier can book payments for their condo")
def _():
    status, rows = C.api.rest("/payments", "POST", {
        "condo_id": C.condo_a, "apartment_id": C.apt_a, "amount": 5,
        "paid_on": "2026-08-05", "recorded_by": C.cashier_id,
    }, C.cashier)
    eq(status, 201, "cashier booking a payment")
    C.cashier_payment = rows[0]["id"]


@test("RLS: a cashier may amend their own payment but not someone else's")
def _():
    status, rows = C.api.rest(f"/payments?id=eq.{C.cashier_payment}", "PATCH",
                              {"note": "corrected"}, C.cashier)
    eq(len(rows), 1, "own payment is editable")

    _, admin_pay = C.api.rest("/payments", "POST", {
        "condo_id": C.condo_a, "apartment_id": C.apt_a, "amount": 7,
        "paid_on": "2026-08-06", "recorded_by": C.admin_id,
    }, C.admin)
    pid = admin_pay[0]["id"]
    _, rows = C.api.rest(f"/payments?id=eq.{pid}", "PATCH", {"note": "hijacked"}, C.cashier)
    eq(rows, [], "another user's payment is not editable")
    C.api.rest(f"/payments?id=eq.{pid}", "DELETE", token=C.cashier)
    _, still = C.api.rest(f"/payments?id=eq.{pid}&select=id,note", token=C.admin)
    eq(len(still), 1, "another user's payment survives a cashier delete")
    eq(still[0]["note"], None, "and was not modified")


@test("RLS: a cashier cannot promote themselves to admin")
def _():
    status, out = C.api.rest(f"/profiles?id=eq.{C.cashier_id}", "PATCH",
                             {"role": "admin"}, C.cashier)
    if status == 200 and out:
        raise AssertionError("privilege escalation succeeded!")
    eq(status, 400, f"expected the role guard to raise, got {out}")
    _, rows = C.api.rest(f"/profiles?id=eq.{C.cashier_id}&select=role", token=C.cashier)
    eq(rows[0]["role"], "cashier", "role unchanged")


@test("RLS: only admins can generate charges")
def _():
    status, out = C.api.rpc("generate_charges",
                            {"p_condo_id": C.condo_a, "p_period": "2026-09-01"}, C.cashier)
    eq(status, 400, f"expected a refusal, got {out}")
    eq("Only admins" in json.dumps(out), True, f"unexpected error: {out}")


@test("RLS: anonymous callers see nothing")
def _():
    _, rows = C.api.rest("/condos?select=id")
    eq(rows, [], "anon must not read condos")
    _, rows = C.api.rest("/apartments?select=id")
    eq(rows, [], "anon must not read apartments")


# ---------------------------------------------------------------------------
# Fixture setup / teardown
# ---------------------------------------------------------------------------
def setup(api, service):
    C.api = api
    pw = secrets.token_urlsafe(18)
    C.admin_email = f"condocash-test-admin-{TAG}@example.com"
    C.cashier_email = f"condocash-test-cashier-{TAG}@example.com"
    C.admin_id = api.create_user(service, C.admin_email, pw, "Test Admin")
    C.cashier_id = api.create_user(service, C.cashier_email, pw, "Test Cashier")
    status, _ = api.rest(f"/profiles?id=eq.{C.admin_id}", "PATCH", {"role": "admin"}, service)
    assert status == 200, "could not promote the test admin"
    C.admin = api.sign_in(C.admin_email, pw)
    C.cashier = api.sign_in(C.cashier_email, pw)

    # Condo A: one apartment and one fee category per fixture case.
    _, rows = api.rest("/condos", "POST", {"name": f"__test_a_{TAG}__", "currency": "EUR"}, C.admin)
    C.condo_a = rows[0]["id"]
    apartments = [{"condo_id": C.condo_a, "number": str(i + 1),
                   "num_dwellers": c["num_dwellers"], "area_m2": c["area_m2"]}
                  for i, c in enumerate(FIXTURE)]
    _, rows = api.rest("/apartments", "POST", apartments, C.admin)
    C.apt_a = rows[0]["id"]
    fees = [{"condo_id": C.condo_a, "name": f"case-{i}", "calc_type": c["calc_type"],
             "base_amount": c["base_amount"], "rate": c["rate"], "active": True}
            for i, c in enumerate(FIXTURE)]
    api.rest("/fee_categories", "POST", fees, C.admin)
    api.rest("/condo_cashiers", "POST",
             {"condo_id": C.condo_a, "user_id": C.cashier_id}, C.admin)

    # Condo B: a single flat fee, charged for two months — for the balances view.
    _, rows = api.rest("/condos", "POST", {"name": f"__test_b_{TAG}__", "currency": "EUR"}, C.admin)
    C.condo_b = rows[0]["id"]
    _, rows = api.rest("/apartments", "POST",
                       {"condo_id": C.condo_b, "number": "1", "num_dwellers": 2, "area_m2": 60},
                       C.admin)
    C.apt_b = rows[0]["id"]
    api.rest("/fee_categories", "POST",
             {"condo_id": C.condo_b, "name": "Flat", "calc_type": "flat",
              "base_amount": 0, "rate": 10, "active": True}, C.admin)
    for period, due in (("2026-01-01", "2026-01-31"), ("2026-02-01", "2026-02-28")):
        api.rpc("generate_charges",
                {"p_condo_id": C.condo_b, "p_period": period, "p_due_date": due}, C.admin)


def teardown(api, service):
    for cid in (getattr(C, "condo_a", None), getattr(C, "condo_b", None)):
        if cid:
            api.rest(f"/condos?id=eq.{cid}", "DELETE", token=service, ret=False)
    for uid in (getattr(C, "admin_id", None), getattr(C, "cashier_id", None)):
        if uid:
            api.delete_user(service, uid)


def main():
    url, anon, service = config()
    if not (url and anon and service):
        print("integration: SKIPPED — set SUPABASE_URL, SUPABASE_ANON_KEY and "
              "SUPABASE_SERVICE_ROLE_KEY (or run locally with js/config.js + the Supabase CLI)")
        return 0

    api = Api(url, anon)
    print(f"integration: {url} (run tag {TAG})")
    try:
        setup(api, service)
        for name, fn in TESTS:
            try:
                fn()
                print(f"  ok    {name}")
            except Exception as err:  # noqa: BLE001 - report, keep going
                FAILURES.append((name, err))
                print(f"  FAIL  {name}\n        {err}")
    finally:
        teardown(api, service)
        print("integration: scratch condos and test users removed")

    print(f"integration: {len(TESTS) - len(FAILURES)}/{len(TESTS)} passed")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
