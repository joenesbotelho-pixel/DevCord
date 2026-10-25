import { io } from 'socket.io-client';

const BASE = import.meta.env.VITE_API_URL || '';
const TOKEN_KEY = 'devcord_token';

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

export async function api(path, { method = 'GET', body } = {}) {
  const token = getToken();
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

// Configuração WebRTC (STUN/TURN) vinda do servidor; buscada uma vez só.
let rtcConfig;
export function getRtcConfig() {
  rtcConfig ||= fetch(`${BASE}/api/rtc`)
    .then((r) => r.json())
    .catch(() => ({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }));
  return rtcConfig;
}

export const connectSocket = () => io(BASE || undefined, { auth: { token: getToken() } });

// Link que a extensão DevCord do VS Code entende (registerUriHandler).
export function vscodeLink(stationId) {
  const server = BASE || window.location.origin;
  return `vscode://devcord.devcord-vscode/open?station=${stationId}&server=${encodeURIComponent(server)}`;
}

export const inviteUrl = (code) => `${window.location.origin}/invite/${code}`;

export function timeLabel(iso) {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return today ? `Hoje às ${time}` : `${d.toLocaleDateString('pt-BR')} ${time}`;
}
