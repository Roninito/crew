#!/usr/bin/env python3
"""Screenshot a page at several scroll depths, desktop + mobile (Playwright).

Saved shots are the review evidence for visual stages. Exit 1 on any failure.

Usage:
  shot-compare.py --url http://localhost:8000/ --out shots/build/ [--depths top,middle,bottom]
"""
import argparse
import sys

VIEWPORTS = {"desktop": {"width": 1440, "height": 900}, "mobile": {"width": 390, "height": 844}}


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--url", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--depths", default="top,middle,bottom")
    a = p.parse_args()

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("error: playwright is not installed (python3 -m pip install playwright; playwright install chromium)", flush=True)
        return 1
    import os

    os.makedirs(a.out, exist_ok=True)
    depths = [d.strip() for d in a.depths.split(",") if d.strip()]
    shots = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        for name, vp in VIEWPORTS.items():
            page = browser.new_page(viewport=vp)
            page.goto(a.url, wait_until="networkidle", timeout=60000)
            height = page.evaluate("document.body.scrollHeight")
            for d in depths:
                y = {"top": 0, "middle": height // 2, "bottom": max(0, height - vp["height"])}.get(d, 0)
                page.evaluate(f"window.scrollTo(0, {y})")
                page.wait_for_timeout(800)
                path = os.path.join(a.out, f"{name}-{d}.png")
                page.screenshot(path=path)
                shots.append(path)
                print(f"shot {path}", flush=True)
            page.close()
        browser.close()
    try:
        from crew import result  # type: ignore

        result(files=shots)
    except Exception:
        pass
    print(f"produced: {', '.join(shots)}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
