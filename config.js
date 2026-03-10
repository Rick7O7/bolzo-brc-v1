const fs = require('fs');
const path = require('path');

function parseEnvFile(content) {
  const result = {};
  const lines = String(content || '').split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

function loadDotEnvConfig() {
  const envPath = path.join(__dirname, '.env');
  try {
    if (!fs.existsSync(envPath)) {
      return {};
    }

    const raw = fs.readFileSync(envPath, 'utf8');
    return parseEnvFile(raw);
  } catch (_error) {
    return {};
  }
}

const defaults = {
  host: '127.0.0.1',
  port: 3000,
  mainRoom: 'main',
  safeSpaceCodeLength: 8,
  maxRoomNameLength: 80,
  maxTextLength: 20000,
  maxFileSizeBytes: 8 * 1024 * 1024,
  maxFileNameLength: 120,
  rateLimitPerMinute: 60,
  maxClientsPerRoom: 50,
  sanitizeInput: true,
};

function loadFileConfig() {
  const filePath = path.join(__dirname, 'config.json');
  try {
    if (!fs.existsSync(filePath)) {
      return {};
    }

    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    console.warn('Konnte config.json nicht laden, nutze Defaults.', error.message);
    return {};
  }
}

function toNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function sanitize(config) {
  const merged = { ...defaults, ...config };

  merged.host = String(merged.host || defaults.host).trim() || defaults.host;
  merged.port = Math.max(1, Math.min(65535, Math.floor(toNumber(merged.port, defaults.port))));
  merged.safeSpaceCodeLength = Math.max(4, Math.min(32, Math.floor(toNumber(merged.safeSpaceCodeLength, defaults.safeSpaceCodeLength))));
  merged.maxRoomNameLength = Math.max(1, Math.min(200, Math.floor(toNumber(merged.maxRoomNameLength, defaults.maxRoomNameLength))));
  merged.maxTextLength = Math.max(100, Math.min(500000, Math.floor(toNumber(merged.maxTextLength, defaults.maxTextLength))));
  merged.maxFileSizeBytes = Math.max(1024, Math.min(100 * 1024 * 1024, Math.floor(toNumber(merged.maxFileSizeBytes, defaults.maxFileSizeBytes))));
  merged.maxFileNameLength = Math.max(1, Math.min(255, Math.floor(toNumber(merged.maxFileNameLength, defaults.maxFileNameLength))));
  merged.rateLimitPerMinute = Math.max(1, Math.min(1000, Math.floor(toNumber(merged.rateLimitPerMinute, defaults.rateLimitPerMinute))));
  merged.maxClientsPerRoom = Math.max(1, Math.min(500, Math.floor(toNumber(merged.maxClientsPerRoom, defaults.maxClientsPerRoom))));
  merged.sanitizeInput = merged.sanitizeInput === 'false' || merged.sanitizeInput === false ? false : true;

  merged.mainRoom = String(merged.mainRoom || defaults.mainRoom).trim();
  if (!merged.mainRoom || merged.mainRoom.includes('/')) {
    merged.mainRoom = defaults.mainRoom;
  }

  return merged;
}

const fileConfig = loadFileConfig();
const dotenvConfig = loadDotEnvConfig();
const envConfig = {
  host: process.env.HOST || dotenvConfig.HOST,
  port: process.env.PORT || dotenvConfig.PORT,
  mainRoom: process.env.MAIN_ROOM || dotenvConfig.MAIN_ROOM,
  safeSpaceCodeLength: process.env.SAFE_SPACE_CODE_LENGTH || dotenvConfig.SAFE_SPACE_CODE_LENGTH,
  maxRoomNameLength: process.env.MAX_ROOM_NAME_LENGTH || dotenvConfig.MAX_ROOM_NAME_LENGTH,
  maxTextLength: process.env.MAX_TEXT_LENGTH || dotenvConfig.MAX_TEXT_LENGTH,
  maxFileSizeBytes: process.env.MAX_FILE_SIZE_BYTES || dotenvConfig.MAX_FILE_SIZE_BYTES,
  maxFileNameLength: process.env.MAX_FILE_NAME_LENGTH || dotenvConfig.MAX_FILE_NAME_LENGTH,
  rateLimitPerMinute: process.env.RATE_LIMIT_PER_MINUTE || dotenvConfig.RATE_LIMIT_PER_MINUTE,
  maxClientsPerRoom: process.env.MAX_CLIENTS_PER_ROOM || dotenvConfig.MAX_CLIENTS_PER_ROOM,
  sanitizeInput: process.env.SANITIZE_INPUT || dotenvConfig.SANITIZE_INPUT,
};

module.exports = sanitize({ ...fileConfig, ...envConfig });
