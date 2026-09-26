#!/usr/bin/env bash
# Create the crew folder layout in an Obsidian vault. Safe to re-run: existing files are kept.
# Usage: scripts/init-vault.sh <vault> [--assets <external-assets-folder>]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VAULT="${1:?Usage: init-vault.sh <vault> [--assets <folder>]}"
shift
ASSETS=""
while [ $# -gt 0 ]; do
  case "$1" in
    --assets) ASSETS="$2"; shift 2 ;;
    *) echo "Unknown option $1" >&2; exit 1 ;;
  esac
done

mkdir -p "$VAULT"
VAULT="$(cd "$VAULT" && pwd)"
NAME="$(basename "$VAULT")"
ASSETS="${ASSETS:-$(dirname "$VAULT")/$NAME-assets}"
C="$VAULT/crew"

for d in agents tasks blackboard events jobs assets reviews traces worktrees wiki templates/agents templates/scripts skills .state; do
  mkdir -p "$C/$d"
done
mkdir -p "$ASSETS"

# Copy the template without overwriting anything that exists.
( cd "$ROOT/vault-template/crew" && find . -type f ) | while read -r f; do
  if [ ! -e "$C/$f" ]; then
    mkdir -p "$(dirname "$C/$f")"
    cp "$ROOT/vault-template/crew/$f" "$C/$f"
  fi
done

# Fill crew.md placeholders once.
if grep -q '{{TOKEN}}' "$C/crew.md"; then
  TOKEN="$( (openssl rand -hex 16 2>/dev/null) || (head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n') )"
  tmp="$(mktemp)"
  sed -e "s|{{TOKEN}}|$TOKEN|" -e "s|{{VAULT_NAME}}|$NAME|" -e "s|{{ASSETS}}|$ASSETS|" "$C/crew.md" > "$tmp"
  mv "$tmp" "$C/crew.md"
fi

# The copilot skill lives in the vault so any harness can load it.
mkdir -p "$C/skills/crew-manager"
cp -R "$ROOT/skill/crew-manager/." "$C/skills/crew-manager/"

# Keep machine state out of Obsidian's view and out of sync conflicts.
if [ ! -f "$C/.state/README.md" ]; then
  echo "Machine state for crew (locks, sessions, spend). Don't edit by hand." > "$C/.state/README.md"
fi

echo "crew is set up in $C"
echo "External assets folder: $ASSETS"
echo "Next:"
echo "  crew --vault \"$VAULT\" status"
echo "  scripts/install-plugin.sh \"$VAULT\"     # adds Wrangler to Obsidian"
echo "  Point your copilot at $C/skills/crew-manager/SKILL.md"
