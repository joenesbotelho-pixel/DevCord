import { Router } from 'express';
import crypto from 'node:crypto';
import {
  db, save, newId, now, HttpError, publicUser,
  memberOf, requireMember, requireAdmin, findServer,
} from '../db.js';
import { requireAuth } from '../auth.js';
import { hub, isOnline, emitServer } from '../hub.js';
import { initRepo } from '../repo.js';
import { sshStatus, testConnection } from '../ssh.js';
import { stationPayload, ensureEnvironment } from './stations.js';

export const serverRoutes = Router();
serverRoutes.use(requireAuth);

const CHANNEL_TYPES = ['text', 'voice', 'tasks', 'workspace', 'screen'];

function serverPayload(server) {
  return {
    ...server,
    departments: db.departments.filter((d) => d.serverId === server.id).sort((a, b) => a.position - b.position),
    channels: db.channels.filter((c) => c.serverId === server.id).sort((a, b) => a.position - b.position),
    members: db.members
      .filter((m) => m.serverId === server.id)
      .map((m) => {
        const u = db.users.find((u) => u.id === m.userId);
        return u && { ...publicUser(u), role: m.role, online: isOnline(u.id) };
      })
      .filter(Boolean),
    stations: db.stations.filter((s) => s.serverId === server.id).map((s) => stationPayload(s, server)),
  };
}

const touched = (serverId) => emitServer(serverId, 'server:updated', { serverId });

function addDepartment(serverId, name) {
  const position = db.departments.filter((d) => d.serverId === serverId).length;
  const dep = { id: newId(), serverId, name, position };
  db.departments.push(dep);
  return dep;
}

function addChannel(serverId, departmentId, name, type = 'text') {
  const position = db.channels.filter((c) => c.departmentId === departmentId).length;
  const ch = { id: newId(), serverId, departmentId, name, type, position };
  db.channels.push(ch);
  return ch;
}

// Canais de texto no estilo Discord ("chat-dev"); canais de voz mantêm o nome como digitado ("Sala de Voz").
const channelName = (s, type) => {
  const name = String(s || '').trim().slice(0, 40);
  return type === 'voice' ? name : name.toLowerCase().replace(/\s+/g, '-');
};

// Servidores criados antes da voz/tarefas existirem ganham esses canais ao iniciar.
export function ensureDefaultChannels() {
  let changed = false;
  for (const server of db.servers) {
    const deps = db.departments.filter((d) => d.serverId === server.id).sort((a, b) => a.position - b.position);
    const channels = db.channels.filter((c) => c.serverId === server.id);
    const first = deps[0] || addDepartment(server.id, 'Geral');
    const dev = deps.find((d) => /desenvolv/i.test(d.name)) || first;
    if (!channels.some((c) => c.type === 'voice')) {
      addChannel(server.id, first.id, 'Sala de Voz', 'voice');
      changed = true;
    }
    if (!channels.some((c) => c.type === 'tasks')) {
      addChannel(server.id, dev.id, 'tarefas', 'tasks');
      changed = true;
    }
  }
  if (changed) save();
}

// Coloca os sockets já conectados do usuário na sala do servidor.
function joinRoom(userId, serverId) {
  for (const socket of hub.io?.sockets.sockets.values() || []) {
    if (socket.user?.id === userId) socket.join(`server:${serverId}`);
  }
}

serverRoutes.get('/servers', (req, res) => {
  const ids = new Set(db.members.filter((m) => m.userId === req.user.id).map((m) => m.serverId));
  res.json(db.servers.filter((s) => ids.has(s.id)).map(({ id, name, ownerId }) => ({ id, name, ownerId })));
});

serverRoutes.post('/servers', async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) throw new HttpError(400, 'Dê um nome ao servidor');
  const server = { id: newId(), name: name.slice(0, 60), ownerId: req.user.id, allowTerminal: true, createdAt: now() };
  await initRepo(server, req.user);
  db.servers.push(server);
  db.members.push({ serverId: server.id, userId: req.user.id, role: 'owner', joinedAt: now() });

  const geral = addDepartment(server.id, 'Geral');
  addChannel(server.id, geral.id, 'boas-vindas');
  addChannel(server.id, geral.id, 'anuncios');
  addChannel(server.id, geral.id, 'Sala de Voz', 'voice');
  const dev = addDepartment(server.id, 'Desenvolvimento');
  addChannel(server.id, dev.id, 'chat-dev');
  addChannel(server.id, dev.id, 'tarefas', 'tasks');
  addChannel(server.id, dev.id, 'Voz Dev', 'voice');
  addChannel(server.id, dev.id, 'estacoes', 'workspace');
  addChannel(server.id, dev.id, 'tela', 'screen');
  save();
  joinRoom(req.user.id, server.id);
  await ensureEnvironment(server, req.user);
  res.json(serverPayload(server));
});

serverRoutes.get('/servers/:id', (req, res) => {
  const server = findServer(req.params.id);
  requireMember(server.id, req.user);
  res.json(serverPayload(server));
});

serverRoutes.patch('/servers/:id', (req, res) => {
  const server = findServer(req.params.id);
  requireAdmin(server.id, req.user);
  if (typeof req.body.name === 'string' && req.body.name.trim()) server.name = req.body.name.trim().slice(0, 60);
  if (typeof req.body.allowTerminal === 'boolean') server.allowTerminal = req.body.allowTerminal;
  save();
  touched(server.id);
  res.json(serverPayload(server));
});

// Conexão SSH que o DevCord usa para abrir os terminais na máquina hospedeira.
serverRoutes.get('/servers/:id/ssh', (req, res) => {
  requireAdmin(findServer(req.params.id).id, req.user);
  res.json(sshStatus());
});

serverRoutes.post('/servers/:id/ssh/test', async (req, res) => {
  requireAdmin(findServer(req.params.id).id, req.user);
  res.json(await testConnection());
});

serverRoutes.post('/servers/:id/departments', (req, res) => {
  const server = findServer(req.params.id);
  requireAdmin(server.id, req.user);
  const name = String(req.body.name || '').trim();
  if (!name) throw new HttpError(400, 'Dê um nome ao departamento');
  const dep = addDepartment(server.id, name.slice(0, 40));
  save();
  touched(server.id);
  res.json(dep);
});

serverRoutes.delete('/departments/:id', (req, res) => {
  const dep = db.departments.find((d) => d.id === req.params.id);
  if (!dep) throw new HttpError(404, 'Departamento não encontrado');
  requireAdmin(dep.serverId, req.user);
  const channelIds = new Set(db.channels.filter((c) => c.departmentId === dep.id).map((c) => c.id));
  db.messages = db.messages.filter((m) => !channelIds.has(m.channelId));
  db.tasks = db.tasks.filter((t) => !channelIds.has(t.channelId));
  db.channels = db.channels.filter((c) => c.departmentId !== dep.id);
  db.departments = db.departments.filter((d) => d.id !== dep.id);
  save();
  touched(dep.serverId);
  res.json({ ok: true });
});

serverRoutes.post('/servers/:id/channels', (req, res) => {
  const server = findServer(req.params.id);
  requireAdmin(server.id, req.user);
  const dep = db.departments.find((d) => d.id === req.body.departmentId && d.serverId === server.id);
  if (!dep) throw new HttpError(400, 'Departamento inválido');
  const type = CHANNEL_TYPES.includes(req.body.type) ? req.body.type : 'text';
  const name = channelName(req.body.name, type);
  if (!name) throw new HttpError(400, 'Dê um nome ao canal');
  const ch = addChannel(server.id, dep.id, name, type);
  save();
  touched(server.id);
  res.json(ch);
});

serverRoutes.delete('/channels/:id', (req, res) => {
  const ch = db.channels.find((c) => c.id === req.params.id);
  if (!ch) throw new HttpError(404, 'Canal não encontrado');
  requireAdmin(ch.serverId, req.user);
  db.channels = db.channels.filter((c) => c.id !== ch.id);
  db.messages = db.messages.filter((m) => m.channelId !== ch.id);
  db.tasks = db.tasks.filter((t) => t.channelId !== ch.id);
  save();
  touched(ch.serverId);
  res.json({ ok: true });
});

serverRoutes.get('/channels/:id/messages', (req, res) => {
  const ch = db.channels.find((c) => c.id === req.params.id);
  if (!ch) throw new HttpError(404, 'Canal não encontrado');
  requireMember(ch.serverId, req.user);
  res.json(db.messages.filter((m) => m.channelId === ch.id).slice(-150));
});

// ---- Convites ----

serverRoutes.post('/servers/:id/invites', (req, res) => {
  const server = findServer(req.params.id);
  requireMember(server.id, req.user);
  const hours = Number(req.body.expiresInHours) || 24 * 7;
  const invite = {
    code: crypto.randomBytes(5).toString('base64url'),
    serverId: server.id,
    createdBy: req.user.id,
    uses: 0,
    maxUses: Number(req.body.maxUses) || 0, // 0 = ilimitado
    expiresAt: new Date(Date.now() + hours * 3600_000).toISOString(),
  };
  db.invites.push(invite);
  save();
  res.json(invite);
});

function validInvite(code) {
  const inv = db.invites.find((i) => i.code === code);
  if (!inv) throw new HttpError(404, 'Convite inválido');
  if (new Date(inv.expiresAt) < new Date()) throw new HttpError(410, 'Convite expirado');
  if (inv.maxUses && inv.uses >= inv.maxUses) throw new HttpError(410, 'Convite esgotado');
  return inv;
}

serverRoutes.get('/invites/:code', (req, res) => {
  const inv = validInvite(req.params.code);
  const server = findServer(inv.serverId);
  res.json({
    code: inv.code,
    server: { id: server.id, name: server.name },
    members: db.members.filter((m) => m.serverId === server.id).length,
  });
});

serverRoutes.post('/invites/:code/join', async (req, res) => {
  const inv = validInvite(req.params.code);
  if (!memberOf(inv.serverId, req.user.id)) {
    db.members.push({ serverId: inv.serverId, userId: req.user.id, role: 'member', joinedAt: now() });
    inv.uses++;
    save();
    joinRoom(req.user.id, inv.serverId);
    touched(inv.serverId);
  }
  // Quem entra já ganha o próprio ambiente de trabalho pronto.
  await ensureEnvironment(findServer(inv.serverId), req.user);
  res.json({ serverId: inv.serverId });
});

serverRoutes.patch('/servers/:id/members/:userId', (req, res) => {
  const server = findServer(req.params.id);
  requireAdmin(server.id, req.user);
  const m = memberOf(server.id, req.params.userId);
  if (!m || m.role === 'owner') throw new HttpError(400, 'Membro inválido');
  if (!['admin', 'member'].includes(req.body.role)) throw new HttpError(400, 'Cargo inválido');
  m.role = req.body.role;
  save();
  touched(server.id);
  res.json({ ok: true });
});
