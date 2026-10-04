#!/usr/bin/env bash
# Apply synthetic Checkout zone/pricing fixtures to isolated speedygo_dev only.
# Connection is hardcoded to 127.0.0.1:5433 / speedygo_dev.
# Creates zone/rule via permissioned Admin API (audited). Idempotent by name.
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
export SPEEDYGO_DEV_OTP_FILE="${SPEEDYGO_DEV_OTP_FILE:-$HOME/.speedygo/dev/otp-last}"
export SPEEDYGO_FIXTURE_REPORT_DIR="${SPEEDYGO_FIXTURE_REPORT_DIR:-$ROOT/../../../../.cache/fixture-reports}"

echo "Connecting to ${HOST}:${PORT}/${DB}"
echo "API ${SPEEDYGO_FIXTURE_API}"
# Companion commission (Order create only; preview does not need it).
if command -v psql >/dev/null 2>&1; then
  PGPASSWORD="$PGPASSWORD" psql --no-psqlrc -v ON_ERROR_STOP=1 \
    -h "$HOST" -p "$PORT" -U "${SPEEDYGO_FIXTURE_PGUSER}" -d "$DB" \
    -f "$ROOT/seed-commission-companion.sql"
fi
exec node "$ROOT/apply.mjs"
