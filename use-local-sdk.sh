#!/usr/bin/env bash
# Serve YOUR build of the SDK (web-sdk/) instead of the prebuilt copy in app/www.
# Run it once after the first SDK build (see README). From then on every rebuild
# is live: rebuild, then reload the page.
#
#   ./use-local-sdk.sh          app/www/{build,assets,worker} -> web-sdk's build output
#   ./use-local-sdk.sh --undo   back to the prebuilt copies (kept in app/www-prebuilt/)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WWW="$HERE/app/www"
KEEP="$HERE/app/www-prebuilt"
SDK="$HERE/web-sdk"

if [ "${1:-}" = "--undo" ]; then
  for name in build assets IDVerseSDK.worker.min.js; do
    if [ -L "$WWW/$name" ]; then rm "$WWW/$name"; fi
    if [ -e "$KEEP/$name" ]; then mv "$KEEP/$name" "$WWW/$name"; fi
  done
  rmdir "$KEEP" 2>/dev/null || true
  echo "app/www serves the prebuilt SDK again."
  exit 0
fi

if [ ! -d "$SDK/www/build" ]; then
  echo "error: web-sdk/www/build does not exist yet -- build the SDK first (README: 'Change the SDK')" >&2
  exit 1
fi

mkdir -p "$KEEP"
# link <name in app/www> <target, relative to app/www>
link() {
  if [ -L "$WWW/$1" ]; then
    rm "$WWW/$1"
  elif [ -e "$WWW/$1" ]; then
    mv "$WWW/$1" "$KEEP/$1"
  fi
  ln -s "$2" "$WWW/$1"
}
link build ../../web-sdk/www/build
link assets ../../web-sdk/www/assets
link IDVerseSDK.worker.min.js ../../web-sdk/src/ui/assets/IDVerseSDK.worker.min.js
echo "app/www now serves web-sdk's build output. Rebuild the SDK, then reload the page."
