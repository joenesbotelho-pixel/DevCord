export function Avatar({ user, size = 40, online }) {
  const name = user?.username || '?';
  return (
    <div className="avatar" style={{ width: size, height: size, background: user?.color || '#5865f2', fontSize: size * 0.4 }}>
      {name.slice(0, 2).toUpperCase()}
      {online !== undefined && <span className={`dot ${online ? 'on' : 'off'}`} />}
    </div>
  );
}

export function Modal({ title, subtitle, onClose, children }) {
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2>{title}</h2>
        {subtitle && <p className="muted center">{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}

export const CHANNEL_ICON = { text: '#', voice: '🔊', tasks: '☑', workspace: '⌨', screen: '🖥' };
