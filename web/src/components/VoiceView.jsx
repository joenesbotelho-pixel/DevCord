import { useVoice } from '../voice.js';
import { Avatar } from './ui.jsx';
import { SpeakerIcon, MicIcon, HeadphonesIcon, HangUpIcon } from './icons.jsx';

export default function VoiceView({ channel, voice, participants, usersById }) {
  const vs = useVoice(voice);
  const inHere = vs.channelId === channel.id;

  return (
    <div className="voice">
      <header className="topbar">
        <span className="hash">
          <SpeakerIcon size={20} />
        </span>
        <strong>{channel.name}</strong>
      </header>

      <div className="voice-stage">
        {!inHere ? (
          <div className="voice-join">
            <div className="voice-join-icon">
              <SpeakerIcon size={40} />
            </div>
            <h2>{channel.name}</h2>
            <p className="muted">
              {participants.length === 0
                ? 'Ninguém está na voz no momento.'
                : `${participants.map((p) => usersById[p.userId]?.username).filter(Boolean).join(', ')} ${participants.length === 1 ? 'está' : 'estão'} na voz.`}
            </p>
            {vs.error && <div className="error">{vs.error}</div>}
            <button className="btn success" disabled={vs.connecting} onClick={() => voice.join(channel.id)}>
              {vs.connecting ? 'Conectando…' : 'Entrar na voz'}
            </button>
          </div>
        ) : (
          <div className={`voice-grid n${Math.min(participants.length, 4)}`}>
            {participants.map((p) => {
              const u = usersById[p.userId];
              return (
                <div key={p.socketId} className={`voice-tile ${vs.speaking.has(p.socketId) ? 'speaking' : ''}`} style={{ '--tile': u?.color }}>
                  <Avatar user={u} size={88} />
                  <div className="voice-tile-name">
                    {(p.muted || p.deafened) && <MicIcon off size={14} />}
                    {u?.username || '…'}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {inHere && (
        <div className="voice-controls">
          <button className={`round-btn ${vs.muted ? 'off' : ''}`} title={vs.muted ? 'Ativar microfone' : 'Silenciar microfone'} onClick={() => voice.toggleMute()}>
            <MicIcon off={vs.muted} size={24} />
          </button>
          <button className={`round-btn ${vs.deafened ? 'off' : ''}`} title={vs.deafened ? 'Ativar áudio' : 'Desativar áudio'} onClick={() => voice.toggleDeafen()}>
            <HeadphonesIcon off={vs.deafened} size={24} />
          </button>
          <button className="round-btn hangup" title="Desconectar" onClick={() => voice.leave()}>
            <HangUpIcon size={26} />
          </button>
        </div>
      )}
    </div>
  );
}
