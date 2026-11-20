/*
 * CigCig Hikayeler — Instagram tarzı tam ekran hikaye görüntüleyici
 * - Tek kalıcı katman; hikayeler arası geçişte sayfa yeniden çizilmez (donma/kasma yok)
 * - Sol/sağ dokunuş: önceki/sonraki · Basılı tut: duraklat (arayüz gizlenir)
 * - Aşağı kaydır: kapat · Yatay kaydır: önceki/sonraki kişi (küp geçişi)
 * - İlerleme çubukları, sonraki/önceki medya önceden yüklenir
 * - Yakın arkadaşlar hikayesi yeşil rozetle gösterilir
 */
(function () {
  'use strict';
  const IMAGE_MS = 5500;
  const g = name => (typeof window[name] === 'function' ? window[name] : null);
  const esc = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const keyOf = story => String(story.public_id || story.id);

  let state = null;

  function preload(story) {
    if (!story?.media_url || story.__preloaded) return;
    story.__preloaded = true;
    if (story.media_type === 'video') {
      const video = document.createElement('video');
      video.preload = 'auto';
      video.muted = true;
      video.src = g('getVideoPlaybackUrl') ? getVideoPlaybackUrl(story.media_url) : story.media_url;
      video.load();
      story.__preloadEl = video;
    } else {
      const image = new Image();
      image.decoding = 'async';
      image.src = story.media_url;
      story.__preloadEl = image;
    }
  }

  function relTime(value) {
    const seconds = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000);
    if (seconds < 60) return 'şimdi';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} dk`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} sa`;
    return `${Math.floor(seconds / 86400)} g`;
  }

  function open({ groups, groupIndex = 0, storyIndex = 0, onClose, onChange }) {
    close(true);
    const root = document.createElement('div');
    root.className = 'igs';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Hikayeler');
    root.innerHTML = `<div class="igs-backdrop"></div>
      <button type="button" class="igs-side igs-side-prev" aria-label="Önceki kişi"><i class="fas fa-chevron-left"></i></button>
      <div class="igs-stage"></div>
      <button type="button" class="igs-side igs-side-next" aria-label="Sonraki kişi"><i class="fas fa-chevron-right"></i></button>`;
    document.body.appendChild(root);
    document.body.classList.add('cg-scroll-locked', 'igs-open');
    state = {
      root, groups, groupIndex, storyIndex,
      onClose, onChange,
      paused: false, holdPaused: false, inputFocused: false,
      startedAt: 0, elapsedBefore: 0, duration: IMAGE_MS, raf: 0,
      media: null, audio: null, muted: localStorage.getItem('cigcig_story_muted') === '1'
    };
    root.querySelector('.igs-side-prev').addEventListener('click', () => switchGroup(-1));
    root.querySelector('.igs-side-next').addEventListener('click', () => switchGroup(1));
    root.querySelector('.igs-backdrop').addEventListener('click', () => close());
    document.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onVisibility);
    renderStory('none');
  }

  function current() {
    const group = state.groups[state.groupIndex];
    return { group, story: group?.stories[state.storyIndex] };
  }

  function stopMedia() {
    cancelAnimationFrame(state.raf);
    if (state.media?.tagName === 'VIDEO') { state.media.pause(); state.media.removeAttribute('src'); state.media.load(); }
    if (state.audio) {
      state.audio.pause();
      if (g('untrackMediaAudio')) untrackMediaAudio(state.audio);
      try { if (typeof activeStoryAudio !== 'undefined' && activeStoryAudio === state.audio) activeStoryAudio = null; } catch { /* yoksay */ }
      state.audio = null;
    }
  }

  function renderStory(transition) {
    const { group, story } = current();
    if (!story) { close(); return; }
    stopMedia();
    // Kendi hikayemiz görülmüş sayılmaz
    const viewer = typeof currentUser !== 'undefined' ? currentUser : null;
    if (!(viewer && String(viewer.id) === String(story.user_id))) story.viewed = true;
    const isVideo = story.media_type === 'video';
    const filter = g('mediaFilterCss') ? mediaFilterCss(story.media_filter) : 'none';
    const src = isVideo && g('getVideoPlaybackUrl') ? getVideoPlaybackUrl(story.media_url) : story.media_url;
    const me = typeof currentUser !== 'undefined' ? currentUser : null;
    const isOwner = Boolean(story.is_owner || (me && String(me.id) === String(story.user_id)));
    const closeFriends = Number(story.close_friends_only) === 1 || story.close_friends_only === true;
    const tick = g('redVerificationIconHTML') ? redVerificationIconHTML(story.is_red_verified, story.red_verified_at) : '';
    const card = document.createElement('article');
    card.className = `igs-card${closeFriends ? ' is-close-friends' : ''}`;
    card.innerHTML = `
      <div class="igs-media-wrap"${!isVideo ? ` style="--igs-bg:url('${esc(src)}')"` : ''}>
        ${isVideo
          ? `<video class="igs-media" src="${esc(src)}" playsinline webkit-playsinline preload="auto" ${state.muted ? 'muted' : ''} style="filter:${esc(filter)}"></video>`
          : `<img class="igs-media" src="${esc(src)}" alt="" draggable="false" decoding="async" style="filter:${esc(filter)}" />`}
        <div class="igs-loading"><span></span></div>
      </div>
      <div class="igs-shade-top"></div><div class="igs-shade-bottom"></div>
      <header class="igs-head">
        <div class="igs-progress">${group.stories.map((_, i) => `<span class="${i < state.storyIndex ? 'is-done' : ''}"><i${i === state.storyIndex ? ' class="is-current"' : ''}></i></span>`).join('')}</div>
        <div class="igs-user">
          <a class="igs-user-link" href="/profil/${encodeURIComponent(story.username || '')}" data-link>
            ${story.avatar && !story.avatar_removed ? `<img class="igs-avatar" src="${esc(story.avatar)}" alt="" />` : '<span class="igs-avatar igs-avatar-ph"><i class="fas fa-user"></i></span>'}
            <strong>${esc(story.username || '')}</strong>${tick}
          </a>
          <time>${esc(relTime(story.created_at))}</time>
          ${closeFriends ? '<span class="igs-cf-badge" title="Yakın Arkadaşlar" aria-label="Yakın Arkadaşlar"><i class="fas fa-star"></i></span>' : ''}
          <span class="igs-head-actions">
            ${isVideo || story.song_audio_url ? `<button type="button" class="igs-icon" data-act="mute" aria-label="Ses"><i class="fas fa-volume-${state.muted ? 'xmark' : 'high'}"></i></button>` : ''}
            <button type="button" class="igs-icon" data-act="pause" aria-label="Durdur"><i class="fas fa-pause"></i></button>
            <button type="button" class="igs-icon" data-act="more" aria-label="Seçenekler"><i class="fas fa-ellipsis"></i></button>
            <button type="button" class="igs-icon" data-act="close" aria-label="Kapat"><i class="fas fa-xmark"></i></button>
          </span>
        </div>
        ${story.song_title ? `<div class="igs-song"><i class="fas fa-music"></i><span>${esc(story.song_title)}${story.song_artist ? ` · ${esc(story.song_artist)}` : ''}</span></div>` : ''}
      </header>
      ${story.caption ? `<p class="igs-caption">${esc(story.caption)}</p>` : ''}
      <div class="igs-hearts"></div>
      <footer class="igs-foot">
        ${isOwner
          ? `<button type="button" class="igs-viewers" data-act="viewers"><i class="far fa-eye"></i><span>${Number(story.total_views) || 0} görüntülenme</span></button>
             <button type="button" class="igs-icon" data-act="delete" aria-label="Sil"><i class="far fa-trash-can"></i></button>`
          : `<form class="igs-reply"><input type="text" maxlength="500" placeholder="${esc(story.username ? `${story.username} kullanıcısına yanıt ver…` : 'Mesaj gönder…')}" enterkeyhint="send" /></form>
             <button type="button" class="igs-icon igs-like${story.liked ? ' is-on' : ''}" data-act="like" aria-label="Beğen"><i class="${story.liked ? 'fas' : 'far'} fa-heart"></i></button>
             <button type="button" class="igs-icon" data-act="share" aria-label="Paylaş"><i class="far fa-paper-plane"></i></button>`}
      </footer>
      <div class="igs-tap igs-tap-prev"></div><div class="igs-tap igs-tap-next"></div>`;

    const stage = state.root.querySelector('.igs-stage');
    const old = stage.querySelector('.igs-card');
    if (old && transition !== 'none') {
      old.classList.add(transition === 'next-group' ? 'is-leaving-left' : transition === 'prev-group' ? 'is-leaving-right' : 'is-fading');
      card.classList.add(transition === 'next-group' ? 'is-entering-right' : transition === 'prev-group' ? 'is-entering-left' : 'is-appearing');
      setTimeout(() => old.remove(), 320);
    } else if (old) {
      old.remove();
    }
    stage.appendChild(card);
    state.card = card;
    state.media = card.querySelector('.igs-media');
    state.root.querySelector('.igs-side-prev').hidden = state.groupIndex === 0 && state.storyIndex === 0;
    bindCard(card, story, isOwner);

    // URL'yi sessizce güncelle (paylaşılabilir bağlantı), sayfa yeniden çizilmez
    const target = '/hikaye/' + encodeURIComponent(keyOf(story));
    if (location.pathname !== target) history.replaceState(history.state || {}, '', target);
    state.onChange?.(story);
    if (g('api')) api('/stories/' + encodeURIComponent(keyOf(story)) + '/view', { method: 'POST' }).catch(() => {});

    // Önceden yükle: sonraki 2 ve önceki 1 hikaye + sonraki kişinin ilk hikayesi
    const seq = [];
    for (let i = 1; i <= 2; i++) seq.push(group.stories[state.storyIndex + i]);
    seq.push(group.stories[state.storyIndex - 1]);
    seq.push(state.groups[state.groupIndex + 1]?.stories.find(item => !item.viewed) || state.groups[state.groupIndex + 1]?.stories[0]);
    seq.filter(Boolean).forEach(preload);

    state.elapsedBefore = 0;
    state.startedAt = 0;
    state.paused = false;
    const ready = () => {
      card.classList.add('is-ready');
      if (isVideo) {
        const d = Number(state.media.duration);
        state.duration = Number.isFinite(d) && d > 0 ? Math.min(60000, d * 1000) : 15000;
        state.media.play().catch(() => {
          // Sesli otomatik oynatma engellendiyse sessiz başlat
          state.media.muted = true;
          state.muted = true;
          syncMuteIcon();
          state.media.play().catch(() => {});
        });
      } else {
        state.duration = story.song_audio_url ? 15000 : IMAGE_MS;
      }
      startSong(story);
      state.startedAt = performance.now();
      loop();
    };
    if (isVideo) {
      state.media.addEventListener('loadedmetadata', ready, { once: true });
      state.media.addEventListener('waiting', () => setBuffering(true));
      state.media.addEventListener('playing', () => setBuffering(false));
      state.media.addEventListener('error', () => { setBuffering(false); next(); }, { once: true });
    } else if (state.media.complete && state.media.naturalWidth) {
      ready();
    } else {
      state.media.addEventListener('load', ready, { once: true });
      state.media.addEventListener('error', () => next(), { once: true });
    }
  }

  function setBuffering(on) {
    state.buffering = on;
    state.card?.classList.toggle('is-buffering', on);
    if (on) { state.elapsedBefore += state.startedAt ? performance.now() - state.startedAt : 0; state.startedAt = 0; }
    else if (!state.paused && !state.holdPaused && !state.inputFocused) state.startedAt = performance.now();
  }

  function startSong(story) {
    if (!story.song_audio_url || !g('trackMediaAudio')) return;
    const audio = trackMediaAudio(new Audio(story.song_audio_url));
    audio.preload = 'auto';
    audio.muted = state.muted;
    state.audio = audio;
    try { activeStoryAudio = audio; } catch { /* yoksay */ }
    if (g('limitMediaAudioClip')) limitMediaAudioClip(audio, Number(story.song_start_seconds) || 0, () => {});
    else audio.currentTime = Number(story.song_start_seconds) || 0;
    audio.play().catch(() => {});
  }

  function progressFraction() {
    const running = state.startedAt ? performance.now() - state.startedAt : 0;
    if (state.media?.tagName === 'VIDEO' && state.media.duration) return state.media.currentTime / state.media.duration;
    return (state.elapsedBefore + running) / state.duration;
  }

  function loop() {
    cancelAnimationFrame(state.raf);
    const frame = () => {
      if (!state) return;
      const fraction = Math.min(1, progressFraction());
      const bar = state.card?.querySelector('.igs-progress .is-current');
      if (bar) bar.style.transform = `scaleX(${fraction})`;
      if (fraction >= 0.999 && !state.paused && !state.holdPaused) { next(); return; }
      state.raf = requestAnimationFrame(frame);
    };
    state.raf = requestAnimationFrame(frame);
  }

  function setPaused(paused, reason = 'manual') {
    if (!state) return;
    const key = reason === 'hold' ? 'holdPaused' : reason === 'input' ? 'inputFocused' : 'paused';
    if (state[key] === paused) return;
    const wasRunning = !state.paused && !state.holdPaused && !state.inputFocused;
    state[key] = paused;
    const running = !state.paused && !state.holdPaused && !state.inputFocused;
    if (wasRunning && !running) {
      state.elapsedBefore += state.startedAt ? performance.now() - state.startedAt : 0;
      state.startedAt = 0;
      if (state.media?.tagName === 'VIDEO') state.media.pause();
      state.audio?.pause();
    } else if (!wasRunning && running) {
      state.startedAt = performance.now();
      if (state.media?.tagName === 'VIDEO') state.media.play().catch(() => {});
      state.audio?.play().catch(() => {});
    }
    state.card?.classList.toggle('is-holding', state.holdPaused);
    const pauseIcon = state.card?.querySelector('[data-act="pause"] i');
    if (pauseIcon) pauseIcon.className = `fas fa-${state.paused ? 'play' : 'pause'}`;
  }

  function syncMuteIcon() {
    const icon = state.card?.querySelector('[data-act="mute"] i');
    if (icon) icon.className = `fas fa-volume-${state.muted ? 'xmark' : 'high'}`;
  }

  function next() {
    const { group } = current();
    if (state.storyIndex < group.stories.length - 1) { state.storyIndex += 1; renderStory('fade'); }
    else switchGroup(1);
  }
  function prev() {
    if (state.storyIndex > 0) { state.storyIndex -= 1; renderStory('fade'); }
    else if (state.groupIndex > 0) switchGroup(-1, true);
    else { state.elapsedBefore = 0; state.startedAt = performance.now(); if (state.media?.tagName === 'VIDEO') state.media.currentTime = 0; }
  }
  function switchGroup(delta, toLast = false) {
    const nextIndex = state.groupIndex + delta;
    if (nextIndex < 0) return;
    if (nextIndex >= state.groups.length) { close(); return; }
    state.groupIndex = nextIndex;
    const stories = state.groups[nextIndex].stories;
    const unseen = stories.findIndex(story => !story.viewed);
    state.storyIndex = toLast ? stories.length - 1 : (unseen >= 0 ? unseen : 0);
    renderStory(delta > 0 ? 'next-group' : 'prev-group');
  }

  function spawnHeart(card) {
    const layer = card.querySelector('.igs-hearts');
    const heart = document.createElement('i');
    heart.className = 'fas fa-heart';
    layer.appendChild(heart);
    setTimeout(() => heart.remove(), 900);
  }

  async function like(story, card, forceOn = false) {
    const button = card.querySelector('[data-act="like"]');
    if (!button || !g('api')) return;
    if (typeof currentUser === 'undefined' || !currentUser) { g('toast')?.('Beğenmek için giriş yap.', 'error'); return; }
    if (forceOn && story.liked) return;
    const optimistic = !story.liked;
    story.liked = optimistic;
    button.classList.toggle('is-on', optimistic);
    button.querySelector('i').className = `${optimistic ? 'fas' : 'far'} fa-heart`;
    try {
      const result = await api('/stories/' + encodeURIComponent(keyOf(story)) + '/like', { method: 'POST' });
      story.liked = !!result.liked;
      story.like_count = result.like_count;
      button.classList.toggle('is-on', story.liked);
      button.querySelector('i').className = `${story.liked ? 'fas' : 'far'} fa-heart`;
    } catch (error) {
      story.liked = !optimistic;
      button.classList.toggle('is-on', story.liked);
      button.querySelector('i').className = `${story.liked ? 'fas' : 'far'} fa-heart`;
      g('toast')?.(error.message, 'error');
    }
  }

  function bindCard(card, story, isOwner) {
    let start = null;
    let holdTimer = 0;
    let lastTapAt = 0;
    const onDown = event => {
      if (event.target.closest('button, a, input, form, .igs-head')) return;
      start = { x: event.clientX, y: event.clientY, t: performance.now() };
      holdTimer = setTimeout(() => setPaused(true, 'hold'), 200);
    };
    const onMove = event => {
      if (!start) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (Math.abs(dy) > 10 || Math.abs(dx) > 10) clearTimeout(holdTimer);
      if (dy > 0 && Math.abs(dy) > Math.abs(dx)) {
        card.style.transform = `translateY(${dy}px) scale(${Math.max(0.85, 1 - dy / 1600)})`;
        state.root.querySelector('.igs-backdrop').style.opacity = String(Math.max(0.2, 1 - dy / 500));
      } else if (Math.abs(dx) > Math.abs(dy)) {
        card.style.transform = `translateX(${dx * 0.6}px)`;
      }
    };
    const onUp = event => {
      clearTimeout(holdTimer);
      if (!start) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      const dt = performance.now() - start.t;
      start = null;
      card.style.transform = '';
      state.root.querySelector('.igs-backdrop').style.opacity = '';
      if (state.holdPaused) { setPaused(false, 'hold'); if (dt > 250) return; }
      if (dy > 110 && Math.abs(dy) > Math.abs(dx)) { close(); return; }
      if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy)) { switchGroup(dx < 0 ? 1 : -1); return; }
      if (Math.abs(dx) > 12 || Math.abs(dy) > 12) return;
      const now = performance.now();
      if (!isOwner && now - lastTapAt < 300) { spawnHeart(card); like(story, card, true); lastTapAt = 0; return; }
      lastTapAt = now;
      const rect = card.getBoundingClientRect();
      const x = event.clientX - rect.left;
      setTimeout(() => {
        if (lastTapAt !== now || !state || state.card !== card) return;
        if (x < rect.width * 0.32) prev(); else next();
      }, isOwner ? 0 : 260);
    };
    card.addEventListener('pointerdown', onDown);
    card.addEventListener('pointermove', onMove, { passive: true });
    card.addEventListener('pointerup', onUp);
    card.addEventListener('pointercancel', () => { clearTimeout(holdTimer); start = null; card.style.transform = ''; setPaused(false, 'hold'); });
    card.addEventListener('contextmenu', event => event.preventDefault());

    card.addEventListener('click', async event => {
      const act = event.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      event.stopPropagation();
      if (act === 'close') close();
      else if (act === 'pause') setPaused(!state.paused);
      else if (act === 'mute') {
        state.muted = !state.muted;
        localStorage.setItem('cigcig_story_muted', state.muted ? '1' : '0');
        if (state.media?.tagName === 'VIDEO') state.media.muted = state.muted;
        if (state.audio) state.audio.muted = state.muted;
        syncMuteIcon();
      } else if (act === 'like') like(story, card);
      else if (act === 'share') { setPaused(true); await g('shareStory')?.(story); }
      else if (act === 'viewers') { setPaused(true); g('showStoryViewers')?.(story); }
      else if (act === 'delete') {
        setPaused(true);
        if (!(await window.CigCigDialogs?.confirm('Bu hikaye silinsin mi?'))) { setPaused(false); return; }
        try {
          await api('/stories/' + encodeURIComponent(keyOf(story)), { method: 'DELETE' });
          g('toast')?.('Hikaye silindi');
          const { group } = current();
          group.stories.splice(state.storyIndex, 1);
          if (!group.stories.length) { state.groups.splice(state.groupIndex, 1); state.storyIndex = 0; if (state.groupIndex >= state.groups.length) { close(); return; } }
          else if (state.storyIndex >= group.stories.length) state.storyIndex = group.stories.length - 1;
          renderStory('fade');
        } catch (error) { g('toast')?.(error.message, 'error'); setPaused(false); }
      } else if (act === 'more') {
        openMore(story, isOwner);
      }
    });

    const form = card.querySelector('.igs-reply');
    const input = form?.querySelector('input');
    input?.addEventListener('focus', () => { setPaused(true, 'input'); card.classList.add('is-typing'); });
    input?.addEventListener('blur', () => { setTimeout(() => { if (state?.card === card) { setPaused(false, 'input'); card.classList.remove('is-typing'); } }, 120); });
    form?.addEventListener('submit', async event => {
      event.preventDefault();
      const content = input.value.trim();
      if (!content) return;
      if (typeof currentUser === 'undefined' || !currentUser) { g('toast')?.('Yanıtlamak için giriş yap.', 'error'); return; }
      input.disabled = true;
      try {
        await api('/stories/' + encodeURIComponent(keyOf(story)) + '/replies', { method: 'POST', body: JSON.stringify({ content }) });
        input.value = '';
        g('toast')?.('Mesaj gönderildi');
        input.blur();
      } catch (error) { g('toast')?.(error.message, 'error'); }
      finally { input.disabled = false; }
    });
  }

  function openMore(story, isOwner) {
    setPaused(true);
    const sheet = document.createElement('div');
    sheet.className = 'ig-sheet igs-sheet';
    sheet.innerHTML = `<div class="ig-sheet-backdrop"></div><section class="ig-sheet-panel" role="dialog" aria-modal="true">
      <span class="ig-sheet-grabber"></span>
      <button type="button" class="ig-sheet-row" data-x="share"><i class="far fa-paper-plane"></i>Paylaş</button>
      <button type="button" class="ig-sheet-row" data-x="copy"><i class="fas fa-link"></i>Bağlantıyı kopyala</button>
      ${isOwner ? '<button type="button" class="ig-sheet-row" data-x="edit"><i class="fas fa-pen"></i>Düzenle</button><button type="button" class="ig-sheet-row" data-x="viewers"><i class="far fa-eye"></i>Görenler</button>' : `<button type="button" class="ig-sheet-row" data-x="profile"><i class="far fa-user"></i>@${esc(story.username || '')} profili</button>`}
      <button type="button" class="ig-sheet-row is-muted" data-x="cancel">Vazgeç</button>
    </section>`;
    document.body.appendChild(sheet);
    requestAnimationFrame(() => sheet.classList.add('is-open'));
    const done = (resume = true) => { sheet.classList.remove('is-open'); setTimeout(() => sheet.remove(), 220); if (resume) setPaused(false); };
    sheet.querySelector('.ig-sheet-backdrop').addEventListener('click', () => done());
    sheet.addEventListener('click', async event => {
      const x = event.target.closest('[data-x]')?.dataset.x;
      if (!x) return;
      if (x === 'share') { done(false); await g('shareStory')?.(story); }
      else if (x === 'copy') { try { await navigator.clipboard.writeText(`${location.origin}/hikaye/${encodeURIComponent(keyOf(story))}`); g('toast')?.('Bağlantı kopyalandı'); } catch { /* yoksay */ } done(); }
      else if (x === 'edit') { done(false); g('showStoryEditModal')?.(story, () => renderStory('none')); }
      else if (x === 'viewers') { done(false); g('showStoryViewers')?.(story); }
      else if (x === 'profile') { done(false); close(); g('navigate')?.('/profil/' + encodeURIComponent(story.username)); }
      else done();
    });
  }

  function onKey(event) {
    if (!state || event.target.closest?.('input, textarea')) return;
    if (event.key === 'Escape') close();
    else if (event.key === 'ArrowRight') next();
    else if (event.key === 'ArrowLeft') prev();
    else if (event.key === ' ') { event.preventDefault(); setPaused(!state.paused); }
  }
  function onVisibility() {
    if (!state) return;
    setPaused(document.hidden, 'hold');
  }

  function close(silent = false) {
    if (!state) return;
    stopMedia();
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('visibilitychange', onVisibility);
    const { root, onClose } = state;
    state = null;
    document.body.classList.remove('cg-scroll-locked', 'igs-open');
    if (silent) { root.remove(); return; }
    root.classList.add('is-closing');
    setTimeout(() => root.remove(), 200);
    onClose?.();
  }

  // Modal (ör. görenler listesi) kapanınca hikaye devam etsin
  document.addEventListener('click', event => {
    if (!state) return;
    if (event.target.closest('#modal-close') || event.target.id === 'modal-overlay') setTimeout(() => setPaused(false), 50);
  }, true);

  window.CigCigStories = { open, close, isOpen: () => Boolean(state) };
})();
