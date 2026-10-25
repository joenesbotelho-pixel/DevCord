import { useCallback, useEffect, useState } from 'react';
import { api, vscodeLink, timeLabel } from '../api.js';
import { Avatar } from './ui.jsx';

export default function WorkspaceView({ server, channel, user, usersById, socket, onModal }) {
  const [statuses, setStatuses] = useState({});
  const [log, setLog] = useState([]);
  const [activity, setActivity] = useState([]);
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);

  const loadStatus = useCallback(
    (st) =>
      api(`/stations/${st.id}/status`)
        .then((s) => setStatuses((m) => ({ ...m, [st.id]: s })))
        .catch(() => {}),
    [],
  );
  const loadLog = useCallback(() => api(`/servers/${server.id}/log`).then(setLog).catch(() => {}), [server.id]);

  useEffect(() => {
    server.stations.forEach(loadStatus);
    loadLog();
  }, [server.stations, loadStatus, loadLog]);

  useEffect(() => {
    api(`/servers/${server.id}/activity`).then(setActivity).catch(() => {});
    const refreshTimers = {};
    const onActivity = (a) => {
      if (a.serverId !== server.id) return;
      setActivity((list) => [a, ...list].slice(0, 100));
      clearTimeout(refreshTimers[a.stationId]);
      refreshTimers[a.stationId] = setTimeout(() => {
        const st = server.stations.find((s) => s.id === a.stationId);
        if (st) loadStatus(st);
      }, 800);
    };
    const onRepo = ({ serverId }) => {
      if (serverId !== server.id) return;
      server.stations.forEach(loadStatus);
      loadLog();
    };
    socket.on('activity', onActivity);
    socket.on('repo:changed', onRepo);
    return () => {
      socket.off('activity', onActivity);
      socket.off('repo:changed', onRepo);
      Object.values(refreshTimers).forEach(clearTimeout);
    };
  }, [socket, server.id, server.stations, loadStatus, loadLog]);

  async function action(st, kind) {
    setBusy(`${st.id}:${kind}`);
    setNotice(null);
    try {
      if (kind === 'commit') {
        const message = window.prompt('Mensagem do commit:', `Trabalho em ${st.name}`);
        if (message === null) return;
        const r = await api(`/stations/${st.id}/commit`, { method: 'POST', body: { message } });
        setNotice({ ok: true, text: r.committed ? 'Alterações salvas no branch da estação.' : 'Nada novo para salvar.' });
      } else {
        const r = await api(`/stations/${st.id}/${kind}`, { method: 'POST' });
        if (r.ok) setNotice({ ok: true, text: kind === 'integrate' ? `"${st.name}" integrada ao main!` : 'Estação atualizada com o main.' });
        else setNotice({ ok: false, text: `Conflitos em: ${r.conflicts.join(', ')}. Resolva no VS Code, salve (commit) e integre de novo.` });
      }
    } catch (err) {
      setNotice({ ok: false, text: err.message });
    } finally {
      setBusy(null);
    }
  }

  // Pede ao servidor o ambiente pessoal (cria se ainda não existir) e abre no VS Code.
  async function openMyEnvironment() {
    try {
      const st = await api(`/servers/${server.id}/environment`, { method: 'POST' });
      window.location.href = vscodeLink(st.id);
    } catch (err) {
      setNotice({ ok: false, text: err.message });
    }
  }

  return (
    <div className="workspace">
      <header className="topbar">
        <span className="hash">⌨</span> <strong>{channel.name}</strong>
        <span className="muted topbar-sub">Estações de trabalho conectadas ao repositório do servidor</span>
        <button className="btn small success" onClick={openMyEnvironment}>Abrir meu ambiente no VS Code</button>
        <button className="btn small secondary" onClick={() => onModal({ type: 'newStation' })}>+ Nova estação</button>
      </header>
      <div className="sandbox-info muted small">
        Cada ambiente é isolado: o VS Code só enxerga os arquivos de dentro dele. O terminal é uma conexão SSH feita pelo DevCord, já na pasta do ambiente.
      </div>

      <div className="workspace-body">
        <section className="stations">
          {notice && <div className={notice.ok ? 'notice ok' : 'notice err'}>{notice.text}</div>}
          {server.stations.length === 0 && (
            <div className="empty-card">
              <h3>Nenhuma estação ainda</h3>
              <p className="muted">
                Uma estação é uma cópia de trabalho do repositório (um branch próprio). Crie a sua, abra no VS Code e integre quando estiver pronto.
              </p>
              <button className="btn" onClick={() => onModal({ type: 'newStation' })}>Criar minha estação</button>
            </div>
          )}
          {server.stations.map((st) => {
            const s = statuses[st.id];
            const owner = usersById[st.userId];
            const is = (k) => busy === `${st.id}:${k}`;
            return (
              <div key={st.id} className="station-card">
                <div className="station-head">
                  <Avatar user={owner} size={36} online={owner?.online} />
                  <div className="grow">
                    <strong>{st.name}</strong>
                    <div className="muted small">
                      {owner?.username} · <code>{st.branch}</code>
                    </div>
                  </div>
                  {st.personal && <span className="badge alt">ambiente</span>}
                  {st.userId === user.id && <span className="badge">sua</span>}
                </div>
                {s && (
                  <div className="station-stats">
                    <span title="Arquivos alterados e ainda não salvos">✎ {s.changes.length} alterados</span>
                    <span title="Commits que o main ainda não tem">↑ {s.ahead} à frente</span>
                    <span title="Commits do main que a estação não tem">↓ {s.behind} atrás</span>
                    {s.conflicts.length > 0 && <span className="warn">⚠ {s.conflicts.length} conflitos</span>}
                  </div>
                )}
                {s?.changes.length > 0 && (
                  <ul className="changes">
                    {s.changes.slice(0, 6).map((c) => (
                      <li key={c.file}>
                        <code className={`code-${c.code[0] || 'M'}`}>{c.code || 'M'}</code> {c.file}
                      </li>
                    ))}
                    {s.changes.length > 6 && <li className="muted">+ {s.changes.length - 6} arquivos</li>}
                  </ul>
                )}
                <div className="station-actions">
                  <a className="btn small" href={vscodeLink(st.id)} title="Abre só a pasta do ambiente no VS Code, com o terminal SSH do DevCord">
                    Abrir no VS Code
                  </a>
                  <button className="btn small secondary" disabled={!!busy} onClick={() => action(st, 'commit')}>{is('commit') ? '…' : 'Salvar'}</button>
                  <button className="btn small secondary" disabled={!!busy} onClick={() => action(st, 'sync')}>{is('sync') ? '…' : 'Sincronizar'}</button>
                  <button className="btn small success" disabled={!!busy} onClick={() => action(st, 'integrate')}>{is('integrate') ? '…' : 'Integrar'}</button>
                </div>
              </div>
            );
          })}
        </section>

        <aside className="workspace-side">
          <h4>Atividade ao vivo</h4>
          <ul className="feed">
            {activity.length === 0 && <li className="muted">Ninguém editou nada ainda.</li>}
            {activity.slice(0, 40).map((a) => (
              <li key={a.id}>
                <strong style={{ color: usersById[a.userId]?.color }}>{usersById[a.userId]?.username || '?'}</strong>{' '}
                {a.action === 'delete' ? 'apagou' : 'editou'} <code>{a.file}</code>
                <div className="muted small">
                  {a.stationName} · {timeLabel(a.at)}
                </div>
              </li>
            ))}
          </ul>
          <h4>Histórico do repositório</h4>
          <ul className="feed log">
            {log.map((c) => (
              <li key={c.hash}>
                <code>{c.hash}</code> {c.subject}
                <div className="muted small">
                  {c.author} · {timeLabel(c.date)}
                  {c.refs.filter((r) => !r.startsWith('HEAD')).map((r) => (
                    <span key={r} className="ref">{r}</span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}
