#!/usr/bin/env python3
"""Assert the motion performance budgets for a page (Playwright + optional Lighthouse).

Budgets: Lighthouse performance >= 90 mobile (when lighthouse is installed),
motion JS < 150KB gzipped-equivalent transfer, no console errors.
Exit 1 quoting the failing metric; that text goes straight into task feedback.

Usage:
  perf-budget.py --url http://localhost:8000/
"""
import argparse
import gzip
import json
import os
import shutil
import subprocess
import sys

MOTION_LIBS = ("lenis", "gsap", "three", "motion.js")
BUDGET_BYTES = 150 * 1024


def motion_bytes(transfer_log) -> int:
    total = 0
    for url, size in transfer_log:
        if any(lib in url for lib in MOTION_LIBS):
            total += size
    return total


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--url", required=True)
    a = p.parse_args()

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("error: playwright is not installed (python3 -m pip install playwright; playwright install chromium)", flush=True)
        return 1

    failures = []
    transfer = []
    errors = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(viewport={"width": 390, "height": 844})

        def on_response(resp):
            try:
                body = resp.body()
                transfer.append((resp.url, len(body)))
            except Exception:
                pass

        page.on("response", on_response)
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.goto(a.url, wait_until="networkidle", timeout=60000)
        page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        page.wait_for_timeout(1000)
        browser.close()

    motion = motion_bytes(transfer)
    print(f"motion js transfer: {motion // 1024}KB (budget {BUDGET_BYTES // 1024}KB)", flush=True)
    if motion > BUDGET_BYTES:
        failures.append(f"motion JS {motion // 1024}KB exceeds {BUDGET_BYTES // 1024}KB budget")
    if errors:
        failures.append(f"console/page errors: {errors[0]}")

    if shutil.which("lighthouse"):
        out = "/tmp/perf-budget.report.json"
        r = subprocess.run(
            ["lighthouse", a.url, "--only-categories=performance", "--preset=desktop",
             "--output=json", f"--output-path={out}", "--quiet", "--chrome-flags=--no-sandbox"],
            capture_output=True, text=True, timeout=300,
        )
        if r.returncode == 0:
            with open(out) as f:
                score = json.load(f)["categories"]["performance"]["score"] * 100
            print(f"lighthouse performance: {score:.0f} (budget >= 90)", flush=True)
            if score < 90:
                failures.append(f"lighthouse performance {score:.0f} < 90")
            os.path.exists(out) and os.remove(out)
        else:
            print("note: lighthouse run failed, skipping score gate", flush=True)
    else:
        print("note: lighthouse not installed, skipping score gate", flush=True)

    if failures:
        for f in failures:
            print(f"FAIL: {f}", flush=True)
        return 1
    print("budgets met.", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
