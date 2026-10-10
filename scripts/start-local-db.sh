#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
CONTAINER=golive-local-postgres

if ! command -v docker >/dev/null 2>&1; then
  printf '%s\n' 'Docker is required to start the local database.' >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  printf '%s\n' 'Docker is not running. Start Docker and try again.' >&2
  exit 1
fi

if docker container inspect "$CONTAINER" >/dev/null 2>&1; then
  docker start "$CONTAINER" >/dev/null
else
  docker run --detach \
    --name "$CONTAINER" \
    --publish 5432:5432 \
    --env POSTGRES_DB=golive \
    --env POSTGRES_USER=golive \
    --env POSTGRES_PASSWORD=golive \
    --volume golive-local-postgres-data:/var/lib/postgresql/data \
    --volume "$ROOT_DIR/server/db/migrations:/docker-entrypoint-initdb.d:ro" \
    postgres:16-alpine >/dev/null
fi

attempts=30
until docker exec "$CONTAINER" pg_isready -U golive -d golive >/dev/null 2>&1; do
  if [ "$attempts" -eq 0 ]; then
    printf '%s\n' 'PostgreSQL did not become ready. Container logs:' >&2
    docker logs "$CONTAINER" >&2
    exit 1
  fi
  attempts=$((attempts - 1))
  sleep 1
done

# The image runs migrations on first initialization. Reapplying them is safe
# and also applies newly added migrations when reusing an existing local volume.
for migration in "$ROOT_DIR"/server/db/migrations/*.sql; do
  migration_name=${migration##*/}
  docker exec --env PGPASSWORD=golive "$CONTAINER" \
    psql --host=127.0.0.1 --username=golive --dbname=golive \
    --set ON_ERROR_STOP=1 \
    --file="/docker-entrypoint-initdb.d/$migration_name"
done

printf '%s\n' 'Local PostgreSQL is ready at postgres://golive:golive@localhost:5432/golive'
