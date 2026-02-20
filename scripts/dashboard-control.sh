#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-status}"
OS="$(uname)"

mac_label="com.fayevoice.dashboard"
mac_plist="$HOME/Library/LaunchAgents/${mac_label}.plist"
linux_service="faye-voice-dashboard.service"

if [[ "$OS" == "Darwin" ]]; then
  case "$ACTION" in
    start)
      [[ -f "$mac_plist" ]] || { echo "Missing $mac_plist"; exit 1; }
      launchctl unload "$mac_plist" >/dev/null 2>&1 || true
      launchctl load "$mac_plist"
      ;;
    stop)
      [[ -f "$mac_plist" ]] || { echo "Missing $mac_plist"; exit 1; }
      launchctl unload "$mac_plist" >/dev/null 2>&1 || true
      ;;
    restart)
      "$0" stop || true
      "$0" start
      ;;
    status)
      if launchctl list | grep -q "$mac_label"; then
        echo "dashboard: running"
      else
        echo "dashboard: stopped"
        exit 1
      fi
      ;;
    *)
      echo "Usage: $0 {start|stop|restart|status}"; exit 1 ;;
  esac
  exit 0
fi

if [[ "$OS" == "Linux" ]]; then
  case "$ACTION" in
    start) systemctl --user start "$linux_service" ;;
    stop) systemctl --user stop "$linux_service" ;;
    restart) systemctl --user restart "$linux_service" ;;
    status) systemctl --user status "$linux_service" --no-pager ;;
    *) echo "Usage: $0 {start|stop|restart|status}"; exit 1 ;;
  esac
  exit 0
fi

echo "Unsupported OS: $OS"
exit 1
