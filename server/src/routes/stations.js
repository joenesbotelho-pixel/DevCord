import { Router } from 'express';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db, save, newId, now, HttpError, requireMember, findServer } from '../db.js';
import { requireAuth } from '../auth.js';
import { emitServer } from '../hub.js';
import * as repo from '../repo.js';
import { completeTasksForStation } from './tasks.js';
import { sshConfig, remoteDir, shellCommand } from '../ssh.js';
import { resolveInStation, noteWriter, watchStation, unwatchStation, recentActivity, REPLICA_IGNORE } from '../workspace.js';

export const stationRoutes = Router();
stationRoutes.use(requireAuth);

export function stationPayload(station) {
  return { ...station, path: repo.stationDir(station) };
}

function loadStation(req) {
  const id = req.params.id;
  // Aceita o id curto (nome da pasta), usado ao identificar a estação numa janela SSH.
  const st = db.stations.find((s) => s.id === id || (id.length === 8 && repo.shortId(s.id) === id));
  if (!st) throw new HttpError(404, 'Estação não encontrada');
  requireMember(st.serverId, req.user);
  return st;
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'user';
const repoChanged = (serverId, stationId) => emitServer(serverId, 'repo:changed', { serverId, stationId });

async function createStationFor(server, user, name, personal = false) {
  const station = {
    id: newId(),
    serverId: server.id,
    userId: user.id,
    name: String(name || '').trim().slice(0, 50) || `Estação de ${user.username}`,
    branch: `station/${slug(user.username)}-${newId().slice(0, 6)}`,
    personal,
    createdAt: now(),
  };
  await repo.createStation(station);
  db.stations.push(station);
  save();
  watchStation(station);
  emitServer(server.id, 'server:updated', { serverId: server.id });
  return station;
}

// Ambiente pessoal: criado automaticamente quando a pessoa entra no servidor,
// numa pasta padrão e protegida do sistema. Ninguém precisa escolher diretório.
const pendingEnv = new Map();
export function ensureEnvironment(server, user) {
  const existing = db.stations.find((s) => s.serverId === server.id && s.userId === user.id && s.personal);
  if (existing) return Promise.resolve(existing);
  const key = `${server.id}:${user.id}`;
  if (!pendingEnv.has(key)) {
    pendingEnv.set(key, createStationFor(server, user, `Ambiente de ${user.username}`, true).finally(() => pendingEnv.delete(key)));
  }
  return pendingEnv.get(key);
}

stationRoutes.post('/servers/:id/environment', async (req, res) => {
  const server = findServer(req.params.id);
  requireMember(server.id, req.user);
  res.json(stationPayload(await ensureEnvironment(server, req.user), server));
});

stationRoutes.post('/servers/:id/stations', async (req, res) => {
  const server = findServer(req.params.id);
  requireMember(server.id, req.user);
  res.json(stationPayload(await createStationFor(server, req.user, req.body.name), server));
});

stationRoutes.get('/stations/:id', (req, res) => res.json(stationPayload(loadStation(req))));

stationRoutes.delete('/stations/:id', async (req, res) => {
  const st = loadStation(req);
  const role = db.members.find((m) => m.serverId === st.serverId && m.userId === req.user.id).role;
  if (st.userId !== req.user.id && role === 'member') throw new HttpError(403, 'Só o dono da estação ou um admin pode removê-la');
  unwatchStation(st.id);
  await repo.removeStation(st);
  db.stations = db.stations.filter((s) => s.id !== st.id);
  save();
  emitServer(st.serverId, 'server:updated', { serverId: st.serverId });
  res.json({ ok: true });
});

// Destino SSH do ambiente, para o VS Code abrir o terminal com o ssh nativo
// quando a conexão feita pelo DevCord (com a chave dele) não estiver autorizada.
stationRoutes.get('/stations/:id/ssh', (req, res) => {
  const st = loadStation(req);
  if (findServer(st.serverId).allowTerminal === false) throw new HttpError(403, 'O terminal está desativado neste servidor');
  const dir = remoteDir(st);
  const { host, port, username, platform } = sshConfig;
  res.json({ host, port, username, platform, dir, command: shellCommand(dir) });
});

stationRoutes.get('/stations/:id/status', async (req, res) => {
  res.json(await repo.stationStatus(loadStation(req)));
});

stationRoutes.post('/stations/:id/commit', async (req, res) => {
  const st = loadStation(req);
  const message = String(req.body.message || '').trim() || `Trabalho de ${req.user.username} em ${st.name}`;
  const committed = await repo.commitStation(st, message, req.user);
  if (committed) repoChanged(st.serverId, st.id);
  res.json({ committed });
});

stationRoutes.post('/stations/:id/sync', async (req, res) => {
  const st = loadStation(req);
  const result = await repo.syncStation(st, req.user);
  repoChanged(st.serverId, st.id);
  res.json(result);
});

stationRoutes.post('/stations/:id/integrate', async (req, res) => {
  const st = loadStation(req);
  const result = await repo.integrateStation(st, req.user);
  repoChanged(st.serverId, st.id);
  if (result.ok) {
    emitServer(st.serverId, 'integrated', { serverId: st.serverId, stationId: st.id, stationName: st.name, userId: req.user.id, at: now() });
    completeTasksForStation(st, req.user);
  }
  res.json(result);
});

stationRoutes.get('/servers/:id/log', async (req, res) => {
  requireMember(req.params.id, req.user);
  res.json(await repo.repoLog(req.params.id));
});

stationRoutes.get('/servers/:id/activity', (req, res) => {
  requireMember(req.params.id, req.user);
  res.json(recentActivity(req.params.id));
});

// ---- Sistema de arquivos da estação (usado pelo devcord:// no VS Code) ----
// Tudo passa por resolveInStation: só a pasta do projeto é acessível.

function statOf(abs) {
  try {
    return fs.statSync(abs);
  } catch {
    throw new HttpError(404, 'Arquivo não encontrado');
  }
}

// Manifesto (caminho + hash) usado para replicar o ambiente na máquina de quem vai testar.
stationRoutes.get('/stations/:id/manifest', (req, res) => {
  const root = path.resolve(repo.stationDir(loadStation(req)));
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (REPLICA_IGNORE.has(e.name)) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.isFile()) {
        const buf = fs.readFileSync(abs);
        files.push({
          path: path.relative(root, abs).split(path.sep).join('/'),
          size: buf.length,
          hash: crypto.createHash('sha1').update(buf).digest('hex'),
        });
      }
    }
  };
  walk(root);
  res.json({ ignore: [...REPLICA_IGNORE], files });
});

stationRoutes.get('/stations/:id/fs/stat', (req, res) => {
  const s = statOf(resolveInStation(loadStation(req), req.query.path));
  res.json({ type: s.isDirectory() ? 'dir' : 'file', size: s.size, mtime: s.mtimeMs, ctime: s.ctimeMs });
});

stationRoutes.get('/stations/:id/fs/list', (req, res) => {
  const st = loadStation(req);
  const abs = resolveInStation(st, req.query.path);
  if (!statOf(abs).isDirectory()) throw new HttpError(400, 'Não é uma pasta');
  const isRoot = abs === path.resolve(repo.stationDir(st));
  const entries = fs
    .readdirSync(abs, { withFileTypes: true })
    .filter((e) => !(isRoot && e.name === '.git'))
    .map((e) => [e.name, e.isDirectory() ? 'dir' : 'file']);
  res.json(entries);
});

stationRoutes.get('/stations/:id/fs/read', (req, res) => {
  const abs = resolveInStation(loadStation(req), req.query.path);
  if (statOf(abs).isDirectory()) throw new HttpError(400, 'É uma pasta');
  res.type('application/octet-stream').send(fs.readFileSync(abs));
});

stationRoutes.put('/stations/:id/fs/write', express.raw({ type: '*/*', limit: '100mb' }), (req, res) => {
  const abs = resolveInStation(loadStation(req), req.query.path);
  const exists = fs.existsSync(abs);
  if (!exists && req.query.create === 'false') throw new HttpError(404, 'Arquivo não encontrado');
  if (exists && req.query.overwrite === 'false') throw new HttpError(409, 'Arquivo já existe');
  if (!fs.existsSync(path.dirname(abs))) throw new HttpError(404, 'Pasta não encontrada');
  noteWriter(abs, req.user);
  fs.writeFileSync(abs, Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0));
  res.json({ ok: true });
});

stationRoutes.post('/stations/:id/fs/mkdir', (req, res) => {
  fs.mkdirSync(resolveInStation(loadStation(req), req.query.path), { recursive: true });
  res.json({ ok: true });
});

stationRoutes.delete('/stations/:id/fs', (req, res) => {
  const st = loadStation(req);
  const abs = resolveInStation(st, req.query.path);
  if (abs === path.resolve(repo.stationDir(st))) throw new HttpError(403, 'Não é possível apagar a raiz do projeto');
  statOf(abs);
  noteWriter(abs, req.user);
  fs.rmSync(abs, { recursive: req.query.recursive === 'true' });
  res.json({ ok: true });
});

stationRoutes.post('/stations/:id/fs/rename', (req, res) => {
  const st = loadStation(req);
  const from = resolveInStation(st, req.body.from);
  const to = resolveInStation(st, req.body.to);
  statOf(from);
  if (fs.existsSync(to) && !req.body.overwrite) throw new HttpError(409, 'Destino já existe');
  noteWriter(from, req.user);
  noteWriter(to, req.user);
  fs.renameSync(from, to);
  res.json({ ok: true });
});
