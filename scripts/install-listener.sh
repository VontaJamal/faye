#!/bin/bash
# FayeVoice — One-click listener installer
# Sets up always-on wake word detection on macOS or Linux
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG="${FAYE_VOICE_CONFIG:-$HOME/.openclaw/faye-voice-config.json}"

echo ""
echo "  FayeVoice Listener Installer"
echo "  ════════════════════════════"
echo ""

# Check dependencies
for cmd in rec curl python3; do
    if ! command -v $cmd &>/dev/null; then
        echo "  Missing: $cmd"
        if [ "$cmd" = "rec" ]; then
            echo "  Install sox: brew install sox (macOS) or apt install sox (Linux)"
        fi
        exit 1
    fi
done
echo "  ✅ Dependencies OK"

# Check config
if [ ! -f "$CONFIG" ]; then
    echo "  ❌ Config not found at $CONFIG"
    echo "  Run voice-picker.sh first to set up your voice and config"
    exit 1
fi
echo "  ✅ Config found"

# Copy listener script
INSTALL_DIR="$HOME/.openclaw/faye-voice"
mkdir -p "$INSTALL_DIR"
cp "$SCRIPT_DIR/listener.sh" "$INSTALL_DIR/listener.sh"
chmod +x "$INSTALL_DIR/listener.sh"
echo "  ✅ Listener installed to $INSTALL_DIR"

# Test mic
echo ""
echo "  Testing microphone (speak for 2 seconds)..."
TESTFILE="/tmp/faye-mic-test.wav"
rec -q "$TESTFILE" rate 16k channels 1 trim 0 2 2>/dev/null
SIZE=$(stat -f%z "$TESTFILE" 2>/dev/null || stat -c%s "$TESTFILE" 2>/dev/null || echo 0)
rm -f "$TESTFILE"

if [ "$SIZE" -gt 50000 ]; then
    echo "  ✅ Microphone working"
else
    echo "  ⚠️  Mic may not be capturing. Check Privacy & Security → Microphone → Terminal"
fi

# Set up auto-start
OS=$(uname)
if [ "$OS" = "Darwin" ]; then
    PLIST="$HOME/Library/LaunchAgents/com.fayevoice.listener.plist"
    cat > "$PLIST" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.fayevoice.listener</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>${INSTALL_DIR}/listener.sh</string>
    </array>
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
EOF
    launchctl load "$PLIST" 2>/dev/null || true
    echo "  ✅ LaunchAgent created (auto-starts on login)"
    echo ""
    echo "  Listener is now running! Say your wake word to test."
    
elif [ "$OS" = "Linux" ]; then
    SERVICE_DIR="$HOME/.config/systemd/user"
    mkdir -p "$SERVICE_DIR"
    cat > "$SERVICE_DIR/faye-voice-listener.service" << EOF
[Unit]
Description=FayeVoice Wake Word Listener
After=network.target sound.target

[Service]
ExecStart=/bin/bash ${INSTALL_DIR}/listener.sh
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF
    systemctl --user daemon-reload
    systemctl --user enable faye-voice-listener
    systemctl --user start faye-voice-listener
    echo "  ✅ Systemd service created and started"
    echo ""
    echo "  Listener is now running! Say your wake word to test."
fi

echo ""
echo "  To stop:  launchctl unload ~/Library/LaunchAgents/com.fayevoice.listener.plist (macOS)"
echo "            systemctl --user stop faye-voice-listener (Linux)"
