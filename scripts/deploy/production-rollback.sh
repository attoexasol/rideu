#!/usr/bin/env bash
# Roll back production backend to a previous runtime (+ matching migrate) image.
# Does NOT reverse database migrations. Restore a .dump if schema is incompatible.
# Never runs: docker compose down -v
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

ENV_FILE="${PRODUCTION_ENV_FILE:-.env.production}"
COMPOSE=(docker compose -f docker/compose.production.yml --env-file "$ENV_FILE")
LOCK_DIR="${DEPLOY_LOCK_DIR:-/tmp/drivewize-production-deploy.lock}"
DEPLOYED_VERSIONS_FILE="${DEPLOYED_VERSIONS_FILE:-$REPO_ROOT/backups/production/DEPLOYED_IMAGES.txt}"

PREVIOUS_RUNTIME="${1:-}"
PREVIOUS_MIGRATE="${2:-}"

if [[ -z "$PREVIOUS_RUNTIME" ]]; then
  echo "Usage: $0 <previous-runtime-image-ref> [previous-migrate-image-ref]"
  echo "Recent deploys:"
  tail -n 20 "$DEPLOYED_VERSIONS_FILE" 2>/dev/null || echo "(no history yet)"
  exit 1
fi

if [[ -z "$PREVIOUS_MIGRATE" ]]; then
  case "$PREVIOUS_RUNTIME" in
    *@*)
      echo "ERROR: pass migrate digest/ref as second argument when runtime is a digest."
      exit 1
      ;;
    *)
      PREVIOUS_MIGRATE="${PREVIOUS_RUNTIME}-migrate"
      ;;
  esac
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: missing $ENV_FILE"
  exit 1
fi

# shellcheck disable=SC1090
set -a
source "$ENV_FILE"
set +a

if mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "$$" >"$LOCK_DIR/pid"
  trap 'rm -rf "$LOCK_DIR"' EXIT
else
  echo "ERROR: another deploy/rollback holds $LOCK_DIR"
  exit 1
fi

echo "==> Rolling back runtime to $PREVIOUS_RUNTIME"
echo "==> Rolling back migrate ref to $PREVIOUS_MIGRATE"
echo "==> NOTE: DB migrations are NOT reversed automatically."

docker pull "$PREVIOUS_RUNTIME"
docker pull "$PREVIOUS_MIGRATE"
export BACKEND_IMAGE="$PREVIOUS_RUNTIME"
export MIGRATE_IMAGE="$PREVIOUS_MIGRATE"

grep -q '^BACKEND_IMAGE=' "$ENV_FILE" && \
  sed -i.bak "s|^BACKEND_IMAGE=.*|BACKEND_IMAGE=${PREVIOUS_RUNTIME}|" "$ENV_FILE" || \
  echo "BACKEND_IMAGE=${PREVIOUS_RUNTIME}" >>"$ENV_FILE"
grep -q '^MIGRATE_IMAGE=' "$ENV_FILE" && \
  sed -i.bak "s|^MIGRATE_IMAGE=.*|MIGRATE_IMAGE=${PREVIOUS_MIGRATE}|" "$ENV_FILE" || \
  echo "MIGRATE_IMAGE=${PREVIOUS_MIGRATE}" >>"$ENV_FILE"
rm -f "${ENV_FILE}.bak"

"${COMPOSE[@]}" up -d --no-deps backend

ok=0
for i in $(seq 1 30); do
  if "${COMPOSE[@]}" exec -T backend \
    node -e "require('http').get('http://127.0.0.1:3000/api/health',(r)=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"; then
    ok=1
    break
  fi
  sleep 2
done

if [[ "$ok" -ne 1 ]]; then
  echo "ERROR: rollback health check failed"
  "${COMPOSE[@]}" logs --tail=80 backend || true
  exit 1
fi

mkdir -p "$(dirname "$DEPLOYED_VERSIONS_FILE")"
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) ROLLBACK runtime=$PREVIOUS_RUNTIME migrate=$PREVIOUS_MIGRATE" >>"$DEPLOYED_VERSIONS_FILE"
echo "==> Rollback complete"
"${COMPOSE[@]}" ps
