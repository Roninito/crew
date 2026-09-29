#!/usr/bin/env python3
"""Draft release notes from git history since a tag (stdlib + git only).

Every entry traces to a commit -- the releaser edits this draft into Highlights /
Fixes / Breaking changes, never inventing lines. Exit 1 when not a git repo or the
tag is unknown.

Usage:
  draft-notes.py --since v0.23.0 --out notes/v0.24.0.md
"""
import argparse
import subprocess
import sys


def git(*args: str) -> str:
    r = subprocess.run(["git", *args], capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        raise SystemExit(f"error: git {' '.join(args)} failed: {r.stderr.strip()}")
    return r.stdout


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--since", default="", help="previous tag; empty means whole history")
    p.add_argument("--out", required=True)
    p.add_argument("--max", type=int, default=100, help="max commits to include")
    a = p.parse_args()

    rev_range = f"{a.since}..HEAD" if a.since else "HEAD"
    if a.since:
        tags = git("tag", "--list").split()
        if a.since not in tags:
            raise SystemExit(f"error: unknown tag {a.since}")
    log = git("log", rev_range, f"--max-count={a.max}", "--pretty=format:%h %s")
    commits = [c for c in log.splitlines() if c.strip()]
    if not commits:
        raise SystemExit(f"error: no commits in range {rev_range}")
    with open(a.out, "w") as f:
        f.write(f"# Release notes (draft, since {a.since or 'beginning'})\n")
        f.write("\n## Highlights\n\n- \n\n## Fixes\n\n")
        for c in commits:
            f.write(f"- {c}\n")
        f.write("\n## Breaking changes\n\n- \n")
    print(f"drafted {len(commits)} commits -> {a.out}", flush=True)
    try:
        from crew import result  # type: ignore

        result(files=[a.out])
    except Exception:
        pass
    print(f"produced: {a.out}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
