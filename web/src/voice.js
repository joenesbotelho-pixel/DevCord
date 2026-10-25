import { useSyncExternalStore } from 'react';
import { getRtcConfig } from './api.js';

const SPEAKING_LEVEL = 0.025;

// Chamada de voz em malha: cada participante tem uma conexão WebRTC com cada outro.
// Vive fora dos componentes para a chamada continuar ao trocar de canal (como no Discord).
export class VoiceClient {
  constructor(socket) {
    this.socket = socket;
    this.peers = new Map(); // socketId -> { pc, audio }
    this.chains = new Map(); // socketId -> fila de sinais (processados em ordem)
    this.listeners = new Set();
    this.stream = null;
    this.audioCtx = null;
    this.meters = new Map(); // id -> analyser
    this.state = { channelId: null, muted: false, deafened: false, speaking: new Set(), error: null, connecting: false };
    socket.on('voice:signal', (msg) => this.enqueue(msg.from, () => this.onSignal(msg)));
    socket.on('voice:state', (s) => this.onRoomState(s));
    this.meterTimer = setInterval(() => this.measure(), 120);
  }

  // ---- store para o React ----
  subscribe = (fn) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.state;
  set(patch) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }

  // ---- entrar / sair ----
  async join(channelId) {
    if (this.state.channelId === channelId || this.state.connecting) return;
    await this.leave();
    this.set({ connecting: true, error: null });
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
    } catch (err) {
      const error =
        err.name === 'NotAllowedError'
          ? 'Microfone bloqueado: libere o acesso no cadeado ao lado do endereço e tente de novo.'
          : err.name === 'NotFoundError'
            ? 'Nenhum microfone encontrado neste computador.'
            : !window.isSecureContext
              ? 'A voz só funciona em https:// ou localhost.'
              : `Microfone indisponível: ${err.message}`;
      return this.set({ connecting: false, error });
    }
    this.ice = await getRtcConfig();
    this.audioCtx = new AudioContext();
    this.addMeter('me', this.stream);
    this.applyMute();

    const r = await this.socket.timeout(8000).emitWithAck('voice:join', { channelId }).catch(() => ({ error: 'O servidor não respondeu' }));
    if (r.error) {
      this.release();
      return this.set({ connecting: false, error: r.error });
    }
    this.set({ channelId, connecting: false });
    this.socket.emit('voice:update', { muted: this.state.muted, deafened: this.state.deafened });
    for (const peer of r.peers) this.enqueue(peer, () => this.call(peer));
  }

  async leave() {
    if (!this.state.channelId && !this.stream) return;
    this.socket.emit('voice:leave');
    this.release();
    this.set({ channelId: null, speaking: new Set() });
  }

  release() {
    for (const id of [...this.peers.keys()]) this.closePeer(id);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.meters.clear();
    this.audioCtx?.close().catch(() => {});
    this.audioCtx = null;
  }

  toggleMute() {
    // Sair do "ensurdecido" ao desmutar, como no Discord.
    const muted = !this.state.muted;
    this.set({ muted, deafened: muted ? this.state.deafened : false });
    this.applyMute();
  }

  toggleDeafen() {
    const deafened = !this.state.deafened;
    this.set({ deafened, muted: deafened ? true : this.state.muted });
    this.applyMute();
  }

  applyMute() {
    this.stream?.getAudioTracks().forEach((t) => (t.enabled = !this.state.muted));
    this.peers.forEach((p) => p.audio && (p.audio.muted = this.state.deafened));
    if (this.state.channelId) this.socket.emit('voice:update', { muted: this.state.muted, deafened: this.state.deafened });
  }

  // ---- WebRTC ----
  enqueue(id, fn) {
    const next = (this.chains.get(id) || Promise.resolve()).then(fn).catch((err) => console.warn('[voz]', err));
    this.chains.set(id, next);
  }

  createPeer(socketId) {
    this.closePeer(socketId);
    const pc = new RTCPeerConnection(this.ice);
    const peer = { pc, audio: null };
    this.peers.set(socketId, peer);
    this.stream.getTracks().forEach((t) => pc.addTrack(t, this.stream));
    pc.onicecandidate = (e) => e.candidate && this.socket.emit('voice:signal', { to: socketId, data: { candidate: e.candidate } });
    pc.ontrack = (e) => {
      const audio = new Audio();
      audio.srcObject = e.streams[0];
      audio.muted = this.state.deafened;
      audio.play().catch(() => {});
      peer.audio = audio;
      this.addMeter(socketId, e.streams[0]);
    };
    return peer;
  }

  closePeer(socketId) {
    const peer = this.peers.get(socketId);
    if (!peer) return;
    peer.pc.close();
    if (peer.audio) peer.audio.srcObject = null;
    this.peers.delete(socketId);
    this.meters.delete(socketId);
    this.chains.delete(socketId);
  }

  async call(socketId) {
    const { pc } = this.createPeer(socketId);
    await pc.setLocalDescription(await pc.createOffer());
    this.socket.emit('voice:signal', { to: socketId, data: { sdp: pc.localDescription } });
  }

  async onSignal({ from, data }) {
    if (!this.state.channelId || !this.stream) return;
    if (data.sdp?.type === 'offer') {
      const { pc } = this.createPeer(from);
      await pc.setRemoteDescription(data.sdp);
      await pc.setLocalDescription(await pc.createAnswer());
      this.socket.emit('voice:signal', { to: from, data: { sdp: pc.localDescription } });
    } else if (data.sdp?.type === 'answer') {
      await this.peers.get(from)?.pc.setRemoteDescription(data.sdp);
    } else if (data.candidate) {
      await this.peers.get(from)?.pc.addIceCandidate(data.candidate).catch(() => {});
    }
  }

  // Fecha conexões de quem saiu da sala.
  onRoomState({ channelId, participants }) {
    if (channelId !== this.state.channelId) return;
    const present = new Set(participants.map((p) => p.socketId));
    for (const id of [...this.peers.keys()]) if (!present.has(id)) this.closePeer(id);
  }

  // ---- quem está falando ----
  addMeter(id, stream) {
    if (!this.audioCtx) return;
    const analyser = this.audioCtx.createAnalyser();
    analyser.fftSize = 512;
    this.audioCtx.createMediaStreamSource(stream).connect(analyser);
    this.meters.set(id, analyser);
  }

  measure() {
    if (!this.meters.size) return;
    const buf = new Float32Array(512);
    const speaking = new Set();
    for (const [id, analyser] of this.meters) {
      if (id === 'me' && this.state.muted) continue;
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      if (Math.sqrt(sum / buf.length) > SPEAKING_LEVEL) speaking.add(id === 'me' ? this.socket.id : id);
    }
    const prev = this.state.speaking;
    if (speaking.size !== prev.size || [...speaking].some((id) => !prev.has(id))) this.set({ speaking });
  }
}

export const useVoice = (voice) => useSyncExternalStore(voice.subscribe, voice.getSnapshot);
