import { useState } from 'react';
import { Avatar, CHANNEL_ICON } from './ui.jsx';
import { useVoice } from '../voice.js';
import { SpeakerIcon, MicIcon, HeadphonesIcon, HangUpIcon, SignalIcon, LogoutIcon } from './icons.jsx';

export default function ChannelSidebar({ server, user, isAdmin, activeChannelId, onSelectChannel, onModal, onLogout, voice, voiceRooms, usersById }) {
  const [menu, setMenu] = useState(false);
  const [collapsed, setCollapsed] = useState({});
  const vs = useVoice(voice);
  const voiceChannel = server.channels.find((c) => c.id === vs.channelId);

  // Como no Discord: clicar num canal de voz já entra na chamada.
  const selectChannel = (c) => {
    onSelectChannel(c.id);
    if (c.type === 'voice') voice.join(c.id);
  };
  const open = (m) => {
    setMenu(false);
    onModal(m);
  };

  return (
    <aside className="sidebar">
      <header className="sidebar-header" onClick={() => setMenu((v) => !v)}>
        <span>{server.name}</span>
        <span className="chev">{menu ? '✕' : '⌄'}</span>
      </header>
      {menu && (
        <div className="dropdown">
          <button onClick={() => open({ type: 'invite' })}>Convidar pessoas</button>
          <button onClick={() => open({ type: 'newStation' })}>Nova estação de trabalho</button>
          {isAdmin && <button onClick={() => open({ type: 'newDepartment' })}>Criar departamento</button>}
          {isAdmin && <button onClick={() => open({ type: 'settings' })}>Configurações (SSH / terminal)</button>}
        </div>
      )}

      <div className="channels">
        {server.departments.map((dep) => (
          <div key={dep.id} className="department">
            <div className="department-title">
              <button onClick={() => setCollapsed((c) => ({ ...c, [dep.id]: !c[dep.id] }))}>
                <span className="caret">{collapsed[dep.id] ? '›' : '⌄'}</span> {dep.name}
              </button>
              {isAdmin && (
                <button className="icon" title="Criar canal" onClick={() => onModal({ type: 'newChannel', departmentId: dep.id })}>+</button>
              )}
            </div>
            {server.channels
              .filter((c) => c.departmentId === dep.id)
              .filter((c) => !collapsed[dep.id] || c.id === activeChannelId || (voiceRooms[c.id] || []).length > 0)
              .map((c) => {
                const people = c.type === 'voice' ? voiceRooms[c.id] || [] : [];
                return (
                  <div key={c.id}>
                    <button
                      className={`channel ${c.id === activeChannelId ? 'active' : ''} ${c.id === vs.channelId ? 'connected' : ''}`}
                      onClick={() => selectChannel(c)}
                    >
                      <span className="hash">{c.type === 'voice' ? <SpeakerIcon size={18} /> : CHANNEL_ICON[c.type]}</span>
                      <span className="channel-name">{c.name}</span>
                    </button>
                    {people.length > 0 && (
                      <div className="voice-members">
                        {people.map((p) => {
                          const u = usersById[p.userId];
                          return (
                            <div key={p.socketId} className={`voice-member ${vs.speaking.has(p.socketId) ? 'speaking' : ''}`}>
                              <Avatar user={u} size={24} />
                              <span className="voice-member-name">{u?.username || '…'}</span>
                              <span className="voice-member-icons">
                                {(p.muted || p.deafened) && <MicIcon off size={16} title="Mutado" />}
                                {p.deafened && <HeadphonesIcon off size={16} title="Ensurdecido" />}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        ))}
      </div>

      <div className="user-area">
        {(vs.channelId || vs.connecting || vs.error) && (
          <div className="voice-panel">
            {vs.error ? (
              <div className="voice-panel-info">
                <span className="error">{vs.error}</span>
              </div>
            ) : (
              <>
                <div className="voice-panel-info">
                  <strong className={vs.connecting ? 'connecting-text' : 'ok-text'}>
                    <SignalIcon size={16} /> {vs.connecting ? 'Conectando…' : 'Voz conectada'}
                  </strong>
                  <small>{voiceChannel ? `${voiceChannel.name} / ${server.name}` : ''}</small>
                </div>
                {vs.channelId && (
                  <button className="icon-btn" title="Desconectar" onClick={() => voice.leave()}>
                    <HangUpIcon size={20} />
                  </button>
                )}
              </>
            )}
          </div>
        )}
        <footer className="userbar">
          <Avatar user={user} size={32} online />
          <div className="userbar-name">
            <strong>{user.username}</strong>
            <small>{vs.channelId ? 'Na voz' : 'Online'}</small>
          </div>
          <button className={`icon-btn ${vs.muted ? 'off' : ''}`} title={vs.muted ? 'Ativar microfone' : 'Silenciar microfone'} onClick={() => voice.toggleMute()}>
            <MicIcon off={vs.muted} size={20} />
          </button>
          <button className={`icon-btn ${vs.deafened ? 'off' : ''}`} title={vs.deafened ? 'Ativar áudio' : 'Desativar áudio'} onClick={() => voice.toggleDeafen()}>
            <HeadphonesIcon off={vs.deafened} size={20} />
          </button>
          <button className="icon-btn" title="Sair da conta" onClick={onLogout}>
            <LogoutIcon size={18} />
          </button>
        </footer>
      </div>
    </aside>
  );
}
