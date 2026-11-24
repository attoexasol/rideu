#!/usr/bin/env bash
# DriveWize production deploy — pull images, backup DB, migrate, restart services.
# Never runs: docker compose down -v
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

ENV_FILE="${PRODUCTION_ENV_FILE:-.env.production}"
COMPOSE=(docker compose -f docker/compose.production.yml --env-file "$ENV_FILE")
LOCK_DIR="${DEPLOY_LOCK_DIR:-/tmp/drivewize-production-deploy.lock}"
BACKUP_DIR="${BACKUP_DIR:-$REPO_ROOT/backups/production}"
DEPLOYED_VERSIONS_FILE="${DEPLOYED_VERSIONS_FILE:-$REPO_ROOT/backups/production/DEPLOYED_IMAGES.txt}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: missing $ENV_FILE — copy docker/env/production.env.example and fill secrets."
  exit 1
fi

# shellcheck disable=SC1090
set -a
source "$ENV_FILE"
set +a

BACKEND_IMAGE="${BACKEND_IMAGE:?BACKEND_IMAGE must be set in $ENV_FILE}"
MIGRATE_IMAGE="${MIGRATE_IMAGE:-}"

if [[ -z "$MIGRATE_IMAGE" ]]; then
  case "$BACKEND_IMAGE" in
    *@*)
      echo "ERROR: MIGRATE_IMAGE must be set when BACKEND_IMAGE is a digest reference."
      exit 1
      ;;
    *-migrate)
      MIGRATE_IMAGE="$BACKEND_IMAGE"
      ;;
    *)
      MIGRATE_IMAGE="${BACKEND_IMAGE}-migrate"
      ;;
  esac
fi

export BACKEND_IMAGE MIGRATE_IMAGE

acquire_lock() {
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    echo "$$" >"$LOCK_DIR/pid"
    trap 'rm -rf "$LOCK_DIR"' EXIT
  else
    echo "ERROR: another production deploy is in progress (lock: $LOCK_DIR)"
    exit 1
  fi
}

pre_migration_backup() {
  mkdir -p "$BACKUP_DIR"
  local ts backup_file
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  backup_file="$BACKUP_DIR/ryd_u_pre_migrate_${ts}.dump"

  echo "==> Ensuring postgres is up for backup"
  "${COMPOSE[@]}" up -d postgres
  "${COMPOSE[@]}" exec -T postgres \
    pg_isready -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" >/dev/null

  local table_count
  table_count="$("${COMPOSE[@]}" exec -T postgres \
    psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -Atc \
    "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';" | tr -d '\r')"

  if [[ "${table_count:-0}" -gt 0 ]]; then
    echo "==> Pre-migration backup → $backup_file"
    "${COMPOSE[@]}" exec -T postgres \
      pg_dump -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -F c -b \
      >"$backup_file"
    echo "==> Backup complete ($(wc -c <"$backup_file") bytes)"
  else
    echo "==> Skipping backup (empty database)"
  fi
}

record_image() {
  mkdir -p "$(dirname "$DEPLOYED_VERSIONS_FILE")"
  local runtime_digest migrate_digest
  runtime_digest="$(docker image inspect --format '{{index .RepoDigests 0}}' "$BACKEND_IMAGE" 2>/dev/null || echo "digest-unavailable")"
  migrate_digest="$(docker image inspect --format '{{index .RepoDigests 0}}' "$MIGRATE_IMAGE" 2>/dev/null || echo "digest-unavailable")"
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) runtime=$BACKEND_IMAGE runtime_digest=$runtime_digest migrate=$MIGRATE_IMAGE migrate_digest=$migrate_digest" >>"$DEPLOYED_VERSIONS_FILE"
  echo "==> Recorded deploy: runtime=$BACKEND_IMAGE migrate=$MIGRATE_IMAGE"
}

https_check() {
  # Verifies the public certificate on the API host via loopback (no DNS/hairpin
  # dependency). Non-fatal: ACME issuance problems must not roll back a healthy backend.
  local host="${CADDY_SITE_ADDRESS:-}"
  case "$host" in
    "" | :*) echo "==> HTTPS check skipped (CADDY_SITE_ADDRESS is not a hostname)"; return 0 ;;
  esac
  local port="${CADDY_HTTPS_PORT:-443}"
  echo "==> HTTPS check https://$host/api/health"
  local i
  for i in $(seq 1 30); do
    if curl -fsS --max-time 10 --resolve "$host:$port:127.0.0.1" "https://$host:$port/api/health" >/dev/null 2>&1; then
      echo "==> HTTPS OK ($host)"
      return 0
    fi
    sleep 4
  done
  echo "WARNING: HTTPS check failed for $host — inspect: docker compose logs caddy | grep -i -E 'acme|tls|certificate'"
  return 0
}

health_check() {
  # HEALTHCHECK_URL defaults to the loopback-only :8081 site, which proxies
  # /api to the backend over plain HTTP regardless of certificate state.
  local url="${HEALTHCHECK_URL:-http://127.0.0.1:${CADDY_ADMIN_HTTP_PORT:-8081}/api/health}"
  echo "==> Health check $url"
  local i
  for i in $(seq 1 30); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo "==> Health OK"
      "${COMPOSE[@]}" ps
      return 0
    fi
    # Fallback: backend health inside the private network (Caddy not ready yet)
    if "${COMPOSE[@]}" exec -T backend \
      node -e "require('http').get('http://127.0.0.1:3000/api/health',(r)=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))" \
      >/dev/null 2>&1; then
      echo "==> Health OK (backend direct; Caddy edge may still be starting)"
      "${COMPOSE[@]}" ps
      return 0
    fi
    sleep 2
  done
  echo "ERROR: health check failed"
  "${COMPOSE[@]}" ps
  "${COMPOSE[@]}" logs --tail=80 backend caddy || true
  exit 1
}

main() {
  acquire_lock
  echo "==> Production deploy starting"
  echo "==> Runtime image: $BACKEND_IMAGE"
  echo "==> Migrate image: $MIGRATE_IMAGE"

  echo "==> Pulling images"
  "${COMPOSE[@]}" pull postgres redis caddy || true
  docker pull "$BACKEND_IMAGE"
  docker pull "$MIGRATE_IMAGE"

  pre_migration_backup

  echo "==> Starting postgres + redis"
  "${COMPOSE[@]}" up -d postgres redis

  echo "==> Running migrations (single job)"
  "${COMPOSE[@]}" --profile migrate run --rm --no-deps migrate

  echo "==> Starting backend + caddy"
  "${COMPOSE[@]}" up -d backend caddy

  # Caddyfile is a bind mount: content changes do not recreate the container.
  echo "==> Validating + reloading Caddy config"
  "${COMPOSE[@]}" exec -T caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
  "${COMPOSE[@]}" exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile \
    || "${COMPOSE[@]}" restart caddy

  record_image
  health_check
  https_check
  echo "==> Production deploy finished"
}

main "$@"
