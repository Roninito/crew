#!/usr/bin/env python3
"""Lint a markdown draft: structure, whitespace, line length (stdlib only).

The drafter and polisher both run this before handoff. Exit 1 listing issues,
0 when clean.

Usage:
  lint-md.py --file drafts/T-0001.md
"""
import argparse
import re
import sys


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--file", required=True)
    p.add_argument("--max-len", type=int, default=120)
    a = p.parse_args()

    with open(a.file) as f:
        lines = f.read().splitlines()
    issues = []
    prev_level = 0
    blank_run = 0
    for n, line in enumerate(lines, 1):
        if not line.strip():
            blank_run += 1
            if blank_run > 1:
                issues.append(f"{n}: more than one blank line in a row")
            continue
        blank_run = 0
        if line != line.rstrip():
            issues.append(f"{n}: trailing whitespace")
        if len(line) > a.max_len:
            issues.append(f"{n}: line too long ({len(line)} > {a.max_len})")
        m = re.match(r"^(#{1,6})\s", line)
        if m:
            level = len(m.group(1))
            if prev_level and level > prev_level + 1:
                issues.append(f"{n}: heading jumps from h{prev_level} to h{level}")
            prev_level = level
    uncited = re.findall(r"\b\d[\d,]*(?:\.\d+)?%|\b\d{4}\b", " ".join(lines))
    if uncited:
        issues.append(f"note: {len(uncited)} numbers/dates present -- confirm each has a [src] marker")
    for i in issues:
        print(i, flush=True)
    if [i for i in issues if not i.startswith("note:")]:
        print(f"error: {a.file} has issues", flush=True)
        return 1
    print(f"{a.file} is clean.", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
