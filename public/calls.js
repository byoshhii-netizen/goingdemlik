/*
 * CigCig Sesli Arama — WhatsApp tarzı birebir ve grup sesli arama (WebRTC)
 * - Sinyalleşme socket.io (sunucu) üzerinden; ses doğrudan cihazlar arasında akar.
 * - Grup aramasında her katılımcı diğerleriyle ayrı bağlantı kurar (mesh).
 * - Gelen arama ekranı, zil sesi + titreşim, küçültülebilir arama penceresi,
 *   mikrofon kapatma, hoparlör seçimi (destekleyen tarayıcılarda), konuşan kişi göstergesi.
 */
(function () {
  'use strict';

  const esc = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const fmt = seconds => {
    const s = Math.max(0, Math.floor(seconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
  };
  const avatarHTML = (user, cls = '') => user?.avatar
    ? `<img class="cgc-avatar ${cls}" src="${esc(user.avatar)}" alt="" draggable="false" />`
    : `<span class="cgc-avatar cgc-avatar-ph ${cls}">${esc(String(user?.nickname || user?.username || '?').charAt(0).toLocaleUpperCase('tr-TR'))}</span>`;
  const nameOf = user => user?.nickname || user?.username || 'Kullanıcı';

  let socket = null;
  let call = null; // aktif arama durumu
  let incoming = null; // çalan arama
  let ringer = null;

  // ---------- Zil sesi (dosya gerektirmez) ----------
  function startRinging(outgoing = false) {
    stopRinging();
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(ctx.destination);
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      osc1.frequency.value = outgoing ? 425 : 660;
      osc2.frequency.value = outgoing ? 425 : 880;
      osc1.connect(gain); osc2.connect(gain);
      osc1.start(); osc2.start();
      let on = false;
      const pattern = outgoing ? [1000, 3000] : [400, 200, 400, 1600];
      let step = 0;
      const tick = () => {
        on = step % 2 === 0;
        gain.gain.setTargetAtTime(on ? (outgoing ? 0.05 : 0.09) : 0, ctx.currentTime, 0.02);
        if (!outgoing && on) { try { navigator.vibrate?.([300, 150, 300]); } catch { /* yoksay */ } }
        const wait = pattern[step % pattern.length];
        step += 1;
        ringer.timer = setTimeout(tick, wait);
      };
      ringer = { ctx, timer: 0 };
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      tick();
    } catch { /* zil opsiyonel */ }
  }
  function stopRinging() {
    if (!ringer) return;
    clearTimeout(ringer.timer);
    ringer.ctx.close().catch(() => {});
    ringer = null;
    try { navigator.vibrate?.(0); } catch { /* yoksay */ }
  }

  // ---------- Mikrofon ----------
  async function getMic() {
    if (window.CigCigVoice?.acquireMicrophone) return window.CigCigVoice.acquireMicrophone();
    return navigator.mediaDevices.getUserMedia({ audio: true });
  }

  // ---------- Arayüz ----------
  function ensureRoot() {
    let root = document.getElementById('cgc-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'cgc-root';
      document.body.appendChild(root);
    }
    return root;
  }

  function renderIncoming(snapshot) {
    const root = ensureRoot();
    const isGroup = snapshot.type === 'group';
    const title = isGroup ? snapshot.groupName : nameOf(snapshot.caller);
    const sub = isGroup ? `${nameOf(snapshot.caller)} grup sesli araması başlattı` : 'CigCig sesli arama';
    root.innerHTML = `<section class="cgc-screen cgc-incoming" role="dialog" aria-modal="true" aria-label="Gelen arama">
      <div class="cgc-bg" style="${snapshot.caller?.avatar ? `--cgc-bg:url('${esc(snapshot.caller.avatar)}')` : ''}"></div>
      <div class="cgc-top"><span class="cgc-lock"><i class="fas fa-lock"></i> Cihazlar arası şifreli</span></div>
      <div class="cgc-hero">
        <div class="cgc-pulse">${avatarHTML(snapshot.caller, 'is-xl')}</div>
        <h2>${esc(title)}</h2>
        <p>${esc(sub)}</p>
      </div>
      <div class="cgc-incoming-actions">
        <button type="button" class="cgc-round is-decline" data-act="decline" aria-label="Reddet"><i class="fas fa-phone-slash"></i></button>
        <button type="button" class="cgc-round is-accept" data-act="accept" aria-label="Kabul et"><i class="fas fa-phone"></i></button>
      </div>
      <div class="cgc-incoming-labels"><span>Reddet</span><span>Kabul et</span></div>
    </section>`;
    root.querySelector('[data-act="decline"]').addEventListener('click', () => declineIncoming());
    root.querySelector('[data-act="accept"]').addEventListener('click', () => acceptIncoming());
  }

  function renderCall() {
    if (!call) return;
    const root = ensureRoot();
    const peers = [...call.peers.values()];
    const isGroup = call.type === 'group';
    const title = isGroup ? call.groupName : nameOf(call.remoteUser);
    const tiles = isGroup
      ? `<div class="cgc-grid" data-count="${peers.length + 1}">
          <div class="cgc-tile is-me${call.muted ? ' is-muted' : ''}">${avatarHTML(call.me)}<span>Sen</span>${call.muted ? '<i class="fas fa-microphone-slash cgc-tile-mute"></i>' : ''}</div>
          ${peers.map(peer => `<div class="cgc-tile${peer.speaking ? ' is-speaking' : ''}${peer.muted ? ' is-muted' : ''}" data-peer="${esc(peer.socketId)}">${avatarHTML(peer.user)}<span>${esc(nameOf(peer.user))}</span>${peer.muted ? '<i class="fas fa-microphone-slash cgc-tile-mute"></i>' : ''}${peer.state !== 'connected' ? '<em>Bağlanıyor…</em>' : ''}</div>`).join('')}
        </div>`
      : `<div class="cgc-hero"><div class="cgc-pulse${call.connectedAt ? ' is-connected' : ''}${peers[0]?.speaking ? ' is-speaking' : ''}">${avatarHTML(call.remoteUser, 'is-xl')}</div><h2>${esc(title)}</h2><p class="cgc-status" data-status></p></div>`;
    root.innerHTML = `<section class="cgc-screen cgc-active${call.minimized ? ' is-minimized' : ''}" role="dialog" aria-label="Sesli arama">
      <div class="cgc-bg" style="${call.remoteUser?.avatar && !isGroup ? `--cgc-bg:url('${esc(call.remoteUser.avatar)}')` : ''}"></div>
      <div class="cgc-top">
        <button type="button" class="cgc-icon" data-act="minimize" aria-label="Küçült"><i class="fas fa-chevron-down"></i></button>
        <span class="cgc-lock"><i class="fas fa-lock"></i> ${isGroup ? esc(title) : 'Cihazlar arası şifreli'}</span>
        <span class="cgc-top-time" data-status-top></span>
      </div>
      ${tiles}
      ${isGroup ? '<p class="cgc-status cgc-status-group" data-status></p>' : ''}
      <div class="cgc-controls">
        <button type="button" class="cgc-round is-ghost${call.speaker ? ' is-on' : ''}" data-act="speaker" aria-label="Hoparlör" ${call.canPickSpeaker ? '' : 'hidden'}><i class="fas fa-volume-high"></i></button>
        <button type="button" class="cgc-round is-ghost${call.muted ? ' is-on' : ''}" data-act="mute" aria-label="${call.muted ? 'Mikrofonu aç' : 'Sessize al'}"><i class="fas fa-microphone${call.muted ? '-slash' : ''}"></i></button>
        <button type="button" class="cgc-round is-decline" data-act="hangup" aria-label="Aramayı bitir"><i class="fas fa-phone-slash"></i></button>
      </div>
    </section>
    <button type="button" class="cgc-pill${call.minimized ? ' is-visible' : ''}" data-act="restore" aria-label="Aramaya dön"><i class="fas fa-phone"></i><span>${esc(title)}</span><b data-status-pill></b></button>`;
    root.querySelector('[data-act="minimize"]').addEventListener('click', () => { call.minimized = true; renderCall(); });
    root.querySelector('[data-act="restore"]').addEventListener('click', () => { call.minimized = false; renderCall(); });
    root.querySelector('[data-act="mute"]').addEventListener('click', toggleMute);
    root.querySelector('[data-act="hangup"]').addEventListener('click', () => hangup());
    root.querySelector('[data-act="speaker"]')?.addEventListener('click', toggleSpeaker);
    updateStatus();
  }

  function statusText() {
    if (!call) return '';
    if (call.connectedAt) return fmt((Date.now() - call.connectedAt) / 1000);
    if (call.type === 'group') return call.peers.size ? 'Bağlanıyor…' : 'Diğer üyeler bekleniyor…';
    return call.outgoing ? (call.ringing ? 'Çalıyor…' : 'Aranıyor…') : 'Bağlanıyor…';
  }
  function updateStatus() {
    const text = statusText();
    document.querySelectorAll('#cgc-root [data-status], #cgc-root [data-status-top], #cgc-root [data-status-pill]').forEach(el => { el.textContent = text; });
  }

  function toast(message, type = 'error') {
    if (typeof window.toast === 'function') window.toast(message, type);
  }

  // ---------- WebRTC ----------
  function createPeer(remoteSocketId, user) {
    const pc = new RTCPeerConnection({ iceServers: call.iceServers, iceCandidatePoolSize: 2 });
    const peer = { socketId: remoteSocketId, user, pc, audio: null, speaking: false, muted: false, state: 'new', pendingCandidates: [], makingOffer: false };
    call.peers.set(remoteSocketId, peer);
    call.stream.getTracks().forEach(track => pc.addTrack(track, call.stream));
    pc.onicecandidate = event => {
      if (event.candidate) signal(remoteSocketId, { candidate: event.candidate.toJSON ? event.candidate.toJSON() : event.candidate });
    };
    pc.ontrack = event => {
      const [stream] = event.streams;
      if (!stream) return;
      if (!peer.audio) {
        peer.audio = document.createElement('audio');
        peer.audio.autoplay = true;
        peer.audio.setAttribute('playsinline', '');
        peer.audio.className = 'cgc-remote-audio';
        document.body.appendChild(peer.audio);
        if (call.sinkId && peer.audio.setSinkId) peer.audio.setSinkId(call.sinkId).catch(() => {});
      }
      peer.audio.srcObject = stream;
      peer.audio.play().catch(() => {});
      watchSpeaking(peer, stream);
    };
    pc.onconnectionstatechange = () => {
      peer.state = pc.connectionState;
      if (pc.connectionState === 'connected') {
        if (!call.connectedAt) call.connectedAt = Date.now();
        stopRinging();
      }
      if (pc.connectionState === 'failed') {
        try { pc.restartIce(); } catch { /* yoksay */ }
      }
      renderCall();
    };
    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'disconnected') {
        setTimeout(() => { if (pc.iceConnectionState === 'disconnected') { try { pc.restartIce(); } catch { /* yoksay */ } } }, 2500);
      }
    };
    pc.onnegotiationneeded = async () => {
      if (!peer.initiator) return;
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        signal(remoteSocketId, { description: pc.localDescription });
      } catch (error) {
        console.warn('[call] offer hatası', error.message);
      } finally {
        peer.makingOffer = false;
      }
    };
    return peer;
  }

  function watchSpeaking(peer, stream) {
    try {
      if (!call.audioCtx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        call.audioCtx = new Ctx();
      }
      const source = call.audioCtx.createMediaStreamSource(stream);
      const analyser = call.audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      peer.analyser = analyser;
    } catch { /* gösterge opsiyonel */ }
  }

  function signal(to, data) {
    socket?.emit('call:signal', { callId: call.id, to, data });
  }

  async function handleSignal({ callId, from, data }) {
    if (!call || call.id !== callId) return;
    let peer = call.peers.get(from);
    if (!peer) {
      const participant = call.participantInfo.get(from);
      peer = createPeer(from, participant?.user || { username: '?' });
    }
    const pc = peer.pc;
    try {
      if (data.description) {
        const description = data.description;
        const collision = description.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
        if (collision && peer.initiator) return; // "kibar olmayan" taraf teklifini korur
        await pc.setRemoteDescription(description);
        for (const candidate of peer.pendingCandidates.splice(0)) await pc.addIceCandidate(candidate).catch(() => {});
        if (description.type === 'offer') {
          await pc.setLocalDescription();
          signal(from, { description: pc.localDescription });
        }
      } else if (data.candidate) {
        if (!pc.remoteDescription) peer.pendingCandidates.push(data.candidate);
        else await pc.addIceCandidate(data.candidate).catch(() => {});
      }
    } catch (error) {
      console.warn('[call] sinyal işlenemedi', error.message);
    }
  }

  function closePeer(socketId) {
    const peer = call?.peers.get(socketId);
    if (!peer) return;
    try { peer.pc.close(); } catch { /* yoksay */ }
    if (peer.audio) { peer.audio.srcObject = null; peer.audio.remove(); }
    call.peers.delete(socketId);
  }

  function cleanupCall(reasonText) {
    stopRinging();
    if (!call) return;
    clearInterval(call.timer);
    for (const socketId of [...call.peers.keys()]) closePeer(socketId);
    call.stream?.getTracks().forEach(track => track.stop());
    call.audioCtx?.close().catch(() => {});
    call.wakeLock?.release?.().catch(() => {});
    const duration = call.connectedAt ? fmt((Date.now() - call.connectedAt) / 1000) : '';
    call = null;
    const root = document.getElementById('cgc-root');
    if (root) {
      root.innerHTML = reasonText ? `<div class="cgc-ended-toast">${esc(reasonText)}${duration ? ` · ${duration}` : ''}</div>` : '';
      setTimeout(() => { if (!call && !incoming) root.innerHTML = ''; }, 2600);
    }
    window.dispatchEvent(new CustomEvent('cigcig:call-state', { detail: { active: false } }));
  }

  async function beginLocal(snapshot, iceServers, { outgoing, remoteUser }) {
    const stream = await getMic();
    call = {
      id: snapshot.callId,
      type: snapshot.type,
      groupId: snapshot.groupId,
      groupName: snapshot.groupName,
      groupSlug: snapshot.groupSlug,
      outgoing,
      ringing: false,
      remoteUser,
      me: null,
      iceServers: iceServers || [{ urls: 'stun:stun.l.google.com:19302' }],
      stream,
      peers: new Map(),
      participantInfo: new Map(),
      muted: false,
      speaker: false,
      sinkId: '',
      canPickSpeaker: typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype,
      connectedAt: null,
      minimized: false,
      timer: 0
    };
    const me = typeof currentUser !== 'undefined' ? currentUser : null; // app.js genel değişkeni
    call.me = { username: me?.username, nickname: me?.nickname, avatar: me?.avatar_removed ? '' : me?.avatar };
    try { call.wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* yoksay */ }
    call.timer = setInterval(() => {
      updateStatus();
      // Konuşan kişi göstergesi
      let changed = false;
      for (const peer of call?.peers.values() || []) {
        if (!peer.analyser) continue;
        const data = new Uint8Array(peer.analyser.frequencyBinCount);
        peer.analyser.getByteFrequencyData(data);
        const level = data.reduce((sum, value) => sum + value, 0) / data.length;
        const speaking = level > 18;
        if (speaking !== peer.speaking) { peer.speaking = speaking; changed = true; }
      }
      if (changed) {
        document.querySelectorAll('#cgc-root [data-peer]').forEach(tile => tile.classList.toggle('is-speaking', !!call.peers.get(tile.dataset.peer)?.speaking));
        const pulse = document.querySelector('#cgc-root .cgc-active .cgc-pulse');
        if (pulse && call.type === 'direct') pulse.classList.toggle('is-speaking', !![...call.peers.values()][0]?.speaking);
      }
    }, 250);
    window.dispatchEvent(new CustomEvent('cigcig:call-state', { detail: { active: true } }));
  }

  // ---------- Genel API ----------
  function emitAck(event, payload) {
    return new Promise(resolve => {
      if (!socket?.connected) return resolve({ error: 'Bağlantı yok. İnternetini kontrol et.' });
      const timer = setTimeout(() => resolve({ error: 'Sunucu yanıt vermedi' }), 12000);
      socket.emit(event, payload, response => { clearTimeout(timer); resolve(response || {}); });
    });
  }

  async function start(target) {
    if (call) { toast('Zaten bir aramadasın'); return; }
    if (!window.RTCPeerConnection || !navigator.mediaDevices?.getUserMedia) { toast('Bu tarayıcı sesli aramayı desteklemiyor'); return; }
    // Mikrofon iznini önce al (Android'de izin penceresi için kullanıcı hareketi gerekir)
    let probe;
    try { probe = await getMic(); } catch (error) { window.CigCigVoice?.showMicrophoneHelp?.(error); return; }
    probe.getTracks().forEach(track => track.stop());
    const response = await emitAck('call:start', target);
    if (response.error) { toast(response.error); return; }
    const snapshot = response.call;
    try {
      await beginLocal(snapshot, response.iceServers, { outgoing: true, remoteUser: response.peer || null });
    } catch (error) {
      socket.emit('call:leave', { callId: snapshot.callId });
      window.CigCigVoice?.showMicrophoneHelp?.(error);
      return;
    }
    if (response.join) {
      const joined = await emitAck('call:join', { callId: snapshot.callId });
      if (joined.error) { toast(joined.error); cleanupCall(''); return; }
      connectToExisting(joined.call);
    } else {
      call.ringing = true;
      startRinging(true);
    }
    renderCall();
  }

  // Gruba sonradan katılan kişi: mevcut katılımcılar ona teklif gönderir.
  function connectToExisting(snapshot) {
    for (const participant of snapshot.participants || []) {
      call.participantInfo.set(participant.socketId, participant);
      if (participant.socketId === socket.id) continue;
      if (call.type === 'direct' && !call.remoteUser) call.remoteUser = participant.user;
    }
  }

  async function acceptIncoming() {
    const snapshot = incoming;
    if (!snapshot) return;
    stopRinging();
    incoming = null;
    try {
      await beginLocal(snapshot, null, { outgoing: false, remoteUser: snapshot.type === 'direct' ? snapshot.caller : null });
    } catch (error) {
      socket.emit('call:decline', { callId: snapshot.callId });
      ensureRoot().innerHTML = '';
      window.CigCigVoice?.showMicrophoneHelp?.(error);
      return;
    }
    const joined = await emitAck('call:join', { callId: snapshot.callId });
    if (joined.error) { toast(joined.error); cleanupCall(''); return; }
    call.iceServers = joined.iceServers || call.iceServers;
    connectToExisting(joined.call);
    renderCall();
  }

  function declineIncoming(busy = false) {
    if (!incoming) return;
    socket?.emit('call:decline', { callId: incoming.callId, busy });
    incoming = null;
    stopRinging();
    ensureRoot().innerHTML = '';
  }

  function hangup() {
    if (!call) return;
    socket?.emit('call:leave', { callId: call.id });
    cleanupCall('Arama bitti');
  }

  function toggleMute() {
    if (!call) return;
    call.muted = !call.muted;
    call.stream.getAudioTracks().forEach(track => { track.enabled = !call.muted; });
    socket?.emit('call:mute', { callId: call.id, muted: call.muted });
    renderCall();
  }

  async function toggleSpeaker() {
    if (!call?.canPickSpeaker) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const outputs = devices.filter(device => device.kind === 'audiooutput');
      if (outputs.length < 2) { toast('Başka bir ses çıkışı bulunamadı', 'success'); return; }
      const currentIndex = Math.max(0, outputs.findIndex(device => device.deviceId === call.sinkId));
      const next = outputs[(currentIndex + 1) % outputs.length];
      call.sinkId = next.deviceId;
      call.speaker = next.deviceId !== 'default';
      for (const peer of call.peers.values()) await peer.audio?.setSinkId?.(call.sinkId).catch(() => {});
      toast(next.label || 'Ses çıkışı değişti', 'success');
      renderCall();
    } catch { /* yoksay */ }
  }

  function attachSocket(nextSocket) {
    if (!nextSocket || nextSocket === socket) return;
    socket = nextSocket;
    socket.on('call:incoming', snapshot => {
      if (!snapshot?.callId) return;
      if (call) {
        // Meşgul: birebir aramayı otomatik reddet, grup davetini sessizce yok say.
        if (snapshot.type === 'direct') socket.emit('call:decline', { callId: snapshot.callId, busy: true });
        return;
      }
      incoming = snapshot;
      renderIncoming(snapshot);
      startRinging(false);
    });
    socket.on('call:participant-joined', payload => {
      if (!call || payload.callId !== call.id) return;
      call.participantInfo.set(payload.socketId, { socketId: payload.socketId, user: payload.user });
      if (call.type === 'direct') { call.remoteUser = call.remoteUser || payload.user; call.ringing = false; stopRinging(); }
      // Mevcut katılımcı yeni gelen kişiye teklif başlatır.
      const peer = createPeer(payload.socketId, payload.user);
      peer.initiator = true;
      renderCall();
    });
    socket.on('call:participant-left', payload => {
      if (!call || payload.callId !== call.id) return;
      closePeer(payload.socketId);
      renderCall();
    });
    socket.on('call:signal', handleSignal);
    socket.on('call:mute', payload => {
      const peer = call?.peers.get(payload.socketId);
      if (peer) { peer.muted = !!payload.muted; renderCall(); }
    });
    socket.on('call:ended', payload => {
      if (incoming && payload.callId === incoming.callId) {
        incoming = null;
        stopRinging();
        ensureRoot().innerHTML = payload.reason === 'answered-elsewhere' ? '' : '<div class="cgc-ended-toast">Cevapsız arama</div>';
        setTimeout(() => { if (!call && !incoming) ensureRoot().innerHTML = ''; }, 2400);
        return;
      }
      if (!call || payload.callId !== call.id) return;
      const reasons = { declined: 'Arama reddedildi', busy: 'Kullanıcı meşgul', missed: 'Yanıt yok', cancelled: 'Arama iptal edildi', 'answered-elsewhere': 'Başka cihazda yanıtlandı' };
      cleanupCall(reasons[payload.reason] || 'Arama bitti');
    });
    socket.on('call:answered-elsewhere', payload => {
      if (incoming && payload.callId === incoming.callId) {
        incoming = null;
        stopRinging();
        ensureRoot().innerHTML = '';
      }
    });
    socket.on('disconnect', () => {
      // Kısa kopmalarda bağlantı otomatik geri gelir; arama varsa ses P2P devam eder.
    });
  }

  window.addEventListener('beforeunload', () => { if (call) socket?.emit('call:leave', { callId: call.id }); });

  window.CigCigCall = {
    attachSocket,
    start,
    startDirect: username => start({ username }),
    startGroup: groupSlug => start({ groupSlug }),
    isActive: () => Boolean(call),
    activeGroup: groupId => emitAck('call:active-group', { groupId })
  };
})();
