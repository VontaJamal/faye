#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BIN_DIR="${FAYE_SHIM_BIN_DIR:-$HOME/.local/bin}"

mkdir -p "$BIN_DIR"

install_main_shim() {
  cat > "$BIN_DIR/faye" <<EOF
#!/usr/bin/env bash
set -euo pipefail
exec "$ROOT_DIR/scripts/faye" "\$@"
EOF
  chmod +x "$BIN_DIR/faye"
}

install_command_shim() {
  local shim_name="$1"
  local command_name="$2"
  cat > "$BIN_DIR/$shim_name" <<EOF
#!/usr/bin/env bash
set -euo pipefail
exec "$ROOT_DIR/scripts/faye" "$command_name" "\$@"
EOF
  chmod +x "$BIN_DIR/$shim_name"
}

install_main_shim

install_command_shim "faye-open" "open"
install_command_shim "faye-status" "status"
install_command_shim "faye-panic" "panic"
install_command_shim "faye-reset" "reset"
install_command_shim "faye-setup" "setup"
install_command_shim "faye-doctor" "doctor"
install_command_shim "faye-preflight" "preflight"
install_command_shim "faye-first-success" "first-success"
install_command_shim "faye-profile" "profile"
install_command_shim "faye-speak" "speak"

echo "Installed Faye command shims to: $BIN_DIR"
echo "Available now: faye, faye-open, faye-status, faye-panic, faye-reset"

if [[ ":${PATH:-}:" != *":$BIN_DIR:"* ]]; then
  rc_file="$HOME/.zshrc"
  if [[ "${SHELL:-}" == *"bash" ]]; then
    rc_file="$HOME/.bashrc"
  fi

  echo ""
  echo "PATH update required (run once):"
  echo "  echo 'export PATH=\"$BIN_DIR:\$PATH\"' >> $rc_file"
  echo "  source $rc_file"
fi
