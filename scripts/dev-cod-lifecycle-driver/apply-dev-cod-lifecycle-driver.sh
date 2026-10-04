#!/usr/bin/env bash
# Apply synthetic COD-lifecycle driver fixture on speedygo_dev only.
# Creates/reuses ONE development driver via supported HTTP APIs + verifier admin seed.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
HOST="${SPEEDYGO_PG_HOST:-127.0.0.1}"
PORT="${SPEEDYGO_PG_PORT:-5433}"
DB="${SPEEDYGO_PG_DB:-speedygo_dev}"
USER="${SPEEDYGO_PG_USER:-speedygo}"
PASS="${SPEEDYGO_PG_PASSWORD:-speedygo}"
API="${SPEEDYGO_API:-http://127.0.0.1:3000/api/v1}"
OTP_FILE="${SPEEDYGO_DEV_OTP_FILE:-$HOME/.speedygo/dev/otp-last}"
REPORT_DIR="${ROOT}/../../../.cache/fixture-reports"
REPORT_JSON="${REPORT_DIR}/dev-cod-lifecycle-driver-last.json"
MANIFEST="${ROOT}/FIXTURE_MANIFEST.json"

DRIVER_PHONE="+213550000073"
ADMIN_PHONE="+213550000098"
DRIVER_LOCAL="550000073"
ADMIN_LOCAL="550000098"

if [[ "$PORT" != "5433" || "$DB" != "speedygo_dev" ]]; then
  echo "Refused: fixture locked to 127.0.0.1:5433 / speedygo_dev" >&2
  exit 1
fi

export PGPASSWORD="$PASS"
CUR=$(psql -h "$HOST" -p "$PORT" -U "$USER" -d "$DB" -Atc "SELECT current_database();")
if [[ "$CUR" != "speedygo_dev" ]]; then
  echo "Refused: connected to $CUR" >&2
  exit 1
fi

echo "== seed verifier admin =="
psql -h "$HOST" -p "$PORT" -U "$USER" -d "$DB" -v ON_ERROR_STOP=1 -f "$ROOT/seed-admin.sql"

auth() {
  local local_phone="$1"
  rm -f "$OTP_FILE"
  curl -sS -m 20 -X POST "$API/auth/otp/request" \
    -H 'Content-Type: application/json' \
    -d "{\"channel\":\"PHONE\",\"identifier\":\"${local_phone}\",\"purpose\":\"AUTHENTICATE\"}" >/dev/null
  local code=""
  for _ in $(seq 1 40); do
    if [[ -f "$OTP_FILE" ]]; then
      code="$(tr -d '[:space:]' < "$OTP_FILE")"
      if [[ ${#code} -eq 6 ]]; then
        break
      fi
    fi
    sleep 0.25
  done
  if [[ ${#code} -ne 6 ]]; then
    echo "OTP capture failed for $local_phone" >&2
    exit 1
  fi
  curl -sS -m 20 -X POST "$API/auth/otp/verify" \
    -H 'Content-Type: application/json' \
    -d "{\"channel\":\"PHONE\",\"identifier\":\"${local_phone}\",\"purpose\":\"AUTHENTICATE\",\"code\":\"${code}\",\"platform\":\"android\",\"appVersion\":\"1.0.0\",\"deviceName\":\"cod-lifecycle-fixture\"}" \
    | python3 -c 'import sys,json; print(json.load(sys.stdin)["accessToken"])'
}

echo "== auth driver =="
DRIVER_TOKEN="$(auth "$DRIVER_LOCAL")"
echo "== auth admin =="
ADMIN_TOKEN="$(auth "$ADMIN_LOCAL")"

# Invalidate permission cache by... just proceed; PermissionService may cache — logout/login already fresh session.

me_driver=$(curl -sS -m 20 "$API/driver/me" -H "Authorization: Bearer $DRIVER_TOKEN")
exists=$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("driverProfileExists"))' <<<"$me_driver")

if [[ "$exists" != "True" && "$exists" != "true" ]]; then
  echo "== create driver profile =="
  curl -sS -m 20 -X POST "$API/driver/profile" \
    -H "Authorization: Bearer $DRIVER_TOKEN" \
    -H 'Content-Type: application/json' \
    -d '{"fullName":"SpeedyGo Dev COD Driver"}' | tee /tmp/cod_drv_profile.json | python3 -c 'import json,sys; b=json.load(sys.stdin); assert "id" in b or "verificationStatus" in b, b'
  echo "== documents + vehicle =="
  curl -sS -m 20 -X PUT "$API/driver/documents/IDENTITY" \
    -H "Authorization: Bearer $DRIVER_TOKEN" \
    -H 'Content-Type: application/json' \
    -d '{}' >/dev/null
  curl -sS -m 20 -X PUT "$API/driver/documents/DRIVING_LICENSE" \
    -H "Authorization: Bearer $DRIVER_TOKEN" \
    -H 'Content-Type: application/json' \
    -d '{"expiryDate":"2099-12-31"}' >/dev/null
  curl -sS -m 20 -X POST "$API/driver/vehicles" \
    -H "Authorization: Bearer $DRIVER_TOKEN" \
    -H 'Content-Type: application/json' \
    -d '{"type":"MOTORCYCLE","plateNumber":"SG-COD-073","model":"Synth NMAX","color":"White"}' \
    | tee /tmp/cod_drv_vehicle.json >/dev/null
  echo "== submit verification =="
  submit=$(curl -sS -m 20 -w '\n%{http_code}' -X POST "$API/driver/verification/submit" \
    -H "Authorization: Bearer $DRIVER_TOKEN" \
    -H 'Content-Type: application/json' \
    -d '{}')
  body="${submit%$'\n'*}"
  code="${submit##*$'\n'}"
  echo "$body" > /tmp/cod_drv_submit.json
  if [[ "$code" != "200" ]]; then
    echo "submit failed HTTP $code: $body" >&2
    exit 1
  fi
else
  echo "== driver profile already exists; reuse =="
  echo "$me_driver" > /tmp/cod_drv_submit.json
fi

DRIVER_ID=$(python3 - <<'PY'
import json
for path in ("/tmp/cod_drv_submit.json",):
    b=json.load(open(path))
    p=b.get("profile") or b
    if isinstance(p, dict) and p.get("id"):
        print(p["id"]); raise SystemExit
    if b.get("id") and b.get("verificationStatus"):
        print(b["id"]); raise SystemExit
raise SystemExit("driver id missing")
PY
)

STATUS=$(python3 - <<PY
import json
b=json.load(open("/tmp/cod_drv_submit.json"))
p=b.get("profile") or b
print(p.get("verificationStatus") or "")
PY
)

if [[ "$STATUS" != "APPROVED" ]]; then
  echo "== admin approve $DRIVER_ID =="
  # If still UNVERIFIED, ensure submit
  if [[ "$STATUS" == "UNVERIFIED" || -z "$STATUS" ]]; then
    curl -sS -m 20 -X POST "$API/driver/verification/submit" \
      -H "Authorization: Bearer $DRIVER_TOKEN" \
      -H 'Content-Type: application/json' -d '{}' >/dev/null || true
  fi
  approve=$(curl -sS -m 20 -w '\n%{http_code}' -X POST "$API/admin/drivers/${DRIVER_ID}/verification/approve" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H 'Content-Type: application/json' \
    -d '{}')
  abody="${approve%$'\n'*}"
  acode="${approve##*$'\n'}"
  echo "$abody" > /tmp/cod_drv_approve.json
  if [[ "$acode" != "200" && "$acode" != "201" ]]; then
    echo "approve failed HTTP $acode: $abody" >&2
    exit 1
  fi
else
  echo "== already APPROVED =="
fi

ACCOUNT_ID=$(curl -sS -m 20 "$API/auth/me" -H "Authorization: Bearer $DRIVER_TOKEN" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["account"]["id"])')
FINAL=$(curl -sS -m 20 "$API/driver/me" -H "Authorization: Bearer $DRIVER_TOKEN")
echo "$FINAL" > /tmp/cod_drv_me.json

mkdir -p "$REPORT_DIR"
python3 - <<PY
import json, datetime
from pathlib import Path
me=json.load(open("/tmp/cod_drv_me.json"))
profile=me.get("profile") or {}
report={
  "appliedAt": datetime.datetime.utcnow().isoformat()+"Z",
  "database": "speedygo_dev",
  "driver": {
    "phone": "$DRIVER_PHONE",
    "accountId": "$ACCOUNT_ID",
    "driverProfileId": profile.get("id"),
    "verificationStatus": profile.get("verificationStatus"),
    "operationalReady": me.get("operationalReady"),
    "matchingEligible": me.get("matchingEligible"),
  },
  "verifierAdmin": {
    "phone": "$ADMIN_PHONE",
    "accountId": "0d00c073-d000-7000-8000-000000000001",
  },
  "manifest": str(Path("$MANIFEST")),
}
Path("$REPORT_JSON").write_text(json.dumps(report, indent=2)+"\n")
print(json.dumps(report, indent=2))
PY

# logout sessions (best-effort) so tokens are not left shared
curl -sS -m 10 -X POST "$API/auth/logout" -H "Authorization: Bearer $DRIVER_TOKEN" >/dev/null || true
curl -sS -m 10 -X POST "$API/auth/logout" -H "Authorization: Bearer $ADMIN_TOKEN" >/dev/null || true

echo "OK: fixture report $REPORT_JSON"
