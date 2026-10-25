import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, getToken, setToken, connectSocket } from './api.js';
import Auth from './components/Auth.jsx';
import ServerRail from './components/ServerRail.jsx';
import ChannelSidebar from './components/ChannelSidebar.jsx';
import ChatView from './components/ChatView.jsx';
import WorkspaceView from './components/WorkspaceView.jsx';
import ScreenView from './components/ScreenView.jsx';
import MemberList from './components/MemberList.jsx';
import Modals from './components/Modals.jsx';
import VoiceView from './components/VoiceView.jsx';
import TasksView from './components/TasksView.jsx';
import { VoiceClient } from './voice.js';

const inviteFromPath = () => window.location.pathname.match(/^\/invite\/([\w-]+)/)?.[1] || null;

export default function App() {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getToken()) return setReady(true);
    api('/me')
      .then(setUser)
      .catch(() => setToken(null))
      .finally(() => setReady(true));
  }, []);

  if (!ready) return <div className="splash">DevCord</div>;
  if (!user) return <Auth onAuth={setUser} inviteCode={inviteFromPath()} />;
  return (
    <Main
      user={user}
      onLogout={() => {
        setToken(null);
        setUser(null);
      }}
    />
  );
}

function Main({ user, onLogout }) {
  const socket = useMemo(() => connectSocket(), []);
  const voice = useMemo(() => new VoiceClient(socket), [socket]);
  const [voiceRooms, setVoiceRooms] = useState({}); // channelId -> participantes
  const [servers, setServers] = useState([]);
  const [serverId, setServerId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [channelByServer, setChannelByServer] = useState({});
  const [modal, setModal] = useState(() => (inviteFromPath() ? { type: 'join', code: inviteFromPath() } : null));

  useEffect(
    () => () => {
      voice.leave();
      socket.disconnect();
    },
    [socket, voice],
  );

  // Quem está em cada sala de voz (aparece na barra lateral, como no Discord).
  useEffect(() => {
    const onState = ({ channelId, participants }) => setVoiceRooms((m) => ({ ...m, [channelId]: participants }));
    socket.on('voice:state', onState);
    return () => socket.off('voice:state', onState);
  }, [socket]);

  useEffect(() => {
    if (!serverId) return;
    socket.emit('voice:list', { serverId }, (list) =>
      setVoiceRooms((m) => ({ ...m, ...Object.fromEntries((list || []).map((s) => [s.channelId, s.participants])) })),
    );
  }, [socket, serverId]);

  const loadServers = useCallback(async () => {
    const list = await api('/servers');
    setServers(list);
    setServerId((cur) => (cur && list.some((s) => s.id === cur) ? cur : list[0]?.id || null));
    return list;
  }, []);

  const loadDetail = useCallback(async (id) => {
    if (!id) return setDetail(null);
    setDetail(await api(`/servers/${id}`));
  }, []);

  useEffect(() => {
    loadServers();
  }, [loadServers]);

  useEffect(() => {
    loadDetail(serverId);
  }, [serverId, loadDetail]);

  useEffect(() => {
    const onUpdated = ({ serverId: id }) => {
      if (id === serverId) loadDetail(id);
      loadServers();
    };
    const onPresence = ({ userId, online }) =>
      setDetail((d) => d && { ...d, members: d.members.map((m) => (m.id === userId ? { ...m, online } : m)) });
    socket.on('server:updated', onUpdated);
    socket.on('presence', onPresence);
    return () => {
      socket.off('server:updated', onUpdated);
      socket.off('presence', onPresence);
    };
  }, [socket, serverId, loadDetail, loadServers]);

  const usersById = useMemo(() => Object.fromEntries((detail?.members || []).map((m) => [m.id, m])), [detail]);
  const me = detail?.members.find((m) => m.id === user.id);
  const isAdmin = me?.role === 'owner' || me?.role === 'admin';

  const channels = detail?.channels || [];
  const channelId = channels.some((c) => c.id === channelByServer[serverId])
    ? channelByServer[serverId]
    : channels.find((c) => c.type === 'text')?.id || channels[0]?.id;
  const channel = channels.find((c) => c.id === channelId);
  const selectChannel = (id) => setChannelByServer((m) => ({ ...m, [serverId]: id }));

  const afterJoin = async (id) => {
    window.history.replaceState(null, '', '/');
    await loadServers();
    setServerId(id);
    setModal(null);
  };

  return (
    <div className="app">
      <ServerRail
        servers={servers}
        activeId={serverId}
        onSelect={setServerId}
        onCreate={() => setModal({ type: 'createServer' })}
        onJoin={() => setModal({ type: 'join' })}
      />
      {detail ? (
        <>
          <ChannelSidebar
            server={detail}
            user={user}
            isAdmin={isAdmin}
            activeChannelId={channelId}
            onSelectChannel={selectChannel}
            onModal={setModal}
            onLogout={onLogout}
            voice={voice}
            voiceRooms={voiceRooms}
            usersById={usersById}
          />
          <main className="content">
            {channel?.type === 'workspace' && (
              <WorkspaceView key={channel.id} server={detail} channel={channel} user={user} usersById={usersById} socket={socket} onModal={setModal} />
            )}
            {channel?.type === 'screen' && <ScreenView key={channel.id} channel={channel} usersById={usersById} socket={socket} user={user} />}
            {channel?.type === 'text' && <ChatView key={channel.id} channel={channel} usersById={usersById} socket={socket} user={user} />}
            {channel?.type === 'voice' && (
              <VoiceView key={channel.id} channel={channel} voice={voice} participants={voiceRooms[channel.id] || []} usersById={usersById} />
            )}
            {channel?.type === 'tasks' && <TasksView key={channel.id} server={detail} channel={channel} user={user} usersById={usersById} socket={socket} />}
            {!channel && <div className="empty">Nenhum canal ainda. Crie um departamento e um canal.</div>}
          </main>
          <MemberList members={detail.members} />
        </>
      ) : (
        <div className="welcome">
          <h1>Bem-vindo ao DevCord, {user.username}!</h1>
          <p>Crie um servidor para sua equipe ou entre em um com um convite.</p>
          <div className="row">
            <button className="btn" onClick={() => setModal({ type: 'createServer' })}>Criar servidor</button>
            <button className="btn secondary" onClick={() => setModal({ type: 'join' })}>Entrar com convite</button>
          </div>
          <button className="link" onClick={onLogout}>Sair</button>
        </div>
      )}
      {modal && (
        <Modals
          modal={modal}
          server={detail}
          onClose={() => setModal(null)}
          onCreated={afterJoin}
          onJoined={afterJoin}
          onChanged={() => loadDetail(serverId)}
          onOpenChannel={selectChannel}
        />
      )}
    </div>
  );
}
