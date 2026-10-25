import { useEffect, useRef, useState } from 'react';
import { getRtcConfig } from '../api.js';

// STUN padrão até chegar a configuração do servidor (que pode incluir TURN).
let ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
getRtcConfig().then((c) => (ICE = c));

// Perfis de qualidade. "detail" prioriza nitidez (código/texto); "motion" prioriza fluidez.
const QUALITY = {
  detail: { label: 'Nítido (código) · 1080p 30fps', width: 1920, height: 1080, fps: 30, bitrate: 6_000_000, hint: 'detail', degradation: 'maintain-resolution' },
  motion: { label: 'Fluido (vídeo) · 720p 60fps', width: 1280, height: 720, fps: 60, bitrate: 6_000_000, hint: 'motion', degradation: 'maintain-framerate' },
  max: { label: 'Máximo · 1440p 60fps', width: 2560, height: 1440, fps: 60, bitrate: 12_000_000, hint: 'detail', degradation: 'balanced' },
};

// Prefere codecs mais eficientes para tela (AV1/VP9, depois H.264), se o navegador tiver.
function preferCodecs(transceiver) {
  const caps = RTCRtpSender.getCapabilities?.('video');
  if (!caps || !transceiver.setCodecPreferences) return;
  const rank = (c) => ['video/AV1', 'video/VP9', 'video/H264', 'video/VP8'].indexOf(c.mimeType);
  const sorted = [...caps.codecs].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    return (ra === -1 ? 99 : ra) - (rb === -1 ? 99 : rb);
  });
  try {
    transceiver.setCodecPreferences(sorted);
  } catch {}
}

async function applyQuality(sender, q) {
  const params = sender.getParameters();
  if (!params.encodings?.length) params.encodings = [{}];
  params.encodings[0].maxBitrate = q.bitrate;
  params.encodings[0].maxFramerate = q.fps;
  params.degradationPreference = q.degradation;
  await sender.setParameters(params).catch(() => {});
}

// Compartilhamento de tela 1→N: quem compartilha abre uma conexão WebRTC por espectador.
export default function ScreenView({ channel, usersById, socket, user }) {
  const [state, setState] = useState({ sharerId: null, sharerSocket: null });
  const [watching, setWatching] = useState(false);
  const [error, setError] = useState('');
  const [quality, setQuality] = useState('detail');
  const videoRef = useRef(null);
  const stageRef = useRef(null);
  const streamRef = useRef(null);
  const qualityRef = useRef(QUALITY.detail);
  const peersRef = useRef(new Map()); // socketId -> RTCPeerConnection

  const sharing = state.sharerSocket && state.sharerSocket === socket.id;

  function closePeers() {
    peersRef.current.forEach((pc) => pc.close());
    peersRef.current.clear();
  }

  useEffect(() => {
    socket.emit('screen:get', { channelId: channel.id }, (s) => s && setState(s));
    const onState = (s) => {
      if (s.channelId !== channel.id) return;
      setState(s);
      if (!s.sharerSocket) {
        setWatching(false);
        closePeers();
        if (videoRef.current) videoRef.current.srcObject = null;
      }
    };

    // Lado de quem compartilha: um espectador pediu para assistir.
    const onViewer = async ({ channelId, viewerSocket }) => {
      if (channelId !== channel.id || !streamRef.current) return;
      const pc = new RTCPeerConnection(ICE);
      peersRef.current.set(viewerSocket, pc);
      for (const track of streamRef.current.getTracks()) {
        const sender = pc.addTrack(track, streamRef.current);
        if (track.kind !== 'video') continue;
        pc.videoSender = sender;
        const transceiver = pc.getTransceivers().find((t) => t.sender === sender);
        if (transceiver) preferCodecs(transceiver);
      }
      pc.onicecandidate = (e) => e.candidate && socket.emit('screen:signal', { to: viewerSocket, data: { candidate: e.candidate } });
      await pc.setLocalDescription(await pc.createOffer());
      socket.emit('screen:signal', { to: viewerSocket, data: { sdp: pc.localDescription } });
    };

    const onSignal = async ({ from, data }) => {
      let pc = peersRef.current.get(from);
      if (data.sdp?.type === 'offer') {
        pc?.close();
        pc = new RTCPeerConnection(ICE);
        peersRef.current.set(from, pc);
        pc.ontrack = (e) => {
          if (videoRef.current) videoRef.current.srcObject = e.streams[0];
        };
        pc.onicecandidate = (e) => e.candidate && socket.emit('screen:signal', { to: from, data: { candidate: e.candidate } });
        await pc.setRemoteDescription(data.sdp);
        await pc.setLocalDescription(await pc.createAnswer());
        socket.emit('screen:signal', { to: from, data: { sdp: pc.localDescription } });
      } else if (data.sdp?.type === 'answer') {
        await pc?.setRemoteDescription(data.sdp);
        // Taxa de bits padrão do WebRTC é baixa para tela; sobe após a negociação.
        if (pc?.videoSender) await applyQuality(pc.videoSender, qualityRef.current);
      } else if (data.candidate) {
        await pc?.addIceCandidate(data.candidate).catch(() => {});
      }
    };

    socket.on('screen:state', onState);
    socket.on('screen:viewer', onViewer);
    socket.on('screen:signal', onSignal);
    return () => {
      socket.off('screen:state', onState);
      socket.off('screen:viewer', onViewer);
      socket.off('screen:signal', onSignal);
      stopSharing();
      closePeers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.id, socket]);

  async function startSharing() {
    setError('');
    try {
      const q = QUALITY[quality];
      qualityRef.current = q;
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { ideal: q.width }, height: { ideal: q.height }, frameRate: { ideal: q.fps, max: q.fps } },
        audio: true,
      });
      const video = stream.getVideoTracks()[0];
      video.contentHint = q.hint;
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      video.addEventListener('ended', stopSharing);
      socket.emit('screen:start', { channelId: channel.id });
    } catch (err) {
      setError(err.message);
    }
  }

  function stopSharing() {
    if (!streamRef.current) return;
    streamRef.current.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    closePeers();
    socket.emit('screen:stop', { channelId: channel.id });
  }

  function watch() {
    setWatching(true);
    socket.emit('screen:watch', { channelId: channel.id });
  }

  const sharer = usersById[state.sharerId];

  return (
    <div className="screen">
      <header className="topbar">
        <span className="hash">🖥</span> <strong>{channel.name}</strong>
        <span className="muted topbar-sub">
          {sharer ? `${sharer.id === user.id ? 'Você está' : `${sharer.username} está`} compartilhando a tela` : 'Ninguém está compartilhando'}
        </span>
      </header>
      <div className="screen-stage" ref={stageRef}>
        <video ref={videoRef} autoPlay playsInline muted={sharing} className={sharing || watching ? '' : 'hidden'} />
        {(sharing || watching) && (
          <button
            className="btn small secondary fullscreen-btn"
            onClick={() => (document.fullscreenElement ? document.exitFullscreen() : stageRef.current?.requestFullscreen())}
          >
            ⛶ Tela cheia
          </button>
        )}
        {!sharing && !watching && (
          <div className="empty-card">
            {state.sharerSocket ? (
              <>
                <h3>{sharer?.username} está ao vivo</h3>
                <button className="btn" onClick={watch}>Assistir</button>
              </>
            ) : (
              <>
                <h3>Compartilhe sua tela com a equipe</h3>
                <p className="muted">Ótimo para mostrar algo rápido. Para codar junto, use as estações de trabalho.</p>
                <label className="quality-pick">
                  Qualidade
                  <select value={quality} onChange={(e) => setQuality(e.target.value)}>
                    {Object.entries(QUALITY).map(([k, q]) => (
                      <option key={k} value={k}>{q.label}</option>
                    ))}
                  </select>
                </label>
                <button className="btn" onClick={startSharing}>Compartilhar tela</button>
              </>
            )}
            {error && <div className="error">{error}</div>}
          </div>
        )}
      </div>
      {sharing && (
        <div className="screen-bar">
          <button className="btn danger" onClick={stopSharing}>Parar de compartilhar</button>
        </div>
      )}
    </div>
  );
}
