import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db, save, newId, now, HttpError, publicUser } from '../db.js';
import { signToken, requireAuth } from '../auth.js';

const COLORS = ['#5865f2', '#57f287', '#fee75c', '#eb459e', '#ed4245', '#f0b232', '#3ba55c', '#00a8fc'];

export const authRoutes = Router();

authRoutes.post('/auth/register', async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  if (!/^[a-zA-Z0-9_.-]{3,24}$/.test(username)) throw new HttpError(400, 'Usuário deve ter 3–24 letras, números, _ . ou -');
  if (password.length < 6) throw new HttpError(400, 'A senha precisa ter pelo menos 6 caracteres');
  if (db.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) throw new HttpError(409, 'Esse usuário já existe');
  const user = {
    id: newId(),
    username,
    passwordHash: await bcrypt.hash(password, 10),
    color: COLORS[db.users.length % COLORS.length],
    createdAt: now(),
  };
  db.users.push(user);
  save();
  res.json({ token: signToken(user), user: publicUser(user) });
});

authRoutes.post('/auth/login', async (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const user = db.users.find((u) => u.username.toLowerCase() === username);
  if (!user || !(await bcrypt.compare(String(req.body.password || ''), user.passwordHash))) {
    throw new HttpError(401, 'Usuário ou senha incorretos');
  }
  res.json({ token: signToken(user), user: publicUser(user) });
});

authRoutes.get('/me', requireAuth, (req, res) => res.json(publicUser(req.user)));
