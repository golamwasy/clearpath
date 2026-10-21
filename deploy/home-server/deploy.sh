#!/usr/bin/env bash
# Runs on the home server every minute (cron). Pulls the application images GitHub built
# (CI only publishes them after every test and the vulnerability scan passed) and, only when
# one changed, restarts the stack with `up -d`. Reference copy; the server runs its own copy
# in ~/deploy/clearpath next to its own docker-compose.yml.
#
# Only the seven application images are pulled. postgres, redis, mongo and kafka are never
# pulled here, so a new upstream tag cannot recreate a database by surprise.
set -euo pipefail

cd "$(dirname "$0")"
exec 9>.deploy.lock
flock -n 9 || exit 0

APPS=(menu-service availability-service trace-collector pos-ingest merchant-web nested-pos flat-pos)
ids() { for a in "${APPS[@]}"; do docker image inspect -f '{{.Id}}' "ghcr.io/golamwasy/$a:latest" 2>/dev/null || echo none; done; }

before="$(ids)"
docker compose pull --quiet "${APPS[@]}" >/dev/null 2>&1 || { echo "$(date -Is) pull failed"; exit 1; }
after="$(ids)"

# Also recover when containers are missing (for example after a reboot wiped them).
running="$(docker compose ps --status running --services | wc -l)"
if [ "$before" = "$after" ] && [ "$running" -ge 11 ] && [ "${1:-}" != "--force" ]; then
  exit 0
fi

echo "$(date -Is) deploying"
docker compose up -d --no-build
echo "$(date -Is) done"
