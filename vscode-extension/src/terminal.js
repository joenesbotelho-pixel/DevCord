import * as vscode from 'vscode';

// Terminal do ambiente: sessão SSH aberta pelo servidor DevCord com a chave dele e repassada
// para cá. Nunca pede senha (nem a da conta Microsoft): o dono do servidor autoriza a chave uma vez.

const terminals = new Map(); // stationId -> vscode.Terminal

export async function openStationTerminal(client, station, { reveal = true } = {}) {
  const existing = terminals.get(station.id);
  if (existing && existing.exitStatus === undefined) {
    if (reveal) existing.show();
    return existing;
  }
  await client.ready;
  if (!client.socket) throw new Error('Entre no DevCord primeiro (painel DevCord na barra lateral).');

  const relay = await openRelay(client, station);
  if (!relay.ok) {
    throw new Error(`${relay.error} Quem hospeda o servidor resolve isso uma vez: servidor.bat (ou scripts\\autorizar-chave-ssh.ps1 como administrador).`);
  }
  const terminal = relay.terminal;
  terminals.set(station.id, terminal);
  if (reveal) terminal.show();
  return terminal;
}

// ---- 1. Sessão aberta pelo servidor DevCord ----
async function openRelay(client, station) {
  const write = new vscode.EventEmitter();
  const close = new vscode.EventEmitter();
  const buffered = [];
  let termId = null;
  let opened = false;

  const onData = ({ termId: id, data }) => {
    if (id !== termId) return;
    if (opened) write.fire(data);
    else buffered.push(data);
  };
  const onExit = ({ termId: id, code }) => {
    if (id !== termId) return;
    write.fire(`\r\n[terminal encerrado: ${code}]\r\n`);
    termId = null;
    close.fire(code);
  };
  client.socket.on('term:data', onData);
  client.socket.on('term:exit', onExit);
  const detach = () => {
    client.socket?.off('term:data', onData);
    client.socket?.off('term:exit', onExit);
  };

  const r = await client.emit('term:open', { stationId: station.id, cols: 120, rows: 30 });
  if (r.error) {
    detach();
    return { ok: false, error: r.error };
  }
  termId = r.termId;

  const pty = {
    onDidWrite: write.event,
    onDidClose: close.event,
    open(dims) {
      opened = true;
      write.fire(`\x1b[2mSSH pelo DevCord em ${r.host}, na pasta do ambiente\x1b[0m\r\n`);
      buffered.splice(0).forEach((d) => write.fire(d));
      if (dims) client.socket?.emit('term:resize', { termId, cols: dims.columns, rows: dims.rows });
    },
    close() {
      if (termId) client.socket?.emit('term:close', { termId });
      detach();
    },
    handleInput(data) {
      if (termId) client.socket?.emit('term:input', { termId, data });
    },
    setDimensions(dims) {
      if (termId) client.socket?.emit('term:resize', { termId, cols: dims.columns, rows: dims.rows });
    },
  };
  const terminal = vscode.window.createTerminal({ name: `DevCord: ${station.name}`, pty, iconPath: new vscode.ThemeIcon('remote') });
  return { ok: true, terminal };
}

export function forgetTerminal(terminal) {
  for (const [id, t] of terminals) if (t === terminal) terminals.delete(id);
}
