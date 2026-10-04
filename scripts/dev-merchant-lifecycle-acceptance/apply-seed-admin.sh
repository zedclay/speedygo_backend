#!/usr/bin/env bash
# Apply synthetic merchant-lifecycle Admin seed to speedygo_dev only.
# Never called from Nest startup. Idempotent.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
HOST="${PGHOST:-127.0.0.1}"
PORT="${PGPORT:-5433}"
USER="${PGUSER:-speedygo}"
DB="${PGDATABASE:-speedygo_dev}"
export PGPASSWORD="${PGPASSWORD:-speedygo}"

if [[ "$DB" != "speedygo_dev" ]]; then
  echo "Refused: PGDATABASE must be speedygo_dev (got $DB)" >&2
  exit 2
fi

ACTUAL=$(psql -h "$HOST" -p "$PORT" -U "$USER" -d "$DB" -t -A -c "SELECT current_database();")
if [[ "$ACTUAL" != "speedygo_dev" ]]; then
  echo "Refused: connected database is '$ACTUAL', expected speedygo_dev" >&2
  exit 2
fi

# Safety: stop if phone exists on a different account id than the synthetic fixture.
EXISTING=$(psql -h "$HOST" -p "$PORT" -U "$USER" -d "$DB" -t -A -c \
  "SELECT id FROM accounts WHERE phone='+213550000099';")
EXPECTED='0d00c074-d000-7000-8000-000000000001'
if [[ -n "$EXISTING" && "$EXISTING" != "$EXPECTED" ]]; then
  echo "Refused: +213550000099 already belongs to account $EXISTING (not synthetic fixture)" >&2
  exit 3
fi

psql -h "$HOST" -p "$PORT" -U "$USER" -d "$DB" -v ON_ERROR_STOP=1 -f "$ROOT/seed-admin.sql"
echo "seed-admin.sql applied to speedygo_dev"
