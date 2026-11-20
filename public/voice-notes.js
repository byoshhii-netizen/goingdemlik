/*
 * CigCig Sesli Mesaj — WhatsApp tarzı kayıt ve oynatma
 * - Basılı tut: kaydet, bırak: gönder
 * - Sola kaydır: iptal, yukarı kaydır: kilitle (eller serbest kayıt, duraklat/devam)
 * - Masaüstünde tek tıkla kilitli kayıt başlar
 * - Kayıtlar sunucu üzerinden Cloudinary'ye yüklenir, MP3 olarak oynatılır (iOS dahil)
 * - Oynatıcı: dalga formu, sürükleyerek ileri/geri sarma, 1× / 1.5× / 2× hız,
 *   tek seferde tek ses, art arda gelen sesli mesajları otomatik oynatma
 */
(function () {
  'use strict';

  const MAX_SECONDS = 15 * 60;
  const MIN_MS = 800;
  const BAR_COUNT = 48;
  const CANCEL_DISTANCE = 96;
  const LOCK_DISTANCE = 72;

  const escapeHtml = value => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  function formatClock(totalSeconds) {
    const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
  }

  function vibrate(pattern) {
    try { navigator.vibrate?.(pattern); } catch { /* bazı tarayıcılar desteklemez */ }
  }

  function pickMimeType() {
    if (typeof MediaRecorder === 'undefined') return '';
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/mp4;codecs=mp4a.40.2',
      'audio/mp4',
      'audio/aac',
      'audio/ogg;codecs=opus',
      'audio/webm'
    ];
    return candidates.find(type => {
      try { return MediaRecorder.isTypeSupported(type); } catch { return false; }
    }) || '';
  }

  function isSupported() {
    return Boolean(window.isSecureContext && navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined');
  }

  function normalizeWaveform(raw, count = BAR_COUNT) {
    const source = Array.isArray(raw) ? raw.map(Number).filter(Number.isFinite) : [];
    if (!source.length) return Array.from({ length: count }, (_, i) => 22 + Math.round(18 * Math.abs(Math.sin(i * 1.7))));
    const out = [];
    const step = source.length / count;
    for (let i = 0; i < count; i++) {
      const start = Math.floor(i * step);
      const end = Math.max(start + 1, Math.floor((i + 1) * step));
      let peak = 0;
      for (let j = start; j < end && j < source.length; j++) peak = Math.max(peak, source[j]);
      out.push(peak);
    }
    const max = Math.max(...out, 1);
    return out.map(value => Math.max(8, Math.min(100, Math.round((value / max) * 100))));
  }

  // ===================================================================
  // OYNATICI
  // ===================================================================
  const player = {
    audio: null,
    current: null, // aktif .cg-voice elemanı
    rate: 1,
    raf: 0
  };

  function ensureAudio() {
    if (player.audio) return player.audio;
    const audio = new Audio();
    audio.preload = 'auto';
    audio.setAttribute('playsinline', '');
    audio.addEventListener('timeupdate', syncProgress);
    audio.addEventListener('play', () => { setPlayingState(player.current, true); startRaf(); });
    audio.addEventListener('pause', () => { setPlayingState(player.current, false); stopRaf(); });
    audio.addEventListener('waiting', () => player.current?.classList.add('is-buffering'));
    audio.addEventListener('playing', () => player.current?.classList.remove('is-buffering'));
    audio.addEventListener('canplay', () => player.current?.classList.remove('is-buffering'));
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', () => {
      const el = player.current;
      if (!el) return;
      el.classList.remove('is-buffering');
      el.classList.add('has-error');
      setPlayingState(el, false);
    });
    player.audio = audio;
    return audio;
  }

  function startRaf() {
    stopRaf();
    const tick = () => { syncProgress(); player.raf = requestAnimationFrame(tick); };
    player.raf = requestAnimationFrame(tick);
  }
  function stopRaf() {
    if (player.raf) cancelAnimationFrame(player.raf);
    player.raf = 0;
  }

  function setPlayingState(el, playing) {
    if (!el) return;
    el.classList.toggle('is-playing', playing);
    const button = el.querySelector('.cg-voice-play');
    if (button) {
      button.setAttribute('aria-label', playing ? 'Duraklat' : 'Oynat');
      button.innerHTML = playing ? '<i class="fas fa-pause"></i>' : '<i class="fas fa-play"></i>';
    }
  }

  function elementDuration(el) {
    const audio = player.audio;
    if (audio && player.current === el && Number.isFinite(audio.duration) && audio.duration > 0) return audio.duration;
    return Math.max(1, Number(el?.dataset.duration) || 1);
  }

  function paintProgress(el, ratio) {
    if (!el) return;
    const clamped = Math.max(0, Math.min(1, ratio));
    el.style.setProperty('--cg-voice-progress', `${(clamped * 100).toFixed(2)}%`);
    const bars = el.querySelectorAll('.cg-voice-wave i');
    const played = Math.round(clamped * bars.length);
    bars.forEach((bar, index) => bar.classList.toggle('is-played', index < played));
  }

  function syncProgress() {
    const el = player.current;
    const audio = player.audio;
    if (!el || !audio) return;
    const duration = elementDuration(el);
    paintProgress(el, audio.currentTime / duration);
    const time = el.querySelector('.cg-voice-time');
    if (time) time.textContent = formatClock(audio.paused && audio.currentTime === 0 ? duration : audio.currentTime);
  }

  function resetElement(el) {
    if (!el) return;
    setPlayingState(el, false);
    el.classList.remove('is-buffering', 'is-active');
    paintProgress(el, 0);
    const time = el.querySelector('.cg-voice-time');
    if (time) time.textContent = formatClock(Number(el.dataset.duration) || 0);
  }

  function markListened(el) {
    if (!el || el.dataset.own === '1' || el.dataset.listened === '1') return;
    el.dataset.listened = '1';
    el.classList.add('is-listened');
    const id = el.dataset.messageId;
    if (!id) return;
    const token = localStorage.getItem('token') || '';
    fetch(`/api/messages/${encodeURIComponent(id)}/voice-listened`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
    }).catch(() => {});
  }

  function pauseOtherMedia() {
    document.querySelectorAll('audio, video').forEach(media => {
      if (media !== player.audio && !media.paused && !media.muted) {
        try { media.pause(); } catch { /* yoksay */ }
      }
    });
    window.dispatchEvent(new CustomEvent('cigcig:voice-play'));
  }

  function play(el, { fromStart = false } = {}) {
    const audio = ensureAudio();
    const url = el?.dataset.src;
    if (!url) return;
    if (player.current && player.current !== el) {
      audio.pause();
      resetElement(player.current);
    }
    const sameSource = player.current === el && audio.src === new URL(url, location.href).href;
    player.current = el;
    el.classList.add('is-active');
    el.classList.remove('has-error');
    if (!sameSource) {
      el.classList.add('is-buffering');
      audio.src = url;
      audio.currentTime = 0;
    } else if (fromStart) {
      audio.currentTime = 0;
    }
    audio.playbackRate = player.rate;
    pauseOtherMedia();
    const attempt = audio.play();
    if (attempt?.catch) {
      attempt.catch(error => {
        if (error?.name === 'AbortError') return;
        el.classList.remove('is-buffering');
        el.classList.add('has-error');
        setPlayingState(el, false);
      });
    }
    markListened(el);
  }

  function toggle(el) {
    const audio = ensureAudio();
    if (player.current === el && !audio.paused) {
      audio.pause();
      return;
    }
    play(el);
  }

  function handleEnded() {
    const el = player.current;
    resetElement(el);
    player.current = null;
    // Aynı kişiden gelen bir sonraki sesli mesajı otomatik oynat (WhatsApp davranışı).
    const row = el?.closest('.dm-msg-wrap');
    if (!row) return;
    let next = row.nextElementSibling;
    while (next && !next.matches('.dm-msg-wrap')) next = next.nextElementSibling;
    const nextVoice = next?.querySelector('.cg-voice');
    if (nextVoice && next.dataset.senderId === row.dataset.senderId && nextVoice.dataset.listened !== '1' && nextVoice.dataset.own !== '1') {
      setTimeout(() => play(nextVoice, { fromStart: true }), 280);
    }
  }

  function seekFromPointer(el, clientX) {
    const wave = el.querySelector('.cg-voice-wave');
    if (!wave) return;
    const rect = wave.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
    if (player.current !== el) {
      play(el);
    }
    const audio = ensureAudio();
    const apply = () => {
      const duration = elementDuration(el);
      audio.currentTime = ratio * duration;
      paintProgress(el, ratio);
    };
    if (audio.readyState >= 1) apply();
    else audio.addEventListener('loadedmetadata', apply, { once: true });
  }

  function cycleRate(el) {
    const rates = [1, 1.5, 2];
    player.rate = rates[(rates.indexOf(player.rate) + 1) % rates.length];
    if (player.audio) player.audio.playbackRate = player.rate;
    document.querySelectorAll('.cg-voice-rate').forEach(button => { button.textContent = `${player.rate}×`; });
    if (el) el.querySelector('.cg-voice-rate')?.blur();
  }

  function bubbleHTML(message, isOwn) {
    const duration = Math.max(1, Number(message.voice_duration) || 1);
    let waveform = message.voice_waveform;
    if (typeof waveform === 'string') { try { waveform = JSON.parse(waveform); } catch { waveform = []; } }
    const bars = normalizeWaveform(waveform, 36);
    const listened = isOwn || Boolean(message.voice_listened_at);
    return `<div class="cg-voice${isOwn ? ' is-own' : ''}${listened ? ' is-listened' : ''}" data-src="${escapeHtml(message.voice_url)}" data-duration="${duration}" data-message-id="${escapeHtml(String(message.id ?? ''))}" data-own="${isOwn ? '1' : '0'}" data-listened="${listened ? '1' : '0'}" style="--cg-voice-progress:0%">
      <button type="button" class="cg-voice-play" aria-label="Oynat"><i class="fas fa-play"></i></button>
      <div class="cg-voice-body">
        <div class="cg-voice-wave" role="slider" tabindex="0" aria-label="Sesli mesaj konumu" aria-valuemin="0" aria-valuemax="${duration}" aria-valuenow="0">${bars.map(height => `<i style="height:${height}%"></i>`).join('')}<span class="cg-voice-thumb"></span></div>
        <div class="cg-voice-meta"><span class="cg-voice-time">${formatClock(duration)}</span><button type="button" class="cg-voice-rate" aria-label="Oynatma hızı">${player.rate}×</button></div>
      </div>
      <span class="cg-voice-mic" aria-hidden="true"><i class="fas fa-microphone"></i></span>
    </div>`;
  }

  // Olay delegasyonu: sonradan eklenen mesajlar da otomatik çalışır.
  let scrubbing = null;
  document.addEventListener('click', event => {
    const playButton = event.target.closest('.cg-voice-play');
    if (playButton) {
      event.preventDefault();
      event.stopPropagation();
      toggle(playButton.closest('.cg-voice'));
      return;
    }
    const rateButton = event.target.closest('.cg-voice-rate');
    if (rateButton) {
      event.preventDefault();
      event.stopPropagation();
      cycleRate(rateButton.closest('.cg-voice'));
    }
  }, true);
  document.addEventListener('pointerdown', event => {
    const wave = event.target.closest('.cg-voice-wave');
    if (!wave) return;
    const el = wave.closest('.cg-voice');
    event.preventDefault();
    event.stopPropagation();
    scrubbing = { el, pointerId: event.pointerId };
    try { wave.setPointerCapture(event.pointerId); } catch { /* yoksay */ }
    seekFromPointer(el, event.clientX);
  }, true);
  document.addEventListener('pointermove', event => {
    if (!scrubbing || scrubbing.pointerId !== event.pointerId) return;
    event.preventDefault();
    seekFromPointer(scrubbing.el, event.clientX);
  }, true);
  const endScrub = event => {
    if (scrubbing && scrubbing.pointerId === event.pointerId) scrubbing = null;
  };
  document.addEventListener('pointerup', endScrub, true);
  document.addEventListener('pointercancel', endScrub, true);
  document.addEventListener('keydown', event => {
    const wave = event.target.closest?.('.cg-voice-wave');
    if (!wave) return;
    const el = wave.closest('.cg-voice');
    if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); toggle(el); }
    if ((event.key === 'ArrowRight' || event.key === 'ArrowLeft') && player.current === el && player.audio) {
      event.preventDefault();
      player.audio.currentTime = Math.max(0, player.audio.currentTime + (event.key === 'ArrowRight' ? 5 : -5));
    }
  });
  // Sohbetten çıkıldığında çalan sesi durdur.
  window.addEventListener('popstate', () => { if (player.audio && !player.audio.paused && !document.contains(player.current)) player.audio.pause(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (player.current && !document.contains(player.current)) { player.audio?.pause(); player.current = null; }
  });

  // Karşı taraf dinlediğinde gönderilen mesajdaki mikrofon simgesi maviye döner.
  function markRemoteListened(messageId) {
    document.querySelectorAll(`.dm-msg-wrap[data-id="${CSS.escape(String(messageId))}"] .cg-voice`).forEach(el => {
      el.classList.add('is-peer-listened');
    });
  }

  // ===================================================================
  // KAYDEDİCİ
  // ===================================================================
  class VoiceRecorder {
    constructor({ inputBar, micButton, onSend, onStateChange }) {
      this.inputBar = inputBar;
      this.micButton = micButton;
      this.onSend = onSend;
      this.onStateChange = onStateChange || (() => {});
      this.state = 'idle'; // idle | starting | recording | locked | paused
      this.stream = null;
      this.recorder = null;
      this.chunks = [];
      this.samples = [];
      this.audioContext = null;
      this.analyser = null;
      this.sampleTimer = 0;
      this.clockTimer = 0;
      this.startedAt = 0;
      this.pausedTotal = 0;
      this.pausedAt = 0;
      this.pointer = null;
      this.cancelled = false;
      this.overlay = null;
      this.bindMic();
    }

    bindMic() {
      const mic = this.micButton;
      if (!mic) return;
      mic.addEventListener('contextmenu', event => event.preventDefault());
      mic.addEventListener('pointerdown', event => this.handlePointerDown(event));
      mic.addEventListener('pointermove', event => this.handlePointerMove(event));
      mic.addEventListener('pointerup', event => this.handlePointerUp(event));
      mic.addEventListener('pointercancel', event => this.handlePointerUp(event, true));
      mic.addEventListener('keydown', event => {
        if ((event.key === 'Enter' || event.key === ' ') && this.state === 'idle') {
          event.preventDefault();
          this.start({ locked: true });
        }
      });
    }

    get elapsedMs() {
      if (!this.startedAt) return 0;
      const pausedNow = this.state === 'paused' && this.pausedAt ? Date.now() - this.pausedAt : 0;
      return Date.now() - this.startedAt - this.pausedTotal - pausedNow;
    }

    handlePointerDown(event) {
      if (event.button !== undefined && event.button !== 0) return;
      if (this.state !== 'idle') return;
      event.preventDefault();
      if (!isSupported()) {
        this.toast('Bu tarayıcı sesli mesaj kaydını desteklemiyor.', 'error');
        return;
      }
      // Fare ile tek tık: eller serbest (kilitli) kayıt. Dokunmatik: basılı tut.
      const locked = event.pointerType === 'mouse';
      this.pointer = locked ? null : { id: event.pointerId, x: event.clientX, y: event.clientY, downAt: Date.now() };
      if (!locked) {
        try { this.micButton.setPointerCapture(event.pointerId); } catch { /* yoksay */ }
      }
      this.start({ locked });
    }

    handlePointerMove(event) {
      if (!this.pointer || this.pointer.id !== event.pointerId) return;
      if (this.state !== 'recording' && this.state !== 'starting') return;
      const dx = event.clientX - this.pointer.x;
      const dy = event.clientY - this.pointer.y;
      const slideLeft = Math.max(0, -dx);
      const slideUp = Math.max(0, -dy);
      if (this.overlay) {
        this.overlay.style.setProperty('--cg-rec-slide', `${Math.min(slideLeft, CANCEL_DISTANCE + 20)}px`);
        this.overlay.style.setProperty('--cg-rec-lift', `${Math.min(slideUp, LOCK_DISTANCE + 10)}px`);
        this.overlay.classList.toggle('is-near-cancel', slideLeft > CANCEL_DISTANCE * 0.6);
        this.overlay.classList.toggle('is-near-lock', slideUp > LOCK_DISTANCE * 0.6);
      }
      if (slideLeft > CANCEL_DISTANCE && slideLeft > slideUp) {
        vibrate([12, 40, 12]);
        this.cancel();
      } else if (slideUp > LOCK_DISTANCE && slideUp > slideLeft) {
        vibrate(18);
        this.lock();
      }
    }

    handlePointerUp(event, isCancel = false) {
      if (!this.pointer || this.pointer.id !== event.pointerId) return;
      const heldFor = Date.now() - this.pointer.downAt;
      this.pointer = null;
      try { this.micButton.releasePointerCapture(event.pointerId); } catch { /* yoksay */ }
      if (this.state === 'locked' || this.state === 'paused' || this.state === 'idle') return;
      if (isCancel) { this.cancel(); return; }
      if (heldFor < 300 && this.state === 'starting') {
        // Hızlı dokunuş: ipucu göster.
        this.cancel(true);
        this.hint('Kaydetmek için basılı tut, bırakınca gönderilir');
        return;
      }
      this.finish();
    }

    toast(message, type = 'success') {
      if (typeof window.toast === 'function') window.toast(message, type);
    }

    hint(message) {
      const bar = this.inputBar;
      if (!bar) return;
      let tip = bar.querySelector('.cg-rec-hint');
      if (!tip) {
        tip = document.createElement('div');
        tip.className = 'cg-rec-hint';
        tip.setAttribute('role', 'status');
        bar.appendChild(tip);
      }
      tip.textContent = message;
      tip.classList.add('is-visible');
      clearTimeout(this.hintTimer);
      this.hintTimer = setTimeout(() => tip.classList.remove('is-visible'), 1800);
    }

    async start({ locked = false } = {}) {
      this.state = 'starting';
      this.cancelled = false;
      this.chunks = [];
      this.samples = [];
      this.pausedTotal = 0;
      this.pausedAt = 0;
      this.renderOverlay();
      this.onStateChange(true);
      // AudioContext iOS'ta kullanıcı hareketi içinde oluşturulmalı.
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (Ctx) this.audioContext = new Ctx();
      } catch { this.audioContext = null; }
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }
        });
      } catch (error) {
        this.teardown();
        const denied = error?.name === 'NotAllowedError' || error?.name === 'SecurityError';
        this.toast(denied ? 'Mikrofon izni verilmedi. Tarayıcı ayarlarından mikrofona izin ver.' : 'Mikrofon başlatılamadı.', 'error');
        return;
      }
      if (this.cancelled || this.state !== 'starting') { this.teardown(); return; }
      const mimeType = pickMimeType();
      try {
        this.recorder = new MediaRecorder(this.stream, mimeType ? { mimeType, audioBitsPerSecond: 48000 } : undefined);
      } catch {
        this.recorder = new MediaRecorder(this.stream);
      }
      this.recorder.addEventListener('dataavailable', event => { if (event.data?.size) this.chunks.push(event.data); });
      this.recorder.start(250);
      this.startedAt = Date.now();
      this.state = locked ? 'locked' : 'recording';
      this.overlay?.classList.toggle('is-locked', locked);
      this.inputBar?.classList.toggle('is-rec-locked', locked);
      this.overlay?.classList.add('is-live');
      vibrate(25);
      this.startMetering();
      this.clockTimer = setInterval(() => this.tickClock(), 200);
    }

    startMetering() {
      if (!this.audioContext || !this.stream) return;
      try {
        if (this.audioContext.state === 'suspended') this.audioContext.resume().catch(() => {});
        const source = this.audioContext.createMediaStreamSource(this.stream);
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 512;
        source.connect(this.analyser);
        const data = new Uint8Array(this.analyser.fftSize);
        const liveBars = this.overlay?.querySelector('.cg-rec-live-wave');
        this.sampleTimer = setInterval(() => {
          if (this.state === 'paused' || !this.analyser) return;
          this.analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; }
          const level = Math.min(100, Math.round(Math.sqrt(sum / data.length) * 320));
          this.samples.push(level);
          if (liveBars) {
            const bar = document.createElement('i');
            bar.style.height = `${Math.max(10, level)}%`;
            liveBars.appendChild(bar);
            while (liveBars.childElementCount > 60) liveBars.firstElementChild.remove();
          }
        }, 80);
      } catch { /* görselleştirme opsiyoneldir */ }
    }

    tickClock() {
      const seconds = this.elapsedMs / 1000;
      const clock = this.overlay?.querySelector('.cg-rec-clock');
      if (clock) clock.textContent = formatClock(seconds);
      if (seconds >= MAX_SECONDS) {
        this.toast('En fazla 15 dakikalık sesli mesaj gönderebilirsin.');
        this.finish();
      }
    }

    lock() {
      if (this.state !== 'recording') return;
      this.state = 'locked';
      this.overlay?.classList.add('is-locked');
      this.inputBar?.classList.add('is-rec-locked');
      this.overlay?.classList.remove('is-near-lock', 'is-near-cancel');
    }

    pauseOrResume() {
      if (!this.recorder) return;
      if (this.state === 'locked' && this.recorder.state === 'recording' && typeof this.recorder.pause === 'function') {
        this.recorder.pause();
        this.state = 'paused';
        this.pausedAt = Date.now();
        this.overlay?.classList.add('is-paused');
      } else if (this.state === 'paused') {
        this.recorder.resume();
        this.pausedTotal += Date.now() - this.pausedAt;
        this.pausedAt = 0;
        this.state = 'locked';
        this.overlay?.classList.remove('is-paused');
      }
      const button = this.overlay?.querySelector('[data-rec-action="pause"]');
      if (button) button.innerHTML = this.state === 'paused' ? '<i class="fas fa-microphone"></i>' : '<i class="fas fa-pause"></i>';
    }

    cancel(silent = false) {
      if (this.state === 'idle') return;
      this.cancelled = true;
      if (!silent) this.overlay?.classList.add('is-cancelled');
      const finalize = () => this.teardown();
      if (this.recorder && this.recorder.state !== 'inactive') {
        this.recorder.addEventListener('stop', finalize, { once: true });
        try { this.recorder.stop(); } catch { finalize(); }
      } else {
        finalize();
      }
    }

    finish() {
      if (this.state === 'idle' || this.state === 'starting') { this.cancel(true); return; }
      const durationMs = this.elapsedMs;
      if (durationMs < MIN_MS) {
        this.cancel(true);
        this.hint('Kaydetmek için basılı tut, bırakınca gönderilir');
        return;
      }
      const recorder = this.recorder;
      const mimeType = recorder?.mimeType || 'audio/webm';
      const samples = this.samples.slice();
      recorder.addEventListener('stop', () => {
        const blob = new Blob(this.chunks, { type: mimeType.split(';')[0] || 'audio/webm' });
        this.teardown();
        if (blob.size < 600) { this.toast('Ses kaydı alınamadı. Mikrofonu kontrol et.', 'error'); return; }
        vibrate(15);
        this.onSend?.({
          blob,
          mimeType,
          duration: Math.max(1, Math.round(durationMs / 1000)),
          waveform: normalizeWaveform(samples, 64)
        });
      }, { once: true });
      try {
        if (recorder.state === 'paused') recorder.resume();
        recorder.requestData?.();
        recorder.stop();
      } catch {
        this.teardown();
      }
      this.state = 'idle';
    }

    teardown() {
      clearInterval(this.clockTimer);
      clearInterval(this.sampleTimer);
      this.clockTimer = 0;
      this.sampleTimer = 0;
      this.stream?.getTracks().forEach(track => track.stop());
      this.stream = null;
      this.analyser = null;
      if (this.audioContext) { this.audioContext.close().catch(() => {}); this.audioContext = null; }
      this.recorder = null;
      this.startedAt = 0;
      this.state = 'idle';
      const overlay = this.overlay;
      this.overlay = null;
      if (overlay) {
        overlay.classList.add('is-leaving');
        setTimeout(() => overlay.remove(), overlay.classList.contains('is-cancelled') ? 420 : 160);
      }
      this.inputBar?.classList.remove('is-recording', 'is-rec-locked');
      this.onStateChange(false);
    }

    renderOverlay() {
      this.overlay?.remove();
      const overlay = document.createElement('div');
      overlay.className = 'cg-rec';
      overlay.innerHTML = `
        <div class="cg-rec-lock" aria-hidden="true"><i class="fas fa-lock-open"></i><i class="fas fa-chevron-up"></i></div>
        <div class="cg-rec-row">
          <button type="button" class="cg-rec-btn cg-rec-trash" data-rec-action="cancel" aria-label="Kaydı sil"><i class="fas fa-trash"></i></button>
          <span class="cg-rec-dot" aria-hidden="true"></span>
          <span class="cg-rec-clock" aria-live="off">0:00</span>
          <div class="cg-rec-live-wave" aria-hidden="true"></div>
          <span class="cg-rec-slide-hint"><i class="fas fa-chevron-left"></i> İptal için kaydır</span>
          <button type="button" class="cg-rec-btn cg-rec-pause" data-rec-action="pause" aria-label="Duraklat / devam et"><i class="fas fa-pause"></i></button>
          <button type="button" class="cg-rec-btn cg-rec-send" data-rec-action="send" aria-label="Sesli mesajı gönder"><i class="fas fa-paper-plane"></i></button>
        </div>`;
      overlay.addEventListener('click', event => {
        const action = event.target.closest('[data-rec-action]')?.dataset.recAction;
        if (!action) return;
        event.preventDefault();
        event.stopPropagation();
        if (action === 'cancel') { vibrate([10, 30, 10]); this.cancel(); }
        else if (action === 'pause') this.pauseOrResume();
        else if (action === 'send') this.finish();
      });
      this.inputBar?.appendChild(overlay);
      this.inputBar?.classList.add('is-recording');
      this.overlay = overlay;
    }

    destroy() {
      if (this.state !== 'idle') this.cancel(true);
    }
  }

  // ===================================================================
  // GÖNDERİM (yükleme + mesaj oluşturma)
  // ===================================================================
  async function uploadVoice({ blob, mimeType, duration, waveform }, onProgress) {
    const extension = /mp4|aac|m4a/.test(mimeType) ? 'm4a' : /ogg/.test(mimeType) ? 'ogg' : 'webm';
    const form = new FormData();
    form.append('audio', blob, `sesli-mesaj.${extension}`);
    form.append('duration', String(duration));
    form.append('waveform', JSON.stringify(waveform));
    const token = localStorage.getItem('token') || '';
    // XHR: yükleme ilerlemesi gösterilebilsin.
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/dm/voice-upload');
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.responseType = 'json';
      xhr.timeout = 120000;
      xhr.upload.addEventListener('progress', event => {
        if (event.lengthComputable) onProgress?.(event.loaded / event.total);
      });
      xhr.addEventListener('load', () => {
        const data = xhr.response || {};
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new Error(data.error || 'Sesli mesaj yüklenemedi.'));
      });
      xhr.addEventListener('error', () => reject(new Error('Bağlantı hatası. Sesli mesaj gönderilemedi.')));
      xhr.addEventListener('timeout', () => reject(new Error('Yükleme zaman aşımına uğradı.')));
      xhr.send(form);
    });
  }

  function pendingBubbleHTML(duration) {
    return `<div class="dm-msg-wrap dm-own cg-voice-pending" data-pending="1">
      <div class="dm-msg-content"><div class="dm-msg-bubble">
        <div class="cg-voice is-own is-uploading" data-duration="${duration}" style="--cg-voice-progress:0%">
          <span class="cg-voice-play cg-voice-spinner" aria-hidden="true"><svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="15"></circle></svg><i class="fas fa-arrow-up"></i></span>
          <div class="cg-voice-body"><div class="cg-voice-wave">${normalizeWaveform([], 36).map(h => `<i style="height:${h}%"></i>`).join('')}</div>
          <div class="cg-voice-meta"><span class="cg-voice-time">${formatClock(duration)}</span><span class="cg-voice-status">Gönderiliyor…</span></div></div>
        </div>
      </div></div></div>`;
  }

  window.CigCigVoice = {
    isSupported,
    VoiceRecorder,
    bubbleHTML,
    pendingBubbleHTML,
    uploadVoice,
    formatClock,
    markRemoteListened,
    stopPlayback() { player.audio?.pause(); if (player.current) resetElement(player.current); player.current = null; }
  };
})();
