import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DATA_DIR } from './config.js';

const run = promisify(execFile);

// Layout em disco de cada servidor:
//   data/repos/<serverId>/main                -> branch main (integração, ninguém edita direto)
//   data/repos/<serverId>/stations/<stationId> -> git worktree de cada estação de trabalho
// Pastas usam só os 8 primeiros caracteres dos ids: o git limita o tamanho do
// caminho dos worktrees (no Windows o limite chega rápido com UUIDs completos).
export const shortId = (id) => id.slice(0, 8);
export const repoDir = (serverId) => path.join(DATA_DIR, 'repos', shortId(serverId));
export const mainDir = (serverId) => path.join(repoDir(serverId), 'main');
export const stationDir = (station) => path.join(repoDir(station.serverId), 'stations', shortId(station.id));

async function git(cwd, args, author) {
  const who = author
    ? ['-c', `user.name=${author.username}`, '-c', `user.email=${author.username}@devcord.local`]
    : ['-c', 'user.name=DevCord', '-c', 'user.email=bot@devcord.local'];
  // core.longpaths: no Windows os caminhos dos worktrees passam fácil de 260 caracteres.
  const { stdout } = await run('git', ['-c', 'core.longpaths=true', ...who, ...args], { cwd, maxBuffer: 50 * 1024 * 1024 });
  return stdout;
}

// Operações git do mesmo servidor rodam em fila para não disputar o index.lock.
const queues = new Map();
function locked(serverId, fn) {
  const prev = queues.get(serverId) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  queues.set(serverId, next);
  return next;
}

export async function initRepo(server, owner) {
  const dir = mainDir(server.id);
  fs.mkdirSync(dir, { recursive: true });
  await git(dir, ['init', '-b', 'main']);
  fs.writeFileSync(
    path.join(dir, 'README.md'),
    `# ${server.name}\n\nRepositório integrado do servidor DevCord.\nCada estação de trabalho é um branch; use "Integrar" para juntar o trabalho no main.\n`,
  );
  await git(dir, ['add', '-A']);
  await git(dir, ['commit', '-m', 'Repositório criado'], owner);
}

export function createStation(station) {
  return locked(station.serverId, async () => {
    const dir = stationDir(station);
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    await git(mainDir(station.serverId), ['worktree', 'add', '-b', station.branch, dir, 'main']);
  });
}

export function removeStation(station) {
  return locked(station.serverId, async () => {
    const main = mainDir(station.serverId);
    await git(main, ['worktree', 'remove', '--force', stationDir(station)]).catch(() => {});
    await git(main, ['branch', '-D', station.branch]).catch(() => {});
  });
}

export function stationStatus(station) {
  return locked(station.serverId, async () => {
    const dir = stationDir(station);
    const porcelain = await git(dir, ['status', '--porcelain=v1', '-uall']);
    const changes = porcelain
      .split('\n')
      .filter(Boolean)
      .map((l) => ({ code: l.slice(0, 2).trim(), file: l.slice(3) }));
    const counts = await git(dir, ['rev-list', '--left-right', '--count', `main...${station.branch}`]);
    const [behind, ahead] = counts.trim().split(/\s+/).map(Number);
    const conflicts = changes.filter((c) => c.code === 'UU' || c.code === 'AA').map((c) => c.file);
    return { changes, ahead, behind, conflicts };
  });
}

async function commitIn(dir, message, author) {
  await git(dir, ['add', '-A']);
  const pending = await git(dir, ['status', '--porcelain']);
  if (!pending.trim()) return false;
  await git(dir, ['commit', '-m', message], author);
  return true;
}

export function commitStation(station, message, author) {
  return locked(station.serverId, () => commitIn(stationDir(station), message, author));
}

async function mergeMainInto(station, author) {
  const dir = stationDir(station);
  await commitIn(dir, `Trabalho de ${author.username} (salvo antes de sincronizar)`, author);
  try {
    await git(dir, ['merge', '--no-edit', 'main'], author);
    return { ok: true };
  } catch (err) {
    const out = await git(dir, ['diff', '--name-only', '--diff-filter=U']).catch(() => '');
    const conflicts = out.split('\n').filter(Boolean);
    if (!conflicts.length) throw err;
    // Os marcadores de conflito ficam nos arquivos para resolver no VS Code;
    // depois basta "Salvar" (commit) e integrar de novo.
    return { ok: false, conflicts };
  }
}

// Traz o que já foi integrado no main para dentro da estação.
export function syncStation(station, author) {
  return locked(station.serverId, () => mergeMainInto(station, author));
}

// Junta o trabalho da estação no main. Primeiro sincroniza (conflitos são
// resolvidos na estação), depois o merge no main é sempre limpo.
export function integrateStation(station, author) {
  return locked(station.serverId, async () => {
    const sync = await mergeMainInto(station, author);
    if (!sync.ok) return sync;
    const main = mainDir(station.serverId);
    try {
      await git(main, ['merge', '--no-ff', station.branch, '-m', `Integra "${station.name}" (${author.username})`], author);
    } catch (err) {
      await git(main, ['merge', '--abort']).catch(() => {});
      throw err;
    }
    return { ok: true };
  });
}

export function repoLog(serverId, limit = 60) {
  return locked(serverId, async () => {
    const out = await git(mainDir(serverId), [
      'log',
      `-n${limit}`,
      '--all',
      '--date=iso-strict',
      '--pretty=format:%h%x1f%an%x1f%ad%x1f%s%x1f%D',
    ]);
    return out
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [hash, author, date, subject, refs] = line.split('\x1f');
        return { hash, author, date, subject, refs: refs ? refs.split(', ') : [] };
      });
  });
}
