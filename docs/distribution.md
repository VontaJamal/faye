# Distribution Guide

This page is for sharing Faye with new users fast.

## One-Command Install (Recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/VontaJamal/faye/main/scripts/bootstrap.sh | bash
```

What it does:

1. Clones or updates Faye source in `~/.openclaw/faye-src`.
2. Runs `./scripts/install.sh`.
3. Starts always-on services and opens dashboard on `http://127.0.0.1:4587`.

## Install from Existing Clone

If someone already cloned the repo:

```bash
./scripts/install.sh
./scripts/faye setup
```

## Advanced Bootstrap Options

Set environment variables before bootstrap:

- `FAYE_REPO_URL`: override git URL.
- `FAYE_BRANCH`: install a specific branch.
- `FAYE_INSTALL_DIR`: change source install path.

Example:

```bash
FAYE_BRANCH=cx/preview FAYE_INSTALL_DIR="$HOME/dev/faye-src" \
  curl -fsSL https://raw.githubusercontent.com/VontaJamal/faye/main/scripts/bootstrap.sh | bash
```

## First Success Signals

After install, expect:

- `Install complete. Open: http://127.0.0.1:4587`
- `./scripts/faye doctor` returns `"ok": true`
- `./scripts/speak.sh "Faye test voice"` plays audio
