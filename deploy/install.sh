#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${1:?Uso: sudo bash install.sh dominio.ejemplo.com}"
REPO="${REPO:-https://github.com/squai-org/content-engine.git}"
BRANCH="${BRANCH:-main}"
APP_USER=contenido
APP_DIR=/opt/content-engine
DATA_DIR=/var/lib/content-engine
CONF_DIR=/etc/content-engine
ENV_FILE=/etc/content-engine.env
KEY="$CONF_DIR/deploy_key"
SSH_CMD="ssh -i $KEY -o IdentitiesOnly=yes -o UserKnownHostsFile=$CONF_DIR/known_hosts -o StrictHostKeyChecking=accept-new"

if [ "$(id -u)" -ne 0 ]; then
  echo "Ejecuta con sudo." >&2
  exit 1
fi

. /etc/os-release
case " ${ID:-} ${ID_LIKE:-} " in
  *" ol "* | *" rhel "* | *" fedora "* | *" centos "*) FAMILY=rhel ;;
  *" debian "* | *" ubuntu "*) FAMILY=debian ;;
  *)
    echo "Sistema no soportado: ${PRETTY_NAME:-desconocido}" >&2
    exit 1
    ;;
esac

case "$(uname -m)" in
  aarch64 | arm64) CADDY_ARCH=arm64 ;;
  x86_64) CADDY_ARCH=amd64 ;;
  *)
    echo "Arquitectura no soportada: $(uname -m)" >&2
    exit 1
    ;;
esac

install_packages() {
  if [ "$FAMILY" = rhel ]; then
    dnf install -y ca-certificates curl git openssl sqlite tar unzip fontconfig
    dnf install -y --skip-broken nss nspr atk at-spi2-atk cups-libs libdrm libxkbcommon \
      libXcomposite libXdamage libXfixes libXrandr libXext libX11 libxcb mesa-libgbm \
      pango cairo alsa-lib
  else
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -y
    apt-get install -y ca-certificates curl git openssl sqlite3 fonts-inter
  fi
}

node_ok() {
  command -v node >/dev/null && node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)'
}

install_node() {
  if [ "$FAMILY" = rhel ]; then
    curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
    dnf install -y nodejs
  else
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
  fi
}

install_inter() {
  if fc-list | grep -qi 'Inter'; then
    return 0
  fi
  local tmp
  tmp="$(mktemp -d)"
  if curl -fsSL https://github.com/rsms/inter/releases/download/v4.0/Inter-4.0.zip -o "$tmp/inter.zip" && unzip -q "$tmp/inter.zip" -d "$tmp/inter"; then
    mkdir -p /usr/local/share/fonts/inter
    find "$tmp/inter" -iname 'Inter*.otf' -not -iname '*Display*' -exec cp {} /usr/local/share/fonts/inter/ \;
    fc-cache -f
  else
    echo "No pude instalar la fuente Inter. Las láminas usarán otra tipografía." >&2
  fi
  rm -rf "$tmp"
}

install_caddy() {
  if [ ! -x /usr/local/bin/caddy ]; then
    curl -fsSL "https://caddyserver.com/api/download?os=linux&arch=$CADDY_ARCH" -o /usr/local/bin/caddy
    chmod 755 /usr/local/bin/caddy
    if command -v restorecon >/dev/null; then
      restorecon /usr/local/bin/caddy || true
    fi
  fi
  if ! id caddy >/dev/null 2>&1; then
    useradd --system --home-dir /var/lib/caddy --create-home --shell /usr/sbin/nologin caddy
  fi
  mkdir -p /etc/caddy
}

open_firewall() {
  if command -v firewall-cmd >/dev/null && systemctl is-active --quiet firewalld; then
    firewall-cmd --permanent --add-service=http --add-service=https
    firewall-cmd --reload
  fi
}

install_packages
if ! node_ok; then
  install_node
fi
if [ "$FAMILY" = rhel ]; then
  install_inter
fi
install_caddy
open_firewall

if ! command -v claude >/dev/null; then
  npm install -g @anthropic-ai/claude-code
fi

if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd --system --home-dir "$DATA_DIR/home" --create-home --shell /usr/sbin/nologin "$APP_USER"
fi
mkdir -p "$DATA_DIR" "$CONF_DIR" "$APP_DIR"
chown -R "$APP_USER:$APP_USER" "$DATA_DIR" "$APP_DIR"
chown root:"$APP_USER" "$CONF_DIR"
chmod 750 "$CONF_DIR"

CLONE_ARGS=()
case "$REPO" in
  git@*)
    if [ ! -f "$KEY" ]; then
      ssh-keygen -t ed25519 -N '' -C content-engine-deploy -f "$KEY" >/dev/null
    fi
    touch "$CONF_DIR/known_hosts"
    chown "$APP_USER:$APP_USER" "$KEY" "$CONF_DIR/known_hosts"
    chmod 600 "$KEY" "$CONF_DIR/known_hosts"
    CLONE_ARGS=(-c "core.sshCommand=$SSH_CMD")
    ;;
esac

if [ ! -d "$APP_DIR/.git" ]; then
  if ! runuser -u "$APP_USER" -- git "${CLONE_ARGS[@]}" clone --branch "$BRANCH" "$REPO" "$APP_DIR"; then
    if [ -f "$KEY.pub" ]; then
      echo
      echo "Agrega esta llave como Deploy key de solo lectura en GitHub y vuelve a ejecutar:"
      echo
      cat "$KEY.pub"
    fi
    exit 1
  fi
  if [ "${#CLONE_ARGS[@]}" -gt 0 ]; then
    runuser -u "$APP_USER" -- git -C "$APP_DIR" config core.sshCommand "$SSH_CMD"
  fi
fi

if [ ! -f "$ENV_FILE" ]; then
  admin_password="$(openssl rand -base64 18 | tr -d '/+=')"
  cat > "$ENV_FILE" <<ENV
PORT=8787
HOST=127.0.0.1
PUBLIC_URL=https://$DOMAIN
ADMIN_PASSWORD=$admin_password
SESSION_SECRET=$(openssl rand -hex 32)
TIMEZONE=America/Bogota
DATA_DIR=$DATA_DIR
CLAUDE_BIN=$(command -v claude)
IG_APP_ID=
IG_APP_SECRET=
IG_CONFIG_ID=
ENV
  chown root:"$APP_USER" "$ENV_FILE"
  chmod 640 "$ENV_FILE"
  echo "Contraseña de la interfaz: $admin_password"
fi

install -m 644 "$APP_DIR/deploy/content-engine.service" /etc/systemd/system/content-engine.service
install -m 644 "$APP_DIR/deploy/content-engine-backup.service" /etc/systemd/system/content-engine-backup.service
install -m 644 "$APP_DIR/deploy/content-engine-backup.timer" /etc/systemd/system/content-engine-backup.timer
install -m 644 "$APP_DIR/deploy/caddy.service" /etc/systemd/system/caddy.service
sed "s/__DOMAIN__/$DOMAIN/" "$APP_DIR/deploy/Caddyfile" > /etc/caddy/Caddyfile
chmod +x "$APP_DIR/deploy/deploy.sh" "$APP_DIR/deploy/backup.sh"
ln -sf "$APP_DIR/deploy/deploy.sh" /usr/local/bin/content-engine-deploy

systemctl daemon-reload
systemctl enable content-engine content-engine-backup.timer
systemctl enable caddy
systemctl restart caddy
systemctl start content-engine-backup.timer

BRANCH="$BRANCH" "$APP_DIR/deploy/deploy.sh"
