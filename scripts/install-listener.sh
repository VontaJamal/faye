#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG="${FAYE_VOICE_CONFIG:-$HOME/.openclaw/faye-voice-config.json}"
INSTALL_DIR="$HOME/.openclaw/faye-voice"

printf "\nFaye Listener Installer\n"
printf "======================\n\n"

for cmd in rec curl python3; do
  command -v "$cmd" >/dev/null 2>&1 || {
    echo "Missing dependency: $cmd"
    exit 1
  }
done

if [[ ! -f "$CONFIG" ]]; then
  echo "Config not found at $CONFIG"
  echo "Run ./scripts/faye setup first"
  exit 1
fi

mkdir -p "$INSTALL_DIR"
cp "$SCRIPT_DIR/listener.sh" "$INSTALL_DIR/listener.sh"
chmod +x "$INSTALL_DIR/listener.sh"

echo "Testing microphone..."
TESTFILE="/tmp/faye-mic-test.wav"
rec -q "$TESTFILE" rate 16k channels 1 trim 0 2 2>/dev/null || true
SIZE=$(stat -f%z "$TESTFILE" 2>/dev/null || stat -c%s "$TESTFILE" 2>/dev/null || echo 0)
rm -f "$TESTFILE"

if [[ "$SIZE" -lt 50000 ]]; then
  echo "Warning: mic test file was small; verify microphone permissions"
else
  echo "Microphone capture looks healthy"
fi

OS="$(uname)"
if [[ "$OS" == "Darwin" ]]; then
  mkdir -p "$HOME/Library/LaunchAgents"
  PLIST="$HOME/Library/LaunchAgents/com.fayevoice.listener.plist"
  cat > "$PLIST" <<EOF_PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.fayevoice.listener</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/env</string>
    <string>bash</string>
    <string>${INSTALL_DIR}/listener.sh</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>FAYE_VOICE_CONFIG</key>
    <string>${CONFIG}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${INSTALL_DIR}/listener.log</string>
  <key>StandardErrorPath</key>
  <string>${INSTALL_DIR}/listener-error.log</string>
</dict>
</plist>
EOF_PLIST

  "$SCRIPT_DIR/listener-control.sh" restart
  echo "Listener LaunchAgent installed and running."
  exit 0
fi

if [[ "$OS" == "Linux" ]]; then
  SERVICE_DIR="$HOME/.config/systemd/user"
  mkdir -p "$SERVICE_DIR"
  SERVICE_FILE="$SERVICE_DIR/faye-voice-listener.service"
  cat > "$SERVICE_FILE" <<EOF_SERVICE
[Unit]
Description=FayeVoice Wake Word Listener
After=network.target sound.target

[Service]
Environment=FAYE_VOICE_CONFIG=${CONFIG}
ExecStart=/usr/bin/env bash ${INSTALL_DIR}/listener.sh
Restart=always
RestartSec=5
StandardOutput=append:${INSTALL_DIR}/listener.log
StandardError=append:${INSTALL_DIR}/listener-error.log

[Install]
WantedBy=default.target
EOF_SERVICE

  systemctl --user daemon-reload
  systemctl --user enable faye-voice-listener.service
  systemctl --user restart faye-voice-listener.service
  echo "Listener systemd user service installed and running."
  exit 0
fi

echo "Unsupported OS: $OS"
exit 1
