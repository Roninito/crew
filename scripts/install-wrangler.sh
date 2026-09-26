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
BIN_DIR="${CREW_BIN_DIR:-$HOME/.local/bin}"
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

# Install crew itself globally, so `crew status` etc. work from any terminal -- not just as
# something Wrangler spawns internally. Best effort: if the platform isn't recognized, Wrangler
# still works fine and falls back to downloading a private copy into its own plugin folder.
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) ASSET="crew-darwin-arm64" ;;
  Darwin-x86_64) ASSET="crew-darwin-x64" ;;
  Linux-aarch64|Linux-arm64) ASSET="crew-linux-arm64" ;;
  Linux-x86_64) ASSET="crew-linux-x64" ;;
  *) ASSET="" ;;
esac
if [ -n "$ASSET" ]; then
  mkdir -p "$BIN_DIR"
  curl -fsSL "$BASE/$ASSET" -o "$BIN_DIR/crew.tmp"
  chmod +x "$BIN_DIR/crew.tmp"
  mv "$BIN_DIR/crew.tmp" "$BIN_DIR/crew"
  echo "crew installed in $BIN_DIR"
  case ":$PATH:" in
    *":$BIN_DIR:"*) ;;
    *) echo "Add $BIN_DIR to your PATH, e.g.:  echo 'export PATH=\"$BIN_DIR:\$PATH\"' >> ~/.zshrc" ;;
  esac
else
  echo "Skipped installing crew globally ($(uname -s)/$(uname -m) not recognized); Wrangler will manage its own copy instead."
fi

# If this vault already has a Copilot-style skills folder, give it the crew-manager skill too, so
# it can run the team without waiting for crew/ to exist (Wrangler copies its own into crew/skills/
# on first enable; this is the same content for a copilot that reads .copilot/skills instead).
if [ -d "$VAULT/.copilot/skills" ]; then
  SKILL_DEST="$VAULT/.copilot/skills/crew-manager"
  RAW="https://raw.githubusercontent.com/$REPO/main/skill/crew-manager"
  mkdir -p "$SKILL_DEST/scripts"
  curl -fsSL "$RAW/SKILL.md" -o "$SKILL_DEST/SKILL.md.tmp" && mv "$SKILL_DEST/SKILL.md.tmp" "$SKILL_DEST/SKILL.md"
  curl -fsSL "$RAW/scripts/new-agent.sh" -o "$SKILL_DEST/scripts/new-agent.sh.tmp" && mv "$SKILL_DEST/scripts/new-agent.sh.tmp" "$SKILL_DEST/scripts/new-agent.sh"
  chmod +x "$SKILL_DEST/scripts/new-agent.sh"
  echo "Also installed the crew-manager skill in $SKILL_DEST"
fi

echo "Next: open Obsidian, go to Settings > Community plugins, and enable Wrangler."
echo "Enabling it for the first time sets up crew/ in this vault and downloads the crew server automatically -- no other install step needed."
