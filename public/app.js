let currentUser = null;
let currentToken = localStorage.getItem('token');
let realsFeedOrder = null;

const SITE_URL = 'https://demlik.up.railway.app';

function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }

function updatePageMeta(title, description, imageUrl) {
  document.title = title;
  let desc = document.querySelector('meta[name="description"]');
  if (!desc) { desc = document.createElement('meta'); desc.setAttribute('name','description'); document.head.appendChild(desc); }
  desc.setAttribute('content', description);

  const ogFields = { 'og:title': title, 'og:description': description, 'og:image': imageUrl || (SITE_URL + '/demlik.png'), 'og:url': location.href };
  Object.entries(ogFields).forEach(([prop, content]) => {
    let el = document.querySelector(`meta[property="${prop}"]`);
    if (!el) { el = document.createElement('meta'); el.setAttribute('property', prop); document.head.appendChild(el); }
    el.setAttribute('content', content);
  });

  const twFields = { 'twitter:title': title, 'twitter:description': description, 'twitter:image': imageUrl || (SITE_URL + '/demlik.png') };
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

function parseNameGradient(raw) {
  if (!raw) return null;
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
}

function buildNameGradientCss(g) {
  if (!g || !Array.isArray(g.colors)) return '';
  const colors = g.colors.filter(Boolean);
  if (!colors.length) return '';
  const type = g.type || 'linear';
  const angle = Number.isFinite(+g.angle) ? +g.angle : 135;
  if (type === 'radial') return `radial-gradient(circle at 30% 30%, ${colors.join(', ')})`;
  if (type === 'conic') return `conic-gradient(from ${angle}deg, ${colors.join(', ')})`;
  return `linear-gradient(${angle}deg, ${colors.join(', ')})`;
}

function userNameStyleAttr(u) {
  if (!u || u.show_level_color === 0) return '';
  if (u.is_plus && u.name_color_mode === 'gradient') {
    const bg = buildNameGradientCss(parseNameGradient(u.name_gradient));
    if (bg) {
      return `style="background:${bg};-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent"`;
    }
  }
  if ((u.is_vip || u.is_plus) && u.name_color) return `style="color:${escHtml(u.name_color)}"`;
  if (u.name_color) return `style="color:${escHtml(u.name_color)}"`;
  return '';
}

function userDisplayName(u) {
  if (!u) return 'Silindi';
  const color = userNameStyleAttr(u);
  const adminBadge = u.is_admin ? ` <i class="fas fa-shield user-admin" title="Demlik Yetkilisi" data-admin-since="${escHtml(u.admin_since || '')}" style="color:#5865F2;cursor:pointer;font-size:13px"></i>` : '';
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
  if (path === '/magaza') return renderStore(app);
  if (path === '/ayarlar') return renderSettings(app);
  if (path === '/giris') return renderLogin(app);
  if (path === '/kayit') return renderRegister(app);
  if (path === '/mesajlar') return renderMessages(app, null);
  if (path.startsWith('/mesajlar/')) return renderMessages(app, segs[1]);
  if (path === '/arkadaslar') return renderFriends(app);
  if (path === '/muzikler') return renderMusicList(app);
  if (path.startsWith('/muzik/')) return renderMusicDetail(app, segs[1]);
  if (path === '/artist-basvuru') return renderArtistApply(app);
  if (path === '/artist-panel') return renderArtistPanel(app);
  if (path === '/sarki-yukle') return renderShareSong(app);
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
  document.title = 'Reals – Demlik';
  updatePageMeta('Reals – Demlik', 'Kısa dikey videolar', '');
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
    btn.innerHTML = `${nav}<i class="fas fa-chevron-down" style="font-size:10px;color:var(--text-muted)"></i>`;
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
  document.title = 'Demlik – Topluluk Platformu';
  updatePageMeta('Demlik – Topluluk Platformu', 'Çay kadar sıcak topluluk platformu.', '');
  app.innerHTML = `
    <div class="container page">
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
      </div>
      <div class="section">
        <div class="section-header">
          <div class="section-title"><div class="section-title-bar"></div>Öne Çıkan Kitaplar</div>
          <a href="/kitaplar" data-link class="btn btn-ghost btn-sm">Tümü <i class="fas fa-arrow-right"></i></a>
        </div>
        <div id="home-books" class="books-grid"></div>
      </div>
    </div>`;

  if (currentUser) $('#home-new-forum-btn')?.addEventListener('click', () => showNewForumModal());

  let allForums = [];
  try {
    allForums = await api('/forums');
    const el = $('#home-forums');
    if (!allForums.length) { el.innerHTML = '<div class="empty-state"><i class="fas fa-comments"></i><p>Henüz konu yok.</p></div>'; }
    else el.innerHTML = `<div style="display:flex;flex-direction:column;gap:12px">${allForums.slice(0, 10).map(f => forumCardHTML(f)).join('')}</div>`;
  } catch {}

  $('#home-forum-search')?.addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    const filtered = allForums.filter(f => f.title.toLowerCase().includes(q) || f.content.toLowerCase().includes(q));
    const el = $('#home-forums');
    if (!el) return;
    if (!filtered.length) { el.innerHTML = '<div class="empty-state"><i class="fas fa-comments"></i><p>Konu bulunamadı.</p></div>'; return; }
    el.innerHTML = `<div style="display:flex;flex-direction:column;gap:12px">${filtered.map(f => forumCardHTML(f)).join('')}</div>`;
  });

  try {
    const books = await api('/books');
    const el = $('#home-books');
    if (!books.length) { el.innerHTML = '<div class="empty-state"><i class="fas fa-book"></i><p>Henüz kitap yok.</p></div>'; }
    else el.innerHTML = books.slice(0, 6).map(b => bookCardHTML(b)).join('');
  } catch {}
}

async function renderForumList(app, queryString) {
  document.title = 'Konular – Demlik';
  updatePageMeta('Konular – Demlik', 'Toplulukla fikir paylaş, tartış, keşfet.', '');

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
    document.title = forum.title + ' – Demlik';
    updatePageMeta(
      forum.title + ' – Demlik',
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
      'publisher': { '@type': 'Organization', 'name': 'Demlik', 'url': SITE_URL },
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
  document.title = 'Kitaplar – Demlik';
  updatePageMeta('Kitaplar – Demlik', 'Topluluğun yazdığı eserleri keşfet.', '');
  app.innerHTML = `
    <div class="container page">
      <div class="page-header book-list-header">
        <div class="page-header-copy"><div class="page-title">Kitaplar</div><div class="page-subtitle">Topluluğun eserleri</div></div>
        ${currentUser ? `<button class="btn btn-primary" id="new-book-btn"><i class="fas fa-plus"></i> Yeni Kitap</button>` : ''}
      </div>
      <div class="search-bar"><i class="fas fa-search"></i><input type="text" id="book-search" placeholder="Kitap ara..." /></div>
      <div id="books-grid" class="books-grid"><div class="loading-center"><div class="spinner"></div></div></div>
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
  const previewText = b.preface ? b.preface.substring(0, 72) : '';
  return `<article class="book-card" onclick="navigate('/kitap/${escHtml(b.slug)}')">
    <div class="book-cover-wrap">
      <div class="book-cover">
        ${b.cover_image ? `<img src="${escHtml(b.cover_image)}" alt="" loading="lazy" />` : `<div class="book-cover-placeholder"><i class="fas fa-book"></i></div>`}
        ${b.is_hidden ? '<span class="book-cover-lock"><i class="fas fa-lock"></i></span>' : ''}
      </div>
    </div>
    <div class="book-info">
      <div class="book-title">${escHtml(b.title)}</div>
      <div class="book-author">${escHtml(b.username || 'Bilinmiyor')}</div>
      ${previewText ? `<div class="book-desc">${escHtml(previewText)}…</div>` : `<div class="book-pages">${b.page_count || 0} sayfa</div>`}
    </div>
  </article>`;
}

function showNewBookModal(existing = null) {
  showModal(existing ? 'Kitabı Düzenle' : 'Yeni Kitap', `
    <div class="form-group"><label>Başlık</label><input id="bk-title" type="text" value="${existing ? escHtml(existing.title) : ''}" /></div>
    <div class="form-group"><label>Tanıtım / Önsöz</label><textarea id="bk-preface" rows="4">${existing ? escHtml(existing.preface || '') : ''}</textarea></div>
    <div class="form-group"><label>Karakterler (opsiyonel)</label><textarea id="bk-karakterler" rows="3" placeholder="Karakter isimleri, kısa notlar...">${existing ? escHtml(existing.karakterler || '') : ''}</textarea></div>
    <div class="form-group"><label>Kadro (opsiyonel)</label><textarea id="bk-kadro" rows="3" placeholder="Oyuncu kadrosu, karakter dağılımı...">${existing ? escHtml(existing.kadro || '') : ''}</textarea></div>
    <div class="form-group">
      <label>Kapak Resmi (opsiyonel)</label>
      <input type="file" id="bk-cover-file" accept="image/*" style="margin-bottom:8px" />
      ${existing && existing.cover_image ? `<img id="bk-cover-preview" src="${escHtml(existing.cover_image)}" style="width:100px;height:133px;object-fit:cover;border-radius:8px;margin-top:4px" />` : `<div id="bk-cover-preview" style="display:none"></div>`}
    </div>
    <div class="book-privacy-toggle">
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
    <button class="btn btn-primary" id="bk-submit" style="width:100%">${existing ? 'Güncelle' : 'Oluştur'}</button>
    <div id="bk-error" class="form-error mt-4"></div>
  `);

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
    const title = $('#bk-title').value.trim();
    if (!title) { $('#bk-error').textContent = 'Başlık zorunlu'; return; }
    try {
      let cover_image = existing ? (existing.cover_image || '') : '';
      const coverFile = $('#bk-cover-file').files[0];
      if (coverFile) {
        const fd = new FormData(); fd.append('file', coverFile);
        const r = await apiForm('/upload', fd);
        cover_image = r.url;
      }
      const payload = {
        title,
        preface: $('#bk-preface').value.trim(),
        karakterler: $('#bk-karakterler').value.trim(),
        kadro: $('#bk-kadro').value.trim(),
        cover_image,
        is_hidden: $('#bk-is-hidden').checked
      };
      if (existing) {
        await api('/book/' + existing.slug, { method: 'PUT', body: JSON.stringify(payload) });
        toast('Kitap güncellendi'); hideModal(); renderRoute(location.pathname);
      } else {
        const b = await api('/books', { method: 'POST', body: JSON.stringify(payload) });
        toast('Kitap oluşturuldu'); hideModal(); navigate('/kitap/' + b.slug);
      }
    } catch (e) { $('#bk-error').textContent = e.message; }
  });
}

async function renderBookDetail(app, slug) {
  app.innerHTML = `<div class="container page"><div class="loading-center"><div class="spinner"></div></div></div>`;
  let data;
  try { data = await api('/book/' + slug); } catch { app.innerHTML = '<div class="container page"><div class="empty-state"><i class="fas fa-exclamation-circle"></i><p>Kitap bulunamadı.</p></div></div>'; return; }

  const { book, chapters, pages } = data;
  document.title = book.title + ' – Demlik';
  updatePageMeta(book.title + ' – Demlik', book.preface ? book.preface.substring(0,155) : book.title + ' – Demlik\'te yayınlanan kitap.', book.cover_image || '');
  const isOwner = currentUser && currentUser.id === book.user_id;

  const sortedPages = [...pages].sort((a,b) => (a.page_num || 0) - (b.page_num || 0));
  const firstPage = sortedPages[0];
  const unassigned = sortedPages.filter(p => !p.chapter_id);
  const chapPages = {};
  chapters.forEach(c => { chapPages[c.id] = sortedPages.filter(p => p.chapter_id === c.id); });
  const lastReadSlug = localStorage.getItem('demlik_book_last_page_' + slug);
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

  app.innerHTML = `<div class="container page">
    <div class="book-detail-header">
      <div class="book-detail-cover">
        ${book.cover_image ? `<img src="${escHtml(book.cover_image)}" alt="" />` : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:var(--bg-card2)"><i class="fas fa-book" style="font-size:40px;color:var(--text-muted)"></i></div>`}
      </div>
      <div class="book-detail-info">
        <div class="book-detail-title">${escHtml(book.title)} ${book.is_hidden ? '<span style="margin-left:8px;display:inline-block;padding:4px 8px;background:var(--accent-red2);color:white;border-radius:6px;font-size:11px;font-weight:700"><i class="fas fa-lock"></i> GİZLİ</span>' : ''}</div>
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
        <div style="margin-top:12px">
          <button class="btn btn-outline btn-sm" id="download-pdf-btn"><i class="fas fa-file-pdf" style="color:#ef4444"></i> PDF İndir</button>
        </div>
      </div>
    </div>
    <div class="chapters-list">
      ${resumeHTML}
      <div class="section-title" style="margin-bottom:16px"><div class="section-title-bar"></div>İçindekiler</div>
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
  }

  $('#download-pdf-btn')?.addEventListener('click', async () => {
    toast('PDF hazırlanıyor...', 'success');
    try {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageW = 210; const margin = 20; const contentW = pageW - margin * 2;
      let y = margin;

      function addText(text, size, bold, color) {
        doc.setFontSize(size);
        doc.setFont('helvetica', bold ? 'bold' : 'normal');
        if (color) doc.setTextColor(...color); else doc.setTextColor(30, 30, 30);
        const lines = doc.splitTextToSize(text || '', contentW);
        lines.forEach(line => {
          if (y > 270) { doc.addPage(); y = margin; }
          doc.text(line, margin, y);
          y += size * 0.45;
        });
        y += 3;
      }

      addText(book.title, 24, true, [30, 30, 30]);
      addText('Yazar: ' + (book.username || 'Bilinmiyor'), 12, false, [100, 100, 100]);
      addText(book.page_count + ' sayfa', 11, false, [130, 130, 130]);
      y += 6;

      doc.setDrawColor(200, 50, 50);
      doc.line(margin, y, pageW - margin, y);
      y += 8;

      if (book.preface) {
        addText('ÖNSÖZ', 14, true, [180, 30, 30]);
        addText(book.preface, 11, false);
        y += 6;
        doc.line(margin, y, pageW - margin, y);
        y += 8;
      }

      addText('İÇİNDEKİLER', 14, true, [180, 30, 30]);
      const allPagesData = await api('/book/' + slug);
      const allP = allPagesData.pages || [];
      allP.forEach(p => { addText(p.page_num + '. ' + p.title, 11, false); });
      y += 8;
      doc.line(margin, y, pageW - margin, y);
      y += 8;

      for (const p of allP) {
        try {
          const pd = await api('/book/' + slug + '/page/' + p.slug);
          const pg = pd.page;
          doc.addPage(); y = margin;
          addText(pg.page_num + '. SAYFA', 10, false, [150, 150, 150]);
          addText(pg.title, 16, true, [30, 30, 30]);
          doc.setDrawColor(220, 80, 80);
          doc.line(margin, y, pageW - margin, y);
          y += 6;
          addText(pg.content, 11, false, [40, 40, 40]);
        } catch {}
      }

      doc.save(book.title.replace(/[^a-zA-Z0-9\s]/g, '') + '.pdf');
      toast('PDF indirildi!', 'success');
    } catch (e) { toast('PDF oluşturulamadı: ' + e.message, 'error'); }
  });
}

function pageItemHTML(p, bookSlug) {
  const canEdit = currentUser && !!bookSlug;
  return `<div class="page-item">
    <span class="page-num">${p.page_num}</span>
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

  localStorage.setItem('demlik_book_last_page_' + bookSlug, pageSlug);

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
  document.title = 'Gruplar - Demlik';
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
  document.title = group.name + ' - Demlik';
  const isOwner = currentUser && currentUser.id === group.owner_id;
  const isMod = role === 'moderator';
  const canSend = currentUser && isMember && group.allow_chat;

  // Handle private group access
  if (group.type === 'private' && !isMember && currentUser) {
    if (joinRequestStatus?.status === 'pending') {
      app.innerHTML = `<div class="container page"><div class="empty-state" style="margin-top:60px"><i class="fas fa-clock" style="font-size:48px;color:var(--accent-red);margin-bottom:16px"></i><h2>${escHtml(group.name)}</h2><p style="margin:12px 0">İstek atıldı, yöneticinin onayını bekleniyor...</p><button class="btn btn-outline" onclick="history.back()">Geri</button></div></div>`;
      return;
    }
    if (joinRequestStatus?.status === 'rejected') {
      const reason = joinRequestStatus.rejectionReason || 'Belirtilmedi';
      app.innerHTML = `<div class="container page"><div class="empty-state" style="margin-top:60px"><i class="fas fa-ban" style="font-size:48px;color:var(--accent-red2);margin-bottom:16px"></i><h2>${escHtml(group.name)}</h2><p style="margin:12px 0;color:var(--text-secondary)">Reddedildin</p><p style="font-size:14px;color:var(--text-muted);margin:8px 0">Neden: ${escHtml(reason)}</p><button class="btn btn-primary" id="retry-join-req">Tekrar İstek At</button><button class="btn btn-outline" onclick="history.back()">Geri</button></div></div>`;
      $('#retry-join-req')?.addEventListener('click', async () => {
        try { await api(`/group/${slug}/join-request`, { method: 'POST' }); toast('İstek gönderildi'); renderGroupDetail(app, slug); } catch (e) { toast(e.message, 'error'); }
      });
      return;
    }
    // Show join request prompt
    app.innerHTML = `<div class="container page"><div class="empty-state" style="margin-top:60px"><i class="fas fa-lock" style="font-size:48px;color:var(--accent-red);margin-bottom:16px"></i><h2>${escHtml(group.name)}</h2><p style="margin:12px 0">Bu grup gizli bir gruptur.</p><p style="font-size:14px;color:var(--text-secondary)">Gruba katılmak için yöneticinin onayını istemeniz gerekiyor.</p><button class="btn btn-primary" id="send-join-req">Girme İzni İste</button><button class="btn btn-outline" onclick="history.back()">Geri</button></div></div>`;
    $('#send-join-req')?.addEventListener('click', async () => {
      try { await api(`/group/${slug}/join-request`, { method: 'POST' }); toast('İstek gönderildi'); renderGroupDetail(app, slug); } catch (e) { toast(e.message, 'error'); }
    });
    return;
  }
  
  if (group.type === 'private' && !isMember && !currentUser) {
    app.innerHTML = `<div class="container page"><div class="empty-state" style="margin-top:60px"><i class="fas fa-lock" style="font-size:48px;color:var(--accent-red);margin-bottom:16px"></i><h2>${escHtml(group.name)}</h2><p style="margin:12px 0">Bu grup gizli bir gruptur.</p><p style="font-size:14px;color:var(--text-secondary)">Katılmak için giriş yapmanız gerekiyor.</p><button class="btn btn-primary" onclick="navigate('/giris')">Giriş Yap</button><button class="btn btn-outline" onclick="history.back()">Geri</button></div></div>`;
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
          ${!isMember && currentUser && group.type === 'private' ? `<button class="btn btn-primary" id="join-req-btn"><i class="fas fa-lock"></i> Girme İzni İste</button>` : ''}
          ${isMember && !isOwner ? `<button class="btn btn-outline" id="leave-btn"><i class="fas fa-sign-out-alt"></i> Ayrıl</button>` : ''}
          ${isOwner ? `<button class="btn btn-outline btn-sm" id="group-settings-btn"><i class="fas fa-cog"></i> Ayarlar</button>
            <button class="btn btn-outline btn-sm" id="gen-invite-btn"><i class="fas fa-link"></i> Davet Kodu</button>` : ''}
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
  $('#join-req-btn')?.addEventListener('click', async () => {
    try { await api('/group/' + slug + '/join-request', { method: 'POST' }); toast('Girme izni isteği gönderildi!'); renderRoute(location.pathname); } catch (e) { toast(e.message, 'error'); }
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
      } catch (e) { toast(e.message, 'error'); }
    };
    $('#send-msg-btn')?.addEventListener('click', sendMsg);
    $('#chat-input')?.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); } });
    
    // Paste image support for chat input
    $('#chat-input')?.addEventListener('paste', async e => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const file = items[i].getAsFile();
          if (file) {
            const fd = new FormData(); fd.append('image', file);
            try {
              const r = await apiForm('/group/' + slug + '/upload', fd);
              const msg = await api('/group/' + slug + '/messages', { method: 'POST', body: JSON.stringify({ content: '', image_url: r.url }) });
              $('#chat-messages').insertAdjacentHTML('beforeend', chatMsgHTML(msg, window._chatCanMod));
              const chatEl2 = $('#chat-messages');
              if (chatEl2) chatEl2.scrollTop = chatEl2.scrollHeight;
              toast('Resim gönderildi');
            } catch (err) { toast(err.message, 'error'); }
          }
          break;
        }
      }
    });

    $('#chat-img-input')?.addEventListener('change', async e => {
      const file = e.target.files[0]; if (!file) return;
      const fd = new FormData(); fd.append('image', file);
      try {
        const r = await apiForm('/group/' + slug + '/upload', fd);
        const msg = await api('/group/' + slug + '/messages', { method: 'POST', body: JSON.stringify({ content: '', image_url: r.url }) });
        $('#chat-messages').insertAdjacentHTML('beforeend', chatMsgHTML(msg, window._chatCanMod));
        chatEl.scrollTop = chatEl.scrollHeight;
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
    document.title = 'Videolar – Demlik';
    updatePageMeta('Videolar – Demlik', 'Topluluk videolarını keşfet.', '');
    app.innerHTML = `<div class="container page">
      <div class="video-list-header">
        <div class="page-header-copy">
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
  document.title = video.title + ' – Demlik';
  updatePageMeta(video.title + ' – Demlik', video.description || 'Demlik videoları', video.banner_image || '');
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
            <video controls controlsList="nodownload nodrift" preload="none" playsinline class="video-player" poster="${escHtml(video.banner_image || '')}" id="video-player-el" oncontextmenu="return false;">
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

  const { user, forums, books, groups, videos, songs, level, levels, book_page_count, memberships = [] } = data;
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
  document.title = user.username + ' - Demlik';

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

    let hint = '';
    if (remaining.length > 0) {
      if (reqAny) {
        // "Bunlardan birini tamamlayarak seviye atlayabilirsin"
        hint = `<div style="font-size:12px;color:var(--text-secondary);margin-top:6px;padding:8px 10px;background:rgba(220,38,38,0.06);border-radius:8px;border:1px solid rgba(220,38,38,0.12)">
          <i class="fas fa-info-circle" style="color:var(--accent-red2);margin-right:5px"></i>
          <strong>Şunlardan birini tamamlayarak seviye atlayabilirsin:</strong>
          <ul style="margin:6px 0 0 16px;list-style:disc">
            ${remaining.map(r => `<li style="margin:2px 0">${r}</li>`).join('')}
          </ul>
        </div>`;
      } else {
        hint = `<div style="font-size:11px;color:var(--text-muted);margin-top:4px">${remaining.join(', ')} kaldı</div>`;
      }
    }

    progressHTML = `<div style="margin-top:12px">
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:4px">
        ${escHtml(nextLevel.name)} seviyesine ${overallPct}% tamamlandı
      </div>
      <div class="progress-bar"><div class="progress-fill" style="width:${overallPct}%"></div></div>
      ${hint}
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
  const membershipHTML = isOwn && memberships.length ? `
    <div class="card" style="margin-top:20px">
      <div class="card-header"><span><i class="fas fa-crown" style="color:#fbbf24;margin-right:8px"></i>Aktif Üyeliklerim</span><a href="/magaza" data-link class="btn btn-outline btn-sm">Mağazaya Git</a></div>
      <div class="card-body" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px">
        ${memberships.map(m => {
          const days = Math.max(0, Math.ceil((new Date(m.expires_at) - Date.now()) / 86400000));
          const features = Array.isArray(m.features) ? m.features : [];
          return `<div style="padding:16px;border:1px solid var(--border);border-radius:12px;background:var(--bg2)">
            <div style="display:flex;justify-content:space-between;gap:8px;align-items:center">
              <strong>${escHtml(m.title)}</strong>
              <span class="profile-badge" style="color:${m.product_key === 'vip' ? '#fbbf24' : m.product_key === 'plus' ? '#818cf8' : '#5865F2'}">${escHtml(m.product_key.toUpperCase())}</span>
            </div>
            <div style="font-size:13px;color:var(--text2);margin-top:10px"><i class="fas fa-hourglass-half"></i> ${days} gün kaldı</div>
            <div style="font-size:12px;color:var(--text3);margin-top:4px">Bitiş: ${formatDate(m.expires_at)}</div>
            ${features.length ? `<ul style="margin:10px 0 0 18px;color:var(--text2);font-size:12px">${features.map(f => `<li>${escHtml(f)}</li>`).join('')}</ul>` : ''}
          </div>`;
        }).join('')}
      </div>
    </div>` : '';

  app.innerHTML = `<div class="container page">
    <div class="profile-header">
      <div class="profile-avatar-wrap">
        ${user.avatar ? `<img src="${escHtml(user.avatar)}" class="profile-avatar" alt="" />` : `<div class="profile-avatar-placeholder"><i class="fas fa-user"></i></div>`}
      </div>
      <div class="profile-info">
        <div class="profile-username" ${userNameStyleAttr(user)}>
          ${escHtml(user.username)}${user.is_admin ? ` <i class="fas fa-shield user-admin" title="Demlik Yetkilisi" data-admin-since="${escHtml(user.admin_since || '')}" style="color:#5865F2;cursor:pointer;font-size:18px"></i>` : ''}
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
        <div id="spotify-widget-${escHtml(user.username)}"></div>
      </div>
    </div>
    ${membershipHTML}

    <div class="tabs">
      <button class="tab active" data-tab="forums">Forumlar</button>
      <button class="tab" data-tab="books">Kitaplar</button>
      <button class="tab" data-tab="groups">Gruplar</button>
      <button class="tab" data-tab="videos">Videolar</button>
      <button class="tab" data-tab="saved">Kaydedilenler</button>
      <button class="tab" data-tab="songs">Müzikler</button>
    </div>

    <div id="tab-forums">
      ${forums.length ? `<div style="display:flex;flex-direction:column;gap:12px">${forums.map(f => forumCardHTML(f)).join('')}</div>` : '<div class="empty-state"><i class="fas fa-comments"></i><p>Forum yok.</p></div>'}
    </div>
    <div id="tab-books" class="hidden">
      ${books.length ? `<div class="books-grid">${books.map(b => bookCardHTML(b)).join('')}</div>` : '<div class="empty-state"><i class="fas fa-book"></i><p>Kitap yok.</p></div>'}
    </div>
    <div id="tab-groups" class="hidden">
      ${groups.length ? `<div class="grid-3">${groups.map(g => groupCardHTML(g)).join('')}</div>` : '<div class="empty-state"><i class="fas fa-users"></i><p>Grup yok.</p></div>'}
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

  $$('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      ['forums', 'books', 'groups', 'videos', 'saved', 'songs'].forEach(name => {
        const tab = $('#tab-' + name);
        if (tab) tab.classList.toggle('hidden', name !== btn.dataset.tab);
      });
    });
  });

  // Spotify widget yükle
  renderSpotifyWidget(username, `spotify-widget-${username}`);
}

async function renderStore(app) {
  document.title = 'Mağaza - Demlik';
  updatePageMeta('Mağaza - Demlik', 'VIP, Plus ve Admin üyeliklerini güvenli Shopier ödemesiyle satın alın.', '');
  app.innerHTML = `<div class="container page"><div class="loading-center"><div class="spinner"></div></div></div>`;
  let products = [];
  let memberships = [];
  try {
    products = await api('/store/products');
    if (currentUser) memberships = await api('/store/me');
  } catch (e) {
    app.innerHTML = `<div class="container page"><div class="empty-state"><i class="fas fa-store-slash"></i><p>${escHtml(e.message)}</p></div></div>`;
    return;
  }
  const activeByKey = new Map(memberships.map(m => [m.product_key, m]));
  app.innerHTML = `<div class="container page">
    <div class="page-header" style="display:flex;align-items:end;justify-content:space-between;gap:16px;flex-wrap:wrap">
      <div><div class="page-title"><i class="fas fa-store" style="color:var(--accent-red2);margin-right:8px"></i>Demlik Mağaza</div>
      <div style="color:var(--text2);margin-top:6px">Topluluğunu güçlendiren 30 günlük üyelikler.</div></div>
      ${currentUser ? `<a href="/profil/${escHtml(currentUser.username)}" data-link class="btn btn-outline"><i class="fas fa-user"></i> Profilimde Gör</a>` : ''}
    </div>
    ${!currentUser ? `<div class="card" style="margin-bottom:18px"><div class="card-body"><i class="fas fa-lock" style="color:#fbbf24;margin-right:8px"></i>Satın almak için <a href="/giris" data-link style="color:var(--accent-red2)">giriş yapın</a>.</div></div>` : ''}
    <div class="grid-3" style="gap:18px">
      ${products.map(product => {
        const active = activeByKey.get(product.product_key);
        const features = Array.isArray(product.features) ? product.features : [];
        const accent = product.product_key === 'vip' ? '#fbbf24' : product.product_key === 'plus' ? '#818cf8' : '#5865F2';
        return `<div class="card" style="border-top:3px solid ${accent}">
          <div class="card-body" style="padding:24px">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
              <div class="page-title" style="font-size:20px">${escHtml(product.title)}</div>
              <i class="fas ${product.product_key === 'vip' ? 'fa-gem' : product.product_key === 'plus' ? 'fa-plus-circle' : 'fa-shield-alt'}" style="font-size:24px;color:${accent}"></i>
            </div>
            <p style="color:var(--text2);min-height:48px;margin:12px 0">${escHtml(product.description || '')}</p>
            <div style="display:flex;align-items:baseline;gap:8px;margin:18px 0">
              <strong style="font-size:30px">${Number(product.price).toLocaleString('tr-TR',{minimumFractionDigits:2})} ₺</strong>
              ${product.compare_at_price ? `<del style="color:var(--text3)">${Number(product.compare_at_price).toLocaleString('tr-TR',{minimumFractionDigits:2})} ₺</del>` : ''}
            </div>
            <div style="font-size:12px;color:var(--text3);margin-bottom:12px"><i class="fas fa-calendar-alt"></i> Satın alma tarihinden itibaren 30 gün</div>
            <ul style="margin:0 0 20px 18px;color:var(--text2);min-height:86px">${features.map(f => `<li style="margin:7px 0">${escHtml(f)}</li>`).join('')}</ul>
            ${active ? `<div style="padding:10px;border-radius:8px;background:rgba(34,197,94,.1);color:#86efac;font-size:12px"><i class="fas fa-check-circle"></i> Aktif — ${Math.max(0,Math.ceil((new Date(active.expires_at)-Date.now())/86400000))} gün kaldı</div>` :
              `<button class="btn btn-primary store-buy-btn" data-key="${escHtml(product.product_key)}" style="width:100%;justify-content:center"><i class="fas fa-credit-card"></i> Shopier ile Satın Al</button>`}
          </div>
        </div>`;
      }).join('')}
    </div>
    <div style="margin-top:22px;color:var(--text3);font-size:12px;text-align:center"><i class="fas fa-shield-alt"></i> Ödeme Shopier üzerinde gerçekleşir. Yetki yalnızca doğrulanmış ödeme bildirimi sonrası tanımlanır.</div>
  </div>`;
  $$('.store-buy-btn').forEach(btn => btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Shopier hazırlanıyor...';
    try {
      const checkout = await api('/create-payment-session', { method:'POST', body: JSON.stringify({ product_key: btn.dataset.key }) });
      const win = window.open('', '_blank');
      if (win) {
        win.document.open();
        win.document.write(checkout.checkoutHtml || `<a href="${escHtml(checkout.paymentUrl)}">Shopier ödemesine devam et</a>`);
        win.document.close();
      } else {
        window.location.href = checkout.paymentUrl;
      }
    } catch (e) {
      toast(e.message, 'error');
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-credit-card"></i> Shopier ile Satın Al';
    }
  }));
}

async function renderSettings(app) {
  if (!currentUser) { navigate('/giris'); return; }
  document.title = 'Ayarlar - Demlik';

  app.innerHTML = `<div class="container page">
    <div class="page-header"><div class="page-title">Ayarlar</div></div>
    <div class="settings-layout">
      <div class="settings-nav">
        <div class="settings-nav-item active" data-section="profile"><i class="fas fa-user"></i> Profil</div>
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
          <div class="form-group"><label>Ünvan <span style="color:var(--accent-red2)">*</span></label><input type="text" id="s-title" placeholder="Örn: Yazar, Öğrenci, Mühendis..." value="${escHtml(currentUser.title || '')}" /></div>
          <div class="form-group"><label>Konum (opsiyonel)</label><input type="text" id="s-location" placeholder="Örn: İstanbul, Türkiye" value="${escHtml(currentUser.location || '')}" /></div>
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
    const canColor = currentUser.is_vip || currentUser.is_plus;
    const isPlus = !!currentUser.is_plus;
    const grad = parseNameGradient(currentUser.name_gradient) || { type: 'linear', angle: 135, colors: ['#dc2626', '#f97316', '#eab308'] };
    const gradColors = [...(grad.colors || []), '', '', ''].slice(0, 3);
    el.innerHTML = `
      <div class="appearance-page">
        <div class="appearance-preview-card">
          <div class="appearance-preview-label">Canlı önizleme</div>
          <div class="appearance-preview-body">
            ${currentUser.avatar ? `<img src="${escHtml(currentUser.avatar)}" class="appearance-preview-avatar" alt="" />` : `<div class="appearance-preview-avatar appearance-preview-avatar-ph"><i class="fas fa-user"></i></div>`}
            <div class="appearance-preview-text">
              <div id="appearance-preview-name" class="appearance-preview-username">${escHtml(currentUser.username)}</div>
              <div class="appearance-preview-hint">Forum, yorum ve profilde böyle görünür</div>
            </div>
          </div>
        </div>

        <div class="card appearance-card">
          <div class="card-header"><span><i class="fas fa-id-badge" style="margin-right:8px;color:var(--accent-red2)"></i>Rozet & isim</span></div>
          <div class="card-body appearance-card-body">
            <label class="appearance-toggle">
              <input type="checkbox" id="s-show-badge" ${currentUser.show_level_badge ? 'checked' : ''} />
              <span class="appearance-toggle-ui"></span>
              <span class="appearance-toggle-copy">
                <strong>Seviye rozetini göster</strong>
                <small>Profil ve mesajlarda seviye simgen görünür</small>
              </span>
            </label>
            <label class="appearance-toggle">
              <input type="checkbox" id="s-show-color" ${currentUser.show_level_color ? 'checked' : ''} />
              <span class="appearance-toggle-ui"></span>
              <span class="appearance-toggle-copy">
                <strong>Özel isim rengini göster</strong>
                <small>Kapatırsan seviye rengine dönersin</small>
              </span>
            </label>
          </div>
        </div>

        ${canColor ? `
        <div class="card appearance-card">
          <div class="card-header"><span><i class="fas fa-palette" style="margin-right:8px;color:var(--accent-red2)"></i>İsim rengi</span></div>
          <div class="card-body appearance-card-body">
            <div class="appearance-color-tabs">
              <button type="button" class="appearance-tab ${(currentUser.name_color_mode || 'solid') !== 'gradient' ? 'active' : ''}" data-color-tab="solid">Düz renk</button>
              <button type="button" class="appearance-tab ${currentUser.name_color_mode === 'gradient' ? 'active' : ''}" data-color-tab="gradient" ${isPlus ? '' : 'data-plus-only="1"'}>
                Gradyan ${isPlus ? '' : '<i class="fas fa-plus" style="font-size:10px;margin-left:4px"></i>'}
              </button>
            </div>
            <div id="appearance-solid-panel" class="appearance-panel ${(currentUser.name_color_mode || 'solid') !== 'gradient' ? '' : 'hidden'}">
              <div class="appearance-swatch-row">
                <input type="color" id="s-name-color" value="${escHtml((currentUser.name_color || '#f5f5f5').startsWith('#') ? currentUser.name_color : '#f5f5f5')}" />
                <input type="text" id="s-name-color-hex" value="${escHtml(currentUser.name_color || '#f5f5f5')}" maxlength="7" placeholder="#ffffff" />
              </div>
              <div class="appearance-palette" id="s-color-presets"></div>
            </div>
            <div id="appearance-gradient-panel" class="appearance-panel ${currentUser.name_color_mode === 'gradient' ? '' : 'hidden'}">
              ${isPlus ? `
                <div class="form-group">
                  <label>Gradyan türü</label>
                  <select id="s-grad-type">
                    <option value="linear" ${grad.type === 'linear' ? 'selected' : ''}>Doğrusal (linear)</option>
                    <option value="radial" ${grad.type === 'radial' ? 'selected' : ''}>Dairesel (radial)</option>
                    <option value="conic" ${grad.type === 'conic' ? 'selected' : ''}>Konik (conic)</option>
                  </select>
                </div>
                <div class="form-group" id="s-grad-angle-wrap">
                  <label>Açı <span id="s-grad-angle-val">${grad.angle ?? 135}°</span></label>
                  <input type="range" id="s-grad-angle" min="0" max="360" value="${grad.angle ?? 135}" />
                </div>
                <div class="appearance-grad-colors">
                  ${[0, 1, 2].map(i => `
                    <div class="appearance-grad-stop">
                      <label>Renk ${i + 1}</label>
                      <input type="color" class="s-grad-color" data-idx="${i}" value="${escHtml((gradColors[i] && gradColors[i].startsWith('#')) ? gradColors[i] : ['#dc2626', '#ea580c', '#eab308'][i])}" />
                    </div>`).join('')}
                </div>
                <div class="appearance-grad-preview" id="s-grad-preview"></div>
              ` : `<div class="appearance-plus-lock"><i class="fas fa-lock"></i> Gradyan isim rengi yalnızca <strong>Plus</strong> üyeler içindir.</div>`}
            </div>
          </div>
        </div>` : `
        <div class="card appearance-card">
          <div class="card-body appearance-card-body">
            <div class="appearance-plus-lock"><i class="fas fa-gem"></i> Özel isim rengi <strong>VIP</strong> ve <strong>Plus</strong> üyelerde açılır.</div>
          </div>
        </div>`}

        <div class="appearance-actions">
          <button class="btn btn-primary" id="save-appearance-btn"><i class="fas fa-save"></i> Görünümü kaydet</button>
          <div id="appear-msg" class="form-error mt-4"></div>
        </div>
      </div>`;

    let colorMode = (currentUser.name_color_mode || 'solid') === 'gradient' && isPlus ? 'gradient' : 'solid';

    function updateAppearancePreview() {
      const preview = $('#appearance-preview-name');
      if (!preview) return;
      const showColor = $('#s-show-color')?.checked;
      preview.removeAttribute('style');
      preview.classList.remove('name-gradient-text');
      if (!showColor) return;
      if (colorMode === 'gradient' && isPlus) {
        const type = $('#s-grad-type')?.value || 'linear';
        const angle = parseInt($('#s-grad-angle')?.value || '135', 10);
        const colors = $$('.s-grad-color').map(inp => inp.value).filter(Boolean);
        const css = buildNameGradientCss({ type, angle, colors });
        if (css) {
          preview.style.background = css;
          preview.style.webkitBackgroundClip = 'text';
          preview.style.backgroundClip = 'text';
          preview.style.webkitTextFillColor = 'transparent';
        }
        const prevBox = $('#s-grad-preview');
        if (prevBox && css) prevBox.style.background = css;
      } else {
        const c = $('#s-name-color')?.value || '#f5f5f5';
        preview.style.color = c;
      }
    }

    const presets = ['#f5f5f5', '#fca5a5', '#dc2626', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#a855f7', '#ec4899'];
    const presetEl = $('#s-color-presets');
    if (presetEl) {
      presetEl.innerHTML = presets.map(c => `<button type="button" class="appearance-preset" data-color="${c}" style="background:${c}" title="${c}"></button>`).join('');
      presetEl.addEventListener('click', e => {
        const btn = e.target.closest('.appearance-preset');
        if (!btn) return;
        $('#s-name-color').value = btn.dataset.color;
        $('#s-name-color-hex').value = btn.dataset.color;
        colorMode = 'solid';
        $$('.appearance-tab').forEach(t => t.classList.toggle('active', t.dataset.colorTab === 'solid'));
        $('#appearance-solid-panel')?.classList.remove('hidden');
        $('#appearance-gradient-panel')?.classList.add('hidden');
        updateAppearancePreview();
      });
    }

    $$('.appearance-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        if (tab.dataset.colorTab === 'gradient' && tab.dataset.plusOnly && !isPlus) {
          toast('Gradyan isim rengi yalnızca Plus üyeler için.', 'error');
          return;
        }
        colorMode = tab.dataset.colorTab;
        $$('.appearance-tab').forEach(t => t.classList.toggle('active', t.dataset.colorTab === colorMode));
        $('#appearance-solid-panel')?.classList.toggle('hidden', colorMode !== 'solid');
        $('#appearance-gradient-panel')?.classList.toggle('hidden', colorMode !== 'gradient');
        updateAppearancePreview();
      });
    });

    $('#s-name-color')?.addEventListener('input', e => {
      $('#s-name-color-hex').value = e.target.value;
      colorMode = 'solid';
      updateAppearancePreview();
    });
    $('#s-name-color-hex')?.addEventListener('input', e => {
      if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) $('#s-name-color').value = e.target.value;
      updateAppearancePreview();
    });
    $('#s-show-color')?.addEventListener('change', updateAppearancePreview);
    $('#s-grad-type')?.addEventListener('change', () => {
      const t = $('#s-grad-type')?.value;
      $('#s-grad-angle-wrap')?.classList.toggle('hidden', t === 'radial');
      updateAppearancePreview();
    });
    $('#s-grad-angle')?.addEventListener('input', e => {
      const v = e.target.value;
      const lbl = $('#s-grad-angle-val');
      if (lbl) lbl.textContent = v + '°';
      updateAppearancePreview();
    });
    $$('.s-grad-color').forEach(inp => inp.addEventListener('input', updateAppearancePreview));
    updateAppearancePreview();

    $('#save-appearance-btn').addEventListener('click', async () => {
      const fd = new FormData();
      fd.append('show_level_badge', $('#s-show-badge').checked ? '1' : '0');
      fd.append('show_level_color', $('#s-show-color').checked ? '1' : '0');
      if (canColor) {
        if (colorMode === 'gradient') {
          if (!isPlus) { $('#appear-msg').textContent = 'Gradyan isim rengi yalnızca Plus üyeler içindir.'; return; }
          fd.append('name_color_mode', 'gradient');
          fd.append('name_gradient', JSON.stringify({
            type: $('#s-grad-type')?.value || 'linear',
            angle: parseInt($('#s-grad-angle')?.value || '135', 10),
            colors: $$('.s-grad-color').map(inp => inp.value).filter(Boolean),
          }));
        } else {
          fd.append('name_color_mode', 'solid');
          fd.append('name_color', $('#s-name-color')?.value || '');
          fd.append('name_gradient', '');
        }
      }
      try {
        const updated = await apiForm('/profile', fd, 'PUT');
        currentUser = updated;
        updateNavUI();
        toast('Görünüm güncellendi');
        $('#appear-msg').textContent = '';
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

function renderLogin(app) {
  if (currentUser) { navigate('/'); return; }
  document.title = 'Giriş Yap - Demlik';
  app.innerHTML = `<div class="auth-page">
    <div class="auth-card card card-body">
      <div class="auth-title">Giriş Yap</div>
      <p class="auth-subtitle">Hesabınıza erişin</p>
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
  document.title = 'Kayıt Ol - Demlik';

  app.innerHTML = `<div class="auth-page">
    <div class="auth-card card card-body" id="reg-card">
      <div class="auth-title">Kayıt Ol</div>
      <p class="auth-subtitle">Topluluğa katıl</p>

      <div class="form-group"><label>Kullanıcı Adı</label><input type="text" id="reg-username" placeholder="..." autocomplete="username" /></div>
      <div class="form-group">
        <label style="display:flex;align-items:center;gap:8px">
          E-posta
          <span style="font-size:11px;color:var(--text-muted);font-weight:400;font-style:italic">Sallayabilirsiniz. Zaten umursamıyoruz&nbsp;: )</span>
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
        <label class="checkbox-label">
          <input type="checkbox" id="reg-kvkk" />
          <span>KVKK aydınlatma metnini okudum ve kabul ediyorum.
            <button type="button" class="btn btn-ghost btn-sm" id="kvkk-btn" style="padding:0;color:var(--accent-red2);font-size:13px">Metni oku</button>
          </span>
        </label>
      </div>

      <button class="btn btn-primary" style="width:100%;margin-top:4px" id="reg-btn">Kayıt Ol</button>

      <div id="reg-error" class="form-error mt-4" style="text-align:center"></div>

      <div class="auth-footer">Zaten hesabın var mı? <a href="/giris" data-link class="auth-link">Giriş Yap</a></div>

      <!-- Register overlay -->
      <div id="reg-overlay" class="hidden" style="position:absolute;inset:0;background:rgba(0,0,0,0.55);backdrop-filter: blur(4px);border-radius:var(--radius);display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;z-index:10;pointer-events:auto">
        <div style="width:86px;height:86px;border-radius:50%;background:rgba(220,38,38,0.12);border:1px solid rgba(220,38,38,0.3);display:flex;align-items:center;justify-content:center;box-shadow:0 0 24px rgba(220,38,38,0.18)">
          <div class="spinner" style="width:26px;height:26px;border-width:3px"></div>
        </div>
        <div style="font-weight:800;color:#fff">Kayıt yapılıyor...</div>
        <div style="font-size:12px;color:var(--text-muted);max-width:320px;text-align:center">Lütfen bekleyin</div>
        <div class="reg-progress" style="width:260px;max-width:80vw;height:8px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.08);border-radius:999px;overflow:hidden">
          <div class="reg-progress-fill" style="height:100%;width:0%;background:var(--grad-red);transition:width 0.25s"></div>
        </div>
      </div>
    </div>
  </div>`;

  // Card relative for overlay positioning
  const regCard = $('#reg-card');
  if (regCard) regCard.style.position = 'relative';

  $('#reg-pw-toggle').addEventListener('click', () => {
    const pw = $('#reg-pw');
    const icon = $('#reg-pw-icon');
    if (pw.type === 'password') { pw.type = 'text'; icon.className = 'fas fa-eye-slash'; }
    else { pw.type = 'password'; icon.className = 'fas fa-eye'; }
  });

  $('#kvkk-btn').addEventListener('click', async () => {
    try {
      const r = await api('/kvkk');
      showModal('KVKK Aydınlatma Metni', `<div style="white-space:pre-wrap;font-size:13px;line-height:1.7;color:var(--text-secondary);max-height:400px;overflow-y:auto">${escHtml(r.text)}</div>`);
    } catch {}
  });

  const showRegisterOverlay = () => {
    $('#reg-error').textContent = '';
    $('#reg-overlay')?.classList.remove('hidden');
    const btn = $('#reg-btn');
    if (btn) {
      btn.disabled = true;
      btn.dataset.prevText = btn.innerHTML;
      btn.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px"></div> Bekle...';
    }

    const fill = document.querySelector('#reg-overlay .reg-progress-fill');
    if (fill) {
      fill.style.width = '0%';
      // indeterminate-ish progress
      let pct = 0;
      const start = Date.now();
      const t = setInterval(() => {
        // non-linear growth up to 92%
        const elapsed = Date.now() - start;
        pct = Math.min(92, pct + (0.6 + Math.random() * 1.8));
        const clamped = Math.max(0, Math.min(92, pct));
        fill.style.width = clamped.toFixed(0) + '%';
        if (elapsed > 6500) clearInterval(t);
      }, 160);
      // store for stop
      $('#reg-overlay')._progressTimer = t;
    }
  };

  const hideRegisterOverlay = () => {
    const ov = $('#reg-overlay');
    ov?.classList.add('hidden');
    if (ov?._progressTimer) { clearInterval(ov._progressTimer); ov._progressTimer = null; }
    const btn = $('#reg-btn');
    if (btn) {
      btn.disabled = false;
      if (btn.dataset.prevText) btn.innerHTML = btn.dataset.prevText;
      else btn.innerHTML = 'Kayıt Ol';
      delete btn.dataset.prevText;
    }
  };

  const doRegister = async () => {
    const username = $('#reg-username').value.trim();
    const email = $('#reg-email').value.trim();
    const password = $('#reg-pw').value;
    const kvkk_accepted = $('#reg-kvkk').checked;

    const errEl = $('#reg-error');

    if (!username || !email || !password) { errEl.textContent = 'Tüm alanları doldurun'; return; }
    if (!kvkk_accepted) { errEl.textContent = 'KVKK onayı zorunludur'; return; }

    try {
      showRegisterOverlay();
      const data = await api('/auth/register', { method: 'POST', body: JSON.stringify({ username, email, password, kvkk_accepted }) });

      // success
      const fill = document.querySelector('#reg-overlay .reg-progress-fill');
      if (fill) fill.style.width = '100%';

      currentToken = data.token;
      currentUser = data.user;
      localStorage.setItem('token', currentToken);
      updateNavUI();
      toast('Hoş geldiniz, ' + currentUser.username + '!');
      navigate('/');
    } catch (e) {
      hideRegisterOverlay();
      errEl.textContent = e.message;
    }
  };

  $('#reg-btn').addEventListener('click', doRegister);
  $('#reg-pw').addEventListener('keydown', e => { if (e.key === 'Enter') doRegister(); });
}


function renderNotFound(app) {
  document.title = 'Sayfa Bulunamadı - Demlik';
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

// ===== MESAJLAR SAYFASI =====
async function renderMessages(app, targetUsername) {
  if (!currentUser) { navigate('/giris'); return; }
  document.title = 'Mesajlar - Demlik';
  let convs = [];
  let hiddenConvs = [];
  try { convs = await api('/conversations'); } catch {}
  try { hiddenConvs = await api('/conversations/hidden'); } catch {}

  const sidebarHTML = `
    <div class="dm-sidebar">
      <div class="dm-sidebar-header">
        <span style="font-size:13px;font-weight:700">Mesajlar</span>
        <div style="display:flex;align-items:center;gap:6px">
          <button class="dm-hidden-toggle-btn" id="dm-hidden-toggle-btn" type="button" title="Kilitli mesajlar">•</button>
          <button class="btn btn-outline btn-sm" id="dm-friends-btn" title="Arkadaşlar"><i class="fas fa-user-friends"></i></button>
          <button class="btn btn-outline btn-sm" id="dm-groups-btn" title="Gruplar"><i class="fas fa-users"></i></button>
          <button class="btn btn-primary btn-sm" id="new-dm-btn"><i class="fas fa-edit"></i></button>
        </div>
      </div>
      <div class="dm-search-wrap"><input id="dm-search" type="text" placeholder="Ara..." class="dm-search" /></div>
      <div id="dm-hidden-panel" class="dm-hidden-panel hidden">
        <div class="dm-hidden-panel-content">
          <div class="dm-hidden-panel-header">Kilitli mesajlar</div>
          <div id="dm-hidden-list" class="dm-hidden-list">
            ${hiddenConvs.length ? hiddenConvs.map(c => dmConvItemHTML(c, true)).join('') : `<div class="dm-empty-small">Kilitli konuşma yok</div>`}
          </div>
        </div>
      </div>
      <div id="dm-conv-list" class="dm-conv-list">
        ${convs.map(c => dmConvItemHTML(c)).join('') || `<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:13px">Henüz mesaj yok</div>`}
      </div>
    </div>`;

  app.innerHTML = `<div class="dm-layout${targetUsername && window.innerWidth <= 768 ? ' dm-mobile-chat-open' : ''}">
    ${sidebarHTML}
    <div class="dm-main" id="dm-main">
      ${targetUsername ? '' : `<div class="dm-empty"><i class="fas fa-comments" style="font-size:48px;color:var(--text-muted);margin-bottom:16px"></i><p style="color:var(--text-muted)">Bir konuşma seçin</p></div>`}
    </div>
  </div>`;

  const syncDmMobileView = () => {
    const layout = $('.dm-layout');
    if (!layout) return;
    const isMobile = window.innerWidth <= 768;
    layout.classList.toggle('dm-mobile-chat-open', isMobile && !!targetUsername);
  };
  syncDmMobileView();
  window.removeEventListener('resize', window.__dmMobileViewHandler);
  window.__dmMobileViewHandler = syncDmMobileView;
  window.addEventListener('resize', window.__dmMobileViewHandler);

  $('#dm-search')?.addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    $$('.dm-conv-item').forEach(el => { el.style.display = el.dataset.username.toLowerCase().includes(q) ? '' : 'none'; });
  });

  $('#dm-hidden-toggle-btn')?.addEventListener('click', () => {
    $('#dm-hidden-panel')?.classList.toggle('hidden');
  });

  $$('.dm-conv-item').forEach(el => {
    el.addEventListener('click', () => {
      $$('.dm-conv-item').forEach(x => x.classList.remove('active'));
      el.classList.add('active');
      navigate('/mesajlar/' + el.dataset.username);
    });
  });

  $('#new-dm-btn')?.addEventListener('click', async () => {
    const friends = await api('/friends').catch(() => []);
    const accepted = (friends || []).filter(f => f.status === 'accepted');
    showModal('Yeni Mesaj', `
      <div class="form-group"><label>Kullanıcı adı</label><input id="new-dm-username" type="text" placeholder="kullanici_adi" /></div>
      <div class="form-group">
        <label>Arkadaşlardan seç</label>
        <div id="new-dm-friends" style="max-height:220px;overflow-y:auto;display:flex;flex-direction:column;gap:8px">
          ${accepted.length ? accepted.map(f => {
            const other_username = f.other_username || (f.requester_id === currentUser.id ? (f.addressee_username || f.requester_username) : (f.requester_username || f.addressee_username)) || 'Kullanıcı';
            const avatar = f.other_avatar || (f.requester_id === currentUser.id ? f.addressee_avatar : f.requester_avatar) || '';
            const nameColor = f.other_name_color || '';
            return `<button class="btn btn-ghost" type="button" style="justify-content:flex-start" data-username="${escHtml(other_username)}" data-action="open-dm">
              ${avatar ? `<img src="${escHtml(avatar)}" class="avatar-sm" style="margin-right:8px" />` : `<div class="avatar-sm avatar-placeholder" style="margin-right:8px"><i class="fas fa-user"></i></div>`}
              <span style="${nameColor ? `color:${escHtml(nameColor)}` : ''}">${escHtml(other_username)}</span>
            </button>`;
          }).join('') : '<div style="font-size:13px;color:var(--text-muted)">Henüz arkadaşın yok</div>'}
        </div>
      </div>
      <button class="btn btn-primary" style="width:100%" id="new-dm-go">Mesaja Git</button>
    `);
    $('#new-dm-go').addEventListener('click', () => {
      const u = $('#new-dm-username').value.trim();
      if (!u) return;
      hideModal();
      navigate('/mesajlar/' + u);
    });
    $$('#new-dm-friends button[data-action="open-dm"]').forEach(btn => {
      btn.addEventListener('click', () => {
        hideModal();
        navigate('/mesajlar/' + btn.dataset.username);
      });
    });
  });

  $('#dm-friends-btn')?.addEventListener('click', () => {
    navigate('/arkadaslar');
  });

  $('#dm-groups-btn')?.addEventListener('click', () => {
    navigate('/gruplar');
  });

  if (targetUsername) {
    const activeEl = $(`.dm-conv-item[data-username="${CSS.escape(targetUsername)}"]`);
    if (activeEl) { activeEl.classList.add('active'); }
    await renderDMChat(targetUsername);
  }
}

function dmConvItemHTML(c, isHidden = false) {
  const unread = parseInt(c.unread_count) || 0;
  return `<div class="dm-conv-item${unread > 0 ? ' dm-unread' : ''}" data-username="${escHtml(c.other_username)}">
    ${c.other_avatar ? `<img src="${escHtml(c.other_avatar)}" class="avatar-md" />` : `<div class="avatar-md avatar-placeholder"><i class="fas fa-user"></i></div>`}
    <div class="dm-conv-info">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span class="dm-conv-name" style="${c.other_name_color ? `color:${escHtml(c.other_name_color)}` : ''}">${escHtml(c.other_username)}${isHidden ? '<i class="fas fa-lock dm-conv-lock"></i>' : ''}</span>
        ${unread > 0 ? `<span class="dm-unread-badge">${unread > 9 ? '9+' : unread}</span>` : ''}
      </div>
      <div class="dm-conv-last">${escHtml((c.last_message || '').substring(0, 40))}</div>
    </div>
  </div>`;
}

let dmSelectedIds = new Set();
let dmSelectionMode = false;

async function renderDMChat(username) {
  const mainEl = $('#dm-main');
  if (!mainEl) return;
  mainEl.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%"><div class="spinner"></div></div>`;
  let data;
  try { data = await api(`/conversation/${encodeURIComponent(username)}`); }
  catch (e) { mainEl.innerHTML = `<div class="dm-empty"><p style="color:var(--accent-red2)">${e.message}</p></div>`; return; }

  // Mesajlar okundu → badge'i hemen güncelle
  setTimeout(() => checkUnreadMessages(), 300);
  // Karşı tarafın mesajlarını okundu işaretle
  try { api(`/conversation/${encodeURIComponent(username)}/mark-read`, { method: 'POST' }); } catch {}

  // Sidebar'daki bu konuşmanın unread badge'ini kaldır
  const convItem = $(`.dm-conv-item[data-username="${CSS.escape(username)}"]`);
  if (convItem) {
    convItem.classList.remove('dm-unread');
    const badge = convItem.querySelector('.dm-unread-badge');
    if (badge) badge.remove();
  }

  const { conv, other, messages, isHidden, hasPassword } = data;
  if (isHidden) {
    mainEl.innerHTML = `<div class="dm-chat">
      <div class="dm-chat-header">
        <div style="display:flex;align-items:center;gap:10px">
          <i class="fas fa-lock" style="color:var(--accent-red2)"></i>
          <span style="font-weight:600">${escHtml(other.username)}</span>
        </div>
      </div>
      <div class="dm-empty" style="flex:1">
        <i class="fas fa-lock" style="font-size:36px;color:var(--text-muted);margin-bottom:12px"></i>
        <p style="color:var(--text-muted)">Bu konuşma kilitli</p>
        ${hasPassword ? `<div style="margin-top:16px;display:flex;gap:8px">
          <input id="dm-unlock-pass" type="password" placeholder="Şifre" style="padding:8px 12px;background:var(--bg-card2);border:1px solid var(--border);border-radius:8px;color:var(--text-primary)" />
          <button class="btn btn-primary" id="dm-unlock-btn">Aç</button>
        </div>` : `<button class="btn btn-primary" style="margin-top:12px" id="dm-unlock-btn">Kilidi Aç</button>`}
        <div id="dm-unlock-err" style="color:var(--accent-red2);font-size:12px;margin-top:6px"></div>
      </div>
    </div>`;
    $('#dm-unlock-btn')?.addEventListener('click', async () => {
      const pass = $('#dm-unlock-pass')?.value || '';
      try {
        await api(`/conversation/${encodeURIComponent(username)}/unhide`, { method: 'POST', body: JSON.stringify({ password: pass }) });
        sessionStorage.setItem('dm_unlocked_' + username, '1');
        renderDMChat(username);
      } catch (e) { $('#dm-unlock-err').textContent = e.message; }
    });
    return;
  }

  dmSelectedIds = new Set();
  dmSelectionMode = false;

  mainEl.innerHTML = `<div class="dm-chat">
    <div class="dm-chat-header">
      <div class="dm-chat-user">
        <button class="btn btn-ghost btn-sm dm-mobile-back-btn" id="dm-mobile-back-btn" style="display:none"><i class="fas fa-arrow-left"></i></button>
        ${other.avatar ? `<img src="${escHtml(other.avatar)}" class="avatar-sm" />` : `<div class="avatar-sm avatar-placeholder"><i class="fas fa-user"></i></div>`}
        <div class="dm-chat-user-info">
          <a href="/profil/${escHtml(other.username)}" data-link>${escHtml(other.username)}</a>
          <div class="dm-chat-user-status">${isHidden ? 'Kilitli konuşma' : 'Çevrimiçi'}</div>
        </div>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <div id="dm-sel-actions" style="display:none;gap:6px">
          <button class="btn btn-outline btn-sm" id="dm-sel-delete-me"><i class="fas fa-trash"></i> Benden Sil</button>
          <button class="btn btn-danger btn-sm" id="dm-sel-delete-all"><i class="fas fa-trash-alt"></i> Herkesten Sil</button>
          <button class="btn btn-ghost btn-sm" id="dm-sel-cancel">İptal</button>
        </div>
        <button class="btn btn-ghost btn-sm" id="dm-options-btn"><i class="fas fa-ellipsis-v"></i></button>
      </div>
    </div>
    <div class="dm-messages ig-dm-thread" id="dm-messages">
      ${dmMessagesGroupedHTML(messages, currentUser.id, false)}
    </div>
    <div id="dm-reply-bar" class="dm-reply-bar-hidden" style="padding:6px 14px;background:var(--bg-card2);border-top:1px solid var(--border);font-size:12px;color:var(--text-secondary);align-items:center;justify-content:space-between">
      <span id="dm-reply-text"></span>
      <button onclick="clearReply()" style="background:none;color:var(--text-muted)">✕</button>
    </div>
    <div class="dm-input-bar ig-dm-composer">
      <label class="ig-dm-composer-btn" for="dm-img-input" title="Fotoğraf ekle"><i class="fas fa-image"></i></label>
      <input type="file" id="dm-img-input" accept="image/*" style="display:none" />
      <div id="dm-img-preview" class="ig-dm-img-preview" style="display:none">
        <img id="dm-img-thumb" alt="" />
        <button type="button" onclick="clearDmImg()" aria-label="Kaldır"><i class="fas fa-times"></i></button>
      </div>
      <div class="ig-dm-input-shell">
        <textarea id="dm-input" placeholder="Mesaj..." rows="1"></textarea>
        <button type="button" class="ig-dm-send" id="dm-send-btn" aria-label="Gönder"><i class="fas fa-paper-plane"></i></button>
      </div>
    </div>
  </div>`;

  $('#dm-mobile-back-btn')?.addEventListener('click', () => {
    navigate('/mesajlar');
  });

  const dmMessagesContainer = $('#dm-messages');
  if (dmMessagesContainer) dmMessagesContainer.scrollTop = dmMessagesContainer.scrollHeight;

  // Scroll to bottom
  const msgsEl = $('#dm-messages');
  if (msgsEl) msgsEl.scrollTop = msgsEl.scrollHeight;

  let replyToId = null;
  let pendingImg = null;

  window.clearReply = () => {
    replyToId = null;
    const rb = $('#dm-reply-bar');
    if (rb) { rb.classList.add('dm-reply-bar-hidden'); rb.style.display = ''; $('#dm-reply-text').textContent = ''; }
  };

  window.clearDmImg = () => {
    pendingImg = null;
    const preview = $('#dm-img-preview');
    if (preview) preview.style.display = 'none';
    const input = $('#dm-img-input');
    if (input) input.value = '';
  };

  $('#dm-img-input')?.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    pendingImg = file;
    const reader = new FileReader();
    reader.onload = ev => {
      const thumb = $('#dm-img-thumb');
      const preview = $('#dm-img-preview');
      if (thumb) thumb.src = ev.target.result;
      if (preview) preview.style.display = 'flex';
    };
    reader.readAsDataURL(file);
  });

  let sending = false;
  async function sendDmMessage() {
    if (sending) return;
    const content = $('#dm-input')?.value.trim();
    if (!content && !pendingImg) return;
    sending = true;
    const sendBtn = $('#dm-send-btn');
    if (sendBtn) sendBtn.disabled = true;
    const fd = new FormData();
    if (content) fd.append('content', content);
    if (replyToId) fd.append('reply_to_id', replyToId);
    if (pendingImg) fd.append('image', pendingImg);
    if ($('#dm-input')) $('#dm-input').value = '';
    clearReply();
    clearDmImg();
    try {
      const msg = await apiForm(`/conversation/${encodeURIComponent(username)}/messages`, fd);
      const msgsEl = $('#dm-messages');
      if (msgsEl) {
        msgsEl.insertAdjacentHTML('beforeend', dmMessageHTML(msg, currentUser.id, false, { clusterStart: true, clusterEnd: true, showAvatar: true }));
        msgsEl.scrollTop = msgsEl.scrollHeight;
      }
      const convItem = $(`.dm-conv-item[data-username="${CSS.escape(username)}"]`);
      if (convItem) convItem.querySelector('.dm-conv-last').textContent = content || '📷 Fotoğraf';
    } catch (e) { toast(e.message, 'error'); }
    finally { sending = false; if (sendBtn) sendBtn.disabled = false; }
  }

  $('#dm-send-btn')?.addEventListener('click', sendDmMessage);
  $('#dm-input')?.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendDmMessage(); } });

  // Paste image support for DM
  $('#dm-input')?.addEventListener('paste', async e => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile();
        if (file) {
          const reader = new FileReader();
          reader.onload = async ev => {
            pendingImg = file;
            const thumb = $('#dm-img-thumb');
            const preview = $('#dm-img-preview');
            if (thumb) thumb.src = ev.target.result;
            if (preview) preview.style.display = 'flex';
            toast('Resim yapıştırıldı');
          };
          reader.readAsDataURL(file);
        }
        break;
      }
    }
  });

  // Otomatik büyüyen textarea
  $('#dm-input')?.addEventListener('input', e => {
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
  });

  // Mesaj aksiyonları (üç nokta, seç, yanıtla, sil)
  msgsEl?.addEventListener('click', e => {
    const btn = e.target.closest('.dm-msg-menu-btn');
    if (btn) { showDmMsgMenu(btn, btn.dataset.id, btn.dataset.own === '1', username, replyToId, (id) => { replyToId = id; }); return; }
    const cb = e.target.closest('.dm-msg-cb');
    if (cb) {
      const id = cb.dataset.id;
      if (cb.checked) dmSelectedIds.add(id); else dmSelectedIds.delete(id);
      updateDmSelActions();
    }
  });

  // Options menu
  $('#dm-options-btn')?.addEventListener('click', e => {
    e.stopPropagation();
    showDmOptionsMenu(username, conv.id);
  });

  // Seçim aksiyonları
  $('#dm-sel-cancel')?.addEventListener('click', exitDmSelection);
  $('#dm-sel-delete-me')?.addEventListener('click', async () => {
    if (!dmSelectedIds.size) return;
    try {
      await api('/messages/delete-bulk', { method: 'POST', body: JSON.stringify({ ids: [...dmSelectedIds], mode: 'me' }) });
      exitDmSelection();
      renderDMChat(username);
    } catch (e) { toast(e.message, 'error'); }
  });
  $('#dm-sel-delete-all')?.addEventListener('click', async () => {
    if (!dmSelectedIds.size) return;
    try {
      await api('/messages/delete-bulk', { method: 'POST', body: JSON.stringify({ ids: [...dmSelectedIds], mode: 'all' }) });
      exitDmSelection();
      renderDMChat(username);
    } catch (e) { toast(e.message, 'error'); }
  });
}

function exitDmSelection() {
  dmSelectionMode = false;
  dmSelectedIds = new Set();
  $$('.dm-msg-cb-wrap').forEach(el => el.style.display = 'none');
  $$('.dm-msg-cb').forEach(el => el.checked = false);
  const sa = $('#dm-sel-actions');
  if (sa) sa.style.display = 'none';
}

function updateDmSelActions() {
  const sa = $('#dm-sel-actions');
  if (sa) sa.style.display = dmSelectedIds.size > 0 ? 'flex' : 'none';
}

function dmMessagesGroupedHTML(messages, myId, selMode) {
  const parts = [];
  const gapMs = 5 * 60 * 1000;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const prev = messages[i - 1];
    const next = messages[i + 1];
    const curTime = new Date(m.created_at).getTime();
    const prevTime = prev ? new Date(prev.created_at).getTime() : 0;
    const nextTime = next ? new Date(next.created_at).getTime() : 0;
    const samePrev = prev && prev.sender_id === m.sender_id && (curTime - prevTime) < gapMs;
    const sameNext = next && next.sender_id === m.sender_id && (nextTime - curTime) < gapMs;
    parts.push(dmMessageHTML(m, myId, selMode, {
      clusterStart: !samePrev,
      clusterEnd: !sameNext,
      showAvatar: m.sender_id != myId && !sameNext,
    }));
  }
  return parts.join('');
}

function dmMessageHTML(m, myId, selMode, cluster = {}) {
  const { clusterStart = true, clusterEnd = true, showAvatar = true } = cluster;
  const isOwn = m.sender_id == myId;
  const deleted = m.deleted_for_all;
  const hiddenForMe = isOwn ? m.deleted_by_sender : m.deleted_by_receiver;
  if (hiddenForMe && !deleted) return '';

  const bubbleMods = [
    clusterStart ? 'ig-bubble-start' : 'ig-bubble-mid',
    clusterEnd ? 'ig-bubble-end' : 'ig-bubble-mid',
    deleted ? 'dm-deleted' : '',
  ].filter(Boolean).join(' ');

  return `<div class="dm-msg-wrap ig-dm-row ${isOwn ? 'dm-own ig-dm-own' : 'ig-dm-other'} ${clusterStart ? 'ig-cluster-start' : ''} ${clusterEnd ? 'ig-cluster-end' : ''}" data-id="${m.id}">
    <div class="dm-msg-cb-wrap" style="display:${selMode ? 'flex' : 'none'};align-items:center">
      <input type="checkbox" class="dm-msg-cb" data-id="${m.id}" ${dmSelectedIds.has(String(m.id)) ? 'checked' : ''} />
    </div>
    ${!isOwn ? `<div class="ig-dm-avatar-slot">${showAvatar ? (m.sender_avatar ? `<img src="${escHtml(m.sender_avatar)}" class="avatar-sm ig-dm-avatar" alt="" />` : `<div class="avatar-sm avatar-placeholder ig-dm-avatar"><i class="fas fa-user"></i></div>`) : ''}</div>` : ''}
    <div class="dm-msg-content ig-dm-content">
      ${m.reply_to_id && m.reply_content ? `<div class="dm-reply-preview ig-dm-reply"><span class="ig-dm-reply-user">${escHtml(m.reply_username || '')}</span><div class="ig-dm-reply-text">${escHtml((m.reply_content||'').substring(0, 80))}</div></div>` : ''}
      ${deleted ? `<div class="dm-msg-bubble ig-dm-bubble ${bubbleMods}"><i class="fas fa-ban"></i> Mesaj silindi</div>`
        : `<div class="dm-msg-bubble ig-dm-bubble ${bubbleMods}">
            ${m.image_url ? `<img src="${escHtml(m.image_url)}" class="ig-dm-image" alt="" onclick="window.open('${escHtml(m.image_url)}','_blank')" />` : ''}
            ${m.shared_forum_id ? `<div class="dm-shared-forum ig-dm-share-card" onclick="navigate('/forum/${escHtml(m.forum_slug)}')">
              ${m.forum_banner ? `<img src="${escHtml(m.forum_banner)}" alt="" />` : ''}
              <div class="ig-dm-share-body"><div class="ig-dm-share-title">${escHtml(m.forum_title||'')}</div><div class="ig-dm-share-link">Forum</div></div>
            </div>` : ''}
            ${m.shared_video_id ? `<div class="dm-shared-forum ig-dm-share-card" onclick="navigate('/video/${escHtml(m.video_slug)}')">
              ${m.video_banner ? `<img src="${escHtml(m.video_banner)}" alt="" />` : ''}
              <div class="ig-dm-share-body"><div class="ig-dm-share-title">${escHtml(m.video_title||'Video')}</div><div class="ig-dm-share-link">Video</div></div>
            </div>` : ''}
            ${m.content ? `<span class="ig-dm-text">${escHtml(m.content)}</span>` : ''}
          </div>`}
      ${clusterEnd ? `<div class="dm-msg-meta ig-dm-meta">
        <span>${timeAgo(m.created_at)}</span>
        ${isOwn && !deleted ? `<span class="ig-dm-read">${m.read_at ? '<i class="fas fa-check-double" title="Okundu"></i>' : '<i class="fas fa-check" title="Gönderildi"></i>'}</span>` : ''}
        <button type="button" class="dm-msg-menu-btn" data-id="${m.id}" data-own="${isOwn ? 1 : 0}"><i class="fas fa-ellipsis-h"></i></button>
      </div>` : ''}
    </div>
  </div>`;
}

function showDmMsgMenu(btn, msgId, isOwn, username, replyToId, setReply) {
  const existing = $('#dm-msg-ctx');
  if (existing) existing.remove();
  const rect = btn.getBoundingClientRect();
  const menu = document.createElement('div');
  menu.id = 'dm-msg-ctx';
  menu.style.cssText = `position:fixed;left:${rect.left - 120}px;top:${rect.bottom + 4}px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:8px;z-index:9999;min-width:160px;box-shadow:0 8px 24px rgba(0,0,0,0.5);overflow:hidden`;
  const items = [
    { label: '<i class="fas fa-reply"></i> Yanıtla', action: 'reply' },
    { label: '<i class="fas fa-check-square"></i> Seç', action: 'select' },
    { label: '<i class="fas fa-trash"></i> Benden Sil', action: 'delete-me' },
    ...(isOwn ? [{ label: '<i class="fas fa-trash-alt"></i> Herkesten Sil', action: 'delete-all', danger: true }] : []),
  ];
  items.forEach(item => {
    const el = document.createElement('div');
    el.innerHTML = item.label;
    el.style.cssText = `padding:8px 14px;font-size:13px;cursor:pointer;color:${item.danger ? 'var(--accent-red2)' : 'var(--text-secondary)'};display:flex;align-items:center;gap:8px`;
    el.addEventListener('mouseenter', () => el.style.background = 'var(--bg-hover)');
    el.addEventListener('mouseleave', () => el.style.background = '');
    el.addEventListener('click', async () => {
      menu.remove();
      if (item.action === 'reply') {
        const msgEl = $(`.dm-msg-wrap[data-id="${msgId}"]`);
        const content = msgEl?.querySelector('.dm-msg-bubble span')?.textContent || '';
        setReply(msgId);
        const rb = $('#dm-reply-bar');
        const rt = $('#dm-reply-text');
        if (rb && rt) { rb.classList.remove('dm-reply-bar-hidden'); rb.style.display = 'flex'; rt.textContent = content.substring(0, 60); }
      } else if (item.action === 'select') {
        dmSelectionMode = true;
        dmSelectedIds.add(String(msgId));
        $$('.dm-msg-cb-wrap').forEach(el => el.style.display = 'flex');
        const cb = $(`.dm-msg-cb[data-id="${msgId}"]`);
        if (cb) cb.checked = true;
        updateDmSelActions();
      } else if (item.action === 'delete-me') {
        try { await api(`/messages/${msgId}`, { method: 'DELETE', body: JSON.stringify({ mode: 'me' }) }); renderDMChat(username); } catch (e) { toast(e.message, 'error'); }
      } else if (item.action === 'delete-all') {
        try { await api(`/messages/${msgId}`, { method: 'DELETE', body: JSON.stringify({ mode: 'all' }) }); renderDMChat(username); } catch (e) { toast(e.message, 'error'); }
      }
    });
    menu.appendChild(el);
  });
  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener('click', function rm() { menu.remove(); document.removeEventListener('click', rm); }), 0);
}

// Mesaj üç noktası hover göster
document.addEventListener('mouseover', e => {
  const wrap = e.target.closest('.dm-msg-wrap');
  if (wrap) { const btn = wrap.querySelector('.dm-msg-menu-btn'); if (btn) btn.style.opacity = '1'; }
});
document.addEventListener('mouseout', e => {
  const wrap = e.target.closest('.dm-msg-wrap');
  if (wrap) { const btn = wrap.querySelector('.dm-msg-menu-btn'); if (btn) btn.style.opacity = '0'; }
});

function showDmOptionsMenu(username, convId) {
  showModal('Konuşma Seçenekleri', `
    <div style="display:flex;flex-direction:column;gap:8px">
      <button class="btn btn-outline" id="dm-opt-hide"><i class="fas fa-lock"></i> Gizle / Kilitle</button>
      <button class="btn btn-outline" id="dm-opt-setpass"><i class="fas fa-key"></i> Şifre Değiştir</button>
      <button class="btn btn-danger" id="dm-opt-delete"><i class="fas fa-trash"></i> Konuşmayı Sil</button>
    </div>
  `);
  $('#dm-opt-hide').addEventListener('click', () => {
    hideModal();
    showModal('Konuşmayı Gizle', `
      <p style="font-size:13px;color:var(--text-secondary);margin-bottom:12px">Şifre koyarsanız açmak için şifre gerekecek.</p>
      <div class="form-group"><label>Şifre (opsiyonel)</label><input id="dm-hide-pass" type="password" placeholder="Şifresiz bırakmak için boş bırakın" /></div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-primary" id="dm-hide-confirm" style="flex:1">Gizle</button>
        <button class="btn btn-outline" onclick="hideModal()" style="flex:1">İptal</button>
      </div>
    `);
    $('#dm-hide-confirm').addEventListener('click', async () => {
      const pass = $('#dm-hide-pass').value;
      try { await api(`/conversation/${encodeURIComponent(username)}/hide`, { method: 'POST', body: JSON.stringify({ password: pass }) }); hideModal(); navigate('/mesajlar'); toast('Konuşma gizlendi'); } catch (e) { toast(e.message, 'error'); }
    });
  });
  $('#dm-opt-setpass').addEventListener('click', () => {
    hideModal();
    showModal('Şifre Değiştir', `
      <div class="form-group"><label>Yeni Şifre (boş = şifresiz)</label><input id="dm-newpass" type="password" /></div>
      <button class="btn btn-primary" style="width:100%" id="dm-setpass-confirm">Kaydet</button>
    `);
    $('#dm-setpass-confirm').addEventListener('click', async () => {
      const pass = $('#dm-newpass').value;
      try { await api(`/conversation/${encodeURIComponent(username)}/set-password`, { method: 'POST', body: JSON.stringify({ password: pass }) }); hideModal(); toast('Şifre güncellendi'); } catch (e) { toast(e.message, 'error'); }
    });
  });
  $('#dm-opt-delete').addEventListener('click', async () => {
    if (!confirm('Konuşma silinsin mi?')) return;
    try { await api(`/conversation/${encodeURIComponent(username)}`, { method: 'DELETE' }); hideModal(); navigate('/mesajlar'); toast('Konuşma silindi'); } catch (e) { toast(e.message, 'error'); }
  });
}

// ===== ARKADAŞLAR SAYFASI =====
async function renderFriends(app) {
  if (!currentUser) { navigate('/giris'); return; }
  document.title = 'Arkadaşlar - Demlik';
  let friends = [];
  try { friends = await api('/friends'); } catch {}
  let blocks = [];
  try { blocks = await api('/blocks'); } catch {}

  const pending_in = friends.filter(f => f.status === 'pending' && f.addressee_id == currentUser.id);
  const pending_out = friends.filter(f => f.status === 'pending' && f.requester_id == currentUser.id);
  const accepted = friends.filter(f => f.status === 'accepted');

  app.innerHTML = `<div class="container page">
    <div class="page-header"><div class="page-title"><i class="fas fa-user-friends" style="color:var(--accent-red)"></i> Arkadaşlar</div></div>
    <div style="display:grid;grid-template-columns:${window.innerWidth <= 768 ? '1fr' : '1fr 1fr'};gap:24px">
      <div>
        <div class="tabs" style="margin-bottom:16px">
          <button class="tab active" id="tab-friends" onclick="showFriendsTab('friends')">Arkadaşlar (${accepted.length})</button>
          <button class="tab" id="tab-requests" onclick="showFriendsTab('requests')">İstekler ${pending_in.length > 0 ? `<span style="background:var(--accent-red);color:#fff;font-size:10px;padding:1px 5px;border-radius:10px;margin-left:4px">${pending_in.length}</span>` : ''}</button>
          <button class="tab" id="tab-sent" onclick="showFriendsTab('sent')">Gönderilenler (${pending_out.length})</button>
          <button class="tab" id="tab-blocked" onclick="showFriendsTab('blocked')">Engellenenler (${blocks.length})</button>
        </div>
        <div id="friends-content">
          <div id="tab-content-friends">
            ${accepted.length === 0 ? '<div class="empty-state"><i class="fas fa-user-friends"></i><p>Henüz arkadaşın yok</p></div>'
              : accepted.map(f => friendItemHTML(f, 'accepted', currentUser.id)).join('')}
          </div>
          <div id="tab-content-requests" style="display:none">
            ${pending_in.length === 0 ? '<div class="empty-state"><i class="fas fa-inbox"></i><p>Gelen istek yok</p></div>'
              : pending_in.map(f => friendItemHTML(f, 'incoming', currentUser.id)).join('')}
          </div>
          <div id="tab-content-sent" style="display:none">
            ${pending_out.length === 0 ? '<div class="empty-state"><i class="fas fa-paper-plane"></i><p>Gönderilen istek yok</p></div>'
              : pending_out.map(f => friendItemHTML(f, 'outgoing', currentUser.id)).join('')}
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
      res.innerHTML = users.map(u => `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
        ${u.avatar ? `<img src="${escHtml(u.avatar)}" class="avatar-sm" />` : `<div class="avatar-sm avatar-placeholder"><i class="fas fa-user"></i></div>`}
        <a href="/profil/${escHtml(u.username)}" data-link style="flex:1;color:var(--text-primary);font-size:14px">${escHtml(u.username)}</a>
        <button class="btn btn-primary btn-sm send-req-btn" data-username="${escHtml(u.username)}"><i class="fas fa-user-plus"></i></button>
      </div>`).join('');
      $$('.send-req-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          try { await api(`/friends/request/${encodeURIComponent(btn.dataset.username)}`, { method: 'POST' }); btn.textContent = '✓ Gönderildi'; btn.disabled = true; btn.classList.remove('btn-primary'); } catch (e) { toast(e.message, 'error'); }
        });
      });
    } catch (e) { res.innerHTML = `<p style="color:var(--accent-red2);font-size:13px">${e.message}</p>`; }
  }

  // Arkadaş aksiyonları
  app.addEventListener('click', async e => {
    const accept = e.target.closest('.friend-accept');
    const reject = e.target.closest('.friend-reject');
    const remove = e.target.closest('.friend-remove');
    const unblock = e.target.closest('.friend-unblock');
    const msgBtn = e.target.closest('.friend-msg');
    if (accept) { e.stopPropagation(); try { await api(`/friends/respond/${accept.dataset.id}`, { method: 'POST', body: JSON.stringify({ action: 'accept' }) }); renderFriends(app); } catch (e) { toast(e.message,'error'); } }
    if (reject) { e.stopPropagation(); try { await api(`/friends/respond/${reject.dataset.id}`, { method: 'POST', body: JSON.stringify({ action: 'reject' }) }); renderFriends(app); } catch (e) { toast(e.message,'error'); } }
    if (remove) { e.stopPropagation(); if (!confirm('Arkadaşlıktan çıkart?')) return; try { await api(`/friends/${remove.dataset.id}`, { method: 'DELETE' }); renderFriends(app); } catch (e) { toast(e.message,'error'); } }
    if (unblock) { e.stopPropagation(); try { await api(`/block/${unblock.dataset.username}`, { method: 'DELETE' }); renderFriends(app); } catch (e) { toast(e.message,'error'); } }
    if (msgBtn) { e.stopPropagation(); navigate('/mesajlar/' + msgBtn.dataset.username); }
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
  return `<div class="card card-body friend-card" style="margin-bottom:8px;display:flex;align-items:center;gap:10px;${type === 'accepted' ? 'cursor:pointer;' : ''}" ${type === 'accepted' ? `onclick="navigate('/mesajlar/${escHtml(other_username)}')"` : ''}>
    ${other_avatar ? `<img src="${escHtml(other_avatar)}" class="avatar-md" />` : `<div class="avatar-md avatar-placeholder"><i class="fas fa-user"></i></div>`}
    <div style="flex:1">
      <a href="/profil/${escHtml(other_username)}" data-link style="font-weight:600;font-size:14px;color:var(--text-primary)">${escHtml(other_username)}</a>
      ${type === 'outgoing' ? `<div style="font-size:11px;color:var(--text-muted)"><i class="fas fa-clock"></i> Beklemede</div>` : ''}
      ${type === 'incoming' ? `<div style="font-size:11px;color:var(--accent-red2)"><i class="fas fa-user-plus"></i> Arkadaşlık isteği gönderdi</div>` : ''}
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;flex-shrink:0;min-width:0">
      ${type === 'accepted' ? `<button class="btn btn-outline btn-sm friend-msg" data-username="${escHtml(other_username)}"><i class="fas fa-envelope"></i></button>` : ''}
      ${type === 'incoming' ? `<button class="btn btn-primary btn-sm friend-accept" data-id="${f.id}" style="white-space:nowrap"><i class="fas fa-check"></i> Kabul</button><button class="btn btn-danger btn-sm friend-reject" data-id="${f.id}" style="white-space:nowrap"><i class="fas fa-times"></i> Reddet</button>` : ''}
      ${type === 'accepted' || type === 'outgoing' ? `<button class="btn btn-ghost btn-sm friend-remove" data-id="${f.id}" title="${type === 'outgoing' ? 'İptal' : 'Sil'}"><i class="fas fa-user-minus"></i></button>` : ''}
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

// ===== FLOATING DM WIDGET =====
(function() {
  let fdmOpen = false;
  let fdmUsername = null;
  let fdmMinimized = false;
  let fdmSending = false;
  let fdmReplyId = null;
  let fdmPendingImg = null;

  function fdm$$(sel) { return document.querySelectorAll(sel); }
  function fdm$(sel) { return document.querySelector(sel); }

  function getContainer() { return fdm$('#floating-dm'); }

  function renderToggleBtn() {
    const container = getContainer();
    if (!container) return;
    if (!currentUser) { container.style.display = 'none'; return; }
    container.style.display = 'flex';
    if (!fdm$('#fdm-toggle')) {
      const btn = document.createElement('button');
      btn.id = 'fdm-toggle';
      btn.className = 'fdm-toggle-btn';
      btn.innerHTML = '<i class="fas fa-comments"></i>';
      btn.title = 'Mesajlar';
      btn.addEventListener('click', () => {
        if (fdmOpen) closeFdm();
        else openFdmList();
      });
      document.body.appendChild(btn);
    }
  }

  function closeFdm() {
    fdmOpen = false;
    fdmUsername = null;
    const container = getContainer();
    if (container) container.innerHTML = '';
  }

  async function openFdmList() {
    fdmOpen = true;
    fdmUsername = null;
    const container = getContainer();
    if (!container) return;
    let convs = [];
    try { convs = await api('/conversations'); } catch {}
    container.innerHTML = `<div class="fdm-bubble">
      <div class="fdm-header" id="fdm-header-list">
        <i class="fas fa-comments" style="color:var(--accent-red);font-size:14px"></i>
        <span class="fdm-name">Mesajlar</span>
        <div class="fdm-actions">
          <button id="fdm-new" title="Yeni mesaj"><i class="fas fa-edit"></i></button>
          <button id="fdm-close" title="Kapat"><i class="fas fa-times"></i></button>
        </div>
      </div>
      <div class="fdm-messages" id="fdm-list" style="padding:0">
        ${convs.length === 0
          ? '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:13px">Henüz mesaj yok</div>'
          : convs.map(c => `<div class="fdm-conv-row" data-username="${escHtml(c.other_username)}" style="display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.03);transition:background 0.15s" onmouseover="this.style.background='var(--bg-hover)'" onmouseout="this.style.background=''">
            ${c.other_avatar ? `<img src="${escHtml(c.other_avatar)}" class="fdm-avatar" />` : `<div class="fdm-avatar avatar-placeholder"><i class="fas fa-user" style="font-size:11px"></i></div>`}
            <div style="flex:1;min-width:0">
              <div style="font-size:13px;font-weight:600;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(c.other_username)}</div>
              <div style="font-size:11px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml((c.last_message||'').substring(0,30))}</div>
            </div>
            ${parseInt(c.unread_count) > 0 ? `<span style="background:var(--accent-red);color:#fff;font-size:10px;padding:1px 5px;border-radius:10px">${c.unread_count}</span>` : ''}
          </div>`).join('')}
      </div>
    </div>`;

    fdm$('#fdm-close')?.addEventListener('click', closeFdm);
    fdm$('#fdm-new')?.addEventListener('click', () => {
      const u = prompt('Kullanıcı adı:');
      if (u) openFdmChat(u.trim());
    });
    fdm$$('.fdm-conv-row').forEach(el => {
      el.addEventListener('click', () => openFdmChat(el.dataset.username));
    });
  }

  async function openFdmChat(username) {
    fdmUsername = username;
    fdmMinimized = false;
    const container = getContainer();
    if (!container) return;
    container.innerHTML = `<div class="fdm-bubble" id="fdm-bubble">
      <div class="fdm-header" id="fdm-header-chat">
        <div class="fdm-avatar avatar-placeholder" id="fdm-other-avatar"><i class="fas fa-user" style="font-size:11px"></i></div>
        <span class="fdm-name" id="fdm-other-name">${escHtml(username)}</span>
        <div class="fdm-actions">
          <button id="fdm-minimize" title="Küçült"><i class="fas fa-minus"></i></button>
          <button id="fdm-back" title="Geri"><i class="fas fa-arrow-left"></i></button>
          <button id="fdm-fullscreen" title="Tam ekran"><i class="fas fa-expand"></i></button>
          <button id="fdm-close" title="Kapat"><i class="fas fa-times"></i></button>
        </div>
      </div>
      <div class="fdm-messages" id="fdm-msgs"><div style="text-align:center;padding:20px"><div class="spinner"></div></div></div>
      <div class="fdm-input-bar">
        <textarea id="fdm-input" placeholder="Mesaj..." rows="1"></textarea>
        <button class="btn btn-primary btn-sm" id="fdm-send"><i class="fas fa-paper-plane"></i></button>
      </div>
    </div>`;

    fdm$('#fdm-close')?.addEventListener('click', closeFdm);
    fdm$('#fdm-back')?.addEventListener('click', openFdmList);
    fdm$('#fdm-fullscreen')?.addEventListener('click', () => { navigate('/mesajlar/' + username); closeFdm(); });
    fdm$('#fdm-minimize')?.addEventListener('click', () => {
      fdmMinimized = !fdmMinimized;
      const bubble = fdm$('#fdm-bubble');
      if (bubble) bubble.classList.toggle('minimized', fdmMinimized);
      const icon = fdm$('#fdm-minimize i');
      if (icon) icon.className = fdmMinimized ? 'fas fa-chevron-up' : 'fas fa-minus';
    });
    fdm$('#fdm-header-chat')?.addEventListener('click', e => {
      if (e.target.closest('.fdm-actions')) return;
      fdmMinimized = !fdmMinimized;
      const bubble = fdm$('#fdm-bubble');
      if (bubble) bubble.classList.toggle('minimized', fdmMinimized);
    });

    // Mesajları yükle
    try {
      const data = await api(`/conversation/${encodeURIComponent(username)}`);
      const { other, messages } = data;
      if (other.avatar) {
        const av = fdm$('#fdm-other-avatar');
        if (av) av.outerHTML = `<img src="${escHtml(other.avatar)}" class="fdm-avatar" id="fdm-other-avatar" />`;
      }
      const msgsEl = fdm$('#fdm-msgs');
      if (msgsEl) {
        msgsEl.innerHTML = messages.map(m => fdmMsgHTML(m)).join('');
        msgsEl.scrollTop = msgsEl.scrollHeight;
      }
    } catch (e) {
      const msgsEl = fdm$('#fdm-msgs');
      if (msgsEl) msgsEl.innerHTML = `<div style="color:var(--accent-red2);font-size:12px;padding:12px">${e.message}</div>`;
    }

    async function fdmSendMsg() {
      if (fdmSending) return;
      const input = fdm$('#fdm-input');
      const content = input?.value.trim();
      if (!content) return;
      fdmSending = true;
      input.value = '';
      try {
        const fd = new FormData();
        fd.append('content', content);
        const msg = await apiForm(`/conversation/${encodeURIComponent(username)}/messages`, fd);
        const msgsEl = fdm$('#fdm-msgs');
        if (msgsEl) {
          msgsEl.insertAdjacentHTML('beforeend', fdmMsgHTML(msg));
          msgsEl.scrollTop = msgsEl.scrollHeight;
        }
      } catch (e) { toast(e.message, 'error'); }
      finally { fdmSending = false; }
    }

    fdm$('#fdm-send')?.addEventListener('click', fdmSendMsg);
    fdm$('#fdm-input')?.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); fdmSendMsg(); }
    });
    fdm$('#fdm-input')?.addEventListener('input', e => {
      e.target.style.height = 'auto';
      e.target.style.height = Math.min(e.target.scrollHeight, 80) + 'px';
    });
  }

  function fdmMsgHTML(m) {
    const isOwn = currentUser && m.sender_id == currentUser.id;
    const deleted = m.deleted_for_all;
    if (!deleted && ((isOwn && m.deleted_by_sender) || (!isOwn && m.deleted_by_receiver))) return '';
    return `<div style="display:flex;flex-direction:column;align-items:${isOwn ? 'flex-end' : 'flex-start'};gap:2px;margin-bottom:4px">
      <div style="max-width:80%;padding:7px 11px;border-radius:${isOwn ? '12px 4px 12px 12px' : '4px 12px 12px 12px'};font-size:13px;word-break:break-word;
        background:${isOwn ? 'rgba(220,38,38,0.15)' : 'var(--bg-card2)'};
        border:1px solid ${isOwn ? 'rgba(220,38,38,0.3)' : 'var(--border)'};
        color:${deleted ? 'var(--text-muted)' : 'var(--text-primary)'}">
        ${deleted ? '<i>Mesaj silindi</i>' : (m.shared_forum_id ? `<span style="color:var(--accent-red2);cursor:pointer" onclick="navigate('/forum/${escHtml(m.forum_slug||'')}');closeFdm()">📎 ${escHtml(m.forum_title||'Forum')}</span>` : escHtml(m.content || ''))}
      </div>
      <span style="font-size:10px;color:var(--text-muted)">${timeAgo(m.created_at)}</span>
    </div>`;
  }

  // Auth değişince toggle butonunu güncelle
  const origUpdateNav = window.updateNavUI;
  window.updateNavUI = function() {
    if (origUpdateNav) origUpdateNav.apply(this, arguments);
    setTimeout(renderToggleBtn, 100);
  };

  // İlk yüklemede
  setTimeout(renderToggleBtn, 500);

  // Dışarıya aç
  window.openFdmChat = openFdmChat;
  window.closeFdm = closeFdm;
})();

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
  popup.innerHTML = `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><i class="fas fa-shield" style="color:#5865F2;font-size:16px"></i><span style="font-weight:700;color:#e0e0ff;font-size:14px">Demlik Yetkilisi</span></div><div style="font-size:13px;font-weight:600;color:#c0c8ff;margin-bottom:4px">Demlik yetkili hesabı.</div><div style="font-size:12px;color:#8888aa">Bu kullanıcı ${sinceText} tarihinde yetkili oldu.</div>`;
  const rect = shield.getBoundingClientRect();
  document.body.appendChild(popup);
  const pw = popup.offsetWidth, ph = popup.offsetHeight;
  let left = rect.left, top = rect.bottom + 8;
  if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
  if (top + ph > window.innerHeight - 8) top = rect.top - ph - 8;
  popup.style.left = left + 'px';
  popup.style.top = top + 'px';
});

// ===== SPOTİFY PROFİL WIDGET =====
async function renderSpotifyWidget(username, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  try {
    const data = await fetch('/api/spotify/now-playing/' + encodeURIComponent(username)).then(r => r.json());
    if (!data.playing) { container.innerHTML = ''; return; }

    const fmtTime = ms => {
      const s = Math.floor(ms / 1000);
      return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    };
    const progress = data.duration_ms > 0 ? Math.min(100, (data.progress_ms / data.duration_ms) * 100) : 0;
    const progressTime = fmtTime(data.progress_ms || 0);
    const totalTime = fmtTime(data.duration_ms || 0);

    container.innerHTML = `<div style="background:rgba(30,215,96,0.08);border:1px solid rgba(30,215,96,0.25);border-radius:10px;padding:10px 14px;margin-top:12px;cursor:pointer" onclick="window.open('${escHtml(data.url)}','_blank')">
      <div style="display:flex;align-items:center;gap:10px">
        <img src="${escHtml(data.album_art)}" style="width:44px;height:44px;border-radius:6px;object-fit:cover;flex-shrink:0" />
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px">
            <i class="fab fa-spotify" style="color:#1ED760;font-size:13px"></i>
            <span style="font-size:10px;color:#1ED760;font-weight:600;text-transform:uppercase;letter-spacing:0.5px">Şu an dinliyor</span>
          </div>
          <div style="font-size:13px;font-weight:600;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(data.title)}</div>
          <div style="font-size:11px;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(data.artist)}</div>
        </div>
      </div>
      ${data.duration_ms > 0 ? `
      <div style="margin-top:8px">
        <div style="background:rgba(255,255,255,0.1);border-radius:99px;height:3px;overflow:hidden">
          <div style="height:100%;width:${progress.toFixed(1)}%;background:#1ED760;border-radius:99px;transition:width 1s linear"></div>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:3px">
          <span style="font-size:10px;color:var(--text-muted)">${progressTime}</span>
          <span style="font-size:10px;color:var(--text-muted)">${totalTime}</span>
        </div>
      </div>` : ''}
    </div>`;
  } catch {}
}

// ===== MÜZİK LİSTESİ =====
async function renderMusicList(app) {
  document.title = 'Müzikler – Demlik';
  app.innerHTML = `<div class="container page">
    <div class="page-header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:20px">
      <div class="page-title" style="display:flex;align-items:center;gap:10px">
        <i class="fas fa-music" style="color:var(--accent-red2)"></i> Müzikler
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
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
  const loadSongs = async (q = '') => {
    const el = document.getElementById('music-list');
    if (!el) return;
    el.innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';
    try {
      const url = q ? `/songs?q=${encodeURIComponent(q)}` : '/songs';
      songs = await api(url);
      if (!songs.length) { el.innerHTML = '<div class="empty-state"><i class="fas fa-music"></i><p>Henüz şarkı yok.</p></div>'; return; }
      el.innerHTML = `<div class="music-table">
        <div class="music-table-header">
          <div style="width:40px">#</div>
          <div style="flex:1">Başlık</div>
          <div style="width:160px;display:none" class="col-dist">Dağıtıcı</div>
          <div style="width:120px">Eklenme</div>
          <div style="width:80px;text-align:right">Dinlenme</div>
        </div>
        ${songs.map((s, i) => `
          <div class="music-row" data-slug="${escHtml(s.slug)}">
            <div class="music-num">${i+1}</div>
            <div class="music-info">
              <div class="music-cover-wrap">
                ${s.cover_url ? `<img src="${escHtml(s.cover_url)}" class="music-cover" />` : `<div class="music-cover music-cover-ph"><i class="fas fa-music"></i></div>`}
                <button class="music-play-mini" data-slug="${escHtml(s.slug)}" data-audio="${escHtml(s.audio_url)}"><i class="fas fa-play"></i></button>
              </div>
              <div>
                <div class="music-title">${escHtml(s.title)}</div>
                <div class="music-artist">${escHtml(s.artist_name)}</div>
              </div>
            </div>
            <div class="music-dist col-dist">${escHtml(s.distributor||'-')}</div>
            <div class="music-date">${timeAgo(s.published_at)}</div>
            <div class="music-plays" style="text-align:right;font-size:12px;color:var(--text-muted)">${s.play_count} <i class="fas fa-headphones" style="font-size:10px"></i></div>
          </div>`).join('')}
      </div>`;
      el.querySelectorAll('.music-row').forEach(row => {
        row.addEventListener('click', e => {
          if (!e.target.closest('.music-play-mini')) navigate('/muzik/' + row.dataset.slug);
        });
      });
      el.querySelectorAll('.music-play-mini').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          openMiniPlayer(btn.dataset.audio, btn.dataset.slug, songs.find(s => s.slug === btn.dataset.slug));
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

function openMiniPlayer(audioUrl, slug, song) {
  // Global player
  let player = document.getElementById('global-music-player');
  if (!player) {
    player = document.createElement('div');
    player.id = 'global-music-player';
    document.body.appendChild(player);
  }
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
  // Update play buttons
  document.querySelectorAll('.music-play-mini').forEach(b => b.innerHTML = '<i class="fas fa-play"></i>');
  const audio = new Audio(audioUrl);
  currentAudio = audio; currentSlug = slug;
  fetch('/api/songs/' + slug + '/play', { method: 'POST' }).catch(() => {});

  const title = song?.title || '', artist = song?.artist_name || '', cover = song?.cover_url || '';
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
        <button class="gplayer-btn" id="gp-prev" title="Önceki"><i class="fas fa-step-backward"></i></button>
        <button class="gplayer-btn gplayer-play" id="gp-play"><i class="fas fa-pause"></i></button>
        <button class="gplayer-btn" id="gp-next" title="Sonraki"><i class="fas fa-step-forward"></i></button>
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
        ${demlikVolumeControlHTML('gp')}
      </div>
      <button class="gplayer-close" id="gp-close"><i class="fas fa-times"></i></button>
    </div>`;
  player.style.display = 'block';
  // localStorage'dan ses seviyesini oku
  const savedVol = parseFloat(localStorage.getItem('demlik_volume') ?? '0.8');
  audio.volume = savedVol;

  function fmtTime(s) { const m=Math.floor(s/60); return m+':'+(Math.floor(s%60)+'').padStart(2,'0'); }

  audio.addEventListener('loadedmetadata', () => { document.getElementById('gp-dur').textContent = fmtTime(audio.duration); });
  audio.addEventListener('timeupdate', () => {
    const pct = audio.duration ? (audio.currentTime/audio.duration)*100 : 0;
    const fill = document.getElementById('gp-fill'); if(fill) fill.style.width = pct+'%';
    const seek = document.getElementById('gp-seek'); if(seek) seek.value = pct;
    const cur = document.getElementById('gp-cur'); if(cur) cur.textContent = fmtTime(audio.currentTime);
  });
  audio.addEventListener('ended', () => { const pb=document.getElementById('gp-play'); if(pb) pb.innerHTML='<i class="fas fa-play"></i>'; });

  document.getElementById('gp-play').addEventListener('click', () => {
    if (audio.paused) { audio.play(); document.getElementById('gp-play').innerHTML='<i class="fas fa-pause"></i>'; }
    else { audio.pause(); document.getElementById('gp-play').innerHTML='<i class="fas fa-play"></i>'; }
  });
  document.getElementById('gp-seek').addEventListener('input', e => {
    if (audio.duration) audio.currentTime = (parseFloat(e.target.value)/100)*audio.duration;
  });
  document.getElementById('gp-close').addEventListener('click', () => {
    audio.pause(); currentAudio=null; player.style.display='none';
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
      localStorage.setItem('demlik_volume', v / 100);
      updateVolIcon(v);
    });
  }
  if (volBtn) {
    volBtn.addEventListener('click', () => {
      if (audio.volume > 0) {
        audio.volume = 0; if(volSlider) volSlider.value = 0;
        localStorage.setItem('demlik_volume', '0');
        volBtn.innerHTML = '<i class="fas fa-volume-mute"></i>';
      } else {
        audio.volume = 0.8; if(volSlider) volSlider.value = 80;
        localStorage.setItem('demlik_volume', '0.8');
        volBtn.innerHTML = '<i class="fas fa-volume-up"></i>';
      }
    });
  }

  // Sync play button on detail page
  const detailPlay = document.getElementById('detail-play-btn');
  if (detailPlay) detailPlay.innerHTML = '<i class="fas fa-pause"></i> Durdur';

  audio.play().catch(() => {});
}

function demlikVolumeControlHTML(prefix) {
  return `<div class="demlik-volume" data-vol-root="${prefix}">
    <button type="button" class="demlik-volume-trigger" id="${prefix}-vol-btn" title="Ses"><i class="fas fa-volume-up"></i></button>
    <div class="demlik-volume-panel" id="${prefix}-vol-panel">
      <input type="range" class="demlik-volume-slider" id="${prefix}-vol" min="0" max="100" value="80" step="1" aria-label="Ses seviyesi" />
      <span class="demlik-volume-label" id="${prefix}-vol-label">80%</span>
    </div>
  </div>`;
}

function initDemlikVolume(audio, prefix) {
  if (!audio) return;
  const savedVol = parseFloat(localStorage.getItem('demlik_volume') ?? '0.8');
  audio.volume = savedVol;
  const btn = document.getElementById(`${prefix}-vol-btn`);
  const panel = document.getElementById(`${prefix}-vol-panel`);
  const slider = document.getElementById(`${prefix}-vol`);
  const label = document.getElementById(`${prefix}-vol-label`);
  if (!slider) return;
  const sync = (v) => {
    audio.volume = v / 100;
    localStorage.setItem('demlik_volume', String(v / 100));
    if (label) label.textContent = `${v}%`;
    slider.style.setProperty('--vol', `${v}%`);
    if (btn) {
      btn.innerHTML = v === 0 ? '<i class="fas fa-volume-mute"></i>' : v < 35 ? '<i class="fas fa-volume-down"></i>' : '<i class="fas fa-volume-up"></i>';
    }
  };
  sync(Math.round(savedVol * 100));
  slider.addEventListener('input', e => sync(parseInt(e.target.value, 10)));
  btn?.addEventListener('click', e => {
    e.stopPropagation();
    panel?.classList.toggle('open');
  });
  document.addEventListener('click', e => {
    if (!e.target.closest(`[data-vol-root="${prefix}"]`)) panel?.classList.remove('open');
  });
}

async function renderMusicDetail(app, slug) {
  app.innerHTML = '<div class="container page"><div class="loading-center"><div class="spinner"></div></div></div>';
  let song;
  try { song = await api('/songs/' + slug); } catch {
    app.innerHTML = '<div class="container page"><div class="empty-state"><i class="fas fa-music"></i><p>Şarkı bulunamadı.</p></div></div>'; return;
  }
  document.title = `${song.title} – ${song.artist_name} | Demlik`;
  const isOwn = song.song_type === 'own';
  const hasLyrics = !!song.lyrics?.trim();
  const isUploader = currentUser && currentUser.id === song.uploader_id;

  app.innerHTML = `<div class="container page">
    <div class="music-detail-header">
      <div class="music-detail-cover-wrap">
        ${song.cover_url
          ? `<img src="${escHtml(song.cover_url)}" class="music-detail-cover" />`
          : `<div class="music-detail-cover music-detail-cover-ph"><i class="fas fa-music"></i></div>`}
      </div>
      <div class="music-detail-info">
        <div class="music-detail-heading-block">
          <div class="music-detail-type-badge">${isOwn ? '<i class="fas fa-microphone"></i> Sanatçı Şarkısı' : '<i class="fas fa-share"></i> Paylaşılan Şarkı'}</div>
          <div class="music-detail-title">${escHtml(song.title)}</div>
          <div class="music-detail-artist">${escHtml(song.artist_name)}</div>
          ${isUploader ? `<button type="button" class="btn btn-outline btn-sm music-detail-edit-btn" id="song-edit-btn" style="position:absolute;top:0;right:0"><i class="fas fa-edit"></i> Düzenle</button>` : ''}
        </div>
        <div class="music-detail-meta">
          ${song.genre ? `<span><i class="fas fa-tag"></i> ${escHtml(song.genre)}</span>` : ''}
          ${song.distributor ? `<span><i class="fas fa-building"></i> ${escHtml(song.distributor)}</span>` : ''}
          <span><i class="fas fa-headphones"></i> ${song.play_count} dinlenme</span>
          <span><i class="fas fa-calendar"></i> ${formatDate(song.published_at)}</span>
        </div>
        <div class="music-player-box" id="music-player-box">
          <audio id="detail-audio" src="${escHtml(song.audio_url)}" preload="metadata"></audio>
          <div class="music-player-controls">
            <button type="button" class="music-play-btn" id="detail-play-btn"><i class="fas fa-play"></i> Oynat</button>
            ${demlikVolumeControlHTML('detail')}
          </div>
          <div class="music-progress-wrap">
            <span class="music-time" id="dp-cur">0:00</span>
            <div class="music-bar-bg">
              <div class="music-bar-fill" id="dp-fill"></div>
              <input type="range" class="music-seek" id="dp-seek" min="0" max="100" value="0" step="0.1" />
            </div>
            <span class="music-time" id="dp-dur">0:00</span>
          </div>
        </div>
        ${!isOwn && song.share_reason ? `
          <div class="music-share-reason">
            <div class="music-share-reason-label"><i class="fas fa-question-circle"></i> Neden paylaştınız?</div>
            <div class="music-share-reason-text">Cevap: ${escHtml(song.share_reason)}</div>
          </div>` : ''}
      </div>
    </div>
    ${hasLyrics ? `
      <div class="music-lyrics-box">
        <div class="music-lyrics-title"><i class="fas fa-align-left"></i> Şarkı Sözleri</div>
        <div class="music-lyrics-text">${escHtml(song.lyrics)}</div>
      </div>` : ''}
  </div>`;

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
  audio.addEventListener('ended', () => { playBtn.innerHTML = '<i class="fas fa-play"></i> Oynat'; });

  let halfCounted = false;
  playBtn.addEventListener('click', () => {
    if (audio.paused) {
      audio.play();
      playBtn.innerHTML = '<i class="fas fa-pause"></i> Durdur';
    } else {
      audio.pause();
      playBtn.innerHTML = '<i class="fas fa-play"></i> Oynat';
    }
  });

  audio.addEventListener('timeupdate', () => {
    if (!halfCounted && audio.duration && (audio.currentTime / audio.duration) >= 0.5) {
      halfCounted = true;
      fetch('/api/songs/'+slug+'/play-half', {method:'POST'}).catch(()=>{});
    }
  });

  seek?.addEventListener('input', e => { if(audio.duration) audio.currentTime=(parseFloat(e.target.value)/100)*audio.duration; });

  initDemlikVolume(audio, 'detail');

  // Şarkı düzenleme butonu (sadece yükleyene gösterilir)
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
  document.title = 'Artist Başvurusu – Demlik';
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
          Artist rozeti alarak kendi şarkılarınızı Demlik'te yayınlayabilirsiniz.
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
  document.title = 'Artist Panel – Demlik';

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
            <label class="checkbox-label" style="flex:1;padding:12px;background:var(--bg-card2);border:1px solid var(--border);border-radius:8px;cursor:pointer">
              <input type="radio" name="song-type" id="st-other" value="other" style="width:auto" /> Başkasının Şarkısı
            </label>
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
  // Artist olanlar kendi panelini kullansın
  if (currentUser.is_artist) { navigate('/artist-panel'); return; }
  document.title = 'Şarkı Paylaş – Demlik';

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
