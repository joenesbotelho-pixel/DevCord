import { Router } from 'express';
import { db, save, newId, now, HttpError, memberOf, requireMember } from '../db.js';
import { requireAuth } from '../auth.js';
import { emitServer } from '../hub.js';

// Sistema de trabalho: quadro de tarefas (kanban) ligado aos ambientes.
export const taskRoutes = Router();
taskRoutes.use(requireAuth);

export const STATUS_LABEL = { todo: 'A fazer', doing: 'Em andamento', review: 'Em revisão', done: 'Concluído' };
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];

function loadBoard(channelId, user) {
  const ch = db.channels.find((c) => c.id === channelId);
  if (!ch || ch.type !== 'tasks') throw new HttpError(404, 'Quadro de tarefas não encontrado');
  requireMember(ch.serverId, user);
  return ch;
}

function loadTask(id, user) {
  const task = db.tasks.find((t) => t.id === id);
  if (!task) throw new HttpError(404, 'Tarefa não encontrada');
  requireMember(task.serverId, user);
  return task;
}

const emitTask = (task) => emitServer(task.serverId, 'task:updated', task);
const log = (task, userId, text) => task.history.push({ at: now(), userId, text });
const username = (id) => db.users.find((u) => u.id === id)?.username || 'ninguém';

function applyFields(task, body, user) {
  if (typeof body.title === 'string') {
    const title = body.title.trim().slice(0, 140);
    if (!title) throw new HttpError(400, 'A tarefa precisa de um título');
    task.title = title;
  }
  if (typeof body.description === 'string') task.description = body.description.slice(0, 5000);
  if (PRIORITIES.includes(body.priority)) task.priority = body.priority;
  if ('dueDate' in body) task.dueDate = body.dueDate || null;
  if (typeof body.position === 'number') task.position = body.position;

  if ('assigneeId' in body && (body.assigneeId || null) !== task.assigneeId) {
    if (body.assigneeId && !memberOf(task.serverId, body.assigneeId)) throw new HttpError(400, 'Responsável inválido');
    task.assigneeId = body.assigneeId || null;
    log(task, user.id, task.assigneeId ? `atribuiu a ${username(task.assigneeId)}` : 'removeu o responsável');
  }
  if ('stationId' in body && (body.stationId || null) !== task.stationId) {
    const st = body.stationId && db.stations.find((s) => s.id === body.stationId && s.serverId === task.serverId);
    if (body.stationId && !st) throw new HttpError(400, 'Ambiente inválido');
    task.stationId = st ? st.id : null;
    log(task, user.id, st ? `ligou ao ambiente "${st.name}"` : 'desligou do ambiente');
  }
  if (STATUS_LABEL[body.status] && body.status !== task.status) {
    task.status = body.status;
    log(task, user.id, `moveu para ${STATUS_LABEL[task.status]}`);
  }
  task.updatedAt = now();
}

taskRoutes.get('/channels/:id/tasks', (req, res) => {
  const board = loadBoard(req.params.id, req.user);
  res.json(db.tasks.filter((t) => t.channelId === board.id));
});

// Todas as tarefas do servidor (usado pelo painel do VS Code).
taskRoutes.get('/servers/:id/tasks', (req, res) => {
  requireMember(req.params.id, req.user);
  res.json(db.tasks.filter((t) => t.serverId === req.params.id));
});

taskRoutes.post('/channels/:id/tasks', (req, res) => {
  const board = loadBoard(req.params.id, req.user);
  const siblings = db.tasks.filter((t) => t.channelId === board.id);
  const task = {
    id: newId(),
    serverId: board.serverId,
    channelId: board.id,
    title: '',
    description: '',
    status: 'todo',
    priority: 'normal',
    assigneeId: null,
    stationId: null,
    dueDate: null,
    position: Math.max(0, ...siblings.map((t) => t.position || 0)) + 1,
    createdBy: req.user.id,
    createdAt: now(),
    updatedAt: now(),
    history: [],
  };
  log(task, req.user.id, 'criou a tarefa');
  applyFields(task, req.body, req.user);
  db.tasks.push(task);
  save();
  emitTask(task);
  res.json(task);
});

taskRoutes.patch('/tasks/:id', (req, res) => {
  const task = loadTask(req.params.id, req.user);
  applyFields(task, req.body, req.user);
  save();
  emitTask(task);
  res.json(task);
});

taskRoutes.delete('/tasks/:id', (req, res) => {
  const task = loadTask(req.params.id, req.user);
  db.tasks = db.tasks.filter((t) => t.id !== task.id);
  save();
  emitServer(task.serverId, 'task:updated', { id: task.id, channelId: task.channelId, serverId: task.serverId, deleted: true });
  res.json({ ok: true });
});

// Ao integrar um ambiente no main, as tarefas em andamento/revisão ligadas a ele são concluídas.
export function completeTasksForStation(station, user) {
  for (const task of db.tasks) {
    if (task.stationId !== station.id || !['doing', 'review'].includes(task.status)) continue;
    task.status = 'done';
    task.updatedAt = now();
    log(task, user.id, `concluída ao integrar "${station.name}" no main`);
    emitTask(task);
  }
  save();
}
