import jwt from 'jsonwebtoken';
import { JWT_SECRET } from './config.js';
import { db } from './db.js';

export const signToken = (user) => jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: '30d' });

export function userFromToken(token) {
  if (!token) return null;
  try {
    const { sub } = jwt.verify(token, JWT_SECRET);
    return db.users.find((u) => u.id === sub) || null;
  } catch {
    return null;
  }
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const user = userFromToken(header.startsWith('Bearer ') ? header.slice(7) : null);
  if (!user) return res.status(401).json({ error: 'Não autenticado' });
  req.user = user;
  next();
}
