#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/brc-server"
TMP_DIR="${APP_DIR}.tmp"
SERVICE_PATH="/etc/systemd/system/brc-server.service"
ENV_PATH="/etc/brc/.env"
APP_USER="brc"
APP_GROUP="brc"

REPO_URL="${BRC_REPO_URL:-https://github.com/Rick7O7/bolzo-brc-v1.git}"
BRANCH="${BRC_BRANCH:-main}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Bitte mit sudo/root ausfuehren."
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update || echo "Warnung: apt-get update hatte Fehler, fahre fort..."
apt-get install -y ca-certificates curl git

if ! command -v node >/dev/null 2>&1; then
  if curl -fsSL https://deb.nodesource.com/setup_20.x | bash -; then
    apt-get install -y nodejs
  else
    echo "Warnung: NodeSource nicht erreichbar, verwende Distribution-Pakete fuer Node.js."
    apt-get update || echo "Warnung: apt-get update hatte Fehler, fahre fort..."
    apt-get install -y nodejs npm
  fi
fi

if ! getent group "${APP_GROUP}" >/dev/null; then
  groupadd --system "${APP_GROUP}"
fi

if ! id -u "${APP_USER}" >/dev/null 2>&1; then
  useradd --system --gid "${APP_GROUP}" --home /var/lib/brc --create-home --shell /usr/sbin/nologin "${APP_USER}"
fi

rm -rf "${TMP_DIR}"
git clone --depth 1 --branch "${BRANCH}" "${REPO_URL}" "${TMP_DIR}"

rm -rf "${APP_DIR}"
mv "${TMP_DIR}" "${APP_DIR}"

cd "${APP_DIR}"
if [[ -f package-lock.json || -f npm-shrinkwrap.json ]]; then
  npm ci --omit=dev
else
  npm install --omit=dev
fi

mkdir -p /etc/brc
if [[ ! -f "${ENV_PATH}" ]]; then
  cp "${APP_DIR}/.env.example" "${ENV_PATH}"
  sed -i "s/^HOST=.*/HOST=0.0.0.0/" "${ENV_PATH}" || true
fi

cat > "${SERVICE_PATH}" <<'SERVICE'
[Unit]
Description=BRC Sync Server
After=network.target

[Service]
Type=simple
User=brc
Group=brc
WorkingDirectory=/opt/brc-server
EnvironmentFile=-/etc/brc/.env
ExecStart=/usr/bin/node /opt/brc-server/server.js
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
SERVICE

chown -R "${APP_USER}:${APP_GROUP}" "${APP_DIR}" /var/lib/brc
chmod 640 "${ENV_PATH}"

systemctl daemon-reload
systemctl enable --now brc-server

echo "Installation abgeschlossen."
echo "Service Status: systemctl status brc-server"
echo "Config: ${ENV_PATH}"
