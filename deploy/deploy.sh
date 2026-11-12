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
PLAYWRIGHT_DEPS=""
if command -v apt-get >/dev/null; then
  PLAYWRIGHT_DEPS="--with-deps"
fi

ensure_ffmpeg() {
  if { command -v ffmpeg && command -v ffprobe; } >/dev/null || { [ -x /usr/local/bin/ffmpeg ] && [ -x /usr/local/bin/ffprobe ]; }; then
    return 0
  fi
  if command -v apt-get >/dev/null; then
    DEBIAN_FRONTEND=noninteractive apt-get install -y ffmpeg && return 0
  fi
  local arch tmp
  case "$(uname -m)" in
    aarch64 | arm64) arch=linuxarm64 ;;
    *) arch=linux64 ;;
  esac
  tmp="$(mktemp -d)"
  if curl -fsSL "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-$arch-gpl.tar.xz" -o "$tmp/ffmpeg.tar.xz" &&
    tar -xJf "$tmp/ffmpeg.tar.xz" -C "$tmp" --strip-components=2 --wildcards '*/bin/ffmpeg' '*/bin/ffprobe'; then
    install -m 755 "$tmp/ffmpeg" "$tmp/ffprobe" /usr/local/bin/
    if command -v restorecon >/dev/null; then
      restorecon /usr/local/bin/ffmpeg /usr/local/bin/ffprobe || true
    fi
  else
    echo "No pude instalar ffmpeg. Los reels no se exportarán hasta instalarlo." >&2
  fi
  rm -rf "$tmp"
}

ensure_build_tools() {
  if command -v cmake >/dev/null && command -v c++ >/dev/null && command -v make >/dev/null; then
    return 0
  fi
  if command -v apt-get >/dev/null; then
    DEBIAN_FRONTEND=noninteractive apt-get install -y cmake g++ make
  elif command -v dnf >/dev/null; then
    dnf install -y cmake gcc-c++ make
  fi || echo "No pude instalar cmake y el compilador. La transcripción de videos no funcionará." >&2
}

as_app() {
  runuser -u "$APP_USER" -- env HOME="$APP_HOME" "$@"
}

build() {
  as_app npm --prefix "$APP_DIR" ci --ignore-scripts || return 1
  as_app npm --prefix "$APP_DIR" run build || return 1
  PLAYWRIGHT_BROWSERS_PATH="$BROWSERS" "$PLAYWRIGHT_CLI" install $PLAYWRIGHT_DEPS chromium || return 1
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
  if [ -f "$APP_DIR/deploy/$SERVICE.service" ]; then
    install -m 644 "$APP_DIR/deploy/$SERVICE.service" "/etc/systemd/system/$SERVICE.service"
    systemctl daemon-reload
  fi
  systemctl restart "$SERVICE" || return 1
  healthy
}

ensure_ffmpeg
ensure_build_tools

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
