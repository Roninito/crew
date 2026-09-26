#!/usr/bin/env bash
# Builds everything a GitHub release needs: crew standalone binaries for every supported
# platform, and the Wrangler plugin bundle. Output lands in dist/, ready for `gh release upload`.
# Usage: scripts/build-release.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist"
rm -rf "$DIST"
mkdir -p "$DIST"

echo "Building crew binaries..."
(cd "$ROOT/packages/crew" && bun install --silent && bun run gen-helpers)
TARGETS="
crew-darwin-arm64:bun-darwin-arm64
crew-darwin-x64:bun-darwin-x64
crew-linux-arm64:bun-linux-arm64
crew-linux-x64:bun-linux-x64
crew-windows-x64.exe:bun-windows-x64
"
for pair in $TARGETS; do
  name="${pair%%:*}"
  target="${pair##*:}"
  echo "  $name ($target)"
  (cd "$ROOT/packages/crew" && bun build --compile --target="$target" ./bin/crew.ts --outfile "$DIST/$name") >/dev/null
done

echo "Building Wrangler plugin..."
(cd "$ROOT/packages/wrangler" && bun install --silent && bun run build)
mkdir -p "$DIST/wrangler"
cp "$ROOT/packages/wrangler/main.js" "$ROOT/packages/wrangler/manifest.json" "$ROOT/packages/wrangler/styles.css" "$DIST/wrangler/"
(cd "$DIST/wrangler" && zip -q -r "../wrangler.zip" .)

echo "Built:"
ls -la "$DIST"
