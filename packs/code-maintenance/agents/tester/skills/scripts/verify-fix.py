#!/usr/bin/env python3
"""Run a repo's test suite plus acceptance checks, print a JSON report (stdlib only).

The tester runs this after a human approved the fix. Exit 0 only when the suite
AND every --check pass; the JSON goes into the task's test-report field.

Usage:
  verify-fix.py --test-cmd "bun test" --check "true" [--check "test -f dist/x"]
"""
import argparse
import json
import shlex
import subprocess
import sys


def run(cmd: str, timeout: int) -> dict:
    try:
        r = subprocess.run(shlex.split(cmd), capture_output=True, text=True, timeout=timeout)
        tail = (r.stdout + r.stderr)[-2000:]
        return {"cmd": cmd, "ok": r.returncode == 0, "code": r.returncode, "tail": tail}
    except subprocess.TimeoutExpired:
        return {"cmd": cmd, "ok": False, "code": "timeout", "tail": f"exceeded {timeout}s"}
    except Exception as e:
        return {"cmd": cmd, "ok": False, "code": "error", "tail": f"{type(e).__name__}: {e}"}


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--test-cmd", required=True, help="repo suite command, quoted")
    p.add_argument("--check", action="append", default=[], help="acceptance check, repeatable")
    p.add_argument("--timeout", type=int, default=600)
    a = p.parse_args()

    report = {"suite": run(a.test_cmd, a.timeout), "checks": [run(c, a.timeout) for c in a.check]}
    report["pass"] = report["suite"]["ok"] and all(c["ok"] for c in report["checks"])
    print(json.dumps(report, indent=2), flush=True)
    try:
        from crew import result  # type: ignore

        result(passed=report["pass"])
    except Exception:
        pass
    if not report["pass"]:
        print("error: verification failed", flush=True)
        return 1
    print("all green.", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
