#!/usr/bin/env bash
# Installs Wrangler (the crew Obsidian plugin) into a vault from the latest GitHub release.
# Stand-in for the Obsidian community plugin directory until Wrangler is listed there.
#
# Standalone, no checkout needed:
#   curl -fsSL https://raw.githubusercontent.com/roninito/crew/main/scripts/install-wrangler.sh | bash -s -- ~/Vaults/Studio
#
# Usage: install-wrangler.sh <vault>
set -euo pipefail
REPO="roninito/crew"
VAULT="${1:?Usage: install-wrangler.sh <vault>}"
[ -d "$VAULT" ] || { echo "Vault not found: $VAULT" >&2; exit 1; }
VAULT="$(cd "$VAULT" && pwd)"
DEST="$VAULT/.obsidian/plugins/wrangler"
BASE="https://github.com/$REPO/releases/latest/download"

command -v curl >/dev/null 2>&1 || { echo "curl is required." >&2; exit 1; }

mkdir -p "$DEST"
echo "Downloading Wrangler from the latest crew release..."
for f in main.js manifest.json styles.css; do
  curl -fsSL "$BASE/$f" -o "$DEST/$f.tmp"
  mv "$DEST/$f.tmp" "$DEST/$f"
done

echo "Wrangler installed in $DEST"
echo "Next: open Obsidian, go to Settings > Community plugins, and enable Wrangler."
echo "Enabling it for the first time sets up crew/ in this vault and downloads the crew server automatically -- no other install step needed."
