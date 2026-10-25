import { db, save, newId, now, memberOf, findServer } from './db.js';
import { userFromToken } from './auth.js';
import { hub } from './hub.js';
import { openShell, sshConfig } from './ssh.js';

const screenSharers = new Map(); // channelId -> socketId de quem está transmitindo
const voiceRooms = new Map(); // channelId -> Map(socketId -> { userId, muted, deafened })

function voiceState(channelId) {
  const room = voiceRooms.get(channelId) || new Map();
  return { channelId, participants: [...room].map(([socketId, p]) => ({ socketId, ...p })) };
}

export function setupRealtime(io) {
  hub.io = io;

  io.use((socket, next) => {
    const user = userFromToken(socket.handshake.auth?.token);
    if (!user) return next(new Error('unauthorized'));
    socket.user = user;
    next();
  });

  io.on('connection', (socket) => {
    const user = socket.user;
    const serverIds = () => db.members.filter((m) => m.userId === user.id).map((m) => m.serverId);
    for (const id of serverIds()) socket.join(`server:${id}`);

    const setPresence = (delta) => {
      const count = (hub.online.get(user.id) || 0) + delta;
      hub.online.set(user.id, Math.max(0, count));
      if ((delta > 0 && count === 1) || (delta < 0 && count === 0)) {
        for (const id of serverIds()) io.to(`server:${id}`).emit('presence', { userId: user.id, online: count > 0 });
      }
    };
    setPresence(1);

    const channelFor = (channelId) => {
      const ch = db.channels.find((c) => c.id === channelId);
      return ch && memberOf(ch.serverId, user.id) ? ch : null;
    };

    // ---- Chat ----
    socket.on('message:send', ({ channelId, content } = {}, ack) => {
      const ch = channelFor(channelId);
      const text = String(content || '').trim().slice(0, 4000);
      if (!ch || !text) return ack?.({ error: 'Mensagem inválida' });
      const msg = { id: newId(), channelId, userId: user.id, content: text, createdAt: now() };
      db.messages.push(msg);
      save();
      io.to(`server:${ch.serverId}`).emit('message:new', msg);
      ack?.({ ok: true, message: msg });
    });

    socket.on('typing', ({ channelId } = {}) => {
      const ch = channelFor(channelId);
      if (ch) socket.to(`server:${ch.serverId}`).emit('typing', { channelId, userId: user.id });
    });

    // ---- Compartilhamento de tela (WebRTC; o servidor só faz a sinalização) ----
    socket.on('screen:start', ({ channelId } = {}) => {
      const ch = channelFor(channelId);
      if (!ch) return;
      screenSharers.set(channelId, socket.id);
      io.to(`server:${ch.serverId}`).emit('screen:state', { channelId, sharerId: user.id, sharerSocket: socket.id });
    });

    const stopShare = (channelId) => {
      if (screenSharers.get(channelId) !== socket.id) return;
      screenSharers.delete(channelId);
      const ch = db.channels.find((c) => c.id === channelId);
      if (ch) io.to(`server:${ch.serverId}`).emit('screen:state', { channelId, sharerId: null, sharerSocket: null });
    };
    socket.on('screen:stop', ({ channelId } = {}) => stopShare(channelId));

    socket.on('screen:get', ({ channelId } = {}, ack) => {
      if (!channelFor(channelId)) return ack?.(null);
      const sharerSocket = screenSharers.get(channelId);
      const sharer = sharerSocket && io.sockets.sockets.get(sharerSocket);
      ack?.({ channelId, sharerId: sharer?.user.id || null, sharerSocket: sharer ? sharerSocket : null });
    });

    socket.on('screen:watch', ({ channelId } = {}) => {
      const sharerSocket = channelFor(channelId) && screenSharers.get(channelId);
      if (sharerSocket) io.to(sharerSocket).emit('screen:viewer', { channelId, viewerSocket: socket.id, viewerId: user.id });
    });

    socket.on('screen:signal', ({ to, data } = {}) => {
      if (typeof to === 'string') io.to(to).emit('screen:signal', { from: socket.id, data });
    });

    // ---- Canais de voz (WebRTC em malha; o servidor só faz a sinalização) ----
    let voiceChannel = null;
    const emitVoice = (channelId) => {
      const ch = db.channels.find((c) => c.id === channelId);
      if (ch) io.to(`server:${ch.serverId}`).emit('voice:state', voiceState(channelId));
    };
    const leaveVoice = () => {
      if (!voiceChannel) return;
      const room = voiceRooms.get(voiceChannel);
      room?.delete(socket.id);
      if (room && !room.size) voiceRooms.delete(voiceChannel);
      emitVoice(voiceChannel);
      voiceChannel = null;
    };

    socket.on('voice:join', ({ channelId } = {}, ack) => {
      const ch = channelFor(channelId);
      if (!ch || ch.type !== 'voice') return ack?.({ error: 'Canal de voz não encontrado' });
      leaveVoice();
      const room = voiceRooms.get(channelId) || new Map();
      voiceRooms.set(channelId, room);
      const peers = [...room.keys()];
      room.set(socket.id, { userId: user.id, muted: false, deafened: false });
      voiceChannel = channelId;
      emitVoice(channelId);
      // Quem entra liga para quem já está na sala.
      ack?.({ peers });
    });

    socket.on('voice:leave', leaveVoice);

    socket.on('voice:update', ({ muted, deafened } = {}) => {
      const p = voiceRooms.get(voiceChannel)?.get(socket.id);
      if (!p) return;
      p.muted = Boolean(muted);
      p.deafened = Boolean(deafened);
      emitVoice(voiceChannel);
    });

    socket.on('voice:signal', ({ to, data } = {}) => {
      if (voiceRooms.get(voiceChannel)?.has(to)) io.to(to).emit('voice:signal', { from: socket.id, data });
    });

    // Estado de todas as salas de voz de um servidor (para a barra lateral).
    socket.on('voice:list', ({ serverId } = {}, ack) => {
      if (!memberOf(serverId, user.id)) return ack?.([]);
      ack?.(db.channels.filter((c) => c.serverId === serverId && c.type === 'voice').map((c) => voiceState(c.id)));
    });

    // ---- Terminal: sessão SSH aberta pelo DevCord na pasta do ambiente ----
    const terminals = new Map();

    socket.on('term:open', async ({ stationId, cols, rows } = {}, ack) => {
      const station = db.stations.find((s) => s.id === stationId);
      if (!station || !memberOf(station.serverId, user.id)) return ack?.({ error: 'Estação não encontrada' });
      if (findServer(station.serverId).allowTerminal === false) return ack?.({ error: 'O terminal está desativado neste servidor' });
      const termId = newId();
      try {
        const term = await openShell(
          station,
          { cols, rows },
          (data) => socket.emit('term:data', { termId, data }),
          (code) => {
            terminals.delete(termId);
            socket.emit('term:exit', { termId, code });
          },
        );
        if (socket.disconnected) return term.kill();
        terminals.set(termId, term);
      } catch (err) {
        return ack?.({ error: err.message });
      }
      console.log(`[ssh] ${user.username} abriu terminal em "${station.name}"`);
      ack?.({ termId, interactive: true, host: `${sshConfig.username}@${sshConfig.host}` });
    });

    socket.on('term:input', ({ termId, data } = {}) => terminals.get(termId)?.write(String(data)));
    socket.on('term:resize', ({ termId, cols, rows } = {}) => terminals.get(termId)?.resize(cols, rows));
    socket.on('term:close', ({ termId } = {}) => {
      terminals.get(termId)?.kill();
      terminals.delete(termId);
    });

    socket.on('disconnect', () => {
      leaveVoice();
      for (const t of terminals.values()) t.kill();
      for (const [channelId, sid] of screenSharers) if (sid === socket.id) stopShare(channelId);
      setPresence(-1);
    });
  });
}
