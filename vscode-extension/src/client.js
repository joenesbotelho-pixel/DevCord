import * as vscode from 'vscode';
import { io } from 'socket.io-client';

const TOKEN_KEY = 'devcord.token';
// Eventos do servidor repassados ao painel e ao sistema de arquivos.
const EVENTS = ['message:new', 'typing', 'presence', 'server:updated', 'activity', 'repo:changed', 'integrated', 'task:updated'];

export class DevcordClient {
  constructor(context) {
    this.context = context;
    this.user = null;
    this.socket = null;
    this._onEvent = new vscode.EventEmitter();
    this.onEvent = this._onEvent.event;
    this._onAuth = new vscode.EventEmitter();
    this.onAuth = this._onAuth.event;
    this.ready = this.init();
  }

  get url() {
    return vscode.workspace.getConfiguration('devcord').get('serverUrl', 'http://localhost:3001').replace(/\/+$/, '');
  }

  token() {
    return this.context.secrets.get(TOKEN_KEY);
  }

  async init() {
    const token = await this.token();
    if (!token) return;
    try {
      this.user = await this.json('/me');
      this.connect(token);
    } catch (err) {
      if (err.status === 401) await this.context.secrets.delete(TOKEN_KEY);
      this.user = null;
    }
    this._onAuth.fire(this.user);
  }

  async login(username, password, register = false) {
    const res = await fetch(`${this.url}/api/auth/${register ? 'register' : 'login'}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);
    await this.context.secrets.store(TOKEN_KEY, data.token);
    this.user = data.user;
    this.connect(data.token);
    this._onAuth.fire(this.user);
    return this.user;
  }

  async logout() {
    await this.context.secrets.delete(TOKEN_KEY);
    this.socket?.disconnect();
    this.socket = null;
    this.user = null;
    this._onAuth.fire(null);
  }

  async reconnect() {
    this.socket?.disconnect();
    this.socket = null;
    this.user = null;
    this.ready = this.init();
    await this.ready;
  }

  connect(token) {
    this.socket?.disconnect();
    this.socket = io(this.url, { auth: { token }, transports: ['websocket'] });
    for (const event of EVENTS) this.socket.on(event, (data) => this._onEvent.fire({ event, data }));
  }

  emit(event, data) {
    return new Promise((resolve) => {
      if (!this.socket) return resolve({ error: 'Não conectado ao DevCord' });
      this.socket.timeout(15000).emit(event, data, (err, res) => resolve(err ? { error: 'O servidor não respondeu' } : res || {}));
    });
  }

  async req(path, { method = 'GET', body, raw } = {}) {
    const headers = {};
    const token = await this.token();
    if (token) headers.Authorization = `Bearer ${token}`;
    let payload;
    if (raw) {
      headers['Content-Type'] = 'application/octet-stream';
      payload = raw;
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetch(`${this.url}/api${path}`, { method, headers, body: payload });
    } catch {
      const err = new Error(`Não foi possível conectar ao servidor DevCord em ${this.url}`);
      err.status = 0;
      throw err;
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const err = new Error(data.error || res.statusText);
      err.status = res.status;
      throw err;
    }
    return res;
  }

  async json(path, opts) {
    return (await this.req(path, opts)).json();
  }
}
