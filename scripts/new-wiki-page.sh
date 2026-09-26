#!/usr/bin/env bash
# Create a crew wiki page with frontmatter.
# Usage: scripts/new-wiki-page.sh <vault> <path-under-wiki> "<title>"
# Example: scripts/new-wiki-page.sh ~/Vault conventions/assets "Asset conventions"
set -euo pipefail
VAULT="${1:?Usage: new-wiki-page.sh <vault> <path> \"<title>\"}"
PAGE="${2:?page path required, e.g. conventions/assets}"
TITLE="${3:-$(basename "$PAGE")}"
FILE="$VAULT/crew/wiki/$PAGE.md"
if [ -e "$FILE" ]; then echo "Already exists: $FILE" >&2; exit 1; fi
mkdir -p "$(dirname "$FILE")"
cat > "$FILE" << MD
---
title: "$TITLE"
updated: $(date +%Y-%m-%d)
---

# $TITLE

MD
echo "Created $FILE. Add it to the wiki: list of agents that must follow it."
