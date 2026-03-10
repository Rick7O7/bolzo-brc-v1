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

if [[ -t 1 ]] && command -v tput >/dev/null 2>&1 && [[ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]]; then
  BOLD="$(tput bold)"
  RESET="$(tput sgr0)"
  RED="$(tput setaf 1)"
  GREEN="$(tput setaf 2)"
  YELLOW="$(tput setaf 3)"
  CYAN="$(tput setaf 6)"
else
  BOLD=""
  RESET=""
  RED=""
  GREEN=""
  YELLOW=""
  CYAN=""
fi

print_banner() {
  printf "%s\n" "${CYAN}${BOLD}"
  cat <<'ASCII'
     ::::::::::::::::::::.           .:::::::::::::::       :::::                  ::::::::::::::::::::::::      ::::::::::::::::
    ::::::::::::::::::::::::      ::::::::::::::::::::::    :::::                  :::::::::::::::::::::::::  ::::::::::::::::::::::
    :::::::::::::::::::::::::   ::::::::::::::::::::::::::  :::::                  ::::::::::::::::::::::::.::::::::::::::::::::::::::
    ::::::              :::::  :::::::::::          ::::::: :::::                                  ::::::: :::::::            :::::::::
    ::::::              :::::  ::::: :::::::          :::::::::::                                :::::::   :::::           :::::::::::::
    ::::::             :::::: ::::::   :::::::         ::::::::::                              :::::::    ::::::         ::::::::  :::::
    :::::: :::::::::::::::::  ::::::    ::::::::       ::::::::::                            ::::::::     ::::::       ::::::::    :::::
    :::::: :::::::::::::::::: ::::::      ::::::::     ::::::::::                           :::::::       ::::::     ::::::::      :::::
    :::::: :::::::::::::::::::::::::        ::::::::   ::::::::::                         :::::::         ::::::   ::::::::        :::::
    ::::::               :::::::::::          ::::::: :::::::::::                       :::::::           :::::: ::::::::          :::::
    ::::::                ::::::::::            :::::::::::::::::                     ::::::::             ::::::::::::           ::::::
    ::::::                ::::::::::::            ::::::::: :::::                    :::::::               :::::::::            :::::::
    ::::::::::::::::::::::::::: ::::::::::::::::::::::::::  ::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::
    ::::::::::::::::::::::::::    ::::::::::::::::::::::    ::::::::::::::::::::::::::::::::::::::::::::::::  ::::::::::::::::::::::
      :::::::::::::::::::::           ::::::::::::::          ::::::::::::::::::::::::::::::::::::::::::::::      ::::::::::::::
ASCII
  printf "%s\n" "${RESET}"
}

log_step() {
  STEP=$((STEP + 1))
  printf "%s[%s/%s]%s %s\n" "${CYAN}${BOLD}" "${STEP}" "${TOTAL_STEPS}" "${RESET}" "$1"
}

log_ok() {
  printf "%s[OK]%s %s\n" "${GREEN}${BOLD}" "${RESET}" "$1"
}

log_warn() {
  printf "%s[WARN]%s %s\n" "${YELLOW}${BOLD}" "${RESET}" "$1"
}

on_error() {
  local exit_code="$?"
  printf "%s[FEHLER]%s Installation abgebrochen in Zeile %s (Exit-Code: %s).\n" "${RED}${BOLD}" "${RESET}" "$1" "${exit_code}" >&2
  exit "${exit_code}"
}

trap 'on_error ${LINENO}' ERR

TOTAL_STEPS=8
STEP=0

print_banner
printf "%sBRC Server Installer%s\n" "${BOLD}" "${RESET}"
printf "Quelle: %s (Branch: %s)\n\n" "${REPO_URL}" "${BRANCH}"

if [[ "${EUID}" -ne 0 ]]; then
  printf "%sBitte mit sudo/root ausfuehren.%s\n" "${RED}${BOLD}" "${RESET}"
  exit 1
fi

log_step "Systempakete aktualisieren und Basis-Tools installieren"
export DEBIAN_FRONTEND=noninteractive
apt-get update || log_warn "apt-get update hatte Fehler, fahre fort..."
apt-get install -y ca-certificates curl git
log_ok "Basis-Tools installiert"

log_step "Node.js pruefen/installieren"
if ! command -v node >/dev/null 2>&1; then
  if curl -fsSL https://deb.nodesource.com/setup_20.x | bash -; then
    apt-get install -y nodejs
  else
    log_warn "NodeSource nicht erreichbar, verwende Distribution-Pakete fuer Node.js."
    apt-get update || log_warn "apt-get update hatte Fehler, fahre fort..."
    apt-get install -y nodejs npm
  fi
fi
log_ok "Node.js verfuegbar: $(node -v)"

log_step "System-Benutzer und Gruppe sicherstellen"
if ! getent group "${APP_GROUP}" >/dev/null; then
  groupadd --system "${APP_GROUP}"
fi

if ! id -u "${APP_USER}" >/dev/null 2>&1; then
  useradd --system --gid "${APP_GROUP}" --home /var/lib/brc --create-home --shell /usr/sbin/nologin "${APP_USER}"
fi
log_ok "Benutzer/Gruppe ${APP_USER}:${APP_GROUP} bereit"

log_step "Repository klonen"
rm -rf "${TMP_DIR}"
git clone --depth 1 --branch "${BRANCH}" "${REPO_URL}" "${TMP_DIR}"

rm -rf "${APP_DIR}"
mv "${TMP_DIR}" "${APP_DIR}"
log_ok "Code nach ${APP_DIR} ausgerollt"

log_step "Node-Abhaengigkeiten installieren"
cd "${APP_DIR}"
if [[ -f package-lock.json || -f npm-shrinkwrap.json ]]; then
  npm ci --omit=dev
else
  npm install --omit=dev
fi
log_ok "Abhaengigkeiten installiert"

log_step "Umgebungskonfiguration vorbereiten"
mkdir -p /etc/brc
if [[ ! -f "${ENV_PATH}" ]]; then
  cp "${APP_DIR}/.env.example" "${ENV_PATH}"
  sed -i "s/^HOST=.*/HOST=0.0.0.0/" "${ENV_PATH}" || true
fi
log_ok "Konfigurationsdatei bereit: ${ENV_PATH}"

log_step "Systemd Service erstellen"
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
log_ok "Service-Datei geschrieben: ${SERVICE_PATH}"

log_step "Rechte setzen und Service starten"
chown -R "${APP_USER}:${APP_GROUP}" "${APP_DIR}" /var/lib/brc
chmod 640 "${ENV_PATH}"

systemctl daemon-reload
systemctl enable --now brc-server
log_ok "brc-server aktiv"

printf "\n%sInstallation abgeschlossen.%s\n" "${GREEN}${BOLD}" "${RESET}"
printf "Service Status: systemctl status brc-server\n"
printf "Config: %s\n" "${ENV_PATH}"
