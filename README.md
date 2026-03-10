# BOLZO - BRC 
## Version: 3.0

Realtime Broadcast-Textarea mit Socket.IO, Room-URLs und Datei-Sync.

## Konfiguration

Die Laufzeit-Konfiguration wird in `config.js` zusammengebaut.

Prioritaet (hoch -> niedrig):

1. echte Umgebungsvariablen (`process.env`)
2. lokale `.env` Datei (anhand von `.env.example`)
3. `config.json`
4. interne Defaults in `config.js`

Hinweis: `config.js` ist der Loader, nicht eine zweite konkurrierende Konfig-Datei.

Verfuegbare Keys:

- `HOST` - IP-Adresse (Standard: 127.0.0.1)
- `PORT` - Port (Standard: 3000)
- `MAIN_ROOM` - Name des Haupt-Raums (Standard: main)
- `SAFE_SPACE_CODE_LENGTH` - Länge des Zufallscodes (Standard: 8)
- `MAX_ROOM_NAME_LENGTH` - Maximale Raumcode-Länge (Standard: 80)
- `MAX_TEXT_LENGTH` - Maximale Textlänge in Zeichen (Standard: 20000)
- `MAX_FILE_SIZE_BYTES` - Maximale Dateigröße in Bytes (Standard: 8388608 = 8MB)
- `MAX_FILE_NAME_LENGTH` - Maximale Dateinamenlänge (Standard: 120)
- `RATE_LIMIT_PER_MINUTE` - Max. Anfragen pro Minute pro Client (Standard: 60)
- `MAX_CLIENTS_PER_ROOM` - Max. Teilnehmer pro Raum (Standard: 50)
- `SANITIZE_INPUT` - HTML/Script-Tags escapen (Standard: true)

## Features

- Live-Synchronisierung eines Textfelds pro Raum (Zeichen-fuer-Zeichen sichtbar)
- Raum per URL: /<roomcode>
- Startseite mit SafeSpace-Erstellung (zufaelliger 8-stelliger Code)
- Datei-Upload im Raum, sofort an alle Clients im selben Raum verteilt
- Einfache Validierung fuer Raumcodes
- **Rate Limiting** - Schutz vor Spam (konfigurierbar pro Minute)
- **Max Clients pro Raum** - Verhindert Ueberlastung
- **Input Sanitization** - HTML/Script-Tags werden escaped
- **Toast-Benachrichtigungen** - Saubere User-Notifications statt Alerts
- **Live Teilnehmer-Zaehler** - Zeigt aktuelle User-Anzahl im Raum

## Installation

```bash
npm install
```

Wenn eine `package-lock.json` im Repo vorhanden ist, funktioniert auch:

```bash
npm ci
```

### Server per curl installieren

Direktinstallation auf Ubuntu/Debian (setzt systemd Service auf):

```bash
curl -fsSL https://get.bolzo.net/install.sh | sudo bash
```

Danach:

```bash
sudo systemctl status brc-server
```

Konfiguration liegt unter:

```bash
/etc/brc/.env
```

Service neu starten nach Config-Aenderung:

```bash
sudo systemctl restart brc-server
```

Deinstallation:

```bash
curl -fsSL https://get.bolzo.net/uninstall.sh | sudo bash
```

## Start

```bash
npm start
```

Danach im Browser:

- http://127.0.0.1:3000 fuer die Startseite
- http://127.0.0.1:3000/x fuer einen konkreten Raum, z. B. /team123

## Entwicklung

```bash
npm run dev
```

## Curl Endpunkte

- `GET /curl/<room_id>`
Zeigt den aktuellen Textinhalt eines Raums als Klartext.

Beispiel:
```bash
curl https://brc.bolzo.net/curl/main
```

- `GET /curl-d/<room_id>`
Zeigt die gespeicherten Datei-Uploads eines Raums als Klartext (inkl. Base64-Inhalt).

Beispiel:
```bash
curl https://brc.bolzo.net/curl-d/main
```

- `GET /curl-d/<room_id>?name=<dateiname>`
Gibt gezielt nur Dateien mit exakt diesem Dateinamen aus.

Beispiel:
```bash
curl "https://brc.bolzo.net/curl-d/main?name=xyz.txt"
```

Hinweise:
- Wenn keine Datei zum Namen gefunden wird, kommt HTTP `404`.
- Ohne `name` werden alle gespeicherten Dateien des Raums ausgegeben.

- `POST /curl-write/<room_id>`
Schreibt Textinhalt direkt in den Raum (setzt den aktuellen Raumtext).

Beispiel mit direktem Text:
```bash
echo "Hallo aus Linux" | curl -X POST --data-binary @- "https://brc.bolzo.net/curl-write/main"
```

Beispiel mit Dateiinhalt:
```bash
curl -X POST --data-binary @./notiz.txt "https://brc.bolzo.net/curl-write/main"
```

Hinweise zu `curl-write`:
- Inhalt wird wie normaler Raumtext behandelt und an aktive Clients im Raum live verteilt.
- Maximalgroesse entspricht `MAX_TEXT_LENGTH`.
- Leerer Inhalt liefert HTTP `400`.

## Hinweise

- Maximale Dateigroesse: 8 MB (jenach konfiguration)
- Erlaubte Raumcodes: 3-64 Zeichen, a-z, A-Z, 0-9, _ und -
