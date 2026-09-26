#!/usr/bin/env bash
# Run crew as a background service so agents keep working with Obsidian closed.
# Usage: scripts/service.sh install|uninstall|status <vault>
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ACTION="${1:?Usage: service.sh install|uninstall|status <vault>}"
VAULT="$(cd "${2:?vault path required}" && pwd)"
NAME="crew-$(basename "$VAULT" | tr -c 'a-zA-Z0-9\n' '-')"
BUN="$(command -v bun)"
CLI="$ROOT/packages/crew/bin/crew.ts"
LOG="$VAULT/crew/.state/server.log"

if [ "$(uname)" = "Darwin" ]; then
  PLIST="$HOME/Library/LaunchAgents/com.crew.$NAME.plist"
  case "$ACTION" in
    install)
      cat > "$PLIST" << PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.crew.$NAME</string>
  <key>ProgramArguments</key><array><string>$BUN</string><string>$CLI</string><string>serve</string><string>--vault</string><string>$VAULT</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$PATH</string></dict>
</dict></plist>
PL
      launchctl unload "$PLIST" 2>/dev/null || true
      launchctl load "$PLIST"
      echo "Installed and started $PLIST" ;;
    uninstall) launchctl unload "$PLIST" 2>/dev/null || true; rm -f "$PLIST"; echo "Removed $PLIST" ;;
    status) launchctl list | grep "com.crew.$NAME" || echo "not loaded" ;;
    *) echo "Unknown action $ACTION" >&2; exit 1 ;;
  esac
else
  UNIT="$HOME/.config/systemd/user/$NAME.service"
  case "$ACTION" in
    install)
      mkdir -p "$(dirname "$UNIT")"
      cat > "$UNIT" << UN
[Unit]
Description=crew server for $VAULT

[Service]
ExecStart=$BUN $CLI serve --vault $VAULT
Restart=on-failure
Environment=PATH=$PATH
StandardOutput=append:$LOG
StandardError=append:$LOG

[Install]
WantedBy=default.target
UN
      systemctl --user daemon-reload
      systemctl --user enable --now "$NAME.service"
      echo "Installed and started $UNIT" ;;
    uninstall) systemctl --user disable --now "$NAME.service" 2>/dev/null || true; rm -f "$UNIT"; systemctl --user daemon-reload; echo "Removed $UNIT" ;;
    status) systemctl --user status "$NAME.service" --no-pager || true ;;
    *) echo "Unknown action $ACTION" >&2; exit 1 ;;
  esac
fi
