import { useEffect, useRef, useState } from 'react';
import { api, timeLabel } from '../api.js';
import { Avatar } from './ui.jsx';

export default function ChatView({ channel, usersById, socket, user }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [typing, setTyping] = useState({});
  const endRef = useRef(null);
  const lastTyping = useRef(0);

  useEffect(() => {
    api(`/channels/${channel.id}/messages`).then(setMessages).catch(() => setMessages([]));
    const onMessage = (m) => m.channelId === channel.id && setMessages((list) => [...list, m]);
    const onTyping = ({ channelId, userId }) => {
      if (channelId !== channel.id) return;
      setTyping((t) => ({ ...t, [userId]: Date.now() }));
    };
    socket.on('message:new', onMessage);
    socket.on('typing', onTyping);
    const timer = setInterval(() => setTyping((t) => Object.fromEntries(Object.entries(t).filter(([, at]) => Date.now() - at < 3000))), 1000);
    return () => {
      socket.off('message:new', onMessage);
      socket.off('typing', onTyping);
      clearInterval(timer);
    };
  }, [channel.id, socket]);

  // Chaves obrigatórias: no Chromium novo scrollIntoView() retorna uma Promise,
  // e um efeito não pode retornar nada além da função de limpeza.
  useEffect(() => {
    endRef.current?.scrollIntoView();
  }, [messages]);

  function send(e) {
    e.preventDefault();
    if (!text.trim()) return;
    socket.emit('message:send', { channelId: channel.id, content: text });
    setText('');
  }

  function onChange(e) {
    setText(e.target.value);
    if (Date.now() - lastTyping.current > 2000) {
      lastTyping.current = Date.now();
      socket.emit('typing', { channelId: channel.id });
    }
  }

  const typingNames = Object.keys(typing)
    .filter((id) => id !== user.id)
    .map((id) => usersById[id]?.username)
    .filter(Boolean);

  return (
    <div className="chat">
      <header className="topbar">
        <span className="hash">#</span> <strong>{channel.name}</strong>
      </header>
      <div className="messages">
        <div className="channel-intro">
          <div className="intro-icon">#</div>
          <h2>Bem-vindo a #{channel.name}!</h2>
          <p className="muted">Este é o começo do canal.</p>
        </div>
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const grouped = prev && prev.userId === m.userId && new Date(m.createdAt) - new Date(prev.createdAt) < 5 * 60_000;
          const author = usersById[m.userId];
          return grouped ? (
            <div key={m.id} className="message grouped">
              <div className="content-text">{m.content}</div>
            </div>
          ) : (
            <div key={m.id} className="message">
              <Avatar user={author} />
              <div>
                <div className="meta">
                  <strong style={{ color: author?.color }}>{author?.username || 'alguém'}</strong>
                  <small>{timeLabel(m.createdAt)}</small>
                </div>
                <div className="content-text">{m.content}</div>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
      <form className="composer" onSubmit={send}>
        <input value={text} onChange={onChange} placeholder={`Conversar em #${channel.name}`} />
      </form>
      <div className="typing">{typingNames.length > 0 && `${typingNames.join(', ')} está digitando…`}</div>
    </div>
  );
}
