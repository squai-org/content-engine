#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/content-engine}"
APP_USER="${APP_USER:-contenido}"
APP_HOME="${APP_HOME:-/var/lib/content-engine/home}"
SERVICE="${SERVICE:-content-engine}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:8787/api/health}"
BRANCH="${BRANCH:-main}"
BROWSERS="${PLAYWRIGHT_BROWSERS_PATH:-/opt/ms-playwright}"
PLAYWRIGHT_CLI="${PLAYWRIGHT_CLI:-$APP_DIR/node_modules/.bin/playwright-core}"
TARGET="${1:-origin/$BRANCH}"

as_app() {
  runuser -u "$APP_USER" -- env HOME="$APP_HOME" "$@"
}

build() {
  as_app npm --prefix "$APP_DIR" ci --ignore-scripts || return 1
  as_app npm --prefix "$APP_DIR" run build || return 1
  PLAYWRIGHT_BROWSERS_PATH="$BROWSERS" "$PLAYWRIGHT_CLI" install --with-deps chromium || return 1
}

healthy() {
  for _ in $(seq 1 30); do
    if curl -fsS --max-time 3 "$HEALTH_URL" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

activate() {
  systemctl restart "$SERVICE" || return 1
  healthy
}

previous="$(as_app git -C "$APP_DIR" rev-parse HEAD)"
as_app git -C "$APP_DIR" fetch --prune origin
as_app git -C "$APP_DIR" checkout --detach "$TARGET"
current="$(as_app git -C "$APP_DIR" rev-parse HEAD)"

if build && activate; then
  echo "Desplegado ${current:0:9}"
  exit 0
fi

echo "Falló ${current:0:9}. Vuelvo a ${previous:0:9}." >&2
as_app git -C "$APP_DIR" checkout --detach "$previous"
build || true
activate || echo "La versión anterior tampoco responde. Revisa: journalctl -u $SERVICE" >&2
exit 1
