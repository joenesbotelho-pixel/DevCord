// Ponte webview <-> extensão: pedidos com resposta e eventos do servidor.
const vscode = acquireVsCodeApi();
let seq = 0;
const pending = new Map();
const listeners = new Set();

window.addEventListener('message', ({ data: m }) => {
  if (m?.type === 'response') {
    const p = pending.get(m.id);
    pending.delete(m.id);
    if (m.error) p?.reject(new Error(m.error));
    else p?.resolve(m.data);
  } else if (m) {
    listeners.forEach((fn) => fn(m));
  }
});

export function call(action, payload) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    vscode.postMessage({ type: 'request', id, action, payload });
  });
}

export const api = (path, method = 'GET', body) => call('api', { path, method, body });

export function onMessage(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const saveState = (s) => vscode.setState(s);
export const loadState = () => vscode.getState() || {};
