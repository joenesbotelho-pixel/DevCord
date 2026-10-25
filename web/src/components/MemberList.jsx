import { Avatar } from './ui.jsx';

const ROLE = { owner: 'dono', admin: 'admin' };

export default function MemberList({ members }) {
  const online = members.filter((m) => m.online);
  const offline = members.filter((m) => !m.online);
  const group = (title, list) =>
    list.length > 0 && (
      <>
        <h4>
          {title} — {list.length}
        </h4>
        {list.map((m) => (
          <div key={m.id} className={`member ${m.online ? '' : 'offline'}`}>
            <Avatar user={m} size={32} online={m.online} />
            <span style={{ color: m.online ? m.color : undefined }}>{m.username}</span>
            {ROLE[m.role] && <span className="role">{ROLE[m.role]}</span>}
          </div>
        ))}
      </>
    );
  return (
    <aside className="members">
      {group('Online', online)}
      {group('Offline', offline)}
    </aside>
  );
}
