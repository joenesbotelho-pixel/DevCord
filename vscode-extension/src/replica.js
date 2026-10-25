import * as vscode from 'vscode';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Réplica local de um ambiente: uma cópia na máquina de quem vai testar,
// sincronizada nos dois sentidos PELO SERVIDOR.
//   local salvo   -> PUT no servidor -> equipe vê na hora
//   outro edita   -> evento "activity" -> baixa o arquivo para cá
// Dependências e builds (node_modules, dist, …) ficam só na máquina local.

const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex');
const readHash = (abs) => {
  try {
    return sha1(fs.readFileSync(abs));
  } catch {
    return null;
  }
};

export const replicaRoot = (context) => path.join(context.globalStorageUri.fsPath, 'replicas');
export const replicaDir = (context, stationId) => path.join(replicaRoot(context), stationId);

export class Replica {
  constructor(client, station, dir) {
    this.client = client;
    this.station = station;
    this.dir = dir;
    this.ignore = new Set(['.git']);
    this.synced = new Map(); // caminho relativo -> hash da última versão em comum com o servidor
    this.timers = new Map();
    this.disposables = [];
  }

  rel(abs) {
    return path.relative(this.dir, abs).split(path.sep).join('/');
  }

  isIgnored(rel) {
    return !rel || rel.startsWith('..') || rel.split('/').some((seg) => this.ignore.has(seg));
  }

  api(op, rel, extra = '') {
    return `/stations/${this.station.id}/fs/${op}?path=${encodeURIComponent('/' + rel)}${extra}`;
  }

  // Sincronização completa: baixa o que mudou no servidor e sobe o que só existe aqui.
  async pull() {
    fs.mkdirSync(this.dir, { recursive: true });
    const manifest = await this.client.json(`/stations/${this.station.id}/manifest`);
    this.ignore = new Set(manifest.ignore);
    const remote = new Set();
    for (const f of manifest.files) {
      remote.add(f.path);
      if (readHash(path.join(this.dir, f.path)) !== f.hash) await this.download(f.path, true);
      this.synced.set(f.path, f.hash);
    }
    for (const rel of this.localFiles()) if (!remote.has(rel)) await this.push(rel);
  }

  localFiles(dir = this.dir, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (this.isIgnored(this.rel(abs))) continue;
      if (e.isDirectory()) this.localFiles(abs, out);
      else if (e.isFile()) out.push(this.rel(abs));
    }
    return out;
  }

  async download(rel, force = false) {
    const abs = path.join(this.dir, rel);
    const local = readHash(abs);
    // Alteração local ainda não enviada: a versão local vence e sobe em seguida.
    if (!force && local !== null && local !== this.synced.get(rel)) return;
    const buf = Buffer.from(await (await this.client.req(this.api('read', rel))).arrayBuffer());
    const hash = sha1(buf);
    this.synced.set(rel, hash);
    if (hash === local) return;
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, buf);
  }

  async push(rel) {
    const abs = path.join(this.dir, rel);
    if (!fs.existsSync(abs)) {
      if (!this.synced.has(rel)) return;
      this.synced.delete(rel);
      await this.client.req(`/stations/${this.station.id}/fs?path=${encodeURIComponent('/' + rel)}&recursive=true`, { method: 'DELETE' }).catch(() => {});
      return;
    }
    if (fs.statSync(abs).isDirectory()) return;
    const buf = fs.readFileSync(abs);
    const hash = sha1(buf);
    if (this.synced.get(rel) === hash) return;
    const parent = path.posix.dirname(rel);
    if (parent !== '.') await this.client.req(this.api('mkdir', parent), { method: 'POST' });
    await this.client.req(this.api('write', rel), { method: 'PUT', raw: buf });
    this.synced.set(rel, hash);
  }

  schedule(rel, fn) {
    if (this.isIgnored(rel)) return;
    clearTimeout(this.timers.get(rel));
    this.timers.set(
      rel,
      setTimeout(() => {
        this.timers.delete(rel);
        fn(rel).catch((err) => console.error(`[devcord] replicação de ${rel}: ${err.message}`));
      }, 300),
    );
  }

  start() {
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(this.dir), '**/*'));
    const local = (uri) => this.schedule(this.rel(uri.fsPath), (r) => this.push(r));
    this.disposables.push(
      watcher,
      watcher.onDidChange(local),
      watcher.onDidCreate(local),
      watcher.onDidDelete(local),
      this.client.onEvent(({ event, data }) => {
        if (event !== 'activity' || data.stationId !== this.station.id) return;
        this.schedule(data.file, async (rel) => {
          if (data.action !== 'delete') return this.download(rel);
          const abs = path.join(this.dir, rel);
          if (readHash(abs) === this.synced.get(rel)) fs.rmSync(abs, { force: true });
          this.synced.delete(rel);
        });
      }),
    );
  }

  dispose() {
    this.timers.forEach(clearTimeout);
    this.disposables.forEach((d) => d.dispose());
  }
}
