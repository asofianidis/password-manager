#!/bin/bash
# Installs the latest macOS release into /Applications without tripping Gatekeeper.
# Browsers tag downloads with com.apple.quarantine, which makes macOS block apps that aren't
# notarized. curl doesn't set that attribute, so an app fetched this way opens normally.
#
#   curl -fsSL https://raw.githubusercontent.com/asofianidis/password-manager/main/scripts/install-mac.sh | bash
set -euo pipefail

REPO="asofianidis/password-manager"
APP="Password Manager.app"
DEST="/Applications"

case "$(uname -m)" in
  arm64) arch="arm64" ;;
  x86_64) arch="x64" ;;
  *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

url="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
  | grep -o "\"browser_download_url\": *\"[^\"]*-$arch-mac\.zip\"" \
  | sed 's/.*"\(https[^"]*\)"/\1/')"
if [[ -z "$url" ]]; then
  echo "Couldn't find a $arch macOS build in the latest release" >&2
  exit 1
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "Downloading $url"
curl -fL --progress-bar -o "$tmp/app.zip" "$url"
ditto -x -k "$tmp/app.zip" "$tmp/out"

if pgrep -xq "Password Manager"; then
  echo "Quitting running Password Manager"
  osascript -e 'quit app "Password Manager"' || true
  sleep 1
fi

rm -rf "$DEST/$APP"
ditto "$tmp/out/$APP" "$DEST/$APP"
# Clear quarantine in case the zip picked it up some other way
xattr -dr com.apple.quarantine "$DEST/$APP" 2>/dev/null || true

echo "Installed to $DEST/$APP"
open "$DEST/$APP"
