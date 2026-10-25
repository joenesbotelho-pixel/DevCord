import * as vscode from 'vscode';
import crypto from 'node:crypto';

// Painel React (webview) na barra lateral. O webview não acessa a rede:
// toda chamada passa pela extensão, que guarda o token com segurança.
export class PanelProvider {
  constructor(context, client, actions) {
    this.context = context;
    this.client = client;
    this.actions = actions;
    this.view = null;
  }

  resolveWebviewView(view) {
    this.view = view;
    const dist = vscode.Uri.joinPath(this.context.extensionUri, 'dist');
    view.webview.options = { enableScripts: true, localResourceRoots: [dist] };
    view.webview.html = this.html(view.webview, dist);

    const subs = [
      view.webview.onDidReceiveMessage((m) => this.onMessage(m)),
      this.client.onEvent((e) => this.post({ type: 'event', ...e })),
      this.client.onAuth((user) => this.post({ type: 'auth', user })),
    ];
    view.onDidDispose(() => subs.forEach((s) => s.dispose()));
  }

  post(msg) {
    this.view?.webview.postMessage(msg);
  }

  async onMessage(m) {
    if (m?.type !== 'request') return;
    try {
      this.post({ type: 'response', id: m.id, data: await this.handle(m.action, m.payload || {}) });
    } catch (err) {
      this.post({ type: 'response', id: m.id, error: err.message });
    }
  }

  async handle(action, p) {
    const { client, actions } = this;
    switch (action) {
      case 'state':
        await client.ready;
        return { user: client.user, serverUrl: client.url, currentStationId: actions.currentStationId() };
      case 'login':
        return client.login(p.username, p.password, p.register);
      case 'logout':
        return client.logout();
      case 'configure':
        return vscode.commands.executeCommand('workbench.action.openSettings', 'devcord.serverUrl');
      case 'api':
        return (await client.req(p.path, { method: p.method, body: p.body })).json();
      case 'emit':
        return client.emit(p.event, p.data);
      case 'openStation':
        return actions.openStation(p.stationId);
      case 'openEnvironment':
        return actions.openEnvironment(p.serverId);
      case 'terminal':
        return actions.openTerminal(p.stationId);
      case 'replicate':
        return actions.replicate(p.stationId);
      case 'commit':
        return actions.commit(p.stationId);
      case 'sync':
      case 'integrate':
        return actions.gitAction(action, p.stationId);
      default:
        throw new Error(`Ação desconhecida: ${action}`);
    }
  }

  html(webview, dist) {
    const nonce = crypto.randomBytes(16).toString('base64');
    const script = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'webview.js'));
    const style = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'webview.css'));
    return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${style}">
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }
}
