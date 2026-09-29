#!/usr/bin/env python3
"""Check every http(s) link in a markdown file resolves (stdlib only).

The factchecker runs this before the claims table: a dead source link fails
that source. Exit 1 listing the broken links, 0 when all resolve.

Usage:
  check-links.py --file drafts/T-0001.md
"""
import argparse
import re
import sys
import urllib.request

LINK = re.compile(r"https?://[^\s)>\]]+")


def check(url: str, timeout: int) -> str | None:
    req = urllib.request.Request(url, headers={"User-Agent": "crew-factchecker/1.0"}, method="HEAD")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return None if r.status < 400 else f"HTTP {r.status}"
    except Exception as e:  # HEAD often blocked; fall back to a ranged GET.
        try:
            req = urllib.request.Request(
                url, headers={"User-Agent": "crew-factchecker/1.0", "Range": "bytes=0-0"}
            )
            with urllib.request.urlopen(req, timeout=timeout):
                return None
        except Exception as e2:
            return f"{type(e2).__name__}: {e2}"


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--file", required=True)
    p.add_argument("--timeout", type=int, default=20)
    a = p.parse_args()

    with open(a.file) as f:
        urls = sorted(set(LINK.findall(f.read())))
    if not urls:
        print("no links found.", flush=True)
        return 0
    broken = {}
    for u in urls:
        err = check(u.rstrip(".,;"), a.timeout)
        print(f"{'BROKEN' if err else 'ok'}  {u}", flush=True)
        if err:
            broken[u] = err
    if broken:
        print(f"error: {len(broken)}/{len(urls)} links broken", flush=True)
        return 1
    print(f"all {len(urls)} links resolve.", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
