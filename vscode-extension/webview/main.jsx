import { createRoot } from 'react-dom/client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { call, api, onMessage, saveState, loadState } from './bridge.js';
import './style.css';

function useEvent(event, handler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => onMessage((m) => m.type === 'event' && m.event === event && ref.current(m.data)), [event]);
}

function App() {
  const [state, setState] = useState(null);
  useEffect(() => {
    call('state').then(setState);
    return onMessage((m) => m.type === 'auth' && setState((s) => ({ ...s, user: m.user })));
  }, []);
  if (!state) return <div className="pad muted">Carregando…</div>;
  if (!state.user) return <Login serverUrl={state.serverUrl} onLogin={(user) => setState((s) => ({ ...s, user }))} />;
  return <Home user={state.user} currentStationId={state.currentStationId} />;
}

function Login({ serverUrl, onLogin }) {
  const [register, setRegister] = useState(false);
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      onLogin(await call('login', { ...form, register }));
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <form className="pad login" onSubmit={submit}>
      <h3>{register ? 'Criar conta' : 'Entrar no DevCord'}</h3>
      <p className="muted small">
        Servidor: {serverUrl}{' '}
        <a href="#" onClick={() => call('configure')}>alterar</a>
      </p>
      <input placeholder="Usuário" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} autoFocus />
      <input placeholder="Senha" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
      {error && <div className="error">{error}</div>}
      <button className="primary">{register ? 'Cadastrar' : 'Entrar'}</button>
      <a href="#" onClick={() => setRegister(!register)}>{register ? 'Já tenho conta' : 'Criar uma conta'}</a>
    </form>
  );
}

function Home({ user, currentStationId }) {
  const saved = loadState();
  const [servers, setServers] = useState([]);
  const [serverId, setServerId] = useState(saved.serverId || null);
  const [detail, setDetail] = useState(null);
  const [tab, setTab] = useState(saved.tab || 'chat');
  const [error, setError] = useState('');
  const [invite, setInvite] = useState('');

  const loadServers = useCallback(async () => {
    const list = await api('/servers');
    setServers(list);
    setServerId((cur) => (list.some((s) => s.id === cur) ? cur : list[0]?.id || null));
  }, []);
  const loadDetail = useCallback(async () => serverId && setDetail(await api(`/servers/${serverId}`)), [serverId]);

  useEffect(() => {
    loadServers().catch((e) => setError(e.message));
  }, [loadServers]);
  useEffect(() => {
    setDetail(null);
    loadDetail().catch((e) => setError(e.message));
  }, [loadDetail]);
  useEffect(() => {
    saveState({ ...loadState(), serverId, tab });
  }, [serverId, tab]);

  useEvent('server:updated', ({ serverId: id }) => {
    if (id === serverId) loadDetail();
    loadServers();
  });
  useEvent('presence', ({ userId, online }) =>
    setDetail((d) => d && { ...d, members: d.members.map((m) => (m.id === userId ? { ...m, online } : m)) }),
  );

  const usersById = useMemo(() => Object.fromEntries((detail?.members || []).map((m) => [m.id, m])), [detail]);

  const run = (fn) => async (...args) => {
    setError('');
    try {
      await fn(...args);
    } catch (e) {
      setError(e.message);
    }
  };

  const joinInvite = run(async (e) => {
    e.preventDefault();
    const code = invite.trim().split('/').pop();
    const r = await api(`/invites/${code}/join`, 'POST');
    setInvite('');
    await loadServers();
    setServerId(r.serverId);
  });

  return (
    <div className="home">
      <div className="bar">
        <select value={serverId || ''} onChange={(e) => setServerId(e.target.value)}>
          {servers.length === 0 && <option value="">Nenhum servidor</option>}
          {servers.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <button className="icon" title={`Sair (${user.username})`} onClick={() => call('logout')}>⏻</button>
      </div>

      <form className="invite" onSubmit={joinInvite}>
        <input placeholder="Entrar com convite (link ou código)" value={invite} onChange={(e) => setInvite(e.target.value)} />
        {invite && <button>Entrar</button>}
      </form>

      {error && <div className="error pad-x">{error}</div>}

      {detail && (
        <>
          <div className="env">
            <button className="primary" onClick={run(() => call('openEnvironment', { serverId }))}>
              Abrir meu ambiente
            </button>
            <button
              title="Replica seu ambiente nesta máquina (sincronizado pelo servidor) para rodar e testar localmente"
              onClick={run(async () => {
                const st = await api(`/servers/${serverId}/environment`, 'POST');
                await call('replicate', { stationId: st.id });
              })}
            >
              Testar local
            </button>
          </div>
          <div className="tabs">
            {[
              ['chat', 'Chat'],
              ['tasks', 'Tarefas'],
              ['stations', 'Estações'],
              ['activity', 'Atividade'],
            ].map(([k, label]) => (
              <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{label}</button>
            ))}
          </div>
          {tab === 'chat' && <Chat detail={detail} usersById={usersById} user={user} />}
          {tab === 'tasks' && <Tasks detail={detail} usersById={usersById} user={user} run={run} />}
          {tab === 'stations' && <Stations detail={detail} usersById={usersById} user={user} currentStationId={currentStationId} run={run} />}
          {tab === 'activity' && <Activity serverId={detail.id} usersById={usersById} />}
        </>
      )}
    </div>
  );
}

function Chat({ detail, usersById, user }) {
  const textChannels = detail.channels.filter((c) => c.type === 'text');
  const [channelId, setChannelId] = useState(() => loadState().channelId);
  const channel = textChannels.find((c) => c.id === channelId) || textChannels[0];
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const endRef = useRef(null);

  useEffect(() => {
    if (!channel) return;
    saveState({ ...loadState(), channelId: channel.id });
    api(`/channels/${channel.id}/messages`).then(setMessages);
  }, [channel?.id]);
  useEvent('message:new', (m) => channel && m.channelId === channel.id && setMessages((l) => [...l, m]));
  // Chaves obrigatórias: no Chromium novo scrollIntoView() retorna uma Promise.
  useEffect(() => {
    endRef.current?.scrollIntoView();
  }, [messages]);

  if (!channel) return <div className="pad muted">Nenhum canal de texto.</div>;

  const send = (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    call('emit', { event: 'message:send', data: { channelId: channel.id, content: text } });
    setText('');
  };

  return (
    <div className="chat">
      <select value={channel.id} onChange={(e) => setChannelId(e.target.value)}>
        {detail.departments.map((d) => (
          <optgroup key={d.id} label={d.name}>
            {textChannels.filter((c) => c.departmentId === d.id).map((c) => (
              <option key={c.id} value={c.id}># {c.name}</option>
            ))}
          </optgroup>
        ))}
      </select>
      <div className="messages">
        {messages.map((m, i) => {
          const author = usersById[m.userId];
          const grouped = messages[i - 1]?.userId === m.userId;
          return (
            <div key={m.id} className={`msg ${grouped ? 'grouped' : ''}`}>
              {!grouped && (
                <div className="msg-head">
                  <strong style={{ color: author?.color }}>{author?.username || '?'}</strong>
                  <small>{new Date(m.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</small>
                </div>
              )}
              <div className="msg-text">{m.content}</div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
      <form onSubmit={send}>
        <input className="composer" value={text} onChange={(e) => setText(e.target.value)} placeholder={`Mensagem em #${channel.name}`} />
      </form>
    </div>
  );
}

function Stations({ detail, usersById, user, currentStationId, run }) {
  const [statuses, setStatuses] = useState({});
  const load = useCallback(() => {
    detail.stations.forEach((st) => api(`/stations/${st.id}/status`).then((s) => setStatuses((m) => ({ ...m, [st.id]: s }))).catch(() => {}));
  }, [detail.stations]);
  useEffect(() => {
    load();
  }, [load]);
  useEvent('repo:changed', load);
  useEvent('activity', load);

  const mine = detail.stations.filter((s) => s.userId === user.id);
  const others = detail.stations.filter((s) => s.userId !== user.id);
  const card = (st) => {
    const s = statuses[st.id];
    const owner = usersById[st.userId];
    return (
      <div key={st.id} className={`station ${st.id === currentStationId ? 'current' : ''}`}>
        <div className="station-title">
          <span className={`dot ${owner?.online ? 'on' : ''}`} />
          <strong>{st.name}</strong>
          {st.id === currentStationId && <span className="tag">aberta</span>}
        </div>
        <div className="muted small">{owner?.username} · {st.branch}</div>
        {s && (
          <div className="small stats">
            ✎ {s.changes.length} · ↑ {s.ahead} · ↓ {s.behind}
            {s.conflicts.length > 0 && <span className="warn"> · ⚠ {s.conflicts.length} conflitos</span>}
          </div>
        )}
        <div className="actions">
          <button onClick={run(() => call('openStation', { stationId: st.id }))}>Abrir</button>
          <button onClick={run(() => call('terminal', { stationId: st.id }))}>Terminal</button>
          <button onClick={run(() => call('replicate', { stationId: st.id }))} title="Cópia local sincronizada pelo servidor, para rodar e testar na sua máquina">
            Testar local
          </button>
          <button onClick={run(() => call('commit', { stationId: st.id }))}>Salvar</button>
          <button onClick={run(() => call('sync', { stationId: st.id }))}>Sincronizar</button>
          <button className="primary" onClick={run(() => call('integrate', { stationId: st.id }))}>Integrar</button>
        </div>
      </div>
    );
  };

  return (
    <div className="stations">
      <h4>Minhas estações</h4>
      {mine.length ? mine.map(card) : <p className="muted small">Clique em "Abrir meu ambiente" para criar a sua.</p>}
      {others.length > 0 && <h4>Da equipe</h4>}
      {others.map(card)}
    </div>
  );
}

const STATUS = [
  ['todo', 'A fazer'],
  ['doing', 'Em andamento'],
  ['review', 'Em revisão'],
  ['done', 'Concluído'],
];
const PRIO = { low: 'baixa', normal: 'normal', high: 'alta', urgent: 'urgente' };

function Tasks({ detail, usersById, user, run }) {
  const [tasks, setTasks] = useState([]);
  const [mine, setMine] = useState(true);
  useEffect(() => {
    api(`/servers/${detail.id}/tasks`).then(setTasks);
  }, [detail.id]);
  useEvent('task:updated', (t) => {
    if (t.serverId !== detail.id) return;
    setTasks((l) => (t.deleted ? l.filter((x) => x.id !== t.id) : l.some((x) => x.id === t.id) ? l.map((x) => (x.id === t.id ? t : x)) : [...l, t]));
  });

  const myEnv = detail.stations.find((s) => s.userId === user.id && s.personal);
  const patch = (t, body) => run(() => api(`/tasks/${t.id}`, 'PATCH', body))();
  const list = tasks.filter((t) => t.status !== 'done' && (!mine || t.assigneeId === user.id));

  return (
    <div className="stations">
      <label className="mine">
        <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Só as minhas
      </label>
      {STATUS.slice(0, 3).map(([status, label]) => {
        const items = list.filter((t) => t.status === status);
        if (!items.length) return null;
        return (
          <div key={status}>
            <h4>{label} · {items.length}</h4>
            {items.map((t) => {
              const st = detail.stations.find((s) => s.id === t.stationId);
              return (
                <div key={t.id} className="station">
                  <strong>{t.title}</strong>
                  <div className="muted small">
                    {PRIO[t.priority]} · {usersById[t.assigneeId]?.username || 'sem responsável'}
                    {st && ` · ⌨ ${st.name}`}
                    {t.dueDate && ` · 📅 ${new Date(t.dueDate + 'T00:00').toLocaleDateString('pt-BR')}`}
                  </div>
                  {t.description && <div className="small task-desc">{t.description}</div>}
                  <div className="actions">
                    {t.status === 'todo' && (
                      <button className="primary" onClick={() => patch(t, { assigneeId: user.id, status: 'doing', ...(t.stationId || !myEnv ? {} : { stationId: myEnv.id }) })}>
                        Começar
                      </button>
                    )}
                    {t.status === 'doing' && <button onClick={() => patch(t, { status: 'review' })}>Enviar p/ revisão</button>}
                    {t.status === 'review' && <button className="primary" onClick={() => patch(t, { status: 'done' })}>Aprovar</button>}
                    {st && <button onClick={run(() => call('openStation', { stationId: st.id }))}>Abrir ambiente</button>}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
      {list.length === 0 && <p className="muted small">{mine ? 'Nenhuma tarefa aberta com você.' : 'Nenhuma tarefa aberta.'}</p>}
    </div>
  );
}

function Activity({ serverId, usersById }) {
  const [items, setItems] = useState([]);
  useEffect(() => {
    api(`/servers/${serverId}/activity`).then(setItems);
  }, [serverId]);
  useEvent('activity', (a) => a.serverId === serverId && setItems((l) => [a, ...l].slice(0, 100)));
  useEvent('integrated', (a) =>
    a.serverId === serverId && setItems((l) => [{ ...a, id: `${a.at}-int`, integrated: true }, ...l]),
  );
  return (
    <ul className="feed">
      {items.length === 0 && <li className="muted">Sem atividade ainda.</li>}
      {items.map((a) => (
        <li key={a.id}>
          <strong style={{ color: usersById[a.userId]?.color }}>{usersById[a.userId]?.username || '?'}</strong>{' '}
          {a.integrated ? (
            <>integrou <em>{a.stationName}</em> ao main 🎉</>
          ) : (
            <>
              {a.action === 'delete' ? 'apagou' : 'editou'} <code>{a.file}</code>
            </>
          )}
          <div className="muted small">
            {a.stationName} · {new Date(a.at).toLocaleTimeString('pt-BR')}
          </div>
        </li>
      ))}
    </ul>
  );
}

createRoot(document.getElementById('root')).render(<App />);
