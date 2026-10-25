import fs from 'node:fs';
import path from 'node:path';
import { db, newId, now, HttpError } from './db.js';
import { emitServer } from './hub.js';
import { stationDir } from './repo.js';

// Resolve um caminho relativo dentro da pasta da estação. Qualquer tentativa de
// sair da pasta (../, caminho absoluto, link para fora) ou de mexer no .git é bloqueada.
export function resolveInStation(station, rel = '/') {
  const root = path.resolve(stationDir(station));
  const clean = String(rel).replace(/\\/g, '/').replace(/^\/+/, '');
  const target = path.resolve(root, clean);
  if (target !== root && !target.startsWith(root + path.sep)) throw new HttpError(403, 'Acesso fora da pasta do projeto');
  const first = path.relative(root, target).split(path.sep)[0];
  if (first === '.git') throw new HttpError(403, 'A pasta .git não é acessível');
  if (fs.existsSync(target)) {
    const real = fs.realpathSync(target);
    const realRoot = fs.realpathSync(root);
    if (real !== realRoot && !real.startsWith(realRoot + path.sep)) throw new HttpError(403, 'Acesso fora da pasta do projeto');
  }
  return target;
}

// Dependências e artefatos de build: não aparecem na atividade nem são replicados
// (cada máquina gera os seus ao testar).
export const REPLICA_IGNORE = new Set(['.git', 'node_modules', 'dist', 'build', 'out', '.venv', 'venv', '__pycache__', '.next', 'target', '.gradle', '.idea']);

// ---- Atividade ao vivo: quem está mexendo em qual arquivo ----

const watchers = new Map();
const lastWriter = new Map(); // caminho absoluto -> { userId, at }
const activity = new Map(); // serverId -> últimos eventos

export function noteWriter(absPath, user) {
  lastWriter.set(absPath, { userId: user.id, at: Date.now() });
}

export const recentActivity = (serverId) => activity.get(serverId) || [];

export function watchStation(station) {
  if (watchers.has(station.id)) return;
  const root = stationDir(station);
  if (!fs.existsSync(root)) return;
  const pending = new Map();
  try {
    const watcher = fs.watch(root, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const rel = filename.split(path.sep).join('/');
      if (rel.split('/').some((seg) => REPLICA_IGNORE.has(seg))) return;
      clearTimeout(pending.get(rel));
      pending.set(
        rel,
        setTimeout(() => {
          pending.delete(rel);
          record(station, root, rel);
        }, 400),
      );
    });
    watcher.on('error', () => {});
    watchers.set(station.id, watcher);
  } catch (err) {
    console.warn(`[watch] não foi possível observar ${root}: ${err.message}`);
  }
}

export function unwatchStation(stationId) {
  watchers.get(stationId)?.close();
  watchers.delete(stationId);
}

function record(station, root, rel) {
  const abs = path.join(root, rel);
  let stat = null;
  try {
    stat = fs.statSync(abs);
  } catch {}
  if (stat?.isDirectory()) return;
  const writer = lastWriter.get(abs);
  const item = {
    id: newId(),
    serverId: station.serverId,
    stationId: station.id,
    stationName: station.name,
    userId: writer && Date.now() - writer.at < 5000 ? writer.userId : station.userId,
    file: rel,
    action: stat ? 'edit' : 'delete',
    at: now(),
  };
  const list = activity.get(station.serverId) || [];
  list.unshift(item);
  activity.set(station.serverId, list.slice(0, 200));
  emitServer(station.serverId, 'activity', item);
}

export function watchAllStations() {
  for (const st of db.stations) watchStation(st);
}
