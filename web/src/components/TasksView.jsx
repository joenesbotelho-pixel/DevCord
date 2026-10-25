import { useEffect, useMemo, useRef, useState } from 'react';
import { api, timeLabel } from '../api.js';
import { Avatar, Modal } from './ui.jsx';

export const COLUMNS = [
  { id: 'todo', label: 'A fazer' },
  { id: 'doing', label: 'Em andamento' },
  { id: 'review', label: 'Em revisão' },
  { id: 'done', label: 'Concluído' },
];
export const PRIORITY = {
  low: { label: 'Baixa', cls: 'p-low' },
  normal: { label: 'Normal', cls: 'p-normal' },
  high: { label: 'Alta', cls: 'p-high' },
  urgent: { label: 'Urgente', cls: 'p-urgent' },
};

export default function TasksView({ server, channel, user, usersById, socket }) {
  const [tasks, setTasks] = useState([]);
  const [onlyMine, setOnlyMine] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [adding, setAdding] = useState(null); // coluna com o campo "nova tarefa" aberto
  const [dragOver, setDragOver] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api(`/channels/${channel.id}/tasks`).then(setTasks).catch((e) => setError(e.message));
    const onTask = (t) => {
      if (t.channelId !== channel.id) return;
      setTasks((list) => (t.deleted ? list.filter((x) => x.id !== t.id) : list.some((x) => x.id === t.id) ? list.map((x) => (x.id === t.id ? t : x)) : [...list, t]));
    };
    socket.on('task:updated', onTask);
    return () => socket.off('task:updated', onTask);
  }, [channel.id, socket]);

  const myEnv = server.stations.find((s) => s.userId === user.id && s.personal);
  const visible = useMemo(() => tasks.filter((t) => !onlyMine || t.assigneeId === user.id), [tasks, onlyMine, user.id]);

  const patch = async (task, body) => {
    setError('');
    try {
      await api(`/tasks/${task.id}`, { method: 'PATCH', body });
    } catch (err) {
      setError(err.message);
    }
  };

  const start = (task) => patch(task, { assigneeId: user.id, status: 'doing', ...(task.stationId || !myEnv ? {} : { stationId: myEnv.id }) });

  const create = async (status, title) => {
    if (!title.trim()) return setAdding(null);
    try {
      await api(`/channels/${channel.id}/tasks`, { method: 'POST', body: { title, status } });
    } catch (err) {
      setError(err.message);
    }
    setAdding(null);
  };

  const onDrop = (e, status) => {
    e.preventDefault();
    setDragOver(null);
    const task = tasks.find((t) => t.id === e.dataTransfer.getData('text/task'));
    if (task && task.status !== status) patch(task, { status });
  };

  const openTask = tasks.find((t) => t.id === openId);

  return (
    <div className="tasks">
      <header className="topbar">
        <span className="hash">☑</span> <strong>{channel.name}</strong>
        <span className="muted topbar-sub">
          {tasks.filter((t) => t.status !== 'done').length} abertas · {tasks.filter((t) => t.status === 'done').length} concluídas
        </span>
        <label className="check inline">
          <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} />
          Só as minhas
        </label>
      </header>
      {error && <div className="notice err board-notice">{error}</div>}

      <div className="board">
        {COLUMNS.map((col) => {
          const items = visible.filter((t) => t.status === col.id).sort((a, b) => (a.position || 0) - (b.position || 0));
          return (
            <section
              key={col.id}
              className={`column ${dragOver === col.id ? 'drag-over' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(col.id);
              }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(e) => onDrop(e, col.id)}
            >
              <div className="column-head">
                <span className={`col-dot col-${col.id}`} />
                {col.label} <span className="muted">{items.length}</span>
                <button className="icon" title="Nova tarefa" onClick={() => setAdding(col.id)}>+</button>
              </div>
              {adding === col.id && <NewTaskInput onDone={(title) => create(col.id, title)} />}
              {items.map((t) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  usersById={usersById}
                  station={server.stations.find((s) => s.id === t.stationId)}
                  isMine={t.assigneeId === user.id}
                  onOpen={() => setOpenId(t.id)}
                  onStart={() => start(t)}
                  onAdvance={(status) => patch(t, { status })}
                />
              ))}
              {items.length === 0 && adding !== col.id && <div className="column-empty muted small">Arraste tarefas para cá</div>}
            </section>
          );
        })}
      </div>

      {openTask && (
        <TaskModal task={openTask} server={server} usersById={usersById} onPatch={(body) => patch(openTask, body)} onClose={() => setOpenId(null)} />
      )}
    </div>
  );
}

function NewTaskInput({ onDone }) {
  const [title, setTitle] = useState('');
  const done = useRef(false);
  // Enter e perda de foco chamam a mesma coisa: garante que só cria uma vez.
  const finish = () => {
    if (done.current) return;
    done.current = true;
    onDone(title);
  };
  return (
    <form
      className="task-new"
      onSubmit={(e) => {
        e.preventDefault();
        finish();
      }}
    >
      <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onBlur={finish} placeholder="Título da tarefa e Enter" />
    </form>
  );
}

function TaskCard({ task, usersById, station, isMine, onOpen, onStart, onAdvance }) {
  const assignee = usersById[task.assigneeId];
  const overdue = task.dueDate && task.status !== 'done' && new Date(task.dueDate) < new Date(new Date().toDateString());
  return (
    <article className="task-card" draggable onDragStart={(e) => e.dataTransfer.setData('text/task', task.id)} onClick={onOpen}>
      <div className="task-title">{task.title}</div>
      <div className="task-meta">
        <span className={`prio ${PRIORITY[task.priority]?.cls}`}>{PRIORITY[task.priority]?.label}</span>
        {station && <span className="task-station" title="Ambiente ligado">⌨ {station.name}</span>}
        {task.dueDate && <span className={overdue ? 'warn' : 'muted'}>📅 {new Date(task.dueDate + 'T00:00').toLocaleDateString('pt-BR')}</span>}
        <span className="grow" />
        {assignee ? <Avatar user={assignee} size={22} /> : <span className="muted small">sem responsável</span>}
      </div>
      <div className="task-actions" onClick={(e) => e.stopPropagation()}>
        {task.status === 'todo' && <button className="btn small" onClick={onStart}>Começar</button>}
        {task.status === 'doing' && isMine && <button className="btn small secondary" onClick={() => onAdvance('review')}>Enviar p/ revisão</button>}
        {task.status === 'review' && <button className="btn small success" onClick={() => onAdvance('done')}>Aprovar</button>}
      </div>
    </article>
  );
}

function TaskModal({ task, server, usersById, onPatch, onClose }) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Campos de texto salvam ao sair do campo; selects salvam na hora.
  const saveText = () => {
    if (title.trim() && (title !== task.title || description !== task.description)) onPatch({ title, description });
  };
  const remove = async () => {
    await api(`/tasks/${task.id}`, { method: 'DELETE' });
    onClose();
  };

  return (
    <Modal title="Tarefa" onClose={onClose}>
      <div className="task-modal">
        <input className="task-modal-title" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={saveText} />
        <div className="task-fields">
          <label>
            Status
            <select value={task.status} onChange={(e) => onPatch({ status: e.target.value })}>
              {COLUMNS.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </label>
          <label>
            Prioridade
            <select value={task.priority} onChange={(e) => onPatch({ priority: e.target.value })}>
              {Object.entries(PRIORITY).map(([k, p]) => (
                <option key={k} value={k}>{p.label}</option>
              ))}
            </select>
          </label>
          <label>
            Responsável
            <select value={task.assigneeId || ''} onChange={(e) => onPatch({ assigneeId: e.target.value || null })}>
              <option value="">Ninguém</option>
              {server.members.map((m) => (
                <option key={m.id} value={m.id}>{m.username}</option>
              ))}
            </select>
          </label>
          <label>
            Ambiente
            <select value={task.stationId || ''} onChange={(e) => onPatch({ stationId: e.target.value || null })}>
              <option value="">Nenhum</option>
              {server.stations.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
          <label>
            Prazo
            <input type="date" value={task.dueDate || ''} onChange={(e) => onPatch({ dueDate: e.target.value || null })} />
          </label>
        </div>
        <label>
          Descrição
          <textarea rows={5} value={description} onChange={(e) => setDescription(e.target.value)} onBlur={saveText} placeholder="Detalhes, critérios de pronto, links…" />
        </label>
        <p className="muted small">Ao integrar o ambiente ligado, a tarefa em andamento ou revisão é concluída automaticamente.</p>

        <h4 className="history-title">Histórico</h4>
        <ul className="feed history">
          {[...task.history].reverse().map((h, i) => (
            <li key={i}>
              <strong style={{ color: usersById[h.userId]?.color }}>{usersById[h.userId]?.username || '?'}</strong> {h.text}
              <div className="muted small">{timeLabel(h.at)}</div>
            </li>
          ))}
        </ul>

        <div className="modal-footer">
          {confirmDelete ? (
            <>
              <span className="muted small">Apagar a tarefa?</span>
              <button className="link" onClick={() => setConfirmDelete(false)}>Não</button>
              <button className="btn danger" onClick={remove}>Apagar</button>
            </>
          ) : (
            <>
              <button className="link danger-link" onClick={() => setConfirmDelete(true)}>Apagar tarefa</button>
              <button className="btn" onClick={() => { saveText(); onClose(); }}>Fechar</button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
