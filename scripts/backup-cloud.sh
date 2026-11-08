#!/bin/sh
set -eu

cd "$(dirname "$0")/.."
mkdir -p backups
stamp=$(date -u +%Y%m%dT%H%M%SZ)
daily="daily-${stamp}.tar.gz"

docker compose stop app
trap 'docker compose start app' EXIT
trap 'exit 1' INT TERM
docker compose run --rm --no-deps --user root \
  -v "$PWD/backups:/backup" \
  --entrypoint sh app \
  -c 'tar -czf "/backup/$1" -C /data . && sha256sum "/backup/$1" > "/backup/$1.sha256"' sh "$daily"

if [ "$(date -u +%u)" = "7" ]; then
  cp "backups/$daily" "backups/weekly-${stamp}.tar.gz"
  cp "backups/$daily.sha256" "backups/weekly-${stamp}.tar.gz.sha256"
fi

find "$PWD/backups" -type f -name 'daily-*' -mtime +7 -delete
find "$PWD/backups" -type f -name 'weekly-*' -mtime +28 -delete
