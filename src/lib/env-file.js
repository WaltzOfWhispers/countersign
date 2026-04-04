import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function parseEnvValue(rawValue) {
  const value = rawValue.trim();
  if (!value) {
    return '';
  }

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

export function loadEnvFile({
  env = process.env,
  baseDir = process.cwd(),
  fileName = '.env'
} = {}) {
  const filePath = join(baseDir, fileName);
  if (!existsSync(filePath)) {
    return { filePath, loaded: false };
  }

  const contents = readFileSync(filePath, 'utf8');
  for (const rawLine of contents.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    if (!key || env[key] !== undefined) {
      continue;
    }

    env[key] = parseEnvValue(line.slice(separatorIndex + 1));
  }

  return { filePath, loaded: true };
}
