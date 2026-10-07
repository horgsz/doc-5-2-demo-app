#!/usr/bin/env bash
# Starts the local IDVerse Web SDK demo on one port: the test page, the mock
# session API, both engines (5.2 at /wasm, 6.0 at /wasm6) and their on-demand data.
#
#   ./start.sh               HTTPS on port 8443 (self-signed certificate, made on first run)
#   ./start.sh --http        plain HTTP -- the camera then works on http://localhost only
#   PORT=9000 ./start.sh     another port
#
# Your own certificate (e.g. from mkcert, see README) in app/cert.pem + app/key.pem
# is used as it is and never replaced.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="$HERE/app"
PORT="${PORT:-8443}"
HTTP=0
if [ "${1:-}" = "--http" ]; then HTTP=1; fi

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "error: '$1' is not installed -- $2" >&2
    exit 1
  fi
}

need node "install Node 20 (https://nodejs.org, or: nvm install 20)"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "error: Node $(node -v) is too old -- use Node 20 (nvm use 20)" >&2
  exit 1
fi

# The server's own dependencies (express etc.), once.
if [ ! -d "$APP/node_modules" ]; then
  echo "==> Installing the server's dependencies (once)"
  (cd "$APP" && npm ci --no-audit --no-fund)
fi

# This machine's address on the local network, for testing from a phone.
lan_ip() {
  local ip=""
  if command -v ipconfig >/dev/null 2>&1; then # macOS
    for i in en0 en1 en2 en3; do
      ip="$(ipconfig getifaddr "$i" 2>/dev/null || true)"
      if [ -n "$ip" ]; then break; fi
    done
  fi
  if [ -z "$ip" ] && hostname -I >/dev/null 2>&1; then # Linux
    ip="$(hostname -I | awk '{print $1}')"
  fi
  echo "$ip"
}
LAN="$(lan_ip)"

if [ "$HTTP" -eq 1 ]; then
  export NO_TLS=1
  SCHEME=http
else
  SCHEME=https
  CERT="$APP/cert.pem"
  KEY="$APP/key.pem"
  MARK="$APP/.cert-made-by-start-sh"
  # Make the certificate when there is none, or when the one this script made
  # has expired or does not name this machine's current LAN address.
  remake=0
  if [ ! -f "$CERT" ] || [ ! -f "$KEY" ]; then
    remake=1
  elif [ -f "$MARK" ]; then
    if ! openssl x509 -checkend 86400 -noout -in "$CERT" >/dev/null 2>&1; then remake=1; fi
    if [ -n "$LAN" ] && ! openssl x509 -noout -text -in "$CERT" | grep -q "IP Address:$LAN"; then remake=1; fi
  fi
  if [ "$remake" -eq 1 ]; then
    need openssl "it makes the local HTTPS certificate"
    echo "==> Making a self-signed certificate for localhost${LAN:+ and $LAN}"
    CNF="$(mktemp)"
    {
      echo "[req]"
      echo "distinguished_name = dn"
      echo "x509_extensions = v3"
      echo "prompt = no"
      echo "[dn]"
      echo "CN = localhost"
      echo "[v3]"
      echo "basicConstraints = CA:FALSE"
      echo "keyUsage = digitalSignature, keyEncipherment"
      echo "extendedKeyUsage = serverAuth"
      echo "subjectAltName = @alt"
      echo "[alt]"
      echo "DNS.1 = localhost"
      echo "IP.1 = 127.0.0.1"
      if [ -n "$LAN" ]; then echo "IP.2 = $LAN"; fi
    } >"$CNF"
    openssl req -x509 -newkey rsa:2048 -nodes -days 365 -keyout "$KEY" -out "$CERT" -config "$CNF" 2>/dev/null
    rm -f "$CNF"
    touch "$MARK"
  fi
fi

echo
echo "==> Open   $SCHEME://localhost:$PORT"
if [ -n "$LAN" ]; then
  echo "    Phone  $SCHEME://$LAN:$PORT   (same Wi-Fi; accept the certificate warning)"
fi
echo "    Ctrl+C stops the server."
echo
cd "$APP"
PORT="$PORT" exec node server.js
