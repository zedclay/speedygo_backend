#!/usr/bin/env bash
# Apply the synthetic review catalog to isolated speedygo_dev only.
# Connection is hardcoded to 127.0.0.1:5433 / speedygo_dev.
# Idempotent. Does not DELETE or UPDATE rows outside 0d00c071-d000-7000-8000-*.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
HOST="127.0.0.1"
PORT="5433"
DB="speedygo_dev"

if [[ "$PORT" != "5433" || "$DB" != "speedygo_dev" ]]; then
  echo "Refused: fixture helper is locked to 127.0.0.1:5433 / speedygo_dev" >&2
  exit 1
fi

export SPEEDYGO_FIXTURE_PGHOST="$HOST"
export SPEEDYGO_FIXTURE_PGPORT="$PORT"
export SPEEDYGO_FIXTURE_PGDATABASE="$DB"
export SPEEDYGO_FIXTURE_PGUSER="${SPEEDYGO_FIXTURE_PGUSER:-speedygo}"
export PGPASSWORD="${PGPASSWORD:-speedygo}"
export SPEEDYGO_FIXTURE_API="${SPEEDYGO_FIXTURE_API:-http://127.0.0.1:3000/api/v1}"

echo "Connecting to ${HOST}:${PORT}/${DB}"
exec node "$ROOT/apply.mjs"
