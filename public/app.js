let currentUser = null;
let currentToken = localStorage.getItem('token');
let realsFeedOrder = null;
let siteName = 'CigCig';

const SITE_URL = 'https://cigcig.up.railway.app';

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
  canonical.setAttribute('href', location.href);

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
  $('#modal-overlay').classList.add('hidden');
}

$('#modal-close').addEventListener('click', hideModal);
$('#modal-overlay').addEventListener('click', e => { if (e.target === $('#modal-overlay')) hideModal(); });

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (currentToken) headers['Authorization'] = 'Bearer ' + currentToken;
  const res = await fetch('/api' + path, { ...options, headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Hata');
  return data;
}

async function apiForm(path, formData, method = 'POST') {
  const headers = {};
  if (currentToken) headers['Authorization'] = 'Bearer ' + currentToken;
  const res = await fetch('/api' + path, { method, body: formData, headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Hata');
  return data;
}

function timeAgo(dt) {
  const now = new Date();
  const d = new Date(dt);
  const sec = Math.floor((now - d) / 1000);
  if (sec < 60) return 'az önce';
  if (sec < 3600) return Math.floor(sec / 60) + ' dk önce';
  if (sec < 86400) return Math.floor(sec / 3600) + ' sa önce';
  if (sec < 604800) return Math.floor(sec / 86400) + ' gün önce';
  return d.toLocaleDateString('tr-TR');
}

function formatDate(dt) {
  return new Date(dt).toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric' });
}

function escHtml(s) {
  if (!s) return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function closeMobileMenu() {
  $('#mobile-menu')?.classList.add('hidden');
}

function userDisplayName(u) {
  if (!u) return 'Silindi';
  const color = (u.show_level_color !== 0 && u.name_color) ? `style="color:${escHtml(u.name_color)}"` : '';
  const adminBadge = u.is_admin ? ` <i class="fas fa-shield user-admin" title="CigCig Yetkilisi" data-admin-since="${escHtml(u.admin_since || '')}" style="color:#5865F2;cursor:pointer;font-size:13px"></i>` : '';
  return `<span class="user-badge" ${color}>${escHtml(u.username)}${u.is_vip ? ' <i class="fas fa-gem user-vip" title="VIP"></i>' : ''}${u.is_plus ? ' <i class="fas fa-plus user-plus" title="Plus"></i>' : ''}${adminBadge}</span>`;
}

function avatarImg(u, cls = 'avatar-sm') {
  if (u && u.avatar) return `<img src="${escHtml(u.avatar)}" class="${cls}" alt="" />`;
  return `<div class="${cls} avatar-placeholder" style="font-size:0.75em;font-weight:700;color:var(--text-muted)">?</div>`;
}

// ===== IÇERIK RENDER (hashtag + mention) =====
function renderContent(text) {
  if (!text) return '';
  // XSS güvenli: önce escape, sonra pattern'lere dönüştür
  const safe = String(text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return safe
    // #hashtag → mavi tıklanabilir link
    .replace(/#([a-zA-Z0-9_çğıöşüÇĞİÖŞÜ]+)/g, (_, tag) =>
      `<a href="/forum?tag=${encodeURIComponent(tag)}" data-link class="inline-hashtag">#${tag}</a>`)
    // @mention → profil link
    .replace(/@([a-zA-Z0-9_çğıöşüÇĞİÖŞÜ]+)/g, (_, user) =>
      `<a href="/profil/${encodeURIComponent(user)}" data-link class="inline-mention">@${user}</a>`);
}

function navigate(path, push = true) {
  closeMobileMenu();
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
  // Query string'i ayır
  const [path, queryStr] = fullPath.split('?');
  updateNavActive(path);
  // Mesajlar sayfasında footer gizle
  const siteFooter = document.getElementById('site-footer');
  if (siteFooter) {
    siteFooter.style.display = (path === '/mesajlar' || path.startsWith('/mesajlar/')) ? 'none' : '';
  }
  const app = $('#app');
  const segs = path.split('/').filter(Boolean);

  if (path === '/') return renderHome(app);
  if (path === '/forum') {
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
  if (path.startsWith('/grup/')) return renderGroupDetail(app, segs[1]);
  if (path === '/videolar') return renderVideoList(app);
  if (path.startsWith('/video/')) return renderVideoDetail(app, segs[1]);
  if (path === '/reals') return renderRealsFeed(app);
  if (path.startsWith('/reals/')) return renderVideoDetail(app, segs[1]);
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
  if (path === '/artist-basvuru') return renderArtistApply(app);
  if (path === '/artist-panel') return renderArtistPanel(app);
  if (path === '/sarki-yukle') return renderShareSong(app);
  if (path === '/playlistlerim') return renderMyPlaylists(app);
  if (path.startsWith('/playlist/')) return renderPlaylistDetail(app, segs[1]);
    if (path === '/magaza') return renderStore(app);
  if (path === '/siparislerim') return renderMyOrders(app);
  if (path === '/fotograflar') return renderPhotoFeed(app);
  if (path.startsWith('/foto/')) return renderPhotoDetail(app, segs[1]);
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
      <div id="reals-list" class="reals-list"></div>
    </div>`;

  // fetch reals
  let reals = [];
  try { reals = await api('/reals'); } catch (e) { document.getElementById('reals-list').innerHTML = '<div style="padding:24px;color:var(--red2)">'+escHtml(e.message)+'</div>'; return; }
  const listEl = document.getElementById('reals-list');
  if (!reals.length) { listEl.innerHTML = '<div class="empty-state"><i class="fas fa-video"></i><p>Reals bulunamadı.</p></div>'; return; }

  // page refresh resets order; same tab navigation preserves it
  const currentIds = reals.map(r => r.id);
  if (!Array.isArray(realsFeedOrder) || realsFeedOrder.length !== currentIds.length || currentIds.some(id => !realsFeedOrder.includes(id))) {
    realsFeedOrder = shuffleArray(currentIds);
  }
  const orderedReals = realsFeedOrder.map(id => reals.find(r => r.id === id)).filter(Boolean);

  // show reminder once per user (server provides text)
  try {
    const rs = await fetch('/api/reals-settings');
    const data = await rs.json();
    const reminder = data.reminder || '';
    if (reminder && !localStorage.getItem('seen_reals_reminder')) {
      showModal('Reals', `<div style="padding:12px">${escHtml(reminder)}</div><div style="text-align:right;margin-top:10px"><button class="btn" id="reals-remind-ok">Tamam</button></div>`);
      document.getElementById('reals-remind-ok').addEventListener('click', () => { hideModal(); localStorage.setItem('seen_reals_reminder','1'); });
    }
  } catch {}

  let watchedIds = new Set();
  let idx = 0;
  let items = [];
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
        <video class="reals-video" preload="metadata" playsinline muted poster="${escHtml(r.banner_image || '')}"></video>
        <div class="reals-meta">
          <div class="reals-user">${avatarImg(r)} ${userDisplayName(r)}</div>
          <div class="reals-desc">${escHtml(r.description||'')}</div>
          <div class="reals-actions">
            <button class="btn btn-ghost like-btn"> <i class="fas fa-heart"></i> <span class="count">${r.like_count||0}</span></button>
            <button class="btn btn-ghost comment-btn"> <i class="fas fa-comment"></i> <span class="count">${r.comment_count||0}</span></button>
            <button class="btn btn-ghost resend-btn"> <i class="fas fa-retweet"></i></button>
            <button class="btn btn-ghost share-btn"> <i class="fas fa-share-alt"></i></button>
            <a href="/reals/${escHtml(r.slug)}" data-link class="btn btn-outline btn-sm view-detail-btn"><i class="fas fa-external-link-alt"></i> Detay</a>
          </div>
        </div>
      </div>`).join('');
    items = Array.from(document.querySelectorAll('.reals-item'));
    items.forEach(it => { it.style.position='absolute'; it.style.top='0'; it.style.left='0'; it.style.width='100%'; it.style.height='100%'; });
    listEl.style.position='relative'; listEl.style.height='100vh'; listEl.style.overflow='hidden';
    items.forEach(it => {
      const vid = it.querySelector('video');
      setRealsVideoSource(vid, '');
      it.addEventListener('click', () => { if (vid.paused) vid.play(); else vid.pause(); });
    });
    listEl.querySelectorAll('.like-btn').forEach(btn => btn.addEventListener('click', async (e) => {
      e.stopPropagation(); const it = btn.closest('.reals-item'); const id = it.dataset.id; try { btn.disabled=true; await api(`/video/${id}/like`, { method:'POST' }); const span = btn.querySelector('.count'); span.textContent = Number(span.textContent||0)+1; } catch(e){ toast(e.message,'error'); } finally { btn.disabled=false; }
    }));
    listEl.querySelectorAll('.resend-btn').forEach(btn => btn.addEventListener('click', async (e) => {
      e.stopPropagation(); const it = btn.closest('.reals-item'); const slug = it.dataset.slug; try { btn.disabled=true; await api(`/video/${slug}/resend`, { method:'POST' }); toast('Yeniden paylaşıldı'); } catch(e){ toast(e.message,'error'); } finally { btn.disabled=false; }
    }));
    listEl.querySelectorAll('.share-btn').forEach(btn => btn.addEventListener('click', async (e) => {
      e.stopPropagation(); const it = btn.closest('.reals-item'); const slug = it.dataset.slug; const video = orderedReals.find(r => r.slug === slug); if (video) showForwardVideoModal(video);
    }));
  }

  function markWatchedAndReorder(id) {
    if (watchedIds.has(id)) return;
    watchedIds.add(id);
    const pos = orderedReals.findIndex(r => r.id === id);
    if (pos === -1) return;
    const [moved] = orderedReals.splice(pos, 1);
    orderedReals.push(moved);
    realsFeedOrder = orderedReals.map(r => r.id);
    const itemEl = items.find(it => Number(it.dataset.id) === id);
    if (itemEl) {
      listEl.appendChild(itemEl);
      items = items.filter(it => Number(it.dataset.id) !== id);
      items.push(itemEl);
    }
  }

  function showIndex(i) {
    if (i < 0) i = 0; if (i >= items.length) i = items.length-1;
    const previousId = items[idx]?.dataset.id;
    if (previousId && i !== idx) markWatchedAndReorder(Number(previousId));
    idx = i;
    items.forEach((it, j) => {
      it.style.transform = `translateY(${(j-idx)*100}%)`;
      it.style.transition = 'transform .35s';
      const vid = it.querySelector('video');
      const videoUrl = it.dataset.videoUrl;
      if (j === idx) {
        setRealsVideoSource(vid, videoUrl);
        vid.muted = false;
        vid.play().catch(() => {});
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

  // wheel
  let wheelDeb = false;
  window.addEventListener('wheel', e => {
    if (wheelDeb) return; wheelDeb = true; setTimeout(() => wheelDeb=false, 300);
    if (e.deltaY > 0) showIndex(idx+1); else showIndex(idx-1);
  }, { passive: true });

  // touch
  let startY = null;
  window.addEventListener('touchstart', e => { startY = e.touches[0].clientY; });
  window.addEventListener('touchend', e => { if (startY===null) return; const endY = e.changedTouches[0].clientY; const diff = startY - endY; if (diff > 30) showIndex(idx+1); else if (diff < -30) showIndex(idx-1); startY = null; });
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
  const authEl = $('#nav-auth');
  const userEl = $('#nav-user');
  const mobAuth = $('#mobile-menu-auth');
  const mobNew = $('#mobile-menu-new');
  const mobUserLinks = $('#mobile-menu-user-links');

  if (currentUser) {
    authEl.classList.add('hidden');
    userEl.classList.remove('hidden');
    const nav = currentUser.avatar ? `<img src="${escHtml(currentUser.avatar)}" class="nav-avatar" />` : `<div class="nav-avatar avatar-placeholder"><i class="fas fa-user" style="font-size:12px"></i></div>`;
    const btn = $('#nav-user-btn');
    btn.innerHTML = `<a href="/profil/${escHtml(currentUser.username)}" data-link class="nav-avatar-link" onclick="event.stopPropagation()">${nav}</a><i class="fas fa-chevron-down" style="font-size:10px;color:var(--text-muted);padding:0 4px"></i>`;
    $('#dropdown-profile').setAttribute('href', '/profil/' + currentUser.username);
    const navBrand = document.querySelector('.nav-brand');
    if (navBrand) {
      navBrand.setAttribute('href', '/');
      navBrand.style.cursor = 'pointer';
    }

    if (mobAuth) mobAuth.classList.add('hidden');
    if (mobNew) mobNew.classList.remove('hidden');
    if (mobUserLinks) mobUserLinks.innerHTML = `
      <a href="/profil/${escHtml(currentUser.username)}" data-link class="mobile-nav-link"><i class="fas fa-user" style="width:18px"></i> Profilim</a>
      <a href="/mesajlar" data-link class="mobile-nav-link" id="mob-msg-link"><i class="fas fa-envelope" style="width:18px"></i> Mesajlar <span id="mob-msg-badge" style="display:none;background:var(--accent-red);color:#fff;font-size:10px;padding:1px 5px;border-radius:10px;margin-left:4px"></span></a>
      <a href="/arkadaslar" data-link class="mobile-nav-link"><i class="fas fa-user-friends" style="width:18px"></i> Arkadaşlar</a>
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
      mbbAuth.setAttribute('href', '/profil/' + currentUser.username);
      const lbl = $('#mbb-auth-label'); if (lbl) lbl.textContent = 'Profil';
      mbbAuth.querySelector('i').className = 'fas fa-user-circle';
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
    if (mobUserLinks) mobUserLinks.innerHTML = '';

    const mbbAuth = $('#mbb-auth');
    if (mbbAuth) {
      mbbAuth.setAttribute('href', '/giris');
      const lbl = $('#mbb-auth-label'); if (lbl) lbl.textContent = 'Giriş';
      mbbAuth.querySelector('i').className = 'fas fa-sign-in-alt';
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
    if (data.count > 0) { badge.style.display = ''; badge.textContent = data.count > 9 ? '9+' : data.count; }
    else { badge.style.display = 'none'; }
  } catch {}
}

async function openNotifDropdown() {
  const dd = $('#notif-dropdown');
  if (!dd) return;
  dd.classList.toggle('hidden');
  if (dd.classList.contains('hidden')) return;
  dd.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-muted)"><div class="spinner" style="margin:0 auto"></div></div>';
  try {
    const notifs = await api('/notifications');
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
$('#nav-new-video')?.addEventListener('click', () => { $('#new-dropdown').classList.add('hidden'); if (currentUser) { navigate('/videolar'); setTimeout(() => showNewVideoModal(), 120); } else { navigate('/giris'); } });
$('#nav-new-reals')?.addEventListener('click', () => { $('#new-dropdown').classList.add('hidden'); if (currentUser) { navigate('/videolar'); setTimeout(() => showNewVideoModal(null, true), 120); } else { navigate('/giris'); } });
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

document.addEventListener('click', e => {
  if (!$('#mobile-menu')?.contains(e.target) && !$('#mobile-toggle')?.contains(e.target)) {
    $('#mobile-menu')?.classList.add('hidden');
  }
});

document.addEventListener('click', e => {
  const mobNewForum = e.target.closest('#mob-new-forum');
  const mobNewBook = e.target.closest('#mob-new-book');
  const mobNewGroup = e.target.closest('#mob-new-group');
  if (mobNewForum) { $('#mobile-menu').classList.add('hidden'); navigate('/forum'); setTimeout(() => showNewForumModal(), 100); }
  if (mobNewBook) { $('#mobile-menu').classList.add('hidden'); navigate('/kitaplar'); setTimeout(() => showNewBookModal(), 100); }
  if (mobNewGroup) { $('#mobile-menu').classList.add('hidden'); navigate('/gruplar'); setTimeout(() => showNewGroupModal(), 100); }
});

async function renderHome(app) {
  document.title = siteName + ' - Topluluk Platformu';
  updatePageMeta(siteName + ' - Topluluk Platformu', 'Cay kadar sicak topluluk platformu.', '');

  let sections = window._homepageSections || ['konular','fotograflar','muzikler','gruplar','kitaplar'];
  const sectionLabels = {
    konular:    { icon: 'fas fa-comments', label: 'Konular' },
    fotograflar:{ icon: 'fas fa-camera',   label: 'Fotograflar' },
    muzikler:   { icon: 'fas fa-music',    label: 'Muzikler' },
    gruplar:    { icon: 'fas fa-users',    label: 'Gruplar' },
    kitaplar:   { icon: 'fas fa-book',     label: 'Kitaplar' }
  };

  const tabsHTML = sections.map((s, i) => {
    const cfg = sectionLabels[s] || { icon: 'fas fa-star', label: s };
    const isFirst = i === 0;
    return '<button class="home-tab-btn' + (isFirst ? ' active' : '') + '" data-section="' + s + '" style="display:flex;align-items:center;gap:6px;padding:8px 16px;background:' + (isFirst ? 'rgba(189,162,117,0.15)' : 'transparent') + ';border:1px solid ' + (isFirst ? 'rgba(189,162,117,0.4)' : 'transparent') + ';border-radius:20px;color:' + (isFirst ? 'var(--accent-red2)' : 'var(--text-muted)') + ';cursor:pointer;font-size:13px;font-weight:600;white-space:nowrap;transition:all 0.2s"><i class="' + cfg.icon + '"></i> ' + cfg.label + '</button>';
  }).join('');

  app.innerHTML =
    '<div id="home-tabs-bar" style="overflow-x:auto;-webkit-overflow-scrolling:touch;padding:0 20px;border-bottom:1px solid var(--border);scrollbar-width:none;-ms-overflow-style:none">' +
      '<div style="display:flex;gap:8px;flex-wrap:nowrap;padding-bottom:12px;padding-top:4px">' + tabsHTML + '</div>' +
    '</div>' +
    '<div class="container page" style="padding-top:20px"><div id="home-section-content"><div class="loading-center"><div class="spinner"></div></div></div></div>';

  const renderSection = async (section) => {
    const el = document.getElementById('home-section-content');
    if (!el) return;
    el.innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';

    if (section === 'konular') {
      let addBtn = currentUser ? '<button class="btn btn-primary btn-sm" id="home-new-forum-btn"><i class="fas fa-plus"></i> Yeni Konu</button>' : '';
      el.innerHTML = '<div class="page-header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:16px"><div class="page-title">Son Konular</div><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><div class="search-bar" style="margin:0;flex:1;min-width:180px"><i class="fas fa-search"></i><input type="text" id="home-forum-search" placeholder="Konu ara..." /></div>' + addBtn + '<a href="/forum" data-link class="btn btn-ghost btn-sm">Tumunu Gor <i class="fas fa-arrow-right"></i></a></div></div><div id="home-forums"><div class="loading-center"><div class="spinner"></div></div></div>';
      if (currentUser) document.getElementById('home-new-forum-btn')?.addEventListener('click', () => showNewForumModal());
      let allForums = [];
      try {
        allForums = await api('/forums');
        const forumsEl = document.getElementById('home-forums');
        if (forumsEl) {
          if (!allForums.length) forumsEl.innerHTML = '<div class="empty-state"><i class="fas fa-comments"></i><p>Henuz konu yok.</p></div>';
          else forumsEl.innerHTML = '<div style="display:flex;flex-direction:column;gap:12px">' + allForums.slice(0,10).map(f => forumCardHTML(f)).join('') + '</div>';
        }
      } catch {}
      document.getElementById('home-forum-search')?.addEventListener('input', e => {
        const q = e.target.value.toLowerCase();
        const filtered = allForums.filter(f => f.title.toLowerCase().includes(q) || f.content.toLowerCase().includes(q));
        const fEl = document.getElementById('home-forums');
        if (!fEl) return;
        if (!filtered.length) { fEl.innerHTML = '<div class="empty-state"><i class="fas fa-comments"></i><p>Konu bulunamadi.</p></div>'; return; }
        fEl.innerHTML = '<div style="display:flex;flex-direction:column;gap:12px">' + filtered.map(f => forumCardHTML(f)).join('') + '</div>';
      });

    } else if (section === 'fotograflar') {
      let addBtn = currentUser ? '<button class="btn btn-primary btn-sm" id="home-photo-btn"><i class="fas fa-camera"></i> Foto At</button>' : '';
      el.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px"><div class="page-title">Son Fotograflar</div><div style="display:flex;gap:8px">' + addBtn + '<a href="/fotograflar" data-link class="btn btn-ghost btn-sm">Tumunu Gor <i class="fas fa-arrow-right"></i></a></div></div><div id="home-photos"><div class="loading-center"><div class="spinner"></div></div></div>';
      document.getElementById('home-photo-btn')?.addEventListener('click', () => showNewPhotoModal());
      try {
        const photos = await api('/photos?page=1');
        const pEl = document.getElementById('home-photos');
        if (!pEl) return;
        if (!photos.length) { pEl.innerHTML = '<div class="empty-state"><i class="fas fa-camera"></i><p>Henuz foto yok.</p></div>'; return; }
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px';
        wrap.innerHTML = photos.slice(0,6).map(p => photoCardHTML(p)).join('');
        pEl.appendChild(wrap);
        initPhotoCardActions(wrap);
      } catch {}

    } else if (section === 'muzikler') {
      el.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px"><div class="page-title">Son Muzikler</div><a href="/muzikler" data-link class="btn btn-ghost btn-sm">Tumunu Gor <i class="fas fa-arrow-right"></i></a></div><div id="home-songs"><div class="loading-center"><div class="spinner"></div></div></div>';
      try {
        const songs = await api('/songs');
        const sEl = document.getElementById('home-songs');
        if (!sEl) return;
        if (!songs.length) { sEl.innerHTML = '<div class="empty-state"><i class="fas fa-music"></i><p>Henuz muzik yok.</p></div>'; return; }
        sEl.innerHTML = '<div class="grid-3">' + songs.slice(0,6).map(s => '<div class="song-card" onclick="navigate(\'/muzik/' + escHtml(s.slug) + '\')" style="cursor:pointer">' + (s.cover_url ? '<img src="' + escHtml(s.cover_url) + '" class="song-card-cover" />' : '<div class="song-card-cover song-card-cover-ph"><i class="fas fa-music"></i></div>') + '<div class="song-card-body"><div class="song-card-title">' + escHtml(s.title) + '</div><div class="song-card-subtitle">' + escHtml(s.artist_name || s.uploader_name || '') + '</div><div class="song-card-meta">' + (s.play_count || 0) + ' dinlenme</div></div></div>').join('') + '</div>';
      } catch {}

    } else if (section === 'gruplar') {
      el.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px"><div class="page-title">Gruplar</div><a href="/gruplar" data-link class="btn btn-ghost btn-sm">Tumunu Gor <i class="fas fa-arrow-right"></i></a></div><div id="home-groups"><div class="loading-center"><div class="spinner"></div></div></div>';
      try {
        const groups = await api('/groups');
        const gEl = document.getElementById('home-groups');
        if (!gEl) return;
        if (!groups.length) { gEl.innerHTML = '<div class="empty-state"><i class="fas fa-users"></i><p>Henuz grup yok.</p></div>'; return; }
        gEl.innerHTML = '<div class="grid-3">' + groups.slice(0,6).map(g => groupCardHTML(g)).join('') + '</div>';
      } catch {}

    } else if (section === 'kitaplar') {
      el.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px"><div class="page-title">Kitaplar</div><a href="/kitaplar" data-link class="btn btn-ghost btn-sm">Tumunu Gor <i class="fas fa-arrow-right"></i></a></div><div id="home-books" class="grid-3"><div class="loading-center"><div class="spinner"></div></div></div>';
      try {
        const books = await api('/books');
        const bEl = document.getElementById('home-books');
        if (!bEl) return;
        if (!books.length) { bEl.innerHTML = '<div class="empty-state"><i class="fas fa-book"></i><p>Henuz kitap yok.</p></div>'; return; }
        bEl.innerHTML = books.slice(0,6).map(b => bookCardHTML(b)).join('');
      } catch {}
    }

    if (el) el.querySelectorAll('[data-link]').forEach(a => {
      a.addEventListener('click', e => { e.preventDefault(); navigate(a.getAttribute('href')); });
    });
  };

  document.querySelectorAll('.home-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.home-tab-btn').forEach(b => {
        b.classList.remove('active');
        b.style.background = 'transparent'; b.style.border = '1px solid transparent'; b.style.color = 'var(--text-muted)';
      });
      btn.classList.add('active');
      btn.style.background = 'rgba(189,162,117,0.15)'; btn.style.border = '1px solid rgba(189,162,117,0.4)'; btn.style.color = 'var(--accent-red2)';
      renderSection(btn.dataset.section);
    });
  });

  if (sections.length) renderSection(sections[0]);
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
          <div class="page-subtitle">${activeTag ? `<i class="fas fa-hashtag" style="color:var(--accent-red2)"></i> <strong>${escHtml(activeTag)}</strong> etiketiyle filtreli &nbsp;<a href="/forum" data-link style="font-size:12px;color:var(--accent-red2)"><i class="fas fa-times"></i> Temizle</a>` : 'Toplulukla fikir paylaş'}</div>
        </div>
        ${currentUser ? `<button class="btn btn-primary" id="new-forum-btn"><i class="fas fa-plus"></i> Yeni Konu Aç</button>` : ''}
      </div>
      <div class="search-bar"><i class="fas fa-search"></i><input type="text" id="forum-search" placeholder="Konu veya #etiket ara..." /></div>
      <div id="forums-list"><div class="loading-center"><div class="spinner"></div></div></div>
    </div>`;

  if (currentUser) $('#new-forum-btn')?.addEventListener('click', () => showNewForumModal());

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
    ? `onclick="event.stopPropagation();navigate('/profil/${escHtml(f.username)}')" style="cursor:pointer"`
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
          xhr.open('POST', '/api/upload');
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
            <a href="/profil/${escHtml(forum.username)}" data-link style="color:inherit">${userDisplayName(forum)}</a>
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
        <span class="comment-author">${c.username ? `<a href="/profil/${escHtml(c.username)}" data-link>${userDisplayName(c)}</a>` : userDisplayName(c)}</span>
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
      <div class="books-list-header">
        <span class="page-subtitle" style="display:block;font-size:15px;font-weight:600;color:var(--text-secondary)">Topluluğun eserleri</span>
        ${currentUser ? `<button class="btn btn-primary btn-sm" id="new-book-btn"><i class="fas fa-plus"></i></button>` : ''}
      </div>
      <div class="search-bar"><i class="fas fa-search"></i><input type="text" id="book-search" placeholder="Kitap ara..." /></div>
      <div id="books-grid" class="grid-3"><div class="loading-center"><div class="spinner"></div></div></div>
    </div>`;

  if (currentUser) $('#new-book-btn')?.addEventListener('click', () => showNewBookModal());

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
      ${b.is_hidden ? '<div style="position:absolute;top:8px;right:8px;background:var(--accent-red2);color:white;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px"><i class="fas fa-lock"></i></div>' : ''}
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
    <div id="bk-hidden-wrap" class="book-privacy-toggle" style="margin-bottom:12px">
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
    <div class="book-privacy-toggle">
      <div class="toggle-header">
        <i class="fas fa-file-pdf" style="color:#ef4444;font-size:16px"></i>
        <div class="toggle-label">
          <div class="toggle-title">PDF İndir / Yazdır</div>
          <div class="toggle-desc">Okuyucular kitabı indirebilir veya yazdırabilir</div>
        </div>
      </div>
      <label class="toggle-switch">
        <input type="checkbox" id="bk-allow-download" ${!existing || existing.allow_download !== 0 ? 'checked' : ''} />
        <span class="toggle-slider"></span>
      </label>
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
        allow_download: $('#bk-allow-download').checked,
        is_unnamed: noName ? true : false
      };
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
  try { data = await api('/book/' + slug); } catch { app.innerHTML = '<div class="container page"><div class="empty-state"><i class="fas fa-exclamation-circle"></i><p>Kitap bulunamadı.</p></div></div>'; return; }

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
        <div class="book-detail-title">${book.is_unnamed ? '<span style="color:rgba(255,255,255,0.3);font-style:italic">İsimsiz Kitap</span>' : escHtml(book.title)} ${book.is_hidden ? '<span style="margin-left:8px;display:inline-block;padding:4px 8px;background:var(--accent-red2);color:white;border-radius:6px;font-size:11px;font-weight:700"><i class="fas fa-lock"></i> GİZLİ</span>' : ''}</div>
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
  try { data = await api(`/book/${bookSlug}/page/${pageSlug}`); } catch { app.innerHTML = '<div class="container page"><div class="empty-state"><i class="fas fa-exclamation-circle"></i><p>Sayfa bulunamadı.</p></div></div>'; return; }

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
      <div id="groups-grid" class="grid-3"><div class="loading-center"><div class="spinner"></div></div></div>
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
    el.innerHTML = list.map(g => groupCardHTML(g)).join('');
  }

  renderGroups(groups);

  $('#group-search')?.addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    renderGroups(groups.filter(g => g.name.toLowerCase().includes(q) || (g.description || '').toLowerCase().includes(q)));
  });
}

function groupCardHTML(g) {
  const typeBadge = g.type === 'private' ? `<span class="badge badge-red"><i class="fas fa-lock"></i> Özel</span>` : `<span class="badge badge-green"><i class="fas fa-globe"></i> Açık</span>`;
  return `<div class="group-card" onclick="navigate('/grup/${escHtml(g.slug)}')">
    <div class="group-cover">
      ${g.cover_image ? `<img src="${escHtml(g.cover_image)}" alt="" />` : `<div class="group-cover-placeholder"><i class="fas fa-users"></i></div>`}
    </div>
    <div class="group-info">
      <div class="group-name">${escHtml(g.name)}</div>
      <div class="group-desc">${escHtml(g.description || '')}</div>
      <div class="group-meta">
        ${typeBadge}
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
      <label>Kapak Resmi (opsiyonel)</label>
      <input type="file" id="gr-cover-file" accept="image/*" style="margin-bottom:8px" />
      <div id="gr-cover-preview" style="display:none"></div>
    </div>
    <div class="form-group"><label>Tür</label><select id="gr-type"><option value="public">Açık</option><option value="private">Özel</option></select></div>
    <div class="form-group">
      <label class="checkbox-label"><input type="checkbox" id="gr-chat" checked /> Sohbete izin ver</label>
      <label class="checkbox-label" style="margin-top:8px"><input type="checkbox" id="gr-photos" checked /> Fotoğrafa izin ver</label>
      <label class="checkbox-label" style="margin-top:8px"><input type="checkbox" id="gr-invite" /> Sadece davet ile katılım</label>
    </div>
    <button class="btn btn-primary" id="gr-submit" style="width:100%">Oluştur</button>
    <div id="gr-error" class="form-error mt-4"></div>
  `);

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
      let cover_image = '';
      const coverFile = $('#gr-cover-file').files[0];
      if (coverFile) {
        const fd = new FormData(); fd.append('file', coverFile);
        const r = await apiForm('/upload', fd);
        cover_image = r.url;
      }
      const g = await api('/groups', { method: 'POST', body: JSON.stringify({ name, description: $('#gr-desc').value.trim(), cover_image, type: $('#gr-type').value, allow_chat: $('#gr-chat').checked, allow_photos: $('#gr-photos').checked, invite_only: $('#gr-invite').checked }) });
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
  } catch { app.innerHTML = '<div class="container page"><div class="empty-state"><i class="fas fa-exclamation-circle"></i><p>Grup bulunamadı.</p></div></div>'; return; }

  const { group, isMember, role, joinRequestStatus } = groupData;
  document.title = group.name + ' - ' + siteName;
  const isOwner = currentUser && currentUser.id === group.owner_id;
  const isMod = role === 'moderator';
  const canSend = currentUser && isMember && group.allow_chat;

  // Üye olmayan kullanıcılar için önizleme sayfası göster
  if (!isMember && !isOwner) {
    const hasPending = joinRequestStatus && joinRequestStatus.status === 'pending';
    app.innerHTML = `<div class="container page">
      <div style="max-width:540px;margin:40px auto;text-align:center">
        ${group.cover_image
          ? `<img src="${escHtml(group.cover_image)}" style="width:100%;border-radius:var(--radius);aspect-ratio:16/6;object-fit:cover;margin-bottom:24px" alt="" />`
          : `<div style="width:100%;aspect-ratio:16/6;background:var(--bg-card2);border-radius:var(--radius);display:flex;align-items:center;justify-content:center;margin-bottom:24px;font-size:56px;color:var(--text-muted)"><i class="fas fa-users"></i></div>`}
        <h1 style="font-size:26px;font-weight:800;margin-bottom:10px">${escHtml(group.name)}</h1>
        ${group.description ? `<p style="color:var(--text-secondary);font-size:15px;margin-bottom:18px;line-height:1.65">${escHtml(group.description)}</p>` : ''}
        <div style="display:flex;align-items:center;justify-content:center;gap:14px;margin-bottom:24px;flex-wrap:wrap">
          ${group.type === 'private' ? `<span class="badge badge-red"><i class="fas fa-lock"></i> Özel Grup</span>` : `<span class="badge badge-green"><i class="fas fa-globe"></i> Açık Grup</span>`}
          <span style="font-size:13px;color:var(--text-muted)"><i class="fas fa-users" style="color:var(--accent-red)"></i> ${group.member_count} üye</span>
          <span style="font-size:13px;color:var(--text-muted)"><i class="fas fa-user-shield" style="color:var(--accent-red)"></i> ${escHtml(group.owner_name || '')}</span>
        </div>
        ${currentUser
          ? (group.type === 'public' && !group.invite_only
              ? `<button class="btn btn-primary" id="join-preview-btn" style="min-width:160px;font-size:15px"><i class="fas fa-plus"></i> Katıl</button>`
              : (hasPending
                  ? `<button class="btn btn-outline" id="request-preview-btn" style="min-width:160px;font-size:15px;opacity:0.7" disabled><i class="fas fa-clock"></i> Bekliyor</button>`
                  : `<button class="btn btn-primary" id="request-preview-btn" style="min-width:160px;font-size:15px"><i class="fas fa-paper-plane"></i> İstek Gönder</button>`))
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
            reqBtn.disabled = false; reqBtn.innerHTML = '<i class="fas fa-paper-plane"></i> İstek Gönder';
            $('#group-preview-error').textContent = e.message;
          }
        }
      });
    }
    return;
  }

  app.innerHTML = `<div class="container page">
    <div style="margin-bottom:20px">
      ${group.cover_image ? `<img src="${escHtml(group.cover_image)}" style="width:100%;border-radius:var(--radius);aspect-ratio:16/5;object-fit:cover;margin-bottom:16px" alt="" />` : ''}
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
        <div>
          <h1 style="font-size:28px;font-weight:800">${escHtml(group.name)}</h1>
          <p style="color:var(--text-secondary);margin-top:4px">${escHtml(group.description || '')}</p>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${!isMember && currentUser && group.type === 'public' && !group.invite_only ? `<button class="btn btn-primary" id="join-btn"><i class="fas fa-plus"></i> Katıl</button>` : ''}
          ${isMember && !isOwner ? `<button class="btn btn-outline" id="leave-btn"><i class="fas fa-sign-out-alt"></i> Ayrıl</button>` : ''}
          ${isOwner ? `<button class="btn btn-outline btn-sm" id="group-settings-btn"><i class="fas fa-cog"></i> Ayarlar</button>
            ${(group.type === 'private' || group.invite_only) ? `<button class="btn btn-outline btn-sm" id="gen-invite-btn"><i class="fas fa-link"></i> Davet Kodu</button>` : ''}
            ${(group.type === 'private' || group.invite_only) ? `<button class="btn btn-outline btn-sm" id="join-requests-btn"><i class="fas fa-user-plus"></i> Katılım İstekleri</button>` : ''}` : ''}
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
              ${group.allow_photos ? `<label class="btn btn-ghost btn-sm" for="chat-img-input" title="Fotoğraf gönder" style="flex-shrink:0"><i class="fas fa-image"></i></label><input id="chat-img-input" type="file" accept="image/*" style="display:none" />` : ''}
              <input id="chat-input" type="text" placeholder="Mesaj yaz..." style="flex:1;min-width:0" />
              <button class="btn btn-primary btn-sm" id="send-msg-btn" style="flex-shrink:0"><i class="fas fa-paper-plane"></i></button>
            </div>` : (currentUser && !isMember ? `<div style="padding:12px;text-align:center;color:var(--text-muted);font-size:13px">Mesaj göndermek için gruba katılın.</div>` : `<div style="padding:12px;text-align:center;color:var(--text-muted);font-size:13px">Giriş yaparak katılabilirsiniz.</div>`)}
          </div>` : `<div class="card card-body" style="text-align:center;color:var(--text-muted)"><i class="fas fa-comment-slash" style="font-size:32px;margin-bottom:8px;display:block"></i>Sohbet kapatılmış.</div>`}
      </div>
      <div>
        <div class="group-sidebar-card">
          <div class="card-header"><span><i class="fas fa-info-circle" style="color:var(--accent-red)"></i> Bilgi</span></div>
          <div class="card-body" style="font-size:13px;color:var(--text-secondary)">
            <div style="margin-bottom:6px"><i class="fas fa-users"></i> ${group.member_count} üye</div>
            <div style="margin-bottom:6px">${group.type === 'private' ? '<span class="badge badge-red"><i class="fas fa-lock"></i> Özel</span>' : '<span class="badge badge-green"><i class="fas fa-globe"></i> Açık</span>'}</div>
            <div style="margin-bottom:6px"><i class="fas fa-user-shield"></i> Sahip: ${escHtml(group.owner_name || '')}</div>
            <div><i class="fas fa-calendar"></i> ${formatDate(group.created_at)}</div>
          </div>
        </div>
        <div class="group-sidebar-card">
          <div class="card-header"><span><i class="fas fa-users" style="color:var(--accent-red)"></i> Üyeler</span></div>
          <div id="members-list">${members.slice(0, 10).map(m => memberItemHTML(m, isOwner, slug)).join('')}</div>
        </div>
      </div>
    </div>
  </div>`;

  const chatEl = $('#chat-messages');
  if (chatEl) chatEl.scrollTop = chatEl.scrollHeight;

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
      // Scroll pozisyonunu koru
      chatEl2.scrollTop = chatEl2.scrollHeight - prevHeight;
      oldestMsgId = older[0].id;
      if (older.length < 60) $('#load-more-msgs-wrap').style.display = 'none';
    } catch(e) { toast(e.message, 'error'); }
    finally { btn.disabled = false; btn.innerHTML = '<i class="fas fa-history"></i> Önceki Mesajlar'; }
  });

  $('#join-btn')?.addEventListener('click', async () => {
    try { await api('/group/' + slug + '/join', { method: 'POST' }); toast('Gruba katıldınız!'); renderRoute(location.pathname); } catch (e) { toast(e.message, 'error'); }
  });
  $('#leave-btn')?.addEventListener('click', async () => {
    if (!confirm('Gruptan ayrılmak istiyor musunuz?')) return;
    try { await api('/group/' + slug + '/leave', { method: 'POST' }); toast('Gruptan ayrıldınız.'); renderRoute(location.pathname); } catch (e) { toast(e.message, 'error'); }
  });

  if (canSend) {
    const sendMsg = async () => {
      const input = $('#chat-input');
      const content = input?.value.trim();
      if (!content) return;
      try {
        const msg = await api('/group/' + slug + '/messages', { method: 'POST', body: JSON.stringify({ content }) });
        $('#chat-messages').insertAdjacentHTML('beforeend', chatMsgHTML(msg, window._chatCanMod));
        input.value = '';
        chatEl.scrollTop = chatEl.scrollHeight;
        lastId = msg.id; // Çift mesaj önleme: poll bu mesajı tekrar eklemesin
      } catch (e) { toast(e.message, 'error'); }
    };
    $('#send-msg-btn')?.addEventListener('click', sendMsg);
    $('#chat-input')?.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); } });

    $('#chat-img-input')?.addEventListener('change', async e => {
      const file = e.target.files[0]; if (!file) return;
      const fd = new FormData(); fd.append('image', file);
      try {
        const r = await apiForm('/group/' + slug + '/upload', fd);
        const msg = await api('/group/' + slug + '/messages', { method: 'POST', body: JSON.stringify({ content: '', image_url: r.url }) });
        $('#chat-messages').insertAdjacentHTML('beforeend', chatMsgHTML(msg, window._chatCanMod));
        chatEl.scrollTop = chatEl.scrollHeight;
        lastId = msg.id; // Çift mesaj önleme
      } catch (e) { toast(e.message, 'error'); }
      e.target.value = '';
    });

    let lastId = messages.length ? messages[messages.length - 1].id : 0;
    chatPollInterval = setInterval(async () => {
      if (!$('#chat-messages')) { clearInterval(chatPollInterval); return; }
      try {
        const newMsgs = await api('/group/' + slug + '/messages');
        const newest = newMsgs.filter(m => m.id > lastId);
        if (newest.length) {
          newest.forEach(m => { $('#chat-messages').insertAdjacentHTML('beforeend', chatMsgHTML(m, window._chatCanMod)); });
          lastId = newest[newest.length - 1].id;
          const chatEl2 = $('#chat-messages');
          if (chatEl2) chatEl2.scrollTop = chatEl2.scrollHeight;
        }
      } catch {}
    }, 5000);
  }

  $('#chat-messages')?.addEventListener('click', async e => {
    const del = e.target.closest('.del-msg');
    if (!del) return;
    try { await api('/group/' + slug + '/messages/' + del.dataset.id, { method: 'DELETE' }); del.closest('.chat-msg').remove(); } catch (e) { toast(e.message, 'error'); }
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

  $('#gen-invite-btn')?.addEventListener('click', async () => {
    try {
      const r = await api('/group/' + slug + '/invite', { method: 'POST' });
      showModal('Davet Kodu', `<div style="text-align:center;padding:20px">
        <div style="font-size:32px;font-weight:900;letter-spacing:6px;color:var(--accent-red2);background:var(--bg-card2);padding:16px;border-radius:8px;margin-bottom:16px">${r.invite_code}</div>
        <button class="btn btn-primary" onclick="navigator.clipboard && navigator.clipboard.writeText('${r.invite_code}'); toast('Kopyalandı!')">Kopyala</button>
      </div>`);
    } catch (e) { toast(e.message, 'error'); }
  });

  $('#group-settings-btn')?.addEventListener('click', () => {
    showModal('Grup Ayarları', `
      <div class="form-group"><label>Grup Adı</label><input id="gs-name" type="text" value="${escHtml(group.name)}" /></div>
      <div class="form-group"><label>Açıklama</label><textarea id="gs-desc" rows="3">${escHtml(group.description || '')}</textarea></div>
      <div class="form-group">
        <label>Kapak Resmi</label>
        <input type="file" id="gs-cover-file" accept="image/*" style="margin-bottom:8px" />
        ${group.cover_image ? `<img id="gs-cover-preview" src="${escHtml(group.cover_image)}" style="width:100%;max-height:120px;object-fit:cover;border-radius:8px" />` : `<div id="gs-cover-preview" style="display:none"></div>`}
      </div>
      <div class="form-group"><label>Tür</label><select id="gs-type"><option value="public" ${group.type === 'public' ? 'selected' : ''}>Açık</option><option value="private" ${group.type === 'private' ? 'selected' : ''}>Özel</option></select></div>
      <div class="form-group">
        <label class="checkbox-label"><input type="checkbox" id="gs-chat" ${group.allow_chat ? 'checked' : ''} /> Sohbet</label>
        <label class="checkbox-label" style="margin-top:8px"><input type="checkbox" id="gs-photos" ${group.allow_photos ? 'checked' : ''} /> Fotoğraf</label>
      </div>
      <button class="btn btn-primary" id="gs-submit" style="width:100%">Kaydet</button>
      <button class="btn btn-danger" id="gs-delete" style="width:100%;margin-top:8px">Grubu Sil</button>
      <div id="gs-error" class="form-error mt-4"></div>
    `);

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
        let cover_image = group.cover_image || '';
        const coverFile = $('#gs-cover-file').files[0];
        if (coverFile) {
          const fd = new FormData(); fd.append('file', coverFile);
          const r = await apiForm('/upload', fd);
          cover_image = r.url;
        }
        await api('/group/' + slug, { method: 'PUT', body: JSON.stringify({ name: $('#gs-name').value.trim(), description: $('#gs-desc').value.trim(), cover_image, type: $('#gs-type').value, allow_chat: $('#gs-chat').checked, allow_photos: $('#gs-photos').checked }) });
        toast('Grup güncellendi'); hideModal(); renderRoute(location.pathname);
      } catch (e) { $('#gs-error').textContent = e.message; }
    });
    $('#gs-delete').addEventListener('click', async () => {
      if (!confirm('Grubu silmek istediğinize emin misiniz?')) return;
      try { await api('/group/' + slug, { method: 'DELETE' }); toast('Grup silindi'); hideModal(); navigate('/gruplar'); } catch (e) { toast(e.message, 'error'); }
    });
  });

  $('#members-list')?.addEventListener('click', async e => {
    const banBtn = e.target.closest('.ban-member');
    const modBtn = e.target.closest('.make-mod');
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

function chatMsgHTML(m, canModDelete = false) {
  const isOwn = currentUser && currentUser.id === m.user_id;
  const canDel = isOwn || canModDelete;
  return `<div class="chat-msg">
    ${m.avatar ? `<img src="${escHtml(m.avatar)}" class="chat-msg-avatar" alt="" />` : `<div class="chat-msg-avatar avatar-placeholder" style="font-size:11px;font-weight:700">?</div>`}
    <div class="chat-msg-body">
      <div class="chat-msg-meta">
        <span class="chat-msg-name">${escHtml(m.username || 'Silindi')}</span>
        <span class="chat-msg-time">${timeAgo(m.created_at)}</span>
        ${canDel ? `<button class="btn btn-ghost del-msg" data-id="${m.id}" style="padding:0 4px;font-size:11px;color:var(--text-muted)"><i class="fas fa-trash"></i></button>` : ''}
      </div>
      ${m.content ? `<div class="chat-msg-text">${escHtml(m.content)}</div>` : ''}
      ${m.image_url ? `<img src="${escHtml(m.image_url)}" class="chat-msg-img" alt="" onclick="window.open(this.src)" />` : ''}
    </div>
  </div>`;
}

function memberItemHTML(m, isOwner, groupSlug) {
  const roleLabel = m.role === 'owner' ? '<span class="badge badge-red">Sahip</span>' : m.role === 'moderator' ? '<span class="badge badge-orange">Mod</span>' : '';
  const canAct = isOwner && m.role !== 'owner' && currentUser && currentUser.id !== m.user_id;
  return `<div class="member-item">
    ${m.avatar ? `<img src="${escHtml(m.avatar)}" class="member-avatar" alt="" />` : `<div class="member-avatar avatar-placeholder"><i class="fas fa-user" style="font-size:14px"></i></div>`}
    <div style="flex:1">
      <div style="font-size:13px;font-weight:600">${escHtml(m.username)}</div>
      ${roleLabel}
    </div>
    ${canAct ? `<div style="display:flex;gap:4px">
      ${m.role !== 'moderator' ? `<button class="btn btn-ghost btn-sm make-mod" data-uid="${m.user_id}" title="Mod yap" style="font-size:11px"><i class="fas fa-shield"></i></button>` : ''}
      <button class="btn btn-ghost btn-sm ban-member" data-uid="${m.user_id}" title="At" style="font-size:11px;color:var(--accent-red2)"><i class="fas fa-times"></i></button>
    </div>` : ''}
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

async function showNewVideoModal(existing = null, forceReals = false) {
  let videoSettings = { defaultDescription: '', uploadSuccessText: 'YÜKLENDİ', uploadSuccessDuration: '3' };
  try { videoSettings = await api('/video-settings'); } catch {}
  const defaultDescription = existing?.description || videoSettings.defaultDescription || '';
  showModal(existing ? 'Videoyu Düzenle' : 'Video Yükle', `
    <div class="form-group"><label>Başlık</label><input id="video-title" type="text" value="${escHtml(existing?.title || '')}" /></div>
    <div class="form-group"><label>Açıklama</label><textarea id="video-description" rows="5">${escHtml(defaultDescription)}</textarea></div>
    <div class="form-group">
      <label>Video Dosyası</label>
      <input type="file" id="video-file" accept="video/*" />
      ${existing && existing.video_url ? `<div style="margin-top:8px;font-size:12px;color:var(--text-secondary)">Mevcut video: ${escHtml(existing.video_url)}</div>` : ''}
    </div>
    <div class="form-group">
      <label>Banner / Kapak</label>
      <input type="file" id="video-banner-file" accept="image/*" />
      ${existing && existing.banner_image ? `<img src="${escHtml(existing.banner_image)}" style="width:100%;max-height:150px;object-fit:cover;border-radius:8px;margin-top:8px" />` : ''}
    </div>
    <div class="form-group"><label class="checkbox-label"><input type="checkbox" id="video-comments" ${!existing || existing.allow_comments !== 0 ? 'checked' : ''} /> Yorumlara izin ver</label></div>
    <div class="form-group"><label class="checkbox-label"><input type="checkbox" id="video-is-reals" ${existing && existing.is_reals ? 'checked' : ''} ${forceReals ? 'checked' : ''} /> Bu video Reals olsun</label></div>
    <button class="btn btn-primary" id="video-submit" style="width:100%">${existing ? 'Güncelle' : 'Yükle'}</button>
    <div id="video-upload-progress" style="margin-top:10px;display:none"></div>
    <div id="video-error" class="form-error mt-4"></div>
  `);

  const videoInput = $('#video-file');
  const bannerInput = $('#video-banner-file');
  let autoBannerFile = null;

  videoInput?.addEventListener('change', async () => {
    const file = videoInput.files[0];
    if (!file || bannerInput?.files?.length) return;
    try {
      const generated = await generateVideoPoster(file);
      autoBannerFile = generated;
    } catch {
      autoBannerFile = null;
    }
  });

  $('#video-submit').addEventListener('click', async () => {
    const title = $('#video-title').value.trim();
    const description = $('#video-description').value.trim();
    const videoFile = $('#video-file').files[0];
    const bannerFile = $('#video-banner-file').files[0];
    if (!title) { $('#video-error').textContent = 'Başlık zorunlu'; return; }
    if (!existing && !videoFile) { $('#video-error').textContent = 'Video dosyası zorunlu'; return; }

    const submitBtn = $('#video-submit');
    submitBtn.disabled = true; submitBtn.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px;display:inline-block"></div> Yükleniyor...';
    const progress = $('#video-upload-progress'); progress.style.display='block'; progress.innerHTML = '<div style="font-size:12px;color:var(--text-secondary)">Yükleniyor...</div>';

    try {
      let videoUrl = existing?.video_url || '';
      let bannerImage = existing?.banner_image || '';
      if (videoFile) {
        const fd = new FormData(); fd.append('file', videoFile);
        const xhr = new XMLHttpRequest();
        xhr.upload.addEventListener('progress', e => {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100);
            progress.innerHTML = `<div style="font-size:12px;color:var(--text-secondary)">Yükleniyor... ${pct}%</div><div style="margin-top:6px;background:var(--bg-card2);height:8px;border-radius:999px;overflow:hidden"><div style="height:100%;background:var(--grad-red);width:${pct}%"></div></div>`;
          }
        });
        const uploadResult = await new Promise((resolve, reject) => {
          xhr.addEventListener('load', () => {
            try { const data = JSON.parse(xhr.responseText); if (xhr.status >= 400) reject(new Error(data.error || 'Yükleme hatası')); else resolve(data); } catch (e) { reject(new Error('Yanıt geçersiz')); }
          });
          xhr.addEventListener('error', () => reject(new Error('Yükleme hatası')));
          xhr.open('POST', '/api/upload');
          xhr.setRequestHeader('Authorization', 'Bearer ' + (localStorage.getItem('token') || ''));
          xhr.send(fd);
        });
        videoUrl = uploadResult.url;
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
        title,
        description: description || '',
        video_url: videoUrl,
        banner_image: bannerImage,
        allow_comments: $('#video-comments').checked,
        is_reals: $('#video-is-reals').checked
      };
      if (existing) {
        await api('/video/' + existing.slug, { method: 'PUT', body: JSON.stringify(payload) });
        toast('Video güncellendi');
      } else {
        const created = await api('/videos', { method: 'POST', body: JSON.stringify(payload) });
        const successMs = Math.max(1000, parseInt(videoSettings.uploadSuccessDuration || 3) * 1000);
        toast(videoSettings.uploadSuccessText || 'YÜKLENDİ', 'success', successMs);
        hideModal(); navigate('/video/' + created.slug); return;
      }
      hideModal(); renderRoute(location.pathname);
    } catch (e) {
      $('#video-error').textContent = e.message;
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
            <a href="/profil/${escHtml(video.username)}" data-link class="video-author-link">${avatarImg(video, 'avatar-sm')} ${userDisplayName(video)}</a>
            ${currentUser && currentUser.username !== video.username ? `<button class="btn btn-outline btn-sm" id="follow-btn">${followState ? 'Takip ediliyor' : 'Takip et'}</button>` : ''}
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
      $('#follow-btn').textContent = followState ? 'Takip ediliyor' : 'Takip et';
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
  });
}

function renderVideoComment(c, isOwner) {
  const canEdit = currentUser && (currentUser.id === c.user_id || isOwner);
  const canPin = currentUser && isOwner;
  return `<div class="comment">
    ${avatarImg(c, 'comment-avatar')}
    <div class="comment-body">
      <div class="comment-header">
        <span class="comment-author">${c.username ? `<a href="/profil/${escHtml(c.username)}" data-link>${userDisplayName(c)}</a>` : userDisplayName(c)}</span>
        <span class="comment-time">${timeAgo(c.created_at)}${c.is_pinned ? ' • Üstte sabitlendi' : ''}${c.updated_at && c.updated_at !== c.created_at ? ' • düzenlendi' : ''}</span>
      </div>
      <div class="comment-content">${renderContent(c.content)}</div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:8px">
        <div style="display:flex;align-items:center;gap:8px">
          ${canPin ? `<button class="btn btn-ghost btn-sm video-comment-pin" data-id="${c.id}" style="padding:2px 6px"><i class="fas fa-thumbtack"></i></button>` : ''}
          ${canEdit ? `<button class="btn btn-ghost btn-sm video-comment-edit" data-id="${c.id}" data-content="${escHtml(c.content)}" style="padding:2px 6px"><i class="fas fa-edit"></i></button>` : ''}
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

  const { user, forums, books, groups, videos, songs, level, levels, book_page_count } = data;
  const profileSongs = Array.isArray(songs) ? songs : [];
  const profileVideos = Array.isArray(videos) ? videos : [];
  let savedVideos = [];
  try { savedVideos = await api('/user/' + encodeURIComponent(username) + '/saved-videos'); } catch {}
  const profileSavedVideos = Array.isArray(savedVideos) ? savedVideos : [];
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
  if (nextLevel) {
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
  const isOwn = currentUser && currentUser.id === user.id;

  // Rozet satırı
  const badgeItems = [];
  if (level && user.show_level_badge) {
    badgeItems.push(`<span class="profile-badge" style="color:${escHtml(levelColor)};border-color:${escHtml(levelColor)};background:${escHtml(levelColor)}20" title="Seviye: ${escHtml(level.name)}"><i class="${escHtml(level.icon)}"></i> ${escHtml(level.name)} <span style="font-size:10px;opacity:0.7">seviye</span></span>`);
  }
  if (user.is_artist) {
    badgeItems.push(`<span class="profile-badge" style="color:#a855f7;border-color:#a855f733;background:#a855f715" title="Artist"><i class="fas fa-microphone-alt"></i> Artist</span>`);
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
        ${user.avatar ? `<img src="${escHtml(user.avatar)}" class="profile-avatar" alt="" />` : `<div class="profile-avatar-placeholder"><i class="fas fa-user"></i></div>`}
      </div>
      <div class="profile-info">
        <div class="profile-username" style="${user.show_level_color && user.name_color ? 'color:' + escHtml(user.name_color) : ''}">
          ${escHtml(user.username)}${user.is_admin ? ` <i class="fas fa-shield user-admin" title="CigCig Yetkilisi" data-admin-since="${escHtml(user.admin_since || '')}" style="color:#5865F2;cursor:pointer;font-size:18px"></i>` : ''}
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
          <div class="profile-stat"><div class="profile-stat-num">${user.forum_count}</div><div class="profile-stat-label">Forum</div></div>
          <div class="profile-stat"><div class="profile-stat-num">${user.book_count}</div><div class="profile-stat-label">Kitap</div></div>
          ${profileSongs.length ? `<div class="profile-stat"><div class="profile-stat-num">${profileSongs.length}</div><div class="profile-stat-label">Müzik</div></div>` : ''}
          <div class="profile-stat"><div class="profile-stat-num">${user.comment_count}</div><div class="profile-stat-label">Yorum</div></div>
        </div>
        ${isOwn ? `<a href="/ayarlar" data-link class="btn btn-outline btn-sm" style="margin-top:16px"><i class="fas fa-cog"></i> Profili Düzenle</a>${currentUser && currentUser.is_admin ? `<a href="/panel-giris" class="btn btn-sm" style="margin-top:8px;background:linear-gradient(135deg,#1a1aff,#5865F2);border:none;color:#fff"><i class="fas fa-shield"></i> Admin Panel</a>` : ''}` : ''}
        ${!isOwn && currentUser ? `<div style="display:flex;gap:8px;margin-top:16px;position:relative">
          <button id="profile-msg-btn" class="btn btn-outline btn-sm" onclick="navigate('/mesajlar/${escHtml(user.username)}')"><i class="fas fa-envelope"></i> Mesaj</button>
          <button id="profile-more-btn" class="btn btn-ghost btn-sm" style="padding:5px 9px"><i class="fas fa-ellipsis-h"></i></button>
          <div id="profile-more-menu" style="display:none;position:absolute;top:36px;left:0;background:var(--bg-secondary);border:1px solid var(--border);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,0.5);z-index:500;min-width:200px;overflow:hidden"></div>
        </div>` : ''}
        <div id="spotify-widget-${escHtml(user.username)}"></div>
      </div>
    </div>

    <div class="tabs">
      <button class="tab active" data-tab="forums">Forumlar</button>
      <button class="tab" data-tab="books">Kitaplar</button>
      <button class="tab" data-tab="groups">Gruplar</button>
      <button class="tab" data-tab="photos">Fotoğraflar</button>
      <button class="tab" data-tab="videos">Videolar</button>
      <button class="tab" data-tab="saved">Kaydedilenler</button>
      <button class="tab" data-tab="songs">Müzikler</button>
    </div>

    <div id="tab-forums">
      ${forums.length ? `<div style="display:flex;flex-direction:column;gap:12px">${forums.map(f => forumCardHTML(f)).join('')}</div>` : '<div class="empty-state"><i class="fas fa-comments"></i><p>Forum yok.</p></div>'}
    </div>
    <div id="tab-books" class="hidden">
      ${books.length ? `<div class="grid-3">${books.map(b => bookCardHTML(b)).join('')}</div>` : '<div class="empty-state"><i class="fas fa-book"></i><p>Kitap yok.</p></div>'}
    </div>
    <div id="tab-groups" class="hidden">
      ${groups.length ? `<div class="grid-3">${groups.map(g => groupCardHTML(g)).join('')}</div>` : '<div class="empty-state"><i class="fas fa-users"></i><p>Grup yok.</p></div>'}
    </div>
    <div id="tab-photos" class="hidden">
      <div class="loading-center"><div class="spinner"></div></div>
    </div>
    <div id="tab-videos" class="hidden">
      ${profileVideos.length ? `<div class="grid-3">${profileVideos.map(v => videoCardHTML(v)).join('')}</div>` : '<div class="empty-state"><i class="fas fa-video"></i><p>Video yok.</p></div>'}
    </div>
    <div id="tab-saved" class="hidden">
      ${profileSavedVideos.length ? `<div class="grid-3">${profileSavedVideos.map(v => videoCardHTML(v)).join('')}</div>` : '<div class="empty-state"><i class="fas fa-bookmark"></i><p>Kaydedilen video yok.</p></div>'}
    </div>
    <div id="tab-songs" class="hidden">
      ${profileSongsHTML}
    </div>
  </div>`;


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
  let photosLoaded = false;
  $$('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      ['forums', 'books', 'groups', 'photos', 'videos', 'saved', 'songs'].forEach(name => {
        const tab = $('#tab-' + name);
        if (tab) tab.classList.toggle('hidden', name !== btn.dataset.tab);
      });
      if (btn.dataset.tab === 'photos' && !photosLoaded) {
        photosLoaded = true;
        loadProfilePhotos(user.id, $('#tab-photos'), isOwn);
      }
    });
  });

  // Spotify widget yükle
  renderSpotifyWidget(username, `spotify-widget-${username}`);

  // Profil 3-nokta menüsü
  if (!isOwn && currentUser) {
    let friendStatus = null;
    try { friendStatus = await api('/friend-status/' + encodeURIComponent(username)); } catch {}

    const moreBtn = document.getElementById('profile-more-btn');
    const moreMenu = document.getElementById('profile-more-menu');
    if (moreBtn && moreMenu) {
      function buildMenuItems(fs) {
        const items = [];
        const f = fs?.friendship;
        const blockedByMe = fs?.blocked_by_me;
        const blockedByThem = fs?.blocked_by_them;
        if (!blockedByMe) {
          if (!f) {
            items.push({ icon: 'fa-user-plus', label: 'Arkadaşlık İsteği Gönder', action: 'friend-req' });
          } else if (f.status === 'pending' && f.requester_id == currentUser.id) {
            items.push({ icon: 'fa-user-clock', label: 'İsteği İptal Et', action: 'friend-cancel', id: f.id });
          } else if (f.status === 'pending' && f.addressee_id == currentUser.id) {
            items.push({ icon: 'fa-check', label: 'İsteği Kabul Et', action: 'friend-accept', id: f.id });
            items.push({ icon: 'fa-times', label: 'İsteği Reddet', action: 'friend-reject', id: f.id });
          } else if (f.status === 'accepted') {
            items.push({ icon: 'fa-user-minus', label: 'Arkadaşlıktan Çıkar', action: 'friend-remove', id: f.id });
          }
        }
        if (!blockedByMe) {
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
              if (action === 'friend-req') {
                await api('/friends/request/' + encodeURIComponent(username), { method: 'POST' });
                toast('Arkadaşlık isteği gönderildi');
              } else if (action === 'friend-cancel') {
                if (!confirm('Arkadaşlık isteğini iptal et?')) return;
                await api('/friends/' + fid, { method: 'DELETE' });
                toast('İstek iptal edildi');
              } else if (action === 'friend-accept') {
                await api('/friends/respond/' + fid, { method: 'POST', body: JSON.stringify({ action: 'accept' }) });
                toast('Arkadaşlık isteği kabul edildi');
              } else if (action === 'friend-reject') {
                await api('/friends/respond/' + fid, { method: 'POST', body: JSON.stringify({ action: 'reject' }) });
                toast('Arkadaşlık isteği reddedildi');
              } else if (action === 'friend-remove') {
                if (!confirm('Arkadaşlıktan çıkart?')) return;
                await api('/friends/' + fid, { method: 'DELETE' });
                toast('Arkadaşlıktan çıkarıldı');
              } else if (action === 'block-user') {
                if (!confirm('@' + username + ' kullanıcısını engellemek istiyor musun?')) return;
                await api('/block/' + encodeURIComponent(username), { method: 'POST' });
                toast('Kullanıcı engellendi');
              } else if (action === 'unblock-user') {
                await api('/block/' + encodeURIComponent(username), { method: 'DELETE' });
                toast('Engel kaldırıldı');
              }
              try { friendStatus = await api('/friend-status/' + encodeURIComponent(username)); } catch {}
              renderMenu(friendStatus);
            } catch(e) { toast(e.message || 'Hata oluştu', 'error'); }
          });
        });
      }

      renderMenu(friendStatus);

      moreBtn.addEventListener('click', e => {
        e.stopPropagation();
        moreMenu.style.display = moreMenu.style.display === 'none' ? 'block' : 'none';
      });
      document.addEventListener('click', () => { if (moreMenu) moreMenu.style.display = 'none'; }, { once: false });
    }
  }
}

function profilePhotoThumbHTML(p, isOwn) {
  const imgSrc = escHtml(p.image_url || p.url || '');
  const controls = isOwn ? `
    <div style="position:absolute;top:4px;right:4px;display:flex;gap:4px;opacity:0;transition:opacity 0.2s" class="photo-controls">
      <button class="photo-edit-btn" data-id="${p.id}" style="background:rgba(0,0,0,0.7);border:none;color:#fff;border-radius:6px;width:28px;height:28px;cursor:pointer;font-size:12px"><i class="fas fa-pen"></i></button>
      <button class="photo-delete-btn" data-id="${p.id}" style="background:rgba(200,0,0,0.8);border:none;color:#fff;border-radius:6px;width:28px;height:28px;cursor:pointer;font-size:12px"><i class="fas fa-trash"></i></button>
    </div>` : '';
  return `<div class="profile-photo-thumb" style="position:relative;aspect-ratio:1;overflow:hidden;border-radius:8px;background:var(--bg-card2);cursor:pointer" data-id="${p.id}">
    <img src="${imgSrc}" alt="" style="width:100%;height:100%;object-fit:cover" loading="lazy" />
    <div style="position:absolute;bottom:0;left:0;right:0;padding:4px 6px;background:linear-gradient(transparent,rgba(0,0,0,0.5));font-size:11px;color:#fff;opacity:0;transition:opacity 0.2s" class="photo-caption-overlay">${p.likes_count||0} <i class="fas fa-heart"></i> · ${p.comments_count||0} <i class="fas fa-comment"></i></div>
    ${controls}
  </div>`;
}

async function loadProfilePhotos(userId, container, isOwn) {
  if (!container) return;
  try {
    const photos = await api('/photos?user_id=' + userId + '&limit=60');
    const list = Array.isArray(photos) ? photos : (photos.photos || photos.data || []);
    if (!list.length) { container.innerHTML = '<div class="empty-state"><i class="fas fa-camera"></i><p>Henüz fotoğraf yok.</p></div>'; return; }
    container.innerHTML = `<div class="grid-3" style="gap:6px">${list.map(p => profilePhotoThumbHTML(p, isOwn)).join('')}</div>`;
    // hover show controls
    container.querySelectorAll('.profile-photo-thumb').forEach(el => {
      el.addEventListener('mouseenter', () => {
        const c = el.querySelector('.photo-controls'); if (c) c.style.opacity = '1';
        const o = el.querySelector('.photo-caption-overlay'); if (o) o.style.opacity = '1';
      });
      el.addEventListener('mouseleave', () => {
        const c = el.querySelector('.photo-controls'); if (c) c.style.opacity = '0';
        const o = el.querySelector('.photo-caption-overlay'); if (o) o.style.opacity = '0';
      });
    });
    if (isOwn) {
      container.querySelectorAll('.photo-delete-btn').forEach(btn => {
        btn.addEventListener('click', async e => {
          e.stopPropagation();
          if (!confirm('Bu fotoğrafı silmek istiyor musun?')) return;
          try {
            await api('/photos/' + btn.dataset.id, { method: 'DELETE' });
            toast('Fotoğraf silindi');
            loadProfilePhotos(userId, container, isOwn);
          } catch(err) { toast(err.message || 'Silinemedi', 'error'); }
        });
      });
      container.querySelectorAll('.photo-edit-btn').forEach(btn => {
        btn.addEventListener('click', async e => {
          e.stopPropagation();
          const photoId = btn.dataset.id;
          try {
            const photo = await api('/photos/' + photoId);
            showPhotoEditModal(photo, async (updates) => {
              await api('/photos/' + photoId, { method: 'PUT', body: JSON.stringify(updates) });
              toast('Fotoğraf güncellendi');
              loadProfilePhotos(userId, container, isOwn);
            });
          } catch(err) { toast(err.message || 'Yüklenemedi', 'error'); }
        });
      });
    }
  } catch(err) {
    container.innerHTML = '<div class="empty-state"><i class="fas fa-camera"></i><p>Fotoğraflar yüklenemedi.</p></div>';
  }
}

function showPhotoEditModal(photo, onSave) {
  const existing = document.getElementById('photo-edit-modal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'photo-edit-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9000;display:flex;align-items:center;justify-content:center;padding:20px';
  modal.innerHTML = `<div style="background:var(--bg-secondary);border:1px solid var(--border);border-radius:16px;padding:24px;width:100%;max-width:400px;position:relative">
    <button id="pem-close" style="position:absolute;top:12px;right:12px;background:none;border:none;color:var(--text-muted);font-size:18px;cursor:pointer"><i class="fas fa-times"></i></button>
    <div style="font-size:16px;font-weight:700;margin-bottom:16px">Fotoğrafı Düzenle</div>
    <div style="margin-bottom:12px"><label style="font-size:13px;color:var(--text-secondary);display:block;margin-bottom:4px">Açıklama</label>
      <textarea id="pem-caption" style="width:100%;background:var(--bg-card2);border:1px solid var(--border);border-radius:8px;padding:8px 10px;color:var(--text-primary);font-size:13px;resize:vertical;min-height:60px;box-sizing:border-box">${escHtml(photo.caption||'')}</textarea></div>
    <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:20px">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px"><input type="checkbox" id="pem-likes" ${photo.allow_likes!==0?'checked':''}> Beğenilere izin ver</label>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px"><input type="checkbox" id="pem-comments" ${photo.allow_comments!==0?'checked':''}> Yorumlara izin ver</label>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px"><input type="checkbox" id="pem-sharing" ${photo.allow_sharing!==0?'checked':''}> Paylaşıma izin ver</label>
    </div>
    <button id="pem-save" class="btn btn-primary" style="width:100%">Kaydet</button>
  </div>`;
  document.body.appendChild(modal);
  document.getElementById('pem-close').onclick = () => modal.remove();
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.getElementById('pem-save').onclick = async () => {
    const updates = {
      caption: document.getElementById('pem-caption').value,
      allow_likes: document.getElementById('pem-likes').checked ? 1 : 0,
      allow_comments: document.getElementById('pem-comments').checked ? 1 : 0,
      allow_sharing: document.getElementById('pem-sharing').checked ? 1 : 0
    };
    try { await onSave(updates); modal.remove(); } catch(err) { toast(err.message || 'Kaydedilemedi', 'error'); }
  };
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
        <div class="settings-nav-item" data-section="appearance"><i class="fas fa-palette"></i> Görünüm</div>
        <div class="settings-nav-item" data-section="notifications"><i class="fas fa-bell"></i> Bildirimler</div>
        <div class="settings-nav-item" data-section="spotify"><i class="fab fa-spotify" style="color:#1ED760"></i> Spotify</div>
        <div class="settings-nav-item" data-section="account" style="color:var(--accent-red2)"><i class="fas fa-exclamation-triangle"></i> Hesap</div>
      </div>
      <div id="settings-content"></div>
    </div>
  </div>`;

  renderSettingsSection('profile');

  // Spotify callback param kontrolü
  const urlParams = new URLSearchParams(location.search);
  if (urlParams.get('spotify') === 'ok') { toast('Spotify bağlandı! 🎵'); history.replaceState({}, '', '/ayarlar'); }
  if (urlParams.get('spotify') === 'error') { toast('Spotify bağlantısı başarısız', 'error'); history.replaceState({}, '', '/ayarlar'); }

  $$('.settings-nav-item').forEach(item => {
    item.addEventListener('click', () => {
      $$('.settings-nav-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      renderSettingsSection(item.dataset.section);
    });
  });
}

function renderSettingsSection(section) {
  const el = $('#settings-content'); if (!el) return;
  if (section === 'profile') {
    const links = (() => { try { return JSON.parse(currentUser.links || '[]'); } catch { return []; } })();
    el.innerHTML = `
      <div class="card">
        <div class="card-header"><span>Profil Bilgileri</span></div>
        <div class="card-body">
          <div class="form-group" style="display:flex;align-items:center;gap:16px">
            ${currentUser.avatar ? `<img src="${escHtml(currentUser.avatar)}" style="width:64px;height:64px;border-radius:50%;object-fit:cover" />` : `<div style="width:64px;height:64px;border-radius:50%;background:var(--bg-card2);display:flex;align-items:center;justify-content:center"><i class="fas fa-user" style="font-size:24px;color:var(--text-muted)"></i></div>`}
            <div style="flex:1">
              <label>Avatar Yükle</label>
              <input type="file" id="avatar-file" accept="image/*" style="padding:6px" />
            </div>
          </div>
          <div class="form-group"><label>Biyografi</label><textarea id="s-bio" rows="3">${escHtml(currentUser.bio || '')}</textarea></div>
          <div class="form-row">
            <div class="form-group"><label>Ünvan <span style="color:var(--accent-red2)">*</span></label><input type="text" id="s-title" value="${escHtml(currentUser.title || '')}" placeholder="Örn: Yazılım Geliştirici, Öğrenci..." /></div>
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
      if (!titleVal) { $('#profile-msg').textContent = 'Ünvan zorunlu'; return; }
      const fd = new FormData();
      fd.append('bio', $('#s-bio').value);
      fd.append('title', titleVal);
      fd.append('location', $('#s-location').value || '');
      const validLinks = currentLinks.filter(l => l.url && l.url.trim());
      fd.append('links', JSON.stringify(validLinks));
      const avatarFile = $('#avatar-file').files[0];
      if (avatarFile) fd.append('avatar', avatarFile);
      try {
        const updated = await apiForm('/profile', fd, 'PUT');
        currentUser = updated;
        updateNavUI();
        toast('Profil güncellendi');
        $('#profile-msg').style.color = 'var(--accent-red2)';
        $('#profile-msg').textContent = '';
      } catch (e) { $('#profile-msg').textContent = e.message; }
    });

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

  } else if (section === 'appearance') {
    el.innerHTML = `
      <div class="card">
        <div class="card-header"><span>Görünüm</span></div>
        <div class="card-body">
          <div class="form-group"><label class="checkbox-label"><input type="checkbox" id="s-show-badge" ${currentUser.show_level_badge ? 'checked' : ''} /> Seviye rozetini göster</label></div>
          <div class="form-group"><label class="checkbox-label"><input type="checkbox" id="s-show-color" ${currentUser.show_level_color ? 'checked' : ''} /> İsim rengini göster</label></div>
          ${(currentUser.is_vip || currentUser.is_plus) ? `<div class="form-group"><label>İsim Rengi (VIP/Plus)</label><input type="color" id="s-name-color" value="${currentUser.name_color || '#f5f5f5'}" style="width:60px;height:36px;padding:2px;cursor:pointer" /></div>` : ''}
          <button class="btn btn-primary" id="save-appearance-btn">Kaydet</button>
          <div id="appear-msg" class="form-error mt-4"></div>
        </div>
      </div>`;
    $('#save-appearance-btn').addEventListener('click', async () => {
      const body = {
        show_level_badge: $('#s-show-badge').checked,
        show_level_color: $('#s-show-color').checked,
      };
      if (currentUser.is_vip || currentUser.is_plus) body.name_color = $('#s-name-color')?.value || '';
      try {
        const fd = new FormData();
        Object.entries(body).forEach(([k, v]) => fd.append(k, v));
        const updated = await apiForm('/profile', fd, 'PUT');
        currentUser = updated; updateNavUI();
        toast('Görünüm güncellendi');
      } catch (e) { $('#appear-msg').textContent = e.message; }
    });
  } else if (section === 'notifications') {
    el.innerHTML = `
      <div class="card">
        <div class="card-header"><span><i class="fas fa-bell" style="color:var(--accent-red2);margin-right:6px"></i>Bildirim Ayarları</span></div>
        <div class="card-body">
          <div class="form-group">
            <label class="checkbox-label" style="align-items:flex-start;gap:12px">
              <input type="checkbox" id="s-allow-mentions" style="width:auto;margin-top:3px" ${(currentUser.allow_mentions ?? 1) ? 'checked' : ''} />
              <div>
                <div style="font-weight:600;font-size:14px">Beni etiketleyen kişilere bildirim gönder</div>
                <div style="font-size:12px;color:var(--text-muted);margin-top:3px">
                  Kapatırsan kimse seni @etiketleyemez ve bildirim almaz, profil linki de açılmaz
                </div>
              </div>
            </label>
          </div>
          <button class="btn btn-primary" id="save-notif-btn">Kaydet</button>
          <div id="notif-settings-msg" class="form-error mt-4"></div>
        </div>
      </div>`;
    $('#save-notif-btn').addEventListener('click', async () => {
      const fd = new FormData();
      fd.append('allow_mentions', $('#s-allow-mentions').checked ? '1' : '0');
      try {
        const updated = await apiForm('/profile', fd, 'PUT');
        currentUser = updated; updateNavUI();
        toast('Bildirim ayarları kaydedildi');
      } catch(e) { $('#notif-settings-msg').textContent = e.message; }
    });
  } else if (section === 'spotify') {
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

// ===== GELISMIS GIRIS/KAYIT UI =====

function renderLogin(app) {
  if (currentUser) { navigate('/'); return; }
  document.title = 'Giris Yap - ' + siteName;

  app.innerHTML = `
    <style>
      .auth-outer { min-height: calc(100vh - 120px); display: flex; align-items: center; justify-content: center; padding: 24px 16px; }
      .auth-glass {
        width: 100%; max-width: 420px;
        background: linear-gradient(145deg, rgba(30,30,42,0.97), rgba(20,20,30,0.97));
        border: 1px solid rgba(189,162,117,0.22);
        border-radius: 24px;
        padding: 40px 36px;
        box-shadow: 0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.03) inset;
        position: relative; overflow: hidden;
      }
      .auth-glass::before {
        content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px;
        background: linear-gradient(90deg, transparent, var(--accent-red, #BDA275), transparent);
      }
      .auth-logo-wrap { text-align: center; margin-bottom: 28px; }
      .auth-logo-circle {
        width: 80px; height: 80px;
        border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
        overflow: hidden; box-shadow: 0 0 28px rgba(189,162,117,0.35);
        margin-bottom: 14px;
      }
      .auth-logo-circle img { width: 100%; height: 100%; object-fit: contain; }
      .auth-heading { font-size: 26px; font-weight: 800; text-align: center; margin-bottom: 4px; letter-spacing: -0.5px; }
      .auth-sub { font-size: 13px; color: var(--text-muted, #888); text-align: center; margin-bottom: 28px; }
      .auth-field { margin-bottom: 16px; }
      .auth-field label { display: block; font-size: 11px; font-weight: 700; color: var(--text-muted,#888); margin-bottom: 7px; text-transform: uppercase; letter-spacing: 0.7px; }
      .auth-field .input-wrap { position: relative; }
      .auth-field .input-wrap i { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); color: rgba(255,255,255,0.3); font-size: 13px; }
      .auth-field input {
        width: 100%; padding: 13px 14px 13px 40px;
        background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
        border-radius: 12px; color: var(--text,#f0f0f5); font-size: 14px;
        outline: none; transition: all 0.2s;
      }
      .auth-field input:focus { border-color: rgba(189,162,117,0.55); background: rgba(189,162,117,0.05); }
      .auth-pw-toggle { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); background: none; border: none; color: rgba(255,255,255,0.35); cursor: pointer; padding: 4px; font-size: 14px; }
      .auth-btn-main {
        width: 100%; padding: 14px; border: none; border-radius: 12px; cursor: pointer;
        background: linear-gradient(135deg, #BDA275, #7a5c30);
        color: #fff; font-size: 15px; font-weight: 700;
        box-shadow: 0 4px 20px rgba(189,162,117,0.35);
        transition: all 0.2s; letter-spacing: 0.3px; margin-top: 6px;
      }
      .auth-btn-main:hover { box-shadow: 0 6px 28px rgba(189,162,117,0.5); transform: translateY(-1px); }
      .auth-btn-main:active { transform: translateY(0); }
      .auth-error { font-size: 12px; color: #f87171; margin-top: 10px; text-align: center; min-height: 18px; }
      .auth-divider { display: flex; align-items: center; gap: 12px; margin: 22px 0; }
      .auth-divider span { font-size: 12px; color: rgba(255,255,255,0.25); white-space: nowrap; }
      .auth-divider::before, .auth-divider::after { content: ''; flex: 1; height: 1px; background: rgba(255,255,255,0.08); }
      .auth-switch { text-align: center; font-size: 13px; color: var(--text-muted,#888); }
      .auth-switch a { color: #BDA275; font-weight: 600; }
      @media (max-width: 480px) {
        .auth-glass { padding: 30px 20px; border-radius: 20px; }
        .auth-heading { font-size: 22px; }
      }
    </style>
    <div class="auth-outer">
      <div class="auth-glass">
        <div class="auth-logo-wrap">
          <div class="auth-logo-circle"><img src="/cigcig.png" alt="CigCig" /></div>
          <div class="auth-heading">Tekrar Hosgeldin</div>
          <div class="auth-sub">Hesabina giris yap</div>
        </div>
        <div class="auth-field">
          <label>Kullanici Adi</label>
          <div class="input-wrap">
            <i class="fas fa-user"></i>
            <input type="text" id="login-id" placeholder="kullanici_adin" autocomplete="username" />
          </div>
        </div>
        <div class="auth-field">
          <label>Sifre</label>
          <div class="input-wrap">
            <i class="fas fa-lock"></i>
            <input type="password" id="login-pw" placeholder="••••••••" autocomplete="current-password" style="padding-right:44px" />
            <button type="button" class="auth-pw-toggle" id="login-pw-toggle" tabindex="-1"><i class="fas fa-eye" id="login-pw-icon"></i></button>
          </div>
        </div>
        <button class="auth-btn-main" id="login-btn">Giris Yap</button>
        <div class="auth-error" id="login-error"></div>
        <div class="auth-divider"><span>veya</span></div>
        <div class="auth-switch">Hesabin yok mu? <a href="/kayit" data-link>Kayit Ol</a></div>
      </div>
    </div>`;

  $('#login-pw-toggle').addEventListener('click', () => {
    const pw = $('#login-pw'), icon = $('#login-pw-icon');
    if (pw.type === 'password') { pw.type = 'text'; icon.className = 'fas fa-eye-slash'; }
    else { pw.type = 'password'; icon.className = 'fas fa-eye'; }
  });

  const doLogin = async () => {
    const login = $('#login-id').value.trim();
    const password = $('#login-pw').value;
    const errEl = $('#login-error');
    const btn = $('#login-btn');
    if (!login || !password) { errEl.textContent = 'Tum alanlari doldurun'; return; }
    btn.disabled = true;
    btn.textContent = 'Giris yapiliyor...';
    errEl.textContent = '';
    try {
      const data = await api('/auth/login', { method: 'POST', body: JSON.stringify({ login, password }) });
      if (data.pending_delete) {
        const deleteAt = new Date(data.delete_at);
        const daysLeft = Math.ceil((deleteAt - Date.now()) / 86400000);
        app.innerHTML = `<div class="auth-outer">
          <div class="auth-glass" style="border-color:rgba(220,38,38,0.4)">
            <div style="text-align:center;margin-bottom:20px">
              <div style="font-size:36px;margin-bottom:12px"><i class="fas fa-exclamation-triangle" style="color:#ef4444"></i></div>
              <div style="font-size:18px;font-weight:700;color:#ef4444">Hesap Silme Talebi</div>
              <p style="font-size:13px;color:var(--text-muted);margin-top:8px">
                Hesabiniz <strong>${daysLeft} gun</strong> icinde kalici olarak silinecek.
              </p>
            </div>
            <button class="auth-btn-main" id="cancel-delete-btn" style="margin-bottom:10px">Vazgec, Hesabimi Geri Al</button>
            <button class="auth-btn-main" id="keep-delete-btn" style="background:rgba(239,68,68,0.2);border:1px solid rgba(239,68,68,0.3);box-shadow:none;color:#f87171">Hayir, Silinsin</button>
          </div>
        </div>`;
        $('#cancel-delete-btn').addEventListener('click', async () => {
          try {
            const r = await fetch('/api/auth/cancel-delete', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + data.temp_token } });
            const d = await r.json();
            if (!r.ok) throw new Error(d.error);
            currentToken = d.token; currentUser = d.user;
            localStorage.setItem('token', currentToken);
            updateNavUI(); toast('Hosgeldin, ' + currentUser.username + '!'); navigate('/');
          } catch (ex) { toast(ex.message, 'error'); }
        });
        $('#keep-delete-btn').addEventListener('click', () => navigate('/'));
        return;
      }
      currentToken = data.token; currentUser = data.user;
      localStorage.setItem('token', currentToken);
      updateNavUI(); toast('Hosgeldin, ' + currentUser.username + '!'); navigate('/');
    } catch (e) {
      errEl.textContent = e.message;
      btn.disabled = false;
      btn.textContent = 'Giris Yap';
    }
  };

  $('#login-btn').addEventListener('click', doLogin);
  $('#login-pw').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
}

function renderRegister(app) {
  if (currentUser) { navigate('/'); return; }
  document.title = 'Kayit Ol - ' + siteName;

  app.innerHTML = `
    <div class="auth-outer">
      <div class="auth-glass">
        <div class="auth-logo-wrap">
          <div class="auth-logo-circle"><img src="/cigcig.png" alt="CigCig" /></div>
          <div class="auth-heading">Topluluğa Katıl</div>
          <div class="auth-sub">Ucretsiz hesap olustur</div>
        </div>
        <div class="auth-field">
          <label>Kullanici Adi</label>
          <div class="input-wrap">
            <i class="fas fa-user"></i>
            <input type="text" id="reg-username" placeholder="harika_kullanici" autocomplete="username" />
          </div>
        </div>
        <div class="auth-field">
          <label>E-posta <span style="font-size:10px;color:var(--text-muted);font-style:italic;text-transform:none;letter-spacing:0">(sallayabilirsin)</span></label>
          <div class="input-wrap">
            <i class="fas fa-envelope"></i>
            <input type="email" id="reg-email" placeholder="ornek@mail.com" autocomplete="email" />
          </div>
        </div>
        <div class="auth-field">
          <label>Sifre</label>
          <div class="input-wrap">
            <i class="fas fa-lock"></i>
            <input type="password" id="reg-pw" placeholder="••••••••" autocomplete="new-password" style="padding-right:44px" />
            <button type="button" class="auth-pw-toggle" id="reg-pw-toggle" tabindex="-1"><i class="fas fa-eye" id="reg-pw-icon"></i></button>
          </div>
        </div>
        <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:12px;margin-bottom:16px">
          <label class="checkbox-label" style="font-size:13px;text-transform:none;letter-spacing:0;margin:0;cursor:pointer;display:flex;align-items:flex-start;gap:10px">
            <input type="checkbox" id="reg-kvkk" style="width:auto;margin-top:2px;cursor:pointer" />
            <span style="color:var(--text-muted);line-height:1.5">KVKK aydinlatma metnini okudum ve kabul ediyorum.
              <button type="button" id="kvkk-btn" style="background:none;border:none;color:#BDA275;font-size:12px;cursor:pointer;padding:0;font-weight:600">Metni oku</button>
            </span>
          </label>
        </div>
        <button class="auth-btn-main" id="reg-btn">Kayit Ol</button>
        <div class="auth-error" id="reg-error"></div>
        <div class="auth-divider"><span>veya</span></div>
        <div class="auth-switch">Zaten hesabin var mi? <a href="/giris" data-link>Giris Yap</a></div>
      </div>
    </div>`;

  $('#reg-pw-toggle').addEventListener('click', () => {
    const pw = $('#reg-pw'), icon = $('#reg-pw-icon');
    if (pw.type === 'password') { pw.type = 'text'; icon.className = 'fas fa-eye-slash'; }
    else { pw.type = 'password'; icon.className = 'fas fa-eye'; }
  });
  $('#kvkk-btn').addEventListener('click', async () => {
    try { const r = await api('/kvkk'); showModal('KVKK Aydinlatma Metni', `<div style="white-space:pre-wrap;font-size:13px;line-height:1.7;color:var(--text-secondary);max-height:400px;overflow-y:auto">${escHtml(r.text)}</div>`); } catch {}
  });

  const doRegister = async () => {
    const username = $('#reg-username').value.trim();
    const email = $('#reg-email').value.trim();
    const password = $('#reg-pw').value;
    const kvkk_accepted = $('#reg-kvkk').checked;
    const errEl = $('#reg-error'), btn = $('#reg-btn');
    if (!username || !email || !password) { errEl.textContent = 'Tum alanlari doldurun'; return; }
    if (!kvkk_accepted) { errEl.textContent = 'KVKK onayi zorunludur'; return; }
    btn.disabled = true; btn.textContent = 'Kayit yapiliyor...'; errEl.textContent = '';
    try {
      const data = await api('/auth/register', { method: 'POST', body: JSON.stringify({ username, email, password, kvkk_accepted }) });
      currentToken = data.token; currentUser = data.user;
      localStorage.setItem('token', currentToken);
      updateNavUI(); toast('Hosgeldiniz, ' + currentUser.username + '!'); navigate('/');
    } catch (e) { errEl.textContent = e.message; btn.disabled = false; btn.textContent = 'Kayit Ol'; }
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
    if (badge) { badge.textContent = count > 9 ? '9+' : count; badge.style.display = count > 0 ? 'inline' : 'none'; }
    if (mobBadge) { mobBadge.textContent = count > 9 ? '9+' : count; mobBadge.style.display = count > 0 ? 'inline' : 'none'; }
  } catch {}
}

async function init() {
  await initAuth();
  try {
    const ps = await fetch('/api/public-settings').then(r => r.json());
    siteName = ps.site_name || 'CigCig';
    window.otherSongsEnabled = ps.other_songs_enabled !== '0';
    if (ps.homepage_sections) {
      try { window._homepageSections = JSON.parse(ps.homepage_sections); } catch {}
    }
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
      const createdVisible = ps.footer_created_visible !== '0';
      const copyrightText = ps.footer_copyright_text || '©&nbsp;Copyright 2026';
      footer.innerHTML = createdVisible ? `Created By. İsmail DEMİRCAN &nbsp;${copyrightText}` : copyrightText;
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

// ===== FOTO SISTEMI =====

window._photoMuted = false;
window._currentPhotoAudio = null;

function photoCardHTML(p) {
  const username = p.username || 'Silinmis';
  const avatar = p.avatar ? `<img src="${escHtml(p.avatar)}" class="avatar-sm" />` : `<div class="avatar-sm avatar-placeholder" style="font-size:0.75em;font-weight:700;color:var(--text-muted)">?</div>`;
  const timeStr = timeAgo(p.created_at);
  const likesCount = parseInt(p.likes_count) || 0;
  const commentsCount = parseInt(p.comments_count) || 0;
  const savesCount = parseInt(p.saves_count) || 0;

  const musicBar = p.music_url ? `
    <div class="photo-music-bar">
      <img src="${escHtml(p.music_cover || '')}" class="photo-music-cover" onerror="this.style.display='none'" />
      <div class="photo-music-info">
        <div class="photo-music-title">${escHtml(p.music_title || '')}</div>
        <div class="photo-music-artist">${escHtml(p.music_artist || '')}</div>
      </div>
      <button class="photo-music-mute" data-photo="${escHtml(String(p.id))}" data-audio="${escHtml(p.music_url)}" title="Mute/Unmute">
        <i class="fas fa-volume-up"></i>
      </button>
    </div>` : '';

  return `<div class="photo-card" id="photo-card-${p.id}">
    <div class="photo-card-header">
      <div style="display:flex;align-items:center;gap:10px;cursor:pointer" onclick="navigate('/profil/${escHtml(username)}')">
        ${avatar}
        <div>
          <div style="font-weight:700;font-size:14px">${escHtml(username)}</div>
          <div style="font-size:11px;color:var(--text-muted)">${timeStr}</div>
        </div>
      </div>
    </div>
    <div class="photo-card-img-wrap" onclick="navigate('/foto/${escHtml(String(p.id))}')">
      <img src="${escHtml(p.image_url)}" class="photo-card-img" loading="lazy" />
      ${musicBar}
    </div>
    <div class="photo-card-actions">
      ${p.allow_likes ? `<button class="photo-action-btn photo-like-btn" data-photo="${p.id}" data-liked="0">
        <i class="far fa-heart"></i> <span class="photo-like-count">${likesCount}</span>
      </button>` : ''}
      ${p.allow_comments ? `<button class="photo-action-btn" onclick="navigate('/foto/${p.id}')">
        <i class="far fa-comment"></i> ${commentsCount}
      </button>` : ''}
      ${p.allow_sharing ? `<button class="photo-action-btn photo-share-btn" data-url="${location.origin}/foto/${p.id}">
        <i class="fas fa-share-alt"></i>
      </button>` : ''}
      <button class="photo-action-btn photo-save-btn" data-photo="${p.id}" data-saved="0" style="margin-left:auto">
        <i class="far fa-bookmark"></i>
      </button>
    </div>
    ${p.caption ? `<div class="photo-card-caption"><strong>${escHtml(username)}</strong> ${escHtml(p.caption)}</div>` : ''}
  </div>`;
}

function initPhotoCardActions(container) {
  // Like buttons
  container.querySelectorAll('.photo-like-btn').forEach(btn => {
    const photoId = btn.dataset.photo;
    // Load like status
    if (currentUser) {
      api('/photos/' + photoId + '/like-status').then(d => {
        btn.dataset.liked = d.liked ? '1' : '0';
        btn.querySelector('i').className = d.liked ? 'fas fa-heart' : 'far fa-heart';
        btn.querySelector('.photo-like-count').textContent = d.count;
        if (d.liked) btn.style.color = '#ef4444';
      }).catch(() => {});
    }
    btn.addEventListener('click', async () => {
      if (!currentUser) { navigate('/giris'); return; }
      try {
        const d = await api('/photos/' + photoId + '/like', { method: 'POST' });
        btn.dataset.liked = d.liked ? '1' : '0';
        btn.querySelector('i').className = d.liked ? 'fas fa-heart' : 'far fa-heart';
        btn.querySelector('.photo-like-count').textContent = d.count;
        btn.style.color = d.liked ? '#ef4444' : '';
        btn.classList.add('photo-btn-pop');
        setTimeout(() => btn.classList.remove('photo-btn-pop'), 300);
      } catch (e) { toast(e.message, 'error'); }
    });
  });

  // Save buttons
  container.querySelectorAll('.photo-save-btn').forEach(btn => {
    const photoId = btn.dataset.photo;
    if (currentUser) {
      api('/photos/' + photoId + '/save-status').then(d => {
        btn.dataset.saved = d.saved ? '1' : '0';
        btn.querySelector('i').className = d.saved ? 'fas fa-bookmark' : 'far fa-bookmark';
        if (d.saved) btn.style.color = 'var(--accent-red2)';
      }).catch(() => {});
    }
    btn.addEventListener('click', async () => {
      if (!currentUser) { navigate('/giris'); return; }
      try {
        const d = await api('/photos/' + photoId + '/save', { method: 'POST' });
        btn.dataset.saved = d.saved ? '1' : '0';
        btn.querySelector('i').className = d.saved ? 'fas fa-bookmark' : 'far fa-bookmark';
        btn.style.color = d.saved ? 'var(--accent-red2)' : '';
        toast(d.saved ? 'Kaydedildi' : 'Kaydedilenlerden cikarildi');
      } catch (e) { toast(e.message, 'error'); }
    });
  });

  // Share buttons
  container.querySelectorAll('.photo-share-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const url = btn.dataset.url;
      if (navigator.share) {
        navigator.share({ url }).catch(() => {});
      } else {
        navigator.clipboard.writeText(url).then(() => toast('Link kopyalandi')).catch(() => {});
      }
    });
  });

  // Music mute buttons
  container.querySelectorAll('.photo-music-mute').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const audioUrl = btn.dataset.audio;
      if (!audioUrl) return;
      const card = btn.closest('.photo-card');
      const audio = card._photoAudio;
      if (audio) {
        audio.muted = !audio.muted;
        btn.querySelector('i').className = audio.muted ? 'fas fa-volume-mute' : 'fas fa-volume-up';
      } else {
        const a = new Audio(audioUrl);
        a.loop = true;
        card._photoAudio = a;
        a.play().catch(() => {});
        btn.querySelector('i').className = 'fas fa-volume-up';
      }
    });
  });
}

async function renderPhotoFeed(app) {
  document.title = 'Fotograflar - ' + siteName;
  app.innerHTML = `
    <div class="container page" style="max-width:600px;margin:0 auto">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;padding:16px 0 0">
        <div>
          <h1 style="font-size:22px;font-weight:800;margin:0">Fotograflar</h1>
          <div style="font-size:13px;color:var(--text-muted)">Topluluktan anlara bak</div>
        </div>
        ${currentUser ? `<button class="btn btn-primary btn-sm" id="new-photo-btn"><i class="fas fa-camera"></i> Foto At</button>` : `<a href="/giris" data-link class="btn btn-primary btn-sm"><i class="fas fa-camera"></i> Foto At</a>`}
      </div>
      <div id="photo-feed"></div>
      <div id="photo-load-more" style="text-align:center;padding:20px">
        <button class="btn btn-outline btn-sm" id="photo-more-btn">Daha Fazla Yukle</button>
      </div>
    </div>`;

  let page = 1;
  const feed = $('#photo-feed');

  async function loadPhotos() {
    try {
      const photos = await api('/photos?page=' + page);
      if (!photos.length) {
        if (page === 1) feed.innerHTML = '<div class="empty-state"><i class="fas fa-camera"></i><p>Henuz foto yok. Ilk sen paylas!</p></div>';
        $('#photo-load-more').style.display = 'none';
        return;
      }
      const div = document.createElement('div');
      div.innerHTML = photos.map(p => photoCardHTML(p)).join('');
      feed.appendChild(div);
      initPhotoCardActions(div);
      if (photos.length < 20) $('#photo-load-more').style.display = 'none';
    } catch (e) {
      feed.innerHTML = '<div class="empty-state"><i class="fas fa-camera"></i><p>Fotograflar yuklenemedi.</p></div>';
    }
  }

  await loadPhotos();

  $('#photo-more-btn')?.addEventListener('click', () => { page++; loadPhotos(); });
  $('#new-photo-btn')?.addEventListener('click', () => showNewPhotoModal());
}

async function renderPhotoDetail(app, id) {
  document.title = 'Foto - ' + siteName;
  app.innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';

  try {
    const [photo, comments] = await Promise.all([
      api('/photos/' + id),
      api('/photos/' + id + '/comments')
    ]);

    let likeStatus = { liked: false, count: parseInt(photo.likes_count) || 0 };
    let saveStatus = { saved: false, count: parseInt(photo.saves_count) || 0 };
    if (currentUser) {
      try {
        [likeStatus, saveStatus] = await Promise.all([
          api('/photos/' + id + '/like-status'),
          api('/photos/' + id + '/save-status')
        ]);
      } catch {}
    }

    const username = photo.username || 'Silinmis';
    const avatar = photo.avatar ? `<img src="${escHtml(photo.avatar)}" class="avatar-sm" />` : `<div class="avatar-sm avatar-placeholder">?</div>`;
    const isOwn = currentUser && currentUser.id === photo.user_id;

    const commentsHTML = comments.map(c => {
      const isu = currentUser && (currentUser.id === c.user_id || currentUser.is_admin);
      return `<div class="photo-comment" data-cid="${c.id}">
        <img src="${escHtml(c.avatar || '')}" class="avatar-sm" onerror="this.style.display='none'" />
        <div class="photo-comment-body">
          <span class="photo-comment-user" onclick="navigate('/profil/${escHtml(c.username || '')}')" style="cursor:pointer;font-weight:700">${escHtml(c.username || 'Silindi')}</span>
          <span class="photo-comment-text"> ${escHtml(c.content)}</span>
          <div class="photo-comment-time">${timeAgo(c.created_at)}</div>
        </div>
        ${isu ? `<button class="btn btn-ghost btn-sm photo-comment-del" data-cid="${c.id}" style="margin-left:auto;flex-shrink:0"><i class="fas fa-trash" style="color:var(--accent-red2);font-size:11px"></i></button>` : ''}
      </div>`;
    }).join('');

    app.innerHTML = `
      <div class="container page" style="max-width:700px;margin:0 auto">
        <button class="btn btn-ghost btn-sm" onclick="history.back()" style="margin-bottom:16px"><i class="fas fa-arrow-left"></i> Geri</button>
        <div class="photo-detail-card">
          <div class="photo-detail-header">
            <div style="display:flex;align-items:center;gap:10px;cursor:pointer" onclick="navigate('/profil/${escHtml(username)}')">
              ${avatar}
              <div>
                <div style="font-weight:700">${escHtml(username)}</div>
                <div style="font-size:11px;color:var(--text-muted)">${timeAgo(photo.created_at)}</div>
              </div>
            </div>
            ${isOwn ? `<button class="btn btn-ghost btn-sm" id="photo-del-btn" style="margin-left:auto"><i class="fas fa-trash" style="color:var(--accent-red2)"></i></button>` : ''}
          </div>
          <div class="photo-detail-img-wrap">
            <img src="${escHtml(photo.image_url)}" class="photo-detail-img" />
            ${photo.music_url ? `
              <div class="photo-music-bar">
                <img src="${escHtml(photo.music_cover || '')}" class="photo-music-cover" onerror="this.style.display='none'" />
                <div class="photo-music-info">
                  <div class="photo-music-title">${escHtml(photo.music_title || '')}</div>
                  <div class="photo-music-artist">${escHtml(photo.music_artist || '')}</div>
                </div>
                <button class="photo-music-mute" data-photo="${id}" data-audio="${escHtml(photo.music_url)}" title="Mute/Unmute">
                  <i class="fas fa-volume-up"></i>
                </button>
              </div>` : ''}
          </div>
          <div class="photo-detail-actions">
            ${photo.allow_likes ? `<button class="photo-action-btn photo-like-btn" id="detail-like-btn" data-photo="${id}" data-liked="${likeStatus.liked ? '1' : '0'}" style="${likeStatus.liked ? 'color:#ef4444' : ''}">
              <i class="${likeStatus.liked ? 'fas' : 'far'} fa-heart"></i> <span id="detail-like-count">${likeStatus.count}</span>
            </button>` : ''}
            ${photo.allow_sharing ? `<button class="photo-action-btn" id="detail-share-btn" data-url="${location.origin}/foto/${id}">
              <i class="fas fa-share-alt"></i> Paylas
            </button>` : ''}
            <button class="photo-action-btn photo-save-btn" id="detail-save-btn" data-photo="${id}" data-saved="${saveStatus.saved ? '1' : '0'}" style="margin-left:auto;${saveStatus.saved ? 'color:var(--accent-red2)' : ''}">
              <i class="${saveStatus.saved ? 'fas' : 'far'} fa-bookmark"></i>
            </button>
          </div>
          ${photo.caption ? `<div class="photo-card-caption" style="padding:12px 16px"><strong>${escHtml(username)}</strong> ${escHtml(photo.caption)}</div>` : ''}
          ${photo.allow_comments ? `
            <div class="photo-comments-section">
              <div class="photo-comments-list" id="photo-comments-list">
                ${commentsHTML || '<div style="color:var(--text-muted);font-size:13px;padding:8px 0">Henuz yorum yok.</div>'}
              </div>
              ${currentUser ? `
                <div class="photo-comment-input-row">
                  <img src="${escHtml(currentUser.avatar || '')}" class="avatar-sm" onerror="this.style.display='none'" />
                  <input type="text" id="photo-comment-input" placeholder="Yorum yaz..." style="flex:1;background:var(--bg-card2);border:1px solid var(--border)" />
                  <button class="btn btn-primary btn-sm" id="photo-comment-send"><i class="fas fa-paper-plane"></i></button>
                </div>` : `<div style="padding:12px;font-size:13px;color:var(--text-muted)">Yorum yapmak icin <a href="/giris" data-link class="auth-link">giris yapin</a>.</div>`}
            </div>` : `<div style="padding:12px 16px;font-size:13px;color:var(--text-muted)">Yorumlar kapali.</div>`}
        </div>
      </div>`;

    // Like button
    $('#detail-like-btn')?.addEventListener('click', async () => {
      if (!currentUser) { navigate('/giris'); return; }
      try {
        const d = await api('/photos/' + id + '/like', { method: 'POST' });
        const btn = $('#detail-like-btn');
        btn.dataset.liked = d.liked ? '1' : '0';
        btn.querySelector('i').className = d.liked ? 'fas fa-heart' : 'far fa-heart';
        btn.style.color = d.liked ? '#ef4444' : '';
        $('#detail-like-count').textContent = d.count;
      } catch (e) { toast(e.message, 'error'); }
    });

    // Share button
    $('#detail-share-btn')?.addEventListener('click', () => {
      const url = location.origin + '/foto/' + id;
      if (navigator.share) navigator.share({ url }).catch(() => {});
      else navigator.clipboard.writeText(url).then(() => toast('Link kopyalandi')).catch(() => {});
    });

    // Save button
    $('#detail-save-btn')?.addEventListener('click', async () => {
      if (!currentUser) { navigate('/giris'); return; }
      try {
        const d = await api('/photos/' + id + '/save', { method: 'POST' });
        const btn = $('#detail-save-btn');
        btn.dataset.saved = d.saved ? '1' : '0';
        btn.querySelector('i').className = d.saved ? 'fas fa-bookmark' : 'far fa-bookmark';
        btn.style.color = d.saved ? 'var(--accent-red2)' : '';
        toast(d.saved ? 'Kaydedildi' : 'Kaydedilenlerden cikarildi');
      } catch (e) { toast(e.message, 'error'); }
    });

    // Music mute button
    let detailAudio = null;
    if (photo.music_url) {
      detailAudio = new Audio(photo.music_url);
      detailAudio.loop = true;
      detailAudio.muted = true;
      detailAudio.play().catch(() => {});
    }
    document.querySelector('.photo-music-mute')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!detailAudio) return;
      detailAudio.muted = !detailAudio.muted;
      document.querySelector('.photo-music-mute i').className = detailAudio.muted ? 'fas fa-volume-mute' : 'fas fa-volume-up';
    });

    // Comment send
    const sendComment = async () => {
      const input = $('#photo-comment-input');
      const content = input?.value?.trim();
      if (!content) return;
      try {
        const c = await api('/photos/' + id + '/comments', { method: 'POST', body: JSON.stringify({ content }) });
        input.value = '';
        const list = $('#photo-comments-list');
        const div = document.createElement('div');
        div.innerHTML = `<div class="photo-comment" data-cid="${c.id}">
          <img src="${escHtml(currentUser.avatar || '')}" class="avatar-sm" onerror="this.style.display='none'" />
          <div class="photo-comment-body">
            <span class="photo-comment-user" style="cursor:pointer;font-weight:700">${escHtml(currentUser.username)}</span>
            <span class="photo-comment-text"> ${escHtml(c.content)}</span>
            <div class="photo-comment-time">az once</div>
          </div>
          <button class="btn btn-ghost btn-sm photo-comment-del" data-cid="${c.id}" style="margin-left:auto"><i class="fas fa-trash" style="color:var(--accent-red2);font-size:11px"></i></button>
        </div>`;
        list.querySelector('[style*="Henuz yorum"]')?.remove();
        list.appendChild(div);
        div.querySelector('.photo-comment-del').addEventListener('click', async () => {
          if (!confirm('Yorum silinsin mi?')) return;
          await api('/photos/' + id + '/comments/' + c.id, { method: 'DELETE' });
          div.querySelector('.photo-comment').remove();
        });
      } catch (e) { toast(e.message, 'error'); }
    };
    $('#photo-comment-send')?.addEventListener('click', sendComment);
    $('#photo-comment-input')?.addEventListener('keydown', e => { if (e.key === 'Enter') sendComment(); });

    // Comment delete buttons
    app.querySelectorAll('.photo-comment-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        const cid = btn.dataset.cid;
        if (!confirm('Yorum silinsin mi?')) return;
        try {
          await api('/photos/' + id + '/comments/' + cid, { method: 'DELETE' });
          btn.closest('.photo-comment').remove();
        } catch (e) { toast(e.message, 'error'); }
      });
    });

    // Delete photo button
    $('#photo-del-btn')?.addEventListener('click', async () => {
      if (!confirm('Foto kalici olarak silinsin mi?')) return;
      try {
        await api('/photos/' + id, { method: 'DELETE' });
        toast('Foto silindi');
        navigate('/fotograflar');
      } catch (e) { toast(e.message, 'error'); }
    });

  } catch (e) {
    app.innerHTML = '<div class="empty-state"><i class="fas fa-image"></i><p>Foto bulunamadi.</p></div>';
  }
}

async function showNewPhotoModal() {
  if (!currentUser) { navigate('/giris'); return; }

  // Load songs for music selection
  let songs = [];
  try { songs = await api('/songs'); } catch {}

  const songsOptions = songs.map(s =>
    `<option value="${s.id}" data-url="${escHtml(s.audio_url)}" data-title="${escHtml(s.title)}" data-artist="${escHtml(s.artist_name || '')}" data-cover="${escHtml(s.cover_url || '')}">${escHtml(s.title)} - ${escHtml(s.artist_name || '')}</option>`
  ).join('');

  showModal('Foto Paylas', `
    <div style="max-width:440px">
      <div class="form-group">
        <label>Fotograf *</label>
        <div id="photo-preview-wrap" style="width:100%;height:220px;background:var(--bg-card2);border:2px dashed var(--border);border-radius:12px;display:flex;align-items:center;justify-content:center;overflow:hidden;cursor:pointer;margin-bottom:8px" onclick="document.getElementById('photo-file').click()">
          <div id="photo-preview-placeholder" style="text-align:center;color:var(--text-muted)">
            <i class="fas fa-camera" style="font-size:36px;display:block;margin-bottom:8px"></i>
            <div style="font-size:13px">Fotograf sec</div>
          </div>
          <img id="photo-preview-img" style="display:none;width:100%;height:100%;object-fit:cover" />
        </div>
        <input type="file" id="photo-file" accept="image/*" style="display:none" />
      </div>
      <div class="form-group">
        <label>Aciklama</label>
        <textarea id="photo-caption" rows="3" placeholder="Ne dusunuyorsun?" style="resize:none"></textarea>
      </div>
      <div class="form-group">
        <label>Muzik Ekle (Opsiyonel)</label>
        <div style="display:flex;gap:8px;align-items:center">
          <input type="text" id="photo-music-search" placeholder="Sarkı ara..." style="flex:1" />
          <button class="btn btn-outline btn-sm" id="photo-music-search-btn"><i class="fas fa-search"></i></button>
        </div>
        <div id="photo-music-results" style="max-height:140px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;margin-top:6px;display:none"></div>
        <div id="photo-music-selected" style="display:none;background:var(--bg-card2);border:1px solid var(--border);border-radius:8px;padding:10px;margin-top:6px;display:flex;align-items:center;gap:10px">
          <img id="photo-music-sel-cover" style="width:36px;height:36px;border-radius:6px;object-fit:cover" onerror="this.style.display='none'" />
          <div style="flex:1;min-width:0">
            <div id="photo-music-sel-title" style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"></div>
            <div id="photo-music-sel-artist" style="font-size:11px;color:var(--text-muted)"></div>
          </div>
          <button class="btn btn-ghost btn-sm" id="photo-music-remove"><i class="fas fa-times"></i></button>
        </div>
        <input type="hidden" id="photo-music-id" value="" />
      </div>
      <div class="form-group">
        <label>Gizlilik Ayarlari</label>
        <div style="display:flex;flex-direction:column;gap:8px;padding:12px;background:var(--bg-card2);border-radius:8px;border:1px solid var(--border)">
          <label class="checkbox-label" style="font-size:13px;margin:0;text-transform:none;letter-spacing:0"><input type="checkbox" id="photo-allow-likes" checked style="width:auto" /> Begenilere izin ver</label>
          <label class="checkbox-label" style="font-size:13px;margin:0;text-transform:none;letter-spacing:0"><input type="checkbox" id="photo-allow-comments" checked style="width:auto" /> Yorumlara izin ver</label>
          <label class="checkbox-label" style="font-size:13px;margin:0;text-transform:none;letter-spacing:0"><input type="checkbox" id="photo-allow-sharing" checked style="width:auto" /> Paylasima izin ver</label>
        </div>
      </div>
      <button class="btn btn-primary" id="photo-submit-btn" style="width:100%;justify-content:center"><i class="fas fa-camera"></i> Paylas</button>
      <div id="photo-submit-msg" style="margin-top:8px;font-size:12px;text-align:center"></div>
    </div>`);

  // Image preview
  document.getElementById('photo-file').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      document.getElementById('photo-preview-img').src = ev.target.result;
      document.getElementById('photo-preview-img').style.display = 'block';
      document.getElementById('photo-preview-placeholder').style.display = 'none';
    };
    reader.readAsDataURL(file);
  });

  // Music search
  let allSongs = songs;
  const renderMusicResults = (list) => {
    const el = document.getElementById('photo-music-results');
    if (!list.length) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    el.innerHTML = list.slice(0, 8).map(s => `
      <div class="photo-music-result" data-id="${s.id}" data-url="${escHtml(s.audio_url || '')}" data-title="${escHtml(s.title)}" data-artist="${escHtml(s.artist_name || '')}" data-cover="${escHtml(s.cover_url || '')}"
        style="display:flex;align-items:center;gap:10px;padding:10px;cursor:pointer;border-bottom:1px solid var(--border);transition:background 0.15s"
        onmouseover="this.style.background='rgba(255,255,255,0.04)'" onmouseout="this.style.background=''">
        <img src="${escHtml(s.cover_url || '')}" style="width:36px;height:36px;border-radius:6px;object-fit:cover" onerror="this.style.display='none'" />
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(s.title)}</div>
          <div style="font-size:11px;color:var(--text-muted)">${escHtml(s.artist_name || '')}</div>
        </div>
      </div>`).join('');
    el.querySelectorAll('.photo-music-result').forEach(r => {
      r.addEventListener('click', () => {
        document.getElementById('photo-music-id').value = r.dataset.id;
        document.getElementById('photo-music-sel-title').textContent = r.dataset.title;
        document.getElementById('photo-music-sel-artist').textContent = r.dataset.artist;
        document.getElementById('photo-music-sel-cover').src = r.dataset.cover;
        const sel = document.getElementById('photo-music-selected');
        sel.style.display = 'flex';
        el.style.display = 'none';
        document.getElementById('photo-music-search').value = '';
      });
    });
  };

  document.getElementById('photo-music-search').addEventListener('input', e => {
    const q = e.target.value.toLowerCase().trim();
    if (!q) { document.getElementById('photo-music-results').style.display = 'none'; return; }
    renderMusicResults(allSongs.filter(s => s.title.toLowerCase().includes(q) || (s.artist_name || '').toLowerCase().includes(q)));
  });
  document.getElementById('photo-music-search-btn').addEventListener('click', () => {
    const q = document.getElementById('photo-music-search').value.toLowerCase().trim();
    renderMusicResults(q ? allSongs.filter(s => s.title.toLowerCase().includes(q) || (s.artist_name || '').toLowerCase().includes(q)) : allSongs.slice(0, 8));
  });
  document.getElementById('photo-music-remove').addEventListener('click', () => {
    document.getElementById('photo-music-id').value = '';
    document.getElementById('photo-music-selected').style.display = 'none';
  });

  // Submit
  document.getElementById('photo-submit-btn').addEventListener('click', async () => {
    const file = document.getElementById('photo-file').files[0];
    const caption = document.getElementById('photo-caption').value.trim();
    const musicId = document.getElementById('photo-music-id').value;
    const allowLikes = document.getElementById('photo-allow-likes').checked ? '1' : '0';
    const allowComments = document.getElementById('photo-allow-comments').checked ? '1' : '0';
    const allowSharing = document.getElementById('photo-allow-sharing').checked ? '1' : '0';
    const msg = document.getElementById('photo-submit-msg');
    const btn = document.getElementById('photo-submit-btn');

    if (!file) { msg.style.color = 'var(--accent-red2)'; msg.textContent = 'Fotograf secmelisiniz'; return; }
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner" style="width:14px;height:14px"></div> Yukleniyor...';
    msg.textContent = '';

    const fd = new FormData();
    fd.append('image', file);
    fd.append('caption', caption);
    if (musicId) fd.append('music_id', musicId);
    fd.append('allow_likes', allowLikes);
    fd.append('allow_comments', allowComments);
    fd.append('allow_sharing', allowSharing);

    try {
      const photo = await apiForm('/photos', fd);
      hideModal();
      toast('Foto paylasildi!');
      navigate('/foto/' + photo.id);
    } catch (e) {
      msg.style.color = 'var(--accent-red2)';
      msg.textContent = e.message;
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-camera"></i> Paylas';
    }
  });
}


init();