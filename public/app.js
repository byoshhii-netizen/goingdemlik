let currentUser = null;
let currentToken = localStorage.getItem('token');
let activeStoryAudio = null;
let storyComposerAudio = null;
let siteName = 'CigCig';
let firstVisitAuthEnabled = false;
let activeVoiceCall = null;
let voiceCallPoll = null;
let incomingCallPoll = null;
let groupChatSelection = new Set();
let groupChatSelectionMode = false;

localStorage.removeItem('cigcig_theme');
document.documentElement.style.colorScheme = 'dark';
function applyDisplayTheme() { document.body.dataset.theme = 'dark'; }
applyDisplayTheme();

function playNotificationTone() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = window.__cigcigNotifyCtx || new AudioContextClass();
    window.__cigcigNotifyCtx = ctx;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'triangle';
    oscillator.frequency.value = 760;
    gain.gain.value = 0.035;
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    const now = ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(0.035, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    oscillator.stop(now + 0.2);
  } catch {}
}

async function playConfiguredNotificationSound(type = 'message') {
  try {
    const settings = await fetch('/api/settings/public').then(r => r.json()).catch(() => ({}));
    const url = type === 'mention' ? settings.mention_notification_sound_url : settings.message_notification_sound_url;
    if (!url) {
      playNotificationTone();
      return;
    }
    const audio = new Audio(url);
    audio.volume = 0.8;
    audio.play().catch(() => playNotificationTone());
  } catch {
    playNotificationTone();
  }
}

async function triggerGroupMessageNotification(groupName, senderName, previewText) {
  await playConfiguredNotificationSound('message');
  if ('Notification' in window) {
    const permission = Notification.permission;
    if (permission === 'granted') {
      new Notification(groupName ? `${groupName} — ${senderName}` : senderName, {
        body: previewText || 'Yeni bir mesaj var.',
        tag: 'cigcig-group-message'
      });
      return;
    }
    if (permission === 'default') {
      Notification.requestPermission().then(permissionState => {
        if (permissionState === 'granted') {
          new Notification(groupName ? `${groupName} — ${senderName}` : senderName, {
            body: previewText || 'Yeni bir mesaj var.',
            tag: 'cigcig-group-message'
          });
        }
      }).catch(() => {});
    }
  }
}

async function triggerMentionNotification(mentionText) {
  await playConfiguredNotificationSound('mention');
  if ('Notification' in window) {
    const permission = Notification.permission;
    if (permission === 'granted') {
      new Notification('Etiketlendin', { body: mentionText || 'Birisi seni etiketledi.', tag: 'cigcig-mention' });
      return;
    }
    if (permission === 'default') {
      Notification.requestPermission().then(permissionState => {
        if (permissionState === 'granted') {
          new Notification('Etiketlendin', { body: mentionText || 'Birisi seni etiketledi.', tag: 'cigcig-mention' });
        }
      }).catch(() => {});
    }
  }
}

function closeOpenMessageMenu() {
  document.querySelectorAll('.msg-menu-popover').forEach(menu => menu.remove());
}

const SITE_URL = 'https://cigcig.xyz';

function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }

function updatePageMeta(title, description, imageUrl) {
  document.title = title;
  let desc = document.querySelector('meta[name="description"]');
  if (!desc) { desc = document.createElement('meta'); desc.setAttribute('name','description'); document.head.appendChild(desc); }
  desc.setAttribute('content', description);

  const ogFields = { 'og:title': title, 'og:description': description, 'og:image': imageUrl || (SITE_URL + '/cigcig.png'), 'og:url': location.href };
  Object.entries(ogFields).forEach(([prop, content]) => {
    let el = document.querySelector(`meta[property="${prop}"]`);
    if (!el) { el = document.createElement('meta'); el.setAttribute('property', prop); document.head.appendChild(el); }
    el.setAttribute('content', content);
  });

  const twFields = { 'twitter:title': title, 'twitter:description': description, 'twitter:image': imageUrl || (SITE_URL + '/cigcig.png') };
  Object.entries(twFields).forEach(([name, content]) => {
    let el = document.querySelector(`meta[name="${name}"]`);
    if (!el) { el = document.createElement('meta'); el.setAttribute('name', name); document.head.appendChild(el); }
    el.setAttribute('content', content);
  });

  let canonical = document.querySelector('link[rel="canonical"]');
  if (!canonical) { canonical = document.createElement('link'); canonical.setAttribute('rel','canonical'); document.head.appendChild(canonical); }
  canonical.setAttribute('href', new URL(location.pathname, SITE_URL).href);

  let ld = document.getElementById('page-jsonld');
  if (!ld) { ld = document.createElement('script'); ld.type = 'application/ld+json'; ld.id = 'page-jsonld'; document.head.appendChild(ld); }
  ld.textContent = '';
}

function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }

function toast(msg, type = 'success', duration = 3500) {
  const c = $('#toast-container');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<i class="fas fa-${type === 'success' ? 'check-circle' : 'exclamation-circle'}"></i><span>${msg}</span>`;
  c.appendChild(t);
  setTimeout(() => t.remove(), duration);
}

function showModal(title, bodyHTML) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = bodyHTML;
  $('#modal-overlay').classList.remove('hidden');
}

function hideModal() {
  if (storyComposerAudio) { storyComposerAudio.pause(); storyComposerAudio.src = ''; storyComposerAudio = null; }
  if (activeStoryAudio) { activeStoryAudio.pause(); activeStoryAudio.src = ''; activeStoryAudio = null; }
  window.__realsResumeVideo?.();
  window.__realsResumeVideo = null;
  $('#modal-overlay').classList.add('hidden');
  $('#modal-overlay').classList.remove('story-fullscreen-overlay');
}

function openAvatarCrop(file, onApply) {
  if (!file || !file.type.startsWith('image/')) return;
  const url = URL.createObjectURL(file);
  showModal('Profil Fotoğrafını Kırp', `<div class="avatar-cropper">
    <div class="avatar-crop-stage"><canvas id="avatar-crop-canvas" width="420" height="420"></canvas><div class="avatar-crop-mask"></div></div>
    <div class="avatar-crop-tools"><i class="fas fa-camera"></i><input id="avatar-crop-zoom" type="range" min="1" max="3" step="0.01" value="1" /></div>
    <div class="avatar-crop-actions"><button class="btn btn-outline" id="avatar-crop-cancel">Vazgeç</button><button class="btn btn-primary" id="avatar-crop-apply"><i class="fas fa-check"></i> Uygula</button></div>
  </div>`);
  const canvas = $('#avatar-crop-canvas');
  const context = canvas.getContext('2d');
  const image = new Image();
  let scale = 1, offsetX = 0, offsetY = 0, dragging = false, startX = 0, startY = 0;
  const draw = () => {
    if (!image.naturalWidth) return;
    const base = Math.max(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
    const width = image.naturalWidth * base * scale;
    const height = image.naturalHeight * base * scale;
    const x = (canvas.width - width) / 2 + offsetX;
    const y = (canvas.height - height) / 2 + offsetY;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, x, y, width, height);
  };
  image.onload = draw;
  image.src = url;
  $('#avatar-crop-zoom').addEventListener('input', e => { scale = Number(e.target.value); draw(); });
  canvas.addEventListener('pointerdown', e => { dragging = true; startX = e.clientX - offsetX; startY = e.clientY - offsetY; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', e => { if (!dragging) return; offsetX = e.clientX - startX; offsetY = e.clientY - startY; draw(); });
  canvas.addEventListener('pointerup', () => { dragging = false; });
  $('#avatar-crop-cancel').addEventListener('click', () => { URL.revokeObjectURL(url); hideModal(); });
  $('#avatar-crop-apply').addEventListener('click', () => canvas.toBlob(blob => {
    URL.revokeObjectURL(url);
    hideModal();
    onApply(new File([blob], 'profil-fotografi.jpg', { type: 'image/jpeg' }));
  }, 'image/jpeg', 0.92));
}

$('#modal-close').addEventListener('click', hideModal);
$('#modal-overlay').addEventListener('click', e => { if (e.target === $('#modal-overlay')) hideModal(); });

async function api(path, options = {}) {
  const headers = { ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...(options.headers || {}) };
  if (currentToken) headers['Authorization'] = 'Bearer ' + currentToken;
  const res = await fetch('/api' + path, { ...options, headers });
  const data = await res.json();
  if (!res.ok) { const error = new Error(data.error || 'Hata'); error.data = data; throw error; }
  return data;
}

function callAvatar(user, size = 'call-avatar') {
  return hasUsableAvatar(user) ? `<img src="${escHtml(user.avatar)}" class="${size}" alt="" />` : `<div class="${size} call-avatar-placeholder"><i class="fas fa-user"></i></div>`;
}

function stopVoiceCallAudio() {
  if (activeVoiceCall?.ringtone) { activeVoiceCall.ringtone.pause(); activeVoiceCall.ringtone.currentTime = 0; }
}
function isVoiceCallMuted() { return Number(localStorage.getItem('cigcig_call_mute_until') || 0) > Date.now(); }
function setVoiceCallMute(hours) { localStorage.setItem('cigcig_call_mute_until', hours ? String(Date.now() + hours * 3600000) : '0'); }

function closeVoiceCallPanel() {
  stopVoiceCallAudio();
  document.getElementById('voice-call-layer')?.remove();
}

function renderVoiceCallPanel(call, mode, other) {
  closeVoiceCallPanel();
  const layer = document.createElement('div');
  layer.id = 'voice-call-layer';
  layer.innerHTML = `<section class="voice-call-card ${mode === 'mini' ? 'voice-call-mini' : ''}">
    <button class="voice-call-close" id="voice-call-close" title="Küçült"><i class="fas fa-times"></i></button>
    <div class="voice-call-kicker"><span class="voice-call-live-dot"></span> CIGCIG SESLİ ARAMA</div>
    <div class="voice-call-avatars">${callAvatar(mode === 'incoming' ? other : currentUser)}<span class="voice-call-wave"><i></i><i></i><i></i><i></i></span>${callAvatar(mode === 'incoming' ? currentUser : other)}</div>
    <div class="voice-call-names"><strong>${escHtml(mode === 'incoming' ? other.username : currentUser.username)}</strong><span>${mode === 'incoming' ? 'seni arıyor' : 'aranıyor'}</span><strong>${escHtml(mode === 'incoming' ? currentUser.username : other.username)}</strong></div>
    <div class="voice-call-dots"><i></i><i></i><i></i></div>
    <div class="voice-call-status" id="voice-call-status">${mode === 'incoming' ? 'Gelen arama' : 'Bağlantı kuruluyor'}</div>
    <div class="voice-call-quality" id="voice-call-quality"><span></span><span></span><span></span><em>Bekleniyor</em></div>
    ${mode === 'incoming' ? '<div class="voice-call-actions"><button class="call-action call-decline" id="voice-call-decline"><i class="fas fa-phone-slash"></i></button><button class="call-action call-accept" id="voice-call-accept"><i class="fas fa-phone"></i></button></div>' : '<button class="call-action call-decline" id="voice-call-end"><i class="fas fa-phone-slash"></i></button>'}
    ${mode === 'connected' ? '<button class="call-mic" id="voice-call-mic"><i class="fas fa-microphone"></i> Mikrofon açık</button>' : ''}
  </section>`;
  document.body.appendChild(layer);
  layer.querySelector('#voice-call-close').onclick = event => { event.stopPropagation(); layer.querySelector('.voice-call-card').classList.add('voice-call-mini'); stopVoiceCallAudio(); };
  layer.querySelector('.voice-call-card').addEventListener('click', event => {
    if (!event.target.closest('#voice-call-close') && layer.querySelector('.voice-call-card').classList.contains('voice-call-mini')) {
      layer.querySelector('.voice-call-card').classList.remove('voice-call-mini');
      activeVoiceCall?.ringtone?.play().catch(() => {});
    }
  });
  layer.querySelector('#voice-call-end, #voice-call-decline')?.addEventListener('click', () => endVoiceCall());
  layer.querySelector('#voice-call-accept')?.addEventListener('click', () => acceptVoiceCall(call, other));
  layer.querySelector('#voice-call-mic')?.addEventListener('click', () => {
    const track = activeVoiceCall?.stream?.getAudioTracks()[0]; if (!track) return;
    track.enabled = !track.enabled; layer.querySelector('#voice-call-mic').innerHTML = `<i class="fas fa-microphone${track.enabled ? '' : '-slash'}"></i> Mikrofon ${track.enabled ? 'açık' : 'kapalı'}`;
  });
  layer.querySelector('#voice-call-permission-retry')?.addEventListener('click', () => acceptVoiceCall(call, other));
}

function showVoicePermissionRetry(call, other) {
  const status = document.querySelector('#voice-call-status');
  if (status) status.textContent = 'Mikrofon izni verilmedi. Tarayıcı ayarlarından izin verin.';
  document.querySelector('#voice-call-quality')?.classList.add('call-permission-error');
  const card = document.querySelector('.voice-call-card');
  if (card && !document.querySelector('#voice-call-permission-retry')) {
    const button = document.createElement('button');
    button.id = 'voice-call-permission-retry'; button.className = 'call-mic';
    button.innerHTML = '<i class="fas fa-microphone"></i> Mikrofon iznini yeniden dene';
    button.addEventListener('click', () => activeVoiceCall?.role === 'callee'
      ? acceptVoiceCall(call, other)
      : endVoiceCall(true).then(() => requestMicrophoneThenCall(other.username, other)));
    card.appendChild(button);
  }
}

async function requestMicrophoneThenCall(username, other) {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    showModal('Mikrofon erişimi kullanılamıyor', `<div class="call-permission-guide"><div class="call-permission-guide-icon"><i class="fas fa-lock"></i></div><p>Mikrofon izni yalnızca güvenli bağlantıda çalışır.</p><ol><li>CigCig’i <strong>HTTPS</strong> veya <strong>localhost</strong> üzerinden açın.</li><li>Adres çubuğundaki kilitten Mikrofon için <strong>İzin ver</strong> seçin.</li><li>Sayfayı yenileyip tekrar deneyin.</li></ol></div>`);
    return;
  }
  const startAfterPermission = async () => {
    let permissionState = 'unknown';
    try { permissionState = (await navigator.permissions.query({ name: 'microphone' })).state; } catch {}
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      await startVoiceCall(username, other, stream);
    } catch (error) {
      const reason = error.name === 'NotAllowedError' || permissionState === 'denied'
        ? 'Tarayıcı mikrofon iznini engelliyor. Kilit simgesinden Mikrofon ayarını İzin ver yapın.'
        : error.name === 'NotReadableError'
          ? 'Mikrofon başka bir uygulama tarafından kullanılıyor. Diğer uygulamayı kapatıp tekrar deneyin.'
          : `Mikrofon başlatılamadı (${error.name || 'bilinmeyen hata'}).`;
      if (error.name === 'NotAllowedError' || permissionState === 'denied') showMicrophonePermissionGuide(username, other, reason);
      toast(reason, 'error');
    }
  };
  if (localStorage.getItem('cigcig_microphone_consent') !== '1') {
    showModal('Mikrofon izni', `<div class="call-permission-guide"><div class="call-permission-guide-icon"><i class="fas fa-microphone"></i></div><p>Sesli arama için mikrofon izni verilsin mi?</p><div style="display:flex;gap:8px"><button class="btn btn-outline" id="microphone-consent-no" style="flex:1">Hayır</button><button class="btn btn-primary" id="microphone-consent-yes" style="flex:1"><i class="fas fa-check"></i> Evet, izin ver</button></div></div>`);
    document.getElementById('microphone-consent-no')?.addEventListener('click', hideModal);
    document.getElementById('microphone-consent-yes')?.addEventListener('click', async event => {
      event.currentTarget.disabled = true;
      localStorage.setItem('cigcig_microphone_consent', '1');
      hideModal();
      await startAfterPermission();
    });
    return;
  }
  await startAfterPermission();
}

function showMicrophonePermissionGuide(username, other, message = 'Arama yapabilmek için mikrofon izni gerekiyor.') {
  showModal('Mikrofon izni gerekli', `<div class="call-permission-guide">
    <div class="call-permission-guide-icon"><i class="fas fa-microphone-slash"></i></div>
    <p>${escHtml(message)}</p>
    <ol><li>Adres çubuğunun solundaki kilit simgesine basın.</li><li><strong>Mikrofon</strong> ayarını <strong>İzin ver</strong> yapın.</li><li>Sayfayı yenileyip tekrar deneyin.</li></ol>
    <button class="btn btn-primary" id="call-permission-retry" style="width:100%"><i class="fas fa-microphone"></i> İzni tekrar dene</button>
  </div>`);
  document.getElementById('call-permission-retry')?.addEventListener('click', async () => {
    const button = document.getElementById('call-permission-retry');
    if (button) { button.disabled = true; button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Kontrol ediliyor'; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      hideModal(); await startVoiceCall(username, other, stream);
    } catch (error) {
      if (button) { button.disabled = false; button.innerHTML = '<i class="fas fa-microphone"></i> İzni tekrar dene'; }
      toast('Tarayıcı ayarlarından mikrofon iznini İzin ver yapın', 'error');
    }
  });
}

async function startVoiceCall(username, other, microphoneStream = null) {
  try {
    const call = await api('/voice-calls', { method: 'POST', body: JSON.stringify({ username }) });
    activeVoiceCall = { id: call.id, role: 'caller', other, seenIce: 0 };
    renderVoiceCallPanel(call, 'outgoing', other);
    activeVoiceCall.ringtone = new Audio();
    await loadCallRingtone(activeVoiceCall.ringtone);
    activeVoiceCall.ringtone.loop = true; activeVoiceCall.ringtone.play().catch(() => {});
    try {
      activeVoiceCall.stream = microphoneStream || await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      showVoicePermissionRetry(call, other);
      toast('Mikrofon izni olmadan sesli arama başlatılamaz', 'error');
      return;
    }
    activeVoiceCall.peer = new RTCPeerConnection();
    activeVoiceCall.stream.getTracks().forEach(track => activeVoiceCall.peer.addTrack(track, activeVoiceCall.stream));
    activeVoiceCall.peer.onicecandidate = e => e.candidate && api(`/voice-calls/${call.id}/action`, { method: 'POST', body: JSON.stringify({ action: 'ice', value: e.candidate }) });
    activeVoiceCall.peer.ontrack = e => { const audio = document.createElement('audio'); audio.autoplay = true; audio.srcObject = e.streams[0]; document.body.appendChild(audio); activeVoiceCall.remoteAudio = audio; };
    activeVoiceCall.peer.onconnectionstatechange = () => { if (['connected', 'completed'].includes(activeVoiceCall.peer.connectionState)) { document.querySelector('#voice-call-status').textContent = 'Bağlantı kuruldu'; } };
    const offer = await activeVoiceCall.peer.createOffer(); await activeVoiceCall.peer.setLocalDescription(offer);
    await api(`/voice-calls/${call.id}/action`, { method: 'POST', body: JSON.stringify({ action: 'offer', value: offer }) });
    voiceCallPoll = setInterval(() => pollVoiceCall(call.id), 1200);
  } catch (error) { microphoneStream?.getTracks().forEach(track => track.stop()); toast(error.message || 'Arama başlatılamadı', 'error'); endVoiceCall(true); }
}

async function pollVoiceCall(id) {
  if (!activeVoiceCall) return;
  try {
    const call = await api('/voice-calls/' + id);
    if (call.status === 'ended') return endVoiceCall(true);
    if (activeVoiceCall.role === 'caller' && call.answer && activeVoiceCall.peer.signalingState === 'have-local-offer') await activeVoiceCall.peer.setRemoteDescription(call.answer);
    const ice = activeVoiceCall.role === 'caller' ? (call.callee_ice || []) : (call.caller_ice || []);
    while (activeVoiceCall.seenIce < ice.length) await activeVoiceCall.peer.addIceCandidate(ice[activeVoiceCall.seenIce++]);
    if (call.status === 'connected') { stopVoiceCallAudio(); document.querySelector('#voice-call-status').textContent = 'Bağlantı kuruldu'; document.querySelector('#voice-call-quality em').textContent = 'İyi'; document.querySelector('#voice-call-quality').classList.add('good'); }
    if (activeVoiceCall.role === 'caller' && call.status === 'accepted') await api(`/voice-calls/${id}/action`, { method: 'POST', body: JSON.stringify({ action: 'connect' }) });
  } catch {}
}

async function acceptVoiceCall(call, other) {
  stopVoiceCallAudio();
  try {
    activeVoiceCall = { id: call.id, role: 'callee', other, seenIce: 0 };
    renderVoiceCallPanel(call, 'connected', other);
    try {
      activeVoiceCall.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      showVoicePermissionRetry(call, other);
      toast('Mikrofon izni olmadan sesli arama başlatılamaz', 'error');
      return;
    }
    await api(`/voice-calls/${call.id}/action`, { method: 'POST', body: JSON.stringify({ action: 'accept' }) });
    activeVoiceCall.peer = new RTCPeerConnection(); activeVoiceCall.stream.getTracks().forEach(track => activeVoiceCall.peer.addTrack(track, activeVoiceCall.stream));
    activeVoiceCall.peer.onicecandidate = e => e.candidate && api(`/voice-calls/${call.id}/action`, { method: 'POST', body: JSON.stringify({ action: 'ice', value: e.candidate }) });
    activeVoiceCall.peer.ontrack = e => { const audio = document.createElement('audio'); audio.autoplay = true; audio.srcObject = e.streams[0]; document.body.appendChild(audio); activeVoiceCall.remoteAudio = audio; };
    activeVoiceCall.peer.onconnectionstatechange = () => { if (['connected', 'completed'].includes(activeVoiceCall.peer.connectionState)) document.querySelector('#voice-call-status').textContent = 'Bağlantı kuruldu'; };
    const fresh = await api('/voice-calls/' + call.id); await activeVoiceCall.peer.setRemoteDescription(fresh.offer);
    const answer = await activeVoiceCall.peer.createAnswer(); await activeVoiceCall.peer.setLocalDescription(answer);
    await api(`/voice-calls/${call.id}/action`, { method: 'POST', body: JSON.stringify({ action: 'answer', value: answer }) });
    voiceCallPoll = setInterval(() => pollVoiceCall(call.id), 1200);
  } catch (error) { toast(error.message || 'Arama açılamadı', 'error'); endVoiceCall(); }
}

async function endVoiceCall(silent = false) {
  if (voiceCallPoll) { clearInterval(voiceCallPoll); voiceCallPoll = null; }
  if (activeVoiceCall) { try { await api(`/voice-calls/${activeVoiceCall.id}/action`, { method: 'POST', body: JSON.stringify({ action: 'end' }) }); } catch {} activeVoiceCall.stream?.getTracks().forEach(track => track.stop()); activeVoiceCall.peer?.close(); activeVoiceCall.remoteAudio?.remove(); }
  activeVoiceCall = null; closeVoiceCallPanel(); if (!silent) toast('Arama sonlandırıldı');
}

async function loadCallRingtone(audio) { try { const s = await fetch('/api/settings/public').then(r => r.json()); if (s.call_ringtone_url) audio.src = s.call_ringtone_url; } catch {} }

async function pollIncomingVoiceCall() {
  if (!currentUser || isVoiceCallMuted() || activeVoiceCall || document.getElementById('voice-call-layer')) return;
  try { const call = await api('/voice-calls/incoming'); if (!call) return; const other = { username: call.username, avatar: call.avatar, avatar_removed: call.avatar_removed, name_color: call.name_color }; renderVoiceCallPanel(call, 'incoming', other); const ringtone = new Audio(); await loadCallRingtone(ringtone); ringtone.loop = true; ringtone.play().catch(() => {}); activeVoiceCall = { id: call.id, role: 'callee', other, ringtone }; } catch {}
}

async function apiForm(path, formData, method = 'POST') {
  const headers = {};
  if (currentToken) headers['Authorization'] = 'Bearer ' + currentToken;
  const res = await fetch('/api' + path, { method, body: formData, headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Hata');
  return data;
}

function apiFormWithTimeout(path, formData, timeout = 120000) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api' + path);
    if (currentToken) xhr.setRequestHeader('Authorization', 'Bearer ' + currentToken);
    xhr.timeout = timeout;
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText || '{}'); } catch { reject(new Error('Sunucudan geçersiz yanıt geldi.')); return; }
      if (xhr.status < 200 || xhr.status >= 300) { reject(new Error(data.error || 'Hikaye yüklenemedi.')); return; }
      resolve(data);
    };
    xhr.onerror = () => reject(new Error('Yükleme sırasında bağlantı hatası oluştu.'));
    xhr.ontimeout = () => reject(new Error('Yükleme zaman aşımına uğradı. Dosya boyutunu küçültüp tekrar deneyin.'));
    xhr.send(formData);
  });
}

function timeAgo(dt) {
  const now = new Date();
  const d = new Date(dt);
  if (Number.isNaN(d.getTime())) return '';
  const isToday = now.getFullYear() === d.getFullYear()
    && now.getMonth() === d.getMonth()
    && now.getDate() === d.getDate();
  if (isToday) return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', hour12: false });
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatDate(dt) {
  return new Date(dt).toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric' });
}

function escHtml(s) {
  if (!s) return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function normalizeExternalUrl(value) {
  const url = String(value || '').trim();
  if (!url || url === '#') return '#';
  if (/^https?:\/\//i.test(url)) return url;
  if (/^\/\//.test(url)) return 'https:' + url;
  return 'https://' + url;
}

function profileRoute(username) {
  const routeKey = String(username || '').toLocaleLowerCase('tr-TR')
    .replace(/[çğıöşüÇĞİÖŞÜ]/g, char => ({ ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', Ç: 'c', Ğ: 'g', İ: 'i', Ö: 'o', Ş: 's', Ü: 'u' }[char] || char))
    .replace(/[^a-z0-9]/g, '');
  return '/profil/' + encodeURIComponent(routeKey);
}

function closeMobileMenu() {
  $('#mobile-menu')?.classList.add('hidden');
}

function userDisplayName(u) {
  if (!u) return 'Silindi';
  const color = (u.is_vip || u.is_plus) && u.show_level_color !== 0 && u.name_color ? `style="color:${escHtml(u.name_color)}"` : '';
  const adminBadge = u.is_admin ? ` <i class="fas fa-shield user-admin" title="CigCig Yetkilisi" data-admin-since="${escHtml(u.admin_since || '')}" style="color:#5865F2;cursor:pointer;font-size:13px"></i>` : '';
  const customBadge = u.badge_name ? ` <span class="badge" style="background:${escHtml(u.badge_color||'#6b7280')};padding:3px 8px;border-radius:4px;margin-left:6px">${u.badge_icon ? `<i class="${escHtml(u.badge_icon)}" style="margin-right:6px"></i>` : ''}${escHtml(u.badge_name)}</span>` : '';
  return `<span class="user-badge" ${color}>${escHtml(u.username)}${u.is_vip ? ' <i class="fas fa-gem user-vip" title="VIP"></i>' : ''}${u.is_plus ? ' <i class="fas fa-plus user-plus" title="Plus"></i>' : ''}${adminBadge}${customBadge}</span>`;
}

function avatarImg(u, cls = 'avatar-sm') {
  if (u && u.avatar && !u.avatar_removed) return `<img src="${escHtml(u.avatar)}" class="${cls}" alt="" />`;
  return `<div class="${cls} avatar-placeholder" aria-label="Profil fotoğrafı yok"><i class="fas fa-user"></i></div>`;
}

function hasUsableAvatar(u) {
  return Boolean(u && u.avatar && !u.avatar_removed && u.avatar !== '?' && u.avatar !== 'null' && u.avatar !== 'undefined');
}

function updateAppIcon(user) {
  const favicon = document.querySelector('link[rel="icon"]');
  if (favicon) favicon.href = '/cigcig.png';
  const appleIcon = document.querySelector('link[rel="apple-touch-icon"]');
  if (appleIcon) appleIcon.href = '/cigcig.png';
}

// ===== IÇERIK RENDER (hashtag + mention) =====
function renderContent(text) {
  if (!text) return '';
  // XSS güvenli: önce escape, sonra pattern'lere dönüştür
  let safe = String(text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const links = [];
  safe = safe.replace(/(?:https?:\/\/|www\.)[^\s<]+/gi, match => {
    const trailing = match.match(/[.,!?;:)]+$/)?.[0] || '';
    const url = trailing ? match.slice(0, -trailing.length) : match;
    const placeholder = `__CIGCIG_LINK_${links.length}__`;
    const href = normalizeExternalUrl(url);
    links.push({ placeholder, url, href, isImage: /\.(?:png|jpe?g|gif|webp|avif|bmp)(?:[?#].*)?$/i.test(url) });
    return placeholder + trailing;
  });
  safe = safe
    // #hashtag → mavi tıklanabilir link
    .replace(/#([a-zA-Z0-9_çğıöşüÇĞİÖŞÜ]+)/g, (_, tag) =>
      `<a href="/forum?tag=${encodeURIComponent(tag)}" data-link class="inline-hashtag">#${tag}</a>`)
    // @mention → profil link
    .replace(/@([a-zA-Z0-9_çğıöşüÇĞİÖŞÜ]+)/g, (_, user) =>
      `<a href="${profileRoute(user)}" data-link class="inline-mention">@${user}</a>`);
  links.forEach(({ placeholder, url, href, isImage }) => {
    safe = safe.replaceAll(placeholder, isImage
      ? `<a href="${href}" target="_blank" rel="noopener noreferrer" class="inline-image-link"><img src="${href}" alt="Paylaşılan görsel" loading="lazy" /></a>`
      : `<a href="${href}" target="_blank" rel="noopener noreferrer" class="inline-link" data-preview-url="${href}">${url}</a>`);
  });
  return safe;
}

async function enhanceLinkPreviews(root = document) {
  const links = [...root.querySelectorAll?.('[data-preview-url]:not([data-preview-bound])') || []];
  links.forEach(link => link.dataset.previewBound = '1');
  await Promise.all(links.map(async link => {
    try {
      const preview = await api('/link-preview?url=' + encodeURIComponent(link.dataset.previewUrl));
      if (!preview.title && !preview.image) return;
      if (preview.is_image) {
        const imageLink = document.createElement('a');
        imageLink.className = 'inline-image-link'; imageLink.href = preview.url || link.href; imageLink.target = '_blank'; imageLink.rel = 'noopener noreferrer';
        imageLink.innerHTML = `<img src="${escHtml(preview.image)}" alt="Paylaşılan görsel" loading="lazy" />`;
        link.replaceWith(imageLink);
        return;
      }
      const card = document.createElement('a');
      card.className = 'link-preview-card'; card.href = preview.url || link.href; card.target = '_blank'; card.rel = 'noopener noreferrer';
      card.innerHTML = `${preview.image ? `<img src="${escHtml(preview.image)}" alt="" loading="lazy" />` : '<span class="link-preview-icon"><i class="fas fa-globe"></i></span>'}<span class="link-preview-copy"><strong>${escHtml(preview.title || preview.site || 'Bağlantı')}</strong>${preview.description ? `<small>${escHtml(preview.description)}</small>` : ''}<em>${escHtml(preview.site || '')}</em></span>`;
      link.replaceWith(card);
    } catch {}
  }));
}

function navigate(path, push = true) {
  closeMobileMenu();
  $('#mobile-new-dropdown')?.classList.add('hidden');
  $('#new-dropdown')?.classList.add('hidden');
  if (push) history.pushState({}, '', path);
  // path içindeki query string'i renderRoute'a geçir
  renderRoute(path);
}

window.addEventListener('popstate', () => renderRoute(location.pathname + location.search));

document.addEventListener('click', e => {
  const a = e.target.closest('[data-link]');
  if (a && a.tagName === 'A') {
    e.preventDefault();
    navigate(a.getAttribute('href'));
  }
});

function renderRoute(fullPath) {
  // Sayfa değişiminde fotoğraf ses kontrolünü kaldır
  document.getElementById('photo-audio-control')?.remove();
  photoAudioObserver?.disconnect();
  activePhotoAudio?.pause();
  activePhotoAudio = null;
  photoAudioObserver = null;
  if (activeStoryAudio) { activeStoryAudio.pause(); activeStoryAudio.src = ''; activeStoryAudio = null; }

  // Query string'i ayır
  const [path, queryStr] = fullPath.split('?');
  updateNavActive(path);
  // Mesajlar sayfasında footer gizle
  const siteFooter = document.getElementById('site-footer');
  if (siteFooter) {
    siteFooter.style.display = (path === '/mesajlar' || path.startsWith('/mesajlar/') || path === '/reals') ? 'none' : '';
  }
  const app = $('#app');
  const segs = path.split('/').filter(Boolean);

  if (path === '/') {
    if (firstVisitAuthEnabled && !currentUser && !localStorage.getItem('cigcig_first_visit_auth_seen')) {
      localStorage.setItem('cigcig_first_visit_auth_seen', '1');
      return navigate('/giris', false);
    }
    return renderHome(app);
  }
  if (path === '/forum' || path === '/konular') {
    // query string'i de geçir
    const qs = queryStr ? '?' + queryStr : '';
    return renderForumList(app, qs);
  }
  if (path.startsWith('/forum/')) {
    const slug = segs.slice(1).join('/');
    return renderForumDetail(app, slug);
  }
  if (path === '/kitaplar') return renderBookList(app);
  if (path.startsWith('/kitap/') && segs.length === 2) return renderBookDetail(app, segs[1]);
  if (path.startsWith('/kitap/') && segs.length === 4 && segs[2] === 'sayfa') return renderPageReader(app, segs[1], segs[3]);
  if (path === '/gruplar') return renderGroupList(app);
  if (path === '/fotograflar') return renderPhotos(app);
  if (path.startsWith('/hikaye/')) {
    if (!currentUser) return navigate('/giris', false);
    return renderStoryRoute(app, segs[1]);
  }
  if (path.startsWith('/grup/')) return renderGroupDetail(app, segs[1]);
  if (path === '/videolar') return renderVideoList(app);
  if (path.startsWith('/video/')) return renderVideoDetail(app, segs[1]);
  if (path === '/reals') return renderRealsFeed(app);
  if (path.startsWith('/reals/')) return renderVideoDetail(app, segs[1]);
  if (path.startsWith('/foto/')) return renderPhotoDetail(app, segs[1]);
  if (path.startsWith('/profil/')) return renderProfile(app, segs[1]);
  if (path === '/ayarlar') return renderSettings(app);
  if (path === '/giris') return renderLogin(app);
  if (path === '/kayit') return renderRegister(app);
  if (path === '/mesajlar') return renderMessages(app, null);
  if (path.startsWith('/mesajlar/')) return renderMessages(app, segs[1]);
  if (path === '/arkadaslar') return renderFriends(app);
  if (path === '/bildirimler') return renderNotifications(app);
  if (path === '/muzikler') return renderMusicList(app);
  if (path.startsWith('/muzik/')) return renderMusicDetail(app, segs[1]);
  if (path === '/reklampanel') return renderAdPortal(app);
  if (path === '/artist-basvuru') return renderArtistApply(app);
  if (path === '/artist-panel') return renderArtistPanel(app);
  if (path === '/sarki-yukle') return renderShareSong(app);
  if (path === '/playlistlerim') return renderMyPlaylists(app);
  if (path.startsWith('/playlist/')) return renderPlaylistDetail(app, segs[1]);
    if (path === '/magaza') return renderStore(app);
  if (path === '/siparislerim') return renderMyOrders(app);
  renderNotFound(app);
}

function updateNavActive(path) {
  $$('.nav-link').forEach(l => {
    l.classList.toggle('active', l.getAttribute('href') === path || (l.getAttribute('href') !== '/' && path.startsWith(l.getAttribute('href'))));
  });
  updateMobileBottomBar(path);
}

// Reals feed basic viewer
function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function generateVideoPoster(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.src = objectUrl;
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;

    const cleanup = () => URL.revokeObjectURL(objectUrl);
    video.addEventListener('loadeddata', () => {
      video.currentTime = 0;
    }, { once: true });
    video.addEventListener('seeked', () => {
      const canvas = document.createElement('canvas');
      canvas.width = 720;
      canvas.height = 1280;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(blob => {
        cleanup();
        if (!blob) return reject(new Error('Poster oluşturulamadı'));
        resolve(new File([blob], 'poster.png', { type: 'image/png' }));
      }, 'image/png');
    }, { once: true });
    video.addEventListener('error', () => { cleanup(); reject(new Error('Video önizlemesi oluşturulamadı')); }, { once: true });
  });
}

async function renderRealsFeed(app) {
  document.title = 'Reals – ' + siteName;
  updatePageMeta('Reals – ' + siteName, 'Kısa dikey videolar', '');
  app.innerHTML = `
    <div class="reals-container">
      <button type="button" class="reals-info-btn" id="reals-info-btn" title="Reals hakkında" aria-label="Reals hakkında">?</button>
      <div id="reals-list" class="reals-list"></div>
    </div>`;

  if (!localStorage.getItem('cigcig_reals_intro_seen')) {
    document.getElementById('reals-intro-ok')?.addEventListener('click', () => { localStorage.setItem('cigcig_reals_intro_seen', '1'); hideModal(); });
  }

  // fetch reals
  let reals = [];
  try { reals = await api('/reals'); } catch (e) { document.getElementById('reals-list').innerHTML = '<div style="padding:24px;color:var(--red2)">'+escHtml(e.message)+'</div>'; return; }
  const listEl = document.getElementById('reals-list');
  if (!reals.length) { listEl.innerHTML = '<div class="empty-state"><i class="fas fa-video"></i><p>Reals bulunamadı.</p></div>'; return; }

  const orderedReals = shuffleArray(reals);
  listEl.addEventListener('selectstart', event => event.preventDefault());
  let realsMuted = localStorage.getItem('cigcig_reals_muted') !== '0';
  const followStates = new Map();
  if (currentUser) await Promise.all(orderedReals.map(async real => {
    if (!real.username || real.username === currentUser.username) return;
    try { followStates.set(real.username, await api('/users/' + encodeURIComponent(real.username) + '/follow-status')); } catch {}
  }));

  document.getElementById('reals-info-btn')?.addEventListener('click', async () => {
    try { const data = await fetch('/api/reals-settings').then(response => response.json()); showModal('Reals hakkında', `<div class="reals-info-modal"><i class="fas fa-circle-play"></i><p>${escHtml(data.reminder || '')}</p></div>`); } catch {}
  });

  let watchedIds = new Set();
  let idx = 0;
  let items = [];
  async function openRealsComments(video) {
    const activeVideo = items[idx]?.querySelector('video');
    const wasPlaying = activeVideo && !activeVideo.paused;
    const previousScrollTop = listEl.scrollTop;
    if (activeVideo) activeVideo.pause();
    const oldSheet = document.getElementById('reals-comments-sheet');
    oldSheet?.remove();
    const sheet = document.createElement('div');
    sheet.id = 'reals-comments-sheet';
    sheet.className = 'reals-comments-sheet';
    sheet.innerHTML = `<div class="reals-comments-backdrop"></div><section class="reals-comments-panel" role="dialog" aria-modal="true" aria-label="Yorumlar">
      <header class="reals-comments-header"><strong>Yorumlar</strong><button type="button" class="reals-comments-close" aria-label="Yorumları kapat"><i class="fas fa-times"></i></button></header>
      <div class="reals-comments-list"><div class="loading-center"><div class="spinner"></div></div></div>
      ${currentUser ? '<form class="reals-comment-form"><input type="text" maxlength="2000" placeholder="Yorum yaz..." autocomplete="off" /><button type="submit" aria-label="Yorumu gönder"><i class="fas fa-paper-plane"></i></button></form>' : '<div class="reals-comment-login">Yorum yapmak için giriş yapın.</div>'}
    </section>`;
    document.body.appendChild(sheet);
    const close = () => {
      sheet.remove();
      listEl.scrollTop = previousScrollTop;
      requestAnimationFrame(() => { listEl.scrollTop = previousScrollTop; });
      if (wasPlaying && location.pathname === '/reals') activeVideo?.play().catch(() => {});
    };
    sheet.querySelector('.reals-comments-close')?.addEventListener('click', close);
    sheet.querySelector('.reals-comments-backdrop')?.addEventListener('click', close);
    try {
      const comments = await api('/video/' + encodeURIComponent(video.id) + '/comments');
      const list = sheet.querySelector('.reals-comments-list');
      if (!list || !document.body.contains(sheet)) return;
      list.innerHTML = comments.length ? comments.map(comment => renderVideoComment(comment, currentUser?.id === video.user_id)).join('') : '<div class="reals-comments-empty"><i class="far fa-comment-dots"></i><p>Henüz yorum yok.</p><span>İlk yorumu sen yaz.</span></div>';
      list.addEventListener('click', async event => {
        const likeButton = event.target.closest('.video-comment-like');
        const deleteButton = event.target.closest('.video-comment-delete');
        if (deleteButton) {
          if (!confirm('Bu yorum silinsin mi?')) return;
          try { await api('/video/' + encodeURIComponent(video.id) + '/comments/' + deleteButton.dataset.id, { method: 'DELETE' }); deleteButton.closest('.comment')?.remove(); } catch (error) { toast(error.message, 'error'); }
          return;
        }
        if (!likeButton) return;
        try {
          likeButton.disabled = true;
          const result = await api('/video/' + encodeURIComponent(video.id) + '/comments/' + likeButton.dataset.id + '/like', { method: 'POST' });
          const count = likeButton.querySelector('.video-comment-count');
          count.textContent = Math.max(0, (parseInt(count.textContent) || 0) + (result.liked ? 1 : -1));
          likeButton.classList.toggle('liked', result.liked);
        } catch (error) { toast(error.message, 'error'); } finally { likeButton.disabled = false; }
      });
    } catch (error) {
      sheet.querySelector('.reals-comments-list').innerHTML = `<div class="reals-comments-empty"><i class="fas fa-exclamation-circle"></i><p>${escHtml(error.message)}</p></div>`;
    }
    sheet.querySelector('.reals-comment-form')?.addEventListener('submit', async event => {
      event.preventDefault();
      const input = event.currentTarget.querySelector('input');
      const content = input.value.trim();
      if (!content) return;
      const button = event.currentTarget.querySelector('button');
      button.disabled = true;
      try {
        const comment = await api('/video/' + encodeURIComponent(video.id) + '/comments', { method: 'POST', body: JSON.stringify({ content }) });
        const list = sheet.querySelector('.reals-comments-list');
        list.querySelector('.reals-comments-empty')?.remove();
        list.insertAdjacentHTML('beforeend', renderVideoComment(comment, currentUser?.id === video.user_id));
        input.value = '';
        list.scrollTop = list.scrollHeight;
      } catch (error) { toast(error.message, 'error'); } finally { button.disabled = false; }
    });
  }
  function setRealsVideoSource(videoEl, src) {
    if (!src) {
      videoEl.removeAttribute('src');
      videoEl.load();
      return;
    }
    if (videoEl.getAttribute('src') === src) return;
    videoEl.setAttribute('src', src);
    videoEl.load();
  }

  function renderItems() {
    listEl.innerHTML = orderedReals.map(r => `
      <div class="reals-item" data-id="${r.id}" data-slug="${escHtml(r.slug)}" data-video-url="${escHtml(r.video_url)}">
        <div class="reals-video-box">
        <video class="reals-video" preload="metadata" playsinline muted poster="${escHtml(r.banner_image || '')}"></video>
        <button type="button" class="reals-play-overlay" aria-label="Videoyu durdur veya başlat"><span><i class="fas fa-pause"></i></span></button>
        <div class="reals-top-controls"><button class="reals-icon-btn mute-btn" title="Sesi aç/kapat"><i class="fas fa-volume-${realsMuted ? 'mute' : 'up'}"></i></button></div>
        <button class="reals-icon-btn reals-close-btn" title="Reals'tan çık"><i class="fas fa-times"></i></button>
        <div class="reals-meta">
          <div class="reals-user-row"><a href="${profileRoute(r.username)}" data-link class="reals-user">${avatarImg(r)} ${userDisplayName(r)}</a>${currentUser && r.username !== currentUser.username ? `<button type="button" class="reals-follow-btn" data-username="${escHtml(r.username)}">${r.is_private ? (followStates.get(r.username)?.friend_status === 'pending' ? 'Arkadaşlık isteği gönderildi' : followStates.get(r.username)?.friend_status === 'accepted' ? 'Arkadaşsınız' : 'Arkadaş isteği gönder') : (followStates.get(r.username)?.following ? 'Takiptesin' : followStates.get(r.username)?.pending ? 'İstek gönderildi' : 'Takip et')}</button>` : ''}</div>
          <div class="reals-title">${escHtml(r.title || '')}</div>
          ${r.sound_name ? `<div class="reals-sound"><i class="fas fa-music"></i> ${escHtml(r.sound_name)}</div>` : ''}
          ${r.location ? `<div class="reals-location"><i class="fas fa-location-dot"></i> ${escHtml(r.location)}</div>` : ''}
          <div class="reals-desc">${escHtml(r.description||'')}</div>
          <div class="reals-right-actions">
            ${r.show_likes !== 0 ? `<button class="reals-action-btn like-btn"><i class="far fa-heart"></i><span class="count">${r.like_count||0}</span></button>` : ''}
            <button class="reals-action-btn comment-btn"><i class="far fa-comment"></i><span class="count">${r.comment_count||0}</span></button>
            <button class="reals-action-btn save-btn" title="Kaydet"><i class="far fa-bookmark"></i><span>Kaydet</span></button>
            <button class="reals-action-btn resend-btn" title="Bağlantıyı paylaş"><i class="fas fa-share-alt"></i><span>Paylaş</span></button>
            <button class="reals-action-btn share-btn" title="Mesaj olarak ilet"><i class="fas fa-paper-plane"></i><span>İlet</span></button>
          </div>
        </div>
        </div>
      </div>`).join('');
    items = Array.from(document.querySelectorAll('.reals-item'));
    items.forEach(it => {
      const video = orderedReals.find(item => String(item.id) === it.dataset.id);
      const likeButton = it.querySelector('.like-btn');
      if (likeButton && video?.liked) {
        likeButton.classList.add('active');
        likeButton.querySelector('i').className = 'fas fa-heart';
      }
    });
    items.forEach(it => {
      const vid = it.querySelector('video');
      setRealsVideoSource(vid, '');
      let clickTimer = null;
      it.addEventListener('click', event => {
        if (event.target.closest('button,a')) return;
        clearTimeout(clickTimer);
        clickTimer = setTimeout(() => { if (vid.paused) vid.play().catch(() => {}); else vid.pause(); }, 220);
      });
      it.querySelector('.reals-play-overlay')?.addEventListener('click', event => {
        event.stopPropagation();
        if (vid.paused) vid.play().catch(() => {}); else vid.pause();
      });
      it.addEventListener('dblclick', event => {
        if (event.target.closest('button,a')) return;
        clearTimeout(clickTimer);
        it.querySelector('.like-btn')?.click();
      });
      vid.addEventListener('play', () => { it.querySelector('.reals-play-overlay i').className = 'fas fa-pause'; it.classList.remove('reals-is-paused'); });
      vid.addEventListener('pause', () => { it.querySelector('.reals-play-overlay i').className = 'fas fa-play'; it.classList.add('reals-is-paused'); });
    });
    listEl.querySelectorAll('.mute-btn').forEach(btn => btn.addEventListener('click', e => {
      e.stopPropagation(); const vid = btn.closest('.reals-video-box').querySelector('video');
      vid.muted = !vid.muted; realsMuted = vid.muted; localStorage.setItem('cigcig_reals_muted', vid.muted ? '1' : '0'); btn.innerHTML = '<i class="fas fa-volume-' + (vid.muted ? 'mute' : 'up') + '"></i>';
    }));
    listEl.querySelectorAll('.reals-close-btn').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); navigate('/'); }));
    listEl.querySelectorAll('.like-btn').forEach(btn => btn.addEventListener('click', async (e) => {
      e.stopPropagation(); const it = btn.closest('.reals-item'); const id = it.dataset.id; try { btn.disabled=true; const result = await api(`/video/${id}/like`, { method:'POST' }); const span = btn.querySelector('.count'); span.textContent = result.like_count; btn.classList.toggle('active', result.liked); btn.querySelector('i').className = result.liked ? 'fas fa-heart' : 'far fa-heart'; } catch(e){ toast(e.message,'error'); } finally { btn.disabled=false; }
    }));
    listEl.querySelectorAll('.reals-follow-btn').forEach(btn => btn.addEventListener('click', async e => {
      e.stopPropagation();
      try {
        const username = btn.dataset.username;
        const state = followStates.get(username) || {};
        if (state.is_private) {
          await api('/friends/request/' + encodeURIComponent(username), { method: 'POST' });
          followStates.set(username, { ...state, friend_status: 'pending', friend_requester_id: currentUser?.id });
          btn.textContent = 'Arkadaşlık isteği gönderildi';
          btn.disabled = true;
          return;
        }
        const result = await api('/users/' + encodeURIComponent(username) + '/follow', { method: state.following ? 'DELETE' : 'POST' });
        followStates.set(username, { ...state, ...result });
        btn.textContent = result.following ? 'Takiptesin' : result.pending ? 'İstek gönderildi' : 'Takip et';
      } catch (error) { toast(error.message, 'error'); }
    }));
    listEl.querySelectorAll('.comment-btn').forEach(btn => btn.addEventListener('click', e => {
      e.stopPropagation();
      const video = orderedReals.find(item => String(item.id) === btn.closest('.reals-item').dataset.id);
      if (video) openRealsComments(video);
    }));
    listEl.querySelectorAll('.save-btn').forEach(btn => btn.addEventListener('click', async e => {
      e.stopPropagation(); const slug = btn.closest('.reals-item').dataset.slug;
      try { const result = await api(`/video/${slug}/save`, { method: 'POST' }); btn.classList.toggle('active', result.saved); btn.querySelector('i').className = result.saved ? 'fas fa-bookmark' : 'far fa-bookmark'; } catch (error) { toast(error.message, 'error'); }
    }));
    listEl.querySelectorAll('.resend-btn').forEach(btn => btn.addEventListener('click', async (e) => {
      e.stopPropagation(); const it = btn.closest('.reals-item'); const video = orderedReals.find(r => String(r.id) === it.dataset.id); if (!video) return;
      const shareUrl = `${location.origin}/reals/${encodeURIComponent(video.id)}`;
      try { await navigator.clipboard.writeText(shareUrl); toast('Reals bağlantısı kopyalandı'); } catch { toast(shareUrl); }
    }));
    listEl.querySelectorAll('.share-btn').forEach(btn => btn.addEventListener('click', async (e) => {
      e.stopPropagation(); const it = btn.closest('.reals-item'); const video = orderedReals.find(r => String(r.id) === it.dataset.id); if (video) showForwardVideoModal(video);
    }));
    listEl.querySelectorAll('.reals-desc').forEach(desc => desc.addEventListener('click', e => {
      e.stopPropagation(); const it = desc.closest('.reals-item'); const video = orderedReals.find(r => String(r.id) === it.dataset.id); const vid = it.querySelector('video');
      if (!video) return; const wasPlaying = !vid.paused; if (wasPlaying) vid.pause();
      window.__realsResumeVideo = () => { if (wasPlaying && location.pathname === '/reals') vid.play().catch(() => {}); };
      showModal('Reals açıklaması', `<div class="reals-description-modal"><p>${escHtml(video.description || '')}</p><button class="btn btn-primary" id="reals-description-close">Kapat</button></div>`);
      document.getElementById('reals-description-close')?.addEventListener('click', hideModal);
    }));
  }

  function showIndex(i, shouldScroll = true) {
    if (i < 0) i = 0; if (i >= items.length) i = items.length-1;
    const previousId = items[idx]?.dataset.id;
    if (previousId && i !== idx) watchedIds.add(Number(previousId));
    idx = i;
    if (shouldScroll) listEl.scrollTo({ top: i * listEl.clientHeight, behavior: 'smooth' });
    items.forEach((it, j) => {
      it.classList.toggle('is-active', j === idx);
      const vid = it.querySelector('video');
      const videoUrl = it.dataset.videoUrl;
      if (Math.abs(j - idx) <= 1) {
        setRealsVideoSource(vid, videoUrl);
        vid.muted = realsMuted || j !== idx;
        if (j === idx) vid.play().catch(() => {});
      } else {
        setRealsVideoSource(vid, '');
        vid.pause();
        vid.currentTime = 0;
        vid.muted = true;
      }
    });
  }

  renderItems();
  showIndex(0);

  let scrollFrame = null;
  listEl.addEventListener('scroll', () => {
    if (scrollFrame) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = null;
      const nextIndex = Math.max(0, Math.min(items.length - 1, Math.round(listEl.scrollTop / Math.max(1, listEl.clientHeight))));
      if (nextIndex !== idx) showIndex(nextIndex, false);
    });
  }, { passive: true });
  window.addEventListener('keydown', e => {
    if (location.pathname !== '/reals') return;
    if (e.key === 'ArrowDown' || e.key === 'PageDown') { e.preventDefault(); showIndex(idx+1); }
    if (e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); showIndex(idx-1); }
  });
}


async function initAuth() {
  if (!currentToken) return updateNavUI();
  try {
    const data = await api('/auth/me');
    currentUser = data.user;
    updateNavUI();
  } catch {
    currentToken = null;
    localStorage.removeItem('token');
    updateNavUI();
  }
}

function updateNavUI() {
  updateAppIcon(currentUser);
  const authEl = $('#nav-auth');
  const userEl = $('#nav-user');
  const mobAuth = $('#mobile-menu-auth');
  const mobNew = $('#mobile-new-dropdown');
  const mobNewToggle = $('#mobile-new-toggle');
  const mobUserLinks = $('#mobile-menu-user-links');

  if (currentUser) {
    authEl.classList.add('hidden');
    userEl.classList.remove('hidden');
    const nav = currentUser.avatar && !currentUser.avatar_removed ? `<img src="${escHtml(currentUser.avatar)}" class="nav-avatar" />` : `<div class="nav-avatar avatar-placeholder"><i class="fas fa-user" style="font-size:12px"></i></div>`;
    const btn = $('#nav-user-btn');
    btn.innerHTML = `<a href="${profileRoute(currentUser.username)}" data-link class="nav-avatar-link" onclick="event.stopPropagation()">${nav}</a><i class="fas fa-chevron-down" style="font-size:10px;color:var(--text-muted);padding:0 4px"></i>`;
    $('#dropdown-profile').setAttribute('href', profileRoute(currentUser.username));
    const navBrand = document.querySelector('.nav-brand');
    if (navBrand) {
      navBrand.setAttribute('href', '/');
      navBrand.style.cursor = 'pointer';
    }

    if (mobAuth) mobAuth.classList.add('hidden');
    if (mobNew) mobNew.classList.add('hidden');
    if (mobNewToggle) mobNewToggle.classList.remove('hidden');
    if (mobUserLinks) mobUserLinks.innerHTML = `
      <a href="${profileRoute(currentUser.username)}" data-link class="mobile-nav-link"><i class="fas fa-user" style="width:18px"></i> Profilim</a>
      <a href="/mesajlar" data-link class="mobile-nav-link" id="mob-msg-link"><i class="fas fa-envelope" style="width:18px"></i> Mesajlar <span id="mob-msg-badge" style="display:none;background:var(--accent-red);color:#fff;font-size:10px;padding:1px 5px;border-radius:10px;margin-left:4px"></span></a>
      <a href="/arkadaslar" data-link class="mobile-nav-link" id="mob-friends-link"><i class="fas fa-user-friends" style="width:18px"></i> Arkadaşlar <span id="mob-friends-badge" class="friend-request-dot" aria-label="Bekleyen arkadaşlık isteği"></span></a>
      <a href="/ayarlar" data-link class="mobile-nav-link"><i class="fas fa-cog" style="width:18px"></i> Ayarlar</a>
      <button class="mobile-nav-link" id="mob-logout" style="background:none;border:none;width:100%;text-align:left;color:var(--accent-red2)"><i class="fas fa-sign-out-alt" style="width:18px"></i> Çıkış Yap</button>
    `;
    $('#mob-logout')?.addEventListener('click', async () => {
      try { await api('/auth/logout', { method: 'POST' }); } catch {}
      currentToken = null; currentUser = null;
      localStorage.removeItem('token');
      updateNavUI(); navigate('/'); toast('Çıkış yapıldı');
      $('#mobile-menu').classList.add('hidden');
    });

    const mbbAuth = $('#mbb-auth');
    if (mbbAuth) {
      mbbAuth.setAttribute('href', profileRoute(currentUser.username));
      const lbl = $('#mbb-auth-label'); if (lbl) lbl.textContent = 'Profil';
      mbbAuth.querySelector('i').style.display = 'none';
      const avatar = $('#mbb-avatar');
      if (avatar) {
        const hasAvatar = hasUsableAvatar(currentUser);
        avatar.src = hasAvatar ? currentUser.avatar : 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"%3E%3Ccircle cx="32" cy="32" r="32" fill="%23353535"/%3E%3Ccircle cx="32" cy="23" r="11" fill="%23909090"/%3E%3Cpath d="M14 51c1-11 8-17 18-17s17 6 18 17" fill="%23909090"/%3E%3C/svg%3E';
        avatar.classList.toggle('avatar-fallback-logo', false);
        avatar.style.display = 'block';
      }
    }
  } else {
    authEl.classList.remove('hidden');
    const navBrand = document.querySelector('.nav-brand');
    if (navBrand) {
      navBrand.setAttribute('href', '/');
      navBrand.style.cursor = '';
    }
    userEl.classList.add('hidden');
    if (mobAuth) mobAuth.classList.remove('hidden');
    if (mobNew) mobNew.classList.add('hidden');
    if (mobNewToggle) mobNewToggle.classList.add('hidden');
    if (mobUserLinks) mobUserLinks.innerHTML = '';

    const mbbAuth = $('#mbb-auth');
    if (mbbAuth) {
      mbbAuth.setAttribute('href', '/giris');
      const lbl = $('#mbb-auth-label'); if (lbl) lbl.textContent = 'Giriş';
      mbbAuth.querySelector('i').className = 'fas fa-sign-in-alt';
      mbbAuth.querySelector('i').style.display = '';
      const avatar = $('#mbb-avatar'); if (avatar) { avatar.style.display = 'none'; avatar.classList.remove('avatar-fallback-logo'); }
      $('#mobile-new-dropdown')?.classList.add('hidden');
      $('#new-dropdown')?.classList.add('hidden');
    }
  }
}

function updateMobileBottomBar(path) {
  $$('#mobile-bottom-bar a').forEach(a => {
    const href = a.getAttribute('href');
    a.classList.toggle('active', href === path || (href !== '/' && path.startsWith(href)));
  });
}

$('#nav-user-btn').addEventListener('click', () => {
  $('#dropdown-menu').classList.toggle('hidden');
});
document.addEventListener('click', e => {
  if (!$('#nav-dropdown')?.contains(e.target)) $('#dropdown-menu')?.classList.add('hidden');
  if (!$('#new-btn-wrap')?.contains(e.target)) $('#new-dropdown')?.classList.add('hidden');
  if (!$('#notif-btn-wrap')?.contains(e.target)) $('#notif-dropdown')?.classList.add('hidden');
});

$('#nav-new-btn')?.addEventListener('click', e => {
  e.stopPropagation();
  $('#new-dropdown').classList.toggle('hidden');
});

// ===== BİLDİRİM SİSTEMİ =====
let notifPollTimer = null;

async function loadNotifCount() {
  if (!currentUser) return;
  try {
    const data = await api('/notifications/unread-count');
    const badge = $('#nav-notif-badge');
    if (!badge) return;
    const mobileBadge = $('#mobile-notif-badge');
    if (data.count > 0) { badge.style.display = ''; badge.textContent = data.count > 9 ? '9+' : data.count; if (mobileBadge) { mobileBadge.style.display = ''; mobileBadge.textContent = data.count > 9 ? '9+' : data.count; } }
    else { badge.style.display = 'none'; if (mobileBadge) mobileBadge.style.display = 'none'; }
    const friends = await api('/friends').catch(() => []);
    const pendingCount = friends.filter(friend => friend.status === 'pending' && String(friend.addressee_id) === String(currentUser.id)).length;
    ['#nav-friends-badge', '#mobile-friends-badge', '#mob-friends-badge', '#dm-friends-badge'].forEach(selector => { const dot = $(selector); if (dot) dot.style.display = pendingCount ? 'inline-block' : 'none'; });
  } catch {}
}
setInterval(pollIncomingVoiceCall, 2500);

async function openNotifDropdown() {
  const dd = $('#notif-dropdown');
  if (!dd) return;
  dd.classList.toggle('hidden');
  if (dd.classList.contains('hidden')) return;
  dd.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-muted)"><div class="spinner" style="margin:0 auto"></div></div>';
  try {
    const notifs = await api('/notifications');
    const friends = await api('/friends').catch(() => []);
    await api('/notifications/read-all', { method: 'POST' });
    const badge = $('#nav-notif-badge'); if (badge) badge.style.display = 'none';
    if (!notifs.length) {
      dd.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:13px"><i class="fas fa-bell-slash" style="font-size:24px;margin-bottom:8px;display:block"></i>Bildirim yok</div>';
      return;
    }
    dd.innerHTML = `
      <div style="padding:10px 14px;border-bottom:1px solid var(--border);font-weight:600;font-size:13px;display:flex;justify-content:space-between;align-items:center">
        <span><i class="fas fa-bell" style="color:var(--accent-red2);margin-right:6px"></i>Bildirimler</span>
      </div>
      ${notifs.map(n => `
        <div class="notif-item${n.is_read ? '' : ' notif-unread'}" data-link="${escHtml(n.link||'')}" data-id="${n.id}" style="padding:10px 14px;border-bottom:1px solid var(--border);cursor:pointer;transition:background .15s" onmouseover="this.style.background='var(--bg-hover)'" onmouseout="this.style.background=''">
          <div style="display:flex;gap:10px;align-items:flex-start">
            ${n.actor_avatar ? `<img src="${escHtml(n.actor_avatar)}" style="width:32px;height:32px;border-radius:50%;object-fit:cover;flex-shrink:0" />` : `<div style="width:32px;height:32px;border-radius:50%;background:var(--bg-card2);display:flex;align-items:center;justify-content:center;flex-shrink:0"><i class="fas fa-bell" style="font-size:12px;color:var(--accent-red2)"></i></div>`}
            <div style="flex:1;min-width:0">
              <div style="font-size:13px;line-height:1.4">${escHtml(n.body)}</div>
              <div style="font-size:11px;color:var(--text-muted);margin-top:3px">${timeAgo(n.created_at)}</div>
            </div>
            ${!n.is_read ? '<span class="notification-dot" aria-label="Okunmamış bildirim"></span>' : ''}
          </div>
        </div>`).join('')}`;
    dd.querySelectorAll('.notif-item').forEach(item => {
      item.addEventListener('click', () => {
        const link = item.dataset.link;
        $('#notif-dropdown').classList.add('hidden');
        if (link) navigate(link);
      });
    });
  } catch(e) {
    dd.innerHTML = `<div style="padding:16px;color:var(--accent-red2);font-size:13px">${e.message}</div>`;
  }
}

$('#nav-notif-btn')?.addEventListener('click', e => {
  e.stopPropagation();
  if (window.innerWidth <= 768) { navigate('/bildirimler'); return; }
  openNotifDropdown();
});
$('#nav-new-forum')?.addEventListener('click', () => { $('#new-dropdown').classList.add('hidden'); navigate('/forum'); setTimeout(() => { if (currentUser) showNewForumModal(); else navigate('/giris'); }, 100); });
$('#nav-new-book')?.addEventListener('click', () => { $('#new-dropdown').classList.add('hidden'); navigate('/kitaplar'); setTimeout(() => { if (currentUser) showNewBookModal(); else navigate('/giris'); }, 100); });
$('#nav-new-group')?.addEventListener('click', () => { $('#new-dropdown').classList.add('hidden'); navigate('/gruplar'); });
$('#nav-groups-btn')?.addEventListener('click', event => { event.preventDefault(); showMyGroupsModal(); });
$('#nav-new-photo')?.addEventListener('click', () => { $('#new-dropdown').classList.add('hidden'); if (currentUser) showPhotoUploadModal(); else navigate('/giris'); });
$('#nav-new-story')?.addEventListener('click', () => { $('#new-dropdown').classList.add('hidden'); if (currentUser) showStoryUploadModal(); else navigate('/giris'); });
$('#nav-new-music')?.addEventListener('click', () => { $('#new-dropdown').classList.add('hidden'); if (currentUser) navigate('/sarki-yukle'); else navigate('/giris'); });
$('#nav-new-video')?.addEventListener('click', () => { $('#new-dropdown').classList.add('hidden'); if (currentUser) { navigate('/videolar'); setTimeout(() => showNewVideoModal(), 120); } else { navigate('/giris'); } });
$('#nav-new-reals')?.addEventListener('click', () => { $('#new-dropdown').classList.add('hidden'); if (currentUser) { navigate('/reals'); setTimeout(() => showNewVideoModal(null, true), 180); } else { navigate('/giris'); } });
$('#logout-btn').addEventListener('click', async () => {
  try { await api('/auth/logout', { method: 'POST' }); } catch {}
  currentToken = null; currentUser = null;
  localStorage.removeItem('token');
  updateNavUI();
  navigate('/');
  toast('Çıkış yapıldı');
});

$('#mobile-toggle').addEventListener('click', () => {
  $('#mobile-menu').classList.toggle('hidden');
});

$('#mobile-new-toggle')?.addEventListener('click', e => {
  e.stopPropagation();
  $('#mobile-new-dropdown')?.classList.toggle('hidden');
});

async function showMyGroupsModal() {
  if (!currentUser) return navigate('/giris');
  showModal('Gruplarım', '<div class="loading-center"><div class="spinner"></div></div>');
  try {
    const groups = await api('/my-groups');
    $('#modal-body').innerHTML = groups.length ? `<div class="my-groups-list">${groups.map(group => `<a href="/grup/${escHtml(group.slug)}" data-link class="my-group-item" onclick="hideModal()"><span class="my-group-icon"><i class="fas fa-users"></i></span><span><b>${escHtml(group.name)}</b><small>${group.member_count || 0} üye · Mesajlaş</small></span><i class="fas fa-chevron-right"></i></a>`).join('')}</div><button type="button" class="btn btn-primary my-groups-explore-btn" id="my-groups-explore"><i class="fas fa-compass"></i> Gruplara git</button>` : `<div class="empty-state"><i class="fas fa-users"></i><p>Hiçbir grupta değilsin, katılmak ister misin?</p><button type="button" class="btn btn-primary" id="my-groups-explore"><i class="fas fa-compass"></i> Gruplara git</button></div>`;
    $('#my-groups-explore')?.addEventListener('click', () => { hideModal(); navigate('/gruplar'); });
  } catch (error) { $('#modal-body').innerHTML = `<div class="form-error">${escHtml(error.message)}</div>`; }
}
$('#mobile-books-btn')?.addEventListener('click', () => navigate('/kitaplar'));
$('#mobile-notif-btn')?.addEventListener('click', () => navigate('/bildirimler'));

document.addEventListener('click', e => {
  if (!$('#mobile-menu')?.contains(e.target) && !$('#mobile-toggle')?.contains(e.target)) {
    $('#mobile-menu')?.classList.add('hidden');
  }
  if (!$('#mobile-new-dropdown')?.contains(e.target) && !$('#mobile-new-toggle')?.contains(e.target)) {
    $('#mobile-new-dropdown')?.classList.add('hidden');
  }
});

document.addEventListener('click', e => {
  const mobNewForum = e.target.closest('#mob-new-forum');
  const mobNewBook = e.target.closest('#mob-new-book');
  const mobNewGroup = e.target.closest('#mob-new-group');
  const mobNewPhoto = e.target.closest('#mob-new-photo');
  const mobNewStory = e.target.closest('#mob-new-story');
  const mobNewVideo = e.target.closest('#mob-new-video');
  const mobNewMusic = e.target.closest('#mob-new-music');
  if (mobNewForum) { $('#mobile-new-dropdown').classList.add('hidden'); navigate('/forum'); setTimeout(() => showNewForumModal(), 100); }
  if (mobNewBook) { $('#mobile-new-dropdown').classList.add('hidden'); navigate('/kitaplar'); setTimeout(() => showNewBookModal(), 100); }
  if (mobNewGroup) { $('#mobile-new-dropdown').classList.add('hidden'); navigate('/gruplar'); setTimeout(() => showNewGroupModal(), 100); }
  if (mobNewPhoto) { $('#mobile-new-dropdown').classList.add('hidden'); if (currentUser) showPhotoUploadModal(); }
  if (mobNewStory) { $('#mobile-new-dropdown').classList.add('hidden'); if (currentUser) showStoryUploadModal(); }
  if (mobNewVideo) { $('#mobile-new-dropdown').classList.add('hidden'); if (currentUser) { navigate('/videolar'); setTimeout(() => showNewVideoModal(), 120); } }
  const mobNewReals = e.target.closest('#mob-new-reals');
  if (mobNewReals) { $('#mobile-new-dropdown').classList.add('hidden'); if (currentUser) { navigate('/reals'); setTimeout(() => showNewVideoModal(null, true), 180); } else navigate('/giris'); }
  if (mobNewMusic) { $('#mobile-new-dropdown').classList.add('hidden'); if (currentUser) navigate('/sarki-yukle'); }
});

async function renderHome(app) {
  document.title = siteName + ' – Topluluk Platformu';
  updatePageMeta(siteName + ' – Topluluk Platformu', 'CigCig, her şeyden, her platformdan özelliği barındıran bir topluluk platformu.', '');
  app.innerHTML = '<div class="container page"><div id="home-sections"></div></div>';

  let settings = {};
  try { settings = await fetch('/api/settings/public').then(r=>r.json()).catch(()=>({})); } catch {}
  const raw = settings.homepage_sections;
  let sections = raw ? (function() { try { const parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed : [parsed]; } catch { return [raw]; } })() : ['konular'];
  if (!Array.isArray(sections)) sections = [sections];
  sections = sections.map(s => typeof s === 'string' ? s.trim().toLowerCase() : '').filter(Boolean);
  if (!sections.length) sections = ['konular'];

  async function renderForumsSection() {
    const html = `
      <div class="section">
        <div class="page-header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:16px">
          <div><div class="page-title">Son Konular</div></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            <div class="search-bar" style="margin:0;flex:1;min-width:180px"><i class="fas fa-search"></i><input type="text" id="home-forum-search" placeholder="Konu ara..." /></div>
            ${currentUser ? `<button class="btn btn-primary btn-sm" id="home-new-forum-btn"><i class="fas fa-plus"></i> Yeni Konu</button>` : ''}
            <a href="/forum" data-link class="btn btn-ghost btn-sm">Tümü <i class="fas fa-arrow-right"></i></a>
          </div>
        </div>
        <div id="home-forums"><div class="loading-center"><div class="spinner"></div></div></div>
      </div>`;
    const container = $('#home-sections'); container.insertAdjacentHTML('beforeend', html);
    if (currentUser) $('#home-new-forum-btn')?.addEventListener('click', () => showNewForumModal());
    let allForums = [];
    try { allForums = await api('/forums'); const el = $('#home-forums'); if (!allForums.length) el.innerHTML = '<div class="empty-state"><i class="fas fa-comments"></i><p>Henüz konu yok.</p></div>'; else el.innerHTML = `<div style="display:flex;flex-direction:column;gap:12px">${allForums.slice(0, 10).map(f => forumCardHTML(f)).join('')}</div>`; } catch {}
    $('#home-forum-search')?.addEventListener('input', e => { const q = e.target.value.toLowerCase(); const filtered = allForums.filter(f => f.title.toLowerCase().includes(q) || f.content.toLowerCase().includes(q)); const el = $('#home-forums'); if (!el) return; if (!filtered.length) { el.innerHTML = '<div class="empty-state"><i class="fas fa-comments"></i><p>Konu bulunamadı.</p></div>'; return; } el.innerHTML = `<div style="display:flex;flex-direction:column;gap:12px">${filtered.map(f => forumCardHTML(f)).join('')}</div>`; });
  }

  async function renderBooksSection() {
    const html = `<div class="section"><div class="section-header"><div class="section-title"><div class="section-title-bar"></div>Öne Çıkan Kitaplar</div><a href="/kitaplar" data-link class="btn btn-ghost btn-sm">Tümü <i class="fas fa-arrow-right"></i></a></div><div id="home-books" class="grid-3"></div></div>`;
    const container = $('#home-sections'); container.insertAdjacentHTML('beforeend', html);
    try { const books = await api('/books'); const el = $('#home-books'); if (!books.length) el.innerHTML = '<div class="empty-state"><i class="fas fa-book"></i><p>Henüz kitap yok.</p></div>'; else el.innerHTML = books.slice(0, 6).map(b => bookCardHTML(b)).join(''); } catch {}
  }

  async function renderGroupsSection() {
    const html = `<div class="section"><div class="section-header"><div class="section-title"><div class="section-title-bar"></div>Popüler Gruplar</div><a href="/gruplar" data-link class="btn btn-ghost btn-sm">Tümü <i class="fas fa-arrow-right"></i></a></div><div id="home-groups" class="groups-grid"></div></div>`;
    const container = $('#home-sections'); container.insertAdjacentHTML('beforeend', html);
    try {
      const gs = await api('/groups');
      const el = $('#home-groups');
      if (!gs.length) {
        el.innerHTML = '<div class="empty-state"><i class="fas fa-users"></i><p>Henüz grup yok.</p></div>';
      } else {
        el.innerHTML = gs.slice(0, 6).map(g => groupCardHTML(g)).join('');
      }
    } catch {}
  }

  async function renderMusicSection() {
    const html = `<div class="section"><div class="section-header"><div class="section-title"><div class="section-title-bar"></div>Yeni Müzikler</div><a href="/muzikler" data-link class="btn btn-ghost btn-sm">Tümü <i class="fas fa-arrow-right"></i></a></div><div id="home-songs"></div></div>`;
    const container = $('#home-sections'); container.insertAdjacentHTML('beforeend', html);
    const el = $('#home-songs');
    try {
      const songs = await api('/songs');
      if (!songs.length) { el.innerHTML = '<div class="empty-state"><i class="fas fa-music"></i><p>Henüz müzik yok.</p></div>'; return; }
      songs.sort((a, b) => (b.play_count || 0) - (a.play_count || 0));
      el.innerHTML = `<div class="music-table">
        <div class="music-table-header">
          <div style="width:40px">#</div>
          <div style="flex:1">Başlık</div>
          <div style="width:160px;display:none" class="col-dist">Dağıtıcı</div>
          <div style="width:120px">Eklenme</div>
          <div style="width:80px;text-align:right">Dinlenme</div>
          ${currentUser ? '<div style="width:36px"></div>' : ''}
        </div>
        ${songs.map((s, i) => `
          <div class="music-row" data-slug="${escHtml(s.slug)}" data-id="${s.id}">
            <div class="music-num">${i+1}</div>
            <div class="music-info">
              <div class="music-cover-wrap">
                ${s.cover_url ? `<img src="${escHtml(s.cover_url)}" class="music-cover" />` : `<div class="music-cover music-cover-ph"><i class="fas fa-music"></i></div>`}
                <button class="music-play-mini" data-slug="${escHtml(s.slug)}" data-audio="${escHtml(s.audio_url)}" data-idx="${i}"><i class="fas fa-play"></i></button>
              </div>
              <div>
                <div class="music-title">${escHtml(s.title)}</div>
                <div class="music-artist">${escHtml(s.artist_name)}</div>
              </div>
            </div>
            <div class="music-dist col-dist">${escHtml(s.distributor||'-')}</div>
            <div class="music-date">${timeAgo(s.published_at)}</div>
            <div class="music-plays" style="text-align:right;font-size:12px;color:var(--text-muted)">${s.play_count} <i class="fas fa-headphones" style="font-size:10px"></i></div>
            ${currentUser ? `<div style="width:36px;text-align:right"><button class="btn-pl-add" data-song-id="${s.id}" title="Playliste ekle"><i class="fas fa-plus"></i></button></div>` : ''}
          </div>`).join('')}
      </div>`;

      el.querySelectorAll('.music-row').forEach(row => {
        row.addEventListener('click', e => {
          if (!e.target.closest('.music-play-mini') && !e.target.closest('.btn-pl-add')) navigate('/muzik/' + row.dataset.slug);
        });
      });
      el.querySelectorAll('.music-play-mini').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          const idx = parseInt(btn.dataset.idx);
          openMiniPlayer(btn.dataset.audio, btn.dataset.slug, songs[idx], songs, idx);
        });
      });
      el.querySelectorAll('.btn-pl-add').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          showAddToPlaylistMenu(btn.dataset.songId, btn.parentElement);
        });
      });
    } catch {}
  }

  async function renderPhotosSection() {
    const html = `<div class="section"><div id="home-stories-bar"></div><div id="home-photos" class="photos-feed"></div></div>`;
    const container = $('#home-sections'); container.insertAdjacentHTML('beforeend', html);
    loadStoriesBar($('#home-stories-bar'));
    try { const ps = shuffleArray(await api('/photos')); const el = $('#home-photos'); el.innerHTML = ps.length ? ps.slice(0,6).map(photoCardHTML).join('') : '<div class="empty-state"><i class="fas fa-images"></i><p>Henüz fotoğraf yok.</p></div>'; bindPhotoFeed(el); if (ps.length) setupPhotoAudio(el); } catch {}
  }

  async function renderShopSection() {
    const html = `<div class="section"><div class="section-header"><div class="section-title"><div class="section-title-bar"></div>Mağaza</div><a href="/magaza" data-link class="btn btn-ghost btn-sm">Tümü <i class="fas fa-arrow-right"></i></a></div><div id="home-shop" class="grid-3"></div></div>`;
    const container = $('#home-sections'); container.insertAdjacentHTML('beforeend', html);
    try { const items = await api('/shop/items'); const el = $('#home-shop'); if (!items.length) el.innerHTML = '<div class="empty-state"><i class="fas fa-store"></i><p>Mağaza boş.</p></div>'; else el.innerHTML = items.slice(0,6).map(i=>shopCardHTML(i)).join(''); } catch {}
  }

  async function renderPlaylistsSection() {
    const html = `<div class="section"><div class="section-header"><div class="section-title"><div class="section-title-bar"></div>Playlistler</div><a href="/playlistlerim" data-link class="btn btn-ghost btn-sm">Tümü <i class="fas fa-arrow-right"></i></a></div><div id="home-playlists" class="grid-3"></div></div>`;
    const container = $('#home-sections'); container.insertAdjacentHTML('beforeend', html);
    const el = $('#home-playlists');
    if (!currentUser) {
      el.innerHTML = '<div class="empty-state"><i class="fas fa-list"></i><p>Playlistlerini görmek için giriş yap.</p></div>';
      return;
    }
    try {
      const playlists = await api('/playlists');
      if (!playlists.length) {
        el.innerHTML = '<div class="empty-state"><i class="fas fa-list"></i><p>Henüz playlist yok.</p></div>';
        return;
      }
      el.innerHTML = playlists.slice(0,6).map(pl => `
        <a href="/playlist/${escHtml(pl.public_id || pl.id)}" data-link class="card card-body" style="display:block;text-decoration:none;color:inherit">
          <div style="display:flex;align-items:center;gap:12px">
            <div style="width:54px;height:54px;border-radius:16px;background:var(--bg-card2);display:flex;align-items:center;justify-content:center;font-size:20px">${escHtml(pl.emoji || '🎵')}</div>
            <div style="flex:1;min-width:0">
              <div style="font-size:15px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(pl.name)}</div>
              <div style="font-size:12px;color:var(--text-muted);margin-top:6px">${pl.song_count} şarkı · ${pl.is_public ? 'Herkese açık' : 'Gizli'}</div>
            </div>
          </div>
        </a>`).join('');
    } catch {}
  }

  const sectionMap = {
    konular: renderForumsSection,
    kitaplar: renderBooksSection,
    gruplar: renderGroupsSection,
    muzikler: renderMusicSection,
    fotograflar: renderPhotosSection,
    magaza: renderShopSection,
    playlistler: renderPlaylistsSection
  };

  for (const section of sections) {
    if (sectionMap[section]) {
      await sectionMap[section]();
    }
  }
}


async function renderForumList(app, queryString) {
  document.title = 'Konular – ' + siteName;
  updatePageMeta('Konular – ' + siteName, 'Toplulukla fikir paylaş, tartış, keşfet.', '');

  // URL'den ?tag= parametresini oku — önce argüman, yoksa location.search
  const qs = queryString !== undefined ? queryString : location.search;
  const urlParams = new URLSearchParams(qs);
  const activeTag = urlParams.get('tag') || '';

  app.innerHTML = `
    <div class="container page">
      <div class="page-header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
        <div>
          <div class="page-title">Konular</div>
          ${activeTag ? `<div class="page-subtitle"><i class="fas fa-hashtag" style="color:var(--accent-red2)"></i> <strong>${escHtml(activeTag)}</strong> etiketiyle filtreli &nbsp;<a href="/forum" data-link style="font-size:12px;color:var(--accent-red2)"><i class="fas fa-times"></i> Temizle</a></div>` : ''}
        </div>
      </div>
      <div class="search-bar"><i class="fas fa-search"></i><input type="text" id="forum-search" placeholder="Konu veya #etiket ara..." /></div>
      <div id="forums-list"><div class="loading-center"><div class="spinner"></div></div></div>
    </div>`;

  let forums = [];
  try {
    const url = activeTag ? `/forums?tag=${encodeURIComponent(activeTag)}` : '/forums';
    forums = await api(url);
  } catch {}
  renderForumListItems(forums);

  $('#forum-search')?.addEventListener('input', e => {
    const q = e.target.value.toLowerCase().replace(/^#/, '');
    if (!q) { renderForumListItems(forums); return; }
    const filtered = forums.filter(f => {
      if (f.title.toLowerCase().includes(q) || f.content.toLowerCase().includes(q)) return true;
      // Etiket araması
      const sTags = Array.isArray(f.system_tags) ? f.system_tags : [];
      if (sTags.some(t => t.name.toLowerCase().includes(q))) return true;
      if ((f.custom_tags||'').toLowerCase().includes(q)) return true;
      return false;
    });
    renderForumListItems(filtered);
  });
}

function renderForumListItems(forums) {
  const el = $('#forums-list');
  if (!el) return;
  if (!forums.length) { el.innerHTML = '<div class="empty-state"><i class="fas fa-comments"></i><p>Konu bulunamadı.</p></div>'; return; }
  el.innerHTML = `<div style="display:flex;flex-direction:column;gap:12px">${forums.map(f => forumCardHTML(f)).join('')}</div>`;
}

function forumCardHTML(f) {
  const preview = f.content.substring(0, 140).replace(/</g,'&lt;');
  const authorName = f.username || 'Silinmiş Kullanıcı';
  const authorClick = f.username
    ? `onclick="event.stopPropagation();navigate('${profileRoute(f.username)}')" style="cursor:pointer"`
    : `style="cursor:default;opacity:0.6"`;
  const d = new Date(f.created_at);
  const dateStr = d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' });
  const timeStr = d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

  // Etiketler
  const systemTags = Array.isArray(f.system_tags) ? f.system_tags : (typeof f.system_tags === 'string' ? (() => { try { return JSON.parse(f.system_tags); } catch { return []; } })() : []);
  const customTags = f.custom_tags ? f.custom_tags.split(',').map(t => t.trim()).filter(Boolean) : [];
  const tagsHTML = [
    ...systemTags.map(t => `<span class="forum-tag" style="background:${escHtml(t.color||'#555')}22;color:${escHtml(t.color||'#aaa')};border:1px solid ${escHtml(t.color||'#555')}44" onclick="event.stopPropagation();navigateTag('${escHtml(t.name)}')">#${escHtml(t.name)}</span>`),
    ...customTags.map(t => `<span class="forum-tag forum-tag-custom" onclick="event.stopPropagation();navigateTag('${escHtml(t)}')">#${escHtml(t)}</span>`)
  ].join('');

  // Kart thumbnail: önce thumbnail, yoksa 1. ek resim, yoksa banner
  const extraImgs = Array.isArray(f.system_tags) ? [] : []; // system_tags zaten ayrı parse ediliyor
  const parsedImages = (() => { try { return JSON.parse(f.images || '[]'); } catch { return []; } })();
  const cardThumb = f.thumbnail || parsedImages[0] || f.banner_image || '';

  return `<div class="forum-card" onclick="navigate('/forum/${escHtml(f.slug)}')">
    <div class="forum-card-accent"></div>
    <div class="forum-card-body">
      <div class="forum-card-title">${escHtml(f.title)}</div>
      <div class="forum-card-preview">${preview}${f.content.length > 140 ? '...' : ''}</div>
      ${tagsHTML ? `<div class="forum-tags-row">${tagsHTML}</div>` : ''}
      <div class="forum-card-meta">
        <span class="forum-meta-item" ${authorClick}><i class="fas fa-user"></i>${escHtml(authorName)}</span>
        <span class="forum-meta-item"><i class="fas fa-eye"></i>${f.views || 0}</span>
        <span class="forum-meta-item"><i class="fas fa-heart"></i>${f.like_count || 0}</span>
        <span class="forum-meta-item"><i class="fas fa-comment"></i>${f.comment_count || 0}</span>
        <span class="forum-meta-item" title="${dateStr} ${timeStr}"><i class="fas fa-clock"></i>${dateStr} ${timeStr}</span>
      </div>
    </div>
    ${cardThumb ? `<img src="${escHtml(cardThumb)}" class="forum-card-banner" alt="" />` : ''}
  </div>`;
}

// Hashtag tıklanınca o etikete göre filtrele
window.navigateTag = function(tag) {
  navigate('/forum?tag=' + encodeURIComponent(tag));
};

function showNewForumModal(existing = null) {
  showModal(existing ? 'Konuyu Düzenle' : 'Yeni Konu Aç', `
    <div class="form-group"><label>Başlık</label><input id="fm-title" type="text" placeholder="Konu başlığı" value="${existing ? escHtml(existing.title) : ''}" /></div>
    <div class="form-group"><label>İçerik</label><textarea id="fm-content" rows="8" placeholder="Yazınızı buraya girin...">${existing ? escHtml(existing.content) : ''}</textarea></div>
    <div class="form-group">
      <label>Konu Türleri</label>
      <div id="fm-tags-loading" style="color:var(--text-muted);padding:8px">Yükleniyor...</div>
      <div id="fm-tags-checkboxes" style="display:none;max-height:160px;overflow-y:auto;background:var(--bg-card2);border:1px solid var(--border);border-radius:8px;padding:10px;display:none"></div>
      <div style="margin-top:8px"><small style="color:var(--text-muted)">veya virgülle ayırarak kendiniz ekleyin:</small></div>
      <input type="text" id="fm-custom-tags" placeholder="Örn: bilim, siyaset, teknoloji" style="margin-top:4px" />
    </div>
    <div class="form-group">
      <label>Kart Küçük Resmi <span style="font-size:11px;font-weight:400;color:var(--text-muted)">(opsiyonel — boş bırakırsan 1. ek resim ya da banner kullanılır)</span></label>
      <input type="file" id="fm-thumb-file" accept="image/*" style="background:var(--bg-card2);border:1px dashed var(--border);padding:8px;cursor:pointer;border-radius:8px;margin-bottom:6px" />
      ${existing && existing.thumbnail ? `<img id="fm-thumb-preview" src="${escHtml(existing.thumbnail)}" style="width:90px;height:90px;object-fit:cover;border-radius:8px;border:1px solid var(--border)" />` : `<div id="fm-thumb-preview" style="display:none"></div>`}
    </div>
    <div class="form-group">
      <label>Banner Resim (opsiyonel)</label>
      <input type="file" id="fm-banner-file" accept="image/*" style="margin-bottom:8px" />
      ${existing && existing.banner_image ? `<img id="fm-banner-preview" src="${escHtml(existing.banner_image)}" style="width:100%;max-height:160px;object-fit:cover;border-radius:8px;margin-top:4px" />` : `<div id="fm-banner-preview" style="display:none"></div>`}
      <div style="margin-top:8px">
        <label style="font-size:11px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px">FOTOĞRAF GÖRÜNÜMÜ</label>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <label style="display:flex;align-items:center;gap:4px;font-size:12px;cursor:pointer;padding:4px 10px;border:1px solid var(--border);border-radius:6px">
            <input type="radio" name="fm-fit" value="cover" ${!existing || (existing.banner_fit||'cover')==='cover' ? 'checked' : ''} style="width:auto" /> Kap (Dikdörtgen)
          </label>
          <label style="display:flex;align-items:center;gap:4px;font-size:12px;cursor:pointer;padding:4px 10px;border:1px solid var(--border);border-radius:6px">
            <input type="radio" name="fm-fit" value="contain" ${existing && existing.banner_fit==='contain' ? 'checked' : ''} style="width:auto" /> Sığdır (Tam Görünsün)
          </label>
          <label style="display:flex;align-items:center;gap:4px;font-size:12px;cursor:pointer;padding:4px 10px;border:1px solid var(--border);border-radius:6px">
            <input type="radio" name="fm-fit" value="original" ${existing && existing.banner_fit==='original' ? 'checked' : ''} style="width:auto" /> Gerçek Boyut
          </label>
        </div>
      </div>
    </div>
    <div class="form-group"><label class="checkbox-label"><input type="checkbox" id="fm-comments" ${!existing || existing.allow_comments ? 'checked' : ''} /> Yorumlara izin ver</label></div>
    <div class="form-group">
      <label>Ek Resimler <span style="font-size:11px;font-weight:400;color:var(--text-muted)">(en fazla 5, her biri max 10MB)</span></label>
      <input type="file" id="fm-images-file" accept="image/*" multiple style="background:var(--bg-card2);border:1px dashed var(--border);padding:8px;cursor:pointer;border-radius:8px" />
      <div id="fm-images-preview" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px"></div>
    </div>
    <button class="btn btn-primary" id="fm-submit" style="width:100%">${existing ? 'Güncelle' : 'Yayınla'}</button>
    <div id="fm-error" class="form-error mt-4"></div>
  `);

  api('/tags').then(tags => {
    const container = $('#fm-tags-checkboxes');
    const loading = $('#fm-tags-loading');
    if (!container || !loading) return;
    loading.style.display = 'none';
    container.style.display = 'block';
    container.innerHTML = tags.map(t => `
      <label class="checkbox-label" style="margin:4px 0;padding:4px;cursor:pointer">
        <input type="checkbox" class="fm-tag-check" value="${t.id}" />
        <span class="badge" style="background:${escHtml(t.color)};padding:3px 8px;border-radius:4px;margin-left:6px">${escHtml(t.name)}</span>
      </label>
    `).join('');
    
    if (existing) {
      api('/forum/' + existing.slug + '/tags').then(data => {
        data.systemTags.forEach(t => {
          const cb = container.querySelector(`input[value="${t.id}"]`);
          if (cb) cb.checked = true;
        });
        if (data.customTags.length > 0) {
          $('#fm-custom-tags').value = data.customTags.join(', ');
        }
      }).catch(() => {});
    }
  }).catch(() => {
    $('#fm-tags-loading').textContent = 'Tag yüklenemedi';
  });

  $('#fm-banner-file').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const prev = $('#fm-banner-preview');
      prev.outerHTML = `<img id="fm-banner-preview" src="${ev.target.result}" style="width:100%;max-height:160px;object-fit:cover;border-radius:8px;margin-top:4px" />`;
    };
    reader.readAsDataURL(file);
  });

  // Thumbnail önizleme
  $('#fm-thumb-file')?.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const prev = $('#fm-thumb-preview');
      if (prev) prev.outerHTML = `<img id="fm-thumb-preview" src="${ev.target.result}" style="width:90px;height:90px;object-fit:cover;border-radius:8px;border:1px solid var(--border)" />`;
    };
    reader.readAsDataURL(file);
  });

  // Enter tuşu ile input'lardan form submit tetiklenmesini önle
  ['fm-title', 'fm-custom-tags'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('keydown', e => { if (e.key === 'Enter') e.preventDefault(); });
  });

  // Ek resimler önizleme
  const existingImages = existing ? (() => { try { return JSON.parse(existing.images || '[]'); } catch { return []; } })() : [];
  let extraImageFiles = []; // yeni yüklenecekler
  let keptImages = [...existingImages]; // mevcut (silinmeyenler)

  const renderImgPreviews = () => {
    const wrap = $('#fm-images-preview'); if (!wrap) return;
    const existingHTML = keptImages.map((url, i) => `
      <div style="position:relative;display:inline-block">
        <img src="${escHtml(url)}" style="width:80px;height:80px;object-fit:cover;border-radius:6px;border:1px solid var(--border)" />
        <button type="button" data-kept="${i}" style="position:absolute;top:-6px;right:-6px;background:var(--accent-red);color:#fff;border:none;border-radius:50%;width:18px;height:18px;font-size:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0">×</button>
      </div>`).join('');
    const newHTML = extraImageFiles.map((f, i) => {
      const url = URL.createObjectURL(f);
      return `<div style="position:relative;display:inline-block">
        <img src="${url}" style="width:80px;height:80px;object-fit:cover;border-radius:6px;border:1px solid var(--border)" />
        <button type="button" data-new="${i}" style="position:absolute;top:-6px;right:-6px;background:var(--accent-red);color:#fff;border:none;border-radius:50%;width:18px;height:18px;font-size:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0">×</button>
      </div>`;
    }).join('');
    wrap.innerHTML = existingHTML + newHTML;
    wrap.querySelectorAll('[data-kept]').forEach(btn => {
      btn.addEventListener('click', () => { keptImages.splice(parseInt(btn.dataset.kept), 1); renderImgPreviews(); });
    });
    wrap.querySelectorAll('[data-new]').forEach(btn => {
      btn.addEventListener('click', () => { extraImageFiles.splice(parseInt(btn.dataset.new), 1); renderImgPreviews(); });
    });
  };
  if (keptImages.length) renderImgPreviews();

  $('#fm-images-file')?.addEventListener('change', e => {
    const files = Array.from(e.target.files);
    const remaining = 5 - keptImages.length - extraImageFiles.length;
    extraImageFiles = [...extraImageFiles, ...files.slice(0, remaining)];
    e.target.value = '';
    renderImgPreviews();
  });

  $('#fm-submit').addEventListener('click', async () => {
    const title = $('#fm-title').value.trim();
    const content = $('#fm-content').value.trim();
    if (!title || !content) { $('#fm-error').textContent = 'Başlık ve içerik zorunlu'; return; }
    
    const submitBtn = $('#fm-submit');
    if (submitBtn._submitting) return;
    submitBtn._submitting = true;
    
    const tagIds = Array.from($$('.fm-tag-check:checked')).map(cb => parseInt(cb.value));
    const customTagsInput = $('#fm-custom-tags').value.trim();
    const customTags = customTagsInput ? customTagsInput.split(',').map(t => t.trim()).filter(Boolean) : [];
    
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<div class="spinner" style="width:16px;height:16px;border-width:2px;display:inline-block;margin-right:6px"></div> Yükleniyor...';

    try {
      let banner_image = existing ? (existing.banner_image || '') : '';
      const bannerFile = $('#fm-banner-file').files[0];
      if (bannerFile) {
        // Progress göster
        const progressWrap = document.createElement('div');
        progressWrap.id = 'fm-upload-progress';
        progressWrap.style.cssText = 'margin:8px 0;background:var(--bg-card2);border-radius:8px;overflow:hidden;height:6px';
        progressWrap.innerHTML = '<div id="fm-progress-bar" style="height:100%;background:var(--grad-red);width:0%;transition:width 0.3s"></div>';
        $('#fm-error').insertAdjacentElement('beforebegin', progressWrap);
        
        // XMLHttpRequest ile progress takibi
        banner_image = await new Promise((resolve, reject) => {
          const fd = new FormData();
          fd.append('file', bannerFile);
          const xhr = new XMLHttpRequest();
          xhr.upload.addEventListener('progress', e => {
            if (e.lengthComputable) {
              const pct = Math.round((e.loaded / e.total) * 90);
              const bar = $('#fm-progress-bar');
              if (bar) bar.style.width = pct + '%';
            }
          });
          xhr.addEventListener('load', () => {
            const bar = $('#fm-progress-bar');
            if (bar) bar.style.width = '100%';
            try {
              const data = JSON.parse(xhr.responseText);
              if (xhr.status >= 400) return reject(new Error(data.error || 'Yükleme hatası'));
              resolve(data.url);
            } catch (e) {
              reject(new Error('Sunucu yanıtı geçersiz: ' + xhr.responseText.substring(0, 100)));
            }
          });
          xhr.addEventListener('error', () => reject(new Error('Ağ hatası, tekrar deneyin')));
          xhr.open('POST', '/api/upload-video');
          const token = localStorage.getItem('token');
          if (token) xhr.setRequestHeader('Authorization', 'Bearer ' + token);
          xhr.send(fd);
        });
      }
      // Thumbnail yükle
      let thumbnailUrl = existing ? (existing.thumbnail || '') : '';
      const thumbFile = $('#fm-thumb-file')?.files[0];
      if (thumbFile) {
        const thumbFd = new FormData(); thumbFd.append('file', thumbFile);
        const thumbRes = await fetch('/api/upload', { method: 'POST', headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('token') || '') }, body: thumbFd });
        const thumbData = await thumbRes.json();
        if (thumbRes.ok && thumbData.url) thumbnailUrl = thumbData.url;
      }

      // Ek resimleri yükle
      const uploadedExtraImages = [...keptImages];
      for (let i = 0; i < extraImageFiles.length; i++) {
        const imgFile = extraImageFiles[i];
        const imgFd = new FormData(); imgFd.append('file', imgFile);
        const imgRes = await fetch('/api/upload', { method: 'POST', headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('token') || '') }, body: imgFd });
        const imgData = await imgRes.json();
        if (imgRes.ok && imgData.url) uploadedExtraImages.push(imgData.url);
      }

      if (existing) {
        await api('/forum/' + existing.slug, { method: 'PUT', body: JSON.stringify({ title, content, banner_image, allow_comments: $('#fm-comments').checked, tagIds, customTags, banner_fit: document.querySelector('[name="fm-fit"]:checked')?.value || 'cover', images: uploadedExtraImages, thumbnail: thumbnailUrl }) });
        toast('Konu güncellendi');
      } else {
        const f = await api('/forums', { method: 'POST', body: JSON.stringify({ title, content, banner_image, allow_comments: $('#fm-comments').checked, tagIds, customTags, banner_fit: document.querySelector('[name="fm-fit"]:checked')?.value || 'cover', images: uploadedExtraImages, thumbnail: thumbnailUrl }) });
        toast('Konu oluşturuldu');
        hideModal();
        navigate('/forum/' + f.slug);
        return;
      }
      hideModal();
      navigate(location.pathname, false);
      renderRoute(location.pathname);
    } catch (e) {
      $('#fm-error').textContent = e.message;
      const submitBtn = $('#fm-submit');
      if (submitBtn) { submitBtn.disabled = false; submitBtn._submitting = false; submitBtn.innerHTML = existing ? 'Güncelle' : 'Yayınla'; }
      const prog = $('#fm-upload-progress');
      if (prog) prog.remove();
    }
  });
}

async function renderForumDetail(app, slug) {
  app.innerHTML = `<div class="container page"><div class="loading-center"><div class="spinner"></div></div></div>`;
  let forum, liked = false, comments = [];
  try {
    forum = await api('/forum/' + slug);
    document.title = forum.title + ' – ' + siteName;
    updatePageMeta(
      forum.title + ' – CigCig',
      forum.content.substring(0, 155).replace(/\n/g, ' '),
      forum.banner_image || ''
    );

    let ld = document.getElementById('page-jsonld');
    if (!ld) { ld = document.createElement('script'); ld.type = 'application/ld+json'; ld.id = 'page-jsonld'; document.head.appendChild(ld); }
    ld.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'DiscussionForumPosting',
      'headline': forum.title,
      'text': forum.content.substring(0, 500),
      'url': SITE_URL + '/forum/' + forum.slug,
      'datePublished': forum.created_at,
      'dateModified': forum.updated_at || forum.created_at,
      'author': { '@type': 'Person', 'name': forum.username || 'Anonim' },
      'publisher': { '@type': 'Organization', 'name': siteName, 'url': SITE_URL },
      'interactionStatistic': [
        { '@type': 'InteractionCounter', 'interactionType': 'https://schema.org/LikeAction', 'userInteractionCount': forum.like_count || 0 },
        { '@type': 'InteractionCounter', 'interactionType': 'https://schema.org/CommentAction', 'userInteractionCount': forum.comment_count || 0 }
      ],
      ...(forum.banner_image ? { 'image': { '@type': 'ImageObject', 'url': forum.banner_image } } : {})
    });

    try { await api('/forum/' + slug + '/view', { method: 'POST' }); } catch {}
    if (currentUser) { const l = await api('/forum/' + slug + '/liked'); liked = l.liked; }
    comments = await api('/forum/' + slug + '/comments');
  } catch { app.innerHTML = '<div class="container page"><div class="empty-state"><i class="fas fa-exclamation-circle"></i><p>Konu bulunamadı.</p></div></div>'; return; }

  const isOwner = currentUser && currentUser.id === forum.user_id;

  app.innerHTML = `<div class="container page">
    <div class="forum-detail">
      ${isOwner ? `<div style="display:flex;gap:8px;margin-bottom:16px">
        <button class="btn btn-outline btn-sm" id="edit-forum-btn"><i class="fas fa-edit"></i> Düzenle</button>
        <button class="btn btn-danger btn-sm" id="del-forum-btn"><i class="fas fa-trash"></i> Sil</button>
      </div>` : ''}
      <div class="forum-detail-header">
        <div class="forum-detail-title">${escHtml(forum.title)}</div>
        <div class="forum-detail-meta">
          <span style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
            ${avatarImg(forum, 'avatar-sm')}
            <a href="${profileRoute(forum.username)}" data-link style="color:inherit">${userDisplayName(forum)}</a>
            ${forum.user_location ? `<span style="font-size:11px;color:var(--text-muted)"><i class="fas fa-map-marker-alt" style="font-size:10px"></i> ${escHtml(forum.user_location)}</span>` : ''}
          </span>
          <span><i class="fas fa-calendar" style="color:var(--accent-red)"></i> ${formatDate(forum.created_at)}</span>
          <span><i class="fas fa-eye" style="color:var(--accent-red)"></i> ${forum.views || 0} görüntülenme</span>
          ${forum.share_count ? `<span><i class="fas fa-share-alt" style="color:var(--accent-red)"></i> ${forum.share_count} iletildi</span>` : ''}
        </div>
      ${forum.banner_image ? `<div class="forum-banner-wrap" style="margin-top:16px;margin-bottom:4px;${forum.banner_fit === 'original' ? 'text-align:center' : ''}">
        <img src="${escHtml(forum.banner_image)}" class="forum-detail-banner" alt=""
          style="object-fit:${forum.banner_fit === 'contain' ? 'contain' : forum.banner_fit === 'original' ? 'none;height:auto;aspect-ratio:unset;max-width:100%' : 'cover'}" />
      </div>` : ''}
      <div class="forum-detail-content">${renderContent(forum.content)}</div>
      ${(() => {
        const imgs = (() => { try { return JSON.parse(forum.images || '[]'); } catch { return []; } })();
        if (!imgs.length) return '';
        return `<div class="forum-images-gallery">${imgs.map(url => `
          <a href="${escHtml(url)}" target="_blank" rel="noopener noreferrer" class="forum-gallery-item">
            <img src="${escHtml(url)}" alt="" loading="lazy" />
          </a>`).join('')}</div>`;
      })()}
      ${(() => {
        const sTags = Array.isArray(forum.system_tags) ? forum.system_tags : (typeof forum.system_tags === 'string' ? (() => { try { return JSON.parse(forum.system_tags); } catch { return []; } })() : []);
        const cTags = forum.custom_tags ? forum.custom_tags.split(',').map(t => t.trim()).filter(Boolean) : [];
        if (!sTags.length && !cTags.length) return '';
        const html = [
          ...sTags.map(t => `<a href="/forum?tag=${encodeURIComponent(t.name)}" data-link class="forum-tag" style="background:${escHtml(t.color||'#555')}22;color:${escHtml(t.color||'#aaa')};border:1px solid ${escHtml(t.color||'#555')}44">#${escHtml(t.name)}</a>`),
          ...cTags.map(t => `<a href="/forum?tag=${encodeURIComponent(t)}" data-link class="forum-tag forum-tag-custom">#${escHtml(t)}</a>`)
        ].join('');
        return `<div class="forum-tags-row" style="margin:12px 0">${html}</div>`;
      })()}
      <div class="forum-actions">
        <button class="forum-action-btn ${liked ? 'liked' : ''}" id="like-btn">
          <i class="fas fa-heart"></i> <span id="like-count">${forum.like_count || 0}</span> Beğeni
        </button>
        <button class="forum-action-btn" id="share-btn"><i class="fas fa-share-alt"></i> Paylaş</button>
        ${currentUser ? `<button class="forum-action-btn" id="forward-forum-btn"><i class="fas fa-paper-plane"></i> İlet</button>` : ''}
      </div>
      <hr class="divider" />
      <div class="comments-section">
        <div class="comments-title"><i class="fas fa-comments" style="color:var(--accent-red)"></i> Yorumlar (${comments.length})</div>
        ${currentUser && forum.allow_comments ? `
          <div id="comment-reply-area" style="display:none;margin-bottom:12px;padding:12px 14px;border:1px solid var(--border);border-radius:12px;background:var(--bg-secondary);align-items:center;justify-content:space-between;gap:10px">
            <span id="comment-reply-text" style="font-size:13px;color:var(--text-secondary)"></span>
            <button type="button" class="btn btn-ghost btn-sm" id="comment-reply-clear" style="padding:2px 8px">✕</button>
          </div>
          <div class="comment-form">
            ${avatarImg(currentUser, 'comment-avatar')}
            <textarea id="comment-input" placeholder="Yorumunuzu yazın..."></textarea>
            <button class="btn btn-primary btn-sm" id="comment-submit"><i class="fas fa-paper-plane"></i></button>
          </div>` : (!currentUser && forum.allow_comments ? `<p class="text-secondary" style="margin-bottom:16px">Yorum yapmak için <a href="/giris" data-link class="auth-link">giriş yapın</a>.</p>` : (!forum.allow_comments ? `<p class="text-muted" style="margin-bottom:16px">Yorumlar kapatılmış.</p>` : ''))}
        <div id="comments-list">${comments.map(c => commentHTML(c)).join('')}</div>
      </div>
    </div>
  </div>`;

  if (isOwner) {
    $('#edit-forum-btn').addEventListener('click', () => showNewForumModal(forum));
    $('#del-forum-btn').addEventListener('click', async () => {
      if (!confirm('Konuyu silmek istediğinize emin misiniz?')) return;
      try { await api('/forum/' + slug, { method: 'DELETE' }); toast('Konu silindi'); navigate('/forum'); } catch (e) { toast(e.message, 'error'); }
    });
  }

  $('#like-btn').addEventListener('click', async () => {
    if (!currentUser) { navigate('/giris'); return; }
    try {
      const r = await api('/forum/' + slug + '/like', { method: 'POST' });
      liked = r.liked;
      const btn = $('#like-btn'); const cnt = $('#like-count');
      btn.classList.toggle('liked', liked);
      cnt.textContent = parseInt(cnt.textContent) + (liked ? 1 : -1);
    } catch {}
  });

  $('#share-btn').addEventListener('click', () => {
    const url = location.href;
    if (navigator.clipboard) { navigator.clipboard.writeText(url); toast('Link kopyalandı!'); }
    else { window.prompt('Linki kopyalayın:', url); }
  });

  $('#forward-forum-btn')?.addEventListener('click', () => showForwardForumModal(forum));

  let commentReplyTarget = null;
  const clearCommentReply = () => {
    commentReplyTarget = null;
    const area = $('#comment-reply-area');
    if (area) area.style.display = 'none';
    const text = $('#comment-reply-text');
    if (text) text.textContent = '';
  };

  $('#comment-submit')?.addEventListener('click', async () => {
    let content = $('#comment-input').value.trim();
    if (!content) return;
    if (commentReplyTarget) {
      const mention = '@' + commentReplyTarget.username;
      if (!content.startsWith(mention)) content = mention + ' ' + content;
    }
    try {
      const c = await api('/forum/' + slug + '/comments', { method: 'POST', body: JSON.stringify({ content }) });
      $('#comments-list').insertAdjacentHTML('beforeend', commentHTML(c));
      $('#comment-input').value = '';
      clearCommentReply();
      const title = $('.comments-title');
      if (title) title.innerHTML = `<i class="fas fa-comments" style="color:var(--accent-red)"></i> Yorumlar (${$('#comments-list').children.length})`;
    } catch (e) { toast(e.message, 'error'); }
  });

  $('#comment-reply-clear')?.addEventListener('click', clearCommentReply);

  $('#comments-list').addEventListener('click', async e => {
    const replyBtn = e.target.closest('.reply-comment-btn');
    if (replyBtn) {
      if (!currentUser) { navigate('/giris'); return; }
      commentReplyTarget = { id: replyBtn.dataset.id, username: replyBtn.dataset.username };
      const area = $('#comment-reply-area');
      const text = $('#comment-reply-text');
      if (area && text) {
        area.style.display = 'flex';
        text.textContent = `Yanıtlanıyor: ${replyBtn.dataset.username}`;
      }
      $('#comment-input')?.focus();
      return;
    }
    const del = e.target.closest('.del-comment');
    if (del) {
      if (!confirm('Yorum silinsin mi?')) return;
      const id = del.dataset.id;
      try {
        await api('/forum/' + slug + '/comments/' + id, { method: 'DELETE' });
        del.closest('.comment').remove();
      } catch (e) { toast(e.message, 'error'); }
    }

    const likeBtn = e.target.closest('.like-comment-btn');
    if (likeBtn) {
      if (!currentUser) { navigate('/giris'); return; }
      const id = likeBtn.dataset.id;
      try {
        const r = await api(`/forum/${slug}/comments/${id}/like`, { method: 'POST' });
        const cnt = likeBtn.querySelector('.like-cnt');
        cnt.textContent = parseInt(cnt.textContent) + (r.liked ? 1 : -1);
        likeBtn.classList.toggle('liked', r.liked);
      } catch {}
    }
  });
}

function commentHTML(c) {
  const canDel = currentUser && currentUser.id === c.user_id;
  const canReply = !!currentUser;
  return `<div class="comment">
    ${avatarImg(c, 'comment-avatar')}
    <div class="comment-body">
      <div class="comment-header">
        <span class="comment-author">${c.username ? `<a href="${profileRoute(c.username)}" data-link>${userDisplayName(c)}</a>` : userDisplayName(c)}</span>
        <span class="comment-time">${timeAgo(c.created_at)}</span>
      </div>
      <div class="comment-content">${renderContent(c.content)}</div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:8px">
        <div style="display:flex;align-items:center;gap:8px">
          ${canReply ? `<button class="btn btn-ghost btn-sm reply-comment-btn" data-id="${c.id}" data-username="${escHtml(c.username || '')}" style="padding:2px 6px;color:var(--text-secondary)"><i class="fas fa-reply"></i></button>` : ''}
          ${canDel ? `<button class="btn btn-ghost btn-sm del-comment" data-id="${c.id}" style="padding:2px 6px;color:var(--accent-red2)"><i class="fas fa-trash"></i></button>` : ''}
        </div>
        <button class="like-comment-btn forum-action-btn" data-id="${c.id}" style="padding:4px 10px;font-size:12px">
          <i class="fas fa-heart"></i> <span class="like-cnt">${c.like_count || 0}</span>
        </button>
      </div>
    </div>
  </div>`;
}

async function renderBookList(app) {
  document.title = 'Kitaplar – ' + siteName;
  updatePageMeta('Kitaplar – ' + siteName, 'Topluluğun yazdığı eserleri keşfet.', '');
  app.innerHTML = `
    <div class="container page">
      <div class="search-bar"><i class="fas fa-search"></i><input type="text" id="book-search" placeholder="Kitap ara..." /></div>
      <div id="books-grid" class="grid-3"><div class="loading-center"><div class="spinner"></div></div></div>
    </div>`;

  let books = [];
  try { books = await api('/books'); } catch {}
  renderBookGrid(books);

  $('#book-search')?.addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    renderBookGrid(books.filter(b => b.title.toLowerCase().includes(q) || b.username?.toLowerCase().includes(q)));
  });
}

function renderBookGrid(books) {
  const el = $('#books-grid'); if (!el) return;
  if (!books.length) { el.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><i class="fas fa-book-open"></i><p>Kitap bulunamadı.</p></div>'; return; }
  el.innerHTML = books.map(b => bookCardHTML(b)).join('');
}

function bookCardHTML(b) {
  const previewText = b.preface ? b.preface.substring(0, 80) : '';
  const authorDisplay = b.author || b.username || '';
  return `<div class="book-card" onclick="navigate('/kitap/${escHtml(b.slug)}')">
    <div class="book-cover">
      ${b.cover_image ? `<img src="${escHtml(b.cover_image)}" alt="" />` : `<div class="book-cover-placeholder"><i class="fas fa-book"></i></div>`}
      ${(b.is_hidden || b.has_password) ? `<div style="position:absolute;top:8px;right:8px;background:${b.is_hidden ? '#7c3aed' : 'rgba(168,85,247,.18)'};color:${b.is_hidden ? '#fff' : '#c084fc'};width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;border:1px solid rgba(192,132,252,.45)" title="${b.is_hidden ? 'Gizli kitap' : 'Şifreli kitap'}"><i class="fas fa-${b.has_password ? 'key' : 'lock'}"></i></div>` : ''}
    </div>
    <div class="book-info">
      <div class="book-title">${escHtml(b.title)}</div>
      ${authorDisplay ? `<div class="book-author"><i class="fas fa-pen" style="color:var(--accent-red);font-size:11px"></i> ${escHtml(authorDisplay)}</div>` : ''}
      <div class="book-pages"><i class="fas fa-file-alt" style="color:var(--text-muted);font-size:11px"></i> ${b.page_count || 0} sayfa</div>
      ${previewText ? `<div class="book-desc">${escHtml(previewText)}...</div>` : ''}
    </div>
  </div>`;
}

function showNewBookModal(existing = null) {
  const isUnnamedBook = existing && existing.is_unnamed;
  showModal(existing ? 'Kitabı Düzenle' : 'Yeni Kitap', `
    ${!existing ? `
    <div id="bk-unnamed-banner" style="margin-bottom:14px;background:linear-gradient(135deg,rgba(234,179,8,0.12),rgba(249,115,22,0.08));border:1px solid rgba(234,179,8,0.3);border-radius:12px;padding:14px 16px">
      <label style="display:flex;align-items:center;gap:12px;cursor:pointer;margin:0">
        <div style="position:relative;flex-shrink:0">
          <input type="checkbox" id="bk-no-name" style="width:18px;height:18px;cursor:pointer;accent-color:#eab308" />
        </div>
        <div>
          <div style="font-size:13px;font-weight:700;color:#facc15;margin-bottom:2px"><i class="fas fa-clock" style="margin-right:6px"></i>İsim koymadan oluştur</div>
          <div style="font-size:12px;color:rgba(255,255,255,0.5)">Kitap otomatik gizli olur, isim koyuncaya kadar kimse göremez</div>
        </div>
      </label>
    </div>` : ''}
    <div id="bk-title-group" class="form-group">
      <label>Başlık ${!existing ? '<span id="bk-title-required" style="color:var(--accent-red2)">*</span>' : ''}</label>
      <input id="bk-title" type="text" value="${existing ? escHtml(existing.is_unnamed ? '' : existing.title) : ''}" placeholder="${isUnnamedBook ? 'Yeni isim gir...' : 'Kitap başlığı'}" />
    </div>
    <div class="form-group"><label>Kitap Yazarı <span style="color:var(--accent-red2)">*</span></label><input id="bk-author" type="text" placeholder="Yazar adı (zorunlu)" value="${existing ? escHtml(existing.author || existing.username || '') : (currentUser ? escHtml(currentUser.username) : '')}" /></div>
    <div class="form-group"><label>Tanıtım / Önsöz</label><textarea id="bk-preface" rows="4">${existing ? escHtml(existing.preface || '') : ''}</textarea></div>
    <div class="form-group"><label>Karakterler (opsiyonel)</label><textarea id="bk-karakterler" rows="3" placeholder="Karakter isimleri, kısa notlar...">${existing ? escHtml(existing.karakterler || '') : ''}</textarea></div>
    <div class="form-group"><label>Kadro (opsiyonel)</label><textarea id="bk-kadro" rows="3" placeholder="Oyuncu kadrosu, karakter dağılımı...">${existing ? escHtml(existing.kadro || '') : ''}</textarea></div>
    <div class="form-group">
      <label>Kapak Resmi (opsiyonel)</label>
      <input type="file" id="bk-cover-file" accept="image/*" style="margin-bottom:8px" />
      ${existing && existing.cover_image ? `<img id="bk-cover-preview" src="${escHtml(existing.cover_image)}" style="width:100px;height:133px;object-fit:cover;border-radius:8px;margin-top:4px" />` : `<div id="bk-cover-preview" style="display:none"></div>`}
    </div>
    <div id="bk-hidden-wrap" class="book-privacy-toggle" style="margin-bottom:12px;background:rgba(124,58,237,.12);border-color:rgba(168,85,247,.42)">
      <div class="toggle-header">
        <i class="fas fa-lock" style="color:var(--accent-red2);font-size:16px"></i>
        <div class="toggle-label">
          <div class="toggle-title">Gizli Kitap</div>
          <div class="toggle-desc">Sadece siz ve yönetim görebilir</div>
        </div>
      </div>
      <label class="toggle-switch">
        <input type="checkbox" id="bk-is-hidden" ${existing && existing.is_hidden ? 'checked' : ''} />
        <span class="toggle-slider"></span>
      </label>
    </div>
    <div class="form-group book-password-field">
      <label><i class="fas fa-key" style="color:#a855f7"></i> Kitap şifresi</label>
      <input id="bk-password" type="password" autocomplete="new-password" placeholder="${existing ? 'Değiştirmek istemiyorsan boş bırak' : 'İsteğe bağlı kitap şifresi'}" />
      <div class="form-hint">Şifreli kitaplar yalnızca sahibi ve şifreyi giren kişilere görünür.</div>
    </div>
    <button class="btn btn-primary" id="bk-submit" style="width:100%;margin-top:16px">${existing ? (isUnnamedBook ? '<i class="fas fa-tag"></i> İsim Ekle ve Yayınla' : 'Güncelle') : 'Oluştur'}</button>
    <div id="bk-error" class="form-error mt-4"></div>
  `);

  // "İsim koymadan oluştur" checkbox davranışı
  const noNameCb = $('#bk-no-name');
  if (noNameCb) {
    const applyNoName = (checked) => {
      const titleGroup = $('#bk-title-group');
      const hiddenWrap = $('#bk-hidden-wrap');
      const titleInput = $('#bk-title');
      const hiddenCb = $('#bk-is-hidden');
      const submitBtn = $('#bk-submit');
      if (checked) {
        titleGroup.style.opacity = '0.4';
        titleGroup.style.pointerEvents = 'none';
        titleInput.value = '';
        titleInput.placeholder = '(sonra eklenecek)';
        hiddenWrap.style.opacity = '0.4';
        hiddenWrap.style.pointerEvents = 'none';
        hiddenCb.checked = true;
        submitBtn.innerHTML = '<i class="fas fa-clock"></i> İsimsiz Oluştur (Gizli)';
        submitBtn.style.background = 'linear-gradient(135deg,#ca8a04,#92400e)';
      } else {
        titleGroup.style.opacity = '';
        titleGroup.style.pointerEvents = '';
        titleInput.placeholder = 'Kitap başlığı';
        hiddenWrap.style.opacity = '';
        hiddenWrap.style.pointerEvents = '';
        submitBtn.innerHTML = 'Oluştur';
        submitBtn.style.background = '';
      }
    };
    noNameCb.addEventListener('change', e => applyNoName(e.target.checked));
  }

  $('#bk-cover-file').addEventListener('change', e => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const prev = $('#bk-cover-preview');
      prev.outerHTML = `<img id="bk-cover-preview" src="${ev.target.result}" style="width:100px;height:133px;object-fit:cover;border-radius:8px;margin-top:4px" />`;
    };
    reader.readAsDataURL(file);
  });

  $('#bk-submit').addEventListener('click', async () => {
    const noName = $('#bk-no-name')?.checked || false;
    const title = $('#bk-title').value.trim();
    const author = $('#bk-author').value.trim();
    if (!noName && !title) { $('#bk-error').textContent = 'Başlık zorunlu'; return; }
    if (!author) { $('#bk-error').textContent = 'Yazar adı zorunlu'; return; }
    try {
      let cover_image = existing ? (existing.cover_image || '') : '';
      const coverFile = $('#bk-cover-file').files[0];
      if (coverFile) {
        const fd = new FormData(); fd.append('file', coverFile);
        const r = await apiForm('/upload', fd);
        cover_image = r.url;
      }
      const payload = {
        title: noName ? '' : title,
        author,
        preface: $('#bk-preface').value.trim(),
        karakterler: $('#bk-karakterler').value.trim(),
        kadro: $('#bk-kadro').value.trim(),
        cover_image,
        is_hidden: noName ? true : $('#bk-is-hidden').checked,
        is_unnamed: noName ? true : false
      };
      const bookPassword = $('#bk-password').value;
      if (bookPassword) payload.book_password = bookPassword;
      if (existing) {
        // İsimsiz bir kitaba isim ekliyorsa is_unnamed=false, is_hidden'i kullanıcı seçimine bırak
        if (existing.is_unnamed && title) {
          payload.is_unnamed = false;
          payload.is_hidden = $('#bk-is-hidden').checked;
        }
        await api('/book/' + existing.slug, { method: 'PUT', body: JSON.stringify(payload) });
        toast(existing.is_unnamed && title ? '✅ Kitaba isim eklendi, artık herkese açık olabilir!' : 'Kitap güncellendi');
        hideModal(); renderRoute(location.pathname);
      } else {
        const b = await api('/books', { method: 'POST', body: JSON.stringify(payload) });
        if (noName) {
          toast('📖 İsimsiz kitap oluşturuldu — isim ekleyene kadar gizli kalacak!');
          // Her 60 saniyede hatırlatma
          _startUnnamedBookReminder(b.slug);
        } else {
          toast('Kitap oluşturuldu');
        }
        hideModal(); navigate('/kitap/' + b.slug);
      }
    } catch (e) { $('#bk-error').textContent = e.message; }
  });
}

// İsimsiz kitap için periyodik hatırlatma (sayfa yenilenene kadar)
let _unnamedReminderInterval = null;
function _startUnnamedBookReminder(slug) {
  if (_unnamedReminderInterval) clearInterval(_unnamedReminderInterval);
  _unnamedReminderInterval = setInterval(() => {
    // Sadece o kitabın sayfasındaysak hatırlat
    if (location.pathname === '/kitap/' + slug) {
      _showUnnamedPulse();
    }
  }, 60000); // her 60 saniye
}
function _showUnnamedPulse() {
  const banner = document.getElementById('unnamed-book-reminder');
  if (!banner) return;
  banner.style.animation = 'none';
  banner.offsetHeight; // reflow
  banner.style.animation = 'unnamedPulse 0.6s ease 3';
}

async function renderBookDetail(app, slug) {
  app.innerHTML = `<div class="container page"><div class="loading-center"><div class="spinner"></div></div></div>`;
  let data;
  try { data = await api('/book/' + slug); } catch (error) {
    if (error.data?.password_required) {
      app.innerHTML = `<div class="container page"><div class="book-unlock-panel"><div class="book-unlock-icon"><i class="fas fa-lock"></i></div><div class="book-unlock-kicker">ÖZEL KİTAP</div><h2>Bu kitap şifreli</h2><p>Kitaba erişmek için sahibinin belirlediği şifreyi girin.</p><div class="book-unlock-field"><i class="fas fa-key"></i><input type="password" id="book-unlock-password" placeholder="Kitap şifresi" autocomplete="off" /></div><button class="btn btn-primary" id="book-unlock-btn"><i class="fas fa-unlock"></i> Kitabın kilidini aç</button><div id="book-unlock-error" class="form-error"></div></div></div>`;
      $('#book-unlock-btn').addEventListener('click', async () => { try { await api('/book/' + slug + '/unlock', { method: 'POST', body: JSON.stringify({ password: $('#book-unlock-password').value }) }); renderBookDetail(app, slug); } catch (unlockError) { $('#book-unlock-error').textContent = unlockError.message; } });
      $('#book-unlock-password').addEventListener('keydown', event => { if (event.key === 'Enter') $('#book-unlock-btn').click(); });
      return;
    }
    app.innerHTML = '<div class="container page"><div class="empty-state"><i class="fas fa-exclamation-circle"></i><p>Kitap bulunamadı veya gizli.</p></div></div>'; return;
  }

  const { book, chapters, pages } = data;
  document.title = book.title + ' – ' + siteName;
  updatePageMeta(book.title + ' – ' + siteName, book.preface ? book.preface.substring(0,155) : book.title + ' – CigCig\'te yayınlanan kitap.', book.cover_image || '');
  const isOwner = currentUser && currentUser.id === book.user_id;

  const sortedPages = [...pages].sort((a,b) => (a.page_num || 0) - (b.page_num || 0));
  const firstPage = sortedPages[0];
  const unassigned = sortedPages.filter(p => !p.chapter_id);
  const chapPages = {};
  chapters.forEach(c => { chapPages[c.id] = sortedPages.filter(p => p.chapter_id === c.id); });
  const lastReadSlug = localStorage.getItem('cigcig_book_last_page_' + slug);
  const lastReadPage = sortedPages.find(p => p.slug === lastReadSlug);
  const resumeHTML = lastReadPage ? `<div class="resume-card" style="margin-bottom:20px;padding:18px 20px;border:1px solid var(--border);border-radius:16px;background:rgba(59,130,246,0.05);display:flex;align-items:center;justify-content:space-between;gap:12px">
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:700;color:var(--accent-red2)">Okuduğun yerde kaldın</div>
        <div style="font-size:14px;color:var(--text-primary);margin-top:6px">${escHtml(lastReadPage.page_num + '. ' + lastReadPage.title)}</div>
      </div>
      <a href="/kitap/${escHtml(slug)}/sayfa/${escHtml(lastReadPage.slug)}" data-link class="btn btn-primary btn-sm">Devam Et</a>
    </div>` : (firstPage ? `<div class="resume-card" style="margin-bottom:20px;padding:18px 20px;border:1px solid var(--border);border-radius:16px;background:rgba(59,130,246,0.05);display:flex;align-items:center;justify-content:space-between;gap:12px">
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:700;color:var(--accent-red2)">Okumaya başla</div>
        <div style="font-size:14px;color:var(--text-primary);margin-top:6px">${escHtml(firstPage.page_num + '. ' + firstPage.title)}</div>
      </div>
      <a href="/kitap/${escHtml(slug)}/sayfa/${escHtml(firstPage.slug)}" data-link class="btn btn-primary btn-sm">Oku</a>
    </div>` : '');

  const chapListHTML = chapters.map(c => `
    <div class="chapter-item">
      <div class="chapter-title"><i class="fas fa-bookmark" style="color:var(--accent-red);font-size:12px"></i> ${escHtml(c.title)}
        ${isOwner ? `<button class="btn btn-ghost btn-sm del-chapter" data-id="${c.id}" style="float:right;padding:0 6px;color:var(--accent-red2)"><i class="fas fa-trash"></i></button>` : ''}
      </div>
      ${(chapPages[c.id] || []).map(p => pageItemHTML(p, slug)).join('')}
    </div>`).join('');

  const unassignedHTML = unassigned.map(p => pageItemHTML(p, slug)).join('');

  // İsimsiz kitap hatırlatma banner'ı
  const unnamedBannerHTML = (isOwner && book.is_unnamed) ? `
    <div id="unnamed-book-reminder" style="
      margin-bottom:18px;
      background:linear-gradient(135deg,rgba(234,179,8,0.15),rgba(249,115,22,0.10));
      border:1.5px solid rgba(234,179,8,0.45);
      border-radius:14px;
      padding:16px 18px;
      display:flex;
      align-items:center;
      gap:14px;
      animation:unnamedPulse 0.7s ease 2;
    ">
      <div style="flex-shrink:0;width:42px;height:42px;border-radius:50%;background:rgba(234,179,8,0.18);display:flex;align-items:center;justify-content:center;font-size:20px">
        ⏰
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-size:14px;font-weight:700;color:#facc15;margin-bottom:3px">Bu kitabın henüz ismi yok!</div>
        <div style="font-size:12px;color:rgba(255,255,255,0.55)">İsim ekleyene kadar sadece sen görebilirsin. Herkese açmak için bir isim koy.</div>
      </div>
      <button id="unnamed-add-name-btn" class="btn btn-sm" style="
        flex-shrink:0;
        background:linear-gradient(135deg,#ca8a04,#92400e);
        color:#fff;
        border:none;
        white-space:nowrap;
        font-weight:700;
      "><i class="fas fa-tag"></i> İsim Ekle</button>
    </div>
  ` : '';

  app.innerHTML = `<div class="container page">
    <style>
      @keyframes unnamedPulse {
        0%   { box-shadow: 0 0 0 0 rgba(234,179,8,0.5); }
        50%  { box-shadow: 0 0 0 10px rgba(234,179,8,0); }
        100% { box-shadow: 0 0 0 0 rgba(234,179,8,0); }
      }
    </style>
    ${unnamedBannerHTML}
    <div class="book-detail-header">
      <div class="book-detail-cover">
        ${book.cover_image ? `<img src="${escHtml(book.cover_image)}" alt="" />` : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:var(--bg-card2)"><i class="fas fa-book" style="font-size:40px;color:var(--text-muted)"></i></div>`}
      </div>
      <div class="book-detail-info">
        <div class="book-detail-title">${book.is_unnamed ? '<span style="color:rgba(255,255,255,0.3);font-style:italic">İsimsiz Kitap</span>' : escHtml(book.title)} ${book.is_hidden ? '<span style="margin-left:8px;display:inline-block;padding:4px 8px;background:#6b6b6b;color:var(--accent-red2);border-radius:6px;font-size:11px;font-weight:700"><i class="fas fa-lock"></i> GİZLİ</span>' : ''}</div>
        ${(book.author || book.username) ? `<div style="font-size:15px;color:var(--text-secondary);margin-bottom:10px;display:flex;align-items:center;gap:6px"><i class="fas fa-pen" style="color:var(--accent-red);font-size:12px"></i> <span style="font-weight:600">${escHtml(book.author || book.username)}</span></div>` : ''}
        <div class="book-detail-meta">
          <span>${avatarImg(book, 'avatar-sm')} ${userDisplayName(book)}</span>
          <span><i class="fas fa-file-alt"></i> ${book.page_count || 0} sayfa</span>
          ${book.created_at ? `<span><i class="fas fa-calendar"></i> ${formatDate(book.created_at)}</span>` : ''}
          ${book.updated_at ? `<span><i class="fas fa-edit"></i> Güncellendi ${formatDate(book.updated_at)}</span>` : ''}
        </div>
        ${book.preface ? `<div class="book-preface"><strong>Tanıtım / Önsöz</strong><p>${escHtml(book.preface)}</p></div>` : ''}
        ${book.karakterler ? `<div class="book-preface"><strong>Karakterler</strong><p>${escHtml(book.karakterler)}</p></div>` : ''}
        ${book.kadro ? `<div class="book-preface"><strong>Kadro</strong><p>${escHtml(book.kadro)}</p></div>` : ''}
        ${firstPage ? `<div style="margin-top:16px"><a href="/kitap/${escHtml(slug)}/sayfa/${escHtml(firstPage.slug)}" data-link class="btn btn-primary btn-sm"><i class="fas fa-book-reader"></i> Oku</a></div>` : ''}
        ${isOwner ? `<div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">
          <button class="btn btn-outline btn-sm" id="edit-book-btn"><i class="fas fa-edit"></i> Düzenle</button>
          <button class="btn btn-primary btn-sm" id="add-page-btn"><i class="fas fa-plus"></i> Sayfa Ekle</button>
          <button class="btn btn-outline btn-sm" id="add-chap-btn"><i class="fas fa-folder-plus"></i> Bölüm Ekle</button>
          <button class="btn btn-danger btn-sm" id="del-book-btn"><i class="fas fa-trash"></i> Sil</button>
        </div>` : ''}
      </div>
    </div>
    <div class="chapters-list">
      ${resumeHTML}
      ${!chapters.length && !pages.length ? '<div class="empty-state"><i class="fas fa-file-alt"></i><p>Henüz sayfa yok.</p></div>' : ''}
      ${unassignedHTML}
      ${chapListHTML}
    </div>
  </div>`;

  if (isOwner) {
    $('#edit-book-btn').addEventListener('click', () => showNewBookModal(book));
    $('#del-book-btn').addEventListener('click', async () => {
      if (!confirm('Kitabı ve tüm sayfalarını silmek istediğinize emin misiniz?')) return;
      try { await api('/book/' + slug, { method: 'DELETE' }); toast('Kitap silindi'); navigate('/kitaplar'); } catch (e) { toast(e.message, 'error'); }
    });
    $('#add-page-btn').addEventListener('click', () => showAddPageModal(slug, chapters));
    $('#add-chap-btn').addEventListener('click', () => showAddChapterModal(slug));
    document.querySelectorAll('.del-chapter').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        if (!confirm('Bölümü silmek istediğinize emin misiniz?')) return;
        try { await api(`/book/${slug}/chapter/${btn.dataset.id}`, { method: 'DELETE' }); toast('Bölüm silindi'); renderRoute(location.pathname); } catch (e) { toast(e.message, 'error'); }
      });
    });

    // İsimsiz kitap: "İsim Ekle" butonu ve her-dakika hatırlatma
    if (book.is_unnamed) {
      $('#unnamed-add-name-btn')?.addEventListener('click', () => showNewBookModal(book));

      // Her 60 saniyede bir banner'ı pulse et ve mini toast göster
      if (_unnamedReminderInterval) clearInterval(_unnamedReminderInterval);
      _unnamedReminderInterval = setInterval(() => {
        _showUnnamedPulse();
        toast('⏰ Kitabının henüz ismi yok! İsim ekleyene kadar gizli kalıyor.', 'error');
      }, 60000);
    } else {
      // Kitaba isim eklendiyse temizle
      if (_unnamedReminderInterval) { clearInterval(_unnamedReminderInterval); _unnamedReminderInterval = null; }
    }
  }

  $('#download-pdf-btn')?.addEventListener('click', async () => {
    toast('PDF hazırlanıyor...', 'success');
    try {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageW = 210; const pageH = 297; const margin = 20; const contentW = pageW - margin * 2;
      let y = margin;

      function checkNewPage(needed) {
        if (y + needed > pageH - margin) { doc.addPage(); y = margin; return true; }
        return false;
      }

      function addText(text, size, bold, color, centerX) {
        doc.setFontSize(size);
        doc.setFont('helvetica', bold ? 'bold' : 'normal');
        if (color) doc.setTextColor(...color); else doc.setTextColor(30, 30, 30);
        const lines = doc.splitTextToSize(text || '', contentW);
        const lineH = size * 0.45;
        lines.forEach(line => {
          checkNewPage(lineH + 2);
          if (centerX) {
            doc.text(line, pageW / 2, y, { align: 'center' });
          } else {
            doc.text(line, margin, y);
          }
          y += lineH;
        });
        y += 3;
      }

      // ===== KAPAK SAYFASI =====
      // Kitap kapak görseli
      if (book.cover_image) {
        try {
          const imgRes = await fetch(book.cover_image);
          const imgBlob = await imgRes.blob();
          const imgData = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => resolve(e.target.result);
            reader.onerror = reject;
            reader.readAsDataURL(imgBlob);
          });
          // Kapak: sayfanın üst yarısına ortala
          const coverW = 90; const coverH = 120;
          const coverX = (pageW - coverW) / 2;
          doc.addImage(imgData, 'JPEG', coverX, 20, coverW, coverH);
          y = 20 + coverH + 12;
        } catch {
          y = 60;
        }
      } else {
        y = 80;
      }

      // Kitap başlığı (ortada, büyük)
      doc.setFontSize(26);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 30, 30);
      const titleLines = doc.splitTextToSize(book.title, contentW);
      titleLines.forEach(line => {
        checkNewPage(12);
        doc.text(line, pageW / 2, y, { align: 'center' });
        y += 11;
      });
      y += 6;

      // Yazar adı (kapak altında)
      doc.setFontSize(14);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 100, 100);
      doc.text((book.author || book.username || 'Bilinmiyor'), pageW / 2, y, { align: 'center' });
      y += 8;

      // Sayfa sayısı
      doc.setFontSize(11);
      doc.setTextColor(150, 150, 150);
      doc.text(book.page_count + ' sayfa', pageW / 2, y, { align: 'center' });
      y += 10;

      // Çizgi
      doc.setDrawColor(200, 50, 50);
      doc.line(margin, y, pageW - margin, y);
      y += 8;

      // Önsöz (içindekiler yok)
      if (book.preface) {
        checkNewPage(20);
        addText('ÖNSÖZ', 14, true, [180, 30, 30]);
        addText(book.preface, 11, false, [40, 40, 40]);
        y += 4;
        doc.setDrawColor(220, 80, 80);
        doc.line(margin, y, pageW - margin, y);
        y += 8;
      }

      // Sayfaları yükle ve ekle
      const allPagesData = await api('/book/' + slug);
      const allP = (allPagesData.pages || []).sort((a, b) => (a.page_num || 0) - (b.page_num || 0));

      for (const p of allP) {
        try {
          const pd = await api('/book/' + slug + '/page/' + p.slug);
          const pg = pd.page;
          // Her sayfa yeni bir PDF sayfasında başlasın
          doc.addPage(); y = margin;

          // Sayfa numarası (küçük, gri)
          doc.setFontSize(9);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(170, 170, 170);
          doc.text('Sayfa ' + pg.page_num, margin, y);
          y += 6;

          // Sayfa başlığı (bozulmadan, tam satırlar)
          doc.setFontSize(16);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(30, 30, 30);
          const pgTitleLines = doc.splitTextToSize(pg.title || '', contentW);
          pgTitleLines.forEach(line => {
            doc.text(line, margin, y);
            y += 8;
          });
          y += 2;

          // Başlık altı çizgi
          doc.setDrawColor(220, 80, 80);
          doc.line(margin, y, pageW - margin, y);
          y += 7;

          // İçerik (sayfa bitmeden bölünmez, satır satır eklenir)
          doc.setFontSize(11);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(40, 40, 40);
          const contentLines = doc.splitTextToSize(pg.content || '', contentW);
          const lineH = 5.2;
          contentLines.forEach(line => {
            if (y + lineH > pageH - margin) { doc.addPage(); y = margin; }
            doc.text(line, margin, y);
            y += lineH;
          });

          // Sayfa alt notu
          doc.setFontSize(9);
          doc.setTextColor(180, 180, 180);
          doc.text(book.title + ' — ' + (book.author || book.username || ''), pageW / 2, pageH - 10, { align: 'center' });
        } catch {}
      }

      doc.save(book.title.replace(/[^a-zA-Z0-9\sğüşıöçĞÜŞİÖÇ]/g, '').trim() + '.pdf');
      toast('PDF indirildi!', 'success');
    } catch (e) { toast('PDF oluşturulamadı: ' + e.message, 'error'); }
  });
}

function pageItemHTML(p, bookSlug) {
  const canEdit = currentUser && !!bookSlug;
  return `<div class="page-item">
    <a href="/kitap/${escHtml(bookSlug)}/sayfa/${escHtml(p.slug)}" data-link class="page-title">${escHtml(p.title)}</a>
  </div>`;
}

async function showAddPageModal(bookSlug, chapters) {
  // Önce mevcut sayfa sayısını al
  let pageCount = 0;
  try {
    const data = await api('/book/' + bookSlug);
    pageCount = data.book.page_count || 0;
  } catch {}

  const chapOptions = chapters.map(c => `<option value="${c.id}">${escHtml(c.title)}</option>`).join('');
  showModal('Yeni Sayfa', `
    <div style="background:var(--bg-card2);border-radius:8px;padding:10px 14px;margin-bottom:16px;font-size:13px;color:var(--text-secondary)">
      <i class="fas fa-info-circle" style="color:var(--accent-red)"></i>
      Bu sayfa <strong style="color:var(--text-primary)">${pageCount + 1}. sayfa</strong> olarak eklenecek
    </div>
    <div class="form-group"><label>Sayfa Başlığı</label><input id="pg-title" type="text" placeholder="Sayfa başlığı..." /></div>
    ${chapters.length ? `<div class="form-group"><label>Bölüm (opsiyonel)</label><select id="pg-chap"><option value="">-- Bölüm seçin --</option>${chapOptions}</select></div>` : ''}
    <div class="form-group">
      <label>Kapak/Görsel (opsiyonel)</label>
      <input type="file" id="pg-image-file" accept="image/*" style="margin-bottom:8px" />
      <div id="pg-image-preview" style="display:none"></div>
    </div>
    <div class="form-group"><label>İçerik</label><textarea id="pg-content" rows="14" placeholder="Sayfanın içeriğini buraya yazın..."></textarea></div>
    <button class="btn btn-primary" id="pg-submit" style="width:100%">Ekle</button>
    <div id="pg-error" class="form-error mt-4"></div>
  `);

  $('#pg-image-file').addEventListener('change', e => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const prev = $('#pg-image-preview');
      prev.style.display = 'block';
      prev.innerHTML = `<img src="${ev.target.result}" style="width:100%;max-height:200px;object-fit:cover;border-radius:8px;margin-top:4px" />`;
    };
    reader.readAsDataURL(file);
  });

  $('#pg-submit').addEventListener('click', async () => {
    const title = $('#pg-title').value.trim();
    const content = $('#pg-content').value.trim();
    if (!title || !content) { $('#pg-error').textContent = 'Başlık ve içerik zorunlu'; return; }
    const chapter_id = $('#pg-chap')?.value || null;
    try {
      let image_url = '';
      const imgFile = $('#pg-image-file').files[0];
      if (imgFile) {
        const fd = new FormData(); fd.append('file', imgFile);
        const r = await apiForm('/upload', fd);
        image_url = r.url;
      }
      await api('/book/' + bookSlug + '/pages', { method: 'POST', body: JSON.stringify({ title, content, chapter_id, image_url }) });
      toast('Sayfa eklendi'); hideModal(); renderRoute(location.pathname);
    } catch (e) { $('#pg-error').textContent = e.message; }
  });
}

function showAddChapterModal(bookSlug) {
  showModal('Yeni Bölüm', `
    <div class="form-group"><label>Bölüm Adı</label><input id="ch-title" type="text" /></div>
    <div class="form-group"><label>Sıra</label><input id="ch-order" type="number" value="0" /></div>
    <button class="btn btn-primary" id="ch-submit" style="width:100%">Ekle</button>
    <div id="ch-error" class="form-error mt-4"></div>
  `);
  $('#ch-submit').addEventListener('click', async () => {
    const title = $('#ch-title').value.trim();
    if (!title) { $('#ch-error').textContent = 'Başlık zorunlu'; return; }
    try {
      await api('/book/' + bookSlug + '/chapters', { method: 'POST', body: JSON.stringify({ title, order_num: parseInt($('#ch-order').value) || 0 }) });
      toast('Bölüm eklendi'); hideModal(); renderRoute(location.pathname);
    } catch (e) { $('#ch-error').textContent = e.message; }
  });
}

async function renderPageReader(app, bookSlug, pageSlug) {
  app.innerHTML = `<div class="container page"><div class="loading-center"><div class="spinner"></div></div></div>`;
  let data;
  try { data = await api(`/book/${bookSlug}/page/${pageSlug}`); } catch (error) {
    if (error.data?.password_required) {
      app.innerHTML = `<div class="container page"><div class="book-unlock-panel"><div class="book-unlock-icon"><i class="fas fa-lock"></i></div><div class="book-unlock-kicker">ÖZEL KİTAP</div><h2>Bu kitap şifreli</h2><p>Bu sayfaya devam etmek için kitap şifresini girin.</p><div class="book-unlock-field"><i class="fas fa-key"></i><input type="password" id="book-unlock-password" placeholder="Kitap şifresi" autocomplete="off" /></div><button class="btn btn-primary" id="book-unlock-btn"><i class="fas fa-unlock"></i> Kitabın kilidini aç</button><div id="book-unlock-error" class="form-error"></div></div></div>`;
      $('#book-unlock-btn').addEventListener('click', async () => { try { await api('/book/' + bookSlug + '/unlock', { method: 'POST', body: JSON.stringify({ password: $('#book-unlock-password').value }) }); renderPageReader(app, bookSlug, pageSlug); } catch (unlockError) { $('#book-unlock-error').textContent = unlockError.message; } });
      $('#book-unlock-password').addEventListener('keydown', event => { if (event.key === 'Enter') $('#book-unlock-btn').click(); });
      return;
    }
    app.innerHTML = '<div class="container page"><div class="empty-state"><i class="fas fa-exclamation-circle"></i><p>Sayfa bulunamadı veya gizli.</p></div></div>'; return;
  }

  const { page, book, prev, next } = data;
  document.title = page.title + ' - ' + book.title;
  const isOwner = currentUser && currentUser.id === book.user_id;

  // Kitabın tüm sayfalarını al (içindekiler için)
  let allPages = [];
  try { const bd = await api('/book/' + bookSlug); allPages = bd.pages || []; } catch {}

  // Font boyutu localStorage'dan al
  let fontSize = parseInt(localStorage.getItem('ebook-font-size') || '17');

  const tocHTML = allPages.map(p => `
    <a href="/kitap/${escHtml(bookSlug)}/sayfa/${escHtml(p.slug)}" data-link
      class="ebook-toc-item${p.slug === pageSlug ? ' ebook-toc-active' : ''}"
      style="display:flex;align-items:center;gap:8px;padding:8px 16px;font-size:13px;color:${p.slug === pageSlug ? 'var(--accent-red2)' : 'var(--text-secondary)'};background:${p.slug === pageSlug ? 'rgba(220,38,38,0.08)' : 'none'};border-left:3px solid ${p.slug === pageSlug ? 'var(--accent-red)' : 'transparent'};transition:all 0.15s;text-decoration:none">
      <span style="color:var(--text-muted);font-size:11px;min-width:20px">${p.page_num}</span>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(p.title)}</span>
    </a>`).join('');

  app.innerHTML = `<div style="max-width:960px;margin:0 auto;padding:20px">
    <!-- Breadcrumb -->
    <div class="breadcrumb" style="margin-bottom:16px">
      <a href="/kitaplar" data-link>Kitaplar</a>
      <span class="breadcrumb-sep"><i class="fas fa-chevron-right" style="font-size:10px"></i></span>
      <a href="/kitap/${escHtml(bookSlug)}" data-link>${escHtml(book.title)}</a>
      <span class="breadcrumb-sep"><i class="fas fa-chevron-right" style="font-size:10px"></i></span>
      <span>${escHtml(page.title)}</span>
    </div>

    ${isOwner ? `<div style="display:flex;gap:8px;margin-bottom:16px">
      <button class="btn btn-outline btn-sm" id="edit-page-btn"><i class="fas fa-edit"></i> Düzenle</button>
      <button class="btn btn-danger btn-sm" id="del-page-btn"><i class="fas fa-trash"></i> Sil</button>
    </div>` : ''}

    <div class="ebook-layout">
      <!-- Sol: İçindekiler -->
      <div class="ebook-toc" id="ebook-toc" style="display:none">
        <div style="padding:12px 16px;border-bottom:1px solid rgba(220,38,38,0.15);font-size:13px;font-weight:600;color:var(--text-secondary)">
          <i class="fas fa-list" style="color:var(--accent-red)"></i> İçindekiler
        </div>
        <div style="overflow-y:auto;max-height:600px">
          ${tocHTML || '<div style="padding:16px;font-size:13px;color:var(--text-muted)">Sayfa yok</div>'}
        </div>
      </div>

      <!-- Sağ: Okuyucu -->
      <div class="ebook-reader" style="flex:1">
        <!-- Toolbar -->
        <div class="ebook-toolbar">
          <button class="btn btn-ghost btn-sm" id="toc-toggle" title="İçindekiler">
            <i class="fas fa-list"></i> <span class="hidden" id="toc-label">İçindekiler</span>
          </button>
          <div class="font-size-controls" style="display:flex;align-items:center;gap:6px">
            <button id="font-dec" title="Küçük">A-</button>
            <span style="font-size:13px;color:var(--text-muted)" id="font-size-label">${fontSize}px</span>
            <button id="font-inc" title="Büyük">A+</button>
          </div>
          <div class="ebook-page-counter">${page.page_num} / ${book.page_count}</div>
        </div>

        <!-- İçerik -->
        <div class="ebook-page-content" id="ebook-content" style="font-size:${fontSize}px">
          ${page.image_url ? `<img src="${escHtml(page.image_url)}" class="ebook-page-image" alt="" />` : ''}
          <div class="book-title-heading">${escHtml(page.title)}</div>
          <div class="book-text">${escHtml(page.content.trim())}</div>
        </div>

        <!-- Alt Navigasyon -->
        <div class="ebook-nav">
          ${prev ? `<a href="/kitap/${escHtml(bookSlug)}/sayfa/${escHtml(prev.slug)}" data-link class="ebook-nav-btn">
            <i class="fas fa-arrow-left"></i>
            <div><div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px">Önceki</div><div style="font-size:13px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(prev.title)}</div></div>
          </a>` : `<div></div>`}
          <div class="ebook-page-counter">${page.page_num} / ${book.page_count}</div>
          ${next ? `<a href="/kitap/${escHtml(bookSlug)}/sayfa/${escHtml(next.slug)}" data-link class="ebook-nav-btn" style="text-align:right;justify-content:flex-end">
            <div><div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px">Sonraki</div><div style="font-size:13px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(next.title)}</div></div>
            <i class="fas fa-arrow-right"></i>
          </a>` : `<div></div>`}
        </div>
      </div>
    </div>
  </div>`;

  localStorage.setItem('cigcig_book_last_page_' + bookSlug, pageSlug);

  // Font boyutu kontrolleri
  const contentEl = $('#ebook-content');
  $('#font-dec').addEventListener('click', () => {
    if (fontSize > 12) { fontSize--; contentEl.style.fontSize = fontSize + 'px'; $('#font-size-label').textContent = fontSize + 'px'; localStorage.setItem('ebook-font-size', fontSize); }
  });
  $('#font-inc').addEventListener('click', () => {
    if (fontSize < 26) { fontSize++; contentEl.style.fontSize = fontSize + 'px'; $('#font-size-label').textContent = fontSize + 'px'; localStorage.setItem('ebook-font-size', fontSize); }
  });

  // İçindekiler toggle
  const tocEl = $('#ebook-toc');
  const layout = document.querySelector('.ebook-layout');
  let tocOpen = window.innerWidth >= 900;
  function updateToc() {
    if (tocOpen) {
      tocEl.style.display = 'flex';
      tocEl.style.flexDirection = 'column';
      layout.style.gap = '0';
    } else {
      tocEl.style.display = 'none';
    }
  }
  updateToc();
  $('#toc-toggle').addEventListener('click', () => { tocOpen = !tocOpen; updateToc(); });

  if (isOwner) {
    $('#edit-page-btn').addEventListener('click', () => {
      showModal('Sayfayı Düzenle', `
        <div class="form-group"><label>Başlık</label><input id="ep-title" type="text" value="${escHtml(page.title)}" /></div>
        <div class="form-group"><label>İçerik</label><textarea id="ep-content" rows="14">${escHtml(page.content)}</textarea></div>
        <button class="btn btn-primary" id="ep-submit" style="width:100%">Kaydet</button>
        <div id="ep-error" class="form-error mt-4"></div>
      `);
      $('#ep-submit').addEventListener('click', async () => {
        const title = $('#ep-title').value.trim();
        const content = $('#ep-content').value.trim();
        if (!title || !content) { $('#ep-error').textContent = 'Zorunlu alan'; return; }
        try {
          await api(`/book/${bookSlug}/page/${pageSlug}`, { method: 'PUT', body: JSON.stringify({ title, content }) });
          toast('Sayfa güncellendi'); hideModal(); renderRoute(location.pathname);
        } catch (e) { $('#ep-error').textContent = e.message; }
      });
    });
    $('#del-page-btn').addEventListener('click', async () => {
      if (!confirm('Sayfa silinsin mi?')) return;
      try { await api(`/book/${bookSlug}/page/${pageSlug}`, { method: 'DELETE' }); toast('Sayfa silindi'); navigate('/kitap/' + bookSlug); } catch (e) { toast(e.message, 'error'); }
    });
  }
}

async function renderGroupList(app) {
  document.title = 'Gruplar - ' + siteName;
  app.innerHTML = `
    <div class="container page">
      <div class="page-header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
        <div><div class="page-title">Gruplar</div><div class="page-subtitle">Topluluğa katıl</div></div>
        ${currentUser ? `<button class="btn btn-primary" id="new-group-btn"><i class="fas fa-plus"></i> Yeni Grup</button>` : ''}
      </div>
      <div id="join-invite-section" style="margin-bottom:16px">
        ${currentUser ? `<div style="display:flex;gap:8px;max-width:400px">
          <input id="invite-code-input" type="text" placeholder="Davet kodu ile katıl..." />
          <button class="btn btn-outline" id="join-invite-btn">Katıl</button>
        </div>` : ''}
      </div>
      <div class="search-bar" style="margin-bottom:24px"><i class="fas fa-search"></i><input type="text" id="group-search" placeholder="Grup ara (isim veya açıklama)..." /></div>
      <div id="groups-grid" class="groups-grid"><div class="loading-center"><div class="spinner"></div></div></div>
    </div>`;

  if (currentUser) {
    $('#new-group-btn')?.addEventListener('click', () => showNewGroupModal());
    $('#join-invite-btn')?.addEventListener('click', async () => {
      const code = $('#invite-code-input').value.trim();
      if (!code) return;
      try { await api('/group/join-invite', { method: 'POST', body: JSON.stringify({ invite_code: code }) }); toast('Gruba katıldınız!'); renderRoute(location.pathname); } catch (e) { toast(e.message, 'error'); }
    });
  }

  let groups = [];
  try { groups = await api('/groups'); } catch {}

  function renderGroups(list) {
    const el = $('#groups-grid');
    if (!el) return;
    if (!list.length) { el.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><i class="fas fa-users"></i><p>Grup bulunamadı.</p></div>'; return; }
    el.innerHTML = list.map(g => groupCardHTML(g)).filter(Boolean).join('') || '<div class="empty-state" style="grid-column:1/-1"><i class="fas fa-users"></i><p>Grup bulunamadı.</p></div>';
  }

  renderGroups(groups);

  $('#group-search')?.addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    renderGroups(groups.filter(g => g.name.toLowerCase().includes(q) || (g.description || '').toLowerCase().includes(q)));
  });
}

function formatRemainingDuration(ms) {
  const totalMinutes = Math.max(1, Math.ceil(ms / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days) return `${days} gün${hours ? ` ${hours} saat` : ''}${minutes && !hours ? ` ${minutes} dakika` : ''}`;
  if (hours) return `${hours} saat${minutes ? ` ${minutes} dakika` : ''}`;
  return `${minutes} dakika`;
}

function groupCardHTML(g) {
  const visibility = g.visibility || (g.type === 'private' ? 'private' : g.invite_only ? 'invite' : 'public');
  if (visibility === 'private' && !g.is_member) return '';
  const coverUrl = g.cover_image || g.banner_image || '';
  let typeBadge = `<span class="badge badge-green"><i class="fas fa-globe"></i> Herkese açık</span>`;
  if (visibility === 'invite') {
    typeBadge = `<span class="badge badge-orange"><i class="fas fa-key"></i> Kod ile katılım</span>`;
  } else if (visibility === 'private') {
    typeBadge = `<span class="badge badge-red"><i class="fas fa-lock"></i> Gizli grup</span>`;
  }
  return `<div class="group-card" onclick="navigate('/grup/${escHtml(g.slug)}')">
    <div class="group-cover">
      ${coverUrl ? `<img src="${escHtml(coverUrl)}" alt="" />` : `<div class="group-cover-placeholder"><i class="fas fa-users"></i></div>`}
    </div>
    <div class="group-info">
      <div class="group-name">${escHtml(g.name)}</div>
      <div class="group-desc">${escHtml(g.description || '')}</div>
      <div class="group-meta">
        ${typeBadge}
        ${g.is_member ? '<span class="group-member-status"><i class="fas fa-check"></i> Üyesiniz</span>' : ''}
        <span class="forum-meta-item"><i class="fas fa-users" style="color:var(--accent-red)"></i> ${g.member_count}</span>
      </div>
    </div>
  </div>`;
}

function showNewGroupModal() {
  showModal('Yeni Grup', `
    <div class="form-group"><label>Grup Adı</label><input id="gr-name" type="text" /></div>
    <div class="form-group"><label>Açıklama</label><textarea id="gr-desc" rows="3"></textarea></div>
    <div class="form-group">
      <label>Banner Resmi (opsiyonel)</label>
      <input type="file" id="gr-banner-file" accept="image/*" style="margin-bottom:8px" />
      <div id="gr-banner-preview" style="display:none"></div>
    </div>
    <div class="form-group">
      <label>Kapak Resmi (opsiyonel)</label>
      <input type="file" id="gr-cover-file" accept="image/*" style="margin-bottom:8px" />
      <div id="gr-cover-preview" style="display:none"></div>
    </div>
    <div class="form-group"><label>Bu tür</label><select id="gr-visibility"><option value="public">Herkese açık · Herkes direkt katılabilir</option><option value="private">Gizli · Listelerde görünmez, kod ile girilir</option></select></div>
    <div class="form-group">
      <label class="checkbox-label"><input type="checkbox" id="gr-chat" checked /> Sohbete izin ver</label>
      <label class="checkbox-label" style="margin-top:8px"><input type="checkbox" id="gr-photos" checked /> Fotoğrafa izin ver</label>
    </div>
    <button class="btn btn-primary" id="gr-submit" style="width:100%">Oluştur</button>
    <div id="gr-error" class="form-error mt-4"></div>
  `);

  $('#gr-banner-file').addEventListener('change', e => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const prev = $('#gr-banner-preview');
      prev.outerHTML = `<img id="gr-banner-preview" src="${ev.target.result}" style="width:100%;max-height:120px;object-fit:cover;border-radius:8px" />`;
    };
    reader.readAsDataURL(file);
  });

  $('#gr-cover-file').addEventListener('change', e => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const prev = $('#gr-cover-preview');
      prev.outerHTML = `<img id="gr-cover-preview" src="${ev.target.result}" style="width:100%;max-height:120px;object-fit:cover;border-radius:8px" />`;
    };
    reader.readAsDataURL(file);
  });

  $('#gr-submit').addEventListener('click', async () => {
    const name = $('#gr-name').value.trim();
    if (!name) { $('#gr-error').textContent = 'İsim zorunlu'; return; }
    try {
      let banner_image = '';
      let cover_image = '';
      const bannerFile = $('#gr-banner-file').files[0];
      if (bannerFile) {
        const fd = new FormData(); fd.append('file', bannerFile);
        const r = await apiForm('/upload', fd);
        banner_image = r.url;
      }
      const coverFile = $('#gr-cover-file').files[0];
      if (coverFile) {
        const fd = new FormData(); fd.append('file', coverFile);
        const r = await apiForm('/upload', fd);
        cover_image = r.url;
      }
      const visibility = $('#gr-visibility').value;
      const g = await api('/groups', { method: 'POST', body: JSON.stringify({ name, description: $('#gr-desc').value.trim(), cover_image, banner_image, visibility, allow_chat: $('#gr-chat').checked, allow_photos: $('#gr-photos').checked }) });
      toast('Grup oluşturuldu'); hideModal(); navigate('/grup/' + g.slug);
    } catch (e) { $('#gr-error').textContent = e.message; }
  });
}

let chatPollInterval = null;

async function renderGroupDetail(app, slug) {
  if (chatPollInterval) { clearInterval(chatPollInterval); chatPollInterval = null; }
  app.innerHTML = `<div class="container page"><div class="loading-center"><div class="spinner"></div></div></div>`;

  let groupData, members = [], messages = [];
  try {
    groupData = await api('/group/' + slug);
    members = await api('/group/' + slug + '/members');
    try { messages = await api('/group/' + slug + '/messages'); } catch {}
  } catch (error) {
    const status = error.data?.group_status;
    if (status === 'suspended' || status === 'banned' || status === 'member_banned') {
      const title = status === 'banned' ? 'Bu grup yasaklandı' : status === 'member_banned' ? 'Bu gruba erişiminiz yasaklandı' : 'Bu grup askıya alındı';
      app.innerHTML = `<div class="container page"><div class="empty-state group-moderation-notice"><i class="fas fa-${status === 'suspended' ? 'pause-circle' : 'ban'}"></i><h2>${title}</h2><p>${escHtml(error.data.reason || error.message)}</p><a href="/gruplar" data-link class="btn btn-outline">Gruplara dön</a></div></div>`;
    } else {
      app.innerHTML = '<div class="container page"><div class="empty-state"><i class="fas fa-exclamation-circle"></i><p>Grup bulunamadı.</p></div></div>';
    }
    return;
  }

  if (currentUser && members.length) {
    try {
      const friends = await api('/friends');
      const friendSet = new Set(friends.map(f => f.other_username));
      members = members.map(m => ({ ...m, is_friend: friendSet.has(m.username) }));
    } catch {}
  }

  const { group, isMember, role, joinRequestStatus } = groupData;
  document.title = group.name + ' - ' + siteName;
  const isOwner = currentUser && currentUser.id === group.owner_id;
  const isMod = role === 'moderator';
  const visibility = group.visibility || (group.type === 'private' ? 'private' : group.invite_only ? 'invite' : 'public');
  const isOpenGroup = visibility === 'public';
  const currentGroupMember = currentUser ? members.find(m => Number(m.user_id) === Number(currentUser.id)) : null;
  const mutedUntil = currentGroupMember && currentGroupMember.muted_until ? new Date(currentGroupMember.muted_until) : null;
  const isMuted = !!(mutedUntil && mutedUntil > new Date());
  const mutedRemainingText = isMuted ? formatRemainingDuration(mutedUntil.getTime() - Date.now()) : '';
  const canSend = currentUser && isMember && group.allow_chat && !isMuted;
  const heroBanner = group.banner_image || group.cover_image || '';
  const previewCover = group.cover_image || group.banner_image || '';

  // Üye olmayan kullanıcılar için önizleme sayfası göster
  if (!isMember && !isOwner) {
    const hasPending = joinRequestStatus && joinRequestStatus.status === 'pending';
    app.innerHTML = `<div class="container page">
      <div style="max-width:540px;margin:40px auto;text-align:center">
        ${previewCover
          ? `<img src="${escHtml(previewCover)}" style="width:100%;border-radius:var(--radius);aspect-ratio:16/6;object-fit:cover;margin-bottom:24px" alt="" />`
          : `<div style="width:100%;aspect-ratio:16/6;background:var(--bg-card2);border-radius:var(--radius);display:flex;align-items:center;justify-content:center;margin-bottom:24px;font-size:56px;color:var(--text-muted)"><i class="fas fa-users"></i></div>`}
        <h1 style="font-size:26px;font-weight:800;margin-bottom:10px">${escHtml(group.name)}</h1>
        ${group.description ? `<p style="color:var(--text-secondary);font-size:15px;margin-bottom:18px;line-height:1.65">${escHtml(group.description)}</p>` : ''}
        <div style="display:flex;align-items:center;justify-content:center;gap:14px;margin-bottom:24px;flex-wrap:wrap">
          ${!isOpenGroup ? `<span class="badge badge-red"><i class="fas fa-lock"></i> Özel Grup</span>` : `<span class="badge badge-green"><i class="fas fa-globe"></i> Açık Grup</span>`}
          <span style="font-size:13px;color:var(--text-muted)"><i class="fas fa-users" style="color:var(--accent-red)"></i> ${group.member_count} üye</span>
          <span style="font-size:13px;color:var(--text-muted)"><i class="fas fa-user-shield" style="color:var(--accent-red)"></i> ${escHtml(group.owner_name || '')}</span>
        </div>
        ${currentUser
          ? (isOpenGroup
              ? `<button class="btn btn-primary" id="join-preview-btn" style="min-width:160px;font-size:15px"><i class="fas fa-plus"></i> Katıl</button>`
              : hasPending
                  ? `<button class="btn btn-outline" id="request-preview-btn" style="min-width:160px;font-size:15px;opacity:0.7" disabled><i class="fas fa-clock"></i> Bekliyor</button>`
                  : `<button class="btn btn-primary" id="request-preview-btn" style="min-width:160px;font-size:15px"><i class="fas fa-paper-plane"></i> Katılma izni gönder</button>`)
          : `<a href="/giris" data-link class="btn btn-primary" style="min-width:160px;font-size:15px"><i class="fas fa-sign-in-alt"></i> Giriş Yap</a>`}
        <div id="group-preview-error" class="form-error mt-4" style="text-align:center"></div>
      </div>
    </div>`;

    $('#join-preview-btn')?.addEventListener('click', async () => {
      const btn = $('#join-preview-btn');
      btn.disabled = true; btn.innerHTML = '<div class="spinner" style="width:14px;height:14px;display:inline-block"></div>';
      try {
        await api('/group/' + slug + '/join', { method: 'POST' });
        toast('Gruba katıldınız!');
        renderRoute(location.pathname);
      } catch (e) {
        btn.disabled = false; btn.innerHTML = '<i class="fas fa-plus"></i> Katıl';
        $('#group-preview-error').textContent = e.message;
      }
    });

    const reqBtn = $('#request-preview-btn');
    if (reqBtn && !hasPending) {
      reqBtn.addEventListener('click', async () => {
        reqBtn.disabled = true; reqBtn.innerHTML = '<div class="spinner" style="width:14px;height:14px;display:inline-block"></div>';
        try {
          await api('/group/' + slug + '/join-request', { method: 'POST' });
          reqBtn.innerHTML = '<i class="fas fa-clock"></i> Bekliyor';
          reqBtn.classList.remove('btn-primary');
          reqBtn.classList.add('btn-outline');
          reqBtn.style.opacity = '0.7';
        } catch (e) {
          if (e.message && (e.message.includes('istek') || e.message.includes('üye'))) {
            reqBtn.innerHTML = '<i class="fas fa-clock"></i> Bekliyor';
            reqBtn.classList.remove('btn-primary');
            reqBtn.classList.add('btn-outline');
            reqBtn.style.opacity = '0.7';
          } else {
            reqBtn.disabled = false; reqBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Katılma izni gönder';
            $('#group-preview-error').textContent = e.message;
          }
        }
      });
    }
    return;
  }

  app.innerHTML = `<div class="container page">
    <div class="group-hero">
      ${heroBanner ? `<img src="${escHtml(heroBanner)}" class="group-hero-cover" alt="" />` : `<div class="group-hero-cover group-hero-cover-placeholder"><i class="fas fa-users"></i></div>`}
      <div class="group-hero-content">
        <div class="group-hero-copy">
          <div class="group-hero-eyebrow"><i class="fas fa-users"></i> TOPLULUK</div>
          <h1 class="group-hero-title">${escHtml(group.name)}</h1>
          ${group.description ? `<p class="group-hero-desc">${escHtml(group.description)}</p>` : '<p class="group-hero-desc">Grup üyeleriyle sohbet et ve paylaşımlarda bulun.</p>'}
        </div>
        <div class="group-hero-actions">
          ${!isMember && currentUser && isOpenGroup ? `<button class="btn btn-primary" id="join-btn"><i class="fas fa-plus"></i> Katıl</button>` : ''}
          ${isMember && !isOwner ? `<button class="btn btn-outline" id="leave-btn"><i class="fas fa-sign-out-alt"></i> Ayrıl</button>` : ''}
          ${isOwner ? `<button class="btn btn-outline btn-sm" id="group-settings-btn"><i class="fas fa-cog"></i> Ayarlar</button>
            <button class="btn btn-outline btn-sm" id="group-banned-btn"><i class="fas fa-ban"></i> Yasaklılar</button>
            ${(visibility === 'private' || visibility === 'invite') ? `<button class="btn btn-outline btn-sm" id="join-requests-btn"><i class="fas fa-user-plus"></i> Gelen İstekler</button>` : ''}
            ${(visibility !== 'public') ? `<button class="btn btn-outline btn-sm" id="gen-invite-btn"><i class="fas fa-history"></i> Davet Kodları</button>` : ''}` : ''}
        </div>
      </div>
    </div>
    <div class="group-detail-layout">
      <div>
        ${group.allow_chat ? `
          <div class="chat-container">
            <div id="load-more-msgs-wrap" style="text-align:center;padding:8px;display:${messages.length >= 60 ? 'block' : 'none'}">
              <button class="btn btn-outline btn-sm" id="load-more-msgs"><i class="fas fa-history"></i> Önceki Mesajlar</button>
            </div>
            <div class="chat-messages" id="chat-messages">${messages.map(m => chatMsgHTML(m, isOwner || isMod)).join('')}</div>
            ${(window._chatCanMod = isOwner || isMod, '')}
            ${canSend ? `<div class="chat-input-bar">
              ${group.allow_photos ? `<label class="btn btn-ghost btn-sm" for="chat-img-input" title="Fotoğraf ekle" style="flex-shrink:0"><i class="fas fa-image"></i></label><input id="chat-img-input" type="file" accept="image/*" style="display:none" />` : ''}
              <input id="chat-input" type="text" placeholder="Mesaj yaz..." style="flex:1;min-width:0" />
              <button class="btn btn-primary btn-sm" id="send-msg-btn" style="flex-shrink:0"><i class="fas fa-paper-plane"></i></button>
            </div>` : isMuted ? `<div style="padding:14px 12px;text-align:center;color:var(--text-muted);font-size:13px;background:rgba(255,81,81,0.08);border:1px solid rgba(255,81,81,0.18);border-radius:10px"><i class="fas fa-volume-xmark" style="font-size:18px;color:var(--accent-red2);margin-bottom:6px;display:block"></i><strong style="color:var(--accent-red2)">SUSTURULDUN</strong><div style="margin-top:6px">Kalan süre: ${escHtml(mutedRemainingText)}</div></div>` : (currentUser && !isMember ? `<div style="padding:12px;text-align:center;color:var(--text-muted);font-size:13px">Mesaj göndermek için gruba katılın.</div>` : `<div style="padding:12px;text-align:center;color:var(--text-muted);font-size:13px">Giriş yaparak katılabilirsiniz.</div>`)}
          </div>` : `<div class="card card-body" style="text-align:center;color:var(--text-muted)"><i class="fas fa-comment-slash" style="font-size:32px;margin-bottom:8px;display:block"></i>Sohbet kapatılmış.</div>`}
      </div>
      <div>
        <div class="group-sidebar-card">
          <div class="card-header"><span><i class="fas fa-info-circle" style="color:var(--accent-red)"></i> Bilgi</span></div>
          <div class="card-body" style="font-size:13px;color:var(--text-secondary)">
            <div style="margin-bottom:6px"><i class="fas fa-users"></i> ${group.member_count} üye</div>
            <div style="margin-bottom:6px">${visibility === 'private' ? '<span class="badge badge-red"><i class="fas fa-lock"></i> Gizli</span>' : visibility === 'invite' ? '<span class="badge badge-orange"><i class="fas fa-key"></i> Davetli</span>' : '<span class="badge badge-green"><i class="fas fa-globe"></i> Açık</span>'}</div>
            <div style="margin-bottom:6px"><i class="fas fa-user-shield"></i> Sahip: ${escHtml(group.owner_name || '')}</div>
            <div><i class="fas fa-calendar"></i> ${formatDate(group.created_at)}</div>
          </div>
        </div>
        <div class="group-sidebar-card">
          <div class="card-header"><span><i class="fas fa-users" style="color:var(--accent-red)"></i> Üyeler (${members.length})</span></div>
          <div style="padding:10px 12px 0">
            <input id="group-member-search" type="text" placeholder="Üye ara..." style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid var(--border);background:var(--bg-card2);color:var(--text-primary);font-size:13px" />
          </div>
          <div id="members-list">${members.map(m => memberItemHTML(m, isOwner, slug)).join('')}</div>
        </div>
      </div>
    </div>
  </div>`;
  enhanceLinkPreviews(app);

  const chatEl = $('#chat-messages');
  if (chatEl) chatEl.scrollTop = chatEl.scrollHeight;
  const chatSignature = list => list.map(message => [message.id, message.content || '', message.image_url || '', message.edited_at || '', message.deleted_for_me ? 1 : 0].join(':')).join('|');
  const messageIdToRow = id => chatEl?.querySelector(`.chat-msg[data-message-id="${CSS.escape(String(id))}"]`);
  const getChatSelectionCount = () => groupChatSelection.size;
  const updateSelectionToolbar = () => {
    const selected = [...groupChatSelection];
    const toolbar = document.getElementById('chat-selection-toolbar');
    if (!toolbar) return;
    const canDeleteEveryone = selected.length > 0 && selected.every(id => {
      const msg = messages.find(m => String(m.id) === String(id));
      return !!msg && (msg.user_id === currentUser?.id || isOwner || isMod);
    });
    const canDeleteMe = selected.length > 0 && (isOwner || isMod || selected.every(id => {
      const msg = messages.find(m => String(m.id) === String(id));
      return !!msg && (msg.user_id === currentUser?.id || msg.user_id !== currentUser?.id);
    }));
    toolbar.classList.toggle('hidden', !groupChatSelectionMode || selected.length === 0);
    const deleteEveryoneBtn = document.getElementById('chat-bulk-delete-everyone');
    const deleteMeBtn = document.getElementById('chat-bulk-delete-me');
    if (deleteEveryoneBtn) deleteEveryoneBtn.disabled = !canDeleteEveryone;
    if (deleteMeBtn) deleteMeBtn.disabled = !canDeleteMe;
    const countLabel = document.getElementById('chat-selection-count');
    if (countLabel) countLabel.textContent = `${selected.length} seçildi`;
  };
  const clearChatSelection = () => {
    groupChatSelection.clear();
    groupChatSelectionMode = false;
    document.querySelectorAll('.chat-msg-select').forEach(box => { box.checked = false; box.closest('.chat-msg')?.classList.remove('selected'); });
    updateSelectionToolbar();
  };

  const toolbar = document.createElement('div');
  toolbar.id = 'chat-selection-toolbar';
  toolbar.className = 'chat-selection-toolbar hidden';
  toolbar.innerHTML = `
    <div class="chat-selection-row">
      <span id="chat-selection-count">0 seçildi</span>
      <button class="btn btn-ghost btn-sm" id="chat-select-all" type="button"><i class="fas fa-check-square"></i> Hepsini seç</button>
      <button class="btn btn-ghost btn-sm" id="chat-clear-selection" type="button"><i class="fas fa-times"></i> İptal</button>
      <button class="btn btn-danger btn-sm" id="chat-bulk-delete-everyone" type="button" disabled><i class="fas fa-trash"></i> Herkesten sil</button>
      <button class="btn btn-outline btn-sm" id="chat-bulk-delete-me" type="button" disabled><i class="fas fa-eye-slash"></i> Benden sil</button>
    </div>
  `;
  const chatContainer = document.querySelector('.chat-container');
  if (chatContainer && !document.getElementById('chat-selection-toolbar')) {
    chatContainer.insertBefore(toolbar, chatContainer.firstChild);
  }

  toolbar.querySelector('#chat-select-all')?.addEventListener('click', () => {
    const ids = messages.filter(msg => !msg.deleted_for_me).map(msg => String(msg.id));
    groupChatSelection = new Set(ids);
    groupChatSelectionMode = true;
    document.querySelectorAll('.chat-msg-select').forEach(box => {
      const id = box.dataset.id;
      const checked = ids.includes(String(id));
      box.checked = checked;
      box.closest('.chat-msg')?.classList.toggle('selected', checked);
    });
    updateSelectionToolbar();
  });
  toolbar.querySelector('#chat-clear-selection')?.addEventListener('click', clearChatSelection);
  toolbar.querySelector('#chat-bulk-delete-me')?.addEventListener('click', async () => {
    const ids = [...groupChatSelection];
    if (!ids.length) return;
    for (const id of ids) {
      try { await api('/group/' + slug + '/messages/' + id, { method: 'DELETE' }); } catch (e) { toast(e.message, 'error'); }
    }
    clearChatSelection();
    try { const fresh = await api('/group/' + slug + '/messages'); const chatEl2 = $('#chat-messages'); if (chatEl2) { chatEl2.innerHTML = fresh.map(m => chatMsgHTML(m, isOwner || isMod)).join(''); enhanceLinkPreviews(chatEl2); } messages.splice(0, messages.length, ...fresh); } catch (e) { toast(e.message, 'error'); }
  });
  toolbar.querySelector('#chat-bulk-delete-everyone')?.addEventListener('click', async () => {
    const ids = [...groupChatSelection];
    if (!ids.length) return;
    for (const id of ids) {
      const msg = messages.find(m => String(m.id) === String(id));
      if (!msg || !(msg.user_id === currentUser?.id || isOwner || isMod)) {
        toast('Sadece kendi mesajını herkesten silebilirsin veya yönetici olmalısın.', 'error');
        return;
      }
      try { await api('/group/' + slug + '/messages/' + id, { method: 'DELETE' }); } catch (e) { toast(e.message, 'error'); }
    }
    clearChatSelection();
    try { const fresh = await api('/group/' + slug + '/messages'); const chatEl2 = $('#chat-messages'); if (chatEl2) { chatEl2.innerHTML = fresh.map(m => chatMsgHTML(m, isOwner || isMod)).join(''); enhanceLinkPreviews(chatEl2); } messages.splice(0, messages.length, ...fresh); } catch (e) { toast(e.message, 'error'); }
  });
  updateSelectionToolbar();

  // Önceki mesajları yükle
  let oldestMsgId = messages.length > 0 ? messages[0].id : null;
  $('#load-more-msgs')?.addEventListener('click', async () => {
    if (!oldestMsgId) return;
    const btn = $('#load-more-msgs');
    btn.disabled = true; btn.innerHTML = '<div class="spinner" style="width:12px;height:12px;display:inline-block"></div>';
    try {
      const older = await api('/group/' + slug + '/messages?before_id=' + oldestMsgId);
      if (!older.length) { $('#load-more-msgs-wrap').style.display = 'none'; return; }
      const chatEl2 = $('#chat-messages');
      const prevHeight = chatEl2.scrollHeight;
      chatEl2.insertAdjacentHTML('afterbegin', older.map(m => chatMsgHTML(m, isOwner || isMod)).join(''));
      enhanceLinkPreviews(chatEl2);
      // Scroll pozisyonunu koru
      chatEl2.scrollTop = chatEl2.scrollHeight - prevHeight;
      oldestMsgId = older[0].id;
      if (older.length < 60) $('#load-more-msgs-wrap').style.display = 'none';
    } catch(e) { toast(e.message, 'error'); }
    finally { btn.disabled = false; btn.innerHTML = '<i class="fas fa-history"></i> Önceki Mesajlar'; }
  });

  $('#group-banned-btn')?.addEventListener('click', async () => {
    try {
      const bans = await api('/group/' + slug + '/bans');
      const content = bans.length ? bans.map(item => `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid var(--border)">
          <div style="display:flex;align-items:center;gap:10px;min-width:0;flex:1">
            ${item.avatar ? `<img src="${escHtml(item.avatar)}" style="width:34px;height:34px;border-radius:50%;object-fit:cover" alt="" />` : `<div style="width:34px;height:34px;border-radius:50%;background:var(--bg-card2);display:flex;align-items:center;justify-content:center;font-weight:700">?</div>`}
            <div style="min-width:0;flex:1">
              <div style="font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(item.username || 'Üye')}</div>
              <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${escHtml(item.reason || 'Yasak sebebi yok')}</div>
            </div>
          </div>
          <button class="btn btn-outline btn-sm revoke-ban-btn" data-user-id="${item.user_id}"><i class="fas fa-unlock"></i> Kaldır</button>
        </div>
      `).join('') : '<div class="empty-state"><i class="fas fa-ban"></i><p>Aktif yasaklı üye yok.</p></div>';
      showModal('Yasaklı Üyeler', content);
      document.querySelectorAll('.revoke-ban-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const userId = btn.dataset.userId;
          try {
            await api('/group/' + slug + '/ban/' + userId + '/revoke', { method: 'POST' });
            toast('Yasak kaldırıldı');
            hideModal();
            renderRoute(location.pathname);
          } catch (e) { toast(e.message, 'error'); }
        });
      });
    } catch (e) { toast(e.message, 'error'); }
  });

  $('#join-btn')?.addEventListener('click', async () => {
    try { await api('/group/' + slug + '/join', { method: 'POST' }); toast('Gruba katıldınız!'); renderRoute(location.pathname); } catch (e) { toast(e.message, 'error'); }
  });
  $('#leave-btn')?.addEventListener('click', async () => {
    if (!confirm('Gruptan ayrılmak istiyor musunuz?')) return;
    try { await api('/group/' + slug + '/leave', { method: 'POST' }); toast('Gruptan ayrıldınız.'); renderRoute(location.pathname); } catch (e) { toast(e.message, 'error'); }
  });

  if (canSend) {
    document.addEventListener('click', event => {
      if (!event.target.closest('.msg-menu-popover') && !event.target.closest('.msg-menu-trigger')) {
        closeOpenMessageMenu();
      }
    });
    let pendingChatImage = null;
    const attachmentPreview = document.createElement('div');
    attachmentPreview.id = 'chat-attachment-preview';
    attachmentPreview.className = 'chat-attachment-preview hidden';
    attachmentPreview.innerHTML = '<img alt="Fotoğraf önizlemesi" /><div><strong>Fotoğraf hazır</strong><small>Mesajını yazıp gönder tuşuna bas</small></div><button type="button" class="btn btn-ghost btn-sm" id="chat-attachment-remove" title="Fotoğrafı kaldır"><i class="fas fa-times"></i></button>';
    $('#chat-input')?.parentElement?.insertAdjacentElement('beforebegin', attachmentPreview);
    const prepareChatImage = file => {
      if (!file || !file.type.startsWith('image/')) return;
      pendingChatImage = file;
      const preview = attachmentPreview.querySelector('img');
      if (preview.src.startsWith('blob:')) URL.revokeObjectURL(preview.src);
      preview.src = URL.createObjectURL(file);
      attachmentPreview.classList.remove('hidden');
      const input = $('#chat-input');
      if (input) { input.placeholder = 'Fotoğrafın altına bir şey yaz...'; input.focus(); }
    };
    const resetAttachment = () => {
      pendingChatImage = null;
      attachmentPreview.classList.add('hidden');
      const preview = attachmentPreview.querySelector('img');
      if (preview.src.startsWith('blob:')) URL.revokeObjectURL(preview.src);
      preview.removeAttribute('src');
      const fileInput = $('#chat-img-input');
      if (fileInput) fileInput.value = '';
      const input = $('#chat-input');
      if (input) input.placeholder = 'Mesaj yaz...';
    };
    $('#chat-attachment-remove')?.addEventListener('click', resetAttachment);

    const suggestMention = () => {
      const input = $('#chat-input');
      if (!input) return;
      const lastWord = input.value.slice(0, input.selectionStart || 0).split(/\s+/).pop() || '';
      if (!lastWord.startsWith('@') || lastWord.length <= 1) {
        const box = $('#chat-mention-suggestions');
        if (box) box.classList.remove('visible');
        return;
      }
      const query = lastWord.slice(1).toLowerCase();
      const matches = members
        .map(m => m.username)
        .filter(Boolean)
        .filter(username => username.toLowerCase().includes(query))
        .filter((username, index, arr) => arr.indexOf(username) === index)
        .slice(0, 8);
      let box = $('#chat-mention-suggestions');
      if (!box) {
        box = document.createElement('div');
        box.id = 'chat-mention-suggestions';
        box.className = 'mention-suggestions';
        input.parentElement?.appendChild(box);
      }
      if (!matches.length) {
        box.classList.remove('visible');
        return;
      }
      box.innerHTML = matches.map(username => `<button type="button" class="mention-suggestion-item" data-username="${escHtml(username)}"><span class="mention-tag">@</span>${escHtml(username)}</button>`).join('');
      box.classList.add('visible');
      box.querySelectorAll('.mention-suggestion-item').forEach(btn => {
        btn.addEventListener('click', () => {
          const before = input.value.slice(0, input.selectionStart || 0);
          const after = input.value.slice(input.selectionStart || 0);
          const lastIndex = before.lastIndexOf(' ');
          const start = lastIndex >= 0 ? lastIndex + 1 : 0;
          const prefix = before.slice(0, start);
          input.value = prefix + '@' + btn.dataset.username + ' ' + after.trimStart();
          input.focus();
          const pos = (prefix + '@' + btn.dataset.username + ' ').length;
          input.setSelectionRange(pos, pos);
          box.classList.remove('visible');
        });
      });
    };

    const sendMsg = async () => {
      const input = $('#chat-input');
      const content = input?.value.trim();
      if (!content && !pendingChatImage) return;
      try {
        let image_url = '';
        if (pendingChatImage) {
          const fd = new FormData(); fd.append('image', pendingChatImage);
          const uploaded = await apiForm('/group/' + slug + '/upload', fd);
          image_url = uploaded.url;
        }
        const msg = await api('/group/' + slug + '/messages', { method: 'POST', body: JSON.stringify({ content, image_url }) });
        $('#chat-messages').insertAdjacentHTML('beforeend', chatMsgHTML(msg, window._chatCanMod));
        enhanceLinkPreviews(chatEl);
        messages.push(msg);
        lastChatSignature = chatSignature(messages);
        input.value = '';
        resetAttachment();
        chatEl.scrollTop = chatEl.scrollHeight;
        lastId = Number(msg.id); // Çift mesaj önleme: poll bu mesajı tekrar eklemesin
      } catch (e) { toast(e.message, 'error'); }
    };
    $('#send-msg-btn')?.addEventListener('click', sendMsg);
    $('#chat-input')?.addEventListener('input', suggestMention);
    $('#chat-input')?.addEventListener('keyup', suggestMention);
    $('#chat-input')?.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); } });
    $('#chat-input')?.addEventListener('focus', () => emojiPicker.classList.add('hidden'));

    $('#chat-img-input')?.addEventListener('change', async e => {
      prepareChatImage(e.target.files[0]);
    });
    $('#chat-input')?.addEventListener('paste', e => {
      const imageItem = [...(e.clipboardData?.items || [])].find(item => item.type.startsWith('image/'));
      const file = imageItem?.getAsFile();
      if (!file) return;
      e.preventDefault();
      prepareChatImage(file);
    });

    let lastId = messages.length ? Number(messages[messages.length - 1].id) : 0;
    let lastChatSignature = chatSignature(messages);
    chatPollInterval = setInterval(async () => {
      if (!$('#chat-messages')) { clearInterval(chatPollInterval); return; }
      try {
        const newMsgs = await api('/group/' + slug + '/messages');
        const newest = newMsgs.filter(m => Number(m.id) > lastId);
        const chatEl2 = $('#chat-messages');
        if (chatEl2 && newMsgs.length && chatSignature(newMsgs) !== lastChatSignature) {
          const wasBottom = chatEl2.scrollHeight - chatEl2.scrollTop - chatEl2.clientHeight < 60;
          const incoming = newest.filter(item => Number(item.user_id) !== Number(currentUser?.id));
          if (incoming.length && document.hidden) {
            const first = incoming[0];
            const senderName = first.username || 'Birisi';
            const preview = first.content || (first.image_url ? 'Bir fotoğraf gönderdi.' : 'Yeni grup mesajı');
            await triggerGroupMessageNotification(group.name, senderName, preview);
          }
          chatEl2.innerHTML = newMsgs.map(m => chatMsgHTML(m, window._chatCanMod)).join('');
          enhanceLinkPreviews(chatEl2);
          lastChatSignature = chatSignature(newMsgs);
          lastId = Math.max(lastId, ...newMsgs.map(m => Number(m.id)));
          if (wasBottom || newest.length) chatEl2.scrollTop = chatEl2.scrollHeight;
        }
      } catch {}
    }, 5000);
  }

  $('#chat-messages')?.addEventListener('click', async e => {
    const del = e.target.closest('.del-msg');
    const edit = e.target.closest('.edit-msg');
    const msgToggle = e.target.closest('.msg-menu-trigger');
    const selectBox = e.target.closest('.chat-msg-select');
    const chatRow = e.target.closest('.chat-msg');

    if (msgToggle) {
      closeOpenMessageMenu();
      const msgId = msgToggle.dataset.id;
      const msg = messages.find(m => String(m.id) === String(msgId));
      const isOwn = !!currentUser && Number(msg?.user_id) === Number(currentUser.id);
      const menu = document.createElement('div');
      menu.className = 'msg-menu-popover';
      menu.innerHTML = `
        <button class="msg-menu-item" data-action="select" data-id="${msgId}"><i class="fas fa-check-square"></i> Seç</button>
        ${currentUser && isOwn ? `<button class="msg-menu-item" data-action="edit" data-id="${msgId}"><i class="fas fa-pen"></i> Düzenle</button>` : ''}
        ${currentUser && (isOwn || isOwner || isMod) ? `<button class="msg-menu-item danger" data-action="delete-everyone" data-id="${msgId}"><i class="fas fa-trash"></i> Herkesten sil</button>` : ''}
        ${currentUser ? `<button class="msg-menu-item" data-action="delete-me" data-id="${msgId}"><i class="fas fa-eye-slash"></i> Benden sil</button>` : ''}
      `;
      document.body.appendChild(menu);
      const rect = msgToggle.getBoundingClientRect();
      menu.style.left = `${Math.min(window.innerWidth - 220, rect.left + 10)}px`;
      menu.style.top = `${Math.min(window.innerHeight - 180, rect.bottom + 8)}px`;
      menu.addEventListener('click', async event => {
        const item = event.target.closest('.msg-menu-item');
        if (!item) return;
        const action = item.dataset.action;
        const id = item.dataset.id;
        try {
          if (action === 'select') {
            groupChatSelectionMode = true;
            groupChatSelection.add(String(id));
            const row = messageIdToRow(id);
            row?.classList.add('selected');
            const checkbox = row?.querySelector('.chat-msg-select');
            if (checkbox) checkbox.checked = true;
            updateSelectionToolbar();
          } else if (action === 'edit') {
            const target = document.querySelector(`.edit-msg[data-id="${CSS.escape(id)}"]`);
            if (target) target.click();
          } else if (action === 'delete-me') {
            await api('/group/' + slug + '/messages/' + id, { method: 'DELETE' });
            const row = document.querySelector(`.chat-msg[data-message-id="${CSS.escape(id)}"]`);
            if (row && !row.classList.contains('own') && !(isOwner || isMod)) {
              row.outerHTML = '<div class="chat-msg deleted-for-me"><div class="chat-msg-body"><div class="chat-msg-text"><i class="fas fa-eye-slash"></i> Sadece sizden silindi</div></div></div>';
            } else if (row) row.remove();
          } else if (action === 'delete-everyone') {
            await api('/group/' + slug + '/messages/' + id, { method: 'DELETE' });
            const row = document.querySelector(`.chat-msg[data-message-id="${CSS.escape(id)}"]`);
            row?.remove();
          }
        } catch (err) { toast(err.message, 'error'); }
        closeOpenMessageMenu();
      });
      document.addEventListener('click', function closeMenu(ev) {
        if (!menu.contains(ev.target) && !msgToggle.contains(ev.target)) {
          closeOpenMessageMenu();
          document.removeEventListener('click', closeMenu);
        }
      }, { once: true });
      return;
    }

    if (selectBox) {
      const id = String(selectBox.dataset.id);
      const checked = selectBox.checked;
      const row = selectBox.closest('.chat-msg');
      if (checked) groupChatSelection.add(id); else groupChatSelection.delete(id);
      row?.classList.toggle('selected', checked);
      groupChatSelectionMode = true;
      updateSelectionToolbar();
      return;
    }

    if (chatRow && !e.target.closest('a, button, input, textarea, label, .chat-msg-select')) {
      const id = String(chatRow.dataset.messageId);
      const isSelected = groupChatSelection.has(id);
      if (groupChatSelectionMode || isSelected) {
        groupChatSelectionMode = true;
        if (isSelected) groupChatSelection.delete(id); else groupChatSelection.add(id);
        chatRow.classList.toggle('selected', !isSelected);
        const checkbox = chatRow.querySelector('.chat-msg-select');
        if (checkbox) checkbox.checked = !isSelected;
        updateSelectionToolbar();
      }
      return;
    }

    if (edit) {
      const message = edit.closest('.chat-msg');
      showModal('Mesajı düzenle', `<div class="form-group"><label>Mesaj</label><textarea id="edit-group-message" rows="5">${escHtml(edit.dataset.content || '')}</textarea></div><button class="btn btn-primary" id="save-group-message-edit" style="width:100%">Kaydet</button><div id="edit-group-message-error" class="form-error mt-4"></div>`);
      $('#save-group-message-edit').addEventListener('click', async () => {
        try { const updated = await api('/group/' + slug + '/messages/' + edit.dataset.id, { method: 'PUT', body: JSON.stringify({ content: $('#edit-group-message').value }) }); message.outerHTML = chatMsgHTML(updated, isOwner || isMod); hideModal(); toast('Mesaj düzenlendi'); } catch (error) { $('#edit-group-message-error').textContent = error.message; }
      });
      return;
    }
    if (!del) return;
    try { await api('/group/' + slug + '/messages/' + del.dataset.id, { method: 'DELETE' }); const row = del.closest('.chat-msg'); if (row?.classList.contains('own') || isOwner || isMod) row?.remove(); else if (row) row.outerHTML = '<div class="chat-msg deleted-for-me"><div class="chat-msg-body"><div class="chat-msg-text"><i class="fas fa-eye-slash"></i> Sadece sizden silindi</div></div></div>'; } catch (e) { toast(e.message, 'error'); }
  });

  $('#join-requests-btn')?.addEventListener('click', async () => {
    try {
      const requests = await api('/group/' + slug + '/join-requests');
      if (!requests.length) { showModal('Katılım İstekleri', `<div class="empty-state"><i class="fas fa-inbox"></i><p>Bekleyen istek yok.</p></div>`); return; }
      const listHTML = requests.map(r => `
        <div id="req-item-${r.id}" style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">
          ${r.avatar ? `<img src="${escHtml(r.avatar)}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;flex-shrink:0" alt="" />` : `<div style="width:36px;height:36px;border-radius:50%;background:var(--bg-card2);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-weight:700">?</div>`}
          <span style="flex:1;font-weight:600">${escHtml(r.username)}</span>
          <button class="btn btn-primary btn-sm req-accept" data-id="${r.id}" style="font-size:11px">Kabul</button>
          <button class="btn btn-outline btn-sm req-reject" data-id="${r.id}" style="font-size:11px">Reddet</button>
        </div>`).join('');
      showModal('Katılım İstekleri', `<div>${listHTML}</div>`);

      document.querySelector('.modal-body')?.addEventListener('click', async e => {
        const acceptBtn = e.target.closest('.req-accept');
        const rejectBtn = e.target.closest('.req-reject');
        const reqId = acceptBtn?.dataset.id || rejectBtn?.dataset.id;
        if (!reqId) return;
        const action = acceptBtn ? 'approve' : 'reject';
        try {
          await api(`/group/${slug}/join-request/${reqId}/respond`, { method: 'POST', body: JSON.stringify({ action }) });
          const item = document.getElementById('req-item-' + reqId);
          if (item) { item.style.opacity = '0.4'; item.querySelectorAll('button').forEach(b => b.disabled = true); item.innerHTML += `<span style="font-size:11px;color:var(--text-muted);margin-left:6px">${action === 'approve' ? '✓ Kabul edildi' : '✗ Reddedildi'}</span>`; }
        } catch (e2) { toast(e2.message, 'error'); }
      });
    } catch (e) { toast(e.message, 'error'); }
  });

  $('#join-requests-btn')?.addEventListener('click', async () => {
    try {
      const requests = await api('/group/' + slug + '/join-requests');
      if (!requests.length) {
        showModal('Gelen İstekler', `<div class="empty-state"><i class="fas fa-inbox"></i><p>Bekleyen istek yok.</p></div>`);
        return;
      }
      const listHTML = requests.map(r => `
        <div id="req-item-${r.id}" style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">
          ${r.avatar ? `<img src="${escHtml(r.avatar)}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;flex-shrink:0" alt="" />` : `<div style="width:36px;height:36px;border-radius:50%;background:var(--bg-card2);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-weight:700">?</div>`}
          <span style="flex:1;font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(r.username)}</span>
          <button class="btn btn-primary btn-sm req-accept" data-id="${r.id}" style="font-size:11px">Kabul</button>
          <button class="btn btn-outline btn-sm req-reject" data-id="${r.id}" style="font-size:11px">Reddet</button>
        </div>`).join('');
      showModal('Gelen İstekler', `<div>${listHTML}</div>`);

      document.querySelector('.modal-body')?.addEventListener('click', async e => {
        const acceptBtn = e.target.closest('.req-accept');
        const rejectBtn = e.target.closest('.req-reject');
        const reqId = acceptBtn?.dataset.id || rejectBtn?.dataset.id;
        if (!reqId) return;
        const action = acceptBtn ? 'approve' : 'reject';
        try {
          await api(`/group/${slug}/join-request/${reqId}/respond`, { method: 'POST', body: JSON.stringify({ action }) });
          const item = document.getElementById('req-item-' + reqId);
          if (item) {
            item.style.opacity = '0.4';
            item.querySelectorAll('button').forEach(b => b.disabled = true);
            item.innerHTML += `<span style="font-size:11px;color:var(--text-muted);margin-left:6px">${action === 'approve' ? '✓ Kabul edildi' : '✗ Reddedildi'}</span>`;
          }
        } catch (e2) { toast(e2.message, 'error'); }
      }, { once: true });
    } catch (e) { toast(e.message, 'error'); }
  });

  $('#gen-invite-btn')?.addEventListener('click', async () => {
    showModal('Davet Kodları', `<div id="invite-manager"><div class="loading-center"><div class="spinner"></div></div></div>`);
    const manager = $('#invite-manager');
    const renderInvites = invites => {
      const statusText = { active: 'Aktif', revoked: 'Devre dışı', expired: 'Süresi doldu', exhausted: 'Kullanım bitti' };
      const statusColor = { active: 'var(--success, #4ade80)', revoked: 'var(--accent-red2)', expired: 'var(--text-muted)', exhausted: 'var(--accent-red2)' };
      manager.innerHTML = `<div class="invite-create-panel">
        <div class="form-group"><label>Kaç kişi kullanabilsin?</label><input id="invite-max-uses" type="number" min="0" max="100000" value="0" /><div class="form-hint">0 sınırsız demektir.</div></div>
        <div class="form-group"><label>Kod kaç saat geçerli olsun?</label><input id="invite-expires-hours" type="number" min="0" max="8760" value="0" /><div class="form-hint">0 süresiz demektir.</div></div>
        <button class="btn btn-primary" id="create-invite-btn" style="width:100%"><i class="fas fa-plus"></i> Yeni kod oluştur</button><div id="invite-create-error" class="form-error mt-4"></div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin:22px 0 10px"><strong>Kod geçmişi</strong><span style="font-size:12px;color:var(--text-muted)">${invites.length} kod</span></div>
      <div class="invite-history">${invites.length ? invites.map(invite => `<div class="invite-history-row">
        <div style="min-width:0;flex:1"><code style="font-size:16px;letter-spacing:2px">${escHtml(invite.invite_code)}</code><div style="font-size:11px;color:var(--text-muted);margin-top:5px">${formatDate(invite.created_at)} · ${invite.max_uses ? `${invite.use_count}/${invite.max_uses} kullanım` : `${invite.use_count} kullanım · sınırsız`} ${invite.expires_at ? `· bitiş: ${formatDate(invite.expires_at)}` : '· süresiz'}</div></div>
        <div style="text-align:right;flex-shrink:0"><div style="color:${statusColor[invite.status]};font-size:12px;font-weight:700">${statusText[invite.status]}</div><button class="btn btn-ghost btn-sm copy-invite-btn" data-code="${escHtml(invite.invite_code)}" title="Kodu kopyala"><i class="fas fa-copy"></i></button>${invite.status === 'active' || invite.status === 'revoked' ? `<button class="btn btn-ghost btn-sm toggle-invite-btn" data-id="${invite.id}" data-active="${invite.status === 'active' ? '0' : '1'}" title="${invite.status === 'active' ? 'Devre dışı bırak' : 'Yeniden aktifleştir'}"><i class="fas fa-${invite.status === 'active' ? 'ban' : 'rotate-left'}"></i></button>` : ''}</div>
      </div>`).join('') : '<div class="empty-state"><i class="fas fa-key"></i><p>Henüz davet kodu oluşturulmamış.</p></div>'}</div>`;
      $('#create-invite-btn').addEventListener('click', async () => { try {
        const r = await api('/group/' + slug + '/invite', { method: 'POST', body: JSON.stringify({ max_uses: $('#invite-max-uses').value, expires_hours: $('#invite-expires-hours').value }) });
        toast('Davet kodu oluşturuldu');
        const updated = await api('/group/' + slug + '/invites');
        renderInvites(updated);
        const created = updated.find(item => item.invite_code === r.invite_code);
        if (created) toast('Yeni kod: ' + created.invite_code);
      } catch (e) { $('#invite-create-error').textContent = e.message; } });
      manager.querySelectorAll('.copy-invite-btn').forEach(button => button.addEventListener('click', () => { navigator.clipboard?.writeText(button.dataset.code); toast('Kopyalandı!'); }));
      manager.querySelectorAll('.toggle-invite-btn').forEach(button => button.addEventListener('click', async () => {
        try { await api(`/group/${slug}/invites/${button.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ active: button.dataset.active === '1' }) }); renderInvites(await api('/group/' + slug + '/invites')); toast(button.dataset.active === '1' ? 'Kod yeniden aktifleştirildi' : 'Kod devre dışı bırakıldı'); } catch (e) { toast(e.message, 'error'); }
      }));
    };
    try { renderInvites(await api('/group/' + slug + '/invites')); } catch (e) { manager.innerHTML = `<div class="form-error">${escHtml(e.message)}</div>`; }
  });

  $('#group-settings-btn')?.addEventListener('click', () => {
    showModal('Grup Ayarları', `
      <div class="form-group"><label>Grup Adı</label><input id="gs-name" type="text" value="${escHtml(group.name)}" /></div>
      <div class="form-group"><label>Açıklama</label><textarea id="gs-desc" rows="3">${escHtml(group.description || '')}</textarea></div>
      <div class="form-group">
        <label>Banner Resmi</label>
        <input type="file" id="gs-banner-file" accept="image/*" style="margin-bottom:8px" />
        ${group.banner_image || group.cover_image ? `<img id="gs-banner-preview" src="${escHtml(group.banner_image || group.cover_image)}" style="width:100%;max-height:120px;object-fit:cover;border-radius:8px" />` : `<div id="gs-banner-preview" style="display:none"></div>`}
      </div>
      <div class="form-group">
        <label>Kapak Resmi</label>
        <input type="file" id="gs-cover-file" accept="image/*" style="margin-bottom:8px" />
        ${group.cover_image ? `<img id="gs-cover-preview" src="${escHtml(group.cover_image)}" style="width:100%;max-height:120px;object-fit:cover;border-radius:8px" />` : `<div id="gs-cover-preview" style="display:none"></div>`}
      </div>
      <div class="form-group"><label>Bu tür</label><select id="gs-visibility"><option value="public" ${visibility === 'public' ? 'selected' : ''}>Herkese açık</option><option value="private" ${visibility === 'private' ? 'selected' : ''}>Gizli · Kod ile</option></select></div>
      <div class="form-group">
        <label class="checkbox-label"><input type="checkbox" id="gs-chat" ${group.allow_chat ? 'checked' : ''} /> Sohbet</label>
        <label class="checkbox-label" style="margin-top:8px"><input type="checkbox" id="gs-photos" ${group.allow_photos ? 'checked' : ''} /> Fotoğraf</label>
      </div>
      <button class="btn btn-primary" id="gs-submit" style="width:100%">Kaydet</button>
      <button class="btn btn-danger" id="gs-delete" style="width:100%;margin-top:8px">Grubu Sil</button>
      <div id="gs-error" class="form-error mt-4"></div>
    `);

    $('#gs-banner-file').addEventListener('change', e => {
      const file = e.target.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        const prev = $('#gs-banner-preview');
        prev.outerHTML = `<img id="gs-banner-preview" src="${ev.target.result}" style="width:100%;max-height:120px;object-fit:cover;border-radius:8px" />`;
      };
      reader.readAsDataURL(file);
    });

    $('#gs-cover-file').addEventListener('change', e => {
      const file = e.target.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        const prev = $('#gs-cover-preview');
        prev.outerHTML = `<img id="gs-cover-preview" src="${ev.target.result}" style="width:100%;max-height:120px;object-fit:cover;border-radius:8px" />`;
      };
      reader.readAsDataURL(file);
    });

    $('#gs-submit').addEventListener('click', async () => {
      try {
        let banner_image = group.banner_image || '';
        let cover_image = group.cover_image || '';
        const bannerFile = $('#gs-banner-file').files[0];
        if (bannerFile) {
          const fd = new FormData(); fd.append('file', bannerFile);
          const r = await apiForm('/upload', fd);
          banner_image = r.url;
        }
        const coverFile = $('#gs-cover-file').files[0];
        if (coverFile) {
          const fd = new FormData(); fd.append('file', coverFile);
          const r = await apiForm('/upload', fd);
          cover_image = r.url;
        }
        await api('/group/' + slug, { method: 'PUT', body: JSON.stringify({ name: $('#gs-name').value.trim(), description: $('#gs-desc').value.trim(), cover_image, banner_image, visibility: $('#gs-visibility').value, allow_chat: $('#gs-chat').checked, allow_photos: $('#gs-photos').checked }) });
        toast('Grup güncellendi'); hideModal(); renderRoute(location.pathname);
      } catch (e) { $('#gs-error').textContent = e.message; }
    });
    $('#gs-delete').addEventListener('click', async () => {
      if (!confirm('Grubu silmek istediğinize emin misiniz?')) return;
      try { await api('/group/' + slug, { method: 'DELETE' }); toast('Grup silindi'); hideModal(); navigate('/gruplar'); } catch (e) { toast(e.message, 'error'); }
    });
  });

  const groupMemberSearch = document.getElementById('group-member-search');
  groupMemberSearch?.addEventListener('input', () => {
    const q = groupMemberSearch.value.trim().toLowerCase();
    document.querySelectorAll('#members-list .member-item').forEach(item => {
      const username = (item.querySelector('div')?.textContent || '').trim().toLowerCase();
      item.style.display = !q || username.includes(q) ? '' : 'none';
    });
  });

  $('#members-list')?.addEventListener('click', async e => {
    const banBtn = e.target.closest('.ban-member');
    const modBtn = e.target.closest('.make-mod');
    const memberRow = e.target.closest('.member-item');
    if (memberRow && !e.target.closest('button') && (isOwner || isMod)) {
      const member = members.find(item => String(item.user_id) === memberRow.dataset.memberId);
      if (!member) return;
      const canManage = member.user_id !== currentUser?.id && member.role !== 'owner';
      showModal('Üye bilgileri', `<div class="group-member-detail">
        <div class="group-member-detail-head">${avatarImg(member, 'group-member-detail-avatar')}<div><strong>${escHtml(member.username)}</strong><small>${member.role === 'moderator' ? 'Moderatör' : 'Grup üyesi'}</small></div></div>
        <div class="group-member-joined"><i class="fas fa-calendar-check"></i><span>Katılım tarihi</span><b>${formatDate(member.joined_at)}</b></div>
        ${canManage ? `<div class="group-member-actions"><button class="btn btn-outline member-mute-btn" data-id="${member.user_id}"><i class="fas fa-volume-xmark"></i> Susturma süresini ayarla</button><button class="btn btn-outline member-kick-btn" data-id="${member.user_id}"><i class="fas fa-user-minus"></i> Gruptan at</button><button class="btn btn-danger member-ban-btn" data-id="${member.user_id}"><i class="fas fa-ban"></i> IP ile yasakla</button></div>` : ''}
        <div id="member-action-error" class="form-error mt-4"></div>
      </div>`);
      const actionError = $('#member-action-error');
      const targetId = member.user_id;
      document.querySelector('.member-mute-btn')?.addEventListener('click', async () => {
        showModal(`${escHtml(member.username)} susturma süresi`, `<div class="form-group"><label>Ne kadar süre susturulsun?</label><select id="member-mute-duration"><option value="10">10 dakika</option><option value="30">30 dakika</option><option value="60" selected>1 saat</option><option value="180">3 saat</option><option value="1440">1 gün</option><option value="10080">7 gün</option></select></div><button class="btn btn-primary" id="member-mute-confirm" style="width:100%"><i class="fas fa-volume-xmark"></i> Sustur</button><div id="member-mute-error" class="form-error mt-4"></div>`);
        $('#member-mute-confirm').addEventListener('click', async () => {
          const minutes = Number($('#member-mute-duration').value);
          try { await api(`/group/${slug}/mute/${targetId}`, { method: 'POST', body: JSON.stringify({ minutes }) }); hideModal(); toast(`${member.username} susturuldu`); }
          catch (error) { $('#member-mute-error').textContent = error.message; }
        });
      });
      document.querySelector('.member-kick-btn')?.addEventListener('click', async () => {
        if (!confirm(`${member.username} gruptan atılsın mı?`)) return;
        try { await api(`/group/${slug}/kick/${targetId}`, { method: 'POST' }); hideModal(); toast('Üye gruptan atıldı'); renderRoute(location.pathname); }
        catch (error) { if (actionError) actionError.textContent = error.message; }
      });
      document.querySelector('.member-ban-btn')?.addEventListener('click', async () => {
        const reason = prompt(`${member.username} için grup yasaklama nedeni:`);
        if (reason === null || !reason.trim()) return;
        if (!confirm(`${member.username} bu gruptan yasaklansın mı?`)) return;
        try { await api(`/group/${slug}/ban/${targetId}`, { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) }); hideModal(); toast('Üye bu gruptan yasaklandı'); renderRoute(location.pathname); }
        catch (error) { if (actionError) actionError.textContent = error.message; }
      });
      return;
    }
    if (banBtn && isOwner) {
      const uid = banBtn.dataset.uid;
      if (!confirm('Üyeyi gruptan at?')) return;
      try { await api(`/group/${slug}/ban/${uid}`, { method: 'POST' }); toast('Üye atıldı'); renderRoute(location.pathname); } catch (e) { toast(e.message, 'error'); }
    }
    if (modBtn && isOwner) {
      const uid = modBtn.dataset.uid;
      try { await api(`/group/${slug}/moderator/${uid}`, { method: 'POST' }); toast('Moderatör yapıldı'); renderRoute(location.pathname); } catch (e) { toast(e.message, 'error'); }
    }
  });
}

function chatMsgHTML(m, canModerate = false) {
  const isOwn = currentUser && currentUser.id === m.user_id;
  const deleteLabel = isOwn || canModerate ? 'Herkesten sil' : 'Benden sil';
  if (m.deleted_for_me) return `<div class="chat-msg deleted-for-me"><div class="chat-msg-body"><div class="chat-msg-text"><i class="fas fa-eye-slash"></i> Sadece sizden silindi</div></div></div>`;
  const profileLink = m.username ? profileRoute(m.username) : '#';
  const avatar = hasUsableAvatar(m) ? `<img src="${escHtml(m.avatar)}" class="chat-msg-avatar" alt="" />` : `<div class="chat-msg-avatar avatar-placeholder"><i class="fas fa-user"></i></div>`;
  const canAction = currentUser && (isOwn || canModerate);
  const selectBox = groupChatSelectionMode ? `<input type="checkbox" class="chat-msg-select" data-id="${m.id}" ${groupChatSelection.has(String(m.id)) ? 'checked' : ''} />` : '';
  return `<div class="chat-msg ${isOwn ? 'own' : ''}" data-message-id="${m.id}">
    ${selectBox}
    <a href="${profileLink}" data-link class="chat-msg-profile" aria-label="${escHtml(m.username || 'Silindi')} profili">${avatar}</a>
    <div class="chat-msg-body">
      <div class="chat-msg-meta">
        <span class="chat-msg-time">${timeAgo(m.created_at)}</span>
        ${m.edited_at ? '<span class="chat-msg-edited" title="Bu mesaj düzenlendi"><i class="fas fa-pen"></i></span>' : ''}
        ${currentUser ? `<button class="btn btn-ghost msg-menu-trigger" data-id="${m.id}" title="Mesaj seçenekleri" style="padding:0 4px;font-size:11px;color:var(--text-muted)"><i class="fas fa-ellipsis-v"></i></button>` : ''}
      </div>
      ${m.content ? `<div class="chat-msg-text">${renderContent(m.content)}</div>` : ''}
      ${m.image_url ? `<img src="${escHtml(m.image_url)}" class="chat-msg-img" alt="" onclick="window.open(this.src)" />` : ''}
    </div>
  </div>`;
}

function memberItemHTML(m, isOwner, groupSlug) {
  const roleLabel = m.role === 'owner' ? '<span class="badge badge-red">Sahip</span>' : m.role === 'moderator' ? '<span class="badge badge-orange">Mod</span>' : '';
  const friendBadge = m.is_friend ? '<span title="Arkadaş" style="margin-left:6px;color:var(--accent-green);font-size:13px"><i class="fas fa-user-friends"></i></span>' : '';
  const canAct = isOwner && m.role !== 'owner' && currentUser && currentUser.id !== m.user_id;
  return `<div class="member-item" data-member-id="${m.user_id}" role="button" tabindex="0">
    ${hasUsableAvatar(m) ? `<img src="${escHtml(m.avatar)}" class="member-avatar" alt="" />` : `<div class="member-avatar avatar-placeholder"><i class="fas fa-user" style="font-size:14px"></i></div>`}
    <div style="flex:1">
      <div style="font-size:13px;font-weight:600">${escHtml(m.username)}${friendBadge}</div>
      ${roleLabel}
    </div>
  </div>`;
}

function videoCardHTML(v) {
  const desc = v.description ? String(v.description).replace(/\n/g, ' ').substring(0, 100) : '';
  return `<div class="video-card" onclick="navigate('/video/${escHtml(v.slug)}')">
    <div class="video-thumb">
      ${v.banner_image ? `<img src="${escHtml(v.banner_image)}" alt="" />` : `<div class="video-thumb-placeholder"><i class="fas fa-video"></i></div>`}
    </div>
    <div class="video-card-body">
      <div class="video-card-title">${escHtml(v.title)}</div>
      <div class="video-card-meta">
        <span>${escHtml(v.username || 'Silinmiş kullanıcı')}</span>
        <span>•</span>
        <span>${v.views || 0} izlenme</span>
      </div>
      ${desc ? `<div class="video-card-desc">${escHtml(desc)}${desc.length >= 100 ? '...' : ''}</div>` : ''}
    </div>
  </div>`;
}

function realsProfileCardHTML(v) {
  const desc = v.description ? String(v.description).replace(/\n/g, ' ').substring(0, 100) : '';
  return `<div class="video-card reals-profile-card" onclick="navigate('/reals')"><div class="video-thumb">${v.banner_image ? `<img src="${escHtml(v.banner_image)}" alt="" />` : `<div class="video-thumb-placeholder"><i class="fas fa-circle-play"></i></div>`}</div><div class="video-card-body"><div class="video-card-title">${escHtml(v.title)}</div><div class="video-card-meta"><span>${escHtml(v.username || 'Silinmiş kullanıcı')}</span><span>•</span><span>${v.views || 0} izlenme</span></div>${desc ? `<div class="video-card-desc">${escHtml(desc)}${desc.length >= 100 ? '...' : ''}</div>` : ''}</div></div>`;
}

function updateVideoUploadNotice(state, percent = 0, message = 'Reals yükleniyor') {
  let notice = document.getElementById('video-upload-notice');
  if (!notice) {
    notice = document.createElement('div');
    notice.id = 'video-upload-notice';
    notice.className = 'video-upload-notice';
    notice.innerHTML = '<div class="video-upload-notice-head"><i class="fas fa-cloud-arrow-up"></i><span></span><b></b></div><div class="video-upload-notice-bar"><i></i></div>';
    document.body.appendChild(notice);
  }
  notice.className = `video-upload-notice ${state}`;
  notice.querySelector('span').textContent = message;
  notice.querySelector('b').textContent = state === 'error' ? '!' : `${percent}%`;
  notice.querySelector('.video-upload-notice-bar i').style.width = `${state === 'error' ? 100 : percent}%`;
  if (state === 'done') setTimeout(() => notice.remove(), 5000);
}

async function showNewVideoModal(existing = null, forceReals = false) {
  let videoSettings = { defaultDescription: '', uploadSuccessText: 'YÜKLENDİ', uploadSuccessDuration: '3' };
  try { videoSettings = await api('/video-settings'); } catch {}
  const defaultDescription = existing?.description || videoSettings.defaultDescription || '';
  showModal(existing ? 'Videoyu Düzenle' : (forceReals ? 'Reals Yükle' : 'Video Yükle'), `
    <div class="form-group"><label>Başlık</label><input id="video-title" type="text" value="${escHtml(existing?.title || '')}" /></div>
    <div class="form-group"><label>Açıklama</label><textarea id="video-description" rows="5">${escHtml(defaultDescription)}</textarea></div>
    <div class="form-group">
      <label>Video Dosyası</label>
      <input type="file" id="video-file" accept="video/*" />
      <video id="video-upload-preview" controls muted playsinline style="display:none;width:100%;max-height:420px;aspect-ratio:9/16;object-fit:contain;border-radius:8px;margin-top:10px;background:#000"></video>
      ${existing && existing.video_url ? `<div style="margin-top:8px;font-size:12px;color:var(--text-secondary)">Mevcut video: ${escHtml(existing.video_url)}</div>` : ''}
    </div>
    <div class="form-group">
      <label>Banner / Kapak</label>
      <input type="file" id="video-banner-file" accept="image/*" />
      <img id="video-banner-preview" alt="Kapak önizleme" style="display:none;width:100%;max-height:150px;object-fit:cover;border-radius:8px;margin-top:8px" />
      ${existing && existing.banner_image ? `<img src="${escHtml(existing.banner_image)}" style="width:100%;max-height:150px;object-fit:cover;border-radius:8px;margin-top:8px" />` : ''}
    </div>
    <div class="form-row">
      <div class="form-group"><label>Konum</label><input id="video-location" type="text" value="${escHtml(existing?.location || '')}" placeholder="Konum ekle" /></div>
      <div class="form-group"><label>Ses parçası adı</label><input id="video-sound" type="text" value="${escHtml(existing?.sound_name || '')}" placeholder="Orijinal ses" /></div>
    </div>
    <div class="form-group"><label class="checkbox-label"><input type="checkbox" id="video-comments" ${!existing || existing.allow_comments !== 0 ? 'checked' : ''} /> Yorumlara izin ver</label></div>
    <div class="form-group"><label class="checkbox-label"><input type="checkbox" id="video-likes" ${!existing || existing.show_likes !== 0 ? 'checked' : ''} /> Beğenileri göster</label></div>
    <div class="form-group"><label class="checkbox-label"><input type="checkbox" id="video-is-reals" ${existing && existing.is_reals ? 'checked' : ''} ${forceReals ? 'checked' : ''} /> Bu video Reals olsun</label></div>
    <button class="btn btn-primary" id="video-submit" style="width:100%">${existing ? 'Güncelle' : 'Yükle'}</button>
    <div id="video-upload-progress" style="margin-top:10px;display:none"></div>
    <div id="video-error" class="form-error mt-4"></div>
  `);

  const videoInput = $('#video-file');
  const bannerInput = $('#video-banner-file');
  let autoBannerFile = null;
  const getVideoDuration = file => new Promise((resolve, reject) => { const probe = document.createElement('video'); probe.preload = 'metadata'; probe.onloadedmetadata = () => { URL.revokeObjectURL(probe.src); resolve(probe.duration); }; probe.onerror = () => reject(new Error('Video süresi okunamadı')); probe.src = URL.createObjectURL(file); });

  videoInput?.addEventListener('change', async () => {
    const file = videoInput.files[0];
    if (!file) return;
    const uploadPreview = $('#video-upload-preview');
    if (uploadPreview) { uploadPreview.src = URL.createObjectURL(file); uploadPreview.style.display = 'block'; }
    if (bannerInput?.files?.length) return;
    try {
      const generated = await generateVideoPoster(file);
      autoBannerFile = generated;
    } catch {
      autoBannerFile = null;
    }
  });
  bannerInput?.addEventListener('change', () => {
    const file = bannerInput.files[0];
    const preview = $('#video-banner-preview');
    if (file && preview) { preview.src = URL.createObjectURL(file); preview.style.display = 'block'; }
  });

  $('#video-submit').addEventListener('click', async () => {
    const title = $('#video-title').value.trim();
    const description = $('#video-description').value.trim();
    const videoFile = $('#video-file').files[0];
    const bannerFile = $('#video-banner-file').files[0];
    const isReals = forceReals || $('#video-is-reals').checked;
    if (!title) { $('#video-error').textContent = 'Başlık zorunlu'; return; }
    if (!existing && !videoFile) { $('#video-error').textContent = 'Video dosyası zorunlu'; return; }
    const maxVideoSize = isReals ? 500 * 1024 * 1024 : 100 * 1024 * 1024;
    if (!existing && videoFile.size > maxVideoSize) { $('#video-error').textContent = `${isReals ? 'Reals' : 'Video'} dosyası ${isReals ? 500 : 100} MB sınırını geçemez.`; return; }
    if (!existing && isReals) { try { const duration = await getVideoDuration(videoFile); if (!Number.isFinite(duration) || duration > 180) { $('#video-error').textContent = 'Reals videoları en fazla 3 dakika olabilir. Uzun videoyu Video olarak yükleyin.'; return; } } catch { $('#video-error').textContent = 'Reals video süresi okunamadı.'; return; } }

    const submitBtn = $('#video-submit');
    const uploadFields = {
      title, description, location: $('#video-location').value.trim(), sound_name: $('#video-sound').value.trim(),
      allow_comments: $('#video-comments').checked, show_likes: $('#video-likes').checked, is_reals: $('#video-is-reals').checked
    };
    submitBtn.disabled = true; submitBtn.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px;display:inline-block"></div> Yükleniyor...';
    const progress = $('#video-upload-progress'); progress.style.display='block'; progress.innerHTML = '<div style="font-size:12px;color:var(--text-secondary)">Yükleniyor...</div>';
    updateVideoUploadNotice('uploading', 0, isReals ? 'Reals yükleniyor' : 'Video yükleniyor');
    hideModal();

    try {
      let videoUrl = existing?.video_url || '';
      let bannerImage = existing?.banner_image || '';
      if (videoFile) {
        let uploadTarget = '/api/upload';
        let uploadUrl = '';
        if (isReals) {
          const signed = await api('/reals/upload-url', { method: 'POST', body: JSON.stringify({ filename: videoFile.name, content_type: videoFile.type || 'video/mp4', content_length: videoFile.size }) });
          uploadTarget = signed.public_url;
          uploadUrl = signed.upload_url;
        }
        const xhr = new XMLHttpRequest();
        xhr.upload.addEventListener('progress', e => {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100);
            progress.innerHTML = `<div style="font-size:12px;color:var(--text-secondary)">Yükleniyor... ${pct}%</div><div style="margin-top:6px;background:var(--bg-card2);height:8px;border-radius:999px;overflow:hidden"><div style="height:100%;background:var(--grad-red);width:${pct}%"></div></div>`;
            updateVideoUploadNotice('uploading', pct, isReals ? 'Reals yükleniyor' : 'Video yükleniyor');
          }
        });
        const uploadResult = await new Promise((resolve, reject) => {
          xhr.addEventListener('load', () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              if (isReals) return resolve({});
              try { return resolve(JSON.parse(xhr.responseText)); } catch { return reject(new Error('Yanıt geçersiz')); }
            }
            try { const data = JSON.parse(xhr.responseText); reject(new Error(data.error || 'Yükleme hatası')); } catch { reject(new Error('Yükleme hatası')); }
          });
          xhr.addEventListener('error', () => reject(new Error('Yükleme hatası')));
          xhr.addEventListener('timeout', () => reject(new Error('Yükleme zaman aşımına uğradı. Dosya boyutunu küçültüp tekrar deneyin.')));
          xhr.open(isReals ? 'PUT' : 'POST', isReals ? uploadUrl : uploadTarget);
          xhr.timeout = 15 * 60 * 1000;
          if (isReals) xhr.setRequestHeader('Content-Type', videoFile.type || 'video/mp4');
          else xhr.setRequestHeader('Authorization', 'Bearer ' + (localStorage.getItem('token') || ''));
          xhr.send(isReals ? videoFile : (() => { const fd = new FormData(); fd.append('file', videoFile); return fd; })());
        });
        videoUrl = isReals ? uploadTarget : uploadResult.url;
      }
      if (bannerFile) {
        const fd = new FormData(); fd.append('file', bannerFile);
        const bannerResult = await apiForm('/upload', fd);
        bannerImage = bannerResult.url;
      } else if (autoBannerFile) {
        const fd = new FormData(); fd.append('file', autoBannerFile);
        const bannerResult = await apiForm('/upload', fd);
        bannerImage = bannerResult.url;
      }
      const payload = {
        title: uploadFields.title,
        description: uploadFields.description || '',
        video_url: videoUrl,
        banner_image: bannerImage,
        location: uploadFields.location,
        sound_name: uploadFields.sound_name,
        allow_comments: uploadFields.allow_comments,
        show_likes: uploadFields.show_likes,
        is_reals: isReals
      };
      if (existing) {
        await api('/video/' + existing.slug, { method: 'PUT', body: JSON.stringify(payload) });
        toast('Video güncellendi');
      } else {
        const created = await api('/videos', { method: 'POST', body: JSON.stringify(payload) });
        const successMs = Math.max(1000, parseInt(videoSettings.uploadSuccessDuration || 3) * 1000);
        toast(videoSettings.uploadSuccessText || 'YÜKLENDİ', 'success', successMs);
        updateVideoUploadNotice('done', 100, isReals ? 'Reals hazır' : 'Video hazır');
        navigate(isReals ? '/reals' : '/videolar');
        return;
      }
      updateVideoUploadNotice('done', 100, 'Video güncellendi');
      renderRoute(location.pathname);
    } catch (e) {
      updateVideoUploadNotice('error', 100, e.message || 'Yükleme başarısız');
      toast(e.message || 'Yükleme başarısız', 'error');
    } finally {
      submitBtn.disabled = false; submitBtn.innerHTML = existing ? 'Güncelle' : 'Yükle';
    }
  });
}

async function renderVideoList(app) {
  app.innerHTML = `<div class="container page"><div class="loading-center"><div class="spinner"></div></div></div>`;
  try {
    const videos = await api('/videos');
    document.title = 'Videolar – ' + siteName;
    updatePageMeta('Videolar – ' + siteName, 'Topluluk videolarını keşfet.', '');
    app.innerHTML = `<div class="container page">
      <div class="video-list-header">
        <div>
          <div class="page-title">Videolar</div>
          <div class="page-subtitle">Video yükle, izle, yorum yap.</div>
        </div>
        ${currentUser ? `<button class="btn btn-primary" id="new-video-btn"><i class="fas fa-plus"></i> Video Yükle</button>` : ''}
      </div>
      <div class="video-list-grid">${videos.length ? videos.map(v => videoCardHTML(v)).join('') : '<div class="empty-state" style="grid-column:1/-1"><i class="fas fa-video"></i><p>Henüz video yok.</p></div>'}</div>
    </div>`;
    $('#new-video-btn')?.addEventListener('click', () => showNewVideoModal());
  } catch {}
}

async function renderVideoDetail(app, slug) {
  app.innerHTML = `<div class="container page"><div class="loading-center"><div class="spinner"></div></div></div>`;
  let video, liked = false, saved = false, comments = [], videoSettings = { emptyDescriptionText: 'Bu videoya bir açıklama eklenmemiş.' };
  try {
    const [videoData, settingsData, commentsData, likeData, saveData] = await Promise.all([
      api('/video/' + slug).catch(() => null),
      api('/video-settings').catch(() => ({ emptyDescriptionText: 'Bu videoya bir açıklama eklenmemiş.' })),
      api('/video/' + slug + '/comments').catch(() => []),
      currentUser ? api('/video/' + slug + '/liked').catch(() => ({ liked: false })) : Promise.resolve({ liked: false }),
      currentUser ? api('/video/' + slug + '/saved').catch(() => ({ saved: false })) : Promise.resolve({ saved: false })
    ]);
    if (!videoData) throw new Error('Video bulunamadı');
    video = videoData;
    videoSettings = settingsData || videoSettings;
    comments = Array.isArray(commentsData) ? commentsData : [];
    liked = !!likeData?.liked;
    saved = !!saveData?.saved;
    api('/video/' + slug + '/view', { method: 'POST' }).catch(() => {});
  } catch {
    app.innerHTML = '<div class="container page"><div class="empty-state"><i class="fas fa-exclamation-circle"></i><p>Video bulunamadı.</p></div></div>'; return;
  }
  document.title = video.title + ' – ' + siteName;
  updatePageMeta(video.title + ' – ' + siteName, video.description || 'CigCig videoları', video.banner_image || '');
  const isOwner = currentUser && currentUser.id === video.user_id;
  let followState = false;
  if (currentUser && currentUser.username !== video.username) {
    try { const res = await api('/user/' + encodeURIComponent(video.username) + '/following'); followState = res.following; } catch {}
  }
  const descriptionText = video.description && video.description.trim() ? video.description.trim() : (videoSettings.emptyDescriptionText || 'Bu videoya bir açıklama eklenmemiş.');
  const formattedDescription = descriptionText.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" style="color:#60a5fa;text-decoration:underline">$1</a>');
  app.innerHTML = `<div class="container page">
    <div class="video-page-layout">
      <div class="video-main-column">
        <div class="video-player-card">
          <div class="video-player-shell">
            <video controls preload="none" playsinline class="video-player" poster="${escHtml(video.banner_image || '')}" id="video-player-el">
              <source src="${escHtml(video.video_url)}" />
            </video>
            <div class="video-ad-overlay hidden" id="video-ad-overlay"></div>
          </div>
        </div>
        <div class="video-comments-card">
          <div class="comments-title"><i class="fas fa-comments"></i> Yorumlar (${comments.length})</div>
          ${currentUser ? `<div class="comment-form"><textarea id="video-comment-input" placeholder="Yorum yaz..."></textarea><button class="btn btn-primary btn-sm" id="video-comment-submit"><i class="fas fa-paper-plane"></i></button></div>` : '<div class="empty-state"><i class="fas fa-sign-in-alt"></i><p>Yorum yapmak için giriş yapın.</p></div>'}
          <div id="video-comments-list">${comments.map(c => renderVideoComment(c, isOwner)).join('')}</div>
        </div>
      </div>
      <aside class="video-side-panel">
        <div class="video-meta-block">
          <div class="video-title">${escHtml(video.title)}</div>
          <div class="video-author-row">
            <a href="${profileRoute(video.username)}" data-link class="video-author-link">${avatarImg(video, 'avatar-sm')} ${userDisplayName(video)}</a>
            ${currentUser && currentUser.username !== video.username ? `<button class="btn btn-outline btn-sm" id="follow-btn">${followState ? 'Takiptesin' : 'Takip et'}</button>` : ''}
          </div>
          <div class="video-stats-row"><span><i class="fas fa-eye"></i> ${video.views || 0} izlenme</span><span><i class="fas fa-heart"></i> <span id="video-like-count">${video.like_count || 0}</span></span><span><i class="fas fa-comment"></i> ${comments.length}</span></div>
          <div class="video-actions"><button class="btn btn-outline btn-sm" id="video-like-btn"><i class="fas fa-heart"></i> Beğen</button><button class="btn btn-outline btn-sm" id="video-save-btn"><i class="fas fa-bookmark"></i> ${saved ? 'Kaydedildi' : 'Kaydet'}</button>${currentUser && currentUser.username !== video.username ? `<button class="btn btn-outline btn-sm" id="video-share-btn"><i class="fas fa-paper-plane"></i> İlet</button>` : ''}${isOwner ? `<button class="btn btn-outline btn-sm" id="video-edit-btn"><i class="fas fa-edit"></i> Düzenle</button>` : ''}${isOwner ? `<button class="btn btn-danger btn-sm" id="video-delete-btn"><i class="fas fa-trash"></i> Sil</button>` : ''}</div>
          <div class="video-description-card">
            <div class="video-description-title">Açıklama</div>
            <div class="video-description-text" id="video-description-text">${formattedDescription}</div>
          </div>
        </div>
      </aside>
    </div>
  </div>`;

  $('#video-like-btn')?.addEventListener('click', async () => {
    if (!currentUser) { navigate('/giris'); return; }
    const btn = $('#video-like-btn');
    btn.disabled = true;
    try {
      const r = await api('/video/' + slug + '/like', { method: 'POST' });
      liked = r.liked;
      const countEl = $('#video-like-count');
      const currentCount = Math.max(0, parseInt(countEl.textContent) || 0);
      countEl.textContent = currentCount + (liked ? 1 : -1);
      btn.classList.toggle('btn-primary', liked);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  const likeBtn = $('#video-like-btn');
  if (likeBtn) likeBtn.classList.toggle('btn-primary', liked);
  $('#video-save-btn')?.addEventListener('click', async () => {
    if (!currentUser) { navigate('/giris'); return; }
    try { const r = await api('/video/' + slug + '/save', { method: 'POST' }); saved = r.saved; $('#video-save-btn').innerHTML = `<i class="fas fa-bookmark"></i> ${saved ? 'Kaydedildi' : 'Kaydet'}`; } catch {}
  });

  $('#follow-btn')?.addEventListener('click', async () => {
    if (!currentUser) { navigate('/giris'); return; }
    try {
      const r = await api('/user/' + encodeURIComponent(video.username) + '/follow', { method: 'POST' });
      followState = r.following;
      $('#follow-btn').textContent = followState ? 'Takiptesin' : 'Takip et';
    } catch {}
  });

  $('#video-share-btn')?.addEventListener('click', async () => {
    if (!currentUser) { navigate('/giris'); return; }
    showForwardVideoModal(video);
  });

  try {
    const ads = await api('/video-ads');
    if (Array.isArray(ads) && ads.length) {
      const activeAds = ads.filter(a => a.active === 1 || a.active === true).sort((a, b) => (b.priority || 0) - (a.priority || 0));
      if (activeAds.length) {
        const ad = activeAds[0];
        const adEl = $('#video-ad-overlay');
        if (adEl) {
          const safeSiteUrl = normalizeExternalUrl(ad.site_url || '#');
          adEl.innerHTML = `<a href="${escHtml(safeSiteUrl)}" target="_blank" rel="noopener noreferrer" class="video-ad-link">
            ${ad.video_url ? `<video src="${escHtml(ad.video_url)}" class="video-ad-video" autoplay muted loop playsinline></video>` : ''}
            <div class="video-ad-copy"><strong>${escHtml(ad.title)}</strong><span>${escHtml(ad.site_url || '')}</span></div>
          </a>`;
          adEl.className = `video-ad-overlay hidden ${escHtml(ad.position || 'bottom-right')}`;
          const videoEl = $('#video-player-el');
          if (videoEl && ad.display_after_seconds >= 0) {
            const showOverlay = () => {
              const seconds = Math.floor(videoEl.currentTime || 0);
              if (seconds >= (ad.display_after_seconds || 0)) {
                adEl.classList.remove('hidden');
              } else {
                adEl.classList.add('hidden');
              }
            };
            videoEl.addEventListener('timeupdate', showOverlay);
            showOverlay();
          }
        }
      }
    }
  } catch (e) {
    // ads optional
  }

  $('#video-edit-btn')?.addEventListener('click', () => showNewVideoModal(video));
  $('#video-delete-btn')?.addEventListener('click', async () => { if (!confirm('Silinsin mi?')) return; try { await api('/video/' + slug, { method: 'DELETE' }); toast('Video silindi'); navigate('/videolar'); } catch(e){toast(e.message,'error');} });

  $('#video-comment-submit')?.addEventListener('click', async () => {
    const content = $('#video-comment-input').value.trim();
    if (!content) return;
    try {
      const comment = await api('/video/' + slug + '/comments', { method: 'POST', body: JSON.stringify({ content }) });
      $('#video-comments-list').insertAdjacentHTML('beforeend', renderVideoComment(comment, isOwner));
      $('#video-comment-input').value = '';
      $('.comments-title').innerHTML = `<i class="fas fa-comments"></i> Yorumlar (${$('#video-comments-list').children.length})`;
    } catch (e) { toast(e.message,'error'); }
  });

  $('#video-comments-list').addEventListener('click', async e => {
    const likeBtn = e.target.closest('.video-comment-like');
    if (likeBtn) {
      likeBtn.disabled = true;
      try {
        const r = await api('/video/' + slug + '/comments/' + likeBtn.dataset.id + '/like', { method: 'POST' });
        const c = likeBtn.querySelector('.video-comment-count');
        const currentCount = Math.max(0, parseInt(c.textContent) || 0);
        c.textContent = currentCount + (r.liked ? 1 : -1);
        likeBtn.classList.toggle('liked', r.liked);
      } catch (e) {
        toast(e.message, 'error');
      } finally {
        likeBtn.disabled = false;
      }
      return;
    }
    const editBtn = e.target.closest('.video-comment-edit');
    if (editBtn) {
      const id = editBtn.dataset.id;
      const current = editBtn.dataset.content;
      const newText = prompt('Düzenle', current);
      if (newText === null) return;
      try { const updated = await api('/video/' + slug + '/comments/' + id, { method: 'PUT', body: JSON.stringify({ content: newText.trim() }) }); editBtn.closest('.comment').querySelector('.comment-content').innerHTML = renderContent(updated.content); toast('Yorum güncellendi'); } catch (e) { toast(e.message,'error'); }
    }
    const pinBtn = e.target.closest('.video-comment-pin');
    if (pinBtn) {
      try { await api('/video/' + slug + '/comments/' + pinBtn.dataset.id + '/pin', { method: 'POST' }); toast('İşlem tamam'); renderRoute(location.pathname); } catch(e){ toast(e.message,'error'); }
    }
    const deleteBtn = e.target.closest('.video-comment-delete');
    if (deleteBtn) {
      if (!confirm('Bu yorum silinsin mi?')) return;
      try { await api('/video/' + slug + '/comments/' + deleteBtn.dataset.id, { method: 'DELETE' }); deleteBtn.closest('.comment')?.remove(); } catch (error) { toast(error.message, 'error'); }
    }
  });
}

function renderVideoComment(c, isOwner) {
  const canEdit = currentUser && (currentUser.id === c.user_id || isOwner);
  const canPin = currentUser && isOwner;
  const canDelete = currentUser && (currentUser.id === c.user_id || isOwner || currentUser.is_admin);
  return `<div class="comment">
    ${avatarImg(c, 'comment-avatar')}
    <div class="comment-body">
      <div class="comment-header">
        <span class="comment-author">${c.username ? `<a href="${profileRoute(c.username)}" data-link>${userDisplayName(c)}</a>` : userDisplayName(c)}</span>
        <span class="comment-time">${timeAgo(c.created_at)}${c.is_pinned ? ' • Üstte sabitlendi' : ''}${c.updated_at && c.updated_at !== c.created_at ? ' • düzenlendi' : ''}</span>
      </div>
      <div class="comment-content">${renderContent(c.content)}</div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:8px">
        <div style="display:flex;align-items:center;gap:8px">
          ${canPin ? `<button class="btn btn-ghost btn-sm video-comment-pin" data-id="${c.id}" style="padding:2px 6px"><i class="fas fa-thumbtack"></i></button>` : ''}
          ${canEdit ? `<button class="btn btn-ghost btn-sm video-comment-edit" data-id="${c.id}" data-content="${escHtml(c.content)}" style="padding:2px 6px"><i class="fas fa-edit"></i></button>` : ''}
          ${canDelete ? `<button class="btn btn-ghost btn-sm video-comment-delete" data-id="${c.id}" title="Yorumu sil" style="padding:2px 6px;color:var(--accent-red2)"><i class="fas fa-trash"></i></button>` : ''}
        </div>
        <button class="btn btn-ghost btn-sm video-comment-like" data-id="${c.id}" style="padding:2px 6px"><i class="fas fa-heart"></i> <span class="video-comment-count">${c.like_count || 0}</span></button>
      </div>
    </div>
  </div>`;
}

async function renderProfile(app, username) {
  app.innerHTML = `<div class="container page"><div class="loading-center"><div class="spinner"></div></div></div>`;
  let data;
  try { data = await api('/profile/' + username); } catch { app.innerHTML = '<div class="container page"><div class="empty-state"><i class="fas fa-user-slash"></i><p>Kullanıcı bulunamadı.</p></div></div>'; return; }

  // Engellenen profil: içerik gizli
  if (data.blocked_profile) {
    app.innerHTML = `<div class="container page">
      <div class="profile-header">
        <div class="profile-avatar-wrap"><div class="profile-avatar-placeholder"><i class="fas fa-user-slash"></i></div></div>
        <div class="profile-info">
          <div class="profile-username">${escHtml(data.user.username)}</div>
          <div style="margin-top:12px;color:var(--text-muted);font-size:14px"><i class="fas fa-ban" style="color:var(--accent-red2)"></i> Bu kullanıcının profili görüntülenemiyor.</div>
          <div style="margin-top:8px;font-size:13px;color:var(--text-muted)">Ad: <strong>Bilinmiyor</strong> · Konum: <strong>Bilinmiyor</strong> · Forum: <strong>Bilinmiyor</strong></div>
        </div>
      </div>
    </div>`;
    return;
  }

  const { user, forums, books, groups, common_groups = [], photos = [], reals, songs, level, levels, book_page_count } = data;
  const profileSongs = Array.isArray(songs) ? songs : [];
  const profileReals = Array.isArray(reals) ? reals : [];
  const commonGroups = Array.isArray(common_groups) ? common_groups : [];
  let profileTabOrder = ['forums', 'books', 'photos', 'groups', 'reals', 'saved', 'songs'];
  try {
    const settings = await fetch('/api/settings/public').then(response => response.json());
    const configured = JSON.parse(settings.profile_tabs || '[]');
    if (Array.isArray(configured)) {
      const configuredWithoutVideos = configured.filter(tab => tab !== 'videos');
      profileTabOrder = [...configuredWithoutVideos, ...profileTabOrder.filter(tab => !configuredWithoutVideos.includes(tab))];
    }
  } catch {}
  const isOwn = currentUser && currentUser.id === user.id;
  let profileVisibility = { forums: true, books: true, comments: true, photos: true, music: true, followers: true, following: true };
  try { profileVisibility = { ...profileVisibility, ...(user.profile_visibility ? JSON.parse(user.profile_visibility) : {}) }; } catch {}
  let followState = { following: !!data.following, pending: false };
  if (!isOwn && currentUser) {
    try { followState = await api('/users/' + encodeURIComponent(username) + '/follow-status'); } catch {}
  }
  const commonGroupsHTML = commonGroups.length ? `<section class="profile-common-groups">
    <div class="profile-common-groups-heading"><span class="profile-common-groups-icon"><i class="fas fa-users"></i></span><div><strong>Aynı olduğunuz gruplar</strong><small>Birlikte bulunduğunuz topluluklar</small></div></div>
    <div class="profile-common-groups-list">${commonGroups.map(group => `<a href="/grup/${escHtml(group.slug)}" data-link class="profile-common-group">
      <span class="profile-common-group-avatar"><i class="fas fa-users"></i></span>
      <span class="profile-common-group-copy"><strong>${escHtml(group.name)}</strong><small>${Number(group.member_count) || 0} üye</small></span>
      <i class="fas fa-chevron-right profile-common-group-arrow"></i>
    </a>`).join('')}</div>
  </section>` : '';
  const bindFollowButton = () => {
    const button = document.getElementById('profile-follow-btn');
    if (!button) return;
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        if (user.is_private) {
          await api('/friends/request/' + encodeURIComponent(username), { method: 'POST' });
          followState.friend_status = 'pending';
          followState.friend_requester_id = currentUser?.id;
          button.innerHTML = '<i class="fas fa-clock"></i> Arkadaşlık isteği gönderildi';
          button.classList.remove('btn-primary');
          button.classList.add('btn-outline');
          button.disabled = true;
          return;
        }
        followState = followState.following || followState.pending
          ? await api('/users/' + encodeURIComponent(username) + '/follow', { method: 'DELETE' })
          : await api('/users/' + encodeURIComponent(username) + '/follow', { method: 'POST' });
        button.textContent = user.is_private ? 'Takip isteği gönderildi' : (followState.pending ? 'İstek gönderildi' : (followState.following ? 'Takiptesin' : 'Takip et'));
        button.classList.toggle('btn-outline', followState.following || followState.pending);
        button.classList.toggle('btn-primary', !followState.following && !followState.pending);
        button.disabled = false;
      } catch (e) { toast(e.message, 'error'); button.disabled = false; }
    });
  };
  if (data.private_profile && !isOwn) {
    app.innerHTML = `<div class="container page"><div class="profile-header">
      <div class="profile-avatar-wrap">${user.avatar && !user.avatar_removed ? `<img src="${escHtml(user.avatar)}" class="profile-avatar" alt="" />` : `<div class="profile-avatar-placeholder"><i class="fas fa-user"></i></div>`}</div>
      <div class="profile-info"><div class="profile-username">${user.is_private ? '<i class="fas fa-lock profile-private-lock" title="Gizli hesap"></i>' : ''}${escHtml(user.username)}</div>
      <div class="profile-stats" style="margin-top:12px">${profileVisibility.followers ? `<div class="profile-stat"><div class="profile-stat-num">${data.followers_count || 0}</div><div class="profile-stat-label">Takipçi</div></div>` : ''}${profileVisibility.following ? `<div class="profile-stat"><div class="profile-stat-num">${data.following_count || 0}</div><div class="profile-stat-label">Takip</div></div>` : ''}</div>
      <p style="color:var(--text-secondary);margin-top:16px"><i class="fas fa-lock"></i> Bu hesap gizli.</p>
      ${currentUser ? `<button id="profile-follow-btn" class="btn ${followState.friend_status ? 'btn-outline' : 'btn-primary'} btn-sm" style="margin-top:12px" ${followState.friend_status ? 'disabled' : ''}>${followState.friend_status === 'pending' ? '<i class="fas fa-clock"></i> Arkadaşlık isteği gönderildi' : followState.friend_status === 'accepted' ? '<i class="fas fa-user-check"></i> Arkadaşsınız' : '<i class="fas fa-user-plus"></i> Arkadaş isteği gönder'}</button>` : ''}</div></div>${commonGroupsHTML}</div>`;
    bindFollowButton();
    return;
  }
  let savedVideos = [];
  if (isOwn) {
    try { savedVideos = await api('/user/' + encodeURIComponent(username) + '/saved-videos'); } catch {}
  }
  const profileSavedVideos = Array.isArray(savedVideos) ? savedVideos : [];
  const savedContentHTML = profileSavedVideos.length ? `<div class="grid-3">${profileSavedVideos.map(v => v.is_reals ? realsProfileCardHTML(v) : videoCardHTML(v)).join('')}</div>` : '<div class="empty-state"><i class="fas fa-bookmark"></i><p>Kaydedilen video yok.</p></div>';
  const profileSongsHTML = profileSongs.length ? `<div class="grid-3" style="gap:16px">${profileSongs.map(s => `
      <div class="song-card" onclick="navigate('/muzik/${escHtml(s.slug)}')" style="cursor:pointer">
        ${s.cover_url ? `<img src="${escHtml(s.cover_url)}" class="song-card-cover" />` : `<div class="song-card-cover song-card-cover-ph"><i class="fas fa-music"></i></div>`}
        <div class="song-card-body">
          <div class="song-card-title">${escHtml(s.title)}</div>
          <div class="song-card-subtitle">${escHtml(s.artist_name || s.uploader_name || s.username || '')}</div>
          <div class="song-card-meta">${s.play_count || 0} dinlenme</div>
        </div>
      </div>`).join('')}</div>` : '<div class="empty-state"><i class="fas fa-music"></i><p>Henüz şarkı yok</p></div>';
  document.title = user.username + ' - ' + siteName;

  const nextLevel = levels.find(l => l.order_num > (level?.order_num || 0));
  let progressHTML = '';
  if (nextLevel && user.show_level_progress !== 0) {
    const reqAny = nextLevel.require_any === 1;
    const INF = 9999999;
    const nf = nextLevel.min_forums >= INF ? null : nextLevel.min_forums;
    const nb = nextLevel.min_books >= INF ? null : nextLevel.min_books;
    const nc = nextLevel.min_comments >= INF ? null : nextLevel.min_comments;
    const nbp = (nextLevel.min_book_pages || 0) >= INF ? null : (nextLevel.min_book_pages || 0);

    const remaining = [];
    if (nf !== null && nf > 0) { const left = Math.max(0, nf - user.forum_count); if (left > 0) remaining.push(`${left} konu`); }
    if (nb !== null && nb > 0) { const left = Math.max(0, nb - user.book_count); if (left > 0) remaining.push(`${left} kitap`); }
    if (nbp !== null && nbp > 0) { const left = Math.max(0, nbp - (book_page_count || 0)); if (left > 0) remaining.push(`${left} kitap sayfası`); }
    if (nc !== null && nc > 0) { const left = Math.max(0, nc - user.comment_count); if (left > 0) remaining.push(`${left} yorum`); }

    let overallPct = 0;
    const metrics = [];
    if (nf !== null && nf > 0) metrics.push(Math.min(100, Math.round((user.forum_count / nf) * 100)));
    if (nb !== null && nb > 0) metrics.push(Math.min(100, Math.round((user.book_count / nb) * 100)));
    if (nbp !== null && nbp > 0) metrics.push(Math.min(100, Math.round(((book_page_count || 0) / nbp) * 100)));
    if (nc !== null && nc > 0) metrics.push(Math.min(100, Math.round((user.comment_count / nc) * 100)));

    if (reqAny) {
      overallPct = metrics.length > 0 ? Math.max(...metrics) : 100;
    } else {
      overallPct = metrics.length > 0 ? Math.round(metrics.reduce((a, b) => a + b, 0) / metrics.length) : 100;
    }

    progressHTML = `<div style="margin-top:10px">
      <div class="progress-bar"><div class="progress-fill" style="width:${overallPct}%"></div></div>
    </div>`;
  }

  const levelColor = level?.color || '#6b7280';
  const levelBadge = level && user.show_level_badge ? `<span class="level-badge" style="color:${levelColor};border-color:${levelColor};background:${levelColor}20"><i class="${escHtml(level.icon)}"></i> ${escHtml(level.name)}</span>` : '';

  const links = (() => { try { return JSON.parse(user.links || '[]'); } catch { return []; } })();
  // Rozet satırı
  const badgeItems = [];
  if (level && user.show_level_badge) {
    badgeItems.push(`<span class="profile-badge" style="color:${escHtml(levelColor)};border-color:${escHtml(levelColor)};background:${escHtml(levelColor)}20" title="Seviye: ${escHtml(level.name)}"><i class="${escHtml(level.icon)}"></i> ${escHtml(level.name)} <span style="font-size:10px;opacity:0.7">seviye</span></span>`);
  }
  if (user.is_artist) {
    badgeItems.push(`<span class="profile-badge" style="color:#a855f7;border-color:#a855f733;background:#a855f715" title="Artist"><i class="fas fa-microphone-alt"></i> Artist</span>`);
  }
  if (user.badge_name) {
    badgeItems.push(`<span class="profile-badge" style="color:${escHtml(user.badge_color||'#6b7280')};border-color:${escHtml(user.badge_color||'#6b7280')}33;background:${escHtml(user.badge_color||'#6b7280')}15" title="${escHtml(user.badge_name)}">${user.badge_icon ? `<i class="${escHtml(user.badge_icon)}"></i> ` : ''}${escHtml(user.badge_name)}</span>`);
  }
  if (user.is_vip) {
    badgeItems.push(`<span class="profile-badge" style="color:#fbbf24;border-color:#fbbf2433;background:#fbbf2415" title="VIP"><i class="fas fa-gem"></i> VIP</span>`);
  }
  if (user.is_plus) {
    badgeItems.push(`<span class="profile-badge" style="color:#818cf8;border-color:#818cf833;background:#818cf815" title="Plus"><i class="fas fa-plus-circle"></i> Plus</span>`);
  }
  const badgesHTML = badgeItems.length ? `<div class="profile-badges-row">${badgeItems.join('')}</div>` : '';

  app.innerHTML = `<div class="container page">
    <div class="profile-header">
      <div class="profile-avatar-wrap">
        ${user.avatar && !user.avatar_removed ? `<img src="${escHtml(user.avatar)}" class="profile-avatar" alt="" />` : `<div class="profile-avatar-placeholder"><i class="fas fa-user"></i></div>`}
      </div>
      <div class="profile-info">
        <div class="profile-username" style="${(user.is_vip || user.is_plus) && user.show_level_color && user.name_color ? 'color:' + escHtml(user.name_color) : ''}">
          ${user.is_private ? '<i class="fas fa-lock profile-private-lock" title="Gizli hesap"></i>' : ''}${escHtml(user.username)}${user.is_admin ? ` <i class="fas fa-shield user-admin" title="CigCig Yetkilisi" data-admin-since="${escHtml(user.admin_since || '')}" style="color:#5865F2;cursor:pointer;font-size:18px"></i>` : ''}
        </div>
        ${user.title ? `<div class="profile-title"><i class="fas fa-briefcase" style="font-size:11px;margin-right:4px"></i>${escHtml(user.title)}</div>` : ''}
        ${user.location ? `<div style="font-size:12px;color:var(--text-muted);margin-top:4px"><i class="fas fa-map-marker-alt" style="font-size:11px;margin-right:4px"></i>${escHtml(user.location)}</div>` : ''}
        ${badgesHTML}
        ${progressHTML}
        ${user.bio ? `<div class="profile-bio" style="margin-top:10px">${escHtml(user.bio)}</div>` : ''}
        ${links.length ? `<div class="profile-links">${links.map(l => {
          let url = (l.url||'').trim();
          if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
          return `<a href="${escHtml(url)}" target="_blank" rel="noopener noreferrer" class="profile-link"><i class="fas fa-link"></i> ${escHtml(l.label || l.url)}</a>`;
        }).join('')}</div>` : ''}
        <div class="profile-stats" style="margin-top:12px">
          ${profileVisibility.followers ? (profileVisibility.followers_list !== false ? `<button class="profile-stat profile-follow-list" data-follow-list="followers"><div class="profile-stat-num">${data.followers_count || 0}</div><div class="profile-stat-label">Takipçi</div></button>` : `<div class="profile-stat"><div class="profile-stat-num">${data.followers_count || 0}</div><div class="profile-stat-label">Takipçi</div></div>`) : ''}
          ${profileVisibility.following ? (profileVisibility.following_list !== false ? `<button class="profile-stat profile-follow-list" data-follow-list="following"><div class="profile-stat-num">${data.following_count || 0}</div><div class="profile-stat-label">Takip</div></button>` : `<div class="profile-stat"><div class="profile-stat-num">${data.following_count || 0}</div><div class="profile-stat-label">Takip</div></div>`) : ''}
          ${profileVisibility.forums ? `<div class="profile-stat"><div class="profile-stat-num">${user.forum_count}</div><div class="profile-stat-label">Forum</div></div>` : ''}
          ${profileVisibility.books ? `<div class="profile-stat"><div class="profile-stat-num">${user.book_count}</div><div class="profile-stat-label">Kitap</div></div>` : ''}
          ${profileVisibility.music && profileSongs.length ? `<div class="profile-stat"><div class="profile-stat-num">${profileSongs.length}</div><div class="profile-stat-label">Müzik</div></div>` : ''}
          ${profileVisibility.comments ? `<div class="profile-stat"><div class="profile-stat-num">${user.comment_count}</div><div class="profile-stat-label">Yorum</div></div>` : ''}
          ${profileVisibility.photos ? `<div class="profile-stat"><div class="profile-stat-num">${photos.length}</div><div class="profile-stat-label">Fotoğraf</div></div>` : ''}
        </div>
        ${isOwn ? `<a href="/ayarlar" data-link class="btn btn-outline btn-sm" style="margin-top:16px"><i class="fas fa-cog"></i> Profili Düzenle</a>${currentUser && currentUser.is_admin ? `<a href="/gubukgak" class="btn btn-sm" style="margin-top:8px;background:linear-gradient(135deg,#1a1aff,#5865F2);border:none;color:#fff"><i class="fas fa-shield"></i> Yetkili Paneli</a>` : ''}` : ''}
        ${!isOwn && currentUser ? `<div class="profile-actions" style="display:flex;gap:8px;margin-top:16px;position:relative">
           <button id="profile-follow-btn" class="btn ${user.is_private ? (followState.friend_status ? 'btn-outline' : 'btn-primary') : (followState.following || followState.pending ? 'btn-outline' : 'btn-primary')} btn-sm" ${user.is_private && followState.friend_status ? 'disabled' : ''}>${user.is_private ? (followState.friend_status === 'pending' ? '<i class="fas fa-clock"></i> Arkadaşlık isteği gönderildi' : followState.friend_status === 'accepted' ? '<i class="fas fa-user-check"></i> Arkadaşsınız' : '<i class="fas fa-user-plus"></i> Arkadaş isteği gönder') : (followState.following ? '<i class="fas fa-user-check"></i> Takiptesin' : followState.pending ? '<i class="fas fa-clock"></i> İstek gönderildi' : '<i class="fas fa-user-plus"></i> Takip et')}</button>
          ${user.is_private ? '' : `<button id="profile-msg-btn" class="btn btn-outline btn-sm" onclick="navigate('/mesajlar/${escHtml(user.username)}')"><i class="fas fa-envelope"></i> Mesaj</button>`}
          <button id="profile-more-btn" class="btn btn-ghost btn-sm" style="padding:5px 9px"><i class="fas fa-ellipsis-h"></i></button>
          <div id="profile-more-menu" style="display:none;position:absolute;top:36px;left:0;background:var(--bg-secondary);border:1px solid var(--border);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,0.5);z-index:500;min-width:200px;overflow:hidden"></div>
        </div>` : ''}
      </div>
     </div>
     ${commonGroupsHTML}

    <div class="tabs">${profileTabOrder.filter(tab => isOwn || tab !== 'saved').map(tab => ({ forums:'Forumlar', books:'Kitaplar', photos:'Fotoğraflar', groups:'Gruplar', videos:'Videolar', reals:'Reals', saved:'Kaydedilenler', songs:'Müzikler' })[tab] ? `<button class="tab ${tab === profileTabOrder.find(item => isOwn || item !== 'saved') ? 'active' : ''}" data-tab="${tab}">${({ forums:'Forumlar', books:'Kitaplar', photos:'Fotoğraflar', groups:'Gruplar', videos:'Videolar', reals:'Reals', saved:'Kaydedilenler', songs:'Müzikler' })[tab]}</button>` : '').join('')}</div>

    <div id="tab-forums">
      ${forums.length ? `<div style="display:flex;flex-direction:column;gap:12px">${forums.map(f => forumCardHTML(f)).join('')}</div>` : '<div class="empty-state"><i class="fas fa-comments"></i><p>Forum yok.</p></div>'}
    </div>
    <div id="tab-books" class="hidden">
      ${books.length ? `<div class="grid-3">${books.map(b => bookCardHTML(b)).join('')}</div>` : '<div class="empty-state"><i class="fas fa-book"></i><p>Kitap yok.</p></div>'}
    </div>
    <div id="tab-photos" class="hidden">
      ${photos.length ? `<div class="profile-photo-grid">${photos.map(photo => `<a href="/foto/${photo.id}" data-link class="profile-photo-item"><img src="${escHtml(photo.url)}" alt="${escHtml(photo.title || photo.caption || 'Fotoğraf')}" />${photo.title ? `<span>${escHtml(photo.title)}</span>` : ''}</a>`).join('')}</div>` : '<div class="empty-state"><i class="fas fa-images"></i><p>Fotoğraf yok.</p></div>'}
    </div>
    <div id="tab-groups" class="hidden">
      ${groups.length ? `<div class="grid-3">${groups.map(g => groupCardHTML(g)).join('')}</div>` : '<div class="empty-state"><i class="fas fa-users"></i><p>Grup yok.</p></div>'}
    </div>
    <div id="tab-reals" class="hidden">
      ${profileReals.length ? `<div class="grid-3">${profileReals.map(v => realsProfileCardHTML(v)).join('')}</div>` : '<div class="empty-state"><i class="fas fa-circle-play"></i><p>Reals yok.</p></div>'}
    </div>
    <div id="tab-saved" class="hidden">
      ${savedContentHTML}
    </div>
    <div id="tab-songs" class="hidden">
      ${profileSongsHTML}
    </div>
  </div>`;
  const tabPanels = profileTabOrder.map(tab => document.getElementById('tab-' + tab)).filter(Boolean);
  const tabsContainer = app.querySelector('.tabs');
  tabPanels.forEach(panel => tabsContainer?.parentElement.appendChild(panel));
  const firstTab = profileTabOrder.find(tab => document.getElementById('tab-' + tab));
  profileTabOrder.forEach(tab => document.getElementById('tab-' + tab)?.classList.toggle('hidden', tab !== firstTab));

  bindFollowButton();
  app.querySelectorAll('.profile-follow-list').forEach(button => button.addEventListener('click', async () => {
    try {
      const list = await api('/users/' + encodeURIComponent(username) + '/' + button.dataset.followList);
      showModal(button.dataset.followList === 'followers' ? 'Takipçiler' : 'Takip edilenler', list.length ? `<div class="profile-followers-list">${list.map(item => `<a href="${profileRoute(item.username)}" data-link class="profile-follow-row"><span>${avatarImg(item)}</span><strong>${escHtml(item.username)}</strong></a>`).join('')}</div>` : '<div class="empty-state"><p>Henüz kimse yok.</p></div>');
    } catch (e) { toast(e.message, 'error'); }
  }));


  // Kendi profilimizde abonelik bölümünü göster
  if (isOwn) {
    const profileContainer = app.querySelector('.container.page');
    if (profileContainer) {
      // .tabs div'inden önce abonelik bölümü ekle
      const tabsDiv = profileContainer.querySelector('.tabs');
      if (tabsDiv) {
        const subsWrapper = document.createElement('div');
        profileContainer.insertBefore(subsWrapper, tabsDiv);
        renderProfileSubscriptions(subsWrapper, username);
      }
    }
  }
  $$('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      profileTabOrder.forEach(name => {
        const tab = $('#tab-' + name);
        if (tab) tab.classList.toggle('hidden', name !== btn.dataset.tab);
      });
    });
  });

  // Profil 3-nokta menüsü
  if (!isOwn && currentUser) {
    const moreBtn = document.getElementById('profile-more-btn');
    const moreMenu = document.getElementById('profile-more-menu');
    if (moreBtn && moreMenu) {
      const getBlockStatus = async () => {
        const blocks = await api('/blocks').catch(() => []);
        return { blocked_by_me: Array.isArray(blocks) && blocks.some(block => block.username === username) };
      };
      function buildMenuItems(fs) {
        const items = [];
        if (!fs?.blocked_by_me) {
          items.push({ icon: 'fa-ban', label: 'Engelle', action: 'block-user', danger: true });
        } else {
          items.push({ icon: 'fa-ban', label: 'Engeli Kaldır', action: 'unblock-user' });
        }
        return items;
      }

      function renderMenu(fs) {
        const items = buildMenuItems(fs);
        moreMenu.innerHTML = items.map(item =>
          `<div class="profile-menu-item${item.danger ? ' danger' : ''}" data-action="${item.action}" data-id="${item.id || ''}" style="display:flex;align-items:center;gap:10px;padding:11px 16px;cursor:pointer;transition:background 0.15s;font-size:14px;color:${item.danger ? 'var(--accent-red2)' : 'var(--text-primary)'}">
            <i class="fas ${item.icon}" style="width:16px;text-align:center"></i> ${item.label}
          </div>`
        ).join('');
        moreMenu.querySelectorAll('.profile-menu-item').forEach(el => {
          el.addEventListener('mouseover', () => el.style.background = 'var(--bg-hover)');
          el.addEventListener('mouseout', () => el.style.background = '');
          el.addEventListener('click', async () => {
            moreMenu.style.display = 'none';
            const action = el.dataset.action;
            const fid = el.dataset.id;
            try {
              if (action === 'block-user') {
                if (!confirm('@' + username + ' kullanıcısını engellemek istiyor musun?')) return;
                await api('/block/' + encodeURIComponent(username), { method: 'POST' });
                toast('Kullanıcı engellendi');
              } else if (action === 'unblock-user') {
                await api('/block/' + encodeURIComponent(username), { method: 'DELETE' });
                toast('Engel kaldırıldı');
              }
              const blockStatus = await getBlockStatus();
              renderMenu(blockStatus);
            } catch(e) { toast(e.message || 'Hata oluştu', 'error'); }
          });
        });
      }

      getBlockStatus().then(renderMenu).catch(() => renderMenu({}));

      document.getElementById('profile-friend-btn')?.addEventListener('click', e => {
        e.stopPropagation();
        moreMenu.style.display = moreMenu.style.display === 'none' ? 'block' : 'none';
      });

      moreBtn.addEventListener('click', e => {
        e.stopPropagation();
        moreMenu.style.display = moreMenu.style.display === 'none' ? 'block' : 'none';
      });
      document.addEventListener('click', () => { if (moreMenu) moreMenu.style.display = 'none'; }, { once: false });
    }
  }
}

async function renderSettings(app) {
  if (!currentUser) { navigate('/giris'); return; }
  document.title = 'Ayarlar - ' + siteName;

  app.innerHTML = `<div class="container page">
    <div class="page-header"><div class="page-title">Ayarlar</div></div>
    <div class="settings-layout">
      <div class="settings-nav">
        <div class="settings-nav-item active" data-section="profile"><i class="fas fa-user"></i> Profil</div>
        <div class="settings-nav-item" data-section="username"><i class="fas fa-at"></i> Kullanıcı Adı</div>
        <div class="settings-nav-item" data-section="password"><i class="fas fa-lock"></i> Şifre</div>
        <div class="settings-nav-item" data-section="two-factor"><i class="fas fa-shield-halved"></i> 2 Aşamalı Doğrulama</div>
        <div class="settings-nav-item" data-section="appearance"><i class="fas fa-palette"></i> Görünüm</div>
        <div class="settings-nav-item" data-section="profile-visibility"><i class="fas fa-sliders"></i> Profil Seçenekleri</div>
        <div class="settings-nav-item" data-section="notifications"><i class="fas fa-bell"></i> Bildirimler</div>
        <div class="settings-nav-item" data-section="account" style="color:var(--accent-red2)"><i class="fas fa-exclamation-triangle"></i> Hesap</div>
      </div>
      <div id="settings-content"></div>
    </div>
  </div>`;

  renderSettingsSection('profile');

  $$('.settings-nav-item').forEach(item => {
    item.addEventListener('click', () => {
      $$('.settings-nav-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      renderSettingsSection(item.dataset.section);
    });
  });
}

async function renderSettingsSection(section) {
  const el = $('#settings-content'); if (!el) return;
  if (section === 'profile') {
    let selectedAvatarFile = null;
    const links = (() => { try { return JSON.parse(currentUser.links || '[]'); } catch { return []; } })();
    el.innerHTML = `
      <div class="card">
        <div class="card-header"><span>Profil Bilgileri</span></div>
        <div class="card-body">
          <div class="form-group" style="display:flex;align-items:center;gap:16px">
            ${currentUser.avatar && !currentUser.avatar_removed ? `<img src="${escHtml(currentUser.avatar)}" class="settings-avatar" alt="Profil fotoğrafı" />` : `<div class="settings-avatar-placeholder"><i class="fas fa-user"></i></div>`}
            <div style="flex:1">
              <label>Avatar Yükle</label>
              <input type="file" id="avatar-file" accept="image/*" style="padding:6px" />
            </div>
          </div>
          <label class="checkbox-label" style="margin-bottom:16px"><input type="checkbox" id="s-remove-avatar" ${currentUser.avatar_removed ? 'checked' : ''} /> Profil fotoğrafını kaldır, fotoğrafsız görün</label>
          <div class="form-group"><label>Biyografi</label><textarea id="s-bio" rows="3">${escHtml(currentUser.bio || '')}</textarea></div>
          <div class="form-row">
            <div class="form-group"><label>Ünvan <span style="color:var(--text-muted);font-size:11px">(opsiyonel)</span></label><input type="text" id="s-title" value="${escHtml(currentUser.title || '')}" placeholder="Örn: Yazılım Geliştirici, Öğrenci..." /></div>
            <div class="form-group"><label>Konum <span style="color:var(--text-muted);font-size:11px">(opsiyonel)</span></label><input type="text" id="s-location" value="${escHtml(currentUser.location || '')}" placeholder="Örn: İstanbul, Türkiye" /></div>
          </div>
          <div class="form-group">
            <label>Linkler</label>
            <div id="links-container" style="display:flex;flex-direction:column;gap:8px;margin-bottom:8px"></div>
            <button type="button" class="btn btn-outline btn-sm" id="add-link-btn"><i class="fas fa-plus"></i> Link Ekle</button>
          </div>
          <button class="btn btn-primary" id="save-profile-btn">Kaydet</button>
          <div id="profile-msg" class="form-error mt-4"></div>
        </div>
      </div>`;

    function renderLinkRows(linksArr) {
      const container = $('#links-container');
      container.innerHTML = linksArr.map((l, i) => `
        <div class="link-row" data-idx="${i}" style="display:flex;gap:8px;align-items:center">
          <input type="text" placeholder="Başlık (örn: GitHub)" value="${escHtml(l.label || '')}" data-field="label" style="flex:1" />
          <input type="text" placeholder="URL (https://...)" value="${escHtml(l.url || '')}" data-field="url" style="flex:2" />
          <button type="button" class="btn btn-ghost btn-sm remove-link-btn" data-idx="${i}" style="color:var(--accent-red2);flex-shrink:0"><i class="fas fa-times"></i></button>
        </div>`).join('');
    }

    let currentLinks = [...links];
    renderLinkRows(currentLinks);

    $('#add-link-btn').addEventListener('click', () => {
      currentLinks.push({ label: '', url: '' });
      renderLinkRows(currentLinks);
    });

    $('#links-container').addEventListener('click', e => {
      const rem = e.target.closest('.remove-link-btn');
      if (rem) {
        currentLinks.splice(parseInt(rem.dataset.idx), 1);
        renderLinkRows(currentLinks);
      }
    });

    $('#links-container').addEventListener('input', e => {
      const row = e.target.closest('.link-row');
      if (!row) return;
      const idx = parseInt(row.dataset.idx);
      const field = e.target.dataset.field;
      if (field && currentLinks[idx] !== undefined) currentLinks[idx][field] = e.target.value;
    });

    $('#save-profile-btn').addEventListener('click', async () => {
      const titleVal = ($('#s-title').value || '').trim();
      const fd = new FormData();
      fd.append('bio', $('#s-bio').value);
      fd.append('title', titleVal);
      fd.append('location', $('#s-location').value || '');
      const validLinks = currentLinks.filter(l => l.url && l.url.trim());
      fd.append('links', JSON.stringify(validLinks));
      if (selectedAvatarFile) fd.append('avatar', selectedAvatarFile);
      fd.append('avatar_removed', $('#s-remove-avatar').checked ? '1' : '0');
      try {
        const updated = await apiForm('/profile', fd, 'PUT');
        currentUser = updated;
        updateNavUI();
        toast('Profil güncellendi');
        $('#profile-msg').style.color = 'var(--accent-red2)';
        $('#profile-msg').textContent = '';
      } catch (e) { $('#profile-msg').textContent = e.message; }
    });
    $('#avatar-file').addEventListener('change', e => openAvatarCrop(e.target.files[0], file => { selectedAvatarFile = file; $('#s-remove-avatar').checked = false; toast('Profil fotoğrafı hazır'); }));

  } else if (section === 'username') {
    const changes = currentUser.username_changes || 0;
    const resetAt = currentUser.username_change_reset_at ? new Date(currentUser.username_change_reset_at) : null;
    const remaining = 2 - changes;
    const now = new Date();
    const isBlocked = changes >= 2 && resetAt && resetAt > now;
    const resetDateStr = resetAt ? resetAt.toLocaleDateString('tr-TR') : '';
    el.innerHTML = `
      <div class="card">
        <div class="card-header"><span>Kullanıcı Adını Değiştir</span></div>
        <div class="card-body">
          <div class="form-group">
            <label>Mevcut Kullanıcı Adı</label>
            <div style="padding:8px 12px;background:var(--bg-card2);border:1px solid var(--border);border-radius:8px;color:var(--text-muted);font-size:14px">@${escHtml(currentUser.username)}</div>
          </div>
          <div style="padding:10px 14px;background:var(--bg-card2);border-radius:8px;margin-bottom:16px;font-size:13px;color:var(--text-muted)">
            <i class="fas fa-info-circle" style="color:var(--accent-red)"></i>
            Kullanıcı adını <strong>2 kez</strong> değiştirebilirsin. 2 değişim sonrası <strong>7 gün</strong> beklemen gerekir.
            ${isBlocked
              ? `<br><span style="color:var(--accent-red2);margin-top:6px;display:block"><i class="fas fa-clock"></i> Kalan değişim hakkın tükendi. ${resetDateStr} tarihinde yeniden kullanabilirsin.</span>`
              : `<br><span style="color:var(--accent-red);margin-top:4px;display:block">Kalan hak: <strong>${remaining}/2</strong>${resetAt ? ` · Pencere ${resetDateStr} tarihinde sıfırlanır` : ''}</span>`
            }
          </div>
          ${isBlocked ? '' : `
          <div class="form-group"><label>Yeni Kullanıcı Adı</label><input type="text" id="new-username" placeholder="3-30 karakter, harf/rakam/alt çizgi" maxlength="30" /></div>
          <button class="btn btn-primary" id="save-username-btn">Kullanıcı Adını Değiştir</button>
          <div id="username-msg" class="form-error mt-4"></div>
          `}
        </div>
      </div>`;
    if (!isBlocked) {
      $('#save-username-btn').addEventListener('click', async () => {
        const val = ($('#new-username').value || '').trim();
        if (!val) { $('#username-msg').textContent = 'Kullanıcı adı zorunlu'; return; }
        if (/\s/.test(val)) { $('#username-msg').textContent = 'Kullanıcı adında boşluk oluşamaz'; return; }
        try {
          const updated = await api('/profile/username', { method: 'PUT', body: JSON.stringify({ username: val }) });
          currentUser = updated;
          updateNavUI();
          toast('Kullanıcı adı güncellendi!');
          renderSettingsSection('username');
        } catch (e) { $('#username-msg').textContent = e.message; }
      });
    }

  } else if (section === 'password') {
    el.innerHTML = `
      <div class="card">
        <div class="card-header"><span>Şifre Değiştir</span></div>
        <div class="card-body">
          <div class="form-group"><label>Eski Şifre</label><input type="password" id="old-pw" /></div>
          <div class="form-group"><label>Yeni Şifre</label><input type="password" id="new-pw" /></div>
          <div class="form-group"><label>Yeni Şifre (Tekrar)</label><input type="password" id="new-pw2" /></div>
          <button class="btn btn-primary" id="save-pw-btn">Değiştir</button>
          <div id="pw-msg" class="form-error mt-4"></div>
        </div>
      </div>`;
    $('#save-pw-btn').addEventListener('click', async () => {
      const old_password = $('#old-pw').value;
      const new_password = $('#new-pw').value;
      if (new_password !== $('#new-pw2').value) { $('#pw-msg').textContent = 'Şifreler uyuşmuyor'; return; }
      try {
        await api('/profile/password', { method: 'PUT', body: JSON.stringify({ old_password, new_password }) });
        toast('Şifre değiştirildi'); $('#old-pw').value = ''; $('#new-pw').value = ''; $('#new-pw2').value = '';
      } catch (e) { $('#pw-msg').textContent = e.message; }
    });

  } else if (section === 'two-factor') {
    let config = { method: 'none', question: '', email: '' };
    try { config = await api('/profile/2fa'); } catch (e) { el.innerHTML = `<div class="card card-body"><div class="form-error">${escHtml(e.message)}</div></div>`; return; }
    el.innerHTML = `
      <div class="card">
        <div class="card-header"><span><i class="fas fa-shield-halved" style="color:var(--accent-red2);margin-right:7px"></i>2 Aşamalı Doğrulama</span></div>
        <div class="card-body">
          <div style="padding:14px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-card2);margin-bottom:16px">
            <strong>Hesabına ekstra koruma ekle</strong>
            <div class="form-hint">Şifren bilinse bile seçtiğin ikinci adım olmadan giriş yapılamaz.</div>
          </div>
          <div class="form-group"><label>Doğrulama yöntemi</label><select id="s-2fa-method">
            <option value="none" ${config.method === 'none' ? 'selected' : ''}>Kapalı</option>
            <option value="email" ${config.method === 'email' ? 'selected' : ''}>E-posta kodu</option>
            <option value="question" ${config.method === 'question' ? 'selected' : ''}>Güvenlik sorusu</option>
          </select></div>
          <div id="s-2fa-question-fields" style="display:${config.method === 'question' ? 'block' : 'none'};padding:12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-card2)">
            <div class="form-group"><label>Soru</label><select id="s-2fa-question">
              <option value="En sevdiğin yemek nedir?" ${config.question === 'En sevdiğin yemek nedir?' ? 'selected' : ''}>En sevdiğin yemek nedir?</option>
              <option value="En sevdiğin isim nedir?" ${config.question === 'En sevdiğin isim nedir?' ? 'selected' : ''}>En sevdiğin isim nedir?</option>
              <option value="En sevdiğin eşya nedir?" ${config.question === 'En sevdiğin eşya nedir?' ? 'selected' : ''}>En sevdiğin eşya nedir?</option>
            </select></div>
            <div class="form-group"><label>Yeni cevap</label><input type="text" id="s-2fa-answer" autocomplete="off" placeholder="Cevabını yaz" /></div>
          </div>
          <div id="s-2fa-email-info" class="form-hint" style="display:${config.method === 'email' ? 'block' : 'none'};margin:12px 0">Kod, ${escHtml(config.email)} adresine gönderilecek.</div>
          <div class="form-group"><label>Hesap şifren</label><input type="password" id="s-2fa-password" autocomplete="current-password" placeholder="Değişikliği onaylamak için" /></div>
          <button class="btn btn-primary" id="save-2fa-btn"><i class="fas fa-save"></i> 2AD ayarını kaydet</button>
          <div id="s-2fa-msg" class="form-error mt-4"></div>
          <div style="margin-top:24px;padding-top:18px;border-top:1px solid var(--border)">
            <div style="font-weight:700;margin-bottom:5px"><i class="fas fa-envelope" style="color:var(--accent-red2);margin-right:6px"></i>E-posta adresini değiştir</div>
            <div class="form-hint" style="margin-bottom:12px">Yeni adrese kod gönderilir. Değişiklik için hesap şifren de gerekir.</div>
            <div class="form-group"><label>Yeni e-posta</label><input type="email" id="s-new-email" placeholder="yeni@ornek.com" autocomplete="email" /></div>
            <div class="form-group"><label>Hesap şifren</label><input type="password" id="s-email-password" autocomplete="current-password" /></div>
            <button class="btn btn-outline" id="request-email-change"><i class="fas fa-paper-plane"></i> Kod gönder</button>
            <div id="s-email-code-box" style="display:none;margin-top:12px"><div class="form-group"><label>E-posta kodu</label><input type="text" id="s-email-code" inputmode="numeric" maxlength="6" placeholder="000000" /></div><button class="btn btn-primary" id="confirm-email-change">E-postayı doğrula ve kaydet</button></div>
            <div id="s-email-msg" class="form-error mt-4"></div>
          </div>
        </div>
      </div>`;
    const syncTwoFactorFields = () => {
      const method = $('#s-2fa-method').value;
      $('#s-2fa-question-fields').style.display = method === 'question' ? 'block' : 'none';
      $('#s-2fa-email-info').style.display = method === 'email' ? 'block' : 'none';
    };
    $('#s-2fa-method').addEventListener('change', syncTwoFactorFields);
    $('#save-2fa-btn').addEventListener('click', async () => {
      const method = $('#s-2fa-method').value;
      const msg = $('#s-2fa-msg');
      try {
        const updated = await api('/profile/2fa', { method: 'PUT', body: JSON.stringify({ method, question: $('#s-2fa-question')?.value, answer: $('#s-2fa-answer')?.value, password: $('#s-2fa-password').value }) });
        msg.style.color = 'var(--green)'; msg.textContent = '2AD ayarın güncellendi';
        if (currentUser) { currentUser.two_factor_method = updated.method; currentUser.two_factor_question = updated.question; }
        $('#s-2fa-password').value = ''; if ($('#s-2fa-answer')) $('#s-2fa-answer').value = '';
      } catch (e) { msg.style.color = ''; msg.textContent = e.message; }
    });
    let emailChallenge = '';
    $('#request-email-change').addEventListener('click', async () => {
      const msg = $('#s-email-msg');
      try {
        const result = await api('/profile/email/request', { method: 'POST', body: JSON.stringify({ new_email: $('#s-new-email').value.trim(), password: $('#s-email-password').value }) });
        emailChallenge = result.challenge; $('#s-email-code-box').style.display = 'block'; msg.style.color = 'var(--green)'; msg.textContent = `${result.maskedEmail} adresine kod gönderildi.`;
      } catch (e) { msg.style.color = ''; msg.textContent = e.message; }
    });
    $('#confirm-email-change').addEventListener('click', async () => {
      const msg = $('#s-email-msg');
      try {
        const result = await api('/profile/email/confirm', { method: 'POST', body: JSON.stringify({ challenge: emailChallenge, code: $('#s-email-code').value.trim() }) });
        currentUser.email = result.email; msg.style.color = 'var(--green)'; msg.textContent = 'E-posta adresin güncellendi.'; $('#s-email-code-box').style.display = 'none'; $('#s-new-email').value = ''; $('#s-email-password').value = '';
      } catch (e) { msg.style.color = ''; msg.textContent = e.message; }
    });

  } else if (section === 'appearance') {
    el.innerHTML = `
      <div class="card">
        <div class="card-header"><span>Görünüm</span></div>
        <div class="card-body">
          <div class="form-group"><label class="checkbox-label"><input type="checkbox" id="s-private" ${currentUser.is_private ? 'checked' : ''} /> Hesabı gizliye al</label><div style="font-size:12px;color:var(--text-muted);margin-top:4px">Gizli hesaplarda içerik ve takip listeleri yalnızca kabul edilen takipçilere görünür.</div></div>
          <div class="form-group"><label class="checkbox-label"><input type="checkbox" id="s-show-badge" ${currentUser.show_level_badge ? 'checked' : ''} /> Seviye rozetini göster</label></div>
          <div class="form-group"><label class="checkbox-label"><input type="checkbox" id="s-show-progress" ${currentUser.show_level_progress !== 0 ? 'checked' : ''} /> Seviye ilerleme barını göster</label></div>
          <div class="form-group"><label class="checkbox-label"><input type="checkbox" id="s-show-color" ${currentUser.show_level_color ? 'checked' : ''} /> İsim rengini göster</label></div>
          ${(currentUser.is_vip || currentUser.is_plus) ? `<div class="form-group"><label>İsim Rengi (VIP/Plus)</label><input type="color" id="s-name-color" value="${currentUser.name_color || '#f5f5f5'}" style="width:60px;height:36px;padding:2px;cursor:pointer" /></div>` : ''}
          <button class="btn btn-primary" id="save-appearance-btn">Kaydet</button>
          <div id="appear-msg" class="form-error mt-4"></div>
        </div>
      </div>`;
    $('#save-appearance-btn').addEventListener('click', async () => {
      const body = {
        show_level_badge: $('#s-show-badge').checked,
        show_level_progress: $('#s-show-progress').checked,
        show_level_color: $('#s-show-color').checked,
      };
      if (currentUser.is_vip || currentUser.is_plus) body.name_color = $('#s-name-color')?.value || '';
      body.is_private = $('#s-private')?.checked || false;
      try {
        const fd = new FormData();
        Object.entries(body).forEach(([k, v]) => fd.append(k, v));
        const updated = await apiForm('/profile', fd, 'PUT');
        currentUser = updated; updateNavUI();
        toast('Görünüm güncellendi');
      } catch (e) { $('#appear-msg').textContent = e.message; }
    });
  } else if (section === '__removed-homepage') {
    const options = [
      ['konular', 'Konular', 'Topluluğun son tartışmaları', 'fas fa-comments'],
      ['kitaplar', 'Kitaplar', 'Yeni ve öne çıkan kitaplar', 'fas fa-book'],
      ['gruplar', 'Gruplar', 'Katıldığın ve keşfedebileceğin gruplar', 'fas fa-users'],
      ['muzikler', 'Müzikler', 'Son eklenen şarkılar', 'fas fa-music'],
      ['fotograflar', 'Fotoğraflar ve Hikayeler', 'Fotoğraf akışı ve hikaye çubuğu', 'fas fa-images'],
      ['magaza', 'Mağaza', 'Mağazadaki ürünler', 'fas fa-store'],
      ['playlistler', 'Playlistler', 'Kişisel müzik listelerin', 'fas fa-list-music']
    ];
    let selected = [];
    selected = [];
    if (!selected.length) selected = ['konular'];
    el.innerHTML = `<div class="card homepage-preferences"><div class="card-header"><span><i class="fas fa-layer-group" style="color:var(--accent-red2);margin-right:6px"></i>Ana Sayfa Bölümleri</span></div><div class="card-body"><p class="settings-help">Ana sayfanda görmek istediğin bölümleri seç. Kartları sürükleyerek sıralarını değiştirebilirsin.</p><div id="homepage-section-picker" class="homepage-section-picker">${options.map(([id, title, desc, icon]) => `<label class="homepage-section-option" draggable="true" data-section-id="${id}"><input type="checkbox" value="${id}" ${selected.includes(id) ? 'checked' : ''}/><span class="homepage-section-icon"><i class="${icon}"></i></span><span class="homepage-section-copy"><b>${title}</b><small>${desc}</small></span><i class="fas fa-grip-vertical homepage-section-drag"></i></label>`).join('')}</div><button class="btn btn-primary" id="save-homepage-btn"><i class="fas fa-save"></i> Seçimleri Kaydet</button><div id="homepage-msg" class="form-error mt-4"></div></div></div>`;
    const picker = $('#homepage-section-picker');
    let dragged = null;
    picker.querySelectorAll('.homepage-section-option').forEach(item => {
      item.addEventListener('dragstart', () => { dragged = item; item.classList.add('dragging'); });
      item.addEventListener('dragend', () => { dragged = null; item.classList.remove('dragging'); });
      item.addEventListener('dragover', event => { event.preventDefault(); if (dragged && dragged !== item) { const box = item.getBoundingClientRect(); picker.insertBefore(dragged, event.clientY < box.top + box.height / 2 ? item : item.nextSibling); } });
    });
    $('#save-homepage-btn').addEventListener('click', async () => {
      const sections = [...picker.querySelectorAll('input:checked')].map(input => input.value);
      if (!sections.length) { $('#homepage-msg').textContent = 'En az bir bölüm seçmelisin.'; return; }
      try { toast('Bu eski ayar artık kullanılmıyor'); } catch (error) { $('#homepage-msg').textContent = error.message; }
    });
  } else if (section === 'profile-visibility') {
    let visibility = { forums: true, books: true, comments: true, photos: true, music: true, followers: true, following: true, followers_list: true, following_list: true };
    try { visibility = { ...visibility, ...(await api('/me/profile-visibility')).visibility }; } catch {}
    const items = [
      ['followers', 'Takipçi sayımı', 'Profilindeki takipçi sayısını göster', 'fas fa-user-plus'],
      ['following', 'Takip sayımı', 'Profilindeki takip edilen sayısını göster', 'fas fa-user-check'],
      ['forums', 'Forum sayısı', 'Profilindeki forum/konu sayısını göster', 'fas fa-comments'],
      ['books', 'Kitap sayısı', 'Profilindeki kitap sayısını göster', 'fas fa-book'],
      ['comments', 'Yorum sayısı', 'Profilindeki yorum sayısını göster', 'fas fa-comment'],
      ['photos', 'Fotoğraf sayısı', 'Profilindeki fotoğraf sayısını göster', 'fas fa-images'],
      ['music', 'Müzik sayısı', 'Profilindeki müzik sayısını göster', 'fas fa-music']
    ];
    items.push(['followers_list', 'Takipçileri göster', 'Takipçi listesini profilinden aç', 'fas fa-users']);
    items.push(['following_list', 'Takip ettiklerini göster', 'Takip edilenler listesini profilinden aç', 'fas fa-user-check']);
    el.innerHTML = `<div class="card profile-visibility-card"><div class="card-header"><span><i class="fas fa-sliders" style="color:var(--accent-red2);margin-right:6px"></i>Profil Ayarları</span></div><div class="card-body"><p class="settings-help">Profilinde hangi bilgilerin ve listelerin görüneceğini seç.</p><div class="profile-visibility-list">${items.map(([id, title, desc, icon]) => `<label class="profile-visibility-option"><span class="profile-visibility-icon"><i class="${icon}"></i></span><span><b>${title}</b><small>${desc}</small></span><input type="checkbox" data-visibility="${id}" ${visibility[id] !== false ? 'checked' : ''} /></label>`).join('')}</div><button class="btn btn-primary" id="save-profile-visibility"><i class="fas fa-save"></i> Kaydet</button><div id="profile-visibility-msg" class="form-error mt-4"></div></div></div>`;
    $('#save-profile-visibility').addEventListener('click', async () => {
      const next = {};
      el.querySelectorAll('[data-visibility]').forEach(input => { next[input.dataset.visibility] = input.checked; });
      try { const result = await api('/me/profile-visibility', { method: 'PUT', body: JSON.stringify({ visibility: next }) }); currentUser = result.user; updateNavUI(); toast('Profil görünürlük ayarları kaydedildi'); } catch (error) { $('#profile-visibility-msg').textContent = error.message; }
    });
  } else if (section === 'notifications') {
    el.innerHTML = `
      <div class="card">
        <div class="card-header"><span><i class="fas fa-bell" style="color:var(--accent-red2);margin-right:6px"></i>Bildirim Ayarları</span></div>
        <div class="card-body">
          <div class="form-group">
            <label for="s-tag-permission">Beni kimler etiketleyebilir?</label>
            <select id="s-tag-permission">
              <option value="friends" ${(currentUser.tag_permission || 'everyone') === 'friends' ? 'selected' : ''}>Arkadaşlarım (takipleştiklerim)</option>
              <option value="everyone" ${(currentUser.tag_permission || 'everyone') === 'everyone' ? 'selected' : ''}>Herkes</option>
              <option value="nobody" ${(currentUser.tag_permission || 'everyone') === 'nobody' ? 'selected' : ''}>Hiç kimse</option>
            </select>
          </div>
          <button class="btn btn-primary" id="save-notif-btn">Kaydet</button>
          <div id="notif-settings-msg" class="form-error mt-4"></div>
        </div>
      </div>`;
    $('#save-notif-btn').addEventListener('click', async () => {
      const fd = new FormData();
      fd.append('tag_permission', $('#s-tag-permission').value);
      try {
        const updated = await apiForm('/profile', fd, 'PUT');
        currentUser = updated; updateNavUI();
        toast('Bildirim ayarları kaydedildi');
      } catch(e) { $('#notif-settings-msg').textContent = e.message; }
    });
  } else if (section === '__removed-spotify') {
    const hasSpotify = !!(currentUser.spotify_token || currentUser.spotify_expires > 0);
    el.innerHTML = `
      <div class="card">
        <div class="card-header">
          <span><i class="fab fa-spotify" style="color:#1ED760;margin-right:6px"></i>Spotify Entegrasyonu</span>
        </div>
        <div class="card-body">
          ${hasSpotify ? `
            <div style="display:flex;align-items:center;gap:10px;padding:12px;background:rgba(30,215,96,0.08);border:1px solid rgba(30,215,96,0.2);border-radius:8px;margin-bottom:16px">
              <i class="fab fa-spotify" style="color:#1ED760;font-size:24px"></i>
              <div>
                <div style="font-weight:600;color:var(--text-primary)">Spotify Bağlı ✓</div>
                <div style="font-size:13px;color:#1ED760;margin-top:2px">@${escHtml(currentUser.username)}</div>
                <div style="font-size:11px;color:var(--text-muted);margin-top:2px">Profil sayfanda "Şu an dinliyor" kutusu gösterilecek</div>
              </div>
            </div>
            <div id="spotify-now-preview" style="margin-bottom:16px"></div>
            <div class="form-group">
              <label class="checkbox-label">
                <input type="checkbox" id="spotify-show-cb" ${currentUser.spotify_show ? 'checked' : ''} />
                Şu an dinlediğimi profilimde göster
              </label>
            </div>
            <div style="display:flex;gap:8px">
              <button class="btn btn-primary" id="spotify-save-vis">Kaydet</button>
              <button class="btn btn-danger" id="spotify-disconnect">Bağlantıyı Kes</button>
            </div>
          ` : `
            <div style="font-size:14px;color:var(--text-secondary);margin-bottom:16px">
              Spotify hesabını bağlayarak profilinde şu an dinlediğin müziği gösterebilirsin — tıpkı Discord gibi.
            </div>
            <a href="#" id="spotify-connect-btn" class="btn btn-primary" style="background:linear-gradient(135deg,#1ED760,#17a84a);border:none;text-decoration:none">
              <i class="fab fa-spotify"></i> Spotify Hesabını Bağla
            </a>
          `}
          <div id="spotify-msg" class="form-error mt-4"></div>
        </div>
      </div>`;
    // Şu an çalan önizleme
    if (hasSpotify) {
      fetch('/api/spotify/now-playing/' + encodeURIComponent(currentUser.username))
        .then(r => r.json()).then(data => {
          const pre = document.getElementById('spotify-now-preview');
          if (!pre) return;
          if (data.playing) {
            pre.innerHTML = `<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:rgba(30,215,96,0.06);border:1px solid rgba(30,215,96,0.15);border-radius:8px">
              ${data.album_art ? `<img src="${data.album_art}" style="width:40px;height:40px;border-radius:6px;object-fit:cover" />` : ''}
              <div style="flex:1;min-width:0">
                <div style="font-size:10px;color:#1ED760;font-weight:600;text-transform:uppercase;letter-spacing:.5px">Şu an çalıyor</div>
                <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(data.title)}</div>
                <div style="font-size:11px;color:var(--text-muted)">${escHtml(data.artist)}</div>
              </div>
              <i class="fab fa-spotify" style="color:#1ED760;font-size:18px;flex-shrink:0"></i>
            </div>`;
          } else {
            pre.innerHTML = `<div style="font-size:12px;color:var(--text-muted);padding:8px 0">Şu an bir şey çalmıyor.</div>`;
          }
        }).catch(() => {});
    }
    $('#spotify-save-vis')?.addEventListener('click', async () => {
      try {
        await api('/spotify/visibility', { method: 'PUT', body: JSON.stringify({ show: $('#spotify-show-cb').checked }) });
        currentUser.spotify_show = $('#spotify-show-cb').checked ? 1 : 0;
        toast('Kaydedildi');
      } catch (e) { $('#spotify-msg').textContent = e.message; }
    });
    $('#spotify-connect-btn')?.addEventListener('click', e => {
      e.preventDefault();
      const token = localStorage.getItem('token');
      if (token) window.location.href = '/api/spotify/connect-redirect?token=' + encodeURIComponent(token);
    });
    $('#spotify-disconnect')?.addEventListener('click', async () => {
      try {
        await api('/spotify/disconnect', { method: 'POST' });
        currentUser.spotify_token = ''; currentUser.spotify_expires = 0;
        toast('Spotify bağlantısı kesildi');
        renderSettingsSection('spotify');
      } catch (e) { $('#spotify-msg').textContent = e.message; }
    });
  } else if (section === 'account') {
    el.innerHTML = `
      <div class="card" style="border-color:rgba(220,38,38,0.3)">
        <div class="card-header" style="background:rgba(220,38,38,0.06)">
          <span style="color:var(--accent-red2)"><i class="fas fa-exclamation-triangle"></i> Tehlikeli Bölge</span>
        </div>
        <div class="card-body">
          <div style="font-size:14px;font-weight:600;margin-bottom:8px">Hesabı Sil</div>
          <ul style="font-size:13px;color:var(--text-secondary);margin:0 0 16px 18px;line-height:1.8">
            <li>Silme talebinden sonra içeriklerin (forum, kitap, yorumlar) hemen gizlenir</li>
            <li>Hesap <strong>10 gün</strong> içinde kalıcı olarak silinir</li>
            <li>10 gün içinde giriş yaparak silme işlemini iptal edebilirsin</li>
            <li>Bu işlem geri alınamazsa tüm veriler kalıcı silinir</li>
          </ul>
          <div class="form-group">
            <label>Şifreni Girerek Onayla</label>
            <div style="position:relative">
              <input type="password" id="delete-pw" placeholder="••••••" style="padding-right:40px" />
              <button type="button" id="delete-pw-toggle" tabindex="-1" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:none;color:var(--text-muted);cursor:pointer;padding:4px;font-size:14px">
                <i class="fas fa-eye" id="delete-pw-icon"></i>
              </button>
            </div>
          </div>
          <div class="form-group">
            <label class="checkbox-label">
              <input type="checkbox" id="delete-confirm-cb" />
              <span>Hesabımın silineceğini ve bu işlemin 10 gün içinde geri alınabileceğini anlıyorum</span>
            </label>
          </div>
          <button class="btn btn-danger" id="delete-account-btn" style="width:100%;justify-content:center;background:rgba(220,38,38,0.15);border:1px solid rgba(220,38,38,0.4);color:var(--accent-red2)">
            <i class="fas fa-trash-alt"></i> Hesabımı Silmek İstiyorum
          </button>
          <div id="delete-msg" class="form-error mt-4" style="text-align:center"></div>
        </div>
      </div>`;

    $('#delete-pw-toggle').addEventListener('click', () => {
      const pw = $('#delete-pw');
      const icon = $('#delete-pw-icon');
      if (pw.type === 'password') { pw.type = 'text'; icon.className = 'fas fa-eye-slash'; }
      else { pw.type = 'password'; icon.className = 'fas fa-eye'; }
    });

    $('#delete-account-btn').addEventListener('click', async () => {
      const msg = $('#delete-msg');
      const pw = $('#delete-pw').value;
      const confirmed = $('#delete-confirm-cb').checked;
      if (!pw) { msg.textContent = 'Şifrenizi girin'; return; }
      if (!confirmed) { msg.textContent = 'Onay kutusunu işaretleyin'; return; }
      if (!confirm('Emin misiniz? Hesabınız ve içerikleriniz gizlenecek, 10 gün içinde kalıcı silinecek.')) return;
      const btn = $('#delete-account-btn');
      btn.disabled = true; btn.innerHTML = '<div class="spinner" style="width:14px;height:14px"></div>';
      try {
        await api('/auth/request-delete', { method: 'POST', body: JSON.stringify({ password: pw }) });
        // Oturumu kapat
        currentToken = ''; currentUser = null;
        localStorage.removeItem('token');
        updateNavUI();
        navigate('/');
        toast('Hesap silme talebiniz alındı. 10 gün içinde giriş yaparak iptal edebilirsiniz.');
      } catch(e) {
        msg.textContent = e.message;
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-trash-alt"></i> Hesabımı Silmek İstiyorum';
      }
    });
  }
}

function renderLogin(app) {
  if (currentUser) { navigate('/'); return; }
  document.title = 'Giriş Yap - ' + siteName;
  app.innerHTML = `<div class="auth-page">
    <div class="auth-card auth-card--enhanced card card-body">
      <img class="auth-site-logo" src="/cigcig.png" alt="CigCig">
      <div class="auth-site-wordmark">CigCig</div>
      <div class="auth-title">Tekrar hoş geldin</div>
      <p class="auth-subtitle">Hesabına giriş yap ve kaldığın yerden devam et.</p>
      <div class="form-group"><label>Kullanıcı Adı</label><input type="text" id="login-id" placeholder="kullanıcı_adı" autocomplete="username" /></div>
      <div class="form-group">
        <label>Şifre</label>
        <div style="position:relative">
          <input type="password" id="login-pw" placeholder="••••••" autocomplete="current-password" style="padding-right:40px" />
          <button type="button" id="login-pw-toggle" tabindex="-1" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:none;color:var(--text-muted);cursor:pointer;padding:4px;font-size:14px">
            <i class="fas fa-eye" id="login-pw-icon"></i>
          </button>
        </div>
      </div>
      <button class="btn btn-primary" style="width:100%;margin-top:4px" id="login-btn">Giriş Yap</button>
      <div id="login-error" class="form-error mt-4" style="text-align:center"></div>
      <div class="auth-footer">Hesabın yok mu? <a href="/kayit" data-link class="auth-link">Kayıt Ol</a></div>
    </div>
  </div>`;

  $('#login-pw-toggle').addEventListener('click', () => {
    const pw = $('#login-pw');
    const icon = $('#login-pw-icon');
    if (pw.type === 'password') { pw.type = 'text'; icon.className = 'fas fa-eye-slash'; }
    else { pw.type = 'password'; icon.className = 'fas fa-eye'; }
  });

  const doLogin = async () => {
    const login = $('#login-id').value.trim();
    const password = $('#login-pw').value;
    if (!login || !password) { $('#login-error').textContent = 'Tüm alanları doldurun'; return; }
    try {
      const data = await api('/auth/login', { method: 'POST', body: JSON.stringify({ login, password }) });
      if (data.two_factor_required) {
        app.innerHTML = `<div class="auth-page"><div class="auth-card auth-card--enhanced card card-body">
          <div style="text-align:center"><div class="auth-site-wordmark"><i class="fas fa-shield-halved"></i> Güvenlik doğrulaması</div>
          <p class="auth-subtitle">Şifren doğru. Hesabına devam etmek için ikinci adımı tamamla.</p></div>
          <div class="form-group" style="padding:16px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-card2)">
            <label>${data.method === 'email' ? 'E-posta kodu' : escHtml(data.question)}</label>
            <p class="form-hint">${data.method === 'email' ? `${escHtml(data.maskedEmail)} adresine 6 haneli bir kod gönderdik.` : 'Cevabını büyük/küçük harfe dikkat etmeden yazabilirsin.'}</p>
            <input type="text" id="login-2fa-value" inputmode="${data.method === 'email' ? 'numeric' : 'text'}" autocomplete="one-time-code" placeholder="${data.method === 'email' ? '000000' : 'Cevabın'}" maxlength="${data.method === 'email' ? '6' : '120'}" />
          </div>
          <button class="btn btn-primary" style="width:100%" id="login-2fa-btn"><i class="fas fa-check"></i> Doğrula ve giriş yap</button>
          <div id="login-2fa-error" class="form-error mt-4" style="text-align:center"></div>
        </div></div>`;
        const verify = async () => {
          const value = $('#login-2fa-value').value.trim();
          if (!value) { $('#login-2fa-error').textContent = 'Doğrulama bilgisi gerekli'; return; }
          try {
            const verified = await api('/auth/2fa/verify', { method: 'POST', body: JSON.stringify({ challenge: data.challenge, value }) });
            currentToken = verified.token; currentUser = verified.user;
            localStorage.setItem('token', currentToken);
            updateNavUI(); toast('Hoş geldiniz, ' + currentUser.username + '!'); navigate('/');
          } catch (e) { $('#login-2fa-error').textContent = e.message; }
        };
        $('#login-2fa-btn').addEventListener('click', verify);
        $('#login-2fa-value').addEventListener('keydown', e => { if (e.key === 'Enter') verify(); });
        $('#login-2fa-value').focus();
        return;
      }
      // Silinme talebi verilmiş hesap
      if (data.pending_delete) {
        const deleteAt = new Date(data.delete_at);
        const daysLeft = Math.ceil((deleteAt - Date.now()) / 86400000);
        app.innerHTML = `<div class="auth-page">
          <div class="auth-card card card-body" style="border-color:rgba(220,38,38,0.4)">
            <div style="text-align:center;margin-bottom:20px">
              <div style="font-size:40px;margin-bottom:8px">⚠️</div>
              <div style="font-size:18px;font-weight:700;color:var(--accent-red2)">Hesabınızın Silinmesi İstendi</div>
              <p style="font-size:13px;color:var(--text-secondary);margin-top:8px">
                Hesabınız <strong>${daysLeft} gün</strong> içinde kalıcı olarak silinecek.
                (${deleteAt.toLocaleDateString('tr-TR', {day:'2-digit',month:'long',year:'numeric'})})
              </p>
            </div>
            <button class="btn btn-primary" id="cancel-delete-btn" style="width:100%;justify-content:center;margin-bottom:10px">
              <i class="fas fa-undo"></i> Vazgeç, Hesabımı Geri Al
            </button>
            <button class="btn btn-outline" id="keep-delete-btn" style="width:100%;justify-content:center;color:var(--accent-red2);border-color:rgba(220,38,38,0.3)">
              <i class="fas fa-trash"></i> Hayır, Silinsin
            </button>
          </div>
        </div>`;
        $('#cancel-delete-btn').addEventListener('click', async () => {
          try {
            // Geçici tokenla cancel-delete çağır
            const r = await fetch('/api/auth/cancel-delete', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + data.temp_token }
            });
            const d = await r.json();
            if (!r.ok) throw new Error(d.error);
            // Şimdi normal giriş yap
            const loginData = await api('/auth/login', { method: 'POST', body: JSON.stringify({ login, password }) });
            currentToken = loginData.token; currentUser = loginData.user;
            localStorage.setItem('token', currentToken);
            updateNavUI(); toast('Hesabın geri alındı, hoş geldin ' + currentUser.username + '!');
            navigate('/');
          } catch(e) { toast(e.message, 'error'); }
        });
        $('#keep-delete-btn').addEventListener('click', () => {
          navigate('/');
        });
        return;
      }
      if (!data?.user?.username || !data.token) throw new Error('Kayıt tamamlandı ancak oturum bilgisi alınamadı. Lütfen giriş ekranından deneyin.');
      currentToken = data.token; currentUser = data.user;
      localStorage.setItem('token', currentToken);
      updateNavUI(); toast('Hoş geldiniz, ' + currentUser.username + '!');
      navigate('/');
    } catch (e) { $('#login-error').textContent = e.message; }
  };

  $('#login-btn').addEventListener('click', doLogin);
  $('#login-pw').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
}

function renderRegister(app) {
  if (currentUser) { navigate('/'); return; }
  let selectedRegisterAvatar = null;
  document.title = 'Kayıt Ol - ' + siteName;
  app.innerHTML = `<div class="auth-page">
    <div class="auth-card auth-card--enhanced auth-card--register card card-body">
      <img class="auth-site-logo" src="/cigcig.png" alt="CigCig">
      <div class="auth-site-wordmark">CigCig</div>
      <div class="auth-title">Kayıt Ol</div>
      <p class="auth-subtitle">CigCig'de kendi alanını oluştur.</p>
      <div class="register-profile-photo">
        <div class="register-avatar-preview" id="reg-avatar-preview"><i class="fas fa-user"></i></div>
        <div class="register-profile-copy">
          <strong>Profil fotoğrafın</strong>
          <span>İstersen şimdi ekle, daha sonra da değiştirebilirsin.</span>
          <label class="btn btn-outline btn-sm register-photo-button" for="reg-avatar">Fotoğraf seç</label>
          <input type="file" id="reg-avatar" accept="image/jpeg,image/png,image/gif,image/webp,image/avif" hidden />
          <small id="reg-avatar-name">JPG, PNG, WEBP veya GIF · en fazla 5 MB</small>
        </div>
      </div>
      <div class="form-group"><label>Kullanıcı Adı</label><input type="text" id="reg-username" placeholder="..." autocomplete="username" /></div>
      <div class="form-group">
        <label style="display:flex;align-items:center;gap:8px">
          E-posta
          <span style="font-size:11px;color:var(--text-muted);font-weight:400">İletişim için kullanılır.</span>
        </label>
        <input type="email" id="reg-email" placeholder="..." autocomplete="email" />
      </div>
      <div class="form-group">
        <label>Şifre</label>
        <div style="position:relative">
          <input type="password" id="reg-pw" placeholder="••••••" autocomplete="new-password" style="padding-right:40px" />
          <button type="button" id="reg-pw-toggle" tabindex="-1" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:none;color:var(--text-muted);cursor:pointer;padding:4px;font-size:14px">
            <i class="fas fa-eye" id="reg-pw-icon"></i>
          </button>
        </div>
      </div>
      <div class="form-group">
        <label>Doğum tarihi</label>
        <input type="date" id="reg-birth-date" max="${new Date(new Date().setFullYear(new Date().getFullYear() - 15)).toISOString().slice(0, 10)}" />
        <div class="form-hint">15 yaş altı kabul edilmez (¬‿¬) hııhıı</div>
        <div class="form-hint">Doğum tarihi bir daha değiştirilemez.</div>
      </div>
      <div class="form-group auth-2fa-choice">
        <label><i class="fas fa-shield-halved" style="color:var(--accent-red2)"></i> İki aşamalı doğrulama</label>
        <select id="reg-2fa-method">
          <option value="none">Kullanmak istemiyorum</option>
          <option value="email">E-posta kodu kullan</option>
          <option value="question">Güvenlik sorusu kullan</option>
        </select>
        <div class="form-hint">Şifrene ek olarak hesabını koruyacak yöntemi seçebilirsin.</div>
      </div>
      <div id="reg-question-fields" class="form-group" style="display:none;padding:12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-card2)">
        <label>Güvenlik sorusu</label>
        <select id="reg-2fa-question">
          <option value="En sevdiğin yemek nedir?">En sevdiğin yemek nedir?</option>
          <option value="En sevdiğin isim nedir?">En sevdiğin isim nedir?</option>
          <option value="En sevdiğin eşya nedir?">En sevdiğin eşya nedir?</option>
        </select>
        <label style="margin-top:10px">Cevabın</label>
        <input type="text" id="reg-2fa-answer" autocomplete="off" placeholder="Cevabını yaz" />
        <div class="form-hint">Büyük/küçük harf ve fazla boşluk farkı gözetilmez.</div>
      </div>
      <div class="form-group">
        <label>Hesap gizliliği</label>
        <label class="checkbox-label"><input type="checkbox" id="reg-private" /> Hesabımı gizli yap</label>
      </div>
      <div class="form-group">
        <label>Beni kimler etiketleyebilir?</label>
        <label class="radio-label"><input type="radio" name="reg-tags" value="friends" /> Arkadaşlarım (takipleştiklerim)</label>
        <label class="radio-label"><input type="radio" name="reg-tags" value="everyone" checked /> Herkes</label>
        <label class="radio-label"><input type="radio" name="reg-tags" value="nobody" /> Hiç kimse</label>
      </div>
      <details class="register-preferences">
        <summary>Profil Ayarları</summary>
        <p class="form-hint">Profilinde göstermek istediğin bilgileri seç.</p>
        <label class="checkbox-label"><input type="checkbox" data-reg-stat="forums" checked /> Konu sayısı</label>
        <label class="checkbox-label"><input type="checkbox" data-reg-stat="books" /> Kitap sayısı</label>
        <label class="checkbox-label"><input type="checkbox" data-reg-stat="comments" /> Yorum sayısı</label>
        <label class="checkbox-label"><input type="checkbox" data-reg-stat="photos" /> Fotoğraf sayısı</label>
        <label class="checkbox-label"><input type="checkbox" data-reg-stat="music" /> Müzik sayısı</label>
        <label class="checkbox-label"><input type="checkbox" data-reg-stat="followers" checked /> Takipçi sayımı</label>
        <label class="checkbox-label"><input type="checkbox" data-reg-stat="following" checked /> Takip sayımı</label>
        <label class="checkbox-label"><input type="checkbox" data-reg-stat="followers_list" checked /> Takipçilerimi göster</label>
        <label class="checkbox-label"><input type="checkbox" data-reg-stat="following_list" checked /> Takip ettiklerimi göster</label>
        <label class="checkbox-label"><input type="checkbox" id="reg-show-level" checked /> Seviye rozetini göster</label>
        <label class="checkbox-label"><input type="checkbox" id="reg-show-progress" checked /> Seviye ilerleme barını göster</label>
      </details>
      <div class="form-group">
        <label class="checkbox-label">
          <input type="checkbox" id="reg-kvkk" />
          <span>KVKK aydınlatma metnini okudum ve kabul ediyorum. <button type="button" class="btn btn-ghost btn-sm" id="kvkk-btn" style="padding:0;color:var(--accent-red2);font-size:13px">Metni oku</button></span>
        </label>
      </div>
      <button class="btn btn-primary" style="width:100%;margin-top:4px" id="reg-btn">Kayıt Ol</button>
      <div id="reg-error" class="form-error mt-4" style="text-align:center"></div>
      <div class="auth-footer">Zaten hesabın var mı? <a href="/giris" data-link class="auth-link">Giriş Yap</a></div>
    </div>
  </div>`;

  fetch('/api/settings/public').then(response => response.json()).then(settings => {
    let sections = [];
    try { sections = JSON.parse(settings.homepage_sections || '[]'); } catch { sections = []; }
    const sectionMap = { konular: 'forums', kitaplar: 'books', yorumlar: 'comments', fotograflar: 'photos', muzikler: 'music' };
    const selectedSections = Array.isArray(sections) ? sections : [];
    const defaults = new Set(selectedSections.map(section => sectionMap[section] || section));
    const details = document.querySelector('.register-preferences');
    const orderedStats = selectedSections.map(section => sectionMap[section] || section).filter(stat => ['forums', 'books', 'comments', 'photos', 'music'].includes(stat));
    if (details && defaults.size) {
      details.querySelectorAll('[data-reg-stat]').forEach(input => { input.checked = defaults.has(input.dataset.regStat); });
      const order = new Map(orderedStats.map((stat, index) => [stat, index]));
      const profileStatNames = new Set(['forums', 'books', 'comments', 'photos', 'music']);
      const statLabels = Array.from(details.querySelectorAll('.checkbox-label')).filter(label => profileStatNames.has(label.querySelector('[data-reg-stat]')?.dataset.regStat));
      const firstOtherLabel = Array.from(details.querySelectorAll('.checkbox-label')).find(label => !statLabels.includes(label));
      statLabels.sort((a, b) => (order.get(a.querySelector('[data-reg-stat]').dataset.regStat) ?? 999) - (order.get(b.querySelector('[data-reg-stat]').dataset.regStat) ?? 999));
      statLabels.forEach(label => details.insertBefore(label, firstOtherLabel || null));
    }
  }).catch(() => {});

  $('#reg-pw-toggle').addEventListener('click', () => {
    const pw = $('#reg-pw');
    const icon = $('#reg-pw-icon');
    if (pw.type === 'password') { pw.type = 'text'; icon.className = 'fas fa-eye-slash'; }
    else { pw.type = 'password'; icon.className = 'fas fa-eye'; }
  });

  $('#reg-2fa-method').addEventListener('change', () => {
    $('#reg-question-fields').style.display = $('#reg-2fa-method').value === 'question' ? 'block' : 'none';
  });

  $('#reg-avatar').addEventListener('change', e => {
    const file = e.target.files[0];
    const preview = $('#reg-avatar-preview');
    const name = $('#reg-avatar-name');
    if (!file) {
      preview.innerHTML = '<i class="fas fa-user"></i>';
      name.textContent = 'JPG, PNG, WEBP veya GIF · en fazla 5 MB';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      e.target.value = '';
      name.textContent = 'Fotoğraf 5 MB\'dan küçük olmalı';
      return;
    }
    openAvatarCrop(file, croppedFile => {
      selectedRegisterAvatar = croppedFile;
      preview.innerHTML = `<img src="${URL.createObjectURL(croppedFile)}" alt="Profil fotoğrafı önizleme" />`;
      name.textContent = 'Kırpılmış fotoğraf hazır';
    });
  });

  $('#kvkk-btn').addEventListener('click', async () => {
    try {
      const r = await api('/kvkk');
      showModal('KVKK Aydınlatma Metni', `<div style="white-space:pre-wrap;font-size:13px;line-height:1.7;color:var(--text-secondary);max-height:400px;overflow-y:auto">${escHtml(r.text)}</div>`);
    } catch {}
  });

  const doRegister = async () => {
    const username = $('#reg-username').value.trim();
    const email = $('#reg-email').value.trim();
    const password = $('#reg-pw').value;
    const kvkk_accepted = $('#reg-kvkk').checked;
    const birth_date = $('#reg-birth-date').value;
    const is_private = $('#reg-private').checked;
    const tag_permission = document.querySelector('input[name="reg-tags"]:checked')?.value || 'everyone';
    const profile_visibility = {};
    const avatar = selectedRegisterAvatar;
    const sectionNames = { forums: 'konular', books: 'kitaplar', comments: 'yorumlar', photos: 'fotograflar', music: 'muzikler' };
    const homepage_sections = [];
    document.querySelectorAll('[data-reg-stat]').forEach(input => {
      profile_visibility[input.dataset.regStat] = input.checked;
      if (input.checked && sectionNames[input.dataset.regStat]) homepage_sections.push(sectionNames[input.dataset.regStat]);
    });
    if (!username || !email || !password || !birth_date) { $('#reg-error').textContent = 'Tüm alanları doldurun'; return; }
    const birth = new Date(`${birth_date}T00:00:00`);
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    if (today.getMonth() < birth.getMonth() || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())) age--;
    if (age < 15 || birth > today) { $('#reg-error').textContent = '15 yaş altı kabul edilmez (¬‿¬) hııhıı'; return; }
    if (/\s/.test(username)) { $('#reg-error').textContent = 'Kullanıcı adında boşluk oluşamaz'; return; }
    if (!kvkk_accepted) { $('#reg-error').textContent = 'KVKK onayı zorunludur'; return; }
    try {
      const formData = new FormData();
      const show_level_badge = $('#reg-show-level').checked;
      const show_level_progress = $('#reg-show-progress').checked;
      const two_factor_method = $('#reg-2fa-method').value;
      const two_factor_question = $('#reg-2fa-question').value;
      const two_factor_answer = $('#reg-2fa-answer').value;
      Object.entries({ username, email, password, kvkk_accepted, birth_date, is_private, tag_permission, two_factor_method, two_factor_question, two_factor_answer, show_level_badge, show_level_progress, homepage_sections: JSON.stringify(homepage_sections), profile_visibility: JSON.stringify(profile_visibility) }).forEach(([key, value]) => formData.append(key, value));
      if (avatar) formData.append('avatar', avatar);
      const data = await api('/auth/register', { method: 'POST', body: formData });
      if (data.email_verification_required) {
        app.innerHTML = `<div class="auth-page"><div class="auth-card auth-card--enhanced card card-body">
          <div style="text-align:center"><div class="auth-site-wordmark"><i class="fas fa-envelope" style="color:var(--accent-red2)"></i> E-postanı doğrula</div>
          <p class="auth-subtitle">${escHtml(data.maskedEmail)} adresine 6 haneli bir kod gönderdik.</p></div>
          <div class="form-group"><label>Doğrulama kodu</label><input type="text" id="reg-email-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" /></div>
          <button class="btn btn-primary" style="width:100%" id="reg-email-verify-btn"><i class="fas fa-check"></i> E-postayı doğrula</button>
          <div id="reg-email-verify-error" class="form-error mt-4" style="text-align:center"></div>
        </div></div>`;
        const verifyRegistrationEmail = async () => {
          const code = $('#reg-email-code').value.trim();
          try {
            await api('/auth/verify-registration-email', { method: 'POST', body: JSON.stringify({ challenge: data.challenge, code }) });
            navigate('/giris');
            toast('E-posta doğrulandı. Şimdi giriş yapabilirsin.');
          } catch (e) { $('#reg-email-verify-error').textContent = e.message; }
        };
        $('#reg-email-verify-btn').addEventListener('click', verifyRegistrationEmail);
        $('#reg-email-code').addEventListener('keydown', e => { if (e.key === 'Enter') verifyRegistrationEmail(); });
        $('#reg-email-code').focus();
        return;
      }
      currentToken = data.token; currentUser = data.user;
      localStorage.setItem('token', currentToken);
      updateNavUI(); toast('Hoş geldiniz, ' + currentUser.username + '!');
      navigate('/');
    } catch (e) { $('#reg-error').textContent = e.message; }
  };

  $('#reg-btn').addEventListener('click', doRegister);
  $('#reg-pw').addEventListener('keydown', e => { if (e.key === 'Enter') doRegister(); });
}

function renderNotFound(app) {
  document.title = 'Sayfa Bulunamadı - ' + siteName;
  app.innerHTML = `<div class="container page" style="text-align:center;padding:80px 20px">
    <div style="font-size:72px;font-weight:900;color:var(--accent-red);opacity:0.3">404</div>
    <div style="font-size:24px;font-weight:700;margin-bottom:12px">Sayfa Bulunamadı</div>
    <p style="color:var(--text-secondary);margin-bottom:24px">O sayfa taze bitti abim, veremmi başkasını?</p>
    <a href="/" data-link class="btn btn-primary">Ana Sayfaya Dön</a>
  </div>`;
}

async function checkUnreadMessages() {
  try {
    const data = await api('/conversations/unread-count');
    const count = data.count || 0;
    const badge = $('#nav-msg-badge');
    const mobBadge = $('#mob-msg-badge');
    const bottomBadge = $('#mbb-msg-badge');
    if (badge) { badge.textContent = count > 9 ? '9+' : count; badge.style.display = count > 0 ? 'inline' : 'none'; }
    if (mobBadge) { mobBadge.textContent = count > 9 ? '9+' : count; mobBadge.style.display = count > 0 ? 'inline' : 'none'; }
    if (bottomBadge) { bottomBadge.textContent = count > 99 ? '99+' : count; bottomBadge.style.display = count > 0 ? 'block' : 'none'; }
  } catch {}
}

async function init() {
  $('#new-dropdown')?.classList.add('hidden');
  $('#mobile-new-dropdown')?.classList.add('hidden');
  await initAuth();
  try {
    const ps = await fetch('/api/public-settings').then(r => r.json());
    siteName = ps.site_name && ps.site_name.toLowerCase() !== 'demlik' ? ps.site_name : 'CigCig';
    firstVisitAuthEnabled = ps.first_visit_auth === '1';
    if (ps.light_primary_color) document.documentElement.style.setProperty('--light-accent', ps.light_primary_color);
    if (ps.light_background_color) document.documentElement.style.setProperty('--light-bg', ps.light_background_color);
    window.otherSongsEnabled = ps.other_songs_enabled !== '0';
    // Kitap arka plan rengi CSS değişkeni olarak ayarla
    if (ps.book_bg_color) {
      document.documentElement.style.setProperty('--book-bg', ps.book_bg_color);
      // Açık renk için koyu metin, koyu renk için açık metin
      const hex = ps.book_bg_color.replace('#','');
      const r = parseInt(hex.slice(0,2),16), g = parseInt(hex.slice(2,4),16), b = parseInt(hex.slice(4,6),16);
      const luminance = (0.299*r + 0.587*g + 0.114*b) / 255;
      document.documentElement.style.setProperty('--book-text', luminance > 0.5 ? '#2c1a0e' : '#f5f0e8');
    }
    const brandSpan = document.querySelector('.nav-brand span');
    if (brandSpan) brandSpan.textContent = siteName;
    const footer = document.getElementById('site-footer');
    if (footer) {
      footer.textContent = ps.footer_copyright_text || '© 2026 İsmail D. Tüm hakları saklıdır.';
    }
  } catch {}
  loadAnnouncements();
  renderRoute(location.pathname + location.search);
  if (currentUser) {
    checkUnreadMessages();
    setInterval(() => { if (currentUser) checkUnreadMessages(); }, 15000);
    loadNotifCount();
    setInterval(() => { if (currentUser) loadNotifCount(); }, 30000);
  }
}

async function loadAnnouncements() {
  try {
    const rows = await fetch('/api/announcements').then(r => r.json());
    const container = document.getElementById('announcements-container');
    if (!container) return;
    container.innerHTML = '';
    rows.forEach(ann => {
      const div = document.createElement('div');
      div.className = `announcement-banner ann-${ann.position || 'top'} ann-size-${ann.size || 'normal'}`;
      div.style.cssText = `background:${ann.bg_color};color:${ann.text_color};border-color:${ann.border_color};`;
      div.innerHTML = `
        <div class="ann-inner">
          <div class="ann-text"><strong>${escHtml(ann.title)}</strong> <span>${escHtml(ann.content)}</span></div>
          <button class="ann-close" onclick="this.closest('.announcement-banner').remove()" aria-label="Kapat"><i class="fas fa-times"></i></button>
        </div>`;
      container.appendChild(div);
    });
  } catch {}
}

init();

// ===== VIDEO İLET MODAL =====
async function showForwardVideoModal(video) {
  let convs = [];
  try { convs = await api('/conversations'); } catch {}
  const listHTML = convs.length === 0
    ? `<div class="empty-state" style="padding:20px"><p>Henüz mesajlaşma yok. Bir kullanıcıya mesaj gönderin.</p></div>`
    : convs.map(c => `<div class="forward-item" data-username="${escHtml(c.other_username)}" style="display:flex;align-items:center;gap:10px;padding:10px 16px;cursor:pointer;border-bottom:1px solid var(--border);transition:background 0.15s" onmouseover="this.style.background='var(--bg-hover)'" onmouseout="this.style.background=''">
      ${c.other_avatar ? `<img src="${escHtml(c.other_avatar)}" class="avatar-sm" />` : `<div class="avatar-sm avatar-placeholder"><i class="fas fa-user"></i></div>`}
      <span style="color:var(--text-primary);font-size:14px">${escHtml(c.other_username)}</span>
    </div>`).join('');
  showModal('Videoyu İlet', `
    <div style="margin-bottom:12px">
      <input id="video-fwd-search" type="text" placeholder="Kullanıcı adı ara..." style="width:100%;padding:8px 12px;background:var(--bg-card2);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:13px" />
    </div>
    <div id="video-fwd-list" style="max-height:300px;overflow-y:auto;border:1px solid var(--border);border-radius:8px">${listHTML}</div>
    <div style="margin-top:8px;display:flex;gap:8px">
      <input id="video-fwd-username" type="text" placeholder="veya direkt kullanıcı adı gir..." style="flex:1;padding:8px 12px;background:var(--bg-card2);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:13px" />
      <button class="btn btn-primary" id="video-fwd-send-btn"><i class="fas fa-paper-plane"></i> İlet</button>
    </div>
    <div id="video-fwd-error" style="color:var(--accent-red2);font-size:12px;margin-top:6px"></div>
  `);
  $('#video-fwd-search')?.addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    $$('#video-fwd-list .forward-item').forEach(el => { el.style.display = el.dataset.username.toLowerCase().includes(q) ? '' : 'none'; });
  });
  $$('#video-fwd-list .forward-item').forEach(el => {
    el.addEventListener('click', () => { $('#video-fwd-username').value = el.dataset.username; });
  });
  $('#video-fwd-send-btn').addEventListener('click', async () => {
    const username = $('#video-fwd-username').value.trim();
    if (!username) { $('#video-fwd-error').textContent = 'Kullanıcı adı girin'; return; }
    try {
      await api(`/conversation/${encodeURIComponent(username)}/messages`, { method: 'POST', body: JSON.stringify({ shared_video_id: video.id }) });
      hideModal(); toast('Video iletildi!');
      navigate('/mesajlar/' + username);
    } catch (e) { $('#video-fwd-error').textContent = e.message; }
  });
}

// ===== FORUM İLET MODAL =====
async function showForwardForumModal(forum) {
  let convs = [];
  try { convs = await api('/conversations'); } catch {}
  const listHTML = convs.length === 0
    ? `<div class="empty-state" style="padding:20px"><p>Henüz mesajlaşma yok. Bir kullanıcıya mesaj gönderin.</p></div>`
    : convs.map(c => `<div class="forward-item" data-username="${escHtml(c.other_username)}" style="display:flex;align-items:center;gap:10px;padding:10px 16px;cursor:pointer;border-bottom:1px solid var(--border);transition:background 0.15s" onmouseover="this.style.background='var(--bg-hover)'" onmouseout="this.style.background=''">
      ${c.other_avatar ? `<img src="${escHtml(c.other_avatar)}" class="avatar-sm" />` : `<div class="avatar-sm avatar-placeholder"><i class="fas fa-user"></i></div>`}
      <span style="color:var(--text-primary);font-size:14px">${escHtml(c.other_username)}</span>
    </div>`).join('');
  showModal('Forumu İlet', `
    <div style="margin-bottom:12px">
      <input id="fwd-search" type="text" placeholder="Kullanıcı adı ara..." style="width:100%;padding:8px 12px;background:var(--bg-card2);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:13px" />
    </div>
    <div id="fwd-list" style="max-height:300px;overflow-y:auto;border:1px solid var(--border);border-radius:8px">${listHTML}</div>
    <div style="margin-top:8px;display:flex;gap:8px">
      <input id="fwd-username" type="text" placeholder="veya direkt kullanıcı adı gir..." style="flex:1;padding:8px 12px;background:var(--bg-card2);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:13px" />
      <button class="btn btn-primary" id="fwd-send-btn"><i class="fas fa-paper-plane"></i> İlet</button>
    </div>
    <div id="fwd-error" style="color:var(--accent-red2);font-size:12px;margin-top:6px"></div>
  `);
  $('#fwd-search')?.addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    $$('#fwd-list .forward-item').forEach(el => { el.style.display = el.dataset.username.toLowerCase().includes(q) ? '' : 'none'; });
  });
  $$('#fwd-list .forward-item').forEach(el => {
    el.addEventListener('click', () => { $('#fwd-username').value = el.dataset.username; });
  });
  $('#fwd-send-btn').addEventListener('click', async () => {
    const username = $('#fwd-username').value.trim();
    if (!username) { $('#fwd-error').textContent = 'Kullanıcı adı girin'; return; }
    try {
      await api(`/conversation/${encodeURIComponent(username)}/messages`, { method: 'POST', body: JSON.stringify({ shared_forum_id: forum.id }) });
      hideModal(); toast('Forum iletildi!');
      navigate('/mesajlar/' + username);
    } catch (e) { $('#fwd-error').textContent = e.message; }
  });
}

async function showForwardPhotoModal(photoId) {
  let convs=[]; try { convs=await api('/conversations'); } catch {}
  const listHTML = convs.length
    ? convs.map(c => `<button type="button" class="forward-user-item" data-username="${escHtml(c.other_username)}"><span class="forward-user-avatar">${c.other_avatar ? `<img src="${escHtml(c.other_avatar)}" alt="" />` : '<i class="fas fa-user"></i>'}</span><span class="forward-user-name">${escHtml(c.other_username)}</span><i class="fas fa-check forward-user-check"></i></button>`).join('')
    : '<div class="forward-empty"><i class="fas fa-comments"></i><span>Henüz mesajlaştığın kullanıcı yok.</span></div>';
  showModal('Fotoğrafı İlet', `<div class="forward-modal"><div class="forward-modal-intro"><i class="fas fa-share"></i><span>Fotoğrafı kime göndermek istiyorsun?</span></div><label class="forward-search"><i class="fas fa-search"></i><input id="photo-fwd-search" type="search" placeholder="İsim veya kullanıcı adı ara..." autocomplete="off" /></label><div id="photo-fwd-list" class="forward-user-list">${listHTML}</div><div class="forward-direct"><span>Listede yok mu?</span><input id="photo-fwd-name" placeholder="Kullanıcı adını yaz" autocomplete="off" /></div><button class="btn btn-primary" id="photo-fwd-send" style="width:100%;margin-top:12px"><i class="fas fa-paper-plane"></i> Fotoğrafı İlet</button><div class="form-error mt-4" id="photo-fwd-error"></div></div>`);
  const selectUser = username => { $('#photo-fwd-name').value = username; $$('#photo-fwd-list .forward-user-item').forEach(item => item.classList.toggle('selected', item.dataset.username === username)); };
  $('#photo-fwd-search')?.addEventListener('input', event => { const query = event.target.value.toLocaleLowerCase('tr-TR').trim(); $$('#photo-fwd-list .forward-user-item').forEach(item => { item.hidden = !item.dataset.username.toLocaleLowerCase('tr-TR').includes(query); }); });
  $$('#photo-fwd-list .forward-user-item').forEach(item => item.addEventListener('click', () => selectUser(item.dataset.username)));
  $('#photo-fwd-send')?.addEventListener('click', async () => { const username=$('#photo-fwd-name').value.trim(); if(!username) return $('#photo-fwd-error').textContent='Önce bir kullanıcı seç veya kullanıcı adı yaz.'; try { await api('/conversation/'+encodeURIComponent(username)+'/messages',{method:'POST',body:JSON.stringify({shared_photo_id:photoId})}); hideModal();toast('Fotoğraf iletildi.');navigate('/mesajlar/'+username); } catch(e) { $('#photo-fwd-error').textContent=e.message; } });
}

// ===== MESAJLAR SAYFASI =====
async function renderMessages(app, targetUsername) {
  if (!currentUser) { navigate('/giris'); return; }
  document.title = 'Mesajlar - ' + siteName;

  let convs = [], hiddenConvs = [];
  try { convs = await api('/conversations'); } catch {}

  function convItemHTML(c, isHidden) {
    const unread = c.unread_count || 0;
    return `<div class="dm-conv-item${unread > 0 ? ' dm-unread' : ''}" data-username="${escHtml(c.other_username)}">
      ${hasUsableAvatar({ avatar: c.other_avatar, avatar_removed: c.other_avatar_removed })
        ? `<img src="${escHtml(c.other_avatar)}" class="avatar-sm" />`
        : `<div class="avatar-sm avatar-placeholder"><i class="fas fa-user"></i></div>`}
      <div class="dm-conv-info">
        <div class="dm-conv-name-row">
          <span class="dm-conv-name" ${c.other_name_color ? `style="color:${escHtml(c.other_name_color)}"` : ''}>${escHtml(c.other_username)}${isHidden ? ' <i class="fas fa-lock dm-conv-lock"></i>' : ''}</span>
          ${unread > 0 ? `<span class="dm-unread-badge">${unread > 9 ? '9+' : unread}</span>` : ''}
        </div>
        <div class="dm-conv-last">${escHtml((c.last_message || '').substring(0, 40))}</div>
      </div>
    </div>`;
  }
  const bindConversationItems = () => document.querySelectorAll('.dm-conv-item').forEach(item => {
    if (item.dataset.bound) return;
    item.dataset.bound = '1';
    item.addEventListener('click', () => {
      document.querySelectorAll('.dm-conv-item').forEach(other => other.classList.remove('active'));
      item.classList.add('active');
      navigate('/mesajlar/' + item.dataset.username);
    });
  });

  app.innerHTML = `<div class="dm-layout${targetUsername ? ' dm-mobile-chat-open' : ''}">
    <div class="dm-sidebar">
      <div class="dm-sidebar-header">
        <div class="dm-header-links">
          <button class="dm-sidebar-title dm-groups-button" id="dm-groups-btn" type="button"><i class="fas fa-users"></i> Gruplar</button>
          <button class="dm-sidebar-title dm-friends-header-button" id="dm-friends-btn" type="button"><i class="fas fa-user-friends"></i> Arkadaşlar<span id="dm-friends-badge" class="friend-request-dot"></span></button>
        </div>
        <div class="dm-sidebar-actions">
          <button class="dm-hidden-toggle-btn" id="dm-hidden-toggle-btn" title="Kilitli mesajlar" type="button"><i class="fas fa-lock"></i></button>
          <button class="btn btn-primary dm-new-message-btn" id="new-dm-btn" title="Yeni mesaj"><i class="fas fa-edit"></i></button>
        </div>
      </div>
      <div class="dm-search-wrap">
        <input id="dm-search" type="text" placeholder="Konuşma ara..." class="dm-search" />
      </div>
      <div id="dm-hidden-panel" class="dm-hidden-panel hidden">
        <div class="dm-hidden-panel-content">
          <div class="dm-hidden-panel-header">Kilitli mesajlar</div>
          <div id="dm-hidden-list" class="dm-hidden-list">
            ${hiddenConvs.length
              ? hiddenConvs.map(c => convItemHTML(c, true)).join('')
              : '<div class="dm-empty-small">Kilitli konuşma yok</div>'}
          </div>
        </div>
      </div>
      <div id="dm-conv-list" class="dm-conv-list">
        ${convs.length
          ? convs.map(c => convItemHTML(c, false)).join('')
          : '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:13px">Henüz mesaj yok</div>'}
      </div>
    </div>
    <div class="dm-main" id="dm-main">
      ${!targetUsername ? `<div class="dm-empty">
        <i class="fas fa-comments" style="font-size:44px;opacity:0.25"></i>
        <p style="color:var(--text-muted);margin-top:8px">Bir konuşma seçin</p>
      </div>` : ''}
    </div>
  </div>`;

  // Search filter
  document.getElementById('dm-search')?.addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    document.querySelectorAll('.dm-conv-item').forEach(el => {
      el.style.display = el.dataset.username.toLowerCase().includes(q) ? '' : 'none';
    });
  });

  // Hidden toggle
  document.getElementById('dm-hidden-toggle-btn')?.addEventListener('click', () => {
    showModal('Kilitli Sohbetler', `<div class="dm-unlock-screen"><i class="fas fa-lock"></i><p>Kilitli sohbetleri görmek için şifreni gir.</p><input id="dm-global-unlock-pass" type="password" placeholder="Şifre" autocomplete="off" autocapitalize="none" spellcheck="false" readonly onfocus="this.removeAttribute('readonly')" /><button class="btn btn-primary" id="dm-global-unlock-btn"><i class="fas fa-unlock"></i> Kilidi Aç</button><div id="dm-global-unlock-error" class="form-error"></div></div>`);
    $('#dm-global-unlock-btn')?.addEventListener('click', async () => {
      const button = $('#dm-global-unlock-btn');
      const password = $('#dm-global-unlock-pass')?.value || '';
      button.disabled = true;
      try {
        hiddenConvs = await api('/conversations/unlock', { method: 'POST', body: JSON.stringify({ password }) });
        hideModal();
        const panel = $('#dm-hidden-panel');
        const list = $('#dm-hidden-list');
        if (list) list.innerHTML = hiddenConvs.length ? hiddenConvs.map(c => convItemHTML(c, true)).join('') : '<div class="dm-empty-small">Kilitli konuşma yok</div>';
        bindConversationItems();
        panel?.classList.remove('hidden');
      } catch (error) {
        $('#dm-global-unlock-error').textContent = error.message || 'Şifre yanlış';
        button.disabled = false;
      }
    });
  });

  // Friends nav
  document.getElementById('dm-friends-btn')?.addEventListener('click', () => navigate('/arkadaslar'));
  document.getElementById('dm-groups-btn')?.addEventListener('click', () => showMyGroupsModal());

  // New DM
  document.getElementById('new-dm-btn')?.addEventListener('click', async () => {
    const friends = await api('/friends').catch(() => []);
    const accepted = (friends || []).filter(f => f.status === 'accepted');
    showModal('Yeni Mesaj', `
      <div class="form-group">
        <label>Kullanıcı adı</label>
        <input id="new-dm-username" type="text" placeholder="kullanici_adi" />
      </div>
      ${accepted.length ? `<div class="form-group">
        <label>Arkadaşlar</label>
        <div id="new-dm-friends" style="max-height:200px;overflow-y:auto;display:flex;flex-direction:column;gap:6px">
          ${accepted.map(f => `<button class="btn btn-outline btn-sm" style="justify-content:flex-start;gap:8px" data-action="open-dm" data-username="${escHtml(f.other_username)}">
            ${hasUsableAvatar({ avatar: f.other_avatar, avatar_removed: f.other_avatar_removed }) ? `<img src="${escHtml(f.other_avatar)}" class="avatar-sm" style="width:24px;height:24px" />` : `<div class="avatar-sm avatar-placeholder" style="width:24px;height:24px"><i class="fas fa-user" style="font-size:10px"></i></div>`}
            ${escHtml(f.other_username)}
          </button>`).join('')}
        </div>
      </div>` : ''}
      <button class="btn btn-primary" style="width:100%;margin-top:8px" id="new-dm-go"><i class="fas fa-paper-plane"></i> Mesaja Git</button>
    `);
    document.getElementById('new-dm-go')?.addEventListener('click', () => {
      const u = document.getElementById('new-dm-username')?.value.trim();
      if (!u) return;
      hideModal(); navigate('/mesajlar/' + u);
    });
    document.querySelectorAll('#new-dm-friends [data-action="open-dm"]').forEach(btn => {
      btn.addEventListener('click', () => { hideModal(); navigate('/mesajlar/' + btn.dataset.username); });
    });
  });

  // Conv item clicks
  bindConversationItems();

  if (targetUsername) {
    const activeEl = document.querySelector(`.dm-conv-item[data-username="${CSS.escape(targetUsername)}"]`);
    if (activeEl) activeEl.classList.add('active');
    await renderDMChat(targetUsername);
  }
}

// ────────────────────────────────────
let dmSelectionMode = false;
let dmSelectedIds = new Set();
let dmPollTimer = null;

async function renderDMChat(username) {
  // Önceki poll'u temizle
  if (dmPollTimer) { clearInterval(dmPollTimer); dmPollTimer = null; }

  const mainEl = document.getElementById('dm-main');
  if (!mainEl) return;
  mainEl.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%"><div class="spinner"></div></div>`;

  let data;
  try { data = await api(`/conversation/${encodeURIComponent(username)}`); }
  catch (e) {
    mainEl.innerHTML = `<div class="dm-empty"><i class="fas fa-exclamation-circle" style="font-size:32px;opacity:0.4"></i><p style="color:var(--accent-red2);margin-top:8px">${escHtml(e.message)}</p></div>`;
    return;
  }

  // Okundu işaretle + badge güncelle
  setTimeout(() => checkUnreadMessages(), 200);
  try { api(`/conversation/${encodeURIComponent(username)}/mark-read`, { method: 'POST' }); } catch {}
  const convItem = document.querySelector(`.dm-conv-item[data-username="${CSS.escape(username)}"]`);
  if (convItem) {
    convItem.classList.remove('dm-unread');
    convItem.querySelector('.dm-unread-badge')?.remove();
  }

  const { conv, other, messages, isHidden, hasPassword } = data;

  // Kilitli konuşma
  if (isHidden) {
    mainEl.innerHTML = `<div class="dm-chat">
      <div class="dm-chat-header">
        <div class="dm-chat-header-left">
          <button class="btn btn-ghost btn-sm dm-mobile-back-btn" id="dm-mobile-back-btn" style="display:none;padding:4px 8px"><i class="fas fa-arrow-left"></i></button>
          <i class="fas fa-lock" style="color:var(--accent-red2)"></i>
          <span class="dm-chat-username">${escHtml(other.username)}</span>
        </div>
      </div>
      <div class="dm-empty">
        <i class="fas fa-lock" style="font-size:36px;opacity:0.3"></i>
        <p style="color:var(--text-muted);margin-top:10px">Bu konuşma kilitli</p>
        ${hasPassword
          ? `<div style="margin-top:16px;display:flex;gap:8px;width:100%;max-width:280px">
               <input id="dm-unlock-pass" type="password" placeholder="Şifre" style="flex:1;padding:9px 12px;background:var(--bg-card2);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:14px" />
               <button class="btn btn-primary" id="dm-unlock-btn" style="flex-shrink:0">Aç</button>
             </div>`
          : `<button class="btn btn-primary" style="margin-top:14px" id="dm-unlock-btn">Kilidi Aç</button>`}
        <div id="dm-unlock-err" style="color:var(--accent-red2);font-size:12px;margin-top:8px"></div>

      </div>
    </div>`;
    document.getElementById('dm-mobile-back-btn')?.addEventListener('click', () => navigate('/mesajlar'));
    document.getElementById('dm-unlock-btn')?.addEventListener('click', async () => {
      const pass = document.getElementById('dm-unlock-pass')?.value || '';
      try {
        await api(`/conversation/${encodeURIComponent(username)}/unhide`, { method: 'POST', body: JSON.stringify({ password: pass }) });
        sessionStorage.setItem('dm_unlocked_' + username, '1');
        renderDMChat(username);
      } catch (e) { document.getElementById('dm-unlock-err').textContent = e.message; }
    });
    const layout = document.querySelector('.dm-layout');
    if (layout) layout.classList.add('dm-mobile-chat-open');
    return;
  }

  dmSelectedIds = new Set();
  dmSelectionMode = false;
  let replyToId = null;
  let pendingImg = null;
  const isSelfConversation = currentUser && (String(other.id) === String(currentUser.id) || String(other.username).toLowerCase() === String(currentUser.username).toLowerCase());

  mainEl.innerHTML = `<div class="dm-chat">
    <!-- Header -->
    <div class="dm-chat-header">
      <div class="dm-chat-header-left">
        <button class="btn btn-ghost btn-sm dm-mobile-back-btn" id="dm-mobile-back-btn" style="display:none;padding:4px 8px"><i class="fas fa-arrow-left"></i></button>
        ${hasUsableAvatar(other)
          ? `<img src="${escHtml(other.avatar)}" class="avatar-sm" style="flex-shrink:0" />`
          : `<div class="avatar-sm avatar-placeholder" style="flex-shrink:0"><i class="fas fa-user"></i></div>`}
        <a href="${profileRoute(other.username)}" data-link class="dm-chat-identity" style="color:${other.name_color || 'var(--text-primary)'}">
          <strong>${escHtml(other.username)}</strong>
        </a>
      </div>
      <div class="dm-chat-header-right">
        ${isSelfConversation ? '' : '<button class="btn btn-ghost btn-sm dm-call-btn" id="dm-call-btn" title="Sesli ara"><i class="fas fa-phone"></i><span>Sesli ara</span></button>'}
        <button class="btn btn-ghost btn-sm" id="dm-options-btn" title="Sohbet seçenekleri"><i class="fas fa-ellipsis-v"></i></button>
      </div>
    </div>

    <div class="dm-sel-actions-bar" id="dm-sel-actions-bar">
      <span class="dm-selection-label">Mesaj seçildi</span>
      <button class="btn btn-outline btn-sm" id="dm-sel-delete-me"><i class="fas fa-trash"></i> Benden Sil</button>
      <button class="btn btn-danger btn-sm" id="dm-sel-delete-all"><i class="fas fa-trash-alt"></i> Herkesten Sil</button>
      <button class="btn btn-ghost btn-sm" id="dm-sel-cancel"><i class="fas fa-times"></i> İptal</button>
    </div>

    <!-- Messages -->
    <div class="dm-messages" id="dm-messages">
      ${messages.map(m => dmMessageHTML(m, currentUser.id, false)).join('')}
    </div>

    <!-- Reply bar -->
    <div class="dm-reply-bar" id="dm-reply-bar">
      <div style="display:flex;align-items:center;gap:6px;min-width:0">
        <i class="fas fa-reply" style="font-size:11px;color:var(--accent-red2)"></i>
        <span id="dm-reply-text" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span>
      </div>
      <button onclick="window.__dmClearReply && window.__dmClearReply()" style="background:none;border:none;color:var(--text-muted);padding:2px 6px;cursor:pointer;font-size:14px">✕</button>
    </div>

    <!-- Input bar -->
    <div class="dm-input-bar">
      <div class="dm-input-wrap">
        <button class="dm-input-img-btn" id="dm-img-btn" type="button" title="Fotoğraf ekle"><i class="fas fa-image"></i></button>
        <input type="file" id="dm-img-input" accept="image/*" style="display:none" />
        <div class="dm-img-preview-wrap" id="dm-img-preview-wrap">
          <img id="dm-img-thumb" />
          <button class="dm-img-clear" onclick="window.__dmClearImg && window.__dmClearImg()" type="button">✕</button>
        </div>
        <textarea id="dm-input" placeholder="Mesaj yaz..." rows="1"></textarea>
      </div>
      <button class="dm-send-btn" id="dm-send-btn" type="button"><i class="fas fa-paper-plane"></i></button>
    </div>
  </div>`;

  // Mobile back
  document.getElementById('dm-mobile-back-btn')?.addEventListener('click', () => navigate('/mesajlar'));
  document.getElementById('dm-call-btn')?.addEventListener('click', () => {
    if (!window.RTCPeerConnection || !navigator.mediaDevices?.getUserMedia) return toast('Tarayıcınız sesli aramayı desteklemiyor', 'error');
    requestMicrophoneThenCall(username, other);
  });
  const layout = document.querySelector('.dm-layout');
  if (layout) layout.classList.add('dm-mobile-chat-open');

  // Scroll to bottom
  const msgsEl = document.getElementById('dm-messages');
  if (msgsEl) msgsEl.scrollTop = msgsEl.scrollHeight;
  enhanceLinkPreviews(msgsEl);

  // Reply management
  const setReply = (id) => { replyToId = id; };
  window.__dmClearReply = () => {
    replyToId = null;
    const rb = document.getElementById('dm-reply-bar');
    if (rb) rb.classList.remove('visible');
    const rt = document.getElementById('dm-reply-text');
    if (rt) rt.textContent = '';
  };

  // Image management
  window.__dmClearImg = () => {
    pendingImg = null;
    const pw = document.getElementById('dm-img-preview-wrap');
    if (pw) pw.style.display = 'none';
    const inp = document.getElementById('dm-img-input');
    if (inp) inp.value = '';
  };

  document.getElementById('dm-img-btn')?.addEventListener('click', () => {
    document.getElementById('dm-img-input')?.click();
  });
  document.getElementById('dm-img-input')?.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    pendingImg = file;
    const pw = document.getElementById('dm-img-preview-wrap');
    const thumb = document.getElementById('dm-img-thumb');
    if (pw && thumb) {
      const reader = new FileReader();
      reader.onload = ev => { thumb.src = ev.target.result; pw.style.display = 'block'; };
      reader.readAsDataURL(file);
    }
  });

  // Auto-resize textarea
  const textareaEl = document.getElementById('dm-input');
  if (textareaEl) {
    textareaEl.addEventListener('input', () => {
      textareaEl.style.height = 'auto';
      textareaEl.style.height = Math.min(textareaEl.scrollHeight, 120) + 'px';
    });
  }

  // Send message
  const sendDmMessage = async () => {
    const inputEl = document.getElementById('dm-input');
    const content = inputEl?.value.trim();
    if (!content && !pendingImg) return;
    const sendBtn = document.getElementById('dm-send-btn');
    if (sendBtn) sendBtn.disabled = true;

    try {
      let imageUrl = null;
      if (pendingImg) {
        const fd = new FormData();
        fd.append('image', pendingImg);
        const uploadRes = await apiForm('/upload-image', fd);
        imageUrl = uploadRes.url;
        window.__dmClearImg();
      }
      const payload = { content: content || '', reply_to_id: replyToId };
      if (imageUrl) payload.image_url = imageUrl;
      const msg = await api(`/conversation/${encodeURIComponent(username)}/messages`, {
        method: 'POST', body: JSON.stringify(payload)
      });
      if (inputEl) { inputEl.value = ''; inputEl.style.height = 'auto'; }
      window.__dmClearReply?.();
      const el = document.getElementById('dm-messages');
      if (el) {
        el.insertAdjacentHTML('beforeend', dmMessageHTML(msg, currentUser.id, false));
        enhanceLinkPreviews(el);
        el.scrollTop = el.scrollHeight;
      }
      lastPollMsgId = Number(msg.id);
    } catch (e) { toast(e.message, 'error'); }
    finally { if (sendBtn) sendBtn.disabled = false; }
  };

  document.getElementById('dm-send-btn')?.addEventListener('click', sendDmMessage);
  textareaEl?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendDmMessage(); }
  });

  // Msg menu button clicks
  let lastPollMsgId = messages.length > 0 ? Number(messages[messages.length - 1].id) : 0;
  document.getElementById('dm-messages')?.addEventListener('click', e => {
    const menuBtn = e.target.closest('.dm-msg-menu-btn');
    if (menuBtn) {
      const msgId = menuBtn.dataset.id;
      const isOwn = menuBtn.dataset.own === '1';
      showDmMsgMenu(menuBtn, msgId, isOwn, username, replyToId, setReply);
      return;
    }
    // Checkbox
    const cb = e.target.closest('.dm-msg-cb');
    if (cb) {
      const id = cb.dataset.id;
      if (cb.checked) dmSelectedIds.add(id); else dmSelectedIds.delete(id);
      updateDmSelActions();
    }
  });

  // Options
  document.getElementById('dm-options-btn')?.addEventListener('click', e => {
    e.stopPropagation();
    showDmOptionsMenu(username, conv.id);
  });

  // Sel actions
  document.getElementById('dm-sel-cancel')?.addEventListener('click', exitDmSelection);
  document.getElementById('dm-sel-delete-me')?.addEventListener('click', async () => {
    if (!dmSelectedIds.size) return;
    try {
      await api('/messages/delete-bulk', { method: 'POST', body: JSON.stringify({ ids: [...dmSelectedIds], mode: 'me' }) });
      exitDmSelection(); renderDMChat(username);
    } catch (e) { toast(e.message, 'error'); }
  });
  document.getElementById('dm-sel-delete-all')?.addEventListener('click', async () => {
    if (!dmSelectedIds.size) return;
    try {
      await api('/messages/delete-bulk', { method: 'POST', body: JSON.stringify({ ids: [...dmSelectedIds], mode: 'all' }) });
      exitDmSelection(); renderDMChat(username);
    } catch (e) { toast(e.message, 'error'); }
  });

  // Poll for new messages
  dmPollTimer = setInterval(async () => {
    if (!document.getElementById('dm-messages')) { clearInterval(dmPollTimer); dmPollTimer = null; return; }
    try {
      const conversationUpdate = await api(`/conversation/${encodeURIComponent(username)}?limit=100`);
      const refreshedMsgs = conversationUpdate?.messages || [];
      const el = document.getElementById('dm-messages');
      if (!el) return;
      const wasBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
      el.innerHTML = refreshedMsgs.map(m => dmMessageHTML(m, currentUser.id, dmSelectionMode)).join('');
      if (refreshedMsgs.length) lastPollMsgId = Number(refreshedMsgs[refreshedMsgs.length - 1].id);
      enhanceLinkPreviews(el);
      const conversationList = await api('/conversations').catch(() => []);
      const activeConversation = conversationList.find(item => String(item.other_username).toLowerCase() === String(username).toLowerCase());
      const activeConversationEl = document.querySelector(`.dm-conv-item[data-username="${CSS.escape(username)}"] .dm-conv-last`);
      if (activeConversationEl) activeConversationEl.textContent = (activeConversation?.last_message || '').substring(0, 40);
      if (wasBottom) el.scrollTop = el.scrollHeight;
    } catch {}
  }, 2500);
}

function exitDmSelection() {
  dmSelectionMode = false;
  dmSelectedIds = new Set();
  document.querySelectorAll('.dm-msg-cb-wrap').forEach(el => el.style.display = 'none');
  document.querySelectorAll('.dm-msg-cb').forEach(el => el.checked = false);
  const bar = document.getElementById('dm-sel-actions-bar');
  if (bar) bar.classList.remove('visible');
}

function updateDmSelActions() {
  const bar = document.getElementById('dm-sel-actions-bar');
  const deleteAllButton = document.getElementById('dm-sel-delete-all');
  const onlyOwnMessages = [...dmSelectedIds].every(id => document.querySelector(`.dm-msg-wrap[data-id="${id}"]`)?.classList.contains('dm-own'));
  if (bar) { if (dmSelectedIds.size > 0) bar.classList.add('visible'); else bar.classList.remove('visible'); }
  if (deleteAllButton) deleteAllButton.hidden = !dmSelectedIds.size || !onlyOwnMessages;
}

function dmMessageHTML(m, myId, selMode) {
  const isOwn = m.sender_id == myId;
  const deleted = m.deleted_for_all;
  const messageText = String(m.content || '').replace(/\s+/g, ' ').trim();
  const hiddenForMe = isOwn ? m.deleted_by_sender : m.deleted_by_receiver;
  if (hiddenForMe && !deleted) return '';

  return `<div class="dm-msg-wrap${isOwn ? ' dm-own' : ''}" data-id="${m.id}">
    <div class="dm-msg-cb-wrap" style="display:${selMode ? 'flex' : 'none'};align-items:center">
      <input type="checkbox" class="dm-msg-cb" data-id="${m.id}" ${dmSelectedIds.has(String(m.id)) ? 'checked' : ''} />
    </div>
    ${!isOwn
      ? (hasUsableAvatar({ avatar: m.sender_avatar, avatar_removed: m.sender_avatar_removed })
          ? `<img src="${escHtml(m.sender_avatar)}" class="avatar-sm" style="flex-shrink:0;align-self:flex-end" />`
          : `<div class="avatar-sm avatar-placeholder" style="flex-shrink:0;align-self:flex-end"><i class="fas fa-user"></i></div>`)
      : ''}
    <div class="dm-msg-content">
      ${m.reply_to_id && m.reply_content
        ? `<div class="dm-reply-preview">
             <span style="color:var(--text-muted);font-size:11px;font-weight:600">${escHtml(m.reply_username || '')}</span>
             <div style="font-size:12px;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml((m.reply_content || '').substring(0, 60))}</div>
           </div>`
        : ''}
      ${deleted
        ? `<div class="dm-msg-bubble dm-deleted"><i class="fas fa-ban" style="font-size:11px"></i> Mesaj silindi</div>`
        : `<div class="dm-msg-bubble">
             ${m.image_url
               ? `<img src="${escHtml(m.image_url)}" class="dm-message-image" alt="" onerror="this.remove()" onclick="window.open('${escHtml(m.image_url)}','_blank')" />`
               : ''}
             ${m.shared_forum_id
               ? `<div class="dm-shared-forum" onclick="navigate('/forum/${escHtml(m.forum_slug)}')">
                    ${m.forum_banner ? `<img src="${escHtml(m.forum_banner)}" style="width:100%;height:70px;object-fit:cover" />` : ''}
                    <div style="padding:7px 10px"><div style="font-size:12px;font-weight:600;color:var(--text-primary)">${escHtml(m.forum_title || '')}</div><div style="font-size:11px;color:var(--accent-red2)">Forum →</div></div>
                  </div>`
               : ''}
             ${m.shared_photo_id
               ? `<div class="dm-shared-forum" onclick="navigate('/fotograflar')"><img src="${escHtml(m.photo_url||'')}" style="width:100%;height:120px;object-fit:cover" /><div style="padding:7px 10px"><div style="font-size:12px;font-weight:600;color:var(--text-primary)">${escHtml(m.photo_title||m.photo_caption||'Fotoğraf')}</div><div style="font-size:11px;color:var(--accent-red2)">Fotoğraf →</div></div></div>`
               : ''}
             ${m.shared_video_id
               ? `<div class="dm-shared-forum" onclick="navigate('/video/${escHtml(m.video_slug)}')">
                    ${m.video_banner ? `<img src="${escHtml(m.video_banner)}" style="width:100%;height:70px;object-fit:cover" />` : ''}
                    <div style="padding:7px 10px"><div style="font-size:12px;font-weight:600;color:var(--text-primary)">${escHtml(m.video_title || 'Video')}</div><div style="font-size:11px;color:var(--accent-red2)">Video →</div></div>
                  </div>`
               : ''}
             ${m.shared_story_id
               ? `<div class="dm-shared-story" onclick="navigate('/hikaye/${escHtml(m.shared_story_id)}')">
                    ${m.story_media_url ? `<img src="${escHtml(m.story_media_url)}" alt="" />` : ''}
                    <div><b>${escHtml(m.story_username || 'Hikaye')}</b><small>Hikaye yanıtı</small></div>
                  </div>`
               : ''}
             ${messageText ? `<span>${renderContent(messageText)}</span>` : ''}
           </div>`}
      <div class="dm-msg-meta">
        <span style="font-size:10px;color:var(--text-muted)">${timeAgo(m.created_at)}</span>
        ${isOwn && !deleted
          ? `<span style="font-size:11px;margin-left:2px">${m.read_at
              ? '<i class="fas fa-check-double" style="color:#1ED760" title="Okundu"></i>'
              : '<i class="fas fa-check" style="color:var(--text-muted)" title="Gönderildi"></i>'}</span>`
          : ''}
        <button class="dm-msg-menu-btn btn btn-ghost" data-id="${m.id}" data-own="${isOwn ? 1 : 0}" style="padding:0 4px;font-size:12px;color:var(--text-muted)"><i class="fas fa-ellipsis-h"></i></button>
      </div>
    </div>
  </div>`;
}

// Hover: show/hide menu btn on desktop
document.addEventListener('mouseover', e => {
  const wrap = e.target.closest('.dm-msg-wrap');
  if (wrap) { const btn = wrap.querySelector('.dm-msg-menu-btn'); if (btn) btn.style.opacity = '1'; }
});
document.addEventListener('mouseout', e => {
  const wrap = e.target.closest('.dm-msg-wrap');
  if (wrap) { const btn = wrap.querySelector('.dm-msg-menu-btn'); if (btn) btn.style.opacity = '0'; }
});

function showDmMsgMenu(btn, msgId, isOwn, username, replyToId, setReply) {
  document.getElementById('dm-msg-ctx')?.remove();
  const rect = btn.getBoundingClientRect();
  const menu = document.createElement('div');
  menu.id = 'dm-msg-ctx';
  const leftPos = Math.max(8, rect.left - 160);
  const topPos = Math.min(rect.bottom + 4, window.innerHeight - 160);
  menu.style.cssText = `position:fixed;left:${leftPos}px;top:${topPos}px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:10px;z-index:9999;min-width:160px;box-shadow:0 8px 24px rgba(0,0,0,0.5);overflow:hidden`;
  const items = [
    { label: '<i class="fas fa-reply fa-fw"></i> Yanıtla', action: 'reply' },
    { label: '<i class="fas fa-check-square fa-fw"></i> Seç', action: 'select' },
    { label: '<i class="fas fa-trash fa-fw"></i> Benden Sil', action: 'delete-me' },
    ...(isOwn ? [{ label: '<i class="fas fa-trash-alt fa-fw"></i> Herkesten Sil', action: 'delete-all', danger: true }] : []),
  ];
  items.forEach(item => {
    const el = document.createElement('div');
    el.innerHTML = item.label;
    el.style.cssText = `padding:9px 14px;font-size:13px;cursor:pointer;color:${item.danger ? 'var(--accent-red2)' : 'var(--text-secondary)'};display:flex;align-items:center;gap:8px;transition:background 0.15s`;
    el.addEventListener('mouseenter', () => el.style.background = 'var(--bg-hover)');
    el.addEventListener('mouseleave', () => el.style.background = '');
    el.addEventListener('click', async () => {
      menu.remove();
      if (item.action === 'reply') {
        const msgEl = document.querySelector(`.dm-msg-wrap[data-id="${msgId}"]`);
        const content = msgEl?.querySelector('.dm-msg-bubble span')?.textContent || '';
        if (setReply) setReply(msgId);
        const rb = document.getElementById('dm-reply-bar');
        const rt = document.getElementById('dm-reply-text');
        if (rb) rb.classList.add('visible');
        if (rt) rt.textContent = content.substring(0, 60) || 'Fotoğraf';
      } else if (item.action === 'select') {
        dmSelectionMode = true;
        dmSelectedIds.add(String(msgId));
        document.querySelectorAll('.dm-msg-cb-wrap').forEach(el => el.style.display = 'flex');
        const cb = document.querySelector(`.dm-msg-cb[data-id="${msgId}"]`);
        if (cb) cb.checked = true;
        updateDmSelActions();
      } else if (item.action === 'delete-me') {
        try { await api(`/messages/${msgId}`, { method: 'DELETE', body: JSON.stringify({ mode: 'me' }) }); renderDMChat(username); }
        catch (e) { toast(e.message, 'error'); }
      } else if (item.action === 'delete-all') {
        try { await api(`/messages/${msgId}`, { method: 'DELETE', body: JSON.stringify({ mode: 'all' }) }); renderDMChat(username); }
        catch (e) { toast(e.message, 'error'); }
      }
    });
    menu.appendChild(el);
  });
  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener('click', function rm() { menu.remove(); document.removeEventListener('click', rm); }, { once: true }), 0);
}

function showDmOptionsMenu(username, convId) {
  showModal('Konuşma Seçenekleri', `
    <div style="display:flex;flex-direction:column;gap:8px">
      <div class="call-mute-title"><i class="fas fa-bell-slash"></i> Aramaları sessize al</div>
      <div class="call-mute-grid"><button class="btn btn-outline call-mute-option" data-hours="5">5 saat</button><button class="btn btn-outline call-mute-option" data-hours="10">10 saat</button><button class="btn btn-outline call-mute-option" data-hours="24">24 saat</button><button class="btn btn-outline call-mute-option" data-hours="0">Aç</button></div>
      <button class="btn btn-outline" id="dm-opt-hide"><i class="fas fa-lock"></i> Gizle / Kilitle</button>
      <button class="btn btn-outline" id="dm-opt-setpass"><i class="fas fa-key"></i> Şifre Değiştir</button>
      <button class="btn btn-danger" id="dm-opt-delete"><i class="fas fa-trash"></i> Konuşmayı Sil</button>
    </div>
  `);
  document.querySelectorAll('.call-mute-option').forEach(button => button.addEventListener('click', () => { setVoiceCallMute(Number(button.dataset.hours)); hideModal(); toast(Number(button.dataset.hours) ? `Aramalar ${button.dataset.hours} saat sessizde` : 'Arama bildirimleri açıldı'); }));
  document.getElementById('dm-opt-hide')?.addEventListener('click', () => {
    hideModal();
    showModal('Konuşmayı Gizle', `
      <p style="font-size:13px;color:var(--text-secondary);margin-bottom:12px">Şifre koyarsanız açmak için şifre gerekecek.</p>
      <div class="form-group"><label>Şifre (opsiyonel)</label><input id="dm-hide-pass" type="password" autocomplete="new-password" readonly onfocus="this.removeAttribute('readonly')" placeholder="Şifresiz bırakmak için boş bırakın" /></div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-primary" id="dm-hide-confirm" style="flex:1">Gizle</button>
        <button class="btn btn-outline" onclick="hideModal()" style="flex:1">İptal</button>
      </div>
    `);
    document.getElementById('dm-hide-confirm')?.addEventListener('click', async () => {
      const pass = document.getElementById('dm-hide-pass')?.value || '';
      try { await api(`/conversation/${encodeURIComponent(username)}/hide`, { method: 'POST', body: JSON.stringify({ password: pass }) }); hideModal(); navigate('/mesajlar'); toast('Konuşma gizlendi'); }
      catch (e) { toast(e.message, 'error'); }
    });
  });
  document.getElementById('dm-opt-setpass')?.addEventListener('click', () => {
    hideModal();
    showModal('Şifre Değiştir', `
      <div class="form-group"><label>Yeni Şifre (boş = şifresiz)</label><input id="dm-newpass" type="password" autocomplete="new-password" readonly onfocus="this.removeAttribute('readonly')" /></div>
      <button class="btn btn-primary" style="width:100%" id="dm-setpass-confirm">Kaydet</button>
    `);
    document.getElementById('dm-setpass-confirm')?.addEventListener('click', async () => {
      const pass = document.getElementById('dm-newpass')?.value || '';
      try { await api(`/conversation/${encodeURIComponent(username)}/set-password`, { method: 'POST', body: JSON.stringify({ password: pass }) }); hideModal(); toast('Şifre güncellendi'); }
      catch (e) { toast(e.message, 'error'); }
    });
  });
  document.getElementById('dm-opt-delete')?.addEventListener('click', async () => {
    if (!confirm('Konuşma silinsin mi?')) return;
    try { await api(`/conversation/${encodeURIComponent(username)}`, { method: 'DELETE' }); hideModal(); navigate('/mesajlar'); toast('Konuşma silindi'); }
    catch (e) { toast(e.message, 'error'); }
  });
}

// ===== ARKADAŞLAR SAYFASI =====
async function renderNotifications(app) {
  if (!currentUser) { navigate('/giris'); return; }
  document.title = 'Bildirimler - ' + siteName;
  app.innerHTML = `<div class="container page">
    <div class="page-header"><div class="page-title"><i class="fas fa-bell" style="color:var(--accent-red)"></i> Bildirimler</div></div>
    <div id="notif-page-list"><div class="loading-center"><div class="spinner"></div></div></div>
  </div>`;
  try {
    const notifs = await api('/notifications');
    const friends = await api('/friends').catch(() => []);
    const followRequests = await api('/follow-requests').catch(() => []);
    await api('/notifications/read-all', { method: 'POST' });
    const badge = $('#nav-notif-badge'); if (badge) badge.style.display = 'none';
    const list = $('#notif-page-list');
    if (!notifs || !notifs.length) {
      list.innerHTML = '<div class="empty-state"><i class="fas fa-bell-slash"></i><p>Bildirim yok</p></div>';
      return;
    }
    list.innerHTML = `<div style="display:flex;flex-direction:column;gap:6px">${notifs.map(n => `
      <div class="notif-page-item card card-body${n.is_read ? '' : ' notif-page-unread'}" style="display:flex;align-items:flex-start;gap:14px;cursor:default">
        ${n.actor_avatar ? `<img src="${escHtml(n.actor_avatar)}" class="notification-avatar" alt="" />` : `<div class="notification-avatar notification-avatar-placeholder"><i class="fas fa-bell"></i></div>`}
        <div style="flex:1;min-width:0">
          <div style="font-size:14px;line-height:1.5;color:var(--text-primary)">${escHtml(n.body)}</div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:4px">${timeAgo(n.created_at)}</div>
        </div>
        ${n.type === 'friend_request' ? (() => { const request = friends.find(item => item.status === 'pending' && String(item.requester_id) !== String(currentUser.id) && item.other_username === n.actor_username); return request ? `<div class="notification-actions"><button type="button" class="btn btn-primary btn-sm friend-request-action" data-request-id="${request.id}" data-action="accept">Kabul</button><button type="button" class="btn btn-outline btn-sm friend-request-action" data-request-id="${request.id}" data-action="reject">Reddet</button></div>` : ''; })() : n.type === 'follow_request' ? (() => { const request = followRequests.find(item => item.username === n.actor_username); return request ? `<div class="notification-actions"><button type="button" class="btn btn-primary btn-sm follow-request-action" data-request-id="${request.id}" data-action="accept">Kabul</button><button type="button" class="btn btn-outline btn-sm follow-request-action" data-request-id="${request.id}" data-action="reject">Reddet</button></div>` : ''; })() : n.link ? `<button type="button" class="btn btn-ghost btn-sm notification-open" data-link="${escHtml(n.link)}" title="Aç"><i class="fas fa-arrow-right"></i></button>` : ''}
        ${!n.is_read ? `<span style="width:8px;height:8px;border-radius:50%;background:var(--accent-red);flex-shrink:0;margin-top:6px"></span>` : ''}
      </div>`).join('')}</div>`;
    list.querySelectorAll('.follow-request-action').forEach(button => button.addEventListener('click', async () => {
      button.disabled = true;
      try { await api('/follow-requests/' + button.dataset.requestId + '/respond', { method: 'POST', body: JSON.stringify({ action: button.dataset.action }) }); toast(button.dataset.action === 'accept' ? 'Takip isteği kabul edildi' : 'Takip isteği reddedildi'); renderNotifications(app); }
      catch (e) { button.disabled = false; toast(e.message, 'error'); }
    }));
    list.querySelectorAll('.friend-request-action').forEach(button => button.addEventListener('click', async () => {
      button.disabled = true;
      try { await api('/friends/respond/' + button.dataset.requestId, { method: 'POST', body: JSON.stringify({ action: button.dataset.action }) }); toast(button.dataset.action === 'accept' ? 'Arkadaşlık isteği kabul edildi' : 'Arkadaşlık isteği reddedildi'); renderNotifications(app); }
      catch (e) { button.disabled = false; toast(e.message, 'error'); }
    }));
    list.querySelectorAll('.notification-open').forEach(button => button.addEventListener('click', () => navigate(button.dataset.link)));
  } catch(e) {
    const list = $('#notif-page-list');
    if (list) list.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-circle"></i><p>${e.message}</p></div>`;
  }
}

async function renderFriends(app) {
  if (!currentUser) { navigate('/giris'); return; }
  document.title = 'Arkadaşlar - ' + siteName;
  let friends = [];
  try { friends = await api('/friends'); } catch {}
  let blocks = [];
  try { blocks = await api('/blocks'); } catch {}

  const pending_in = friends.filter(f => f.status === 'pending' && f.addressee_id == currentUser.id);
  const pending_out = friends.filter(f => f.status === 'pending' && f.requester_id == currentUser.id);
  const accepted = friends.filter(f => f.status === 'accepted');

  app.innerHTML = `<div class="container page">
    <div class="page-header"><div class="page-title"><i class="fas fa-user-friends" style="color:var(--accent-red)"></i> Arkadaşlar</div></div>
    <div class="friends-page-grid">
      <div>
        <div class="tabs" style="margin-bottom:16px">
          <button class="tab active" id="tab-friends" onclick="showFriendsTab('friends')">Takipleştiklerin (${accepted.length})</button>
          <button class="tab${pending_in.length ? ' tab-has-notice' : ''}" id="tab-requests" onclick="showFriendsTab('requests')">Bekleyen İstekler${pending_in.length ? ` <span class="tab-dot"></span>` : ''} (${pending_in.length})</button>
          <button class="tab" id="tab-sent" onclick="showFriendsTab('sent')">Gönderilen İstekler (${pending_out.length})</button>
          <button class="tab" id="tab-blocked" onclick="showFriendsTab('blocked')">Engellenenler (${blocks.length})</button>
        </div>
        <div id="friends-content">
          <div id="tab-content-friends">
            ${accepted.length === 0 ? '<div class="empty-state"><i class="fas fa-user-friends"></i><p>Henüz arkadaşın yok</p></div>'
              : accepted.map(f => friendItemHTML(f, 'accepted', currentUser.id)).join('')}
          </div>
          <div id="tab-content-requests" style="display:none">
            <div class="pending-requests-panel">
              <div class="pending-requests-heading"><span class="pending-requests-icon"><i class="fas fa-user-plus"></i></span><span><b>Gelen arkadaşlık istekleri</b><small>Yeni istekleri buradan yönetebilirsin.</small></span></div>
              ${pending_in.length === 0 ? '<div class="empty-state"><i class="fas fa-inbox"></i><p>Bekleyen arkadaşlık isteği yok</p></div>' : pending_in.map(f => friendItemHTML(f, 'incoming', currentUser.id)).join('')}
            </div>
          </div>
          <div id="tab-content-sent" style="display:none">
            <div class="pending-requests-panel sent-requests-panel">
              <div class="pending-requests-heading"><span class="pending-requests-icon"><i class="fas fa-paper-plane"></i></span><span><b>Gönderilen arkadaşlık istekleri</b><small>Yanıt bekleyen isteklerini buradan takip edebilirsin.</small></span></div>
              ${pending_out.length === 0 ? '<div class="empty-state"><i class="fas fa-paper-plane"></i><p>Gönderilmiş bekleyen istek yok</p></div>' : pending_out.map(f => friendItemHTML(f, 'outgoing', currentUser.id)).join('')}
            </div>
          </div>
          <div id="tab-content-blocked" style="display:none">
            ${blocks.length === 0 ? '<div class="empty-state"><i class="fas fa-ban"></i><p>Engellenen yok</p></div>'
              : blocks.map(b => blockItemHTML(b)).join('')}
          </div>
        </div>
      </div>
      <div>
        <div class="card card-body">
          <div style="font-size:14px;font-weight:600;margin-bottom:12px"><i class="fas fa-search" style="color:var(--accent-red)"></i> Kullanıcı Ara</div>
          <div style="display:flex;gap:8px">
            <input id="friend-search-input" type="text" placeholder="Kullanıcı adı..." style="flex:1;padding:9px 12px;background:var(--bg-card2);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:13px" />
            <button class="btn btn-primary btn-sm" id="friend-search-btn"><i class="fas fa-search"></i></button>
          </div>
          <div id="friend-search-results" style="margin-top:12px"></div>
        </div>
      </div>
    </div>
  </div>`;

  window.showFriendsTab = (tab) => {
    $$('.tab').forEach(t => t.classList.remove('active'));
    $(`#tab-${tab}`)?.classList.add('active');
    ['friends','requests','sent','blocked'].forEach(t => {
      const el = $(`#tab-content-${t}`);
      if (el) el.style.display = t === tab ? '' : 'none';
    });
  };

  $('#friend-search-btn')?.addEventListener('click', () => doFriendSearch());
  $('#friend-search-input')?.addEventListener('keydown', e => { if (e.key === 'Enter') doFriendSearch(); });

  async function doFriendSearch() {
    const q = $('#friend-search-input').value.trim();
    if (!q) return;
    const res = $('#friend-search-results');
    res.innerHTML = '<div class="spinner" style="margin:12px auto"></div>';
    try {
      const users = await api(`/search/users?q=${encodeURIComponent(q)}`);
      if (!users.length) { res.innerHTML = '<p style="color:var(--text-muted);font-size:13px;text-align:center">Sonuç bulunamadı</p>'; return; }
      res.innerHTML = users.map(u => { const relation = friends.find(friend => friend.other_username === u.username); const requestPending = relation?.status === 'pending' && String(relation.requester_id) === String(currentUser.id); const accepted = relation?.status === 'accepted'; return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
        ${u.avatar ? `<img src="${escHtml(u.avatar)}" class="avatar-sm" />` : `<div class="avatar-sm avatar-placeholder"><i class="fas fa-user"></i></div>`}
        <a href="${profileRoute(u.username)}" data-link style="flex:1;color:var(--text-primary);font-size:14px">${escHtml(u.username)}</a>
        <button class="btn ${requestPending || accepted ? 'btn-outline' : 'btn-primary'} btn-sm send-friend-btn" data-username="${escHtml(u.username)}" ${requestPending || accepted ? 'disabled' : ''}><i class="fas fa-user-plus"></i> ${accepted ? 'Arkadaşsınız' : requestPending ? 'İstek gönderildi' : 'Arkadaş ekle'}</button>
      </div>`; }).join('');
      $$('.send-friend-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          try {
        await api(`/friends/request/${encodeURIComponent(btn.dataset.username)}`, { method: 'POST' });
        btn.innerHTML = '<i class="fas fa-clock"></i> İstek gönderildi';
            btn.disabled = true;
            btn.classList.remove('btn-primary');
        btn.classList.add('btn-outline');
          } catch (e) { toast(e.message, 'error'); }
        });
      });
    } catch (e) { res.innerHTML = `<p style="color:var(--accent-red2);font-size:13px">${e.message}</p>`; }
  }

  // Arkadaş aksiyonları (delegated - stopPropagation yok, buton-önce kontrol)
  app.addEventListener('click', async e => {
    const accept = e.target.closest('.friend-accept');
    const reject = e.target.closest('.friend-reject');
    const remove = e.target.closest('.friend-remove');
    const unblock = e.target.closest('.friend-unblock');
    const block = e.target.closest('.friend-block');
    const msgBtn = e.target.closest('.friend-msg');
    // Aksiyon butonu varsa önce onu işle, kart navigasyonunu engelle
    if (accept || reject || remove || block || unblock || msgBtn) {
      if (accept) { try { await api(`/friends/respond/${accept.dataset.id}`, { method: 'POST', body: JSON.stringify({ action: 'accept' }) }); renderFriends(app); } catch (err) { toast(err.message,'error'); } }
      if (reject) { try { await api(`/friends/respond/${reject.dataset.id}`, { method: 'POST', body: JSON.stringify({ action: 'reject' }) }); renderFriends(app); } catch (err) { toast(err.message,'error'); } }
      if (remove) {
        const isOutgoing = remove.title === 'İsteği İptal Et';
        const msg = isOutgoing ? 'Arkadaşlık isteğini iptal et?' : 'Arkadaşlıktan çıkart?';
        if (!confirm(msg)) return;
        try { await api(`/friends/${remove.dataset.id}`, { method: 'DELETE' }); renderFriends(app); } catch (err) { toast(err.message,'error'); }
      }
      if (block) {
        if (!confirm(`@${block.dataset.username} kullanıcısını engellemek istediğine emin misin? Mevcut arkadaşlık da silinecek.`)) return;
        try { await api(`/block/${encodeURIComponent(block.dataset.username)}`, { method: 'POST' }); renderFriends(app); } catch (err) { toast(err.message,'error'); }
      }
      if (unblock) { try { await api(`/block/${unblock.dataset.username}`, { method: 'DELETE' }); renderFriends(app); } catch (err) { toast(err.message,'error'); } }
      if (msgBtn) { navigate('/mesajlar/' + msgBtn.dataset.username); }
      return; // Kart navigasyonunu engelle
    }
    // Kart tıklaması (accepted) → mesajlara git
    const card = e.target.closest('.friend-card');
    if (card && card.dataset.type === 'accepted') {
      navigate('/mesajlar/' + card.dataset.username);
    }
  });
}

function friendItemHTML(f, type, myId) {
  const other_username = f.other_username;
  const other_avatar = f.other_avatar;
  const isDeleted = f.other_is_deleted == 1 || f.other_is_deleted === true;
  if (isDeleted) {
    return `<div class="card card-body" style="margin-bottom:8px;display:flex;align-items:center;gap:10px;opacity:0.55">
      <div class="avatar-md avatar-placeholder"><i class="fas fa-user-slash"></i></div>
      <div style="flex:1">
        <div style="font-size:14px;color:var(--text-muted);font-style:italic">hesap_yok</div>
        <div style="font-size:11px;color:var(--text-muted)">Bu hesap silindi</div>
      </div>
      ${type === 'accepted' || type === 'outgoing' ? `<button class="btn btn-ghost btn-sm friend-remove" data-id="${f.id}" title="Sil"><i class="fas fa-user-minus"></i></button>` : ''}
    </div>`;
  }
  return `<div class="card card-body friend-card" data-type="${type}" data-username="${escHtml(other_username)}" style="margin-bottom:8px;display:flex;align-items:center;gap:10px;${type === 'accepted' ? 'cursor:pointer;' : ''}">
    ${other_avatar ? `<img src="${escHtml(other_avatar)}" class="avatar-md" />` : `<div class="avatar-md avatar-placeholder"><i class="fas fa-user"></i></div>`}
    <div style="flex:1">
      <a href="${profileRoute(other_username)}" data-link style="font-weight:600;font-size:14px;color:var(--text-primary)">${escHtml(other_username)}</a>
      ${type === 'outgoing' ? `<div style="font-size:11px;color:var(--text-muted)"><i class="fas fa-clock"></i> Beklemede</div>` : ''}
      ${type === 'incoming' ? `<div style="font-size:11px;color:var(--accent-red2)"><i class="fas fa-user-plus"></i> Arkadaşlık isteği gönderdi</div>` : ''}
    </div>
    <div style="display:flex;gap:6px">
      ${type === 'accepted' ? `<button class="btn btn-outline btn-sm friend-msg" data-username="${escHtml(other_username)}"><i class="fas fa-envelope"></i> Mesaj</button>` : ''}
      ${type === 'incoming' ? `<button class="btn btn-primary btn-sm friend-accept" data-id="${f.id}"><i class="fas fa-check"></i> Kabul</button><button class="btn btn-danger btn-sm friend-reject" data-id="${f.id}"><i class="fas fa-times"></i> Reddet</button>` : ''}
      ${type === 'outgoing' ? `<button class="btn btn-ghost btn-sm friend-remove" data-id="${f.id}" title="İsteği İptal Et"><i class="fas fa-ban"></i> İptal</button>` : ''}
      ${type === 'accepted' ? `<button class="btn btn-ghost btn-sm friend-block" data-username="${escHtml(other_username)}" title="Engelle" style="color:var(--accent-red2)"><i class="fas fa-ban"></i></button>` : ''}
    </div>
  </div>`;
}

function blockItemHTML(b) {
  const isDeleted = b.is_deleted == 1 || b.is_deleted === true;
  return `<div class="card card-body" style="margin-bottom:8px;display:flex;align-items:center;gap:10px${isDeleted ? ';opacity:0.55' : ''}">
    ${!isDeleted && b.avatar ? `<img src="${escHtml(b.avatar)}" class="avatar-md" />` : `<div class="avatar-md avatar-placeholder"><i class="fas fa-${isDeleted ? 'user-slash' : 'user'}"></i></div>`}
    <div style="flex:1">
      <div style="font-weight:600;font-size:14px${isDeleted ? ';color:var(--text-muted);font-style:italic' : ''}">
        ${isDeleted ? 'hesap_gidddiiii' : escHtml(b.username)}
      </div>
      <div style="font-size:11px;color:var(--text-muted)">
        <i class="fas fa-ban"></i> ${new Date(b.created_at).toLocaleDateString('tr-TR')}
        ${isDeleted ? ' · Bu hesap silindi' : ''}
      </div>
    </div>
    ${!isDeleted ? `<button class="btn btn-outline btn-sm friend-unblock" data-username="${escHtml(b.username)}">Engeli Kaldır</button>` : ''}
  </div>`;
}


// ===== ADMİN KALKAN POPUP =====
document.addEventListener('click', e => {
  const shield = e.target.closest('.user-admin');
  if (!shield) { const p = document.getElementById('admin-shield-popup'); if (p) p.remove(); return; }
  e.stopPropagation();
  const existing = document.getElementById('admin-shield-popup');
  if (existing) { existing.remove(); return; }
  const since = shield.dataset.adminSince;
  const sinceText = since ? new Date(since).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }) : 'bilinmiyor';
  const popup = document.createElement('div');
  popup.id = 'admin-shield-popup';
  popup.style.cssText = `position:fixed;z-index:99999;background:#1a1a2e;border:1px solid #5865F2;border-radius:10px;padding:12px 16px;max-width:260px;box-shadow:0 8px 32px rgba(0,0,0,0.6);animation:fadeIn 0.15s ease`;
  popup.innerHTML = `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><i class="fas fa-shield" style="color:#5865F2;font-size:16px"></i><span style="font-weight:700;color:#e0e0ff;font-size:14px">CigCig Yetkilisi</span></div><div style="font-size:13px;font-weight:600;color:#c0c8ff;margin-bottom:4px">CigCig yetkili hesabı.</div><div style="font-size:12px;color:#8888aa">Bu kullanıcı ${sinceText} tarihinde yetkili oldu.</div>`;
  const rect = shield.getBoundingClientRect();
  document.body.appendChild(popup);
  const pw = popup.offsetWidth, ph = popup.offsetHeight;
  let left = rect.left, top = rect.bottom + 8;
  if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
  if (top + ph > window.innerHeight - 8) top = rect.top - ph - 8;
  popup.style.left = left + 'px';
  popup.style.top = top + 'px';
});

// ===== MÜZİK LİSTESİ =====
async function renderAdPortal(app) {
  document.title = 'Reklam Paneli – ' + siteName;
  app.innerHTML = `<div class="container page" style="max-width:760px"><div class="page-header"><div class="page-title"><i class="fas fa-bullhorn" style="color:var(--accent-red)"></i> Reklam Paneli</div><div class="page-subtitle">6 haneli reklam paneli kodunuzu girin.</div></div><div class="card card-body"><div style="display:flex;gap:8px"><input id="ad-portal-code" inputmode="numeric" maxlength="6" placeholder="123456" /><button class="btn btn-primary" id="ad-portal-open">Panele Gir</button></div><div id="ad-portal-error" class="form-error mt-4"></div></div><div id="ad-portal-content" style="margin-top:16px"></div></div>`;
  const submitButton = currentUser ? `<button class="btn btn-outline" id="ad-submit-new" style="margin-top:12px"><i class="fas fa-plus"></i> Reklam Gönder</button>` : '';
  document.getElementById('ad-portal-content').insertAdjacentHTML('beforebegin', submitButton);
  $('#ad-submit-new')?.addEventListener('click', showAdSubmissionModal);
  const open = async () => { const code=$('#ad-portal-code').value.trim(); if(!/^\d{6}$/.test(code)) return $('#ad-portal-error').textContent='6 haneli reklam kodunu girin.'; try { renderAdPortalEditor(await api('/reklampanel/'+code),code); } catch(e) { $('#ad-portal-error').textContent=e.message; } };
  $('#ad-portal-open').addEventListener('click',open); $('#ad-portal-code').addEventListener('keydown',e=>{if(e.key==='Enter')open();});
}
function renderAdPortalEditor(ad, code) {
  const el=$('#ad-portal-content'); if(!el)return;
  el.innerHTML=`<div class="card"><div class="card-body"><div style="display:flex;gap:16px;align-items:center;margin-bottom:18px">${ad.cover_url?`<img src="${escHtml(ad.cover_url)}" style="width:72px;height:72px;border-radius:12px;object-fit:cover"/>`:''}<div><div style="font-size:12px;color:var(--text-muted)">Panel ID: <b>${escHtml(code)}</b></div><div style="font-size:18px;font-weight:700">${escHtml(ad.title)}</div><div style="font-size:13px;color:var(--text-secondary)">${ad.play_count} dinlenme · ${ad.click_count} site tıklaması</div></div></div><div class="form-group"><label>Reklam adı</label><input id="ap-title" value="${escHtml(ad.title)}" /></div><div class="form-group"><label>Site adresi</label><input id="ap-site" value="${escHtml(ad.site_url||'')}" /></div><div class="form-row"><div class="form-group"><label>Yeni ses dosyası</label><input id="ap-audio" type="file" accept="audio/*" /></div><div class="form-group"><label>Yeni kapak</label><input id="ap-cover" type="file" accept="image/*" /></div></div><button class="btn btn-primary" id="ap-save">Değişiklikleri Kaydet</button>${currentUser ? `<button class="btn btn-outline" id="ap-boost" style="margin-left:8px"><i class="fas fa-bolt"></i> Boost Satın Al</button>` : '<a href="/giris" data-link class="btn btn-outline" style="margin-left:8px">Boost için giriş yap</a>'}<div id="ap-error" class="form-error mt-4"></div></div></div>`;
  $('#ap-save').addEventListener('click',async()=>{const fd=new FormData();fd.append('title',$('#ap-title').value.trim());fd.append('site_url',$('#ap-site').value.trim());const au=$('#ap-audio').files[0],co=$('#ap-cover').files[0];if(au)fd.append('audio',au);if(co)fd.append('cover',co);try{const r=await fetch('/api/reklampanel/'+code,{method:'PUT',body:fd});const d=await r.json();if(!r.ok)throw new Error(d.error||'Hata');renderAdPortalEditor(d,code);toast('Reklam güncellendi');}catch(e){$('#ap-error').textContent=e.message;}});
  $('#ap-boost')?.addEventListener('click', async () => { try { const products=await api('/shop/products'); const p=products.find(x=>x.type==='ad_boost'); if(!p) throw new Error('Boost ürünü mağazada etkin değil.'); const r=await api('/shop/checkout',{method:'POST',body:JSON.stringify({product_id:p.id,music_ad_code:code})}); location.href=r.payment_url; } catch(e) { $('#ap-error').textContent=e.message; } });
}

function showAdSubmissionModal() {
  showModal('Reklam Gönder', `<div class="form-group"><label>Reklam türü</label><select id="ad-submit-type"><option value="photo">Fotoğraf reklamı</option><option value="music">Müzik reklamı</option></select></div><div class="form-group"><label>Başlık</label><input id="ad-submit-title" maxlength="120"/></div><div class="form-group"><label>Açıklama</label><textarea id="ad-submit-description"></textarea></div><div class="form-group"><label>Site adresi</label><input id="ad-submit-site" placeholder="https://site.com"/></div><div class="form-group"><label id="ad-media-label">Reklam fotoğrafı</label><input id="ad-submit-media" type="file" accept="image/*"/></div><div class="form-group" id="ad-cover-group" hidden><label>Kapak fotoğrafı</label><input id="ad-submit-cover" type="file" accept="image/*"/></div><label class="checkbox-label"><input id="ad-submit-likes" type="checkbox" checked/> Beğeni açık</label><label class="checkbox-label"><input id="ad-submit-comments" type="checkbox" checked/> Yorum açık</label><label class="checkbox-label"><input id="ad-submit-shares" type="checkbox" checked/> Paylaşım açık</label><button class="btn btn-primary" id="ad-submit-save" style="width:100%;margin-top:12px">Onaya Gönder</button><div id="ad-submit-error" class="form-error mt-4"></div>`);
  const type=$('#ad-submit-type'); type.onchange=()=>{const music=type.value==='music';$('#ad-media-label').textContent=music?'Ses dosyası':'Reklam fotoğrafı';$('#ad-submit-media').accept=music?'audio/*':'image/*';$('#ad-cover-group').hidden=!music;};
  $('#ad-submit-save').onclick=async()=>{const media=$('#ad-submit-media').files[0];if(!media)return $('#ad-submit-error').textContent='Reklam dosyasını seçin.';const fd=new FormData();fd.append('type',type.value);fd.append('title',$('#ad-submit-title').value.trim());fd.append('description',$('#ad-submit-description').value.trim());fd.append('site_url',$('#ad-submit-site').value.trim());fd.append('media',media);if($('#ad-submit-cover').files[0])fd.append('cover',$('#ad-submit-cover').files[0]);fd.append('show_likes',$('#ad-submit-likes').checked);fd.append('allow_comments',$('#ad-submit-comments').checked);fd.append('allow_shares',$('#ad-submit-shares').checked);try{const r=await apiForm('/ad-submissions',fd);hideModal();toast('Reklam onaya gönderildi. Panel kodunuz: '+r.portal_code);}catch(e){$('#ad-submit-error').textContent=e.message;}};
}
async function renderMusicList(app) {
  document.title = 'Müzikler – ' + siteName;
  app.innerHTML = `<div class="container page">
    <div class="page-header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:20px">
      <div class="page-title" style="display:flex;align-items:center;gap:10px">
        <i class="fas fa-music" style="color:var(--accent-red2)"></i> Müzikler
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        ${currentUser ? `<a href="/playlistlerim" data-link class="btn btn-outline btn-sm"><i class="fas fa-list"></i> Playlistlerim</a>` : ''}
        ${currentUser && !currentUser.is_artist ? `<a href="/artist-basvuru" data-link class="btn btn-outline btn-sm"><i class="fas fa-microphone"></i> Artist Başvurusu</a>` : ''}
        ${currentUser?.is_artist ? `<a href="/artist-panel" data-link class="btn btn-primary btn-sm"><i class="fas fa-upload"></i> Şarkı Yükle</a>` : ''}
        ${currentUser && !currentUser.is_artist ? `<a href="/sarki-yukle" data-link class="btn btn-outline btn-sm"><i class="fas fa-share"></i> Şarkı Paylaş</a>` : ''}
      </div>
    </div>
    <div class="music-search-bar" style="margin-bottom:20px">
      <div class="search-bar" style="margin:0">
        <i class="fas fa-search"></i>
        <input type="text" id="music-search" placeholder="Şarkı adı, sanatçı, tür, dağıtıcı, şarkı sözü ara..." style="width:100%" />
      </div>
    </div>
    <div id="music-list"></div>
  </div>`;

  let songs = [];
  let userPlaylists = [];
  if (currentUser) {
    try { userPlaylists = await api('/playlists'); } catch {}
  }

  const showAddToPlaylistMenu = (songId, btnEl) => {
    document.querySelectorAll('.pl-add-dropdown').forEach(d => d.remove());
    if (!userPlaylists.length) {
      toast('Önce bir playlist oluşturun!', 'error'); return;
    }
    const menu = document.createElement('div');
    menu.className = 'pl-add-dropdown dropdown-menu';
    menu.style.cssText = 'position:absolute;right:0;top:calc(100% + 4px);z-index:9999;min-width:180px';
    menu.innerHTML = userPlaylists.map(pl =>
      `<button class="dropdown-item" data-plid="${pl.id}" data-songid="${songId}"><i class="fas fa-list"></i> ${escHtml(pl.name)}</button>`
    ).join('');
    btnEl.style.position = 'relative';
    btnEl.appendChild(menu);
    menu.querySelectorAll('.dropdown-item').forEach(item => {
      item.addEventListener('click', async (e) => {
        e.stopPropagation();
        menu.remove();
        try {
          await api('/playlists/' + item.dataset.plid + '/songs', { method: 'POST', body: JSON.stringify({ song_id: item.dataset.songid }) });
          toast('Playlist\'e eklendi!');
        } catch(err) { toast(err.message, 'error'); }
      });
    });
    setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 10);
  };

  const loadSongs = async (q = '') => {
    const el = document.getElementById('music-list');
    if (!el) return;
    el.innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';
    try {
      const url = q ? `/songs?q=${encodeURIComponent(q)}` : '/songs';
      songs = await api(url);
      songs.sort((a, b) => (b.play_count || 0) - (a.play_count || 0));
      if (!songs.length) { el.innerHTML = '<div class="empty-state"><i class="fas fa-music"></i><p>Henüz şarkı yok.</p></div>'; return; }
      el.innerHTML = `<div class="music-table">
        <div class="music-table-header">
          <div style="width:40px">#</div>
          <div style="flex:1">Başlık</div>
          <div style="width:160px;display:none" class="col-dist">Dağıtıcı</div>
          <div style="width:120px">Eklenme</div>
          <div style="width:80px;text-align:right">Dinlenme</div>
          ${currentUser ? '<div style="width:36px"></div>' : ''}
        </div>
        ${songs.map((s, i) => `
          <div class="music-row" data-slug="${escHtml(s.slug)}" data-id="${s.id}">
            <div class="music-num">${i+1}</div>
            <div class="music-info">
              <div class="music-cover-wrap">
                ${s.cover_url ? `<img src="${escHtml(s.cover_url)}" class="music-cover" />` : `<div class="music-cover music-cover-ph"><i class="fas fa-music"></i></div>`}
                <button class="music-play-mini" data-slug="${escHtml(s.slug)}" data-audio="${escHtml(s.audio_url)}" data-idx="${i}"><i class="fas fa-play"></i></button>
              </div>
              <div>
                <div class="music-title">${escHtml(s.title)}</div>
                <div class="music-artist">${escHtml(s.artist_name)}</div>
              </div>
            </div>
            <div class="music-dist col-dist">${escHtml(s.distributor||'-')}</div>
            <div class="music-date">${timeAgo(s.published_at)}</div>
            <div class="music-plays" style="text-align:right;font-size:12px;color:var(--text-muted)">${s.play_count} <i class="fas fa-headphones" style="font-size:10px"></i></div>
            ${currentUser ? `<div style="width:36px;text-align:right"><button class="btn-pl-add" data-song-id="${s.id}" title="Playliste ekle"><i class="fas fa-plus"></i></button></div>` : ''}
          </div>`).join('')}
      </div>`;
      el.querySelectorAll('.music-row').forEach(row => {
        row.addEventListener('click', e => {
          if (!e.target.closest('.music-play-mini') && !e.target.closest('.btn-pl-add')) navigate('/muzik/' + row.dataset.slug);
        });
      });
      el.querySelectorAll('.music-play-mini').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          const idx = parseInt(btn.dataset.idx);
          openMiniPlayer(btn.dataset.audio, btn.dataset.slug, songs[idx], songs, idx);
        });
      });
      el.querySelectorAll('.btn-pl-add').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          showAddToPlaylistMenu(btn.dataset.songId, btn.parentElement);
        });
      });
    } catch(err) { el.innerHTML = `<div class="empty-state"><p>${escHtml(err.message)}</p></div>`; }
  };

  loadSongs();
  let t; document.getElementById('music-search')?.addEventListener('input', e => {
    clearTimeout(t); t = setTimeout(() => loadSongs(e.target.value.trim()), 400);
  });
}

// ===== MÜZİK DETAY =====
let currentAudio = null;
let currentSlug = null;
// Playlist queue state
let currentQueue = [];         // [{id, slug, title, artist_name, cover_url, audio_url}, ...]
let currentQueueIndex = -1;
let playerShuffle = false;
let playerRepeatOne = false;
let shuffledIndices = [];      // shuffled order of indices
let musicAdBypass = false;
let guestMusicSongCount = 0;

async function playGuestMusicAdIfDue(onComplete) {
  guestMusicSongCount += 1;
  if (guestMusicSongCount < 2) return false;
  const result = await api('/music-ads/guest').catch(() => null);
  if (!result?.ad) return false;
  guestMusicSongCount = 0;
  playMusicAd(result.ad, onComplete);
  return true;
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) return;
  activePhotoAudio?.pause();
  activeStoryAudio?.pause();
  storyComposerAudio?.pause();
  document.querySelectorAll('video').forEach(video => video.pause());
});

function playMusicAd(ad, onComplete) {
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
  let player = document.getElementById('global-music-player');
  if (!player) { player = document.createElement('div'); player.id = 'global-music-player'; document.body.appendChild(player); }
  player.classList.add('music-ad-player');
  const audio = new Audio(ad.audio_url);
  currentAudio = audio;
  player.innerHTML = `<div class="gplayer-inner" style="justify-content:center">
    <div class="gplayer-info" style="flex:0 1 460px">
      ${ad.cover_url ? `<img src="${escHtml(ad.cover_url)}" class="gplayer-cover" />` : `<div class="gplayer-cover gplayer-cover-ph"><i class="fas fa-bullhorn"></i></div>`}
      <div style="min-width:0;flex:1"><div class="gplayer-title">Reklam · ${escHtml(ad.title)}</div><div class="gplayer-artist">Sponsorlu içerik</div></div>
      <button id="music-ad-toggle" class="gplayer-btn gplayer-play" type="button" title="Durdur"><i class="fas fa-pause"></i></button>
      ${ad.site_url ? `<button id="music-ad-link" class="btn btn-outline btn-sm" style="flex-shrink:0">Siteye Git</button>` : ''}
    </div>
  </div>`;
  player.style.display = 'block';
  api('/music-ads/' + ad.id + '/start', { method:'POST' }).catch(() => {});
  document.getElementById('music-ad-link')?.addEventListener('click', () => {
    api('/music-ads/' + ad.id + '/click', { method:'POST' }).catch(() => {});
    window.open(normalizeExternalUrl(ad.site_url), '_blank', 'noopener,noreferrer');
  });
  document.getElementById('music-ad-toggle')?.addEventListener('click', e => {
    const btn = e.currentTarget;
    if (audio.paused) {
      audio.play().then(() => { btn.title='Durdur'; btn.innerHTML='<i class="fas fa-pause"></i>'; }).catch(() => toast('Reklamı devam ettirmek için oynatmaya izin verin.', 'error'));
    } else {
      audio.pause();
      btn.title='Devam Et'; btn.innerHTML='<i class="fas fa-play"></i>';
    }
  });
  audio.addEventListener('ended', async () => {
    await api('/music-ads/' + ad.id + '/complete', { method:'POST' }).catch(() => {});
    currentAudio = null;
    if (onComplete) onComplete(); else player.style.display = 'none';
  });
  audio.addEventListener('error', () => toast('Reklam ses dosyası yüklenemedi. Reklam tamamlanana kadar müzik duraklatıldı.', 'error'));
  audio.play().catch(() => toast('Reklamı başlatmak için tarayıcıda oynatmaya izin verin.', 'error'));
}

function buildShuffledOrder(len, startIdx) {
  const arr = [];
  for (let i = 0; i < len; i++) if (i !== startIdx) arr.push(i);
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  arr.unshift(startIdx);
  return arr;
}

function openMiniPlayer(audioUrl, slug, song, queue, queueIndex) {
  // Zorunlu reklam önce kontrol edilir; yenileme veya şarkı değiştirme reklamı atlatmaz.
  if (currentUser && !musicAdBypass && !song?.is_music_ad) {
    api('/music-ads/pending').then(result => {
      if (result?.ad) return playMusicAd(result.ad, () => { musicAdBypass = true; openMiniPlayer(audioUrl, slug, song, queue, queueIndex); musicAdBypass = false; });
      musicAdBypass = true; openMiniPlayer(audioUrl, slug, song, queue, queueIndex); musicAdBypass = false;
    }).catch(() => { musicAdBypass = true; openMiniPlayer(audioUrl, slug, song, queue, queueIndex); musicAdBypass = false; });
    return;
  }
  // If queue provided, update global queue state
  if (queue && queue.length > 0) {
    currentQueue = queue;
    currentQueueIndex = queueIndex !== undefined ? queueIndex : 0;
    if (playerShuffle) shuffledIndices = buildShuffledOrder(queue.length, currentQueueIndex);
  } else if (!queue && currentQueue.length === 0) {
    // Single song – create a one-item queue
    currentQueue = [song || { slug, audio_url: audioUrl }];
    currentQueueIndex = 0;
    shuffledIndices = [0];
  }

  let player = document.getElementById('global-music-player');
  if (!player) {
    player = document.createElement('div');
    player.id = 'global-music-player';
    document.body.appendChild(player);
  }
  player.classList.remove('music-ad-player');
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
  document.querySelectorAll('.music-play-mini').forEach(b => b.innerHTML = '<i class="fas fa-play"></i>');
  const audio = new Audio(audioUrl);
  currentAudio = audio; currentSlug = slug;
  fetch('/api/songs/' + slug + '/play', { method: 'POST' }).catch(() => {});

  const title = song?.title || '', artist = song?.artist_name || '', cover = song?.cover_url || '';

  const shuffleActive = playerShuffle ? 'gplayer-mode-btn active' : 'gplayer-mode-btn';
  const repeatActive  = playerRepeatOne ? 'gplayer-mode-btn active' : 'gplayer-mode-btn';

  player.innerHTML = `
    <div class="gplayer-inner">
      <div class="gplayer-info">
        ${cover ? `<img src="${escHtml(cover)}" class="gplayer-cover" />` : `<div class="gplayer-cover gplayer-cover-ph"><i class="fas fa-music"></i></div>`}
        <div>
          <div class="gplayer-title">${escHtml(title)}</div>
          <div class="gplayer-artist">${escHtml(artist)}</div>
        </div>
      </div>
      <div class="gplayer-controls">
        <button class="${shuffleActive}" id="gp-shuffle" title="Karışık çal"><i class="fas fa-random"></i></button>
        <button class="gplayer-btn" id="gp-prev" title="Önceki"><i class="fas fa-step-backward"></i></button>
        <button class="gplayer-btn gplayer-play" id="gp-play"><i class="fas fa-pause"></i></button>
        <button class="gplayer-btn" id="gp-next" title="Sonraki"><i class="fas fa-step-forward"></i></button>
        <button class="${repeatActive}" id="gp-repeat" title="Tekrarla (bu şarkı)"><i class="fas fa-redo-alt"></i></button>
      </div>
      <div class="gplayer-progress-wrap">
        <span class="gplayer-time" id="gp-cur">0:00</span>
        <div class="gplayer-bar-wrap">
          <div class="gplayer-bar-bg">
            <div class="gplayer-bar-fill" id="gp-fill" style="width:0%"></div>
          </div>
          <input type="range" class="gplayer-seek" id="gp-seek" min="0" max="100" value="0" step="0.1" />
        </div>
        <span class="gplayer-time" id="gp-dur">0:00</span>
      </div>
      <div class="gplayer-vol-wrap">
        <button class="gplayer-vol-btn" id="gp-vol-btn" title="Ses"><i class="fas fa-volume-up"></i></button>
        <input type="range" class="gplayer-vol-slider" id="gp-vol" min="0" max="100" value="80" step="1" title="Ses seviyesi" />
      </div>
      <button class="gplayer-close" id="gp-close"><i class="fas fa-times"></i></button>
    </div>`;
  player.style.display = 'block';
  const savedVol = parseFloat(localStorage.getItem('cigcig_volume') ?? '0.8');
  audio.volume = savedVol;

  function fmtTime(s) { const m=Math.floor(s/60); return m+':'+(Math.floor(s%60)+'').padStart(2,'0'); }

  audio.addEventListener('loadedmetadata', () => { const el=document.getElementById('gp-dur'); if(el) el.textContent = fmtTime(audio.duration); const start=Math.max(0,Number(song?.start_seconds)||0); if(start && start < audio.duration) audio.currentTime=start; });
  audio.addEventListener('timeupdate', () => {
    const pct = audio.duration ? (audio.currentTime/audio.duration)*100 : 0;
    const fill = document.getElementById('gp-fill'); if(fill) fill.style.width = pct+'%';
    const seek = document.getElementById('gp-seek'); if(seek) seek.value = pct;
    const cur = document.getElementById('gp-cur'); if(cur) cur.textContent = fmtTime(audio.currentTime);
  });

  // Şarkı bitince: repeat one, sıradaki çal veya dur
  audio.addEventListener('ended', async () => {
    const continueQueue = () => {
      if (playerRepeatOne) { audio.currentTime = 0; audio.play().catch(()=>{}); return; }
      const next = getNextQueueIndex(1);
      if (next !== null) { const s = currentQueue[next]; currentQueueIndex = next; openMiniPlayer(s.audio_url, s.slug, s); }
      else { const pb=document.getElementById('gp-play'); if(pb) pb.innerHTML='<i class="fas fa-play"></i>'; }
    };
    if (!song?.is_music_ad) {
      if (currentUser) {
        const result = await api('/music-ads/song-finished', { method:'POST' }).catch(() => null);
        if (result?.ad) return playMusicAd(result.ad, continueQueue);
      } else if (await playGuestMusicAdIfDue(continueQueue)) return;
    }
    continueQueue();
    /*
    if (playerRepeatOne) {
      audio.currentTime = 0; audio.play().catch(()=>{});
      return;
    }
    const next = getNextQueueIndex(1);
    if (next !== null) {
      const s = currentQueue[next];
      currentQueueIndex = next;
      openMiniPlayer(s.audio_url, s.slug, s);
    } else {
      const pb=document.getElementById('gp-play'); if(pb) pb.innerHTML='<i class="fas fa-play"></i>';
    }
    */
  });

  document.getElementById('gp-play').addEventListener('click', () => {
    if (audio.paused) { audio.play(); document.getElementById('gp-play').innerHTML='<i class="fas fa-pause"></i>'; }
    else { audio.pause(); document.getElementById('gp-play').innerHTML='<i class="fas fa-play"></i>'; }
  });
  document.getElementById('gp-seek').addEventListener('input', e => {
    if (audio.duration) audio.currentTime = (parseFloat(e.target.value)/100)*audio.duration;
  });
  document.getElementById('gp-close').addEventListener('click', () => {
    audio.pause(); currentAudio=null; currentQueue=[]; currentQueueIndex=-1; player.style.display='none';
  });

  // Önceki / sonraki
  document.getElementById('gp-prev').addEventListener('click', () => {
    const prev = getNextQueueIndex(-1);
    if (prev !== null) { const s = currentQueue[prev]; currentQueueIndex = prev; openMiniPlayer(s.audio_url, s.slug, s); }
  });
  document.getElementById('gp-next').addEventListener('click', () => {
    const next = getNextQueueIndex(1);
    if (next !== null) { const s = currentQueue[next]; currentQueueIndex = next; openMiniPlayer(s.audio_url, s.slug, s); }
  });

  // Karışık modunu aç/kapat
  document.getElementById('gp-shuffle').addEventListener('click', () => {
    playerShuffle = !playerShuffle;
    document.getElementById('gp-shuffle').classList.toggle('active', playerShuffle);
    if (playerShuffle) shuffledIndices = buildShuffledOrder(currentQueue.length, currentQueueIndex);
  });

  // Tekrar modunu aç/kapat
  document.getElementById('gp-repeat').addEventListener('click', () => {
    playerRepeatOne = !playerRepeatOne;
    document.getElementById('gp-repeat').classList.toggle('active', playerRepeatOne);
  });

  // Ses kontrolü
  const volSlider = document.getElementById('gp-vol');
  const volBtn = document.getElementById('gp-vol-btn');
  if (volSlider) {
    volSlider.value = Math.round(savedVol * 100);
    const updateVolIcon = (v) => {
      if (!volBtn) return;
      volBtn.innerHTML = v === 0 ? '<i class="fas fa-volume-mute"></i>' : v < 50 ? '<i class="fas fa-volume-down"></i>' : '<i class="fas fa-volume-up"></i>';
    };
    updateVolIcon(Math.round(savedVol * 100));
    volSlider.addEventListener('input', e => {
      const v = parseInt(e.target.value);
      audio.volume = v / 100;
      localStorage.setItem('cigcig_volume', v / 100);
      updateVolIcon(v);
    });
  }
  if (volBtn) {
    volBtn.addEventListener('click', () => {
      if (audio.volume > 0) {
        audio.volume = 0; if(volSlider) volSlider.value = 0;
        localStorage.setItem('cigcig_volume', '0');
        volBtn.innerHTML = '<i class="fas fa-volume-mute"></i>';
      } else {
        audio.volume = 0.8; if(volSlider) volSlider.value = 80;
        localStorage.setItem('cigcig_volume', '0.8');
        volBtn.innerHTML = '<i class="fas fa-volume-up"></i>';
      }
    });
  }

  const detailPlay = document.getElementById('detail-play-btn');
  if (detailPlay) detailPlay.innerHTML = '<i class="fas fa-pause"></i> Durdur';

  audio.play().catch(() => {});
}

// Kuyrukta önceki/sonraki indeksi hesapla
function getNextQueueIndex(dir) { // dir: +1 ileri, -1 geri
  if (currentQueue.length <= 1) return null;
  if (playerShuffle && shuffledIndices.length > 0) {
    const pos = shuffledIndices.indexOf(currentQueueIndex);
    const newPos = pos + dir;
    if (newPos < 0 || newPos >= shuffledIndices.length) return null;
    return shuffledIndices[newPos];
  } else {
    const newIdx = currentQueueIndex + dir;
    if (newIdx < 0 || newIdx >= currentQueue.length) return null;
    return newIdx;
  }
}

async function renderMusicDetail(app, slug) {
  app.innerHTML = '<div class="container page"><div class="loading-center"><div class="spinner"></div></div></div>';
  let song;
  try { song = await api('/songs/' + slug); } catch {
    app.innerHTML = '<div class="container page"><div class="empty-state"><i class="fas fa-music"></i><p>Şarkı bulunamadı.</p></div></div>'; return;
  }
  document.title = `${song.title} – ${song.artist_name} | ${siteName}`;
  const isOwn = song.song_type === 'own';
  const hasLyrics = !!song.lyrics?.trim();
  const isUploader = currentUser && currentUser.id === song.uploader_id;

  app.innerHTML = `
    <div class="song-detail-page">
      <div class="song-detail-hero">
        <div class="song-detail-cover-wrap">
          ${song.cover_url
            ? `<img src="${escHtml(song.cover_url)}" class="song-detail-cover" />`
            : `<div class="song-detail-cover song-detail-cover-ph"><i class="fas fa-music"></i></div>`}
        </div>
        <div class="song-detail-meta-col">
          <div class="song-detail-type">${isOwn ? '<i class="fas fa-microphone-alt"></i> Sanatçı Şarkısı' : '<i class="fas fa-share-alt"></i> Paylaşılan Şarkı'}</div>
          <div class="song-detail-title">${escHtml(song.title)}</div>
          <div class="song-detail-artist">${escHtml(song.artist_name)}</div>
          <div class="song-detail-info-row">
            ${song.genre ? `<span class="song-detail-tag"><i class="fas fa-tag"></i> ${escHtml(song.genre)}</span>` : ''}
            ${song.distributor ? `<span class="song-detail-tag"><i class="fas fa-building"></i> ${escHtml(song.distributor)}</span>` : ''}
            <span class="song-detail-tag"><i class="fas fa-headphones"></i> ${song.play_count} dinlenme</span>
            <span class="song-detail-tag"><i class="fas fa-calendar-alt"></i> ${formatDate(song.published_at)}</span>
          </div>

          <div class="song-detail-player" id="song-detail-player">
            <audio id="detail-audio" src="${escHtml(song.audio_url)}" preload="metadata"></audio>
            <div class="sdp-top-row">
              <button class="sdp-play-btn" id="detail-play-btn"><i class="fas fa-play"></i></button>
              <div class="sdp-progress-wrap">
                <span class="sdp-time" id="dp-cur">0:00</span>
                <div class="sdp-bar-bg">
                  <div class="sdp-bar-fill" id="dp-fill"></div>
                  <input type="range" class="sdp-seek" id="dp-seek" min="0" max="100" value="0" step="0.1" />
                </div>
                <span class="sdp-time" id="dp-dur">0:00</span>
              </div>
              <div class="sdp-vol-wrap">
                <button id="detail-vol-btn" class="sdp-vol-btn" title="Ses"><i class="fas fa-volume-up"></i></button>
                <input type="range" id="detail-vol" min="0" max="100" value="80" step="1" class="sdp-vol-slider" />
              </div>
            </div>
          </div>

          <div class="song-detail-actions-row">
            ${isUploader ? `
              <button class="btn btn-outline btn-sm" id="song-edit-btn"><i class="fas fa-edit"></i> Düzenle</button>
              <button class="btn btn-sm" id="song-delete-btn" style="background:rgba(220,38,38,0.12);color:var(--accent-red2);border:1px solid rgba(220,38,38,0.25)"><i class="fas fa-trash"></i> Sil</button>
            ` : ''}
          </div>

          ${song.uploader_username ? `
            <div class="song-detail-uploader">
              <span style="font-size:12px;color:var(--text-muted)">Yükleyen: </span>
              <a href="${profileRoute(song.uploader_username)}" data-link class="song-detail-uploader-link">
                ${song.uploader_avatar ? `<img src="${escHtml(song.uploader_avatar)}" class="avatar-xs" />` : `<div class="avatar-xs avatar-placeholder"><i class="fas fa-user" style="font-size:9px"></i></div>`}
                ${escHtml(song.uploader_username)}
              </a>
            </div>
          ` : ''}

          ${!isOwn && song.share_reason ? `
            <div class="song-share-note">
              <i class="fas fa-comment-dots"></i>
              <span>${escHtml(song.share_reason)}</span>
            </div>
          ` : ''}
        </div>
      </div>

      ${hasLyrics ? `
        <div class="song-lyrics-section">
          <div class="song-lyrics-title"><i class="fas fa-align-left"></i> Şarkı Sözleri</div>
          <div class="song-lyrics-text">${escHtml(song.lyrics)}</div>
        </div>
      ` : ''}
    </div>
  `;

  const audio = document.getElementById('detail-audio');
  const playBtn = document.getElementById('detail-play-btn');
  const fill = document.getElementById('dp-fill');
  const seek = document.getElementById('dp-seek');
  const curEl = document.getElementById('dp-cur');
  const durEl = document.getElementById('dp-dur');

  function fmt(s) { const m=Math.floor(s/60); return m+':'+(Math.floor(s%60)+'').padStart(2,'0'); }

  audio.addEventListener('loadedmetadata', () => { if(durEl) durEl.textContent = fmt(audio.duration); });
  audio.addEventListener('timeupdate', () => {
    const pct = audio.duration ? (audio.currentTime/audio.duration)*100 : 0;
    if(fill) fill.style.width = pct + '%';
    if(seek) seek.value = pct;
    if(curEl) curEl.textContent = fmt(audio.currentTime);
  });
  audio.addEventListener('ended', async () => {
    playBtn.innerHTML = '<i class="fas fa-play"></i>';
    if (currentUser) {
      const result = await api('/music-ads/song-finished', { method:'POST' }).catch(() => null);
      if (result?.ad) playMusicAd(result.ad);
    } else if (await playGuestMusicAdIfDue(() => {})) return;
  });

  let halfCounted = false;
  playBtn.addEventListener('click', async () => {
    if (audio.paused) {
      if (currentUser) {
        const pending = await api('/music-ads/pending').catch(() => null);
        if (pending?.ad) return playMusicAd(pending.ad, () => { audio.play().catch(() => {}); playBtn.innerHTML = '<i class="fas fa-pause"></i>'; });
      }
      audio.play();
      playBtn.innerHTML = '<i class="fas fa-pause"></i>';
    } else {
      audio.pause();
      playBtn.innerHTML = '<i class="fas fa-play"></i>';
    }
  });

  audio.addEventListener('timeupdate', () => {
    if (!halfCounted && audio.duration && (audio.currentTime / audio.duration) >= 0.5) {
      halfCounted = true;
      fetch('/api/songs/'+slug+'/play-half', {method:'POST'}).catch(()=>{});
    }
  });

  seek?.addEventListener('input', e => { if(audio.duration) audio.currentTime=(parseFloat(e.target.value)/100)*audio.duration; });

  const savedVol = parseFloat(localStorage.getItem('cigcig_volume') ?? '0.8');
  audio.volume = savedVol;
  const detailVolSlider = document.getElementById('detail-vol');
  const detailVolBtn = document.getElementById('detail-vol-btn');
  if (detailVolSlider) {
    detailVolSlider.value = Math.round(savedVol * 100);
    const updateVolIcon = (v) => {
      if (!detailVolBtn) return;
      detailVolBtn.innerHTML = v === 0 ? '<i class="fas fa-volume-mute"></i>' : v < 50 ? '<i class="fas fa-volume-down"></i>' : '<i class="fas fa-volume-up"></i>';
    };
    updateVolIcon(Math.round(savedVol * 100));
    detailVolSlider.addEventListener('input', e => {
      const v = parseInt(e.target.value);
      audio.volume = v / 100;
      localStorage.setItem('cigcig_volume', v / 100);
      updateVolIcon(v);
    });
    detailVolBtn?.addEventListener('click', () => {
      if (audio.volume > 0) {
        audio.volume = 0; detailVolSlider.value = 0;
        localStorage.setItem('cigcig_volume', '0');
        if (detailVolBtn) detailVolBtn.innerHTML = '<i class="fas fa-volume-mute"></i>';
      } else {
        audio.volume = 0.8; detailVolSlider.value = 80;
        localStorage.setItem('cigcig_volume', '0.8');
        if (detailVolBtn) detailVolBtn.innerHTML = '<i class="fas fa-volume-up"></i>';
      }
    });
  }

  // Sil butonu
  const deleteBtn = document.getElementById('song-delete-btn');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', async () => {
      if (!confirm('Bu şarkıyı silmek istediğinden emin misin?')) return;
      try {
        await api('/songs/' + song.id, { method: 'DELETE' });
        toast('Şarkı silindi');
        navigate('/muzikler');
      } catch(e) { toast(e.message, 'error'); }
    });
  }

  // Düzenle butonu
  const editBtn = document.getElementById('song-edit-btn');
  if (editBtn) {
    editBtn.addEventListener('click', () => {
      showModal(`✏️ Şarkıyı Düzenle — ${escHtml(song.title)}`, `
        <div class="form-group"><label>Şarkı Adı</label><input id="ue-title" value="${escHtml(song.title)}" /></div>
        ${song.song_type === 'own' ? `
        <div class="form-row">
          <div class="form-group"><label>Sanatçı Adı</label><input id="ue-artist" value="${escHtml(song.artist_name)}" /></div>
          <div class="form-group"><label>Dağıtıcı</label><input id="ue-dist" value="${escHtml(song.distributor||'')}" /></div>
        </div>` : `
        <div class="form-group"><label>Sanatçı Adı</label><input id="ue-artist" value="${escHtml(song.artist_name)}" /></div>`}
        <div class="form-group"><label>Müzik Türü</label><input id="ue-genre" value="${escHtml(song.genre||'')}" /></div>
        <div class="form-group"><label>Şarkı Sözleri</label><textarea id="ue-lyrics" rows="5">${escHtml(song.lyrics||'')}</textarea></div>
        ${song.song_type === 'other' ? `<div class="form-group"><label>Paylaşma Sebebi</label><textarea id="ue-reason" rows="2">${escHtml(song.share_reason||'')}</textarea></div>` : ''}
        <div class="form-group"><label>Yeni Kapak Fotoğrafı <span style="font-size:11px;color:var(--text-muted)">(boş bırak = değişmez)</span></label>
          <input type="file" id="ue-cover" accept="image/*" style="background:var(--bg-card2);border:1px dashed var(--border);padding:8px;cursor:pointer;border-radius:8px" />
        </div>
        <div class="form-group"><label>Yeni Ses Dosyası <span style="font-size:11px;color:var(--text-muted)">(boş bırak = değişmez)</span></label>
          <input type="file" id="ue-audio" accept="audio/*" style="background:var(--bg-card2);border:1px dashed var(--border);padding:8px;cursor:pointer;border-radius:8px" />
        </div>
        <button class="btn btn-primary" id="ue-save" style="width:100%;justify-content:center"><i class="fas fa-save"></i> Kaydet</button>
        <div id="ue-msg" style="margin-top:8px;font-size:12px;color:var(--accent-red2);text-align:center"></div>
      `);
      document.getElementById('ue-save').addEventListener('click', async () => {
        const btn = document.getElementById('ue-save');
        const msg = document.getElementById('ue-msg');
        btn.disabled = true; btn.innerHTML = '<div class="spinner" style="width:14px;height:14px"></div>';
        const fd = new FormData();
        fd.append('title', document.getElementById('ue-title').value.trim());
        fd.append('artist_name', document.getElementById('ue-artist').value.trim());
        fd.append('genre', document.getElementById('ue-genre')?.value.trim() || '');
        fd.append('lyrics', document.getElementById('ue-lyrics')?.value.trim() || '');
        const dist = document.getElementById('ue-dist'); if (dist) fd.append('distributor', dist.value.trim());
        const reason = document.getElementById('ue-reason'); if (reason) fd.append('share_reason', reason.value.trim());
        const coverFile = document.getElementById('ue-cover')?.files[0]; if (coverFile) fd.append('cover', coverFile);
        const audioFile = document.getElementById('ue-audio')?.files[0]; if (audioFile) fd.append('audio', audioFile);
        try {
          await apiForm('/songs/' + song.id, fd, 'PUT');
          hideModal();
          toast('Şarkı güncellendi!');
          navigate('/muzik/' + slug);
        } catch(e) {
          msg.textContent = e.message;
          btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Kaydet';
        }
      });
    });
  }
}

async function renderArtistApply(app) {
  if (!currentUser) { navigate('/giris'); return; }
  document.title = 'Artist Başvurusu – ' + siteName;
  let existing = null;
  try { existing = await api('/artist/my-application'); } catch {}

  const isPending = existing?.status === 'pending';
  const isAccepted = existing?.status === 'accepted';
  const isRejected = existing?.status === 'rejected';

  if (isAccepted || currentUser.is_artist) {
    app.innerHTML = `<div class="container page" style="max-width:600px;margin:0 auto">
      <div style="text-align:center;padding:60px 20px">
        <div style="font-size:48px;margin-bottom:16px">🎤</div>
        <div style="font-size:22px;font-weight:700;margin-bottom:8px">Artist Rozetiniz Var!</div>
        <p style="color:var(--text-secondary);margin-bottom:24px">Şarkı yüklemek için artist paneline gidin.</p>
        <a href="/artist-panel" data-link class="btn btn-primary"><i class="fas fa-music"></i> Artist Paneli</a>
      </div>
    </div>`;
    return;
  }

  app.innerHTML = `<div class="container page" style="max-width:600px;margin:0 auto">
    <div class="page-title"><i class="fas fa-microphone" style="color:var(--accent-red2);margin-right:8px"></i>Artist Rozeti Başvurusu</div>
    ${isPending ? `
      <div class="card" style="margin-bottom:20px">
        <div class="card-body" style="text-align:center;padding:40px">
          <div style="font-size:40px;margin-bottom:12px">⏳</div>
          <div style="font-size:18px;font-weight:700">Başvurunuz Bekliyor</div>
          <p style="color:var(--text-secondary);margin-top:8px">Ekibimiz başvurunuzu inceliyor. Onaylanınca bildirim alacaksınız.</p>
        </div>
      </div>` : ''}
    ${isRejected ? `
      <div class="card" style="margin-bottom:20px;border-color:rgba(220,38,38,0.4)">
        <div class="card-body" style="padding:16px">
          <div style="color:var(--accent-red2);font-weight:600"><i class="fas fa-times-circle"></i> Başvurunuz Reddedildi</div>
          <p style="font-size:13px;color:var(--text-secondary);margin-top:6px">Yeniden başvurabilirsiniz.</p>
        </div>
      </div>` : ''}
    ${!isPending ? `
    <div class="card">
      <div class="card-body">
        <p style="font-size:14px;color:var(--text-secondary);margin-bottom:20px">
          Artist rozeti alarak kendi şarkılarınızı CigCig'te yayınlayabilirsiniz.
        </p>
        <div class="form-group"><label>Müzik Türünüz *</label>
          <input id="apply-genre" placeholder="Pop, Rock, Hip-Hop, Elektronik..." />
        </div>
        <div class="form-group"><label>Örnek Şarkı URL (SoundCloud, YouTube vb.)</label>
          <input id="apply-url" placeholder="https://soundcloud.com/..." />
        </div>
        <div class="form-group"><label>veya Örnek Şarkı Dosyası Yükle</label>
          <input type="file" id="apply-file" accept="audio/*" style="background:var(--bg-card2);border:1px dashed var(--border);padding:10px;cursor:pointer" />
        </div>
        <div class="form-group"><label>Notunuz (isteğe bağlı)</label>
          <textarea id="apply-note" rows="3" placeholder="Kendinizi kısaca tanıtın..."></textarea>
        </div>
        <button class="btn btn-primary" id="apply-submit" style="width:100%;justify-content:center">
          <i class="fas fa-paper-plane"></i> Başvuruyu Gönder
        </button>
        <div id="apply-msg" style="margin-top:8px;font-size:12px"></div>
      </div>
    </div>` : ''}
  </div>`;

  document.getElementById('apply-submit')?.addEventListener('click', async () => {
    const genre = document.getElementById('apply-genre')?.value.trim();
    const url = document.getElementById('apply-url')?.value.trim();
    const file = document.getElementById('apply-file')?.files[0];
    const note = document.getElementById('apply-note')?.value.trim();
    const msg = document.getElementById('apply-msg');
    if (!genre) { msg.style.color='var(--accent-red2)'; msg.textContent='Müzik türü zorunlu'; return; }
    if (!url && !file) { msg.style.color='var(--accent-red2)'; msg.textContent='URL veya dosya gerekli'; return; }
    const btn = document.getElementById('apply-submit');
    btn.disabled=true; btn.textContent='Gönderiliyor...';
    try {
      const fd = new FormData();
      fd.append('genre', genre);
      fd.append('sample_song_url', url||'');
      fd.append('note', note||'');
      if (file) fd.append('sample_file', file);
      await apiForm('/artist/apply', fd);
      msg.style.color='var(--accent-red2)'; // green
      app.innerHTML = `<div class="container page" style="max-width:600px;margin:0 auto;text-align:center;padding:60px 20px">
        <div style="font-size:48px">⏳</div>
        <div style="font-size:22px;font-weight:700;margin-top:12px">Başvurunuz Alındı!</div>
        <p style="color:var(--text-secondary);margin-top:8px">Ekibimiz inceleyecek, onaylanınca bildirim alırsınız.</p>
        <a href="/" data-link class="btn btn-outline" style="margin-top:20px">Ana Sayfaya Dön</a>
      </div>`;
    } catch(e) { msg.style.color='var(--accent-red2)'; msg.textContent=e.message; btn.disabled=false; btn.innerHTML='<i class="fas fa-paper-plane"></i> Başvuruyu Gönder'; }
  });
}

// ===== ARTİST PANELİ =====
async function renderArtistPanel(app) {
  if (!currentUser) { navigate('/giris'); return; }
  if (!currentUser.is_artist) { navigate('/artist-basvuru'); return; }
  document.title = 'Artist Panel – ' + siteName;

  let rules = { own_rules: '', other_rules: '' };
  try { rules = await api('/music-rules'); } catch {}

  app.innerHTML = `<div class="container page" style="max-width:700px;margin:0 auto">
    <div class="page-title"><i class="fas fa-music" style="color:var(--accent-red2);margin-right:8px"></i>Artist Paneli</div>
    <div class="card">
      <div class="card-body">
        <div class="form-group">
          <label>Şarkı Türü *</label>
          <div style="display:flex;gap:10px">
            <label class="checkbox-label" style="flex:1;padding:12px;background:var(--bg-card2);border:1px solid var(--border);border-radius:8px;cursor:pointer">
              <input type="radio" name="song-type" id="st-own" value="own" checked style="width:auto" /> Kendi Şarkım
            </label>
            ${window.otherSongsEnabled !== false ? `<label class="checkbox-label" style="flex:1;padding:12px;background:var(--bg-card2);border:1px solid var(--border);border-radius:8px;cursor:pointer">
              <input type="radio" name="song-type" id="st-other" value="other" style="width:auto" /> Başkasının Şarkısı
            </label>` : ''}
          </div>
        </div>
        <div id="own-fields">
          <div class="form-group"><label>Yayımlayıcı / Dağıtıcı İsmi</label><input id="s-distributor" placeholder="Kendi adın ya da şirket adı" /></div>
          <div class="form-group"><label>Şarkı Adı *</label><input id="s-title" /></div>
          <div class="form-group"><label>Şarkı Türü</label><input id="s-genre" placeholder="Pop, Rock, Elektronik..." /></div>
          <div class="form-group"><label>Şarkı Dosyası * (MP3/WAV)</label><input type="file" id="s-audio" accept="audio/*" style="background:var(--bg-card2);border:1px dashed var(--border);padding:10px;cursor:pointer" /></div>
          <div class="form-group"><label>Kapak Fotoğrafı</label><input type="file" id="s-cover" accept="image/*" style="background:var(--bg-card2);border:1px dashed var(--border);padding:10px;cursor:pointer" /></div>
          <div class="form-group"><label>Şarkı Sözleri (isteğe bağlı)</label><textarea id="s-lyrics" rows="6" placeholder="Şarkı sözlerini buraya yapıştırın..."></textarea></div>
          <div style="background:var(--bg-card2);border:1px solid var(--border);border-radius:8px;padding:14px;margin-bottom:16px;font-size:13px;color:var(--text-secondary);max-height:120px;overflow-y:auto">${escHtml(rules.own_rules)}</div>
          <label class="checkbox-label" style="margin-bottom:16px"><input type="checkbox" id="s-rules-own" style="width:auto" /> Şarkı yayınlama kurallarını okudum ve kabul ediyorum</label>
        </div>
        <div id="other-fields" style="display:none">
          <div class="form-group"><label>Şarkı Adı *</label><input id="s-title-o" /></div>
          <div class="form-group"><label>Şarkı Sahibi (Sanatçı) *</label><input id="s-artist-o" /></div>
          <div class="form-group"><label>Kapak Fotoğrafı</label><input type="file" id="s-cover-o" accept="image/*" style="background:var(--bg-card2);border:1px dashed var(--border);padding:10px;cursor:pointer" /></div>
          <div class="form-group"><label>Şarkı Sözleri (isteğe bağlı)</label><textarea id="s-lyrics-o" rows="6" placeholder="Şarkı sözlerini buraya yapıştırın..."></textarea></div>
          <div class="form-group"><label>Şarkı Dosyası * (MP3/WAV)</label><input type="file" id="s-audio-o" accept="audio/*" style="background:var(--bg-card2);border:1px dashed var(--border);padding:10px;cursor:pointer" /></div>
          <div class="form-group"><label>Neden paylaştınız? *</label><textarea id="s-reason" rows="3" placeholder="Bu şarkıyı neden topluluğumuzla paylaşmak istediniz?"></textarea></div>
          <div style="background:var(--bg-card2);border:1px solid var(--border);border-radius:8px;padding:14px;margin-bottom:16px;font-size:13px;color:var(--text-secondary);max-height:120px;overflow-y:auto">${escHtml(rules.other_rules)}</div>
          <label class="checkbox-label" style="margin-bottom:16px"><input type="checkbox" id="s-rules-other" style="width:auto" /> Başkasının şarkısını paylaşma kurallarını okudum ve kabul ediyorum</label>
        </div>
        <button class="btn btn-primary" id="song-upload-btn" style="width:100%;justify-content:center"><i class="fas fa-upload"></i> Şarkıyı Yayınla</button>
        <div id="song-msg" style="margin-top:8px;font-size:12px"></div>
      </div>
    </div>
  </div>`;

  document.querySelectorAll('[name="song-type"]').forEach(r => r.addEventListener('change', () => {
    const own = r.value === 'own';
    document.getElementById('own-fields').style.display = own ? '' : 'none';
    document.getElementById('other-fields').style.display = own ? 'none' : '';
  }));

  document.getElementById('song-upload-btn').addEventListener('click', async () => {
    const isOwn = document.getElementById('st-own').checked;
    const msg = document.getElementById('song-msg');
    const btn = document.getElementById('song-upload-btn');
    const rules_ok = isOwn ? document.getElementById('s-rules-own')?.checked : document.getElementById('s-rules-other')?.checked;
    if (!rules_ok) { msg.style.color='var(--accent-red2)'; msg.textContent='Kuralları kabul etmelisiniz'; return; }
    const fd = new FormData();
    fd.append('song_type', isOwn ? 'own' : 'other');
    fd.append('rules_accepted', '1');
    if (isOwn) {
      const title = document.getElementById('s-title')?.value.trim();
      if (!title) { msg.style.color='var(--accent-red2)'; msg.textContent='Şarkı adı gerekli'; return; }
      const audio = document.getElementById('s-audio')?.files[0];
      if (!audio) { msg.style.color='var(--accent-red2)'; msg.textContent='Ses dosyası gerekli'; return; }
      fd.append('title', title);
      fd.append('artist_name', currentUser.username);
      fd.append('distributor', document.getElementById('s-distributor')?.value.trim()||'');
      fd.append('genre', document.getElementById('s-genre')?.value.trim()||'');
      fd.append('lyrics', document.getElementById('s-lyrics')?.value.trim()||'');
      fd.append('audio', audio);
      const cover = document.getElementById('s-cover')?.files[0]; if(cover) fd.append('cover', cover);
    } else {
      const title = document.getElementById('s-title-o')?.value.trim();
      const artist = document.getElementById('s-artist-o')?.value.trim();
      if (!title||!artist) { msg.style.color='var(--accent-red2)'; msg.textContent='Başlık ve sanatçı adı gerekli'; return; }
      const audio = document.getElementById('s-audio-o')?.files[0];
      if (!audio) { msg.style.color='var(--accent-red2)'; msg.textContent='Ses dosyası gerekli'; return; }
      fd.append('title', title); fd.append('artist_name', artist);
      fd.append('lyrics', document.getElementById('s-lyrics-o')?.value.trim()||'');
      fd.append('share_reason', document.getElementById('s-reason')?.value.trim()||'');
      fd.append('audio', audio);
      const cover = document.getElementById('s-cover-o')?.files[0]; if(cover) fd.append('cover', cover);
    }
    btn.disabled=true; btn.innerHTML='<div class="spinner" style="width:14px;height:14px"></div> Yükleniyor...';
    try {
      const data = await apiForm('/songs', fd);
      navigate('/muzik/' + data.slug);
    } catch(e) { msg.style.color='var(--accent-red2)'; msg.textContent=e.message; btn.disabled=false; btn.innerHTML='<i class="fas fa-upload"></i> Şarkıyı Yayınla'; }
  });
}

// ===== BAŞKASININ ŞARKISINI PAYLAŞ (artist rozeti gerekmez) =====
async function renderShareSong(app) {
  if (!currentUser) { navigate('/giris'); return; }
  if (window.otherSongsEnabled === false) { app.innerHTML = '<div class="container page"><div class="empty-state"><i class="fas fa-ban"></i><p>Başkasının şarkısı paylaşma özelliği şu an kapalı.</p></div></div>'; return; }
  // Artist olanlar kendi panelini kullansın
  if (currentUser.is_artist) { navigate('/artist-panel'); return; }
  document.title = 'Şarkı Paylaş – ' + siteName;

  let rules = { other_rules: '' };
  try { rules = await api('/music-rules'); } catch {}

  app.innerHTML = `<div class="container page" style="max-width:680px;margin:0 auto">
    <div class="page-title"><i class="fas fa-share-alt" style="color:var(--accent-red2);margin-right:8px"></i>Şarkı Paylaş</div>
    <div class="card" style="margin-bottom:16px">
      <div class="card-body" style="font-size:13px;color:var(--text-secondary);display:flex;align-items:flex-start;gap:10px">
        <i class="fas fa-info-circle" style="color:var(--accent-red2);margin-top:2px;flex-shrink:0"></i>
        <div>
          Bu sayfa <strong>başkasına ait şarkıları</strong> topluluğa paylaşmak içindir.
          Kendi şarkını yüklemek istiyorsan önce
          <a href="/artist-basvuru" data-link style="color:var(--accent-red2)">artist başvurusu</a> yapman gerekir.
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-body">
        <div class="form-group">
          <label>Şarkı Adı *</label>
          <input id="ss-title" placeholder="Şarkının adı" />
        </div>
        <div class="form-group">
          <label>Sanatçı (Şarkı Sahibi) *</label>
          <input id="ss-artist" placeholder="Sanatçının adı" />
        </div>
        <div class="form-group">
          <label>Müzik Türü</label>
          <input id="ss-genre" placeholder="Pop, Rock, Hip-Hop..." />
        </div>
        <div class="form-group">
          <label>Şarkı Dosyası * (MP3/WAV, max 50MB)</label>
          <input type="file" id="ss-audio" accept="audio/*" style="background:var(--bg-card2);border:1px dashed var(--border);padding:10px;cursor:pointer;border-radius:8px" />
        </div>
        <div class="form-group">
          <label>Kapak Fotoğrafı (isteğe bağlı)</label>
          <input type="file" id="ss-cover" accept="image/*" style="background:var(--bg-card2);border:1px dashed var(--border);padding:10px;cursor:pointer;border-radius:8px" />
        </div>
        <div class="form-group">
          <label>Şarkı Sözleri (isteğe bağlı)</label>
          <textarea id="ss-lyrics" rows="5" placeholder="Şarkı sözlerini buraya yapıştırın..."></textarea>
        </div>
        <div class="form-group">
          <label>Neden paylaşıyorsunuz? *</label>
          <textarea id="ss-reason" rows="2" placeholder="Bu şarkıyı neden topluluğumuzla paylaşmak istediniz?"></textarea>
        </div>
        ${rules.other_rules ? `
        <div style="background:var(--bg-card2);border:1px solid var(--border);border-radius:8px;padding:14px;margin-bottom:12px;font-size:13px;color:var(--text-secondary);max-height:120px;overflow-y:auto">
          ${escHtml(rules.other_rules)}
        </div>` : ''}
        <label class="checkbox-label" style="margin-bottom:16px">
          <input type="checkbox" id="ss-rules" style="width:auto" />
          <span>Başkasının şarkısını paylaşma kurallarını okudum ve kabul ediyorum</span>
        </label>
        <button class="btn btn-primary" id="ss-submit" style="width:100%;justify-content:center">
          <i class="fas fa-share"></i> Paylaş
        </button>
        <div id="ss-msg" style="margin-top:8px;font-size:12px;text-align:center"></div>
      </div>
    </div>
  </div>`;

  document.getElementById('ss-submit').addEventListener('click', async () => {
    const msg = document.getElementById('ss-msg');
    const btn = document.getElementById('ss-submit');
    const title  = document.getElementById('ss-title').value.trim();
    const artist = document.getElementById('ss-artist').value.trim();
    const genre  = document.getElementById('ss-genre').value.trim();
    const audio  = document.getElementById('ss-audio').files[0];
    const cover  = document.getElementById('ss-cover').files[0];
    const lyrics = document.getElementById('ss-lyrics').value.trim();
    const reason = document.getElementById('ss-reason').value.trim();
    const rules_ok = document.getElementById('ss-rules').checked;

    if (!title)    { msg.style.color='var(--accent-red2)'; msg.textContent='Şarkı adı zorunlu'; return; }
    if (!artist)   { msg.style.color='var(--accent-red2)'; msg.textContent='Sanatçı adı zorunlu'; return; }
    if (!audio)    { msg.style.color='var(--accent-red2)'; msg.textContent='Ses dosyası zorunlu'; return; }
    if (!reason)   { msg.style.color='var(--accent-red2)'; msg.textContent='Paylaşma sebebi zorunlu'; return; }
    if (!rules_ok) { msg.style.color='var(--accent-red2)'; msg.textContent='Kuralları kabul etmelisiniz'; return; }

    const fd = new FormData();
    fd.append('song_type', 'other');
    fd.append('rules_accepted', '1');
    fd.append('title', title);
    fd.append('artist_name', artist);
    fd.append('genre', genre);
    fd.append('lyrics', lyrics);
    fd.append('share_reason', reason);
    fd.append('audio', audio);
    if (cover) fd.append('cover', cover);

    btn.disabled = true;
    btn.innerHTML = '<div class="spinner" style="width:14px;height:14px"></div> Yükleniyor...';
    try {
      const data = await apiForm('/songs', fd);
      navigate('/muzik/' + data.slug);
    } catch(e) {
      msg.style.color = 'var(--accent-red2)';
      msg.textContent = e.message;
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-share"></i> Paylaş';
    }
  });
}

// ===== PLAYLİSTLERİM =====
async function shareStory(story) {
  const url = location.origin + '/hikaye/' + (story.public_id || story.id);
  const data = { title: '@' + story.username + ' hikayesi', text: story.caption || 'CigCig hikayesine bak', url };
  try {
    if (navigator.share) await navigator.share(data);
    else { await navigator.clipboard.writeText(url); toast('Hikaye bağlantısı kopyalandı'); }
  } catch (error) { if (error.name !== 'AbortError') toast('Paylaşım açılamadı', 'error'); }
}

async function showStoryEditModal(story, refresh) {
  showModal('Hikayeyi düzenle', `<div class="form-group"><label>Açıklama</label><input id="edit-story-caption" maxlength="180" value="${escHtml(story.caption || '')}" /></div><div class="form-group"><label>Yayında kalma süresi</label><select id="edit-story-duration"><option value="5" ${Number(story.duration_hours) === 5 ? 'selected' : ''}>5 saat</option><option value="10" ${Number(story.duration_hours) === 10 ? 'selected' : ''}>10 saat</option><option value="24" ${Number(story.duration_hours) === 24 ? 'selected' : ''}>24 saat</option></select></div><div class="form-group"><label>Müzik</label><select id="edit-story-song"><option value="">Müzik yok</option></select></div><button class="btn btn-primary" id="edit-story-save" style="width:100%">Kaydet</button><div id="edit-story-error" class="form-error mt-4"></div>`);
  try { const songs = await api('/songs'); $('#edit-story-song').innerHTML += songs.map(song => `<option value="${song.id}" ${String(song.id) === String(story.song_id) ? 'selected' : ''}>${escHtml(song.title)} · ${escHtml(song.artist_name || '')}</option>`).join(''); } catch {}
  $('#edit-story-save').onclick = async () => { try { await api('/stories/' + (story.public_id || story.id), { method: 'PUT', body: JSON.stringify({ caption: $('#edit-story-caption').value.trim(), duration_hours: $('#edit-story-duration').value, song_id: $('#edit-story-song').value || null, song_start_seconds: story.song_start_seconds || 0 }) }); hideModal(); toast('Hikaye güncellendi'); refresh?.(); } catch (error) { $('#edit-story-error').textContent = error.message; } };
}

async function showStoryViewers(story) {
  showModal('Hikayeyi görenler', '<div class="loading-center"><div class="spinner"></div></div>');
  try { const viewers = await api('/stories/' + (story.public_id || story.id) + '/viewers'); $('#modal-body').innerHTML = viewers.length ? `<div class="story-viewer-list">${viewers.map(viewer => `<div class="story-viewer-row">${avatarImg(viewer)}<span><b>${escHtml(viewer.username)}</b><small>${viewer.view_count} kez · ${timeAgo(viewer.viewed_at)}</small></span></div>`).join('')}</div>` : '<div class="empty-state"><i class="fas fa-eye-slash"></i><p>Henüz görüntüleyen yok.</p></div>'; } catch (error) { $('#modal-body').innerHTML = `<div class="form-error">${escHtml(error.message)}</div>`; }
}

async function loadStoriesBar(container) {
  if (!container) return;
  try {
    const stories = await api('/stories');
    const groups = [];
    stories.forEach(story => {
      let group = groups.find(item => item.user_id === story.user_id);
      if (!group) { group = { user_id: story.user_id, username: story.username, avatar: story.avatar, avatar_removed: story.avatar_removed, stories: [] }; groups.push(group); }
      group.stories.push(story);
    });
    groups.forEach(group => group.stories.sort((a, b) => new Date(a.created_at) - new Date(b.created_at)));
    groups.flatMap(group => group.stories).forEach(story => {
      if (story.media_type === 'image' && story.media_url) { const image = new Image(); image.src = story.media_url; }
    });
    const ownUserId = currentUser?.id;
    const visibleGroups = groups;
    visibleGroups.sort((a, b) => {
      const aViewed = a.stories.every(story => story.viewed);
      const bViewed = b.stories.every(story => story.viewed);
      return Number(aViewed) - Number(bViewed);
    });
    if (!visibleGroups.length && !currentUser) { container.innerHTML = ''; return; }
    const ownGroup = visibleGroups.find(group => group.user_id === ownUserId);
    const otherGroups = visibleGroups.filter(group => group.user_id !== ownUserId);
    container.innerHTML = `<div class="stories-strip"><div class="stories-scroll">${currentUser ? `<div class="story-own-wrap ${ownGroup ? 'has-story' : 'no-story'} ${ownGroup && ownGroup.stories.every(story => story.viewed) ? 'viewed' : ''}"><button type="button" class="story-user story-own" data-story-group="-1"><span class="story-ring">${currentUser.avatar && !currentUser.avatar_removed ? `<img src="${escHtml(currentUser.avatar)}" class="story-avatar-media" alt="" />` : '<i class="fas fa-user"></i>'}</span><small>Hikayen</small></button><button type="button" class="story-add-corner" id="story-add-btn" aria-label="Hikaye ekle"><i class="fas fa-plus"></i></button></div>` : ''}${otherGroups.map((group, index) => `<button type="button" class="story-user ${group.stories.every(story => story.viewed) ? 'viewed' : ''}" data-story-group="${index}"><span class="story-ring">${group.avatar && !group.avatar_removed ? `<img src="${escHtml(group.avatar)}" class="story-avatar-media" alt="" />` : '<i class="fas fa-user"></i>'}</span><small>${escHtml(group.username)}</small></button>`).join('')}</div></div>`;
    const openGroup = index => {
      const group = groups[index];
      let storyIndex = group.stories.findIndex(story => !story.viewed);
      if (storyIndex < 0) storyIndex = 0;
      const render = () => {
        const story = group.stories[storyIndex];
        const storyKey = story.public_id || story.id;
        story.viewed = true;
        const previousStoryAudio = activeStoryAudio;
        const previousStoryAudioSrc = previousStoryAudio?.src || '';
        const previousStoryAudioTime = previousStoryAudio?.currentTime || 0;
        const previousStoryAudioPlaying = Boolean(previousStoryAudio && !previousStoryAudio.paused);
        if (activeStoryAudio) { activeStoryAudio.pause(); activeStoryAudio.src = ''; activeStoryAudio = null; }
        showModal('@' + group.username, `<div class="story-viewer"><div class="story-progress">${group.stories.map((_, i) => `<span class="${i <= storyIndex ? 'active' : ''}"></span>`).join('')}</div><div class="story-tap-zone story-tap-left" id="story-tap-left" aria-label="Önceki hikaye"></div><div class="story-tap-zone story-tap-right" id="story-tap-right" aria-label="Sonraki hikaye"></div>${story.media_type === 'video' ? `<video src="${escHtml(story.media_url)}" controls autoplay playsinline></video>` : `<img src="${escHtml(story.media_url)}" alt="" />`}${story.caption ? `<p>${escHtml(story.caption)}</p>` : ''}${story.song_audio_url ? `<button class="story-song" id="story-song-play"><img src="${escHtml(story.song_cover_url || '')}" alt="" /><span><b>${escHtml(story.song_title)}</b><small>${escHtml(story.song_artist || '')}</small></span><i class="fas fa-volume-up"></i></button>` : ''}<div class="story-viewer-actions"><button class="btn btn-ghost" id="story-share"><i class="fas fa-share-alt"></i> Paylaş</button><button type="button" class="btn btn-ghost story-like ${story.liked ? 'active' : ''}" id="story-like"><i class="${story.liked ? 'fas' : 'far'} fa-heart"></i> <span>${story.like_count || 0}</span></button><button type="button" class="btn btn-ghost" id="story-reply-open"><i class="far fa-comment"></i> Yanıtla</button>${story.is_owner ? `<button type="button" class="btn btn-ghost" id="story-viewers"><i class="fas fa-eye"></i> ${story.total_views || 0} görüntülenme</button><button type="button" class="btn btn-ghost" id="story-edit"><i class="fas fa-pen"></i> Düzenle</button><button type="button" class="btn btn-ghost text-danger" id="story-delete"><i class="fas fa-trash"></i> Sil</button>` : ''}</div>${story.is_owner ? '<small class="story-owner-hint">Hikayeni görenleri ve tekrar görüntüleme sayılarını inceleyebilirsin.</small>' : ''}<div id="story-reply-box" class="story-reply-box" hidden><div class="story-reply-preview"><img src="${escHtml(story.media_url)}" alt="" /><span>Bu hikayeye yanıt veriyorsun</span></div><div class="story-reply-form"><input id="story-reply-input" maxlength="500" placeholder="Yanıtını yaz..." /><button type="button" class="btn btn-primary" id="story-reply-send"><i class="fas fa-paper-plane"></i></button></div></div></div>`);
        $('#modal-overlay')?.classList.add('story-fullscreen-overlay');
        api('/stories/' + storyKey + '/view', { method: 'POST' }).catch(() => {});
        $('#story-share')?.addEventListener('click', () => shareStory(story));
        $('#story-viewers')?.addEventListener('click', () => showStoryViewers(story));
        $('#story-edit')?.addEventListener('click', () => showStoryEditModal(story, render));
        $('#story-delete')?.addEventListener('click', async () => { if (!confirm('Bu hikaye silinsin mi?')) return; try { await api('/stories/' + storyKey, { method: 'DELETE' }); hideModal(); toast('Hikaye silindi'); loadStoriesBar(container); } catch (error) { toast(error.message, 'error'); } });
        $('#story-like')?.addEventListener('click', async () => { if (!currentUser) return toast('Beğenmek için giriş yapın.', 'error'); try { const result = await api('/stories/' + storyKey + '/like', { method: 'POST' }); story.liked = result.liked; story.like_count = result.like_count; render(); } catch (error) { toast(error.message, 'error'); } });
        if (story.song_audio_url) { activeStoryAudio = new Audio(story.song_audio_url); activeStoryAudio.currentTime = previousStoryAudioSrc === story.song_audio_url ? previousStoryAudioTime : (Number(story.song_start_seconds) || 0); activeStoryAudio.volume = 0.8; activeStoryAudio.loop = true; if (previousStoryAudioPlaying || !previousStoryAudio) activeStoryAudio.play().catch(() => {}); }
        $('#story-reply-open')?.addEventListener('click', () => { $('#story-reply-box').hidden = !$('#story-reply-box').hidden; $('#story-reply-input')?.focus(); });
        $('#story-reply-send')?.addEventListener('click', async () => { const input = $('#story-reply-input'); if (!currentUser) return toast('Yanıtlamak için giriş yapın.', 'error'); if (!input?.value.trim()) return; try { await api('/stories/' + storyKey + '/replies', { method: 'POST', body: JSON.stringify({ content: input.value.trim() }) }); toast('Yanıt hikaye sahibine gönderildi'); hideModal(); } catch (error) { toast(error.message, 'error'); } });
        $('#story-tap-left')?.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); if (storyIndex > 0) { storyIndex--; render(); } });
        $('#story-tap-right')?.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); if (storyIndex < group.stories.length - 1) { storyIndex++; render(); } });
      };
      render();
    };
    container.querySelectorAll('[data-story-group]').forEach(button => button.addEventListener('click', () => {
      const group = button.dataset.storyGroup === '-1' ? ownGroup : otherGroups[Number(button.dataset.storyGroup)];
      const story = group?.stories?.find(item => !item.viewed) || group?.stories?.[0];
      if (story) navigate('/hikaye/' + encodeURIComponent(story.public_id || story.id));
    }));
    container.querySelector('#story-add-btn')?.addEventListener('click', showStoryUploadModal);
  } catch { container.innerHTML = ''; }
}

function showStoryUploadModal() {
  showModal('Hikaye ekle', `<div class="story-compose"><div class="form-group"><label>Fotoğraf veya video</label><input id="story-media" type="file" accept="image/*,video/*" /></div><div id="story-media-preview" class="story-media-preview" hidden></div><div class="form-group"><label>Açıklama</label><input id="story-caption" maxlength="180" placeholder="Hikayene bir şey ekle..." /></div><div class="form-group"><label>Yayında kalma süresi</label><select id="story-duration"><option value="5">5 saat</option><option value="10">10 saat</option><option value="24" selected>24 saat</option></select></div><div class="form-group"><label>Müzik seç</label><input id="story-song-search" placeholder="Şarkı veya sanatçı ara..." /><div id="story-song-list" class="story-song-list"><div class="loading-center"><div class="spinner"></div></div></div><input id="story-song" type="hidden" /><input id="story-song-start" type="hidden" value="0" /></div><div id="story-song-player" class="story-selected-song" hidden></div><button class="btn btn-primary" id="story-save" style="width:100%">Paylaş</button><div id="story-error" class="form-error mt-4"></div></div>`);
  let songs = [], selectedSong = null;
  const mediaInput = $('#story-media'), preview = $('#story-media-preview'), songList = $('#story-song-list');
  mediaInput.onchange = () => { const file = mediaInput.files[0]; if (!file) return; const url = URL.createObjectURL(file); preview.hidden = false; preview.innerHTML = file.type.startsWith('video/') ? `<video src="${url}" controls playsinline></video>` : `<img src="${url}" alt="Seçilen hikaye önizlemesi" />`; };
  const renderSongs = list => { songList.innerHTML = list.slice(0, 30).map(song => `<button type="button" class="story-song-option ${selectedSong?.id === song.id ? 'selected' : ''}" data-song-id="${song.id}">${song.cover_url ? `<img src="${escHtml(song.cover_url)}" alt="" />` : '<span class="story-song-cover"><i class="fas fa-music"></i></span>'}<span><b>${escHtml(song.title)}</b><small>${escHtml(song.artist_name || '')}</small></span><i class="fas fa-play story-song-option-play"></i></button>`).join('') || '<small class="text-muted">Müzik bulunamadı.</small>'; songList.querySelectorAll('.story-song-option').forEach(button => button.onclick = () => { selectedSong = songs.find(song => String(song.id) === button.dataset.songId); $('#story-song').value = selectedSong.id; renderSongs(songs); $('#story-song-player').hidden = false; $('#story-song-player').innerHTML = `<img src="${escHtml(selectedSong.cover_url || '')}" alt="" /><div><b>${escHtml(selectedSong.title)}</b><small>${escHtml(selectedSong.artist_name || '')}</small></div><button type="button" id="story-song-toggle" class="btn btn-ghost"><i class="fas fa-play"></i></button>`; $('#story-song-toggle').onclick = () => { if (!storyComposerAudio || storyComposerAudio.src !== selectedSong.audio_url) { if (storyComposerAudio) storyComposerAudio.pause(); storyComposerAudio = new Audio(selectedSong.audio_url); } storyComposerAudio.currentTime = Number($('#story-song-start').value) || 0; if (storyComposerAudio.paused) { storyComposerAudio.play(); $('#story-song-toggle i').className = 'fas fa-pause'; } else { storyComposerAudio.pause(); $('#story-song-toggle i').className = 'fas fa-play'; } }; }); };
  api('/songs').then(result => { songs = result; renderSongs(songs); }).catch(() => { songList.innerHTML = '<small class="text-muted">Müzikler yüklenemedi.</small>'; });
  $('#story-song-search').oninput = event => { const q = event.target.value.toLowerCase(); renderSongs(songs.filter(song => `${song.title} ${song.artist_name}`.toLowerCase().includes(q))); };
  $('#story-save').addEventListener('click', async event => {
    const submitButton = event.currentTarget;
    const file = $('#story-media').files[0];
    if (!file) { $('#story-error').textContent = 'Dosya seçin'; return; }
    if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) { $('#story-error').textContent = 'Sadece fotoğraf veya video yükleyebilirsiniz.'; return; }
    if (file.size > 500 * 1024 * 1024) { $('#story-error').textContent = 'Dosya boyutu 500 MB sınırını geçemez.'; return; }
    submitButton.disabled = true;
    submitButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Paylaşılıyor...';
    const form = new FormData(); form.append('media', file); form.append('caption', $('#story-caption').value.trim()); form.append('duration_hours', $('#story-duration').value); if (selectedSong) { form.append('song_id', selectedSong.id); form.append('song_start_seconds', $('#story-song-start').value || 0); }
    try {
      if (file.type.startsWith('video/')) {
        const signed = await api('/stories/upload-url', { method: 'POST', body: JSON.stringify({ filename: file.name, content_type: file.type, content_length: file.size }) });
        const response = await fetch(signed.upload_url, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
        if (!response.ok) throw new Error('Hikaye videosu R2’ye yüklenemedi.');
        await api('/stories/from-url', { method: 'POST', body: JSON.stringify({ media_url: signed.public_url, caption: $('#story-caption').value.trim(), duration_hours: $('#story-duration').value, song_id: selectedSong?.id || null, song_start_seconds: $('#story-song-start').value || 0 }) });
      } else {
        await apiFormWithTimeout('/stories', form);
      }
      hideModal(); toast('Hikaye paylaşıldı'); document.querySelectorAll('#stories-bar,#home-stories-bar').forEach(loadStoriesBar);
    }
    catch (error) { submitButton.disabled = false; submitButton.innerHTML = 'Paylaş'; $('#story-error').textContent = error.message || 'Hikaye yüklenemedi.'; }
  });
}

async function renderStoryRoute(app, storyId) {
  try {
    const story = await api('/stories/' + encodeURIComponent(storyId));
    const allStories = await api('/stories');
    const storyGroups = [];
    allStories.forEach(item => {
      let group = storyGroups.find(groupItem => groupItem.user_id === item.user_id);
      if (!group) { group = { user_id: item.user_id, stories: [] }; storyGroups.push(group); }
      group.stories.push(item);
    });
    storyGroups.forEach(group => group.stories.sort((a, b) => new Date(a.created_at) - new Date(b.created_at)));
    const storySequence = storyGroups.flatMap(group => group.stories);
    const storyIndex = Math.max(0, storySequence.findIndex(item => String(item.id) === String(story.id) || item.public_id === story.public_id));
    const previousStory = storySequence[storyIndex - 1];
    const nextStory = storySequence[storyIndex + 1];
    const currentGroup = storyGroups.find(group => group.user_id === story.user_id);
    const currentGroupIndex = currentGroup ? currentGroup.stories.findIndex(item => String(item.id) === String(story.id) || item.public_id === story.public_id) : -1;
    document.title = '@' + story.username + ' hikayesi - ' + siteName;
    app.innerHTML = `<div class="container page"><div class="story-route"><div class="story-route-media"><div class="story-route-head">${avatarImg(story)}<div><b>@${escHtml(story.username)}</b><small>${timeAgo(story.created_at)} · ${currentGroupIndex + 1}/${currentGroup?.stories.length || 1}</small></div></div><button class="story-route-tap story-route-tap-left" id="story-route-prev" aria-label="Önceki hikaye" ${previousStory ? '' : 'disabled'}></button>${story.media_type === 'video' ? `<video src="${escHtml(story.media_url)}" controls autoplay playsinline></video>` : `<img src="${escHtml(story.media_url)}" alt="Hikaye" />`}<button class="story-route-tap story-route-tap-right" id="story-route-next" aria-label="Sonraki hikaye" ${nextStory ? '' : 'disabled'}></button></div>${story.caption ? `<p>${escHtml(story.caption)}</p>` : ''}${story.song_audio_url ? `<div class="story-route-song"><img src="${escHtml(story.song_cover_url || '')}" alt="" /><span><b>${escHtml(story.song_title)}</b><small>${escHtml(story.song_artist || '')}</small></span><input id="story-route-volume" type="range" min="0" max="100" value="80" aria-label="Hikaye sesi" /></div>` : ''}<div class="story-route-actions"><button class="btn btn-ghost" id="story-route-share"><i class="fas fa-share-alt"></i> Paylaş</button>${story.is_owner ? `<button class="btn btn-ghost" id="story-route-viewers"><i class="fas fa-eye"></i> ${story.total_views || 0} görüntülenme</button><button class="btn btn-ghost" id="story-route-edit"><i class="fas fa-pen"></i> Düzenle</button><button class="btn btn-ghost text-danger" id="story-route-delete"><i class="fas fa-trash"></i> Sil</button>` : ''}</div><div class="story-route-note">Bu hikaye artık akışta görünmüyor olabilir, ancak bağlantısından izlenebilir.</div></div></div>`;
    $('#story-route-prev')?.addEventListener('click', event => { event.preventDefault(); event.currentTarget.blur(); if (previousStory) navigate('/hikaye/' + encodeURIComponent(previousStory.public_id || previousStory.id)); });
    $('#story-route-next')?.addEventListener('click', event => { event.preventDefault(); event.currentTarget.blur(); if (nextStory) navigate('/hikaye/' + encodeURIComponent(nextStory.public_id || nextStory.id)); });
    $('#story-route-share')?.addEventListener('click', () => shareStory(story));
    const routeActions = document.querySelector('.story-route-actions');
    if (routeActions) {
      routeActions.insertAdjacentHTML('afterbegin', `<button class="btn btn-ghost story-like ${story.liked ? 'active' : ''}" id="story-route-like"><i class="${story.liked ? 'fas' : 'far'} fa-heart"></i> <span>${story.like_count || 0}</span></button><button class="btn btn-ghost" id="story-route-reply-open"><i class="far fa-comment"></i> Yanıtla</button>`);
      routeActions.insertAdjacentHTML('afterend', '<div class="story-route-reply" id="story-route-reply" hidden><input id="story-route-reply-input" maxlength="500" placeholder="Hikayeye yanıt yaz..." /><button class="btn btn-primary btn-sm" id="story-route-reply-send"><i class="fas fa-paper-plane"></i></button></div>');
    }
    $('#story-route-like')?.addEventListener('click', async () => { if (!currentUser) return toast('Beğenmek için giriş yapın.', 'error'); try { const result = await api('/stories/' + (story.public_id || story.id) + '/like', { method: 'POST' }); story.liked = result.liked; story.like_count = result.like_count; renderStoryRoute(app, storyId); } catch (error) { toast(error.message, 'error'); } });
    $('#story-route-reply-open')?.addEventListener('click', () => { $('#story-route-reply').hidden = !$('#story-route-reply').hidden; $('#story-route-reply-input')?.focus(); });
    $('#story-route-reply-send')?.addEventListener('click', async () => { const input = $('#story-route-reply-input'); if (!currentUser) return toast('Yanıtlamak için giriş yapın.', 'error'); if (!input?.value.trim()) return; try { await api('/stories/' + (story.public_id || story.id) + '/replies', { method: 'POST', body: JSON.stringify({ content: input.value.trim() }) }); toast('Yanıt DM olarak gönderildi'); input.value = ''; } catch (error) { toast(error.message, 'error'); } });
    $('#story-route-viewers')?.addEventListener('click', () => showStoryViewers(story));
    $('#story-route-edit')?.addEventListener('click', () => showStoryEditModal(story, () => renderStoryRoute(app, storyId)));
    $('#story-route-delete')?.addEventListener('click', async () => { if (!confirm('Bu hikaye silinsin mi?')) return; await api('/stories/' + (story.public_id || story.id), { method: 'DELETE' }); toast('Hikaye silindi'); navigate('/fotograflar'); });
    if (story.song_audio_url) { activeStoryAudio = new Audio(story.song_audio_url); activeStoryAudio.currentTime = Number(story.song_start_seconds) || 0; activeStoryAudio.volume = 0.8; activeStoryAudio.loop = true; activeStoryAudio.play().catch(() => {}); }
    api('/stories/' + (story.public_id || story.id) + '/view', { method: 'POST' }).catch(() => {});
  } catch (error) {
    app.innerHTML = `<div class="container page"><div class="empty-state"><i class="fas fa-circle-exclamation"></i><p>${escHtml(error.message || 'Hikaye bulunamadı')}</p></div></div>`;
  }
}

async function renderPhotos(app) {
  document.title = 'Fotoğraflar – ' + siteName;
  app.innerHTML = `<div class="container page"><div id="stories-bar"></div><div id="photos-feed" class="photos-feed"><div class="loading-center"><div class="spinner"></div></div></div></div>`;
  loadStoriesBar($('#stories-bar'));
  const feed = document.getElementById('photos-feed');
  try { const [photos, ad] = await Promise.all([api('/photos'), api('/photo-ads/random').catch(()=>null)]); const cards=[]; shuffleArray(photos).forEach((p,i)=>{ cards.push(photoCardHTML(p)); if(ad && (i+1)%4===0) cards.push(photoAdCardHTML(ad)); }); if(ad && !photos.length) cards.push(photoAdCardHTML(ad)); feed.innerHTML = cards.length ? cards.join('') : '<div class="empty-state"><i class="fas fa-images"></i><p>Henüz fotoğraf yok.</p></div>'; bindPhotoFeed(feed); setupPhotoAudio(feed); } catch (e) { feed.innerHTML = `<div class="empty-state"><p>${escHtml(e.message)}</p></div>`; }
}
function photoCardHTML(p) { return `<article class="photo-card" data-photo-id="${p.id}" data-photo-url="${escHtml(p.url)}" style="padding:0;overflow:hidden"><div class="photo-card-head" style="padding:12px">${avatarImg(p)}<a href="/profil/${escHtml(p.username)}" data-link>${escHtml(p.username)}</a>${currentUser&&currentUser.id===p.user_id?'<div style="margin-left:auto;display:flex;gap:2px"><button class="btn btn-ghost btn-sm photo-edit" title="Fotoğrafı düzenle"><i class="fas fa-pen"></i></button><button class="btn btn-ghost btn-sm photo-delete" title="Fotoğrafı sil"><i class="fas fa-trash"></i></button></div>':''}</div><div class="photo-media-wrap"><div class="photo-media-backdrop" style="background-image:url('${escHtml(p.url)}')"></div><a href="/foto/${p.id}" data-link class="photo-native-link"><img src="${escHtml(p.url)}" class="photo-native" alt="${escHtml(p.title||p.caption||'')}"/></a>${p.song_title&&p.song_audio_url?`<button class="photo-song photo-song-overlay" data-audio="${escHtml(p.song_audio_url)}" data-start="${Number(p.song_start_seconds)||0}" type="button"><i class="fas fa-music"></i><span>${escHtml(p.song_title)}${p.song_artist?` · ${escHtml(p.song_artist)}`:''}</span></button><button class="photo-audio-toggle" type="button" title="Fotoğraf müziğini aç/kapat" aria-label="Fotoğraf müziğini aç/kapat"><i class="fas fa-volume-mute"></i></button>`:''}</div><div style="padding:12px">${p.title?`<h3>${escHtml(p.title)}</h3>`:''}${p.caption?`<p>${escHtml(p.caption)}</p>`:''}${p.location?`<small><i class="fas fa-map-marker-alt"></i> ${escHtml(p.location)}</small>`:''}<div class="photo-actions">${p.show_likes?`<button class="btn btn-ghost btn-sm photo-like"><i class="${p.liked?'fas':'far'} fa-heart"></i> <span>${p.like_count}</span></button>`:''}${p.allow_comments?`<button class="btn btn-ghost btn-sm photo-comment"><i class="far fa-comment"></i> <span>${p.comment_count}</span></button>`:''}${p.allow_shares?'<button class="btn btn-ghost btn-sm photo-share"><i class="fas fa-share-alt"></i> Paylaş</button><button class="btn btn-ghost btn-sm photo-forward"><i class="fas fa-paper-plane"></i> İlet</button>':''}</div><div class="photo-comment-box" hidden></div></div></article>`; }
function photoAdCardHTML(a) { return `<article class="photo-card photo-ad-card" data-ad-id="${a.id}" style="padding:0;overflow:hidden;cursor:pointer"><div class="photo-card-head" style="padding:12px"><div style="width:34px;height:34px;border-radius:50%;background:var(--accent-red);display:grid;place-items:center;color:#fff"><i class="fas fa-bullhorn"></i></div><b>Reklam</b><small style="color:var(--text-muted)">Sponsorlu</small></div><div class="photo-media-wrap"><div class="photo-media-backdrop" style="background-image:url('${escHtml(a.image_url)}')"></div><img src="${escHtml(a.image_url)}" class="photo-native" alt="${escHtml(a.title)}"/></div><div style="padding:12px"><h3>${escHtml(a.title)}</h3><p>${escHtml(a.description||'')}</p></div></article>`; }
function bindPhotoFeed(feed) {
  const sharePhoto = async c => {
    const url = location.origin + '/fotograflar#foto-' + c.dataset.photoId;
    const data = { title: 'CigCig fotoğrafı', text: 'Bu fotoğrafa göz at', url };
    if (navigator.share) await navigator.share(data);
    else {
      await navigator.clipboard.writeText(url);
      toast('Fotoğraf bağlantısı kopyalandı');
    }
  };

  const renderComments = async (c, box) => {
    const cs = await api('/photos/' + c.dataset.photoId + '/comments');
    box.innerHTML = `<div class="photo-comments">${cs.map(v => `<div class="photo-comment-row"><p><b>${escHtml(v.username)}</b> ${escHtml(v.content)}</p><div class="photo-comment-actions"><button type="button" class="btn btn-ghost btn-sm photo-comment-like ${v.liked ? 'liked' : ''}" data-comment-id="${v.id}"><i class="${v.liked ? 'fas' : 'far'} fa-heart"></i> <span>${v.like_count || 0}</span></button>${currentUser && (currentUser.id === v.user_id || currentUser.id === c.dataset.ownerId) ? `<button type="button" class="btn btn-ghost btn-sm photo-comment-delete" data-comment-id="${v.id}" title="Yorumu sil"><i class="fas fa-trash"></i></button>` : ''}</div></div>`).join('') || '<small>Henüz yorum yok.</small>'}</div>${currentUser ? '<div class="photo-comment-form"><input class="photo-comment-input" placeholder="Yorum yaz"/><button class="btn btn-primary btn-sm photo-comment-send">Gönder</button></div>' : '<small>Yorum yapmak için giriş yapın.</small>'}`;
    box.querySelector('.photo-comment-send')?.addEventListener('click', async () => {
      const input = box.querySelector('input');
      if (!input?.value.trim()) return;
      try {
        await api('/photos/' + c.dataset.photoId + '/comments', { method: 'POST', body: JSON.stringify({ content: input.value.trim() }) });
        await renderComments(c, box);
        const count = c.querySelector('.photo-comment span');
        if (count) count.textContent = String(Number(count.textContent) + 1);
      } catch (error) { toast(error.message || 'Yorum gönderilemedi', 'error'); }
    });
    box.querySelectorAll('.photo-comment-like').forEach(button => button.addEventListener('click', async event => {
      event.preventDefault();
      event.stopPropagation();
      if (!currentUser) return toast('Yorum beğenmek için giriş yapın.', 'error');
      try {
        const result = await api('/photos/comments/' + button.dataset.commentId + '/like', { method: 'POST' });
        const count = button.querySelector('span');
        const value = Math.max(0, Number(count?.textContent || 0) + (result.liked ? 1 : -1));
        if (count) count.textContent = value;
        button.classList.toggle('liked', result.liked);
        button.querySelector('i').className = (result.liked ? 'fas' : 'far') + ' fa-heart';
      } catch (error) { toast(error.message || 'Yorum beğenilemedi', 'error'); }
    }));
    box.querySelectorAll('.photo-comment-delete').forEach(button => button.addEventListener('click', async event => {
      event.preventDefault(); event.stopPropagation();
      if (!confirm('Bu yorum silinsin mi?')) return;
      try { await api('/photos/comments/' + button.dataset.commentId, { method: 'DELETE' }); await renderComments(c, box); } catch (error) { toast(error.message || 'Yorum silinemedi', 'error'); }
    }));
  };

  feed.querySelectorAll('.photo-comment-like').forEach(button => button.addEventListener('click', async event => {
    event.preventDefault();
    event.stopPropagation();
    if (!currentUser) return toast('Yorum beğenmek için giriş yapın.', 'error');
    try {
      const result = await api('/photos/comments/' + button.dataset.commentId + '/like', { method: 'POST' });
      const count = button.querySelector('span');
      const value = Math.max(0, Number(count?.textContent || 0) + (result.liked ? 1 : -1));
      if (count) count.textContent = value;
      button.classList.toggle('liked', result.liked);
      button.querySelector('i').className = (result.liked ? 'fas' : 'far') + ' fa-heart';
    } catch (error) { toast(error.message || 'Yorum beğenilemedi', 'error'); }
  }));

  feed.querySelectorAll('.photo-ad-card').forEach(x => x.onclick = () => {
    const id = x.dataset.adId;
    api('/photo-ads/' + id + '/click', { method: 'POST' }).catch(() => {});
    api('/photo-ads/random').then(a => {
      if (a && a.id == id) window.open(normalizeExternalUrl(a.site_url), '_blank', 'noopener,noreferrer');
    });
  });

  feed.querySelectorAll('.photo-delete').forEach(x => x.onclick = async e => {
    const c = e.target.closest('[data-photo-id]');
    if (!c) return;
    if (confirm('Fotoğraf silinsin mi?')) {
      await api('/photos/' + c.dataset.photoId, { method: 'DELETE' });
      c.remove();
    }
  });

  feed.querySelectorAll('.photo-edit').forEach(x => x.onclick = e => {
    e.preventDefault(); e.stopPropagation();
    const photo = [...feed.querySelectorAll('[data-photo-id]')].find(item => item.dataset.photoId === x.closest('[data-photo-id]')?.dataset.photoId);
    if (photo) showPhotoEditModal(photo.dataset.photoId);
  });

  feed.querySelectorAll('.photo-comment').forEach(x => x.onclick = async e => {
    e.preventDefault();
    e.stopPropagation();
    const c = e.target.closest('[data-photo-id]');
    if (!c) return;
    const box = c.querySelector('.photo-comment-box');
    if (!box) return;
    box.hidden = !box.hidden;
    if (!box.hidden) {
      try { await renderComments(c, box); }
      catch (error) { box.innerHTML = `<small class="form-error">${escHtml(error.message || 'Yorumlar yüklenemedi')}</small>`; }
    }
  });

  feed.querySelectorAll('.photo-share').forEach(x => x.onclick = async e => {
    e.preventDefault();
    e.stopPropagation();
    const c = e.target.closest('[data-photo-id]');
    if (c) await sharePhoto(c);
  });

  feed.querySelectorAll('.photo-like').forEach(x => x.onclick = async e => {
    e.preventDefault();
    e.stopPropagation();
    if (!currentUser) return toast('Beğenmek için giriş yapın.', 'error');
    const c = e.target.closest('[data-photo-id]');
    if (!c) return;
    try {
      const r = await api('/photos/' + c.dataset.photoId + '/like', { method: 'POST' });
      const n = x.querySelector('span');
      if (n) n.textContent = String(r.like_count ?? Math.max(0, Number(n.textContent) + (r.liked ? 1 : -1)));
      const icon = x.querySelector('i');
      if (icon) icon.className = (r.liked ? 'fas' : 'far') + ' fa-heart';
      x.classList.toggle('liked', !!r.liked);
      if (r.liked) {
        const burst = document.createElement('span');
        burst.className = 'photo-like-burst';
        burst.textContent = '❤';
        c.appendChild(burst);
        setTimeout(() => burst.remove(), 850);
      }
    } catch (error) { toast(error.message || 'Beğeni gönderilemedi', 'error'); }
  });
  feed.querySelectorAll('.photo-media-wrap').forEach(media => media.addEventListener('dblclick', event => {
    event.preventDefault();
    event.stopPropagation();
    if (!currentUser || event.target.closest('button')) return;
    media.closest('[data-photo-id]')?.querySelector('.photo-like')?.click();
  }));

  feed.querySelectorAll('.photo-song').forEach(button => button.addEventListener('click', async event => {
    event.preventDefault(); event.stopPropagation();
    try {
      const photo = await api('/photos/' + encodeURIComponent(button.closest('[data-photo-id]').dataset.photoId));
      if (photo.song_slug) navigate('/muzik/' + encodeURIComponent(photo.song_slug));
      else toast('Bu müziğin sayfası bulunamadı', 'error');
    } catch (error) { toast(error.message || 'Müzik sayfası açılamadı', 'error'); }
  }));

}


async function renderPhotoDetail(app, photoId) {
  try {
    const photo = await api('/photos/' + encodeURIComponent(photoId));
    app.innerHTML = `<div class="container page"><button class="btn btn-ghost btn-sm" onclick="history.back()"><i class="fas fa-arrow-left"></i> Geri</button><div class="photo-detail-shell">${photoCardHTML(photo)}</div></div>`;
    const shell = app.querySelector('.photo-detail-shell');
    bindPhotoFeed(shell);
    setupPhotoAudio(shell, { disableAutoplay: true });
  } catch (error) {
    app.innerHTML = `<div class="container page"><div class="empty-state"><i class="fas fa-image"></i><p>${escHtml(error.message || 'Fotoğraf bulunamadı')}</p></div></div>`;
  }
}

let activePhotoAudio=null, photoAudioObserver=null;
function setupPhotoAudio(feed, options = {}) {
  photoAudioObserver?.disconnect(); activePhotoAudio?.pause(); activePhotoAudio=null;
  let muted=localStorage.getItem('cigcig_photo_audio_muted');
  muted=muted===null ? false : muted==='1';
  if (options.playImmediately) muted = false;
  let volume=Math.min(1,Math.max(0,Number(localStorage.getItem('cigcig_photo_audio_volume')||'0.8')));
  document.getElementById('photo-audio-control')?.remove();
  const stop=()=>{activePhotoAudio?.pause();activePhotoAudio=null;};
  const syncMuteButtons=()=>feed.querySelectorAll('.photo-audio-toggle').forEach(button=>{button.classList.toggle('muted',muted);button.querySelector('i').className='fas '+(muted?'fa-volume-mute':'fa-volume-up');});
  const play=(card, force=false)=>{const b=card.querySelector('.photo-song');if(!b?.dataset.audio||(!force&&activePhotoAudio?._photoId===card.dataset.photoId))return;stop();const a=new Audio(b.dataset.audio);a._photoId=card.dataset.photoId;a.muted=muted;a.volume=volume;a.currentTime=Number(b.dataset.start)||0;a.onended=()=>{ if (activePhotoAudio===a) activePhotoAudio=null; };activePhotoAudio=a;a.play().catch(()=>{ if (activePhotoAudio===a) activePhotoAudio=null; });};
  feed.querySelectorAll('.photo-audio-toggle').forEach(button=>button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();muted=!muted;localStorage.setItem('cigcig_photo_audio_muted',muted?'1':'0');if(muted){activePhotoAudio?.pause();}else{const card=button.closest('[data-photo-id]');if(card)play(card,true);}if(activePhotoAudio){activePhotoAudio.muted=muted;activePhotoAudio.volume=volume;}syncMuteButtons();}));
  syncMuteButtons();
  if (options.disableAutoplay) return;
  const ratios = new Map();
  photoAudioObserver=new IntersectionObserver(entries=>{entries.forEach(entry=>ratios.set(entry.target, entry.isIntersecting ? entry.intersectionRatio : 0));const visible=[...ratios.entries()].filter(([,ratio])=>ratio>.1).sort((a,b)=>b[1]-a[1])[0];if(visible)play(visible[0]);else stop();},{threshold:[0,.1,.7]});
  feed.querySelectorAll('[data-photo-id]').forEach(card=>photoAudioObserver.observe(card));
  requestAnimationFrame(() => {
    const firstVisible = [...feed.querySelectorAll('[data-photo-id]')].find(card => {
      const rect = card.getBoundingClientRect();
      return rect.top < window.innerHeight * .7 && rect.bottom > window.innerHeight * .3;
    });
    if (firstVisible) play(firstVisible);
  });
  const resumePhotoAudio = () => {
    const current = [...ratios.entries()].filter(([, ratio]) => ratio > .1).sort((a, b) => b[1] - a[1])[0];
    if (current && !activePhotoAudio) play(current[0]);
  };
  document.addEventListener('pointerdown', resumePhotoAudio, { once: true, capture: true });
}

document.addEventListener('click', e => {
  const btn=e.target.closest('.photo-forward'); if(!btn) return;
  e.preventDefault(); e.stopImmediatePropagation();
  if(!currentUser) return toast('İletmek için giriş yapın.', 'error');
  showForwardPhotoModal(btn.closest('[data-photo-id]')?.dataset.photoId);
}, true);
async function showPhotoEditModal(photoId) {
  try {
    const photo = await api('/photos/' + encodeURIComponent(photoId));
    const songs = await api('/songs').catch(() => []);
    showModal('Fotoğrafı düzenle', `<div class="form-group"><label>Başlık</label><input id="edit-photo-title" maxlength="120" value="${escHtml(photo.title || '')}" /></div><div class="form-group"><label>Açıklama</label><textarea id="edit-photo-caption" rows="3">${escHtml(photo.caption || '')}</textarea></div><div class="form-group"><label>Konum</label><input id="edit-photo-location" value="${escHtml(photo.location || '')}" /></div><div class="form-group"><label>Müzik</label><select id="edit-photo-song"><option value="">Müzik yok</option>${songs.map(song => `<option value="${song.id}" ${String(song.id) === String(photo.song_id) ? 'selected' : ''}>${escHtml(song.title)} · ${escHtml(song.artist_name || '')}</option>`).join('')}</select></div><div class="form-group"><label>Müzik başlangıcı</label><input id="edit-photo-start" type="number" min="0" value="${Number(photo.song_start_seconds) || 0}" /></div><label class="checkbox-label"><input id="edit-photo-likes" type="checkbox" ${photo.show_likes !== 0 ? 'checked' : ''} /> Beğeni açık</label><label class="checkbox-label"><input id="edit-photo-comments" type="checkbox" ${photo.allow_comments !== 0 ? 'checked' : ''} /> Yorum açık</label><label class="checkbox-label"><input id="edit-photo-shares" type="checkbox" ${photo.allow_shares !== 0 ? 'checked' : ''} /> Paylaşım ve iletme açık</label><button class="btn btn-primary" id="edit-photo-save" style="width:100%;margin-top:14px">Kaydet</button><div id="edit-photo-error" class="form-error mt-4"></div>`);
    $('#edit-photo-save').onclick = async () => {
      try {
        await api('/photos/' + photoId, { method: 'PUT', body: JSON.stringify({ url: photo.url, title: $('#edit-photo-title').value.trim(), caption: $('#edit-photo-caption').value.trim(), location: $('#edit-photo-location').value.trim(), song_id: $('#edit-photo-song').value || null, song_start_seconds: $('#edit-photo-start').value, show_likes: $('#edit-photo-likes').checked, allow_comments: $('#edit-photo-comments').checked, allow_shares: $('#edit-photo-shares').checked }) });
        hideModal(); toast('Fotoğraf güncellendi'); navigate('/fotograflar');
      } catch (error) { $('#edit-photo-error').textContent = error.message; }
    };
  } catch (error) { toast(error.message || 'Fotoğraf yüklenemedi', 'error'); }
}

function showPhotoUploadModal() {
  showModal('Fotoğraf At', `
    <div class="form-group"><label>Fotoğraf *</label><input id="photo-file" type="file" accept="image/*" /><div id="photo-file-preview" class="photo-file-preview" hidden></div></div>
    <div class="form-group"><label>Başlık</label><input id="photo-title" maxlength="120" /></div>
    <div class="form-group"><label>Açıklama</label><textarea id="photo-caption" rows="3"></textarea></div>
    <div class="form-group"><label>Konum</label><input id="photo-location" /></div>
    <div class="form-group"><label>Müzik seç</label><input id="photo-song-search" placeholder="Şarkı veya sanatçı ara..." /><div id="photo-song-list" class="story-song-list"><div class="loading-center"><div class="spinner"></div></div></div><input id="photo-song" type="hidden" /><div id="photo-song-player" class="story-selected-song" hidden></div><button type="button" class="btn btn-ghost btn-sm" id="photo-song-preview" style="margin-top:8px" disabled><i class="fas fa-play"></i> Önizlemeyi başlat</button><audio id="photo-song-preview-player" controls style="width:100%;margin-top:10px;display:none"></audio></div>
    <div class="form-group"><label>Müzik başlangıcı <span id="photo-song-time" style="color:var(--text-muted);font-weight:400">0:00</span></label><input id="photo-song-start" type="range" min="0" max="0" value="0" step="1" disabled style="width:100%" /></div>
    <label class="checkbox-label"><input id="photo-likes" type="checkbox" checked/> Beğeni açık</label>
    <label class="checkbox-label"><input id="photo-comments" type="checkbox" checked/> Yorum açık</label>
    <label class="checkbox-label"><input id="photo-shares" type="checkbox" checked/> Paylaşım ve iletme açık</label>
    <button class="btn btn-primary" id="photo-save" style="width:100%">Paylaş</button>
    <div id="photo-error" class="form-error mt-4"></div>
  `);

  let songs = [];
  const songSearch = document.getElementById('photo-song-search');
  const songList = document.getElementById('photo-song-list');
  const songInput = document.getElementById('photo-song');
  let selectedSong = null;
  const previewBtn = document.getElementById('photo-song-preview');
  const previewPlayer = document.getElementById('photo-song-preview-player');
  const start = document.getElementById('photo-song-start');
  const time = document.getElementById('photo-song-time');
  document.getElementById('photo-file')?.addEventListener('change', event => {
    const file = event.target.files[0];
    const preview = document.getElementById('photo-file-preview');
    if (!file || !preview) return;
    preview.hidden = false;
    preview.innerHTML = `<img src="${URL.createObjectURL(file)}" alt="Seçilen fotoğraf önizlemesi" />`;
  });

  api('/songs').then(s => {
    songs = s;
    const renderSongs = list => {
      songList.innerHTML = list.slice(0, 30).map(song => `<button type="button" class="story-song-option ${selectedSong?.id === song.id ? 'selected' : ''}" data-song-id="${song.id}">${song.cover_url ? `<img src="${escHtml(song.cover_url)}" alt="" />` : '<span class="story-song-cover"><i class="fas fa-music"></i></span>'}<span><b>${escHtml(song.title)}</b><small>${escHtml(song.artist_name || '')}</small></span><i class="fas fa-play story-song-option-play"></i></button>`).join('') || '<small class="text-muted">Müzik bulunamadı.</small>';
      songList.querySelectorAll('.story-song-option').forEach(button => button.onclick = () => {
        selectedSong = songs.find(song => String(song.id) === button.dataset.songId);
        songInput.value = selectedSong?.id || '';
        renderSongs(songs);
        previewBtn.disabled = !selectedSong?.audio_url;
        start.disabled = !selectedSong;
        start.value = 0;
        start.max = 0;
        if (selectedSong?.audio_url) {
          previewPlayer.src = selectedSong.audio_url;
          previewPlayer.onended = () => { previewBtn.innerHTML = '<i class="fas fa-play"></i> Önizlemeyi başlat'; };
          previewPlayer.load();
          const probe = new Audio(selectedSong.audio_url);
          probe.addEventListener('loadedmetadata', () => { start.max = Math.floor(probe.duration) || 0; });
          updatePreviewUi();
        }
        document.getElementById('photo-song-player').hidden = !selectedSong;
        document.getElementById('photo-song-player').innerHTML = selectedSong ? `<img src="${escHtml(selectedSong.cover_url || '')}" alt="" /><div><b>${escHtml(selectedSong.title)}</b><small>${escHtml(selectedSong.artist_name || '')}</small></div>` : '';
      });
    };
    renderSongs(songs);
    songSearch.oninput = event => { const q = event.target.value.toLowerCase(); renderSongs(songs.filter(song => `${song.title} ${song.artist_name || ''}`.toLowerCase().includes(q))); };
  });

  const showTime = () => {
    const seconds = Number(start.value) || 0;
    time.textContent = Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
    if (previewPlayer && !previewPlayer.paused) {
      previewPlayer.currentTime = Math.max(0, seconds);
    }
  };

  const updatePreviewUi = () => {
    if (previewPlayer && previewPlayer.src) {
      previewPlayer.style.display = 'block';
    } else {
      previewPlayer.style.display = 'none';
      previewBtn.innerHTML = '<i class="fas fa-play"></i> Önizlemeyi başlat';
    }
  };

  start.oninput = showTime;

  previewBtn.onclick = () => {
    if (!previewPlayer?.src) return;
    const targetTime = Math.max(0, Number(start.value) || 0);
    previewPlayer.currentTime = targetTime;
    if (previewPlayer.paused) {
      previewPlayer.play();
      previewBtn.innerHTML = '<i class="fas fa-pause"></i> Önizlemeyi durdur';
    } else {
      previewPlayer.pause();
      previewBtn.innerHTML = '<i class="fas fa-play"></i> Önizlemeyi başlat';
    }
  };

  document.getElementById('photo-save')?.addEventListener('click', async e => {
    const save = e.currentTarget;
    if (save.disabled) return;
    const file = document.getElementById('photo-file').files[0];
    if (!file) { document.getElementById('photo-error').textContent = 'Fotoğraf seçin'; return; }
    save.disabled = true;
    save.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Paylaşılıyor...';
    const fd = new FormData();
    fd.append('image', file);
    ['title', 'caption', 'location'].forEach(k => fd.append(k, document.getElementById('photo-' + k).value.trim()));
    fd.append('song_id', songInput.value);
    fd.append('song_start_seconds', start.value);
    fd.append('show_likes', document.getElementById('photo-likes').checked);
    fd.append('allow_comments', document.getElementById('photo-comments').checked);
    fd.append('allow_shares', document.getElementById('photo-shares').checked);
    try {
      await apiForm('/photos', fd);
      previewPlayer?.pause();
      hideModal();
      toast('Fotoğraf paylaşıldı');
      renderRoute('/fotograflar');
    } catch (err) {
      save.disabled = false;
      save.innerHTML = 'Paylaş';
      document.getElementById('photo-error').textContent = err.message;
    }
  });
}

async function renderMyPlaylists(app) {
  if (!currentUser) { navigate('/giris'); return; }
  document.title = 'Playlistlerim – ' + siteName;
  app.innerHTML = `<div class="container page">
    <div class="page-header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:24px">
      <div class="page-title" style="display:flex;align-items:center;gap:10px">
        <i class="fas fa-list" style="color:var(--accent-red2)"></i> Playlistlerim
      </div>
      <button class="btn btn-primary btn-sm" id="pl-create-btn"><i class="fas fa-plus"></i> Playlist Oluştur</button>
    </div>
    <div id="pl-list"><div class="loading-center"><div class="spinner"></div></div></div>
  </div>`;

  const renderList = async () => {
    const el = document.getElementById('pl-list');
    if (!el) return;
    try {
      const playlists = await api('/playlists');
      if (!playlists.length) {
        el.innerHTML = `<div class="empty-state"><i class="fas fa-list"></i><p>Henüz playlist yok.</p><p style="font-size:13px;color:var(--text-muted)">Yeni bir playlist oluşturun ve şarkılar ekleyin.</p></div>`;
        return;
      }
      el.innerHTML = `<div class="pl-grid">
        ${playlists.map(pl => `
          <div class="pl-card" data-id="${escHtml(pl.public_id || pl.id)}" style="cursor:pointer">
            <div class="pl-card-icon"><i class="fas fa-music"></i></div>
            <div class="pl-card-body">
              <div class="pl-card-name">${escHtml(pl.name)}</div>
              <div class="pl-card-meta">${pl.song_count} şarkı · ${pl.is_public ? 'Herkese açık' : 'Gizli'}</div>
              ${pl.description ? `<div class="pl-card-desc">${escHtml(pl.description)}</div>` : ''}
            </div>
            <div class="pl-card-actions">
              <button class="btn btn-ghost btn-sm pl-edit-btn" data-id="${pl.id}" data-public="${pl.is_public ? '1' : '0'}" data-name="${escHtml(pl.name)}" data-desc="${escHtml(pl.description||'')}" title="Düzenle"><i class="fas fa-edit"></i></button>
              <button class="btn btn-ghost btn-sm pl-del-btn" data-id="${pl.id}" data-name="${escHtml(pl.name)}" title="Sil" style="color:var(--accent-red2)"><i class="fas fa-trash"></i></button>
            </div>
          </div>`).join('')}
      </div>`;
      el.querySelectorAll('.pl-card').forEach(card => {
        card.addEventListener('click', e => {
          if (!e.target.closest('.pl-edit-btn') && !e.target.closest('.pl-del-btn')) {
            navigate('/playlist/' + card.dataset.id);
          }
        });
      });
      el.querySelectorAll('.pl-edit-btn').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          showCreatePlaylistModal('edit', btn.dataset.id, btn.dataset.name, btn.dataset.desc, btn.dataset.public === '1', renderList);
        });
      });
      el.querySelectorAll('.pl-del-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (!confirm(`"${btn.dataset.name}" playlistini silmek istediğinize emin misiniz?`)) return;
          try {
            await api('/playlists/' + btn.dataset.id, { method: 'DELETE' });
            toast('Playlist silindi');
            renderList();
          } catch(err) { toast(err.message, 'error'); }
        });
      });
    } catch(err) { el.innerHTML = `<div class="empty-state"><p>${escHtml(err.message)}</p></div>`; }
  };

  renderList();

  document.getElementById('pl-create-btn')?.addEventListener('click', () => {
    showCreatePlaylistModal('create', null, '', '', true, renderList);
  });
}

function showCreatePlaylistModal(mode, plId, name, desc, isPublic = true, onSave) {
  showModal(mode === 'create' ? '➕ Playlist Oluştur' : '✏️ Playlist Düzenle', `
    <div class="form-group"><label>Playlist Adı *</label><input id="plm-name" value="${escHtml(name||'')}" placeholder="Örn: Sabah Müzikleri" /></div>
    <div class="form-group"><label>Açıklama (isteğe bağlı)</label><input id="plm-desc" value="${escHtml(desc||'')}" placeholder="Kısa açıklama..." /></div>
    <div class="form-group"><label><input type="checkbox" id="plm-public" ${isPublic ? 'checked' : ''} /> Herkese açık</label></div>
    <button class="btn btn-primary" id="plm-save" style="width:100%;justify-content:center">${mode === 'create' ? '<i class="fas fa-plus"></i> Oluştur' : '<i class="fas fa-save"></i> Kaydet'}</button>
    <div id="plm-msg" style="margin-top:8px;font-size:12px;color:var(--accent-red2)"></div>
  `);
  document.getElementById('plm-save')?.addEventListener('click', async () => {
    const n = document.getElementById('plm-name').value.trim();
    const d = document.getElementById('plm-desc').value.trim();
    const isPublicValue = document.getElementById('plm-public').checked;
    const msg = document.getElementById('plm-msg');
    const btn = document.getElementById('plm-save');
    if (!n) { msg.textContent = 'Playlist adı zorunlu'; return; }
    btn.disabled = true;
    try {
      if (mode === 'create') {
        await api('/playlists', { method: 'POST', body: JSON.stringify({ name: n, description: d, is_public: isPublicValue }) });
        toast('Playlist oluşturuldu!');
      } else {
        await api('/playlists/' + plId, { method: 'PUT', body: JSON.stringify({ name: n, description: d, is_public: isPublicValue }) });
        toast('Playlist güncellendi!');
      }
      hideModal();
      if (onSave) onSave();
    } catch(err) { msg.textContent = err.message; btn.disabled = false; }
  });
}

// ===== PLAYLİST DETAY =====
async function renderPlaylistDetail(app, plId) {
  app.innerHTML = '<div class="container page"><div class="loading-center"><div class="spinner"></div></div></div>';
  let playlist;
  try { playlist = await api('/playlists/' + plId); } catch(e) {
    app.innerHTML = `<div class="container page"><div class="empty-state"><i class="fas fa-list"></i><p>${escHtml(e.message)}</p></div></div>`; return;
  }

  document.title = escHtml(playlist.name) + ' – Playlist | ' + siteName;
  let songs = playlist.songs || [];

  const render = () => {
    app.innerHTML = `<div class="container page">
      <div class="page-header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:20px">
        <div>
          <a href="/playlistlerim" data-link style="font-size:13px;color:var(--text-muted);text-decoration:none;display:flex;align-items:center;gap:6px;margin-bottom:6px"><i class="fas fa-chevron-left"></i> Playlistlerim</a>
          <div class="page-title" style="display:flex;align-items:center;gap:10px;margin:0">
            <i class="fas fa-list" style="color:var(--accent-red2)"></i> ${escHtml(playlist.name)}
          </div>
          <div style="font-size:13px;color:var(--text-muted);margin-top:4px">${songs.length} şarkı · ${playlist.is_public ? 'Herkese açık' : 'Gizli'}</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${songs.length ? `
            <button class="btn btn-primary btn-sm" id="pl-play-seq" title="Sırayla çal"><i class="fas fa-play"></i> Çal</button>
            <button class="btn btn-outline btn-sm" id="pl-play-shuf" title="Karışık çal"><i class="fas fa-random"></i> Karışık</button>` : ''}
          ${playlist.is_owner ? `<button class="btn btn-outline btn-sm" id="pl-add-songs-btn"><i class="fas fa-plus"></i> Şarkı Ekle</button>` : ''}
          ${playlist.is_owner ? `<button class="btn btn-ghost btn-sm" id="pl-edit-btn" title="Düzenle"><i class="fas fa-edit"></i></button>` : ''}
          ${!playlist.is_owner && playlist.is_public ? `<button class="btn btn-primary btn-sm" id="pl-save-btn" title="Kaydet"><i class="fas fa-save"></i> Kaydet</button>` : ''}
        </div>
      </div>

      ${songs.length ? `
      <div class="pl-songs-table" id="pl-songs-table">
        ${songs.map((s, i) => `
          <div class="pl-song-row" data-id="${s.id}" draggable="true">
            <div class="pl-drag-handle" title="Sürükle"><i class="fas fa-grip-vertical"></i></div>
            <div class="pl-song-num">${i+1}</div>
            <div class="pl-song-info">
              <div class="music-cover-wrap">
                ${s.cover_url ? `<img src="${escHtml(s.cover_url)}" class="music-cover" />` : `<div class="music-cover music-cover-ph"><i class="fas fa-music"></i></div>`}
                <button class="music-play-mini pl-play-mini" data-idx="${i}" title="Çal"><i class="fas fa-play"></i></button>
              </div>
              <div>
                <div class="music-title">${escHtml(s.title)}</div>
                <div class="music-artist">${escHtml(s.artist_name)}</div>
              </div>
            </div>
            <button class="btn btn-ghost btn-sm pl-remove-btn" data-id="${s.id}" title="Listeden çıkar" style="color:var(--accent-red2);margin-left:auto"><i class="fas fa-times"></i></button>
          </div>`).join('')}
      </div>` : `<div class="empty-state"><i class="fas fa-music"></i><p>Playlist boş.</p><p style="font-size:13px;color:var(--text-muted)">Şarkı eklemek için "Şarkı Ekle" butonuna tıklayın.</p></div>`}
    </div>`;

    // Sırayla çal
    document.getElementById('pl-play-seq')?.addEventListener('click', () => {
      if (!songs.length) return;
      playerShuffle = false;
      currentQueue = songs;
      currentQueueIndex = 0;
      shuffledIndices = songs.map((_, i) => i);
      openMiniPlayer(songs[0].audio_url, songs[0].slug, songs[0], songs, 0);
    });

    // Karışık çal
    document.getElementById('pl-play-shuf')?.addEventListener('click', () => {
      if (!songs.length) return;
      playerShuffle = true;
      const shuffled = [...songs];
      for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
      currentQueue = shuffled;
      currentQueueIndex = 0;
      shuffledIndices = shuffled.map((_, i) => i);
      openMiniPlayer(shuffled[0].audio_url, shuffled[0].slug, shuffled[0], shuffled, 0);
    });

    // Tekil çal
    app.querySelectorAll('.pl-play-mini').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.idx);
        openMiniPlayer(songs[idx].audio_url, songs[idx].slug, songs[idx], songs, idx);
      });
    });

    // Şarkı kaldır
    app.querySelectorAll('.pl-remove-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Bu şarkıyı playlistten çıkarmak istediğinize emin misiniz?')) return;
        try {
          await api('/playlists/' + plId + '/songs/' + btn.dataset.id, { method: 'DELETE' });
          toast('Şarkı listeden çıkarıldı');
          songs = songs.filter(s => String(s.id) !== String(btn.dataset.id));
          render();
        } catch(err) { toast(err.message, 'error'); }
      });
    });

    // Playlist düzenle
    document.getElementById('pl-edit-btn')?.addEventListener('click', () => {
      showCreatePlaylistModal('edit', plId, playlist.name, playlist.description || '', playlist.is_public, async () => {
        try { playlist = await api('/playlists/' + plId); render(); } catch {}
      });
    });

    // Şarkı ekle butonu – müzik listesinden seçme modalı
    document.getElementById('pl-add-songs-btn')?.addEventListener('click', () => showAddSongsModal(plId, songs, (newSongs) => {
      songs = newSongs;
      render();
    }));

    // Drag & Drop sıralama
    document.getElementById('pl-save-btn')?.addEventListener('click', async () => {
      try {
        await api('/playlists/' + plId + '/save', { method: 'POST' });
        toast('Playlist kaydedildi');
        navigate('/playlistlerim');
      } catch(err) { toast(err.message, 'error'); }
    });

    setupPlaylistDnD(app.querySelector('#pl-songs-table'), songs, plId, (reordered) => {
      songs = reordered;
    });
  };

  render();
}

function showAddSongsModal(plId, existingSongs, onAdded) {
  showModal('🎵 Şarkı Ekle', `
    <div class="search-bar" style="margin:0 0 12px 0">
      <i class="fas fa-search"></i>
      <input type="text" id="plsearch" placeholder="Şarkı ara..." style="width:100%" />
    </div>
    <div id="plsearch-list" style="max-height:320px;overflow-y:auto"></div>
  `);

  const existingIds = new Set(existingSongs.map(s => String(s.id)));

  const loadSearch = async (q = '') => {
    const el = document.getElementById('plsearch-list');
    if (!el) return;
    el.innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';
    try {
      const url = q ? `/songs?q=${encodeURIComponent(q)}` : '/songs';
      const allSongs = await api(url);
      if (!allSongs.length) { el.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-muted)">Şarkı bulunamadı</div>'; return; }
      el.innerHTML = allSongs.map(s => `
        <div class="pl-search-row ${existingIds.has(String(s.id)) ? 'pl-search-row-added' : ''}" data-id="${s.id}">
          <div style="display:flex;align-items:center;gap:10px;flex:1">
            ${s.cover_url ? `<img src="${escHtml(s.cover_url)}" style="width:36px;height:36px;border-radius:6px;object-fit:cover" />` : `<div style="width:36px;height:36px;border-radius:6px;background:var(--bg-card2);display:flex;align-items:center;justify-content:center"><i class="fas fa-music" style="font-size:12px;color:var(--text-muted)"></i></div>`}
            <div>
              <div style="font-size:14px;font-weight:600">${escHtml(s.title)}</div>
              <div style="font-size:12px;color:var(--text-muted)">${escHtml(s.artist_name)}</div>
            </div>
          </div>
          <button class="btn btn-sm ${existingIds.has(String(s.id)) ? 'btn-outline' : 'btn-primary'} pl-search-add" data-id="${s.id}" ${existingIds.has(String(s.id)) ? 'disabled' : ''}>
            ${existingIds.has(String(s.id)) ? '<i class="fas fa-check"></i>' : '<i class="fas fa-plus"></i>'}
          </button>
        </div>`).join('');
      el.querySelectorAll('.pl-search-add:not([disabled])').forEach(btn => {
        btn.addEventListener('click', async () => {
          const sid = btn.dataset.id;
          btn.disabled = true; btn.innerHTML = '<div class="spinner" style="width:12px;height:12px"></div>';
          try {
            await api('/playlists/' + plId + '/songs', { method: 'POST', body: JSON.stringify({ song_id: sid }) });
            existingIds.add(sid);
            btn.innerHTML = '<i class="fas fa-check"></i>';
            btn.classList.remove('btn-primary'); btn.classList.add('btn-outline');
            toast('Eklendi!');
            // refresh playlist songs in background
            try {
              const updated = await api('/playlists/' + plId);
              if (onAdded) onAdded(updated.songs || []);
            } catch {}
          } catch(err) { toast(err.message, 'error'); btn.disabled = false; btn.innerHTML = '<i class="fas fa-plus"></i>'; }
        });
      });
    } catch(err) { el.innerHTML = `<div style="padding:16px;color:var(--accent-red2)">${escHtml(err.message)}</div>`; }
  };

  loadSearch();
  let t;
  document.getElementById('plsearch')?.addEventListener('input', e => {
    clearTimeout(t); t = setTimeout(() => loadSearch(e.target.value.trim()), 300);
  });
}

function setupPlaylistDnD(table, songs, plId, onReorder) {
  if (!table) return;
  let dragSrc = null;

  table.querySelectorAll('.pl-song-row').forEach(row => {
    row.addEventListener('dragstart', e => {
      dragSrc = row;
      row.classList.add('pl-dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('pl-dragging');
      table.querySelectorAll('.pl-drag-over').forEach(r => r.classList.remove('pl-drag-over'));
    });
    row.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (row !== dragSrc) {
        table.querySelectorAll('.pl-drag-over').forEach(r => r.classList.remove('pl-drag-over'));
        row.classList.add('pl-drag-over');
      }
    });
    row.addEventListener('drop', async e => {
      e.preventDefault();
      if (!dragSrc || dragSrc === row) return;
      // Reorder DOM
      const rows = [...table.querySelectorAll('.pl-song-row')];
      const fromIdx = rows.indexOf(dragSrc);
      const toIdx = rows.indexOf(row);
      if (fromIdx < toIdx) row.after(dragSrc);
      else row.before(dragSrc);
      // Update songs array
      const newRows = [...table.querySelectorAll('.pl-song-row')];
      const reordered = newRows.map(r => songs.find(s => String(s.id) === r.dataset.id)).filter(Boolean);
      // Update row numbers
      newRows.forEach((r, i) => { const num = r.querySelector('.pl-song-num'); if (num) num.textContent = i + 1; });
      // Update play-mini indices
      newRows.forEach((r, i) => { const pm = r.querySelector('.pl-play-mini'); if (pm) pm.dataset.idx = i; });
      // Persist
      try {
        await api('/playlists/' + plId + '/reorder', { method: 'PUT', body: JSON.stringify({ order: reordered.map(s => s.id) }) });
        if (onReorder) onReorder(reordered);
      } catch(err) { toast(err.message, 'error'); }
    });
  });
}



// ===================================================================
// MAĞAZA (STORE) FRONTEND - app.js'ye eklenecek
// renderRoute() içine ve renderProfile() içine eklemeler var
// ===================================================================

// ---- renderRoute() içine ekle (renderNotFound(app) satırından önce) ----
// if (path === '/magaza') return renderStore(app);
// if (path === '/magaza/basarili') return renderStoreSuccess(app);

// ===================================================================
// MAĞAZA SAYFASI
// ===================================================================
async function renderStore(app) {
  app.innerHTML = `<div class="container page"><div class="loading-center"><div class="spinner"></div></div></div>`;
  document.title = 'Mağaza – ' + siteName;

  const urlParams = new URLSearchParams(location.search);
  const durum = urlParams.get('durum');

  let products = [];
  try { products = await api('/shop/products'); } catch(e) { }

  let mySubscriptions = [];
  if (currentUser) {
    try { mySubscriptions = await api('/shop/my-subscriptions'); } catch {}
  }

  const typeConfig = {
    vip:   { icon: 'fas fa-gem',        color: '#fbbf24', label: 'VIP',   gradient: 'linear-gradient(135deg,#f59e0b,#d97706)' },
    plus:  { icon: 'fas fa-plus-circle', color: '#818cf8', label: 'Plus',  gradient: 'linear-gradient(135deg,#6366f1,#4f46e5)' },
    admin: { icon: 'fas fa-shield-alt',  color: '#22c55e', label: 'Admin', gradient: 'linear-gradient(135deg,#16a34a,#15803d)' },
  };

  function daysLeft(expiresAt) {
    const diff = new Date(expiresAt) - new Date();
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  }

  function myActiveSub(type) {
    return mySubscriptions.find(s => s.type === type && s.is_active);
  }

  function productCardHTML(p) {
    const cfg = typeConfig[p.type] || typeConfig.vip;
    const features = (() => { try { return JSON.parse(p.features || '[]'); } catch { return []; } })();
    const hasSale = p.original_price && parseFloat(p.original_price) > parseFloat(p.price);
    const discountPct = hasSale ? Math.round((1 - parseFloat(p.price)/parseFloat(p.original_price)) * 100) : 0;
    const activeSub = myActiveSub(p.type);

    return `<div class="store-card" data-product-id="${p.id}" data-product-type="${p.type}">
      <div class="store-card-header" style="background:${cfg.gradient}">
        ${hasSale ? `<div class="store-badge-sale">%${discountPct} İNDİRİM</div>` : ''}
        <div class="store-card-icon"><i class="${escHtml(p.badge_icon || cfg.icon)}"></i></div>
        <div class="store-card-type">${escHtml(p.name)}</div>
        <div class="store-card-price-row">
          ${hasSale ? `<span class="store-price-old">${parseFloat(p.original_price).toFixed(2)} ₺</span>` : ''}
          <span class="store-price-new">${parseFloat(p.price).toFixed(2)} ₺</span>
        </div>
        <div class="store-card-duration"><i class="fas fa-clock"></i> ${p.duration_days} günlük üyelik</div>
      </div>
      <div class="store-card-body">
        ${p.description ? `<p class="store-card-desc">${escHtml(p.description)}</p>` : ''}
        ${features.length ? `<ul class="store-features">${features.map(f=>`<li><i class="fas fa-check-circle" style="color:${cfg.color}"></i> ${escHtml(f)}</li>`).join('')}</ul>` : ''}
        ${activeSub ? `
          <div class="store-active-badge"><i class="fas fa-check-circle"></i> Aktif Üyeliğin Var</div>
          <div class="store-active-info"><i class="fas fa-calendar-alt"></i> ${daysLeft(activeSub.expires_at)} gün kaldı · ${new Date(activeSub.expires_at).toLocaleDateString('tr-TR')} bitiyor</div>
          <button class="btn btn-outline store-buy-btn" style="width:100%;margin-top:12px;opacity:0.6;cursor:default" disabled>Aktif Üyelik</button>
        ` : currentUser ? `
          <button class="btn btn-primary store-buy-btn" data-product-id="${p.id}" style="width:100%;margin-top:12px;background:${cfg.gradient};border:none">
            <i class="fas fa-shopping-cart"></i> Satın Al
          </button>
        ` : `
          <button class="btn btn-outline store-buy-btn" style="width:100%;margin-top:12px" onclick="navigate('/giris')">
            <i class="fas fa-sign-in-alt"></i> Giriş Yap & Satın Al
          </button>
        `}
      </div>
    </div>`;
  }

  const alertHTML = durum === 'basarili'
    ? `<div class="store-alert success"><i class="fas fa-check-circle"></i> Ödemeniz başarıyla tamamlandı! Üyeliğiniz birkaç saniye içinde aktif edilecektir.</div>`
    : durum === 'basarisiz'
    ? `<div class="store-alert error"><i class="fas fa-times-circle"></i> Ödeme tamamlanamadı. Lütfen tekrar deneyin.</div>`
    : '';

  const mySubsHTML = (currentUser && mySubscriptions.length) ? `
    <div class="store-section">
      <h2 class="store-section-title"><i class="fas fa-crown" style="color:#fbbf24"></i> Aktif Üyeliklerim</h2>
      <div class="store-my-subs">
        ${mySubscriptions.map(s => {
          const cfg = typeConfig[s.type] || typeConfig.vip;
          const feats = (() => { try { return JSON.parse(s.features || '[]'); } catch { return []; } })();
          const dl = daysLeft(s.expires_at);
          const pct = Math.min(100, Math.round((dl / 30) * 100));
          return `<div class="store-sub-card" style="border-left:3px solid ${cfg.color}">
            <div class="store-sub-header">
              <div style="display:flex;align-items:center;gap:10px">
                <div class="store-sub-icon" style="background:${cfg.color}22;color:${cfg.color}"><i class="${cfg.icon}"></i></div>
                <div>
                  <div class="store-sub-name">${escHtml(s.product_name || cfg.label)}</div>
                  <div class="store-sub-type" style="color:${cfg.color}">${cfg.label} Üyeliği</div>
                </div>
              </div>
              <div class="store-sub-days" style="color:${dl <= 5 ? '#ef4444' : cfg.color}">
                <i class="fas fa-clock"></i> ${dl} gün kaldı
              </div>
            </div>
            <div class="store-sub-progress-bar">
              <div class="store-sub-progress-fill" style="width:${pct}%;background:${cfg.gradient || cfg.color}"></div>
            </div>
            <div class="store-sub-meta">Bitiş: ${new Date(s.expires_at).toLocaleDateString('tr-TR', {day:'2-digit',month:'long',year:'numeric'})}</div>
            ${feats.length ? `<ul class="store-features small">${feats.map(f=>`<li><i class="fas fa-check" style="color:${cfg.color}"></i> ${escHtml(f)}</li>`).join('')}</ul>` : ''}
          </div>`;
        }).join('')}
      </div>
    </div>` : '';

  app.innerHTML = `
  <div class="container page">
    <style>
      .store-hero { text-align:center; padding:48px 0 32px; }
      .store-hero-title { font-size:32px; font-weight:800; letter-spacing:-0.5px; margin-bottom:10px; }
      .store-hero-sub { color:var(--text-muted); font-size:15px; max-width:500px; margin:0 auto; }
      .store-section { margin-bottom:40px; }
      .store-section-title { font-size:18px; font-weight:700; margin-bottom:20px; display:flex; align-items:center; gap:8px; }
      .store-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:20px; }
      .store-card { background:var(--bg2); border:1px solid var(--border); border-radius:16px; overflow:hidden; transition:transform .2s,box-shadow .2s; }
      .store-card:hover { transform:translateY(-2px); box-shadow:0 12px 40px rgba(0,0,0,0.3); }
      .store-card-header { padding:28px 24px 20px; position:relative; text-align:center; }
      .store-badge-sale { position:absolute; top:12px; right:12px; background:#ef4444; color:#fff; font-size:11px; font-weight:700; padding:3px 9px; border-radius:20px; letter-spacing:.5px; }
      .store-card-icon { font-size:36px; color:#fff; margin-bottom:10px; filter:drop-shadow(0 2px 8px rgba(0,0,0,0.3)); }
      .store-card-type { font-size:22px; font-weight:800; color:#fff; margin-bottom:8px; text-shadow:0 1px 3px rgba(0,0,0,0.3); }
      .store-card-price-row { display:flex; align-items:center; justify-content:center; gap:10px; margin-bottom:6px; }
      .store-price-old { font-size:14px; color:rgba(255,255,255,0.65); text-decoration:line-through; }
      .store-price-new { font-size:28px; font-weight:800; color:#fff; text-shadow:0 1px 4px rgba(0,0,0,0.4); }
      .store-card-duration { font-size:12px; color:rgba(255,255,255,0.75); display:flex; align-items:center; justify-content:center; gap:5px; }
      .store-card-body { padding:20px 24px; }
      .store-card-desc { font-size:13px; color:var(--text-muted); margin-bottom:14px; line-height:1.5; }
      .store-features { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:7px; }
      .store-features li { font-size:13px; display:flex; align-items:center; gap:8px; color:var(--text); }
      .store-features.small li { font-size:12px; color:var(--text-muted); }
      .store-active-badge { background:#22c55e15; color:#22c55e; border:1px solid #22c55e33; border-radius:8px; padding:7px 12px; font-size:13px; font-weight:600; display:flex; align-items:center; gap:7px; margin-top:14px; }
      .store-active-info { font-size:12px; color:var(--text-muted); margin-top:6px; display:flex; align-items:center; gap:6px; }
      .store-alert { padding:14px 18px; border-radius:12px; margin-bottom:24px; font-size:14px; display:flex; align-items:center; gap:10px; font-weight:500; }
      .store-alert.success { background:#22c55e18; border:1px solid #22c55e33; color:#22c55e; }
      .store-alert.error { background:#ef444418; border:1px solid #ef444433; color:#ef4444; }
      .store-my-subs { display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:16px; }
      .store-sub-card { background:var(--bg2); border:1px solid var(--border); border-radius:12px; padding:18px; }
      .store-sub-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:14px; }
      .store-sub-icon { width:40px; height:40px; border-radius:10px; display:flex; align-items:center; justify-content:center; font-size:18px; }
      .store-sub-name { font-size:15px; font-weight:700; }
      .store-sub-type { font-size:12px; font-weight:600; margin-top:2px; }
      .store-sub-days { font-size:13px; font-weight:700; display:flex; align-items:center; gap:6px; }
      .store-sub-progress-bar { height:5px; background:var(--bg4); border-radius:99px; overflow:hidden; margin-bottom:8px; }
      .store-sub-progress-fill { height:100%; border-radius:99px; transition:width .3s; }
      .store-sub-meta { font-size:12px; color:var(--text-muted); margin-bottom:10px; }
      .store-empty { text-align:center; padding:60px 0; color:var(--text-muted); }
      .store-empty i { font-size:48px; display:block; margin-bottom:16px; opacity:0.3; }
      .store-buy-btn { transition:opacity .15s,transform .1s; }
      .store-buy-btn:active { transform:scale(0.97); }
    </style>

    ${alertHTML}

    <div class="store-hero">
      <div class="store-hero-title"><i class="fas fa-store" style="color:var(--accent-red)"></i> Mağaza</div>
      <div class="store-hero-sub">VIP, Plus ve Admin üyeliklerini satın alarak platformun tüm özelliklerine erişin.</div>
    </div>

    ${mySubsHTML}

    <div class="store-section">
      <h2 class="store-section-title"><i class="fas fa-box-open"></i> Üyelik Paketleri</h2>
      ${products.length ? `<div class="store-grid">${products.map(productCardHTML).join('')}</div>` :
        `<div class="store-empty"><i class="fas fa-store-alt-slash"></i><p>Henüz ürün yok.</p></div>`}
    </div>
  </div>`;

  // Satın al butonları
  app.querySelectorAll('.store-buy-btn[data-product-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!currentUser) { navigate('/giris'); return; }
      if (btn.closest('.store-card')?.dataset.productType === 'ad_boost') {
        // Boost, 6 haneli reklam koduyla eşleştiği için önce reklam panelinden seçilir.
        navigate('/reklampanel');
        toast('Boost satın almak için reklamınızı reklam panelinden seçin.');
        return;
      }
      const pid = btn.dataset.productId;
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Yönlendiriliyor...';
      try {
        const result = await api('/shop/checkout', {
          method: 'POST',
          body: JSON.stringify({ product_id: parseInt(pid) })
        });
        if (result.payment_url) {
          window.location.href = result.payment_url;
        } else {
          throw new Error('Ödeme linki alınamadı');
        }
      } catch(e) {
        toast(e.message || 'Ödeme başlatılamadı', 'error');
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-shopping-cart"></i> Satın Al';
      }
    });
  });
}

// ===================================================================
// PROFİL SAYFASINDA ABONELİK BİLGİSİ GÖSTER
// renderProfile() içinde .tabs div'inden önce eklenecek
// ===================================================================
async function renderProfileSubscriptions(container, username) {
  if (!currentUser || currentUser.username !== username) return;
  let subs = [];
  try { subs = await api('/shop/my-subscriptions'); } catch {}
  if (!subs.length) return;

  const typeConfig = {
    vip:   { icon: 'fas fa-gem',        color: '#fbbf24', label: 'VIP',   gradient: 'linear-gradient(135deg,#f59e0b,#d97706)' },
    plus:  { icon: 'fas fa-plus-circle', color: '#818cf8', label: 'Plus',  gradient: 'linear-gradient(135deg,#6366f1,#4f46e5)' },
    admin: { icon: 'fas fa-shield-alt',  color: '#22c55e', label: 'Admin', gradient: 'linear-gradient(135deg,#16a34a,#15803d)' },
  };

  function daysLeft(expiresAt) {
    const diff = new Date(expiresAt) - new Date();
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  }

  const subsHTML = subs.map(s => {
    const cfg = typeConfig[s.type] || typeConfig.vip;
    const dl = daysLeft(s.expires_at);
    const feats = (() => { try { return JSON.parse(s.features || '[]'); } catch { return []; } })();
    return `<div class="profile-sub-card" style="border-left:3px solid ${cfg.color};background:var(--bg2);border:1px solid var(--border);border-left:3px solid ${cfg.color};border-radius:12px;padding:14px 16px;margin-bottom:10px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:34px;height:34px;border-radius:9px;background:${cfg.color}22;color:${cfg.color};display:flex;align-items:center;justify-content:center;font-size:16px"><i class="${cfg.icon}"></i></div>
          <div>
            <div style="font-weight:700;font-size:14px">${escHtml(s.product_name || cfg.label)}</div>
            <div style="font-size:11px;color:${cfg.color};font-weight:600">${cfg.label} Üyeliği</div>
          </div>
        </div>
        <div style="text-align:right">
          <div style="font-size:13px;font-weight:700;color:${dl <= 5 ? '#ef4444' : cfg.color}"><i class="fas fa-clock"></i> ${dl} gün</div>
          <div style="font-size:11px;color:var(--text-muted)">kaldı</div>
        </div>
      </div>
      <div style="height:4px;background:var(--bg4);border-radius:99px;overflow:hidden;margin-bottom:8px">
        <div style="height:100%;width:${Math.min(100,Math.round((dl/30)*100))}%;background:${cfg.gradient};border-radius:99px"></div>
      </div>
      <div style="font-size:11px;color:var(--text-muted)">
        <i class="fas fa-calendar-alt"></i> Bitiş tarihi: <strong>${new Date(s.expires_at).toLocaleDateString('tr-TR',{day:'2-digit',month:'long',year:'numeric'})}</strong>
      </div>
      ${feats.length ? `<div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:5px">${feats.map(f=>`<span style="font-size:11px;background:${cfg.color}15;color:${cfg.color};padding:2px 8px;border-radius:20px;border:1px solid ${cfg.color}30">${escHtml(f)}</span>`).join('')}</div>` : ''}
    </div>`;
  }).join('');

  const wrap = document.createElement('div');
  wrap.style.cssText = 'margin-bottom:24px';
  wrap.innerHTML = `
    <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);margin-bottom:12px">
      <i class="fas fa-crown" style="color:#fbbf24;margin-right:6px"></i> Aktif Üyeliklerim
    </div>
    ${subsHTML}
    <button onclick="navigate('/magaza')" class="btn btn-outline btn-sm" style="width:100%;margin-top:4px">
      <i class="fas fa-store"></i> Mağazaya Git
    </button>
  `;
  container.appendChild(wrap);
}

// ===================================================================
// SİPARİŞLERİM SAYFASI
// ===================================================================
async function renderMyOrders(app) {
  if (!currentUser) { navigate('/giris'); return; }
  app.innerHTML = `<div class="container page"><div class="loading-center"><div class="spinner"></div></div></div>`;
  document.title = 'Siparişlerim – ' + siteName;

  let orders = [];
  let subs = [];
  try { orders = await api('/shop/my-orders'); } catch(e) {}
  try { subs = await api('/shop/my-subscriptions'); } catch(e) {}

  const statusLabel = {
    pending: { text: 'Beklemede', color: '#f59e0b', icon: 'fas fa-clock' },
    completed: { text: 'Tamamlandı', color: '#22c55e', icon: 'fas fa-check-circle' },
    failed: { text: 'Başarısız', color: '#ef4444', icon: 'fas fa-times-circle' },
    refunded: { text: 'İade Edildi', color: '#6366f1', icon: 'fas fa-undo' },
  };

  const typeConfig = {
    vip:   { icon: 'fas fa-gem',        color: '#fbbf24', label: 'VIP',   gradient: 'linear-gradient(135deg,#f59e0b,#d97706)' },
    plus:  { icon: 'fas fa-plus-circle', color: '#818cf8', label: 'Plus',  gradient: 'linear-gradient(135deg,#6366f1,#4f46e5)' },
    admin: { icon: 'fas fa-shield-alt',  color: '#22c55e', label: 'Admin', gradient: 'linear-gradient(135deg,#16a34a,#15803d)' },
  };

  function daysLeft(expiresAt) {
    const diff = new Date(expiresAt) - new Date();
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  }

  const activeSubs = subs.filter(s => s.is_active && new Date(s.expires_at) > new Date());

  const subsHTML = activeSubs.length ? `
    <div class="card card-body" style="margin-bottom:24px">
      <div style="font-size:15px;font-weight:700;margin-bottom:16px;display:flex;align-items:center;gap:8px">
        <i class="fas fa-crown" style="color:#fbbf24"></i> Aktif Üyeliklerim
      </div>
      ${activeSubs.map(s => {
        const cfg = typeConfig[s.type] || typeConfig.vip;
        const dl = daysLeft(s.expires_at);
        return `<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border:1px solid var(--border);border-left:3px solid ${cfg.color};border-radius:12px;margin-bottom:10px;background:var(--bg-secondary)">
          <div style="display:flex;align-items:center;gap:10px">
            <div style="width:36px;height:36px;border-radius:10px;background:${cfg.color}22;color:${cfg.color};display:flex;align-items:center;justify-content:center;font-size:17px"><i class="${cfg.icon}"></i></div>
            <div>
              <div style="font-weight:700;font-size:14px">${escHtml(s.product_name || cfg.label)}</div>
              <div style="font-size:12px;color:var(--text-muted)">Bitiş: ${new Date(s.expires_at).toLocaleDateString('tr-TR',{day:'2-digit',month:'long',year:'numeric'})}</div>
            </div>
          </div>
          <div style="text-align:right">
            <div style="font-size:14px;font-weight:700;color:${dl <= 5 ? '#ef4444' : cfg.color}"><i class="fas fa-clock"></i> ${dl} gün</div>
            <div style="font-size:11px;color:var(--text-muted)">kaldı</div>
          </div>
        </div>`;
      }).join('')}
    </div>
  ` : '';

  const ordersHTML = orders.length ? orders.map(o => {
    const st = statusLabel[o.status] || statusLabel.pending;
    const cfg = typeConfig[o.product_type] || typeConfig.vip;
    return `<div class="card card-body" style="margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap">
      <div style="display:flex;align-items:center;gap:12px;flex:1;min-width:0">
        <div style="width:40px;height:40px;border-radius:10px;background:${cfg.color}22;color:${cfg.color};display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0"><i class="${cfg.icon}"></i></div>
        <div style="min-width:0">
          <div style="font-weight:700;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(o.product_name || o.product_type)}</div>
          <div style="font-size:12px;color:var(--text-muted)">${new Date(o.created_at).toLocaleDateString('tr-TR',{day:'2-digit',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'})}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px">Sipariş No: ${escHtml(o.platform_order_id || String(o.id))}</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:16px;flex-shrink:0">
        <div style="font-size:15px;font-weight:700">${parseFloat(o.amount||0).toFixed(2)} ₺</div>
        <div style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:20px;font-size:12px;font-weight:600;background:${st.color}18;color:${st.color};border:1px solid ${st.color}30">
          <i class="${st.icon}"></i> ${st.text}
        </div>
      </div>
    </div>`;
  }).join('') : `<div class="empty-state"><i class="fas fa-receipt"></i><p>Henüz siparişiniz bulunmuyor.</p><a href="/magaza" data-link class="btn btn-primary" style="margin-top:12px"><i class="fas fa-store"></i> Mağazaya Git</a></div>`;

  app.innerHTML = `
    <div class="container page" style="max-width:700px;margin:0 auto;padding:24px 16px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:10px">
        <div>
          <h1 style="font-size:22px;font-weight:800;margin:0">Siparişlerim</h1>
          <div style="font-size:13px;color:var(--text-muted);margin-top:2px">Ödeme geçmişiniz ve aktif üyelikleriniz</div>
        </div>
        <a href="/magaza" data-link class="btn btn-outline btn-sm"><i class="fas fa-store"></i> Mağaza</a>
      </div>
      ${subsHTML}
      <div style="font-size:15px;font-weight:700;margin-bottom:14px;display:flex;align-items:center;gap:8px">
        <i class="fas fa-receipt" style="color:var(--accent-red2)"></i> Sipariş Geçmişi
      </div>
      ${ordersHTML}
    </div>
  `;

  // data-link linkleri SPA navigate'e bağla
  app.querySelectorAll('[data-link]').forEach(a => {
    a.addEventListener('click', e => { e.preventDefault(); navigate(a.getAttribute('href')); });
  });
}
