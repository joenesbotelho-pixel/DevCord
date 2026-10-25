// Ponto central de tempo real: guarda o Socket.IO e quem está online.
export const hub = {
  io: null,
  online: new Map(), // userId -> número de conexões abertas
};

export const isOnline = (userId) => (hub.online.get(userId) || 0) > 0;

export function emitServer(serverId, event, data) {
  hub.io?.to(`server:${serverId}`).emit(event, data);
}
