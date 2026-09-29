#!/usr/bin/env python3
"""Fetch a source page and extract readable text to a file (stdlib only).

The researcher saves every source locally so claims are checked against files,
not URLs from memory.

Usage:
  fetch-extract.py --url https://example.com/article --out sources/1.txt
"""
import argparse
import html
import sys
import urllib.request
from html.parser import HTMLParser


class TextExtract(HTMLParser):
    SKIP = {"script", "style", "nav", "header", "footer", "aside", "form"}

    def __init__(self):
        super().__init__()
        self.parts = []
        self.depth = 0

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self.depth += 1
        elif tag in ("p", "h1", "h2", "h3", "h4", "li", "blockquote", "title"):
            self.parts.append("\n\n")

    def handle_endtag(self, tag):
        if tag in self.SKIP and self.depth:
            self.depth -= 1

    def handle_data(self, data):
        if not self.depth:
            text = html.unescape(data).strip()
            if text:
                self.parts.append(text + " ")


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--url", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--timeout", type=int, default=30)
    a = p.parse_args()

    req = urllib.request.Request(a.url, headers={"User-Agent": "crew-researcher/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=a.timeout) as r:
            raw = r.read().decode("utf-8", errors="replace")
    except Exception as e:
        print(f"error: fetch failed for {a.url}: {e}", flush=True)
        return 1
    parser = TextExtract()
    parser.feed(raw)
    text = "".join(parser.parts)
    text = "\n".join(line.strip() for line in text.splitlines())
    text = "\n".join(line for line in text.splitlines() if line)
    if len(text) < 100:
        print(f"error: almost no text extracted from {a.url} ({len(text)} chars)", flush=True)
        return 1
    with open(a.out, "w") as f:
        f.write(f"Source: {a.url}\n\n{text}\n")
    print(f"saved {len(text)} chars -> {a.out}", flush=True)
    try:
        from crew import result  # type: ignore

        result(files=[a.out])
    except Exception:
        pass
    print(f"produced: {a.out}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
