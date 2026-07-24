#!/usr/bin/env python3
"""Run the whole suite.

    python3 tests/run_tests.py                 # unit + integration
    python3 tests/run_tests.py --unit          # unit only (no backend needed)
    python3 tests/run_tests.py --integration   # integration only

Exit code is non-zero if anything failed. Integration tests skip themselves
(exit 0) when no Supabase project is configured — see tests/README.md.
"""
import argparse
import pathlib
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent


def run(label, script):
    # flush: our own buffered output would otherwise appear after the child's.
    print(f"\n=== {label} ===", flush=True)
    return subprocess.call([sys.executable, str(HERE / script)])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--unit", action="store_true")
    ap.add_argument("--integration", action="store_true")
    args = ap.parse_args()
    both = not (args.unit or args.integration)

    codes = []
    if both or args.unit:
        codes.append(run("unit", "unit/run_unit.py"))
    if both or args.integration:
        codes.append(run("integration", "integration/test_api.py"))

    failed = [c for c in codes if c != 0]
    print("\n=== summary ===", flush=True)
    print("FAILED" if failed else "all suites passed", flush=True)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
