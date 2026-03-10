const socket = io();

// Toast Notification System
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  
  setTimeout(() => toast.classList.add('show'), 10);
  
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

const createSafeSpaceBtn = document.getElementById('createSafeSpace');
const joinRoomBtn = document.getElementById('joinRoom');
const joinInput = document.getElementById('joinInput');
const roomBadge = document.getElementById('roomBadge');
const sharedText = document.getElementById('sharedText');
const fileInput = document.getElementById('fileInput');
const fileList = document.getElementById('fileList');
const roomHint = document.getElementById('roomHint');
const configHint = document.getElementById('configHint');

const requiredElements = [
  createSafeSpaceBtn,
  joinRoomBtn,
  joinInput,
  roomBadge,
  sharedText,
  fileInput,
  fileList,
  roomHint,
  configHint,
];

if (requiredElements.some((el) => !el)) {
  throw new Error('UI konnte nicht initialisiert werden: fehlende Elemente in index.html');
}

const FALLBACK_CONFIG = {
  mainRoom: 'main',
  safeSpaceCodeLength: 8,
  maxRoomNameLength: 80,
  maxTextLength: 20000,
  maxFileSizeBytes: 8 * 1024 * 1024,
};

let runtimeConfig = { ...FALLBACK_CONFIG };
let isApplyingRemoteUpdate = false;
let isJoined = false;
let activeRoom = null;

function isValidRoomName(room) {
  return Boolean(room) && !room.includes('/') && room.length <= runtimeConfig.maxRoomNameLength;
}

async function loadRuntimeConfig() {
  try {
    const response = await fetch('/api/config', { cache: 'no-store' });
    if (!response.ok) {
      return;
    }

    const data = await response.json();
    runtimeConfig = {
      ...runtimeConfig,
      ...data,
    };
  } catch (_error) {
    // Falls /api/config nicht erreichbar ist, laufen wir mit Defaults.
  }
}

function getRoomFromPath() {
  const rawPath = window.location.pathname.replace(/^\//, '').trim();
  const raw = rawPath ? decodeURIComponent(rawPath) : '';
  return raw || runtimeConfig.mainRoom;
}

function randomSafeSpaceCode() {
  const length = Number(runtimeConfig.safeSpaceCodeLength || 8);
  let code = '';
  while (code.length < length) {
    code += Math.floor(Math.random() * 10);
  }

  return code.slice(0, length);
}

function goToRoom(room) {
  const clean = String(room || '').trim();
  if (!isValidRoomName(clean)) {
    showToast(`Ungültiger Raumcode. Erlaubt: 1-${runtimeConfig.maxRoomNameLength} Zeichen, ohne /`, 'error');
    return;
  }

  window.location.href = `/${encodeURIComponent(clean)}`;
}

function showRoom(room) {
  activeRoom = room;
  roomBadge.textContent = room === runtimeConfig.mainRoom ? `Haupt-Raum: ${room}` : `Raum: ${room}`;
  roomHint.textContent = `Direkt beitreten: ${window.location.origin}/${encodeURIComponent(room)}`;
  configHint.textContent = `Max ${runtimeConfig.maxTextLength} Zeichen, Datei bis ${Math.floor(runtimeConfig.maxFileSizeBytes / 1024 / 1024)} MB`;
}

function addIncomingFile({ name, type, data, sentAt, source }) {
  const safeType = type || 'application/octet-stream';
  const url = `data:${safeType};base64,${data}`;

  const li = document.createElement('li');
  const time = new Date(sentAt || Date.now()).toLocaleTimeString('de-DE');

  const text = document.createElement('span');
  text.textContent = `${name} (${time})${source ? ` - ${source}` : ''}`;

  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.textContent = 'Download';

  li.append(text, link);
  fileList.prepend(li);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const base64 = result.split(',')[1] || '';
      if (!base64) {
        reject(new Error('Datei konnte nicht gelesen werden.'));
        return;
      }

      resolve(base64);
    };
    reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden.'));
    reader.readAsDataURL(file);
  });
}

createSafeSpaceBtn.addEventListener('click', () => {
  goToRoom(randomSafeSpaceCode());
});

joinRoomBtn.addEventListener('click', () => {
  goToRoom(joinInput.value.trim());
});

joinInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    goToRoom(joinInput.value.trim());
  }
});

sharedText.addEventListener('input', () => {
  if (!isJoined || !activeRoom || isApplyingRemoteUpdate) {
    return;
  }

  if (sharedText.value.length > runtimeConfig.maxTextLength) {
    sharedText.value = sharedText.value.slice(0, runtimeConfig.maxTextLength);
  }

  socket.emit('text-update', { text: sharedText.value });
});

fileInput.addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file || !activeRoom || !isJoined) {
    return;
  }

  if (file.size > runtimeConfig.maxFileSizeBytes) {
    showToast(`Datei zu groß. Maximal ${Math.floor(runtimeConfig.maxFileSizeBytes / 1024 / 1024)} MB.`, 'error');
    fileInput.value = '';
    return;
  }

  try {
    const payload = {
      name: file.name,
      type: file.type || 'application/octet-stream',
      data: await fileToBase64(file),
    };

    socket.emit('file-share', payload);
    addIncomingFile({ ...payload, sentAt: Date.now(), source: 'du' });
    showToast('Datei erfolgreich geteilt', 'success');
  } catch (error) {
    showToast(error.message || 'Dateiupload fehlgeschlagen.', 'error');
  }

  fileInput.value = '';
});

socket.on('text-update', ({ text }) => {
  isApplyingRemoteUpdate = true;
  sharedText.value = text || '';
  isApplyingRemoteUpdate = false;
});

socket.on('room-joined', ({ text, clients }) => {
  isJoined = true;
  sharedText.disabled = false;
  fileInput.disabled = false;
  isApplyingRemoteUpdate = true;
  sharedText.value = text || '';
  isApplyingRemoteUpdate = false;
  showToast(`Raum beigetreten. ${clients || 1} Teilnehmer online.`, 'success');
});

socket.on('client-count', ({ clients }) => {
  if (clients !== undefined) {
    configHint.textContent = `Max ${runtimeConfig.maxTextLength} Zeichen, Datei bis ${Math.floor(runtimeConfig.maxFileSizeBytes / 1024 / 1024)} MB | ${clients} Teilnehmer`;
  }
});

socket.on('rate-limit', ({ message }) => {
  showToast(message || 'Zu viele Anfragen.', 'warning');
});

socket.on('file-share', (payload) => {
  addIncomingFile({ ...payload, source: 'remote' });
});

socket.on('room-error', ({ message }) => {
  showToast(message || 'Raumfehler', 'error');
  setTimeout(() => {
    window.location.href = '/';
  }, 2000);
});

socket.on('file-error', ({ message }) => {
  showToast(message || 'Dateifehler', 'error');
});

(async () => {
  await loadRuntimeConfig();
  const room = getRoomFromPath();

  showRoom(room);
  sharedText.disabled = true;
  fileInput.disabled = true;
  socket.emit('join-room', { room });
})();
