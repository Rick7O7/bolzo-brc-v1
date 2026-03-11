const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const config = require('./config');

const app = express();
const server = http.createServer(app);

const HOST = config.host;
const PORT = config.port;
const MAIN_ROOM = config.mainRoom;
const MAX_ROOM_NAME_LENGTH = config.maxRoomNameLength;
const MAX_TEXT_LENGTH = config.maxTextLength;
const MAX_FILE_SIZE = config.maxFileSizeBytes;
const MAX_FILE_NAME_LENGTH = config.maxFileNameLength;
const RATE_LIMIT = config.rateLimitPerMinute;
const MAX_CLIENTS = config.maxClientsPerRoom;
const SANITIZE_INPUT = config.sanitizeInput;
const DATA_DIR = path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const SOCKET_MAX_BUFFER_SIZE = Math.max(MAX_FILE_SIZE * 2, 2 * 1024 * 1024);
const io = new Server(server, {
  maxHttpBufferSize: SOCKET_MAX_BUFFER_SIZE,
});

const roomState = new Map();
const roomFiles = new Map();
const roomClients = new Map();
const rateLimitMap = new Map();
let persistTimer = null;

function loadPersistedState() {
  try {
    if (!fs.existsSync(STATE_FILE)) {
      return;
    }

    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    if (!raw.trim()) {
      return;
    }

    const parsed = JSON.parse(raw);
    const persistedRooms = parsed.rooms || {};

    for (const [room, value] of Object.entries(persistedRooms)) {
      if (!normalizeRoomName(room)) {
        continue;
      }

      if (typeof value.text === 'string') {
        roomState.set(room, value.text.slice(0, MAX_TEXT_LENGTH));
      }

      if (Array.isArray(value.files)) {
        const files = value.files
          .filter((entry) => entry && typeof entry === 'object')
          .map((entry) => {
            let name = String(entry.name || 'datei').slice(0, MAX_FILE_NAME_LENGTH);
            name = sanitizeText(name);
            const type = String(entry.type || 'application/octet-stream');
            const data = String(entry.data || '');
            const sentAt = Number(entry.sentAt) || Date.now();
            const id = String(entry.id || makeFileId());

            return { id, name, type, data, sentAt };
          })
          .filter((entry) => {
            const size = Buffer.byteLength(entry.data, 'base64');
            return entry.data && Number.isFinite(size) && size > 0 && size <= MAX_FILE_SIZE;
          })
          .slice(0, 25);

        if (files.length) {
          roomFiles.set(room, files);
        }
      }
    }
  } catch (error) {
    console.error('Konnte persistierten Zustand nicht laden:', error.message);
  }
}

function persistStateNow() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });

    const rooms = {};
    const knownRooms = new Set([...roomState.keys(), ...roomFiles.keys()]);
    for (const room of knownRooms) {
      rooms[room] = {
        text: roomState.get(room) || '',
        files: (roomFiles.get(room) || []).slice(0, 25),
      };
    }

    fs.writeFileSync(STATE_FILE, JSON.stringify({ rooms }, null, 2), 'utf8');
  } catch (error) {
    console.error('Konnte Zustand nicht speichern:', error.message);
  }
}

function schedulePersistState() {
  if (persistTimer) {
    clearTimeout(persistTimer);
  }

  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistStateNow();
  }, 250);
}

function makeFileId() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function sanitizeText(text) {
  if (!SANITIZE_INPUT) return text;
  return String(text)
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

function checkRateLimit(socketId) {
  const now = Date.now();
  const key = socketId;
  
  if (!rateLimitMap.has(key)) {
    rateLimitMap.set(key, []);
  }

  const timestamps = rateLimitMap.get(key).filter(ts => now - ts < 60000);
  
  if (timestamps.length >= RATE_LIMIT) {
    return false;
  }

  timestamps.push(now);
  rateLimitMap.set(key, timestamps);
  return true;
}

function getRoomClientCount(room) {
  return roomClients.get(room) || 0;
}

function incrementRoomClients(room) {
  roomClients.set(room, getRoomClientCount(room) + 1);
}

function decrementRoomClients(room) {
  const count = getRoomClientCount(room);
  if (count > 0) {
    roomClients.set(room, count - 1);
  }
}

function normalizeRoomName(input) {
  const room = String(input || '').trim();
  if (!room || room.includes('/') || room.length > MAX_ROOM_NAME_LENGTH) {
    return null;
  }

  return room;
}

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/config', (_req, res) => {
  res.json({
    mainRoom: MAIN_ROOM,
    safeSpaceCodeLength: config.safeSpaceCodeLength,
    maxRoomNameLength: MAX_ROOM_NAME_LENGTH,
    maxTextLength: MAX_TEXT_LENGTH,
    maxFileSizeBytes: MAX_FILE_SIZE,
    maxFileNameLength: MAX_FILE_NAME_LENGTH,
  });
});

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/curl/:room', (req, res) => {
  const room = normalizeRoomName(req.params.room);
  if (!room) {
    return res.status(400).type('text/plain').send('Ungueltiger Raumcode.');
  }

  const text = roomState.get(room) || '';
  res.set('Cache-Control', 'no-store');
  return res.status(200).type('text/plain; charset=utf-8').send(text);
});

app.post(
  '/curl-write/:room',
  express.text({ type: '*/*', limit: `${MAX_TEXT_LENGTH}b` }),
  (req, res) => {
    const room = normalizeRoomName(req.params.room);
    if (!room) {
      return res.status(400).type('text/plain').send('Ungueltiger Raumcode.');
    }

    const incoming = String(req.body || '');
    if (!incoming.trim()) {
      return res.status(400).type('text/plain').send('Kein Inhalt gesendet.');
    }

    let text = incoming.slice(0, MAX_TEXT_LENGTH);
    text = sanitizeText(text);

    roomState.set(room, text);
    io.to(room).emit('text-update', { text });

    res.set('Cache-Control', 'no-store');
    return res.status(200).type('text/plain; charset=utf-8').send('OK');
  }
);

app.get('/curl-d/:room', (req, res) => {
  const room = normalizeRoomName(req.params.room);
  if (!room) {
    return res.status(400).type('text/plain').send('Ungueltiger Raumcode.');
  }

  const files = roomFiles.get(room) || [];
  const requestedName = String(req.query.name || '').trim();
  const filteredFiles = requestedName ? files.filter((file) => file.name === requestedName) : files;

  if (!filteredFiles.length) {
    res.set('Cache-Control', 'no-store');
    if (requestedName) {
      return res
        .status(404)
        .type('text/plain; charset=utf-8')
        .send(`Keine Datei mit name=${requestedName} im Raum gefunden.`);
    }

    return res.status(200).type('text/plain; charset=utf-8').send('Keine Dateien im Raum.');
  }

  const output = filteredFiles
    .map((file, index) => {
      const sizeBytes = Buffer.byteLength(String(file.data || ''), 'base64');
      return [
        `--- Datei ${index + 1} ---`,
        `id: ${file.id || '-'}`,
        `name: ${file.name}`,
        `type: ${file.type}`,
        `sizeBytes: ${sizeBytes}`,
        `sentAt: ${new Date(file.sentAt).toISOString()}`,
        'base64:',
        file.data,
      ].join('\n');
    })
    .join('\n\n');

  res.set('Cache-Control', 'no-store');
  return res.status(200).type('text/plain; charset=utf-8').send(output);
});

app.get('/:room', (req, res, next) => {
  const room = normalizeRoomName(req.params.room);
  if (!room) {
    return next();
  }

  return res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

loadPersistedState();

io.on('connection', (socket) => {
  socket.on('join-room', (payload = {}) => {
    const room = normalizeRoomName(payload.room || MAIN_ROOM);

    if (!room) {
      socket.emit('room-error', { message: 'Ungültiger Raumcode.' });
      return;
    }

    const currentClients = getRoomClientCount(room);
    if (currentClients >= MAX_CLIENTS) {
      socket.emit('room-error', { message: `Raum ist voll (max. ${MAX_CLIENTS} Teilnehmer).` });
      return;
    }

    socket.join(room);
    socket.data.room = room;
    incrementRoomClients(room);

    const currentText = roomState.get(room) || '';
    const currentFiles = roomFiles.get(room) || [];
    socket.emit('room-joined', {
      room,
      text: currentText,
      files: currentFiles,
      clients: getRoomClientCount(room),
    });
    socket.to(room).emit('client-count', { clients: getRoomClientCount(room) });
  });

  socket.on('text-update', (payload = {}) => {
    const room = socket.data.room;
    if (!room) {
      return;
    }

    if (!checkRateLimit(socket.id)) {
      socket.emit('rate-limit', { message: 'Zu viele Anfragen. Bitte warte einen Moment.' });
      return;
    }

    let text = String(payload.text || '').slice(0, MAX_TEXT_LENGTH);
    text = sanitizeText(text);
    
    roomState.set(room, text);
    schedulePersistState();
    socket.to(room).emit('text-update', { text });
  });

  socket.on('file-share', (payload = {}, ack) => {
    const sendAck = typeof ack === 'function' ? ack : () => {};
    const room = socket.data.room;
    if (!room) {
      sendAck({ ok: false, message: 'Kein Raum aktiv.' });
      return;
    }

    if (!checkRateLimit(socket.id)) {
      const message = 'Zu viele Anfragen. Bitte warte einen Moment.';
      socket.emit('rate-limit', { message });
      sendAck({ ok: false, message });
      return;
    }

    let name = String(payload.name || 'datei').slice(0, MAX_FILE_NAME_LENGTH);
    name = sanitizeText(name);
    
    const type = String(payload.type || 'application/octet-stream');
    const data = String(payload.data || '');
    const bytes = Buffer.byteLength(data, 'base64');

    if (!data || !Number.isFinite(bytes) || bytes <= 0 || bytes > MAX_FILE_SIZE) {
      const message = `Datei ist leer oder zu groß (max. ${Math.floor(MAX_FILE_SIZE / 1024 / 1024)} MB).`;
      socket.emit('file-error', { message });
      sendAck({ ok: false, message });
      return;
    }

    const sharedFile = {
      id: makeFileId(),
      name,
      type,
      data,
      sentAt: Date.now(),
    };

    socket.to(room).emit('file-share', sharedFile);

    const stored = roomFiles.get(room) || [];
    stored.unshift(sharedFile);

    roomFiles.set(room, stored.slice(0, 25));
    persistStateNow();
    sendAck({ ok: true, id: sharedFile.id });
  });

  socket.on('file-delete', (payload = {}, ack) => {
    const sendAck = typeof ack === 'function' ? ack : () => {};
    const room = socket.data.room;
    if (!room) {
      sendAck({ ok: false, message: 'Kein Raum aktiv.' });
      return;
    }

    if (!checkRateLimit(socket.id)) {
      const message = 'Zu viele Anfragen. Bitte warte einen Moment.';
      socket.emit('rate-limit', { message });
      sendAck({ ok: false, message });
      return;
    }

    const id = String(payload.id || '').trim();
    if (!id) {
      sendAck({ ok: false, message: 'Ungueltige Datei-ID.' });
      return;
    }

    const stored = roomFiles.get(room) || [];
    const nextFiles = stored.filter((file) => file.id !== id);
    if (nextFiles.length === stored.length) {
      sendAck({ ok: false, message: 'Datei nicht gefunden.' });
      return;
    }

    roomFiles.set(room, nextFiles);
    persistStateNow();
    io.to(room).emit('file-delete', { id });
    sendAck({ ok: true, id });
  });

  socket.on('disconnect', () => {
    const room = socket.data.room;
    if (room) {
      decrementRoomClients(room);
      socket.to(room).emit('client-count', { clients: getRoomClientCount(room) });
    }
    rateLimitMap.delete(socket.id);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Server läuft auf http://${HOST}:${PORT}`);
});
