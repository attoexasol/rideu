#!/bin/sh
# Fix ownership of bind/named volumes then drop privileges to nodejs.
set -eu

mkdir -p /app/private-media /app/uploads
chown -R nodejs:nodejs /app/private-media /app/uploads 2>/dev/null || true

# If already non-root (e.g. overridden), just exec
if [ "$(id -u)" -ne 0 ]; then
  exec tini -- "$@"
fi

exec tini -- gosu nodejs "$@"
