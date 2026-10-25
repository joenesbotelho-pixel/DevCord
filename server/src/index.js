import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import { Server } from 'socket.io';
import { PORT, DATA_DIR } from './config.js';
import { authRoutes } from './routes/auth.js';
import { serverRoutes, ensureDefaultChannels } from './routes/servers.js';
import { stationRoutes } from './routes/stations.js';
import { taskRoutes } from './routes/tasks.js';
import { setupRealtime } from './realtime.js';
import { watchAllStations } from './workspace.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// Servidores ICE para voz e tela. Pela internet, algumas redes só conectam com um TURN:
// DEVCORD_TURN_URL=turn:host:3478 (várias separadas por vírgula), DEVCORD_TURN_USER, DEVCORD_TURN_PASS.
const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
if (process.env.DEVCORD_TURN_URL) {
  iceServers.push({
    urls: process.env.DEVCORD_TURN_URL.split(',').map((u) => u.trim()),
    username: process.env.DEVCORD_TURN_USER,
    credential: process.env.DEVCORD_TURN_PASS,
  });
}
app.get('/api/rtc', (req, res) => res.json({ iceServers }));

app.use('/api', authRoutes);
app.use('/api', stationRoutes);
app.use('/api', taskRoutes);
app.use('/api', serverRoutes);
app.use('/api', (req, res) => res.status(404).json({ error: 'Rota não encontrada' }));

// Em produção o servidor também entrega o app web compilado.
const webDist = path.join(import.meta.dirname, '..', '..', 'web', 'dist');
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^\/(?!api\/|socket\.io\/).*/, (req, res) => res.sendFile(path.join(webDist, 'index.html')));
}

app.use((err, req, res, _next) => {
  if (!err.status) console.error(err);
  res.status(err.status || 500).json({ error: err.status ? err.message : `Erro interno: ${err.message}` });
});

const server = http.createServer(app);
setupRealtime(new Server(server, { cors: { origin: '*' }, maxHttpBufferSize: 5e6 }));
watchAllStations();
ensureDefaultChannels();

server.listen(PORT, () => {
  console.log(`DevCord rodando em http://localhost:${PORT}`);
  console.log(`Dados em ${DATA_DIR}`);
});
