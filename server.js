const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const config = require('./config');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

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

const roomState = new Map();
const roomFiles = new Map();
const roomClients = new Map();
const rateLimitMap = new Map();

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
    socket.emit('room-joined', { room, text: currentText, clients: getRoomClientCount(room) });
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
    socket.to(room).emit('text-update', { text });
  });

  socket.on('file-share', (payload = {}) => {
    const room = socket.data.room;
    if (!room) {
      return;
    }

    if (!checkRateLimit(socket.id)) {
      socket.emit('rate-limit', { message: 'Zu viele Anfragen. Bitte warte einen Moment.' });
      return;
    }

    let name = String(payload.name || 'datei').slice(0, MAX_FILE_NAME_LENGTH);
    name = sanitizeText(name);
    
    const type = String(payload.type || 'application/octet-stream');
    const data = String(payload.data || '');
    const bytes = Buffer.byteLength(data, 'base64');

    if (!data || !Number.isFinite(bytes) || bytes <= 0 || bytes > MAX_FILE_SIZE) {
      socket.emit('file-error', { message: 'Datei ist leer oder zu groß (max. 8 MB).' });
      return;
    }

    socket.to(room).emit('file-share', {
      name,
      type,
      data,
      sentAt: Date.now(),
    });

    const stored = roomFiles.get(room) || [];
    stored.unshift({
      name,
      type,
      data,
      sentAt: Date.now(),
    });

    roomFiles.set(room, stored.slice(0, 25));
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
