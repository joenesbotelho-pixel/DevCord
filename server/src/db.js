import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';

// Banco simples em JSON — suficiente para um servidor de equipe pequena.
const FILE = path.join(DATA_DIR, 'db.json');
const EMPTY = {
  users: [],
  servers: [],
  members: [],
  departments: [],
  channels: [],
  messages: [],
  invites: [],
  stations: [],
  tasks: [],
};

export const db = load();

function load() {
  if (!fs.existsSync(FILE)) return structuredClone(EMPTY);
  return { ...structuredClone(EMPTY), ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
}

let timer;
export function save() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
    fs.renameSync(tmp, FILE);
  }, 100);
}

export const newId = () => crypto.randomUUID();
export const now = () => new Date().toISOString();

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const publicUser = (u) => ({ id: u.id, username: u.username, color: u.color });

export function memberOf(serverId, userId) {
  return db.members.find((m) => m.serverId === serverId && m.userId === userId);
}

export function requireMember(serverId, user) {
  const m = memberOf(serverId, user.id);
  if (!m) throw new HttpError(403, 'Você não é membro deste servidor');
  return m;
}

export function requireAdmin(serverId, user) {
  const m = requireMember(serverId, user);
  if (m.role !== 'owner' && m.role !== 'admin') throw new HttpError(403, 'Apenas administradores podem fazer isso');
  return m;
}

export function findServer(serverId) {
  const s = db.servers.find((s) => s.id === serverId);
  if (!s) throw new HttpError(404, 'Servidor não encontrado');
  return s;
}
