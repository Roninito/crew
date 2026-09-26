#!/usr/bin/env bash
# Scaffold a new crew agent from a template, leaving {{BLANK}} markers for the copilot to fill.
# Usage: new-agent.sh <name> <template> <runner> <model> <caps>
# Example: new-agent.sh blender worker claude sonnet blender,mesh,rig
set -euo pipefail
if [ "$#" -ne 5 ]; then
  echo "Usage: $0 <name> <template> <runner> <model> <caps>" >&2
  echo "Templates: worker, bridge, verifier, planner, watcher" >&2
  exit 1
fi
NAME="$1"; TEMPLATE="$2"; RUNNER="$3"; MODEL="$4"; CAPS="$5"

if command -v crew >/dev/null 2>&1; then CREW=(crew)
elif [ -n "${CREW_CLI:-}" ]; then CREW=("${CREW_BUN:-bun}" "$CREW_CLI")
else echo "crew CLI not found. Run scripts/install.sh from the crew checkout." >&2; exit 1; fi

OUT="$("${CREW[@]}" agent new "$NAME" --template "$TEMPLATE" --runner "$RUNNER" --model "$MODEL" --can "$CAPS" --json)"
FILE="$(printf '%s' "$OUT" | sed -n 's/.*"path": *"\([^"]*\)".*/\1/p')"
if [ -z "$FILE" ]; then echo "$OUT" >&2; exit 1; fi
BLANKS="$(grep -o '{{BLANK:' "$FILE" | wc -l | tr -d ' ')"
echo "Created $FILE with $BLANKS blanks to fill:"
grep -n '{{BLANK:' "$FILE" | sed 's/^/  line /'
echo "Next: replace every {{BLANK: ...}}, then run: crew agent lint $NAME && crew agent enable $NAME"
