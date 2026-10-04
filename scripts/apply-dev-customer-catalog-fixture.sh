#!/usr/bin/env bash
# Apply the synthetic Customer catalog fixture to isolated speedygo_dev only.
# Connection is hardcoded to 127.0.0.1:5433 / speedygo_dev.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
SQL="$ROOT/dev-customer-catalog-fixture.sql"
HOST="127.0.0.1"
PORT="5433"
DB="speedygo_dev"
USER="speedygo"
export PGPASSWORD="${PGPASSWORD:-speedygo}"

if [[ ! -f "$SQL" ]]; then
  echo "Missing $SQL" >&2
  exit 1
fi

if [[ "$PORT" != "5433" || "$DB" != "speedygo_dev" ]]; then
  echo "Refused: fixture helper is locked to 127.0.0.1:5433 / speedygo_dev" >&2
  exit 1
fi

PSQL=(psql --no-psqlrc -v ON_ERROR_STOP=1 -h "$HOST" -p "$PORT" -U "$USER" -d "$DB")
if ! command -v psql >/dev/null 2>&1; then
  PSQL=(docker exec -i -e PGPASSWORD="$PGPASSWORD" speedygo-postgres
    psql --no-psqlrc -v ON_ERROR_STOP=1 -U "$USER" -d "$DB")
  echo "psql not on PATH; using docker exec against container DB speedygo_dev (host mapped as ${HOST}:${PORT})"
else
  echo "Connecting to ${HOST}:${PORT}/${DB}"
fi

IDENTITY="$("${PSQL[@]}" -tAc "SELECT current_database() || '|' || inet_server_addr() || '|' || inet_server_port();")"
IDENTITY="${IDENTITY//[$'\t\r\n ']/}"
DB_NAME="${IDENTITY%%|*}"
if [[ "$DB_NAME" != "speedygo_dev" ]]; then
  echo "Refused: current_database() is '$DB_NAME', expected speedygo_dev" >&2
  exit 1
fi
if [[ "$DB_NAME" == "speedygo_test" ]]; then
  echo "Refused: speedygo_test is not a development fixture target" >&2
  exit 1
fi

echo "Verified database identity: $IDENTITY"
"${PSQL[@]}" -f "$SQL"

echo "Synthetic records (stable demo IDs):"
"${PSQL[@]}" -c "SELECT id, public_reference, name, status, verified_at IS NOT NULL AS verified FROM merchants WHERE id = '0d00c070-d000-7000-8000-000000000002';"
"${PSQL[@]}" -c "SELECT id, name, operational_status FROM merchant_branches WHERE id = '0d00c070-d000-7000-8000-000000000003';"
"${PSQL[@]}" -c "SELECT id, name, active FROM categories WHERE merchant_branch_id = '0d00c070-d000-7000-8000-000000000003' ORDER BY sort_order;"
"${PSQL[@]}" -c "SELECT id, name, price_minor, available FROM products WHERE merchant_branch_id = '0d00c070-d000-7000-8000-000000000003' ORDER BY name;"
"${PSQL[@]}" -c "SELECT id, name FROM product_option_groups WHERE product_id = '0d00c070-d000-7000-8000-000000000020';"
"${PSQL[@]}" -c "SELECT id, name, additional_price_minor FROM product_options WHERE option_group_id = '0d00c070-d000-7000-8000-000000000030' ORDER BY name;"
"${PSQL[@]}" -c "SELECT COUNT(*) AS opening_interval_days FROM merchant_branch_opening_intervals WHERE schedule_id = '0d00c070-d000-7000-8000-000000000004';"
"${PSQL[@]}" -c "SELECT id, phone, status FROM accounts WHERE id = '0d00c070-d000-7000-8000-000000000001';"
echo "Done. No CustomerProfile, orders, payments, or real-account memberships were created."
