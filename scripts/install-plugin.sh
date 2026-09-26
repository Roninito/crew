#!/usr/bin/env bash
# Build the Wrangler Obsidian plugin from this checkout and install it into a vault, pinned to run
# crew from source. For an end-user install (no checkout, no Bun), download main.js/manifest.json/
# styles.css from the latest GitHub release into <vault>/.obsidian/plugins/wrangler/ instead --
# Wrangler downloads and runs crew itself the first time it's enabled.
# Usage: scripts/install-plugin.sh <vault>
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VAULT="${1:?Usage: install-plugin.sh <vault>}"
VAULT="$(cd "$VAULT" && pwd)"
DEST="$VAULT/.obsidian/plugins/wrangler"

(cd "$ROOT/packages/wrangler" && bun install --silent && bun run build)
mkdir -p "$DEST"
cp "$ROOT/packages/wrangler/main.js" "$ROOT/packages/wrangler/manifest.json" "$ROOT/packages/wrangler/styles.css" "$DEST/"

if [ ! -f "$DEST/data.json" ]; then
  cat > "$DEST/data.json" << JSON
{
  "bunPath": "$(command -v bun || echo bun)",
  "crewCliPath": "$ROOT/packages/crew/bin/crew.ts",
  "autoStart": true,
  "refreshSeconds": 5
}
JSON
fi
echo "Wrangler installed in $DEST. Enable it in Obsidian: Settings > Community plugins."
