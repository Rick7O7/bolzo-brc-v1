#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Bitte mit sudo/root ausfuehren."
  exit 1
fi

systemctl disable --now brc-server 2>/dev/null || true
rm -f /etc/systemd/system/brc-server.service
systemctl daemon-reload

rm -rf /opt/brc-server

echo "BRC Server wurde entfernt."
echo "Konfig wurde behalten: /etc/brc/.env"
