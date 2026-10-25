import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { Client } from 'ssh2';
import { DATA_DIR } from './config.js';
import { stationDir } from './repo.js';

// O terminal é uma conexão SSH feita PELO DEVCORD: o servidor entra na máquina
// hospedeira com a própria chave e repassa a sessão para o VS Code de quem está
// logado. Ninguém precisa configurar SSH; basta autorizar a chave do DevCord uma vez.

const SSH_DIR = path.join(DATA_DIR, 'ssh');
const KEY_FILE = process.env.DEVCORD_SSH_KEY || path.join(SSH_DIR, 'devcord_ed25519');

export const sshConfig = {
  host: process.env.DEVCORD_SSH_HOST || '127.0.0.1',
  port: Number(process.env.DEVCORD_SSH_PORT || 22),
  username: process.env.DEVCORD_SSH_USER || os.userInfo().username,
  password: process.env.DEVCORD_SSH_PASSWORD || undefined,
  // Sistema da máquina hospedeira e onde ela enxerga a pasta de dados do DevCord.
  platform: process.env.DEVCORD_SSH_PLATFORM || process.platform,
  root: process.env.DEVCORD_SSH_ROOT || '',
};

try {
  if (!sshConfig.password && !fs.existsSync(KEY_FILE)) {
    fs.mkdirSync(SSH_DIR, { recursive: true });
    execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'devcord', '-f', KEY_FILE], { stdio: 'ignore' });
    console.log(`[ssh] chave do DevCord gerada em ${KEY_FILE}`);
  }
} catch (err) {
  console.warn(`[ssh] não foi possível gerar a chave do DevCord (ssh-keygen): ${err.message}`);
}

// Linha para o authorized_keys do host. "restrict,pty" bloqueia túneis/encaminhamentos:
// a chave só serve para abrir o terminal.
export function publicKeyLine() {
  try {
    return `restrict,pty ${fs.readFileSync(`${KEY_FILE}.pub`, 'utf8').trim()}`;
  } catch {
    return null;
  }
}

function authorizedKeysFile() {
  if (sshConfig.platform !== 'win32') return '~/.ssh/authorized_keys';
  return 'C:\\ProgramData\\ssh\\administrators_authorized_keys (usuário administrador) ou %USERPROFILE%\\.ssh\\authorized_keys';
}

export function sshStatus() {
  const { host, port, username, platform } = sshConfig;
  return {
    host,
    port,
    username,
    platform,
    auth: sshConfig.password ? 'senha' : 'chave',
    publicKey: sshConfig.password ? null : publicKeyLine(),
    authorizedKeysFile: authorizedKeysFile(),
  };
}

export function remoteDir(station) {
  const local = stationDir(station);
  if (!sshConfig.root) return local;
  const rel = path.relative(DATA_DIR, local).split(path.sep);
  return (sshConfig.platform === 'win32' ? path.win32 : path.posix).join(sshConfig.root, ...rel);
}

// Comando que entra na pasta do ambiente e abre o shell do host.
export function shellCommand(dir) {
  if (process.env.DEVCORD_SSH_COMMAND) return process.env.DEVCORD_SSH_COMMAND.replaceAll('{dir}', dir);
  if (sshConfig.platform === 'win32') return `cd /d "${dir}" && powershell -NoLogo`;
  return `cd '${dir.replace(/'/g, `'\\''`)}' && exec "\${SHELL:-/bin/sh}" -l`;
}

function friendly(err) {
  const where = `${sshConfig.username}@${sshConfig.host}:${sshConfig.port}`;
  if (err.level === 'client-authentication') {
    return new Error(`O DevCord não conseguiu entrar em ${where}: autorize a chave do DevCord no host (Configurações do servidor → Conexão SSH).`);
  }
  if (err.code === 'ECONNREFUSED') return new Error(`Nenhum servidor SSH respondendo em ${where}. Ligue o serviço sshd na máquina hospedeira.`);
  if (err.level === 'client-timeout') return new Error(`Tempo esgotado conectando em ${where}.`);
  return new Error(`SSH (${where}): ${err.message}`);
}

function connect() {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.once('ready', () => resolve(conn));
    // "on" e não "once": após uma falha o ssh2 pode emitir outro erro (ex.: ECONNRESET),
    // e um evento de erro sem ouvinte derruba o servidor inteiro.
    conn.on('error', (err) => reject(friendly(err)));
    try {
      conn.connect({
        host: sshConfig.host,
        port: sshConfig.port,
        username: sshConfig.username,
        readyTimeout: 10000,
        ...(sshConfig.password ? { password: sshConfig.password } : { privateKey: fs.readFileSync(KEY_FILE) }),
      });
    } catch (err) {
      reject(friendly(err));
    }
  });
}

/** Abre o shell do ambiente via SSH. Resolve com { write, resize, kill }. */
export async function openShell(station, { cols = 100, rows = 30 } = {}, onData, onExit) {
  const conn = await connect();
  conn.on('error', (err) => onData(`\r\n[ssh] ${err.message}\r\n`));
  return new Promise((resolve, reject) => {
    conn.exec(shellCommand(remoteDir(station)), { pty: { term: 'xterm-256color', cols, rows } }, (err, stream) => {
      if (err) {
        conn.end();
        return reject(friendly(err));
      }
      const out = new StringDecoder('utf8');
      const errOut = new StringDecoder('utf8');
      stream.on('data', (d) => onData(out.write(d)));
      stream.stderr.on('data', (d) => onData(errOut.write(d)));
      stream.on('close', (code) => {
        conn.end();
        onExit(code ?? 0);
      });
      resolve({
        write: (d) => stream.write(d),
        resize: (c, r) => stream.setWindow(r, c, 0, 0),
        kill: () => {
          stream.close();
          conn.end();
        },
      });
    });
  });
}

/** Testa a conexão: entra, roda um comando e sai. */
export async function testConnection() {
  try {
    const conn = await connect();
    const output = await new Promise((resolve, reject) => {
      conn.exec(sshConfig.platform === 'win32' ? 'echo %USERNAME%@%COMPUTERNAME%' : 'echo "$(whoami)@$(hostname)"', (err, stream) => {
        if (err) return reject(friendly(err));
        let text = '';
        stream.on('data', (d) => (text += d));
        stream.on('close', () => resolve(text.trim()));
      });
    });
    conn.end();
    return { ok: true, output };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
