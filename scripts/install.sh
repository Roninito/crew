#!/usr/bin/env bash
# Install crew: checks Bun, installs dependencies, and puts a `crew` command on your PATH.
# Usage: scripts/install.sh [bin-dir]   (default bin dir: ~/.local/bin)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN_DIR="${1:-$HOME/.local/bin}"

if ! command -v bun >/dev/null 2>&1; then
  echo "Bun isn't installed. Install it with:  curl -fsSL https://bun.sh/install | bash" >&2
  exit 1
fi
command -v python3 >/dev/null 2>&1 || echo "note: python3 not found; Python job scripts won't run until it's installed."

echo "Installing crew dependencies..."
(cd "$ROOT/packages/crew" && bun install --silent)
echo "Installing Wrangler dependencies..."
(cd "$ROOT/packages/wrangler" && bun install --silent)

mkdir -p "$BIN_DIR"
cat > "$BIN_DIR/crew" << WRAP
#!/usr/bin/env bash
exec bun "$ROOT/packages/crew/bin/crew.ts" "\$@"
WRAP
chmod +x "$BIN_DIR/crew"
echo "Installed: $BIN_DIR/crew"

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) echo "Add $BIN_DIR to your PATH, e.g.:  echo 'export PATH=\"$BIN_DIR:\$PATH\"' >> ~/.zshrc" ;;
esac
echo "Next: scripts/init-vault.sh <path-to-vault>"
