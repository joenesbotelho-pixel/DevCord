import * as vscode from 'vscode';
import { DevcordClient } from './client.js';
import { DevcordFileSystem } from './fsProvider.js';
import { openStationTerminal, forgetTerminal } from './terminal.js';
import { PanelProvider } from './panel.js';
import { Replica, replicaRoot, replicaDir } from './replica.js';
import path from 'node:path';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export function activate(context) {
  const client = new DevcordClient(context);

  // ---- Descobre em qual estação esta janela está trabalhando ----
  function currentStationId() {
    const active = vscode.window.activeTextEditor?.document.uri;
    if (active?.scheme === 'devcord') return active.authority;
    for (const f of vscode.workspace.workspaceFolders || []) {
      if (f.uri.scheme === 'devcord') return f.uri.authority;
      // Réplica local: …/replicas/<id>
      const m = f.uri.path.match(new RegExp(`/replicas/(${UUID.source})`, 'i'));
      if (m) return m[1];
    }
    return null;
  }

  async function requireLogin() {
    await client.ready;
    if (client.user) return true;
    const pick = await vscode.window.showInformationMessage('Entre no DevCord para continuar.', 'Entrar');
    if (pick) await vscode.commands.executeCommand('devcord.login');
    return Boolean(client.user);
  }

  async function pickServer() {
    const servers = await client.json('/servers');
    if (!servers.length) throw new Error('Você ainda não está em nenhum servidor. Crie um ou entre com um convite.');
    if (servers.length === 1) return servers[0].id;
    const pick = await vscode.window.showQuickPick(servers.map((s) => ({ label: s.name, id: s.id })), { placeHolder: 'Servidor' });
    return pick?.id;
  }

  async function pickStation() {
    const current = currentStationId();
    if (current) return current;
    const serverId = await pickServer();
    if (!serverId) return null;
    const detail = await client.json(`/servers/${serverId}`);
    const byId = Object.fromEntries(detail.members.map((m) => [m.id, m.username]));
    const pick = await vscode.window.showQuickPick(
      detail.stations.map((s) => ({ label: s.name, description: `${byId[s.userId] || ''} · ${s.branch}`, id: s.id })),
      { placeHolder: 'Estação de trabalho' },
    );
    return pick?.id;
  }

  // ---- Abrir ambiente ----
  async function openStation(stationId) {
    if (!(await requireLogin())) return;
    const st = await client.json(`/stations/${stationId}`);
    const uri = vscode.Uri.from({ scheme: 'devcord', authority: st.id, path: '/' });
    const folders = vscode.workspace.workspaceFolders || [];
    if (folders.some((f) => f.uri.toString() === uri.toString())) {
      vscode.commands.executeCommand('workbench.view.explorer');
      if (autoTerminal()) await openStationTerminal(client, st);
      return;
    }
    // A janela passa a mostrar SÓ a pasta do ambiente. Se já houver algo aberto, usa uma nova janela.
    await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: folders.length > 0 });
  }

  async function openEnvironment(serverId) {
    if (!(await requireLogin())) return;
    serverId = serverId || (await pickServer());
    if (!serverId) return;
    // O servidor cria o ambiente (pasta padrão e protegida) se ainda não existir.
    const st = await client.json(`/servers/${serverId}/environment`, { method: 'POST' });
    return openStation(st.id);
  }

  const autoTerminal = () => vscode.workspace.getConfiguration('devcord').get('autoTerminal', true);

  async function openTerminal(stationId) {
    if (!(await requireLogin())) return;
    stationId = stationId || (await pickStation());
    if (!stationId) return;
    await openStationTerminal(client, await client.json(`/stations/${stationId}`));
  }

  async function commit(stationId) {
    stationId = stationId || (await pickStation());
    if (!stationId) return;
    const message = await vscode.window.showInputBox({ prompt: 'Mensagem do commit', placeHolder: 'O que você fez?' });
    if (message === undefined) return;
    await vscode.workspace.saveAll(false);
    const r = await client.json(`/stations/${stationId}/commit`, { method: 'POST', body: { message } });
    vscode.window.showInformationMessage(r.committed ? 'DevCord: alterações salvas na estação.' : 'DevCord: nada novo para salvar.');
    return r;
  }

  async function gitAction(kind, stationId) {
    stationId = stationId || (await pickStation());
    if (!stationId) return;
    await vscode.workspace.saveAll(false);
    const r = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: kind === 'integrate' ? 'Integrando ao main…' : 'Sincronizando com o main…' },
      () => client.json(`/stations/${stationId}/${kind}`, { method: 'POST' }),
    );
    if (r.ok) vscode.window.showInformationMessage(kind === 'integrate' ? 'DevCord: trabalho integrado ao main!' : 'DevCord: estação atualizada com o main.');
    else vscode.window.showWarningMessage(`DevCord: conflitos em ${r.conflicts.join(', ')}. Resolva os marcadores, salve (commit) e tente de novo.`);
    return r;
  }

  // ---- Réplica local para testar na própria máquina ----
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  context.subscriptions.push(status);
  let replica = null;

  async function startReplica(station, dir) {
    replica?.dispose();
    replica = new Replica(client, station, dir);
    status.text = `$(sync~spin) DevCord: replicando ${station.name}…`;
    status.show();
    await replica.pull();
    replica.start();
    status.text = `$(sync) DevCord: ${station.name}`;
    status.tooltip = 'Réplica local sincronizada com o servidor em tempo real';
    context.subscriptions.push(replica);
  }

  async function replicate(stationId) {
    if (!(await requireLogin())) return;
    stationId = stationId || (await pickStation());
    if (!stationId) return;
    const st = await client.json(`/stations/${stationId}`);
    const dir = replicaDir(context, st.id);
    // Baixa antes de abrir, para a janela já abrir com os arquivos.
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Replicando "${st.name}" nesta máquina…` }, () =>
      new Replica(client, st, dir).pull(),
    );
    const folders = vscode.workspace.workspaceFolders || [];
    if (folders.some((f) => f.uri.fsPath === dir)) return;
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(dir), { forceNewWindow: folders.length > 0 });
  }

  const actions = { currentStationId, openStation, openEnvironment, openTerminal, commit, gitAction, replicate };
  const wrap = (fn) => async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      vscode.window.showErrorMessage(`DevCord: ${err.message}`);
    }
  };

  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider('devcord', new DevcordFileSystem(client), { isCaseSensitive: true }),
    vscode.window.registerWebviewViewProvider('devcord.panel', new PanelProvider(context, client, actions), {
      webviewOptions: { retainContextWhenHidden: true },
    }),

    vscode.commands.registerCommand('devcord.login', wrap(async () => {
      const choice = await vscode.window.showQuickPick(['Entrar', 'Criar conta'], { placeHolder: `Servidor: ${client.url}` });
      if (!choice) return;
      const username = await vscode.window.showInputBox({ prompt: 'Usuário' });
      if (!username) return;
      const password = await vscode.window.showInputBox({ prompt: 'Senha', password: true });
      if (!password) return;
      const user = await client.login(username, password, choice === 'Criar conta');
      vscode.window.showInformationMessage(`DevCord: conectado como ${user.username}.`);
    })),
    vscode.commands.registerCommand('devcord.logout', wrap(() => client.logout())),
    vscode.commands.registerCommand('devcord.openEnvironment', wrap(() => openEnvironment(null))),
    vscode.commands.registerCommand('devcord.openTerminal', wrap(() => openTerminal())),
    vscode.commands.registerCommand('devcord.commit', wrap(() => commit())),
    vscode.commands.registerCommand('devcord.sync', wrap(() => gitAction('sync'))),
    vscode.commands.registerCommand('devcord.integrate', wrap(() => gitAction('integrate'))),
    vscode.commands.registerCommand('devcord.replicate', wrap(() => replicate())),

    // Links vindos do app web: vscode://devcord.devcord-vscode/open?station=<id>&server=<url>
    vscode.window.registerUriHandler({
      handleUri: wrap(async (uri) => {
        const q = new URLSearchParams(uri.query);
        const server = q.get('server');
        if (server && server.replace(/\/+$/, '') !== client.url) {
          await vscode.workspace.getConfiguration('devcord').update('serverUrl', server, vscode.ConfigurationTarget.Global);
          await client.reconnect();
        }
        if (uri.path === '/open' && q.get('station')) await openStation(q.get('station'));
      }),
    }),

    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('devcord.serverUrl')) client.reconnect();
    }),
  );

  context.subscriptions.push(vscode.window.onDidCloseTerminal(forgetTerminal));

  // Ao abrir uma janela que já é um ambiente DevCord, o terminal SSH do ambiente abre junto.
  const folder = vscode.workspace.workspaceFolders?.find((f) => f.uri.scheme === 'devcord');
  if (folder && autoTerminal()) {
    client.ready.then(() => client.user && wrap(openTerminal)(folder.uri.authority));
  }

  // Janela aberta numa réplica local: liga a sincronização em tempo real com o servidor.
  const root = replicaRoot(context);
  const local = vscode.workspace.workspaceFolders?.find((f) => f.uri.scheme === 'file' && path.dirname(f.uri.fsPath) === root);
  if (local) {
    client.ready.then(
      wrap(async () => {
        if (!client.user) throw new Error('entre no DevCord para sincronizar esta réplica');
        const st = await client.json(`/stations/${path.basename(local.uri.fsPath)}`);
        await startReplica(st, local.uri.fsPath);
        // Réplica local também abre o terminal SSH do ambiente no servidor.
        if (autoTerminal()) await openStationTerminal(client, st, { reveal: false });
      }),
    );
  }
}

export function deactivate() {}
