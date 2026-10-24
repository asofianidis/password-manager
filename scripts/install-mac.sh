#!/bin/bash
# Installs or updates the latest macOS release in /Applications from the Terminal.
# The download is checked against the release's SHA256SUMS.txt, and the app must be signed with
# this project's Developer ID and pass codesign and Gatekeeper (notarization) checks before it
# replaces the installed app.
#
#   curl -fsSL https://raw.githubusercontent.com/asofianidis/password-manager/main/scripts/install-mac.sh | bash
#
# PM_ALLOW_UNSIGNED=1 installs a build without a Developer ID signature (e.g. one you built
# yourself or from a fork) after the checksum check.
set -euo pipefail

REPO="asofianidis/password-manager"
APP="Password Manager.app"
DEST="/Applications"
# Apple Developer team that signs official releases
TEAM_ID="YLGZDPWZ2X"

case "$(uname -m)" in
  arm64) arch="arm64" ;;
  x86_64) arch="x64" ;;
  *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

release="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest")"
# Prints the URL of the first asset matching $1, or nothing (grep finding no match isn't an error)
asset_url() {
  printf '%s' "$release" \
    | { grep -oE "\"browser_download_url\": *\"[^\"]*$1\"" || true; } \
    | head -n1 \
    | sed 's/.*"\(https[^"]*\)"/\1/'
}

url="$(asset_url "-$arch-mac\.zip")"
sums_url="$(asset_url "/SHA256SUMS\.txt")"
if [[ -z "$url" ]]; then
  echo "Couldn't find a $arch macOS build in the latest release" >&2
  exit 1
fi
if [[ -z "$sums_url" ]]; then
  echo "The latest release has no SHA256SUMS.txt; refusing to install an unverified download" >&2
  exit 1
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "Downloading $url"
curl -fL --progress-bar -o "$tmp/app.zip" "$url"
curl -fsSL -o "$tmp/SHA256SUMS.txt" "$sums_url"

name="$(basename "$url")"
expected="$(awk -v n="$name" '$2 == n || $2 == "*" n { print $1 }' "$tmp/SHA256SUMS.txt")"
actual="$(shasum -a 256 "$tmp/app.zip" | awk '{ print $1 }')"
if [[ -z "$expected" || "$expected" != "$actual" ]]; then
  echo "Checksum mismatch for $name; not installing" >&2
  exit 1
fi
echo "Checksum verified"

ditto -x -k "$tmp/app.zip" "$tmp/out"
app="$tmp/out/$APP"

# Signed by this team's Developer ID certificate, issued by Apple
requirement="anchor apple generic and certificate leaf[subject.OU] = \"$TEAM_ID\""
if codesign --verify --strict -R="$requirement" "$app" 2>/dev/null; then
  if ! codesign --verify --deep --strict "$app" \
    || ! assessment="$(spctl --assess --type execute -vv "$app" 2>&1)" \
    || ! grep -q "source=Notarized Developer ID" <<< "$assessment"; then
    echo "${assessment:-}" >&2
    echo "$APP is signed but failed signature or Gatekeeper checks; not installing" >&2
    exit 1
  fi
  echo "Signature and notarization verified (team $TEAM_ID)"
elif [[ "${PM_ALLOW_UNSIGNED:-}" == 1 ]]; then
  echo "Warning: $APP isn't signed with team $TEAM_ID's Developer ID; installing anyway" >&2
else
  echo "$APP isn't signed with team $TEAM_ID's Developer ID; not installing." >&2
  echo "Set PM_ALLOW_UNSIGNED=1 to install it anyway." >&2
  exit 1
fi

if pgrep -xq "Password Manager"; then
  echo "Quitting running Password Manager"
  osascript -e 'quit app "Password Manager"' || true
  sleep 1
fi

rm -rf "${DEST:?}/${APP:?}"
ditto "$app" "$DEST/$APP"

echo "Installed to $DEST/$APP"
open "$DEST/$APP"
