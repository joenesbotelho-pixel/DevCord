import * as vscode from 'vscode';

// devcord://<stationId>/caminho  ->  arquivos do ambiente no servidor.
// O servidor só responde pelo que está DENTRO da pasta do ambiente; tudo fora é negado.
export class DevcordFileSystem {
  constructor(client) {
    this.client = client;
    this._emitter = new vscode.EventEmitter();
    this.onDidChangeFile = this._emitter.event;

    // Edições feitas por outras pessoas (ou pelo terminal) atualizam os editores abertos.
    client.onEvent(({ event, data }) => {
      if (event !== 'activity') return;
      const uri = vscode.Uri.from({ scheme: 'devcord', authority: data.stationId, path: `/${data.file}` });
      this._emitter.fire([{ type: data.action === 'delete' ? vscode.FileChangeType.Deleted : vscode.FileChangeType.Changed, uri }]);
    });
  }

  base(uri, op) {
    return `/stations/${uri.authority}/fs/${op}?path=${encodeURIComponent(uri.path || '/')}`;
  }

  async call(uri, fn) {
    await this.client.ready;
    try {
      return await fn();
    } catch (err) {
      if (err.status === 404) throw vscode.FileSystemError.FileNotFound(uri);
      if (err.status === 409) throw vscode.FileSystemError.FileExists(uri);
      if (err.status === 401 || err.status === 403) throw vscode.FileSystemError.NoPermissions(err.message);
      throw vscode.FileSystemError.Unavailable(err.message);
    }
  }

  watch() {
    return new vscode.Disposable(() => {});
  }

  stat(uri) {
    return this.call(uri, async () => {
      const s = await this.client.json(this.base(uri, 'stat'));
      return { type: s.type === 'dir' ? vscode.FileType.Directory : vscode.FileType.File, size: s.size, mtime: s.mtime, ctime: s.ctime };
    });
  }

  readDirectory(uri) {
    return this.call(uri, async () => {
      const list = await this.client.json(this.base(uri, 'list'));
      return list.map(([name, type]) => [name, type === 'dir' ? vscode.FileType.Directory : vscode.FileType.File]);
    });
  }

  readFile(uri) {
    return this.call(uri, async () => new Uint8Array(await (await this.client.req(this.base(uri, 'read'))).arrayBuffer()));
  }

  writeFile(uri, content, options) {
    return this.call(uri, async () => {
      const q = `&create=${options.create}&overwrite=${options.overwrite}`;
      await this.client.req(this.base(uri, 'write') + q, { method: 'PUT', raw: content });
      this._emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
    });
  }

  createDirectory(uri) {
    return this.call(uri, async () => {
      await this.client.req(this.base(uri, 'mkdir'), { method: 'POST' });
      this._emitter.fire([{ type: vscode.FileChangeType.Created, uri }]);
    });
  }

  delete(uri, options) {
    return this.call(uri, async () => {
      await this.client.req(`/stations/${uri.authority}/fs?path=${encodeURIComponent(uri.path)}&recursive=${options.recursive}`, { method: 'DELETE' });
      this._emitter.fire([{ type: vscode.FileChangeType.Deleted, uri }]);
    });
  }

  rename(oldUri, newUri, options) {
    return this.call(oldUri, async () => {
      await this.client.req(`/stations/${oldUri.authority}/fs/rename`, {
        method: 'POST',
        body: { from: oldUri.path, to: newUri.path, overwrite: options.overwrite },
      });
      this._emitter.fire([
        { type: vscode.FileChangeType.Deleted, uri: oldUri },
        { type: vscode.FileChangeType.Created, uri: newUri },
      ]);
    });
  }
}
