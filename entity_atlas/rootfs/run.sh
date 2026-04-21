#!/usr/bin/with-contenv bashio

set -e

echo "[entity-atlas] starting…"
exec python3 -u /app/server.py
