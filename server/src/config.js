import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const PORT = Number(process.env.PORT || 3001);
export const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(import.meta.dirname, '..', 'data'));
export const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;

fs.mkdirSync(DATA_DIR, { recursive: true });

// Segredo do JWT: usa a variável de ambiente ou gera um e guarda em disco.
function loadSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const file = path.join(DATA_DIR, '.secret');
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(48).toString('hex'));
  return fs.readFileSync(file, 'utf8').trim();
}
export const JWT_SECRET = loadSecret();
