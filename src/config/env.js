const fs = require('node:fs');
const path = require('path');

const MARKER_KEY = '__HIDRAPINK_ENV_LOADED__';

const normalizeValue = (rawValue) => {
  if (rawValue == null) {
    return '';
  }

  let value = String(rawValue).trim();

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return value.replace(/\\n/g, '\n').replace(/\\r/g, '\r');
};

const parseLine = (line) => {
  if (!line) return null;
  const trimmed = line.trim();

  if (!trimmed || trimmed.startsWith('#')) {
    return null;
  }

  const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_\.]*)\s*=\s*(.*)$/);
  if (!match) {
    return null;
  }

  const [, key, rawValue] = match;
  return { key, value: normalizeValue(rawValue) };
};

const applyEnvFile = (filePath) => {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/);
    lines.forEach((line) => {
      const parsed = parseLine(line);
      if (!parsed) {
        return;
      }
      const { key, value } = parsed;
      if (key in process.env) {
        return;
      }
      process.env[key] = value;
    });
    process.env[MARKER_KEY] = filePath;
    return { loaded: true, path: filePath };
  } catch (error) {
    return { loaded: false, path: null, error };
  }
};

const resolveEnvPath = () => {
  const custom = process.env.DOTENV_PATH ? path.resolve(process.env.DOTENV_PATH) : null;
  const defaultPath = path.join(__dirname, '..', '..', '.env');
  const candidates = [];

  if (custom) {
    candidates.push(custom);
  }
  candidates.push(defaultPath);

  return candidates;
};

const loadEnv = () => {
  if (process.env[MARKER_KEY]) {
    return { loaded: true, path: process.env[MARKER_KEY] };
  }

  const candidates = resolveEnvPath();
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    if (!fs.existsSync(candidate)) {
      continue;
    }
    const result = applyEnvFile(candidate);
    if (result.loaded) {
      return result;
    }
  }

  return { loaded: false, path: null };
};

const loadResult = loadEnv();

module.exports = {
  ...loadResult,
  MARKER_KEY,
  load: loadEnv,
  reload: () => {
    delete process.env[MARKER_KEY];
    return loadEnv();
  }
};
