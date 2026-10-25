import { useState } from 'react';
import { api, setToken } from '../api.js';

export default function Auth({ onAuth, inviteCode }) {
  const [mode, setMode] = useState(inviteCode ? 'register' : 'login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { token, user } = await api(`/auth/${mode}`, { method: 'POST', body: { username, password } });
      setToken(token);
      onAuth(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <form className="auth-card" onSubmit={submit}>
        <h1>{mode === 'login' ? 'Boas-vindas de volta!' : 'Criar uma conta'}</h1>
        <p className="muted center">
          {inviteCode ? 'Você foi convidado para um servidor DevCord.' : 'Código, conversa e trabalho em equipe no mesmo lugar.'}
        </p>
        <label>
          Usuário
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required />
        </label>
        <label>
          Senha
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <div className="error">{error}</div>}
        <button className="btn full" disabled={busy}>{mode === 'login' ? 'Entrar' : 'Cadastrar'}</button>
        <button type="button" className="link" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? 'Precisa de uma conta? Cadastre-se' : 'Já tem uma conta? Entrar'}
        </button>
      </form>
    </div>
  );
}
