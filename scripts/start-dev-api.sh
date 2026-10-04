#!/usr/bin/env bash
# Interactive speedygo_dev API launcher.
# Sets a persistent private STORAGE_LOCAL_ROOT so catalog/media objects
# survive /tmp cleanup. This is development persistence only — not a
# production backup and not used by E2E (see test/setup-e2e-env.ts).
#
# Usage (from apps/backend):
#   bash scripts/start-dev-api.sh
#   pnpm start:dev
#
# Override: SPEEDYGO_DEV_STORAGE_ROOT=/absolute/private/dir
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STORAGE="${SPEEDYGO_DEV_STORAGE_ROOT:-$HOME/.speedygo/dev/storage}"

if [[ "$STORAGE" != /* ]]; then
  echo "Refused: SPEEDYGO_DEV_STORAGE_ROOT must be an absolute path" >&2
  exit 1
fi
case "$STORAGE" in
  /tmp/*|/var/tmp/*)
    echo "Refused: interactive speedygo_dev storage must not live under /tmp" >&2
    exit 1
    ;;
esac

mkdir -p "$HOME/.speedygo" "$HOME/.speedygo/dev" "$STORAGE"
chmod 700 "$HOME/.speedygo" "$HOME/.speedygo/dev" "$STORAGE"

export STORAGE_LOCAL_ROOT="$STORAGE"
echo "Development API storage: $STORAGE_LOCAL_ROOT"
echo "(Persistent for local speedygo_dev only. Not a production backup. E2E uses an isolated temp root.)"

cd "$ROOT"
exec pnpm exec nest start --watch "$@"
