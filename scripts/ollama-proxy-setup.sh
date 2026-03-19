#!/bin/bash
# Set up Ollama with an nginx auth proxy on any Linux VM.
# Ollama binds to 127.0.0.1:11434, nginx listens on 0.0.0.0:8080
# and requires a Bearer token before proxying requests.
#
# Usage:
#   ./ollama-proxy-setup.sh              # generates a random API key
#   ./ollama-proxy-setup.sh <api-key>    # uses the provided API key
#   OLLAMA_MODELS="gemma4:31b gemma3:27b" ./ollama-proxy-setup.sh
#
# After setup, use the endpoint:
#   http://<VM_IP>:8080/v1/chat/completions
set -euo pipefail

API_KEY="${1:-$(openssl rand -hex 24)}"
PROXY_PORT="${OLLAMA_PROXY_PORT:-8080}"
OLLAMA_PORT=11434
MODELS="${OLLAMA_MODELS:-gemma4:31b}"

echo "── Installing Ollama ─────────────────────────────────────────────"
if ! command -v ollama &>/dev/null; then
  curl -fsSL https://ollama.com/install.sh | sudo sh
fi

# Ensure Ollama only listens on localhost
sudo mkdir -p /etc/systemd/system/ollama.service.d
printf '[Service]\nEnvironment=OLLAMA_HOST=127.0.0.1:%s\n' "$OLLAMA_PORT" \
  | sudo tee /etc/systemd/system/ollama.service.d/override.conf >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable ollama
sudo systemctl restart ollama

# Wait for Ollama to be ready
echo -n "Waiting for Ollama..."
until curl -sf "http://localhost:$OLLAMA_PORT/api/tags" >/dev/null 2>&1; do
  sleep 2
  echo -n "."
done
echo " ready."

echo "── Pulling models ────────────────────────────────────────────────"
for MODEL in $MODELS; do
  echo "Pulling $MODEL..."
  ollama pull "$MODEL"
done

echo "── Configuring auth proxy ────────────────────────────────────────"

# Use a small Python auth proxy instead of nginx if/map (which are fragile
# across nginx versions). The proxy checks the Bearer token, then forwards
# to Ollama. nginx is only used as a simple reverse proxy to the Python app
# so we get systemd lifecycle management for free.

sudo tee /opt/ollama-auth-proxy.py >/dev/null <<'PYEOF'
"""Tiny auth-checking reverse proxy for Ollama. Runs behind nginx or standalone."""
import http.server
import urllib.request
import os
import sys

API_KEY = os.environ["OLLAMA_API_KEY"]
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")
PORT = int(os.environ.get("PROXY_PORT", "8080"))

class Handler(http.server.BaseHTTPRequestHandler):
    def do_request(self):
        # Health check — no auth
        if self.path == "/health":
            self._proxy("GET", f"{OLLAMA_URL}/api/tags", forward_body=False)
            return

        # All other paths require Bearer token
        auth = self.headers.get("Authorization", "")
        if auth != f"Bearer {API_KEY}":
            self.send_response(401)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"error": "unauthorized"}')
            return

        body = None
        content_length = self.headers.get("Content-Length")
        if content_length:
            body = self.rfile.read(int(content_length))

        self._proxy(self.command, f"{OLLAMA_URL}{self.path}", body=body)

    def _proxy(self, method, url, body=None, forward_body=True):
        headers = {}
        for key in ("Content-Type", "Accept"):
            if self.headers.get(key):
                headers[key] = self.headers[key]

        req = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=600) as resp:
                self.send_response(resp.status)
                for key, val in resp.getheaders():
                    if key.lower() not in ("transfer-encoding", "connection"):
                        self.send_header(key, val)
                self.end_headers()
                while True:
                    chunk = resp.read(65536)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
        except urllib.error.HTTPError as e:
            self.send_response(e.code)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(e.read())
        except Exception as e:
            self.send_response(502)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(f'{{"error": "proxy error: {e}"}}'.encode())

    def log_message(self, format, *args):
        sys.stderr.write(f"[ollama-proxy] {args[0]} {args[1]} {args[2]}\n")

    do_GET = do_POST = do_PUT = do_DELETE = do_PATCH = do_OPTIONS = do_request

if __name__ == "__main__":
    server = http.server.HTTPServer(("0.0.0.0", PORT), Handler)
    print(f"Ollama auth proxy listening on port {PORT}", flush=True)
    server.serve_forever()
PYEOF

# Systemd service for the auth proxy
sudo tee /etc/systemd/system/ollama-proxy.service >/dev/null <<SVCEOF
[Unit]
Description=Ollama Auth Proxy
After=network.target ollama.service

[Service]
Type=simple
Environment=OLLAMA_API_KEY=$API_KEY
Environment=OLLAMA_URL=http://127.0.0.1:$OLLAMA_PORT
Environment=PROXY_PORT=$PROXY_PORT
ExecStart=/usr/bin/python3 /opt/ollama-auth-proxy.py
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
SVCEOF

sudo systemctl daemon-reload
sudo systemctl enable ollama-proxy
sudo systemctl restart ollama-proxy

# Stop nginx if present (no longer needed, Python proxy handles everything)
if systemctl is-active nginx &>/dev/null; then
  sudo systemctl stop nginx
  sudo systemctl disable nginx
  sudo rm -f /etc/nginx/sites-enabled/ollama-proxy
fi

echo ""
echo "════════════════════════════════════════════════════════════════════"
echo "  Ollama proxy is running on port $PROXY_PORT"
echo ""
echo "  API Key: $API_KEY"
echo ""
echo "  Extraction settings in Lasagna:"
echo "    Endpoint: http://<VM_IP>:$PROXY_PORT/v1/chat/completions"
echo "    Model:    gemma4:31b"
echo "    API Key:  $API_KEY"
echo ""
echo "  Health check (no auth):"
echo "    curl http://<VM_IP>:$PROXY_PORT/health"
echo "════════════════════════════════════════════════════════════════════"
