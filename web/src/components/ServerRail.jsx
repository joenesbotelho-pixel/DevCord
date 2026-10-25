export default function ServerRail({ servers, activeId, onSelect, onCreate, onJoin }) {
  const initials = (name) =>
    name
      .split(/\s+/)
      .map((w) => w[0])
      .join('')
      .slice(0, 3)
      .toUpperCase();

  return (
    <nav className="rail">
      <div className="rail-logo" title="DevCord">⌘</div>
      <div className="rail-sep" />
      {servers.map((s) => (
        <button
          key={s.id}
          className={`rail-item ${s.id === activeId ? 'active' : ''}`}
          title={s.name}
          onClick={() => onSelect(s.id)}
        >
          <span className="pill" />
          {initials(s.name)}
        </button>
      ))}
      <button className="rail-item add" title="Criar servidor" onClick={onCreate}>+</button>
      <button className="rail-item add" title="Entrar com convite" onClick={onJoin}>↘</button>
    </nav>
  );
}
