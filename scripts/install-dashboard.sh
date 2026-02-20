#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
INSTALL_DIR="$HOME/.openclaw/faye-voice"
mkdir -p "$INSTALL_DIR"

if [[ ! -f "$ROOT_DIR/dist/app/index.js" ]]; then
  echo "Build output missing. Running npm run build..."
  (cd "$ROOT_DIR" && npm run build)
fi

OS="$(uname)"
if [[ "$OS" == "Darwin" ]]; then
  mkdir -p "$HOME/Library/LaunchAgents"
  PLIST="$HOME/Library/LaunchAgents/com.fayevoice.dashboard.plist"
  cat > "$PLIST" <<EOF_PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.fayevoice.dashboard</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/env</string>
    <string>bash</string>
    <string>-lc</string>
    <string>cd '${ROOT_DIR}' && node dist/app/index.js</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${INSTALL_DIR}/dashboard.log</string>
  <key>StandardErrorPath</key>
  <string>${INSTALL_DIR}/dashboard-error.log</string>
</dict>
</plist>
EOF_PLIST

  "$SCRIPT_DIR/dashboard-control.sh" restart
  echo "Dashboard LaunchAgent installed."
  exit 0
fi

if [[ "$OS" == "Linux" ]]; then
  SERVICE_DIR="$HOME/.config/systemd/user"
  mkdir -p "$SERVICE_DIR"
  SERVICE_FILE="$SERVICE_DIR/faye-voice-dashboard.service"
  cat > "$SERVICE_FILE" <<EOF_SERVICE
[Unit]
Description=FayeVoice Dashboard API
After=network.target

[Service]
WorkingDirectory=${ROOT_DIR}
ExecStart=/usr/bin/env node dist/app/index.js
Restart=always
RestartSec=5
StandardOutput=append:${INSTALL_DIR}/dashboard.log
StandardError=append:${INSTALL_DIR}/dashboard-error.log

[Install]
WantedBy=default.target
EOF_SERVICE

  systemctl --user daemon-reload
  systemctl --user enable faye-voice-dashboard.service
  systemctl --user restart faye-voice-dashboard.service
  echo "Dashboard systemd user service installed."
  exit 0
fi

echo "Unsupported OS: $OS"
exit 1
