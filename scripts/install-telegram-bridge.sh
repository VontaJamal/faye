#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
INSTALL_DIR="$HOME/.openclaw/faye-voice"
mkdir -p "$INSTALL_DIR"

if [[ ! -f "$ROOT_DIR/dist/app/telegramBridge.js" ]]; then
  echo "Build output missing. Running npm run build..."
  (cd "$ROOT_DIR" && npm run build)
fi

OS="$(uname)"
if [[ "$OS" == "Darwin" ]]; then
  mkdir -p "$HOME/Library/LaunchAgents"
  PLIST="$HOME/Library/LaunchAgents/com.fayevoice.telegrambridge.plist"
  cat > "$PLIST" <<EOF_PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.fayevoice.telegrambridge</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/env</string>
    <string>bash</string>
    <string>-lc</string>
    <string>cd '${ROOT_DIR}' && node dist/app/telegramBridge.js</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${INSTALL_DIR}/telegram-bridge.log</string>
  <key>StandardErrorPath</key>
  <string>${INSTALL_DIR}/telegram-bridge-error.log</string>
</dict>
</plist>
EOF_PLIST

  "$SCRIPT_DIR/telegram-bridge-control.sh" restart
  echo "Telegram bridge LaunchAgent installed."
  exit 0
fi

if [[ "$OS" == "Linux" ]]; then
  SERVICE_DIR="$HOME/.config/systemd/user"
  mkdir -p "$SERVICE_DIR"
  SERVICE_FILE="$SERVICE_DIR/faye-voice-telegram-bridge.service"
  cat > "$SERVICE_FILE" <<EOF_SERVICE
[Unit]
Description=FayeVoice Telegram Bridge
After=network.target

[Service]
WorkingDirectory=${ROOT_DIR}
ExecStart=/usr/bin/env node dist/app/telegramBridge.js
Restart=always
RestartSec=5
StandardOutput=append:${INSTALL_DIR}/telegram-bridge.log
StandardError=append:${INSTALL_DIR}/telegram-bridge-error.log

[Install]
WantedBy=default.target
EOF_SERVICE

  systemctl --user daemon-reload
  systemctl --user enable faye-voice-telegram-bridge.service
  systemctl --user restart faye-voice-telegram-bridge.service
  echo "Telegram bridge systemd user service installed."
  exit 0
fi

echo "Unsupported OS: $OS"
exit 1
