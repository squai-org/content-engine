#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${1:?Uso: sudo bash install.sh dominio.ejemplo.com}"
REPO="${REPO:-git@github.com:squai-org/content-engine.git}"
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

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl git gnupg openssl sqlite3 fonts-inter debian-keyring debian-archive-keyring apt-transport-https

node_ok() {
  command -v node >/dev/null && node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)'
}

if ! node_ok; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

if ! command -v caddy >/dev/null; then
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt -o /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

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

if [ ! -f "$KEY" ]; then
  ssh-keygen -t ed25519 -N '' -C content-engine-deploy -f "$KEY" >/dev/null
fi
touch "$CONF_DIR/known_hosts"
chown "$APP_USER:$APP_USER" "$KEY" "$CONF_DIR/known_hosts"
chmod 600 "$KEY" "$CONF_DIR/known_hosts"

if [ ! -d "$APP_DIR/.git" ]; then
  if ! runuser -u "$APP_USER" -- git -c core.sshCommand="$SSH_CMD" clone --branch "$BRANCH" "$REPO" "$APP_DIR"; then
    echo
    echo "No pude clonar. Agrega esta llave como Deploy key de solo lectura en GitHub y vuelve a ejecutar:"
    echo
    cat "$KEY.pub"
    exit 1
  fi
  runuser -u "$APP_USER" -- git -C "$APP_DIR" config core.sshCommand "$SSH_CMD"
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
CLAUDE_BIN=/usr/bin/claude
IG_APP_ID=
IG_APP_SECRET=
ENV
  chown root:"$APP_USER" "$ENV_FILE"
  chmod 640 "$ENV_FILE"
  echo "Contraseña de la interfaz: $admin_password"
fi

install -m 644 "$APP_DIR/deploy/content-engine.service" /etc/systemd/system/content-engine.service
install -m 644 "$APP_DIR/deploy/content-engine-backup.service" /etc/systemd/system/content-engine-backup.service
install -m 644 "$APP_DIR/deploy/content-engine-backup.timer" /etc/systemd/system/content-engine-backup.timer
sed "s/__DOMAIN__/$DOMAIN/" "$APP_DIR/deploy/Caddyfile" > /etc/caddy/Caddyfile
chmod +x "$APP_DIR/deploy/deploy.sh" "$APP_DIR/deploy/backup.sh"
ln -sf "$APP_DIR/deploy/deploy.sh" /usr/local/bin/content-engine-deploy

systemctl daemon-reload
systemctl enable content-engine content-engine-backup.timer
systemctl enable --now caddy
systemctl restart caddy
systemctl start content-engine-backup.timer

BRANCH="$BRANCH" "$APP_DIR/deploy/deploy.sh"
