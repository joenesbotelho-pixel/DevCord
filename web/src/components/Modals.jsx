import { useEffect, useState } from 'react';
import { api, inviteUrl } from '../api.js';
import { Modal } from './ui.jsx';

export default function Modals({ modal, server, onClose, onCreated, onJoined, onChanged, onOpenChannel }) {
  const props = { server, onClose, onChanged };
  switch (modal.type) {
    case 'createServer':
      return <CreateServer onClose={onClose} onCreated={onCreated} />;
    case 'join':
      return <JoinServer code={modal.code} onClose={onClose} onJoined={onJoined} />;
    case 'invite':
      return <Invite {...props} />;
    case 'newDepartment':
      return <NewDepartment {...props} />;
    case 'newChannel':
      return <NewChannel {...props} departmentId={modal.departmentId} onOpenChannel={onOpenChannel} />;
    case 'newStation':
      return <NewStation {...props} onOpenChannel={onOpenChannel} />;
    case 'settings':
      return <Settings {...props} />;
    default:
      return null;
  }
}

function useSubmit(fn) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e?.preventDefault();
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return { submit, error, busy };
}

function Footer({ onClose, busy, label }) {
  return (
    <div className="modal-footer">
      <button type="button" className="link" onClick={onClose}>Cancelar</button>
      <button className="btn" disabled={busy}>{label}</button>
    </div>
  );
}

function CreateServer({ onClose, onCreated }) {
  const [name, setName] = useState('');
  const { submit, error, busy } = useSubmit(async () => {
    const s = await api('/servers', { method: 'POST', body: { name } });
    await onCreated(s.id);
  });
  return (
    <Modal title="Crie seu servidor" subtitle="Um espaço para sua equipe conversar, codar e integrar o trabalho." onClose={onClose}>
      <form onSubmit={submit}>
        <label>
          Nome do servidor
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus required placeholder="Ex.: Estúdio Alfa" />
        </label>
        <p className="muted small">Já vem com os departamentos Geral e Desenvolvimento, um canal de estações e um repositório git.</p>
        {error && <div className="error">{error}</div>}
        <Footer onClose={onClose} busy={busy} label="Criar" />
      </form>
    </Modal>
  );
}

function JoinServer({ code: initial, onClose, onJoined }) {
  const [code, setCode] = useState(initial || '');
  const [preview, setPreview] = useState(null);
  const clean = code.trim().split('/').pop();

  useEffect(() => {
    setPreview(null);
    if (clean.length < 5) return;
    const t = setTimeout(() => api(`/invites/${clean}`).then(setPreview).catch(() => {}), 300);
    return () => clearTimeout(t);
  }, [clean]);

  const { submit, error, busy } = useSubmit(async () => {
    const r = await api(`/invites/${clean}/join`, { method: 'POST' });
    await onJoined(r.serverId);
  });
  return (
    <Modal title="Entrar em um servidor" subtitle="Cole o link ou código de convite." onClose={onClose}>
      <form onSubmit={submit}>
        <label>
          Convite
          <input value={code} onChange={(e) => setCode(e.target.value)} autoFocus required placeholder="http://…/invite/abc123" />
        </label>
        {preview && (
          <div className="notice ok">
            <strong>{preview.server.name}</strong> · {preview.members} membros
          </div>
        )}
        {error && <div className="error">{error}</div>}
        <Footer onClose={onClose} busy={busy} label="Entrar" />
      </form>
    </Modal>
  );
}

function Invite({ server, onClose }) {
  const [invite, setInvite] = useState(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    api(`/servers/${server.id}/invites`, { method: 'POST', body: {} }).then(setInvite);
  }, [server.id]);
  const url = invite ? inviteUrl(invite.code) : '…';
  return (
    <Modal title={`Convidar para ${server.name}`} subtitle="Quem entrar pelo link vira membro e pode acessar as estações." onClose={onClose}>
      <div className="copy-row">
        <input readOnly value={url} onFocus={(e) => e.target.select()} />
        <button
          className="btn"
          onClick={() => {
            navigator.clipboard?.writeText(url);
            setCopied(true);
          }}
        >
          {copied ? 'Copiado!' : 'Copiar'}
        </button>
      </div>
      {invite && <p className="muted small">Expira em {new Date(invite.expiresAt).toLocaleDateString('pt-BR')}.</p>}
    </Modal>
  );
}

function NewDepartment({ server, onClose, onChanged }) {
  const [name, setName] = useState('');
  const { submit, error, busy } = useSubmit(async () => {
    await api(`/servers/${server.id}/departments`, { method: 'POST', body: { name } });
    onChanged();
    onClose();
  });
  return (
    <Modal title="Criar departamento" subtitle="Departamentos agrupam canais, como Backend, Design ou QA." onClose={onClose}>
      <form onSubmit={submit}>
        <label>
          Nome
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus required placeholder="Backend" />
        </label>
        {error && <div className="error">{error}</div>}
        <Footer onClose={onClose} busy={busy} label="Criar" />
      </form>
    </Modal>
  );
}

const TYPES = [
  { value: 'text', icon: '#', label: 'Texto', desc: 'Mensagens e conversas' },
  { value: 'voice', icon: '🔊', label: 'Voz', desc: 'Conversa por voz em tempo real' },
  { value: 'tasks', icon: '☑', label: 'Tarefas', desc: 'Quadro de trabalho ligado aos ambientes' },
  { value: 'workspace', icon: '⌨', label: 'Estações', desc: 'Estações de trabalho, atividade e integração' },
  { value: 'screen', icon: '🖥', label: 'Tela', desc: 'Compartilhamento de tela ao vivo' },
];

function NewChannel({ server, departmentId, onClose, onChanged, onOpenChannel }) {
  const [name, setName] = useState('');
  const [type, setType] = useState('text');
  const dep = server.departments.find((d) => d.id === departmentId);
  const { submit, error, busy } = useSubmit(async () => {
    const ch = await api(`/servers/${server.id}/channels`, { method: 'POST', body: { name, type, departmentId } });
    await onChanged();
    onOpenChannel(ch.id);
    onClose();
  });
  return (
    <Modal title="Criar canal" subtitle={`em ${dep?.name}`} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="types">
          {TYPES.map((t) => (
            <label key={t.value} className={`type ${type === t.value ? 'selected' : ''}`}>
              <input type="radio" name="type" checked={type === t.value} onChange={() => setType(t.value)} />
              <span className="type-icon">{t.icon}</span>
              <span>
                <strong>{t.label}</strong>
                <small className="muted">{t.desc}</small>
              </span>
            </label>
          ))}
        </div>
        <label>
          Nome do canal
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus required placeholder="novo-canal" />
        </label>
        {error && <div className="error">{error}</div>}
        <Footer onClose={onClose} busy={busy} label="Criar canal" />
      </form>
    </Modal>
  );
}

function NewStation({ server, onClose, onChanged, onOpenChannel }) {
  const [name, setName] = useState('');
  const { submit, error, busy } = useSubmit(async () => {
    await api(`/servers/${server.id}/stations`, { method: 'POST', body: { name } });
    await onChanged();
    const ws = server.channels.find((c) => c.type === 'workspace');
    if (ws) onOpenChannel(ws.id);
    onClose();
  });
  return (
    <Modal title="Nova estação de trabalho" subtitle="Uma cópia do repositório em um branch só seu, no servidor." onClose={onClose}>
      <form onSubmit={submit}>
        <label>
          Nome da estação
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Ex.: API de login" />
        </label>
        {error && <div className="error">{error}</div>}
        <Footer onClose={onClose} busy={busy} label="Criar estação" />
      </form>
    </Modal>
  );
}

function SshConnection({ server }) {
  const [status, setStatus] = useState(null);
  const [test, setTest] = useState(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    api(`/servers/${server.id}/ssh`).then(setStatus).catch(() => {});
  }, [server.id]);
  if (!status) return null;
  const runTest = async () => {
    setTest({ running: true });
    setTest(await api(`/servers/${server.id}/ssh/test`, { method: 'POST' }).catch((e) => ({ ok: false, error: e.message })));
  };
  return (
    <div className="ssh-box">
      <div className="ssh-head">
        <strong>Conexão SSH do DevCord</strong>
        <code>{status.username}@{status.host}:{status.port}</code>
      </div>
      <p className="muted small">
        O DevCord abre os terminais entrando por SSH na máquina hospedeira, já na pasta do ambiente. Os membros não precisam configurar nada.
      </p>
      {status.publicKey && (
        <>
          <p className="muted small">
            Autorize uma vez a chave do DevCord em <code>{status.authorizedKeysFile}</code>:
          </p>
          <div className="copy-row">
            <input readOnly value={status.publicKey} onFocus={(e) => e.target.select()} />
            <button
              type="button"
              className="btn secondary"
              onClick={() => {
                navigator.clipboard?.writeText(status.publicKey);
                setCopied(true);
              }}
            >
              {copied ? 'Copiado!' : 'Copiar'}
            </button>
          </div>
        </>
      )}
      <div className="row ssh-test">
        <button type="button" className="btn small secondary" onClick={runTest} disabled={test?.running}>
          {test?.running ? 'Testando…' : 'Testar conexão'}
        </button>
        {test && !test.running && (
          <span className={test.ok ? 'ok-text' : 'error'}>{test.ok ? `✓ Conectado como ${test.output}` : test.error}</span>
        )}
      </div>
    </div>
  );
}

function Settings({ server, onClose, onChanged }) {
  const [form, setForm] = useState({
    name: server.name,
    allowTerminal: server.allowTerminal !== false,
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const { submit, error, busy } = useSubmit(async () => {
    await api(`/servers/${server.id}`, { method: 'PATCH', body: form });
    onChanged();
    onClose();
  });
  return (
    <Modal title="Configurações do servidor" onClose={onClose}>
      <form onSubmit={submit}>
        <label>
          Nome
          <input value={form.name} onChange={set('name')} />
        </label>
        <label className="check">
          <input type="checkbox" checked={form.allowTerminal} onChange={set('allowTerminal')} />
          Permitir terminal (sessão SSH aberta pelo DevCord na pasta do ambiente)
        </label>
        <SshConnection server={server} />
        {error && <div className="error">{error}</div>}
        <Footer onClose={onClose} busy={busy} label="Salvar" />
      </form>
    </Modal>
  );
}
