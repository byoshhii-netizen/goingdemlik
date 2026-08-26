// ===== TEMA RENGİ SİSTEMİ =====
function applyThemeColor(hex) {
  if (!hex || !/^#[0-9A-Fa-f]{6}$/.test(hex)) return;
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  const l = (v) => Math.min(255, Math.round(v * 1.28));
  const d = (v) => Math.max(0, Math.round(v * 0.6));
  const toHex = (v) => v.toString(16).padStart(2,'0');
  const hex2 = '#' + toHex(l(r)) + toHex(l(g)) + toHex(l(b));
  const hexDark = '#' + toHex(d(r)) + toHex(d(g)) + toHex(d(b));
  const root = document.documentElement.style;
  root.setProperty('--red', hex);
  root.setProperty('--red2', hex2);
  root.setProperty('--red-glow', `rgba(${r},${g},${b},0.25)`);
  root.setProperty('--border-red', `rgba(${r},${g},${b},0.2)`);
  root.setProperty('--theme-hex', hex);
  root.setProperty('--theme-dark', hexDark);
  window.__themeColor = hex;
  // Btn-primary arka planlarını güncelle
  document.querySelectorAll('.btn-primary').forEach(el => {
    el.style.background = `linear-gradient(135deg, ${hex}, ${hexDark})`;
  });
}

// ===== BADGES (ROZETLER) =====
async function renderBadges(main) {
  let badges = [];
  try { badges = await adminApi('/badges'); } catch (e) { /* ignore */ }
  let users = [];
  try { users = await adminApi('/users'); } catch (e) { users = []; }

  main.innerHTML = `
    <div class="adm-section-header">
      <div class="adm-section-title"><div class="icon-pill"><i class="fas fa-award"></i></div> Rozetler <span style="font-size:13px;font-weight:400;color:var(--text2)">(${badges.length})</span></div>
      <div><button class="btn btn-primary" id="adm-badges-refresh">Yenile</button></div>
    </div>
    <div class="card" style="margin-bottom:16px;padding:16px">
      <div style="display:flex;gap:12px;align-items:center">
        <input id="new-badge-name" placeholder="Rozet adı (ör: Katılımcı)" />
        <input id="new-badge-icon" placeholder="ikon (fas fa-award) veya URL" />
        <input id="new-badge-color" type="color" value="#6b7280" style="height:38px" />
        <button class="btn btn-primary" id="create-badge">Oluştur</button>
      </div>
    </div>
    <div class="card">
      <div class="card-header"><span>Mevcut Rozetler</span></div>
      <div class="card-body" id="badges-list">
        ${badges.length ? badges.map(b => `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px;border-bottom:1px solid var(--border)"><div><strong style="margin-right:8px;color:${escHtml(b.color||'#6b7280')}">${escHtml(b.name)}</strong> ${b.icon ? `<span style="margin-left:6px">${escHtml(b.icon)}</span>` : ''}</div><div style="display:flex;gap:8px"><button class="btn btn-outline btn-sm assign-badge" data-id="${escHtml(b.id)}">Kullanıcıya Ver</button><button class="btn btn-danger btn-sm delete-badge" data-id="${escHtml(b.id)}">Sil</button></div></div>`).join('') : '<div style="padding:12px;color:var(--text-muted)">Rozet yok</div>'}
      </div>
    </div>
    <div class="card" style="margin-top:16px">
      <div class="card-header"><span>Kullanıcılara Rozet Ver</span></div>
      <div class="card-body">
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
          <select id="badge-select">${badges.map(b=>`<option value="${escHtml(b.id)}">${escHtml(b.name)}</option>`).join('')}</select>
          <select id="user-select">${users.map(u=>`<option value="${u.id}">${escHtml(u.username)}</option>`).join('')}</select>
          <button class="btn btn-primary" id="assign-badge-btn">Ver</button>
        </div>
        <div id="badge-assign-msg" style="color:var(--text-muted)"></div>
      </div>
    </div>
  `;

  $('#adm-badges-refresh')?.addEventListener('click', () => loadSection('badges'));
  $('#create-badge')?.addEventListener('click', async () => {
    const name = $('#new-badge-name').value.trim(); const icon = $('#new-badge-icon').value.trim(); const color = $('#new-badge-color').value;
    if (!name) return toast('Rozet adı gerekli','error');
    try { await adminApi('/badges', { method: 'POST', body: JSON.stringify({ name, icon, color }) }); toast('Rozet oluşturuldu'); loadSection('badges'); } catch (e) { toast(e.message,'error'); }
  });
  $('#badges-list')?.addEventListener('click', async e => {
    const del = e.target.closest('.delete-badge');
    const assign = e.target.closest('.assign-badge');
    if (del) { if (!confirm('Rozeti silmek istediğinize emin misiniz?')) return; try { await adminApi('/badges/' + del.dataset.id, { method: 'DELETE' }); toast('Silindi'); loadSection('badges'); } catch (e) { toast(e.message,'error'); } }
    if (assign) {
      const bId = assign.dataset.id; const sel = $('#user-select'); if (!sel) return; const uid = sel.value; try {
        const b = badges.find(x=>String(x.id)===String(bId)); if (!b) return toast('Rozet bulunamadı','error');
        await adminApi('/user/' + uid, { method: 'PUT', body: JSON.stringify({ badge_name: b.name, badge_icon: b.icon, badge_color: b.color }) });
        toast('Rozet verildi');
      } catch (e) { toast(e.message,'error'); }
    }
  });

  $('#assign-badge-btn')?.addEventListener('click', async () => {
    const bid = $('#badge-select').value; const uid = $('#user-select').value; if (!bid || !uid) return;
    try { const b = badges.find(x=>String(x.id)===String(bid)); await adminApi('/user/' + uid, { method: 'PUT', body: JSON.stringify({ badge_name: b.name, badge_icon: b.icon, badge_color: b.color }) }); $('#badge-assign-msg').textContent = 'Rozet verildi'; } catch (e) { $('#badge-assign-msg').textContent = e.message; }
  });
}

// ===== CIGCIG ADMIN PANEL =====
let adminToken = sessionStorage.getItem('admin_token') || '';
let adminProfile = JSON.parse(sessionStorage.getItem('admin_profile') || 'null');
let currentSection = 'dashboard';

function $(s) { return document.querySelector(s); }
function $$(s) { return document.querySelectorAll(s); }

function toast(msg, type = 'success') {
  const c = $('#toast-container');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<i class="fas fa-${type === 'success' ? 'check-circle' : 'exclamation-circle'}"></i><span>${msg}</span>`;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function hasPermission(name) {
  const value = adminProfile?.permissions?.[name];
  return value === true || value === 1 || value === '1' || value === 'true';
}

function timeAgo(dt) {
  if (!dt) return '-';
  const now = new Date(), d = new Date(dt);
  const sec = Math.floor((now - d) / 1000);
  if (sec < 60) return 'az önce';
  if (sec < 3600) return Math.floor(sec / 60) + ' dk önce';
  if (sec < 86400) return Math.floor(sec / 3600) + ' sa önce';
  return d.toLocaleDateString('tr-TR');
}

function formatDate(dt) {
  if (!dt) return '-';
  return new Date(dt).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

async function adminApi(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', 'X-Admin-Token': adminToken, ...(options.headers || {}) };
  const res = await fetch('/api/admin' + path, { ...options, headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Hata');
  return data;
}

function showModal(title, bodyHTML) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = bodyHTML;
  $('#modal-overlay').classList.remove('hidden');
}
function hideModal() { $('#modal-overlay').classList.add('hidden'); }

$('#modal-close').addEventListener('click', hideModal);
$('#modal-overlay').addEventListener('click', e => { if (e.target === $('#modal-overlay')) hideModal(); });

// ===== AUTH =====
if (adminToken) {
  fetch('/api/admin/me', { headers: { 'X-Admin-Token': adminToken } })
    .then(response => { if (!response.ok) throw new Error('Geçersiz oturum'); showPanel(); })
    .catch(() => { adminToken = ''; adminProfile = null; sessionStorage.removeItem('admin_token'); sessionStorage.removeItem('admin_profile'); });
}
$('#admin-login-btn').addEventListener('click', tryLogin);
$('#admin-username-input').addEventListener('keydown', e => { if (e.key === 'Enter') tryLogin(); });
$('#admin-pw-input').addEventListener('keydown', e => { if (e.key === 'Enter') tryLogin(); });

async function tryLogin() {
  const username = $('#admin-username-input').value.trim();
  const pw = $('#admin-pw-input').value;
  if (!username || !pw) return;
  try {
    const response = await fetch('/api/admin/auth/login', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ username, password:pw }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Giriş başarısız');
    adminToken = result.token;
    adminProfile = result;
    sessionStorage.setItem('admin_token', adminToken);
    sessionStorage.setItem('admin_profile', JSON.stringify(result));
    showPanel();
  } catch (error) {
    adminToken = ''; sessionStorage.removeItem('admin_token');
    $('#admin-login-err').textContent = error.message;
  }
}

function showPanel() {
  $('#login-screen').style.display = 'none';
  $('#admin-panel').classList.add('visible');
  loadTopbarStats();
  setupNav();
  applyAuthorityNav();
  loadSection('dashboard');
}

function applyAuthorityNav() {
  if (!adminProfile || adminProfile.is_super_admin) return;
  const p = adminProfile.permissions || {};
  const visible = new Set(['dashboard']);
  if (hasPermission('can_view_users')) visible.add('users');
  if (hasPermission('can_view_logs')) visible.add('logs');
  if (hasPermission('can_suspend_content') || hasPermission('can_view_stories')) visible.add('stories');
  if (hasPermission('can_suspend_content') || hasPermission('can_view_reals')) visible.add('videos');
  if (hasPermission('can_suspend_content')) { visible.add('photos'); visible.add('forums'); visible.add('books'); }
  if (hasPermission('can_view_groups')) visible.add('groups');
  if (hasPermission('can_view_levels')) visible.add('levels');
  if (hasPermission('can_view_store')) visible.add('shop');
  if (hasPermission('can_review_artists')) visible.add('artist-apps');
  if (hasPermission('can_assign_badges')) visible.add('badges');
  $$('.adm-nav-item').forEach(item => { item.style.display = visible.has(item.dataset.section) ? '' : 'none'; });
}

$('#admin-logout-btn').addEventListener('click', () => {
  adminToken = ''; sessionStorage.removeItem('admin_token');
  location.reload();
});

function setupNav() {
  $$('.adm-nav-item').forEach(item => {
    item.addEventListener('click', () => {
      $$('.adm-nav-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      loadSection(item.dataset.section);
    });
  });
}

async function loadTopbarStats() {
  try {
    const users = await adminApi('/users');
    const forums = await adminApi('/forums');
    const el = $('#adm-topbar-stats');
    if (el) el.innerHTML = `
      <span><i class="fas fa-users" style="color:#5865F2;margin-right:4px"></i>${users.length} üye</span>
      <span><i class="fas fa-comments" style="color:#dc2626;margin-right:4px"></i>${forums.length} konu</span>`;
  } catch {}
}

function loadSection(section) {
  currentSection = section;
  const main = $('#admin-main');
  main.innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';
  const map = {
    dashboard: renderDashboard, users: renderUsers,
    forums: renderForums, books: renderBooks, videos: renderVideos, photos: renderAdminPhotos, stories: renderAdminStories, 'ad-submissions': renderAdSubmissions, 'video-ads': renderVideoAds, 'music-ads': renderMusicAds, groups: renderGroups, artists: renderArtists,
    levels: renderLevels, tags: renderTags, logs: renderLogs, 'route-logs': renderRouteLogs, 'authority-logs': renderAuthorityLogs,
    settings: renderSettings, messages: renderAdminMessages,
    announcements: renderAnnouncements,
    songs: renderAdminSongs, 'artist-apps': renderArtistApps,
    'shop': renderShop,
    'shop-orders': renderShopOrders,
    'shop-settings': renderShopSettings
    , badges: renderBadges
    , 'homepage-sections': renderHomepageSections
  };
  if (map[section]) map[section](main);
}

async function renderAdminStories(main) {
  let stories = [];
  try { stories = await adminApi('/stories'); } catch (error) { main.innerHTML = `<div class="form-error">${escHtml(error.message)}</div>`; return; }
  main.innerHTML = `<div class="adm-section-header"><div class="adm-section-title"><div class="icon-pill"><i class="fas fa-circle-play"></i></div> Hikayeler <span style="font-size:13px;font-weight:400;color:var(--text2)">(${stories.length})</span></div></div><div class="card"><div style="overflow:auto"><table class="adm-table"><thead><tr><th>Medya</th><th>Sahip</th><th>Durum</th><th>Süre</th><th>Görüntülenme</th><th>Beğeni</th><th>Tarih</th><th>İşlemler</th></tr></thead><tbody>${stories.map(story => `<tr><td><a href="/hikaye/${escHtml(story.public_id || story.id)}" target="_blank"><img src="${escHtml(story.media_url)}" style="width:64px;height:82px;object-fit:contain;background:#000;border-radius:6px" /></a></td><td>${story.avatar ? `<img src="${escHtml(story.avatar)}" style="width:28px;height:28px;border-radius:50%;object-fit:cover;vertical-align:middle;margin-right:5px" />` : ''}${escHtml(story.username)}</td><td>${story.is_suspended ? '<span class="badge badge-red">Askıda</span>' : (new Date(story.expires_at) < new Date() ? '<span class="badge">Süresi doldu</span>' : '<span class="badge badge-green">Aktif</span>')}</td><td>${story.duration_hours} saat</td><td>${story.total_views || 0} toplam / ${story.unique_viewers || 0} kişi</td><td>${story.like_count || 0}</td><td>${formatDate(story.created_at)}</td><td><div style="display:flex;gap:5px;flex-wrap:wrap"><button class="btn btn-outline btn-xs story-admin-viewers" data-id="${escHtml(story.public_id || story.id)}">Görenler</button><button class="btn btn-outline btn-xs story-admin-edit" data-id="${escHtml(story.public_id || story.id)}">Düzenle</button><button class="btn ${story.is_suspended ? 'btn-primary' : 'btn-outline'} btn-xs story-admin-suspend" data-id="${escHtml(story.public_id || story.id)}" data-suspended="${story.is_suspended ? '1' : '0'}">${story.is_suspended ? 'Aktifleştir' : 'Askıya al'}</button><button class="btn btn-danger btn-xs story-admin-delete" data-id="${escHtml(story.public_id || story.id)}">Sil</button></div></td></tr>`).join('')}</tbody></table></div></div>`;
  main.querySelectorAll('.story-admin-viewers').forEach(button => button.onclick = async () => { try { const viewers = await adminApi('/stories/' + button.dataset.id + '/viewers'); showModal('Hikaye görüntüleyenleri', viewers.length ? `<div class="story-viewer-list">${viewers.map(viewer => `<div class="story-viewer-row">${viewer.avatar ? `<img src="${escHtml(viewer.avatar)}" class="avatar-sm" />` : '<div class="avatar-sm avatar-placeholder"><i class="fas fa-user"></i></div>'}<span><b>${escHtml(viewer.username)}</b><small>${viewer.view_count} kez · ${formatDate(viewer.viewed_at)}</small></span></div>`).join('')}</div>` : '<div class="empty-state">Henüz görüntüleyen yok.</div>'); } catch (error) { toast(error.message, 'error'); } });
  main.querySelectorAll('.story-admin-edit').forEach(button => button.onclick = async () => { const story = stories.find(item => String(item.public_id || item.id) === button.dataset.id); if (!story) return; showModal('Hikayeyi düzenle', `<div class="form-group"><label>Açıklama</label><textarea id="adm-story-caption">${escHtml(story.caption || '')}</textarea></div><div class="form-group"><label>Süre (saat)</label><input id="adm-story-duration" type="number" min="1" max="720" step="1" value="${Number(story.duration_hours) || 24}" /><small style="display:block;margin-top:5px;color:var(--text-muted)">1-720 saat arasında istediğin süreyi yazabilirsin.</small></div><button class="btn btn-primary" id="adm-story-save">Kaydet</button>`); $('#adm-story-save').onclick = async () => { const duration = Number($('#adm-story-duration').value); if (!Number.isInteger(duration) || duration < 1 || duration > 720) return toast('Süre 1-720 saat arasında tam sayı olmalı.', 'error'); try { await adminApi('/stories/' + button.dataset.id, { method: 'PUT', body: JSON.stringify({ caption: $('#adm-story-caption').value, duration_hours: duration }) }); hideModal(); toast('Hikaye güncellendi'); renderAdminStories(main); } catch (error) { toast(error.message, 'error'); } }; });
  main.querySelectorAll('.story-admin-suspend').forEach(button => button.onclick = async () => { await adminApi('/stories/' + button.dataset.id, { method: 'PUT', body: JSON.stringify({ is_suspended: button.dataset.suspended !== '1' }) }); toast(button.dataset.suspended === '1' ? 'Hikaye aktifleştirildi' : 'Hikaye askıya alındı'); renderAdminStories(main); });
  main.querySelectorAll('.story-admin-delete').forEach(button => button.onclick = async () => { if (!confirm('Hikaye ve ilişkili görüntülemeler silinsin mi?')) return; await adminApi('/stories/' + button.dataset.id, { method: 'DELETE' }); toast('Hikaye silindi'); renderAdminStories(main); });
}

// ===== HOMEPAGE SECTIONS =====
async function renderAdminPhotos(main) {
  const photos = await adminApi('/photos');
  main.innerHTML = `<div class="adm-section-header"><div class="adm-section-title">Fotoğraflar</div></div><div class="card"><table class="adm-table"><thead><tr><th>Fotoğraf</th><th>Sahip</th><th>Açıklama</th><th>İşlem</th></tr></thead><tbody>${photos.map(p=>`<tr><td><img src="${escHtml(p.url)}" style="width:54px;height:54px;object-fit:cover;border-radius:6px"></td><td>${escHtml(p.username||'')}</td><td>${escHtml(p.caption||'')}</td><td><button class="btn btn-danger btn-xs photo-admin-delete" data-id="${p.id}">Sil</button></td></tr>`).join('')}</tbody></table></div>`;
  main.querySelectorAll('.photo-admin-delete').forEach(b=>b.onclick=async()=>{if(confirm('Fotoğraf silinsin mi?')){await adminApi('/photos/'+b.dataset.id,{method:'DELETE'});renderAdminPhotos(main);}});
}
async function renderAdSubmissions(main) {
  const ads = await adminApi('/ad-submissions');
  main.innerHTML = `<div class="adm-section-header"><div class="adm-section-title">Reklam Havuzu</div></div><div class="card"><table class="adm-table"><thead><tr><th>Tür</th><th>Reklam</th><th>Gönderen</th><th>Durum</th><th>İşlem</th></tr></thead><tbody>${ads.map(a=>`<tr><td>${escHtml(a.type)}</td><td>${escHtml(a.title)}</td><td>${escHtml(a.username||'')}</td><td>${escHtml(a.status)}</td><td>${a.status==='pending'?`<button class="btn btn-primary btn-xs ad-approve" data-id="${a.id}">Onayla</button> <button class="btn btn-danger btn-xs ad-reject" data-id="${a.id}">Reddet</button>`:''}</td></tr>`).join('')}</tbody></table></div>`;
  main.querySelectorAll('.ad-approve').forEach(b=>b.onclick=async()=>{await adminApi('/ad-submissions/'+b.dataset.id+'/approve',{method:'POST'});renderAdSubmissions(main);});
  main.querySelectorAll('.ad-reject').forEach(b=>b.onclick=async()=>{await adminApi('/ad-submissions/'+b.dataset.id+'/reject',{method:'POST'});renderAdSubmissions(main);});
}
async function renderHomepageSections(main) {
  main.innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';
  let settings = {};
  try { settings = await adminApi('/settings'); } catch (e) { settings = {}; }
  const current = settings.homepage_sections ? (function(){ try { return JSON.parse(settings.homepage_sections); } catch { return settings.homepage_sections; } })() : ['konular'];
  const currentArr = Array.isArray(current) ? current : [current];
  const available = [
    { id: 'konular', label: 'Konular' },
    { id: 'kitaplar', label: 'Kitaplar' },
    { id: 'gruplar', label: 'Gruplar' },
    { id: 'muzikler', label: 'Müzikler' },
    { id: 'playlistler', label: 'Playlistler' },
    { id: 'magaza', label: 'Mağaza' },
    { id: 'reals', label: 'Reals' },
    { id: 'fotograflar', label: 'Fotoğraflar' }
  ];

  main.innerHTML = `
    <div class="adm-section-header"><div class="adm-section-title"><div class="icon-pill"><i class="fas fa-th-large"></i></div> Ana Sayfa Bölümü</div><div><button class="btn btn-primary" id="hp-save">Kaydet</button></div></div>
    <div class="card" style="padding:12px">
      <div id="hp-sections-list" style="display:grid;gap:10px">
        ${available.map(a => `
          <div class="hp-section-row" data-id="${a.id}" style="display:flex;align-items:center;gap:8px;padding:12px;border:1px solid var(--border);border-radius:12px;background:var(--bg-card2)">
            <button type="button" class="btn btn-ghost btn-xs hp-move-up" title="Yukarı taşı"><i class="fas fa-chevron-up"></i></button>
            <button type="button" class="btn btn-ghost btn-xs hp-move-down" title="Aşağı taşı"><i class="fas fa-chevron-down"></i></button>
            <label class="checkbox-label" style="flex:1;display:flex;align-items:center;gap:10px;cursor:pointer;margin:0">
              <input type="checkbox" class="hp-section-checkbox" value="${a.id}" ${currentArr.includes(a.id) ? 'checked' : ''} /> ${escHtml(a.label)}
            </label>
          </div>`).join('')}
      </div>
    </div>
    <div style="font-size:13px;color:var(--text-muted);margin-top:10px">Sekmeleri seçin ve yukarı/aşağı taşıma butonlarıyla ana sayfa sıralamasını belirleyin.</div>
  `;

  const list = document.getElementById('hp-sections-list');
  list?.addEventListener('click', e => {
    const up = e.target.closest('.hp-move-up');
    const down = e.target.closest('.hp-move-down');
    if (!up && !down) return;
    const row = (up || down).closest('.hp-section-row');
    if (!row) return;
    if (up && row.previousElementSibling) row.parentElement.insertBefore(row, row.previousElementSibling);
    if (down && row.nextElementSibling) row.parentElement.insertBefore(row.nextElementSibling, row.nextElementSibling.nextElementSibling);
  });

  $('#hp-save')?.addEventListener('click', async () => {
    if (!list) return;
    const selected = Array.from(list.querySelectorAll('.hp-section-row')).map(row => {
      const input = row.querySelector('input.hp-section-checkbox');
      return input && input.checked ? row.dataset.id : null;
    }).filter(Boolean);
    if (!selected.length) { toast('Bir bölüm seçin', 'error'); return; }
    try {
      await fetch('/api/admin/settings', { method:'POST', headers:{'Content-Type':'application/json','X-Admin-Token':sessionStorage.getItem('admin_token')}, body:JSON.stringify({ key:'homepage_sections', value: JSON.stringify(selected) }) });
      toast('Kaydedildi');
    } catch (e) { toast(e.message,'error'); }
  });
}

// ===== DASHBOARD =====
async function renderDashboard(main) {
  main.innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';
  
  // Her isteği ayrı ayrı çek, biri patlarsa diğerleri etkilenmesin
  const [users, forums, books, groups, photos, videos, stories, logs] = await Promise.all([
    adminApi('/users').catch(() => []),
    adminApi('/forums').catch(() => []),
    adminApi('/books').catch(() => []),
    adminApi('/groups').catch(() => []),
    adminApi('/photos').catch(() => []),
    adminApi('/videos').catch(() => []),
    adminApi('/stories').catch(() => []),
    adminApi('/logs?limit=5').catch(() => []),
  ]);

  const banned = Array.isArray(users) ? users.filter(u => u.banned).length : 0;
  const admins = Array.isArray(users) ? users.filter(u => u.is_admin).length : 0;
  const activeStories = Array.isArray(stories) ? stories.filter(story => !story.is_suspended && new Date(story.expires_at) > new Date()).length : 0;
  const inactiveStories = Array.isArray(stories) ? stories.length - activeStories : 0;

  main.innerHTML = `
    <div class="adm-section-header">
      <div class="adm-section-title"><div class="icon-pill"><i class="fas fa-chart-line"></i></div> Dashboard</div>
    </div>
    <div class="adm-stats">
      <div class="adm-stat-card">
        <div class="adm-stat-glow" style="background:#5865F2"></div>
        <div class="adm-stat-icon" style="color:#7c87f5"><i class="fas fa-users"></i></div>
        <div class="adm-stat-num">${Array.isArray(users) ? users.length : 0}</div>
        <div class="adm-stat-label">Toplam Üye</div>
      </div>
      <div class="adm-stat-card">
        <div class="adm-stat-glow" style="background:#dc2626"></div>
        <div class="adm-stat-icon" style="color:#ef4444"><i class="fas fa-comments"></i></div>
        <div class="adm-stat-num">${Array.isArray(forums) ? forums.length : 0}</div>
        <div class="adm-stat-label">Toplam Konu</div>
      </div>
      <div class="adm-stat-card">
        <div class="adm-stat-glow" style="background:#22c55e"></div>
        <div class="adm-stat-icon" style="color:#4ade80"><i class="fas fa-book"></i></div>
        <div class="adm-stat-num">${Array.isArray(books) ? books.length : 0}</div>
        <div class="adm-stat-label">Toplam Kitap</div>
      </div>
      <div class="adm-stat-card">
        <div class="adm-stat-glow" style="background:#f97316"></div>
        <div class="adm-stat-icon" style="color:#fb923c"><i class="fas fa-users-cog"></i></div>
        <div class="adm-stat-num">${Array.isArray(groups) ? groups.length : 0}</div>
        <div class="adm-stat-label">Toplam Grup</div>
      </div>
      <div class="adm-stat-card">
        <div class="adm-stat-glow" style="background:#ec4899"></div>
        <div class="adm-stat-icon" style="color:#f472b6"><i class="fas fa-images"></i></div>
        <div class="adm-stat-num">${Array.isArray(photos) ? photos.length : 0}</div>
        <div class="adm-stat-label">Toplam Fotoğraf</div>
      </div>
      <div class="adm-stat-card">
        <div class="adm-stat-glow" style="background:#06b6d4"></div>
        <div class="adm-stat-icon" style="color:#22d3ee"><i class="fas fa-circle-play"></i></div>
        <div class="adm-stat-num">${Array.isArray(videos) ? videos.filter(video => video.is_reals).length : 0}</div>
        <div class="adm-stat-label">Toplam Reals</div>
      </div>
      <div class="adm-stat-card">
        <div class="adm-stat-glow" style="background:#eab308"></div>
        <div class="adm-stat-icon" style="color:#facc15"><i class="fas fa-clapperboard"></i></div>
        <div class="adm-stat-num">${activeStories}</div>
        <div class="adm-stat-label">Aktif Hikaye</div>
      </div>
      <div class="adm-stat-card">
        <div class="adm-stat-glow" style="background:#ef4444"></div>
        <div class="adm-stat-icon" style="color:#f87171"><i class="fas fa-eye-slash"></i></div>
        <div class="adm-stat-num">${inactiveStories}</div>
        <div class="adm-stat-label">Pasif Hikaye</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
      <div class="card">
        <div class="card-header"><span><i class="fas fa-shield" style="color:#5865F2;margin-right:8px"></i>Sistem Özeti</span></div>
        <div class="card-body" style="display:flex;flex-direction:column;gap:12px">
          <div style="display:flex;justify-content:space-between;align-items:center;padding:10px;background:var(--bg4);border-radius:8px">
            <span style="font-size:13px">Banlı Üye</span><span class="badge badge-red">${banned}</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;padding:10px;background:var(--bg4);border-radius:8px">
            <span style="font-size:13px">Admin Sayısı</span><span class="badge badge-blue">${admins}</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;padding:10px;background:var(--bg4);border-radius:8px">
            <span style="font-size:13px">Gruplar</span><span class="badge badge-gray">${Array.isArray(groups) ? groups.length : 0}</span>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><span><i class="fas fa-history" style="color:#f97316;margin-right:8px"></i>Son İşlemler</span></div>
        <div class="card-body" style="padding:8px">
          ${Array.isArray(logs) && logs.length ? logs.map(l => `
            <div style="padding:8px 12px;border-bottom:1px solid var(--border);font-size:12px">
              <span style="color:var(--red2);font-weight:600">${escHtml(l.actor)}</span>
              <span style="color:var(--text2);margin:0 4px">→</span>
              <span>${escHtml(l.action)}</span>
              <span style="float:right;color:var(--text3)">${timeAgo(l.created_at)}</span>
            </div>`).join('') : '<div style="padding:20px;text-align:center;color:var(--text3)">Henüz log yok</div>'}
        </div>
      </div>
    </div>`;
}

// ===== USERS =====
async function renderUsers(main) {
  let users = [];
  try { users = await adminApi('/users'); } catch (e) {
    main.innerHTML = `<div class="adm-section-header"><div class="adm-section-title"><div class="icon-pill"><i class="fas fa-users"></i></div> Kullanıcılar</div></div><div class="card"><div class="card-body" style="color:var(--red2);padding:20px"><i class="fas fa-exclamation-circle"></i> ${escHtml(e.message)}</div></div>`;
    return;
  }
  main.innerHTML = `
    <div class="adm-section-header">
      <div class="adm-section-title"><div class="icon-pill"><i class="fas fa-users"></i></div> Kullanıcılar <span style="font-size:13px;font-weight:400;color:var(--text2)">(${users.length})</span></div>
      <div class="adm-search"><i class="fas fa-search"></i><input type="text" id="user-search" placeholder="Kullanıcı, e-posta, IP ara..." style="min-width:240px" /></div>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>ID</th><th>Kullanıcı</th><th>E-posta</th><th>Doğum tarihi</th><th>Seviye</th><th>İstatistik</th><th>IP</th><th>Kayıt</th><th>Durum</th><th>İşlem</th></tr></thead>
          <tbody id="users-tbody"></tbody>
        </table>
      </div>
    </div>`;
  renderUsersTable(users);
  $('#user-search').addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    renderUsersTable(users.filter(u => u.username.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || (u.ip||'').includes(q)));
  });
}

function renderUsersTable(users) {
  const tbody = $('#users-tbody'); if (!tbody) return;
  if (!users.length) { tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:var(--text3);padding:32px">Kullanıcı bulunamadı</td></tr>'; return; }
  tbody.innerHTML = users.map(u => `<tr>
    <td style="color:var(--text3);font-size:11px">#${u.id}</td>
    <td>
      <div style="display:flex;align-items:center;gap:8px">
        ${u.avatar ? `<img src="${escHtml(u.avatar)}" style="width:28px;height:28px;border-radius:50%;object-fit:cover" />` : `<div style="width:28px;height:28px;border-radius:50%;background:var(--surface2);display:flex;align-items:center;justify-content:center;font-size:11px"><i class="fas fa-user"></i></div>`}
        <div>
          <div style="font-weight:600;font-size:13px">${escHtml(u.username)}</div>
          <div style="font-size:10px;color:var(--text3)">${u.is_admin ? '<span style="color:#7c87f5"><i class="fas fa-shield"></i> Admin</span>' : ''} ${u.is_vip ? '<span style="color:#facc15">VIP</span>' : ''} ${u.is_plus ? '<span style="color:#a855f7">Plus</span>' : ''}</div>
        </div>
      </div>
    </td>
    <td style="font-size:12px;color:var(--text2)">${escHtml(u.email)}</td>
    <td style="font-size:11px;color:var(--text2)">${u.birth_date ? new Date(u.birth_date).toLocaleDateString('tr-TR') : '-'}</td>
    <td><span class="badge badge-gray">${u.level_id||1}</span></td>
    <td style="font-size:12px;color:var(--text2)">
      <span title="Forum"><i class="fas fa-comments" style="color:var(--red2)"></i> ${u.forum_count}</span>
      <span title="Kitap" style="margin:0 6px"><i class="fas fa-book" style="color:#4ade80"></i> ${u.book_count}</span>
      <span title="Yorum"><i class="fas fa-comment" style="color:#7c87f5"></i> ${u.comment_count}</span>
    </td>
    <td style="font-size:11px;color:var(--text3)">${escHtml(u.ip||'-')}</td>
    <td style="font-size:11px">${timeAgo(u.created_at)}</td>
    <td>${u.banned ? '<span class="badge badge-red"><i class="fas fa-ban"></i> Banlı</span>' : '<span class="badge badge-green"><i class="fas fa-check"></i> Aktif</span>'}</td>
    <td>
      <div style="display:flex;gap:4px;flex-wrap:wrap">
        <button class="btn btn-outline btn-xs edit-user-btn" data-id="${u.id}" title="Düzenle"><i class="fas fa-edit"></i></button>
        <button class="btn btn-blue btn-xs perm-user-btn" data-id="${u.id}" title="Yetkiler"><i class="fas fa-shield"></i></button>
        <button class="btn btn-outline btn-xs restrict-user-btn" data-id="${u.id}" title="Kısıtlama"><i class="fas fa-user-lock"></i></button>
        ${u.banned
          ? `<button class="btn btn-green btn-xs unban-user-btn" data-id="${u.id}" title="Ban Kaldır"><i class="fas fa-unlock"></i></button>`
          : `<button class="btn btn-danger btn-xs ban-user-btn" data-id="${u.id}" title="Banla"><i class="fas fa-ban"></i></button>`}
        <button class="btn btn-danger btn-xs del-user-btn" data-id="${u.id}" title="Sil"><i class="fas fa-trash"></i></button>
      </div>
    </td>
  </tr>`).join('');

  tbody.addEventListener('click', async e => {
    const edit = e.target.closest('.edit-user-btn');
    const ban = e.target.closest('.ban-user-btn');
    const unban = e.target.closest('.unban-user-btn');
    const del = e.target.closest('.del-user-btn');
    const perm = e.target.closest('.perm-user-btn');
    const restrict = e.target.closest('.restrict-user-btn');
    if (edit) { const u = users.find(x => x.id == edit.dataset.id); if (u) showEditUserModal(u); }
    if (ban) showBanModal(ban.dataset.id);
    if (unban) { if (!confirm('Ban kaldırılsın mı?')) return; try { await adminApi('/user/'+unban.dataset.id+'/unban',{method:'POST'}); toast('Ban kaldırıldı'); loadSection('users'); } catch(e){toast(e.message,'error');} }
    if (del) { if (!confirm('Kullanıcı kalıcı silinsin mi?')) return; try { await adminApi('/user/'+del.dataset.id,{method:'DELETE'}); toast('Silindi'); loadSection('users'); } catch(e){toast(e.message,'error');} }
    if (perm) { const u = users.find(x => x.id == perm.dataset.id); if (u) showPermModal(u); }
    if (restrict) { const u = users.find(x => x.id == restrict.dataset.id); if (u) showRestrictionModal(u); }
  });
}

async function showRestrictionModal(user) {
  showModal('Kısıtlama Uygula — ' + user.username, `<div class="form-group"><label>Kısıtlama türü</label><select id="restriction-type"><option value="photo">Fotoğraf</option><option value="story">Hikaye</option><option value="reals">Reals</option><option value="music">Müzik</option><option value="comment">Yorum</option><option value="forum">Forum</option><option value="message">Mesaj</option><option value="group">Grup</option></select></div><div class="form-group"><label>Süre</label><input id="restriction-duration" placeholder="Örn: 2 gün 4 saat veya süresiz" /></div><div class="form-group"><label>Neden <b style="color:var(--red2)">*</b></label><textarea id="restriction-reason" rows="4" placeholder="Kısıtlama nedenini yazın"></textarea></div><button class="btn btn-primary" id="restriction-save" style="width:100%;justify-content:center"><i class="fas fa-shield-halved"></i> Kısıtlamayı Uygula</button><div id="restriction-error" class="form-error mt-4"></div><div id="restriction-history" style="margin-top:18px"></div>`);
  try {
    const history = await adminApi('/user/' + user.id + '/restrictions');
    $('#restriction-history').innerHTML = history.length ? '<div style="font-size:11px;color:var(--text3);margin-bottom:7px">Kısıtlama geçmişi</div>' + history.slice(0,5).map(item => `<div style="padding:8px 0;border-top:1px solid var(--border);font-size:11px"><b>${escHtml(item.restriction_type)}</b> · ${escHtml(item.reason)}<br><span style="color:var(--text3)">${item.expires_at ? formatDate(item.expires_at) : 'Süresiz'} · ${item.revoked_at ? 'Kaldırıldı' : 'Aktif'}</span></div>`).join('') : '';
  } catch {}
  $('#restriction-save').addEventListener('click', async () => {
    const error = $('#restriction-error');
    try { await adminApi('/user/' + user.id + '/restrictions', { method:'POST', body:JSON.stringify({ restriction_type:$('#restriction-type').value, duration:$('#restriction-duration').value, reason:$('#restriction-reason').value.trim() }) }); toast('Kısıtlama uygulandı'); hideModal(); loadSection('users'); } catch (e) { error.textContent = e.message; }
  });
}

function showEditUserModal(user) {
  showModal('Kullanıcı Düzenle — ' + user.username, `
    <div class="form-row">
      <div class="form-group"><label>Kullanıcı Adı</label><input id="eu-username" value="${escHtml(user.username)}" /></div>
      <div class="form-group"><label>E-posta</label><input id="eu-email" type="email" value="${escHtml(user.email)}" /></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Yeni Şifre (boş=değişme)</label><input id="eu-pw" type="password" placeholder="••••••" /></div>
      <div class="form-group"><label>Seviye ID</label><input id="eu-level" type="number" value="${user.level_id||1}" /></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Ünvan</label><input id="eu-title" value="${escHtml(user.title||'')}" placeholder="Örn: Yazılımcı" /></div>
      <div class="form-group"><label>İsim Rengi</label><input id="eu-color" type="color" value="${user.name_color||'#f5f5f5'}" style="height:38px;cursor:pointer" /></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Rozet Adı</label><input id="eu-badge-name" value="${escHtml(user.badge_name||'')}" placeholder="Örn: Katılımcı" /></div>
      <div class="form-group"><label>Rozet İkonu</label><input id="eu-badge-icon" value="${escHtml(user.badge_icon||'fas fa-award')}" placeholder="fas fa-award veya ⭐" /></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Rozet Rengi</label><input id="eu-badge-color" type="color" value="${user.badge_color||'#6b7280'}" style="height:38px;cursor:pointer" /></div>
      <div class="form-group"></div>
    </div>
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px">
      <label class="checkbox-label"><input type="checkbox" id="eu-vip" ${user.is_vip?'checked':''} /> VIP</label>
      <label class="checkbox-label"><input type="checkbox" id="eu-plus" ${user.is_plus?'checked':''} /> Plus</label>
      <label class="checkbox-label"><input type="checkbox" id="eu-admin" ${user.is_admin?'checked':''} /> <i class="fas fa-shield" style="color:#7c87f5"></i> Admin Yetkilisi</label>
    </div>
    <button class="btn btn-primary" id="eu-submit" style="width:100%;justify-content:center">Kaydet</button>
    <div id="eu-error" class="form-error mt-4"></div>
  `);
  $('#eu-submit').addEventListener('click', async () => {
    const wasAdmin = !!user.is_admin, isAdmin = $('#eu-admin').checked;
    const body = { username: $('#eu-username').value.trim(), email: $('#eu-email').value.trim(),
      is_vip: $('#eu-vip').checked, is_plus: $('#eu-plus').checked,
      name_color: $('#eu-color').value, level_id: parseInt($('#eu-level').value)||1,
      title: $('#eu-title').value.trim(),
      badge_name: $('#eu-badge-name').value.trim(), badge_icon: $('#eu-badge-icon').value.trim(), badge_color: $('#eu-badge-color').value };
    const pw = $('#eu-pw').value; if (pw) body.password = pw;
    try {
      await adminApi('/user/'+user.id, {method:'PUT', body:JSON.stringify(body)});
      if (isAdmin !== wasAdmin) await adminApi('/user/'+user.id+'/set-admin', {method:'POST', body:JSON.stringify({is_admin:isAdmin})});
      toast('Kullanıcı güncellendi'); hideModal(); loadSection('users');
    } catch (e) { $('#eu-error').textContent = e.message; }
  });
}

function showBanModal(userId) {
  showModal('Kullanıcıyı Banla', `
    <div class="form-group"><label>Ban Türü</label>
      <select id="ban-type">
        <option value="soft">Soft Ban (hesap kilitli)</option>
        <option value="ip">IP Ban (IP engeli)</option>
      </select>
    </div>
    <button class="btn btn-primary" id="ban-submit" style="width:100%;justify-content:center"><i class="fas fa-ban"></i> Banla</button>
    <div id="ban-error" class="form-error mt-4"></div>
  `);
  $('#ban-submit').addEventListener('click', async () => {
    try { await adminApi('/user/'+userId+'/ban',{method:'POST',body:JSON.stringify({ban_type:$('#ban-type').value})}); toast('Banlandı'); hideModal(); loadSection('users'); }
    catch (e) { $('#ban-error').textContent = e.message; }
  });
}

async function showPermModal(user) {
  let perms = null;
  try { perms = await adminApi('/permissions/' + user.id); } catch {}
  const p = perms || {};
  const isSuperAdmin = !perms && user.is_admin;
  const permDefs = [
    { key:'can_view_users', label:'Üyeleri Görüntüle', desc:'Üye listesini görebilir', icon:'fas fa-users' },
    { key:'can_ban_users', label:'Üye Yasakla/Kaldır', desc:'Ban atabilir, kaldırabilir', icon:'fas fa-ban' },
    { key:'can_delete_content', label:'İçerik Sil', desc:'Forum, kitap, yorum silebilir', icon:'fas fa-trash' },
    { key:'can_edit_content', label:'İçerik Düzenle', desc:'Forum ve kitap düzenleyebilir', icon:'fas fa-edit' },
    { key:'can_manage_levels', label:'Seviyeleri Yönet', desc:'Seviye ekle/düzenle/sil', icon:'fas fa-layer-group' },
    { key:'can_manage_tags', label:'Etiketleri Yönet', desc:'Etiket ekle/düzenle/sil', icon:'fas fa-tags' },
    { key:'can_manage_announcements', label:'Duyuru Yönet', desc:'Duyuru oluştur/düzenle/sil', icon:'fas fa-bullhorn' },
    { key:'can_view_logs', label:'Log Görüntüle', desc:'Sistem loglarını okuyabilir', icon:'fas fa-history' },
    { key:'can_suspend_content', label:'İçerik Askıya Al', desc:'İçerikleri geçici olarak görünmez yapabilir', icon:'fas fa-pause-circle' },
    { key:'can_restrict_users', label:'Kullanıcı Kısıtla', desc:'Gerekçeli ve süreli kısıtlama verebilir', icon:'fas fa-user-lock' },
    { key:'can_review_artists', label:'Artist Başvuruları', desc:'Başvuruları kabul veya reddedebilir', icon:'fas fa-microphone' },
    { key:'can_assign_badges', label:'Rozet Ver', desc:'Mevcut rozetleri kullanıcılara verebilir', icon:'fas fa-award' },
    { key:'can_view_store', label:'Mağazayı Görüntüle', desc:'Mağaza ürünlerini sadece görebilir', icon:'fas fa-store' },
    { key:'can_view_groups', label:'Grupları Görüntüle', desc:'Grupları sadece görebilir', icon:'fas fa-users' },
    { key:'can_view_stories', label:'Hikayeleri Görüntüle', desc:'Hikayeleri sadece görebilir', icon:'fas fa-circle-play' },
    { key:'can_view_reals', label:'Reals Görüntüle', desc:'Reals videolarını sadece görebilir', icon:'fas fa-video' },
    { key:'can_view_levels', label:'Seviyeleri Görüntüle', desc:'Seviyeleri sadece görebilir', icon:'fas fa-layer-group' },
    { key:'can_manage_settings', label:'Site Ayarları', desc:'Site ayarlarını değiştirebilir', icon:'fas fa-cog' },
    { key:'can_manage_admins', label:'Admin Yönet', desc:'Admin atayabilir/alabilir', icon:'fas fa-shield' },
  ];
  showModal(`Yetki Düzenleme — ${user.username}`, `
    ${isSuperAdmin ? `
    <div style="margin-bottom:16px;padding:12px 14px;background:rgba(234,179,8,0.1);border:1px solid rgba(234,179,8,0.3);border-radius:10px;font-size:12px;color:#facc15">
      <i class="fas fa-crown" style="margin-right:6px"></i>
      <strong>Bu kullanıcı şu an SÜPERADMİN.</strong> Yetki kaydı yokken tüm yetkilere sahiptir.
      Aşağıdan kısıtlı yetki kaydı oluşturabilirsin — bu durumda sadece seçtiğin yetkiler geçerli olur.
    </div>` : `
    <div style="margin-bottom:16px;padding:10px 14px;background:rgba(88,101,242,0.1);border:1px solid rgba(88,101,242,0.2);border-radius:10px;font-size:12px">
      <i class="fas fa-info-circle" style="color:#7c87f5;margin-right:6px"></i>
      Kaydet'e basınca kullanıcıya <strong>is_admin=1</strong> atanır ve sadece işaretli yetkiler verilir.
      Tüm yetkiler verirsen süperadmin gibi çalışır.
    </div>`}
    <div class="perm-grid" id="perm-grid">
      ${permDefs.map(d => `
        <div class="perm-item">
          <input type="checkbox" id="perm-${d.key}" ${(isSuperAdmin || p[d.key]) ? 'checked' : ''} />
          <div>
            <span class="perm-label"><i class="${d.icon}" style="margin-right:5px;color:var(--red2)"></i>${d.label}</span>
            <span class="perm-desc">${d.desc}</span>
          </div>
        </div>`).join('')}
    </div>
    <div style="display:flex;gap:8px;margin-top:16px">
      <button class="btn btn-primary" id="perm-all-btn" style="flex:1;justify-content:center"><i class="fas fa-check-double"></i> Tümünü Ver</button>
      <button class="btn btn-outline" id="perm-none-btn" style="flex:1;justify-content:center"><i class="fas fa-times"></i> Tümünü Al</button>
    </div>
    <button class="btn btn-blue" id="perm-save-btn" style="width:100%;justify-content:center;margin-top:8px"><i class="fas fa-save"></i> Kaydet &amp; Adminliği Etkinleştir</button>
    <div id="perm-error" class="form-error mt-4"></div>
  `);
  $('#perm-all-btn').addEventListener('click', () => permDefs.forEach(d => { const el=$('#perm-'+d.key); if(el) el.checked=true; }));
  $('#perm-none-btn').addEventListener('click', () => permDefs.forEach(d => { const el=$('#perm-'+d.key); if(el) el.checked=false; }));
  $('#perm-save-btn').addEventListener('click', async () => {
    const body = {}; permDefs.forEach(d => { body[d.key] = $('#perm-'+d.key)?.checked ? 1 : 0; });
    try { await adminApi('/permissions/'+user.id, {method:'POST', body:JSON.stringify(body)}); toast('Yetkiler kaydedildi'); hideModal(); }
    catch (e) { $('#perm-error').textContent = e.message; }
  });
}

// ===== FORUMS =====
async function renderForums(main) {
  let forums = [];
  try { forums = await adminApi('/forums'); } catch (e) {
    main.innerHTML = `<div class="adm-section-header"><div class="adm-section-title"><div class="icon-pill"><i class="fas fa-comments"></i></div> Konular</div></div><div class="card"><div class="card-body" style="color:var(--red2);padding:20px"><i class="fas fa-exclamation-circle"></i> ${escHtml(e.message)}</div></div>`;
    return;
  }
  main.innerHTML = `
    <div class="adm-section-header">
      <div class="adm-section-title"><div class="icon-pill"><i class="fas fa-comments"></i></div> Konular <span style="font-size:13px;font-weight:400;color:var(--text2)">(${forums.length})</span></div>
      <div class="adm-search"><i class="fas fa-search"></i><input type="text" id="forum-search" placeholder="Başlık veya kullanıcı ara..." style="min-width:240px" /></div>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>ID</th><th>Başlık</th><th>Yazar</th><th>Görüntülenme</th><th>Beğeni</th><th>Tarih</th><th>İşlem</th></tr></thead>
          <tbody id="forums-tbody"></tbody>
        </table>
      </div>
    </div>`;
  const renderTable = (list) => {
    const tbody = $('#forums-tbody'); if (!tbody) return;
    if (!list.length) { tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text3);padding:32px">Konu bulunamadı</td></tr>'; return; }
    tbody.innerHTML = list.map(f => `<tr>
      <td style="color:var(--text3);font-size:12px">#${f.id}</td>
      <td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(f.title)}">${escHtml(f.title)}</td>
      <td><span style="color:var(--blue2)">${escHtml(f.username||'—')}</span></td>
      <td style="font-size:12px;color:var(--text2)">${f.views||0} <i class="fas fa-eye" style="font-size:10px"></i></td>
      <td style="font-size:12px;color:var(--text2)">${f.like_count||0} <i class="fas fa-heart" style="font-size:10px;color:#ef4444"></i></td>
      <td style="color:var(--text3);font-size:12px">${timeAgo(f.created_at)}</td>
      <td>
        <div style="display:flex;gap:4px">
          <button class="btn btn-outline btn-xs edit-forum-btn" data-id="${f.id}" title="Düzenle"><i class="fas fa-edit"></i></button>
          <button class="btn btn-danger btn-xs del-forum-btn" data-id="${f.id}"><i class="fas fa-trash"></i> Sil</button>
        </div>
      </td>
    </tr>`).join('');
    tbody.querySelectorAll('.edit-forum-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const f = forums.find(x => x.id == btn.dataset.id);
        if (!f) return;
        showModal(`✏️ Konu Düzenle — #${f.id}`, `
          <div class="form-group"><label>Başlık</label><input id="ef-title" value="${escHtml(f.title)}" /></div>
          <div class="form-row">
            <div class="form-group"><label>Görüntülenme</label><input id="ef-views" type="number" value="${f.views||0}" /></div>
          </div>
          <div id="ef-err" class="form-error"></div>
          <button class="btn btn-primary" id="ef-save" style="width:100%;justify-content:center;margin-top:12px"><i class="fas fa-save"></i> Kaydet</button>
        `);
        $('#ef-save').addEventListener('click', async () => {
          const btn2 = $('#ef-save'); const err = $('#ef-err');
          btn2.disabled = true; btn2.innerHTML = '<div class="spinner" style="width:14px;height:14px"></div>';
          try {
            const body = {
              title: $('#ef-title').value.trim() || f.title,
              views: parseInt($('#ef-views').value) || 0
            };
            await adminApi('/forum/'+f.id, { method:'PUT', body:JSON.stringify(body) });
            toast('Konu güncellendi');
            const idx = forums.findIndex(x => x.id == f.id);
            if (idx !== -1) { forums[idx] = { ...forums[idx], ...body }; }
            hideModal(); renderTable(forums);
          } catch(e) { err.textContent = e.message; btn2.disabled=false; btn2.innerHTML='<i class="fas fa-save"></i> Kaydet'; }
        });
      });
    });
    tbody.querySelectorAll('.del-forum-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Bu konuyu silmek istediğine emin misin?')) return;
        try { await adminApi('/forum/'+btn.dataset.id, {method:'DELETE'}); toast('Konu silindi'); forums = forums.filter(f=>f.id!=btn.dataset.id); renderTable(forums); }
        catch (e) { toast(e.message, 'error'); }
      });
    });
  };
  renderTable(forums);
  $('#forum-search').addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    renderTable(forums.filter(f => f.title.toLowerCase().includes(q) || (f.username||'').toLowerCase().includes(q)));
  });
}

// ===== BOOKS =====
async function renderBooks(main) {
  let books = [];
  try { books = await adminApi('/books'); } catch (e) {
    main.innerHTML = `<div class="adm-section-header"><div class="adm-section-title"><div class="icon-pill"><i class="fas fa-book"></i></div> Kitaplar</div></div><div class="card"><div class="card-body" style="color:var(--red2);padding:20px"><i class="fas fa-exclamation-circle"></i> ${escHtml(e.message)}</div></div>`;
    return;
  }
  main.innerHTML = `
    <div class="adm-section-header">
      <div class="adm-section-title"><div class="icon-pill"><i class="fas fa-book"></i></div> Kitaplar <span style="font-size:13px;font-weight:400;color:var(--text2)">(${books.length})</span></div>
      <div class="adm-search"><i class="fas fa-search"></i><input type="text" id="book-search" placeholder="Başlık veya kullanıcı ara..." style="min-width:240px" /></div>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>ID</th><th>Banner</th><th>Başlık</th><th>Hesap</th><th>Sayfa</th><th>Durum</th><th>PDF</th><th>İşlem</th></tr></thead>
          <tbody id="books-tbody"></tbody>
        </table>
      </div>
    </div>`;
  const renderTable = (list) => {
    const tbody = $('#books-tbody'); if (!tbody) return;
    if (!list.length) { tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text3);padding:32px">Kitap bulunamadı</td></tr>'; return; }
    tbody.innerHTML = list.map(b => `<tr>
      <td style="color:var(--text3);font-size:12px">#${b.id}</td>
      <td>
        ${b.cover_image
          ? `<img src="${escHtml(b.cover_image)}" style="width:40px;height:54px;object-fit:cover;border-radius:4px;border:1px solid var(--border)" onerror="this.style.display='none'" />`
          : `<div style="width:40px;height:54px;background:var(--bg4);border:1px solid var(--border);border-radius:4px;display:flex;align-items:center;justify-content:center;color:var(--text3);font-size:10px"><i class="fas fa-image"></i></div>`}
      </td>
      <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(b.title)}">${escHtml(b.title)}</td>
      <td><span style="color:var(--blue2)">${escHtml(b.username||'—')}</span></td>
      <td style="color:var(--text3);font-size:12px">${b.page_count||0}</td>
      <td>${b.is_hidden ? '<span class="badge badge-red"><i class="fas fa-eye-slash"></i> Gizli</span>' : '<span class="badge badge-green"><i class="fas fa-eye"></i> Açık</span>'}</td>
      <td>${(b.allow_download !== 0 && b.allow_pdf !== 0) ? '<span class="badge badge-green"><i class="fas fa-file-pdf"></i> Açık</span>' : '<span class="badge badge-gray"><i class="fas fa-ban"></i> Kapalı</span>'}</td>
      <td style="display:flex;gap:6px">
        <button class="btn btn-blue btn-xs edit-book-btn"
          data-id="${b.id}"
          data-title="${escHtml(b.title)}"
          data-cover="${escHtml(b.cover_image||'')}"
          data-hidden="${b.is_hidden?1:0}"
          data-allow-download="${(b.allow_download!==undefined?b.allow_download:1)?1:0}"
          data-allow-pdf="${(b.allow_pdf!==undefined?b.allow_pdf:1)?1:0}"
        ><i class="fas fa-edit"></i> Düzenle</button>
        <button class="btn btn-danger btn-xs del-book-btn" data-id="${b.id}"><i class="fas fa-trash"></i> Sil</button>
      </td>
    </tr>`).join('');
    tbody.querySelectorAll('.del-book-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Bu kitabı silmek istediğine emin misin?')) return;
        try { await adminApi('/book/'+btn.dataset.id, {method:'DELETE'}); toast('Kitap silindi'); books = books.filter(b=>b.id!=btn.dataset.id); renderTable(books); }
        catch (e) { toast(e.message, 'error'); }
      });
    });
    tbody.querySelectorAll('.edit-book-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const bookId = btn.dataset.id;
        const bookTitle = btn.dataset.title;
        const bookCover = btn.dataset.cover || '';
        const isHidden = btn.dataset.hidden === '1';
        const allowDownload = btn.dataset.allowDownload !== '0';
        const allowPdf = btn.dataset.allowPdf !== '0';
        showModal('Kitabı Düzenle', `
          <div style="margin-bottom:16px;padding:10px 14px;background:var(--bg4);border-radius:8px;font-size:13px;color:var(--text2)">
            <i class="fas fa-book" style="color:var(--blue2)"></i> <strong style="color:var(--text)">${escHtml(bookTitle)}</strong>
          </div>

          <div class="form-group">
            <label>Kitap Başlığı</label>
            <input id="adm-bk-title" type="text" value="${escHtml(bookTitle)}" placeholder="Kitap başlığı" />
          </div>

          <div class="form-group">
            <label>Banner / Kapak Görseli (URL)</label>
            <input id="adm-bk-cover" type="text" value="${escHtml(bookCover)}" placeholder="https://... (resim URL'si)" />
            <div id="adm-bk-cover-preview" style="margin-top:10px;${bookCover ? '' : 'display:none'}">
              <img id="adm-bk-cover-img" src="${escHtml(bookCover)}" style="max-width:100%;max-height:180px;border-radius:8px;border:1px solid var(--border);object-fit:cover" onerror="this.parentElement.style.display='none'" />
            </div>
          </div>

          <div style="background:var(--bg4);border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:14px">
            <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">Görünürlük</div>
            <label class="checkbox-label">
              <input type="checkbox" id="adm-bk-hidden" ${isHidden ? 'checked' : ''} />
              <span>Kitabı gizle <span style="color:var(--text3);font-size:11px">(sadece sahip ve admin görebilir)</span></span>
            </label>
          </div>

          <div style="background:var(--bg4);border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:16px">
            <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">PDF / İndirme Ayarları</div>
            <label class="checkbox-label" style="margin-bottom:8px">
              <input type="checkbox" id="adm-bk-allow-download" ${allowDownload ? 'checked' : ''} />
              <span>İndirmeye izin ver</span>
            </label>
            <label class="checkbox-label">
              <input type="checkbox" id="adm-bk-allow-pdf" ${allowPdf ? 'checked' : ''} />
              <span>PDF oluşturmaya / yazdırmaya izin ver</span>
            </label>
          </div>

          <button class="btn btn-primary" id="adm-bk-save-btn" style="width:100%;justify-content:center;padding:10px">
            <i class="fas fa-save"></i> Kaydet
          </button>
          <div id="adm-bk-error" style="color:var(--red2);font-size:12px;margin-top:6px"></div>
        `);

        // Banner önizleme
        $('#adm-bk-cover').addEventListener('input', e => {
          const url = e.target.value.trim();
          const preview = $('#adm-bk-cover-preview');
          const img = $('#adm-bk-cover-img');
          if (url) {
            img.src = url;
            preview.style.display = '';
          } else {
            preview.style.display = 'none';
          }
        });

        $('#adm-bk-save-btn').addEventListener('click', async () => {
          const title = $('#adm-bk-title').value.trim();
          if (!title) { $('#adm-bk-error').textContent = 'Başlık boş olamaz'; return; }
          try {
            const updated = await adminApi('/book/' + bookId, {
              method: 'PUT',
              body: JSON.stringify({
                title,
                cover_image: $('#adm-bk-cover').value.trim(),
                is_hidden: $('#adm-bk-hidden').checked,
                allow_download: $('#adm-bk-allow-download').checked,
                allow_pdf: $('#adm-bk-allow-pdf').checked
              })
            });
            const idx = books.findIndex(b => b.id == bookId);
            if (idx >= 0) books[idx] = { ...books[idx], title: updated.title, cover_image: updated.cover_image, is_hidden: updated.is_hidden, allow_download: updated.allow_download, allow_pdf: updated.allow_pdf };
            toast('Kitap güncellendi');
            hideModal();
            renderTable(books);
          } catch (e) { $('#adm-bk-error').textContent = e.message; }
        });
      });
    });
  };
  renderTable(books);
  $('#book-search').addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    renderTable(books.filter(b => b.title.toLowerCase().includes(q) || (b.username||'').toLowerCase().includes(q)));
  });
}

// ===== GROUPS =====
async function renderGroups(main) {
  let groups = [];
  try { groups = await adminApi('/groups'); } catch (e) {
    main.innerHTML = `<div class="adm-section-header"><div class="adm-section-title"><div class="icon-pill"><i class="fas fa-users-cog"></i></div> Gruplar</div></div><div class="card"><div class="card-body" style="color:var(--red2);padding:20px"><i class="fas fa-exclamation-circle"></i> ${escHtml(e.message)}</div></div>`;
    return;
  }
  main.innerHTML = `
    <div class="adm-section-header">
      <div class="adm-section-title"><div class="icon-pill"><i class="fas fa-users-cog"></i></div> Gruplar <span style="font-size:13px;font-weight:400;color:var(--text2)">(${groups.length})</span></div>
      <div class="adm-search"><i class="fas fa-search"></i><input type="text" id="group-search" placeholder="Grup adı veya sahibi ara..." style="min-width:240px" /></div>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>ID</th><th>Grup Adı</th><th>Sahibi</th><th>Tarih</th><th>İşlem</th></tr></thead>
          <tbody id="groups-tbody"></tbody>
        </table>
      </div>
    </div>`;
  const renderTable = (list) => {
    const tbody = $('#groups-tbody'); if (!tbody) return;
    if (!list.length) { tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text3);padding:32px">Grup bulunamadı</td></tr>'; return; }
    tbody.innerHTML = list.map(g => `<tr>
      <td style="color:var(--text3);font-size:12px">#${g.id}</td>
      <td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(g.name)}">${escHtml(g.name)}</td>
      <td><span style="color:var(--blue2)">${escHtml(g.owner_name||'—')}</span></td>
      <td style="color:var(--text3);font-size:12px">${timeAgo(g.created_at)}</td>
      <td><span style="color:var(--text3);font-size:12px"><i class="fas fa-eye"></i> Sadece görüntüleme</span></td>
    </tr>`).join('');
    tbody.querySelectorAll('.del-group-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Bu grubu silmek istediğine emin misin?')) return;
        try { await adminApi('/group/'+btn.dataset.id, {method:'DELETE'}); toast('Grup silindi'); groups = groups.filter(g=>g.id!=btn.dataset.id); renderTable(groups); }
        catch (e) { toast(e.message, 'error'); }
      });
    });
  };
  renderTable(groups);
  $('#group-search').addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    renderTable(groups.filter(g => g.name.toLowerCase().includes(q) || (g.owner_name||'').toLowerCase().includes(q)));
  });
}

// ===== VIDEOS =====
async function renderVideos(main) {
  let videos = [];
  try { videos = await adminApi('/videos'); } catch (e) {
    main.innerHTML = `<div class="adm-section-header"><div class="adm-section-title"><div class="icon-pill"><i class="fas fa-video"></i></div> Videolar</div></div><div class="card"><div class="card-body" style="color:var(--red2);padding:20px"><i class="fas fa-exclamation-circle"></i> ${escHtml(e.message)}</div></div>`;
    return;
  }
  main.innerHTML = `
    <div class="adm-section-header">
      <div class="adm-section-title"><div class="icon-pill"><i class="fas fa-video"></i></div> Videolar <span style="font-size:13px;font-weight:400;color:var(--text2)">(${videos.length})</span></div>
      <div class="adm-search"><i class="fas fa-search"></i><input type="text" id="video-search" placeholder="Başlık veya kullanıcı ara..." style="min-width:240px" /></div>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>ID</th><th>Başlık</th><th>Kullanıcı</th><th>Yorum</th><th>Beğeni</th><th>Durum</th><th>İşlem</th></tr></thead>
          <tbody id="videos-tbody"></tbody>
        </table>
      </div>
    </div>`;

  const renderTable = list => {
    const tbody = $('#videos-tbody'); if (!tbody) return;
    if (!list.length) { tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text3);padding:32px">Video bulunamadı</td></tr>'; return; }
    tbody.innerHTML = list.map(v => `<tr>
      <td style="color:var(--text3);font-size:12px">#${v.id}</td>
      <td style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(v.title)}">${escHtml(v.title)}</td>
      <td><span style="color:var(--blue2)">${escHtml(v.username||'Silinmiş')}</span></td>
      <td style="color:var(--text3);font-size:12px">${v.allow_comments?'<span class="badge badge-green">Açık</span>':'<span class="badge badge-red">Kapalı</span>'}</td>
      <td style="color:var(--text3);font-size:12px">${v.like_count||0}</td>
      <td style="color:var(--text3);font-size:12px">${v.active?'<span class="badge badge-green">Aktif</span>':'<span class="badge badge-red">Pasif</span>'}</td>
      <td>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn btn-outline btn-xs edit-video-btn" data-id="${v.id}">Düzenle</button>
          <button class="btn btn-danger btn-xs delete-video-btn" data-id="${v.id}">Sil</button>
        </div>
      </td>
    </tr>`).join('');

    tbody.querySelectorAll('.edit-video-btn').forEach(btn => btn.addEventListener('click', async () => {
      const video = videos.find(x => x.id == btn.dataset.id);
      if (video) showVideoEditModal(video);
    }));
    tbody.querySelectorAll('.delete-video-btn').forEach(btn => btn.addEventListener('click', async () => {
      if (!confirm('Bu videoyu silmek istediğine emin misin?')) return;
      try { await adminApi('/video/' + btn.dataset.id, { method:'DELETE' }); toast('Video silindi'); videos = videos.filter(v => v.id != btn.dataset.id); renderTable(videos); }
      catch (e) { toast(e.message,'error'); }
    }));
  };

  renderTable(videos);
  $('#video-search').addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    renderTable(videos.filter(v => v.title.toLowerCase().includes(q) || (v.username||'').toLowerCase().includes(q)));
  });
}

function showVideoEditModal(video) {
  showModal(`Video Düzenle — ${escHtml(video.title)}`, `
    <div class="form-group"><label>Başlık</label><input id="ve-title" value="${escHtml(video.title)}" /></div>
    <div class="form-group"><label>Açıklama</label><textarea id="ve-description" rows="5">${escHtml(video.description||'')}</textarea></div>
    <div class="form-group"><label>Video URL</label><input id="ve-video-url" value="${escHtml(video.video_url||'')}" /></div>
    <div class="form-group"><label>Yeni Video Dosyası</label><input type="file" id="ve-video-file" accept="video/*" /></div>
    <div class="form-group"><label>Banner URL</label><input id="ve-banner-url" value="${escHtml(video.banner_image||'')}" /></div>
    <div class="form-group"><label>Yorumlara izin</label><label class="checkbox-label"><input type="checkbox" id="ve-allow-comments" ${video.allow_comments? 'checked' : ''} /> Açık</label></div>
    <div class="form-group"><label>Aktif</label><label class="checkbox-label"><input type="checkbox" id="ve-active" ${video.active? 'checked' : ''} /> Aktif</label></div>
    <div class="form-group"><label>Reals</label><label class="checkbox-label"><input type="checkbox" id="ve-is-reals" ${video.is_reals? 'checked' : ''} /> Reals olarak işaretle</label></div>
    <button class="btn btn-primary" id="ve-save" style="width:100%;justify-content:center"><i class="fas fa-save"></i> Kaydet</button>
    <div id="ve-msg" class="form-error mt-4"></div>
  `);

  document.getElementById('ve-save').addEventListener('click', async () => {
    const btn = document.getElementById('ve-save'); btn.disabled=true; btn.innerHTML='<div class="spinner" style="width:14px;height:14px"></div> Kaydediliyor...';
    const file = document.getElementById('ve-video-file').files[0];
    let videoUrl = document.getElementById('ve-video-url').value.trim();
    try {
      if (file) {
        const fd = new FormData(); fd.append('file', file);
        const uploadRes = await fetch('/api/admin/upload-video', { method:'POST', headers:{'X-Admin-Token':adminToken}, body: fd });
        const data = await uploadRes.json(); if (!uploadRes.ok) throw new Error(data.error||'Yükleme hatası');
        videoUrl = data.url;
      }
      const payload = {
        title: document.getElementById('ve-title').value.trim(),
        description: document.getElementById('ve-description').value.trim(),
        video_url: videoUrl,
        banner_image: document.getElementById('ve-banner-url').value.trim(),
        allow_comments: document.getElementById('ve-allow-comments').checked,
        active: document.getElementById('ve-active').checked,
        is_reals: document.getElementById('ve-is-reals').checked
      };
      await adminApi('/video/' + video.id, { method:'PUT', body: JSON.stringify(payload) });
      toast('Video güncellendi'); hideModal(); loadSection('videos');
    } catch (e) { document.getElementById('ve-msg').textContent = e.message; }
    finally { btn.disabled=false; btn.innerHTML='<i class="fas fa-save"></i> Kaydet'; }
  });
}

// ===== MÜZİK REKLAMLARI =====
async function renderMusicAds(main) {
  let ads = [];
  try { ads = await adminApi('/music-ads'); } catch (e) { main.innerHTML = `<p style="padding:20px;color:var(--red2)">${escHtml(e.message)}</p>`; return; }
  main.innerHTML = `<div class="adm-section-header"><div class="adm-section-title"><div class="icon-pill"><i class="fas fa-headphones"></i></div> Müzik Reklamları</div><button class="btn btn-primary" id="ma-new"><i class="fas fa-plus"></i> Reklam Ekle</button></div>
    <div class="card"><div class="table-wrap"><table><thead><tr><th>Panel ID</th><th>Başlık</th><th>Öncelik</th><th>Boost</th><th>Dinlenme</th><th>Tıklama</th><th>Durum</th><th></th></tr></thead><tbody>
      ${ads.length ? ads.map(a => `<tr><td><code>${escHtml(a.portal_code)}</code></td><td>${escHtml(a.title)}</td><td>${a.priority}</td><td>${a.boost_points}</td><td>${a.play_count}</td><td>${a.click_count}</td><td>${a.active ? 'Aktif' : 'Pasif'}</td><td><button class="btn btn-outline btn-xs ma-edit" data-id="${a.id}">Düzenle</button> <button class="btn btn-danger btn-xs ma-delete" data-id="${a.id}">Sil</button></td></tr>`).join('') : '<tr><td colspan="8" style="text-align:center;padding:28px">Henüz ses reklamı yok.</td></tr>'}
    </tbody></table></div></div>`;
  $('#ma-new')?.addEventListener('click', () => showMusicAdModal());
  main.querySelectorAll('.ma-edit').forEach(btn => btn.addEventListener('click', () => showMusicAdModal(ads.find(a => String(a.id) === btn.dataset.id))));
  main.querySelectorAll('.ma-delete').forEach(btn => btn.addEventListener('click', async () => { if (!confirm('Reklam silinsin mi?')) return; try { await adminApi('/music-ads/'+btn.dataset.id,{method:'DELETE'}); renderMusicAds(main); } catch(e) { toast(e.message,'error'); } }));
}
function showMusicAdModal(ad = null) {
  showModal(ad ? 'Ses Reklamını Düzenle' : 'Yeni Ses Reklamı', `<div class="form-group"><label>Reklam başlığı</label><input id="ma-title" value="${escHtml(ad?.title||'')}" /></div>
    <div class="form-group"><label>Site adresi</label><input id="ma-site" value="${escHtml(ad?.site_url||'')}" placeholder="https://ornek.com" /></div>
    <div class="form-row"><div class="form-group"><label>Öncelik</label><input id="ma-priority" type="number" value="${ad?.priority||0}" /></div><div class="form-group"><label>Boost puanı</label><input id="ma-boost" type="number" value="${ad?.boost_points||0}" /></div></div>
    <div class="form-group"><label>Ses dosyası ${ad ? '(değiştirmek için seçin)' : ''}</label><input id="ma-audio" type="file" accept="audio/*" /></div><div class="form-group"><label>Kapak görseli</label><input id="ma-cover" type="file" accept="image/*" /></div>
    <label class="checkbox-label" style="margin-bottom:16px"><input id="ma-active" type="checkbox" ${!ad || ad.active ? 'checked':''} /> Aktif</label><button id="ma-save" class="btn btn-primary" style="width:100%">Kaydet</button><div id="ma-err" class="form-error mt-4"></div>`);
  $('#ma-save')?.addEventListener('click', async () => { const fd=new FormData(); fd.append('title',$('#ma-title').value.trim()); fd.append('site_url',$('#ma-site').value.trim()); fd.append('priority',$('#ma-priority').value); fd.append('boost_points',$('#ma-boost').value); fd.append('active',$('#ma-active').checked); const au=$('#ma-audio').files[0], co=$('#ma-cover').files[0]; if(au)fd.append('audio',au); if(co)fd.append('cover',co); try { const r=await fetch('/api/admin/music-ads'+(ad?'/'+ad.id:''),{method:ad?'PUT':'POST',headers:{'X-Admin-Token':adminToken},body:fd}); const d=await r.json(); if(!r.ok)throw new Error(d.error||'Hata'); hideModal(); loadSection('music-ads'); }catch(e){$('#ma-err').textContent=e.message;} });
}

// ===== VIDEO ADS =====
async function renderVideoAds(main) {
  let ads = [];
  try { ads = await adminApi('/video-ads'); } catch (e) {
    main.innerHTML = `<div class="adm-section-header"><div class="adm-section-title"><div class="icon-pill"><i class="fas fa-bullhorn"></i></div> Video Reklamları</div></div><div class="card"><div class="card-body" style="color:var(--red2);padding:20px"><i class="fas fa-exclamation-circle"></i> ${escHtml(e.message)}</div></div>`;
    return;
  }
  main.innerHTML = `
    <div class="adm-section-header" style="align-items:center">
      <div class="adm-section-title"><div class="icon-pill"><i class="fas fa-bullhorn"></i></div> Video Reklamları <span style="font-size:13px;font-weight:400;color:var(--text2)">(${ads.length})</span></div>
      <button class="btn btn-primary btn-sm" id="add-video-ad-btn"><i class="fas fa-plus"></i> Yeni Reklam</button>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>ID</th><th>Başlık</th><th>Site</th><th>Öncelik</th><th>Zaman</th><th>Durum</th><th>İşlem</th></tr></thead>
          <tbody id="video-ads-tbody"></tbody>
        </table>
      </div>
    </div>`;

  const renderTable = list => {
    const tbody = $('#video-ads-tbody'); if (!tbody) return;
    if (!list.length) { tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text3);padding:32px">Reklam bulunamadı</td></tr>'; return; }
    tbody.innerHTML = list.map(ad => `<tr>
      <td style="color:var(--text3);font-size:12px">#${ad.id}</td>
      <td style="max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(ad.title)}">${escHtml(ad.title)}</td>
      <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(ad.site_url)}"><a href="${escHtml(ad.site_url)}" target="_blank" rel="noopener noreferrer">${escHtml(ad.site_url)}</a></td>
      <td style="color:var(--text3);font-size:12px">${ad.priority || 0}</td>
      <td style="color:var(--text3);font-size:12px">${ad.display_after_seconds || 0}s</td>
      <td style="color:var(--text3);font-size:12px">${ad.active?'<span class="badge badge-green">Aktif</span>':'<span class="badge badge-red">Pasif</span>'}</td>
      <td>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn btn-outline btn-xs edit-ad-btn" data-id="${ad.id}">Düzenle</button>
          <button class="btn btn-danger btn-xs delete-ad-btn" data-id="${ad.id}">Sil</button>
        </div>
      </td>
    </tr>`).join('');
    tbody.querySelectorAll('.edit-ad-btn').forEach(btn => btn.addEventListener('click', () => {
      const ad = ads.find(x => x.id == btn.dataset.id);
      if (ad) showVideoAdModal(ad);
    }));
    tbody.querySelectorAll('.delete-ad-btn').forEach(btn => btn.addEventListener('click', async () => {
      if (!confirm('Bu reklamı silmek istediğine emin misin?')) return;
      try { await adminApi('/video-ads/' + btn.dataset.id, { method:'DELETE' }); toast('Reklam silindi'); ads = ads.filter(x => x.id != btn.dataset.id); renderTable(ads); }
      catch (e) { toast(e.message,'error'); }
    }));
  };

  renderTable(ads);
  $('#add-video-ad-btn')?.addEventListener('click', () => showVideoAdModal());
}

function showVideoAdModal(ad = {}) {
  const isEdit = !!ad.id;
  showModal(`${isEdit ? 'Reklam Düzenle' : 'Yeni Reklam'}`, `
    <div class="form-group"><label>Başlık</label><input id="va-title" value="${escHtml(ad.title||'')}" /></div>
    <div class="form-group"><label>Reklam Videosu</label><input type="file" id="va-video-file" accept="video/*" /></div>
    <div class="form-group"><label>Site Linki</label><input id="va-site-url" value="${escHtml(ad.site_url||'')}" placeholder="https://ornek.com" /></div>
    <div class="form-group"><label>Konum</label>
      <select id="va-position">
        <option value="bottom-right" ${ad.position==='bottom-right'?'selected':''}>Sağ Alt</option>
        <option value="bottom-left" ${ad.position==='bottom-left'?'selected':''}>Sol Alt</option>
        <option value="top-right" ${ad.position==='top-right'?'selected':''}>Sağ Üst</option>
        <option value="top-left" ${ad.position==='top-left'?'selected':''}>Sol Üst</option>
      </select>
    </div>
    <div class="form-group"><label>Sıralama Önceliği</label><input id="va-priority" type="number" value="${escHtml(ad.priority||0)}" /></div>
    <div class="form-group"><label>Gösterim Süresi (sn)</label><input id="va-display-after" type="number" min="0" value="${escHtml(ad.display_after_seconds||0)}" /></div>
    <div class="form-group"><label>Aktif</label><label class="checkbox-label"><input type="checkbox" id="va-active" ${ad.active? 'checked' : ''} /> Aktif</label></div>
    <button class="btn btn-primary" id="va-save" style="width:100%;justify-content:center"><i class="fas fa-save"></i> Kaydet</button>
    <div id="va-msg" class="form-error mt-4"></div>
  `);

  document.getElementById('va-save').addEventListener('click', async () => {
    const btn = document.getElementById('va-save'); btn.disabled=true; btn.innerHTML='<div class="spinner" style="width:14px;height:14px"></div> Kaydediliyor...';
    try {
      const file = document.getElementById('va-video-file').files[0];
      let videoUrl = ad.video_url || '';
      if (file) {
        const fd = new FormData(); fd.append('file', file);
        const uploadRes = await fetch('/api/admin/upload-video', { method:'POST', headers:{'X-Admin-Token':adminToken}, body: fd });
        const data = await uploadRes.json();
        if (!uploadRes.ok) throw new Error(data.error || 'Reklam videosu yüklenemedi');
        videoUrl = data.url;
      }
      const payload = {
        title: document.getElementById('va-title').value.trim(),
        video_url: videoUrl,
        site_url: document.getElementById('va-site-url').value.trim(),
        position: document.getElementById('va-position').value,
        priority: parseInt(document.getElementById('va-priority').value, 10) || 0,
        display_after_seconds: parseInt(document.getElementById('va-display-after').value, 10) || 0,
        active: document.getElementById('va-active').checked
      };
      if (!payload.title || !payload.video_url) throw new Error('Başlık ve reklam videosu gereklidir');
      if (isEdit) {
        await adminApi('/video-ads/' + ad.id, { method:'PUT', body: JSON.stringify(payload) });
      } else {
        await adminApi('/video-ads', { method:'POST', body: JSON.stringify(payload) });
      }
      toast('Reklam kaydedildi'); hideModal(); loadSection('video-ads');
    } catch (e) { document.getElementById('va-msg').textContent = e.message; }
    finally { btn.disabled=false; btn.innerHTML='<i class="fas fa-save"></i> Kaydet'; }
  });
}

// ===== ARTISTS =====
async function renderArtists(main) {
  let artists = [];
  try { artists = await adminApi('/artists'); } catch (e) {
    main.innerHTML = `<div class="adm-section-header"><div class="adm-section-title"><div class="icon-pill"><i class="fas fa-microphone-alt"></i></div> Artistler</div></div><div class="card"><div class="card-body" style="color:var(--red2);padding:20px"><i class="fas fa-exclamation-circle"></i> ${escHtml(e.message)}</div></div>`;
    return;
  }

  const renderTable = (list) => {
    const tbody = $('#artists-tbody'); if (!tbody) return;
    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--text3);padding:32px"><i class="fas fa-microphone-slash" style="font-size:28px;margin-bottom:8px;display:block"></i>Artist bulunamadı</td></tr>`;
      return;
    }
    tbody.innerHTML = list.map(a => `<tr>
      <td>
        <div style="display:flex;align-items:center;gap:10px">
          ${a.avatar ? `<img src="${escHtml(a.avatar)}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;border:2px solid var(--border-red)" />`
            : `<div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,var(--red),#7f1d1d);display:flex;align-items:center;justify-content:center;color:#fff;font-size:14px"><i class="fas fa-microphone-alt"></i></div>`}
          <div>
            <div style="font-weight:600;font-size:13px">${escHtml(a.username)}</div>
            ${a.artist_display_name ? `<div style="font-size:11px;color:var(--text3)">${escHtml(a.artist_display_name)}</div>` : ''}
          </div>
        </div>
      </td>
      <td style="font-size:12px;color:var(--text2)">${escHtml(a.artist_genre||'—')}</td>
      <td>
        <div style="font-size:13px;font-weight:600;color:var(--purple)">${a.song_count||0}</div>
        <div style="font-size:10px;color:var(--text3)">${Number(a.total_plays||0).toLocaleString('tr-TR')} dinlenme</div>
      </td>
      <td style="font-size:11px;color:var(--text3)">${a.artist_since ? formatDate(a.artist_since) : '—'}</td>
      <td>${a.banned ? '<span class="badge badge-red"><i class="fas fa-ban"></i> Banlı</span>' : '<span class="badge badge-green"><i class="fas fa-check"></i> Aktif</span>'}</td>
      <td>
        <div style="display:flex;gap:4px;flex-wrap:wrap">
          <button class="btn btn-blue btn-xs view-artist-songs-btn" data-id="${a.id}" data-name="${escHtml(a.username)}" title="Şarkılarını Gör"><i class="fas fa-music"></i> Şarkılar</button>
          <button class="btn btn-outline btn-xs edit-artist-btn" data-id="${a.id}" title="Bilgileri Düzenle"><i class="fas fa-edit"></i></button>
          <button class="btn btn-danger btn-xs revoke-artist-btn" data-id="${a.id}" data-name="${escHtml(a.username)}" title="Artist Rozetini Kaldır"><i class="fas fa-microphone-slash"></i></button>
        </div>
      </td>
    </tr>`).join('');

    tbody.querySelectorAll('.view-artist-songs-btn').forEach(btn => {
      btn.addEventListener('click', () => showArtistSongsModal(btn.dataset.id, btn.dataset.name));
    });
    tbody.querySelectorAll('.edit-artist-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const a = artists.find(x => x.id == btn.dataset.id);
        if (a) showEditArtistModal(a, artists, renderTable);
      });
    });
    tbody.querySelectorAll('.revoke-artist-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm(`${btn.dataset.name} kullanıcısının artist rozeti kaldırılsın mı?`)) return;
        try {
          await adminApi('/artists/'+btn.dataset.id, { method:'PUT', body:JSON.stringify({ is_artist: 0 }) });
          toast('Artist rozeti kaldırıldı');
          artists = artists.filter(a => a.id != btn.dataset.id);
          renderTable(artists);
        } catch(e) { toast(e.message, 'error'); }
      });
    });
  };

  main.innerHTML = `
    <div class="adm-section-header">
      <div class="adm-section-title">
        <div class="icon-pill"><i class="fas fa-microphone-alt"></i></div>
        Artistler
        <span style="font-size:13px;font-weight:400;color:var(--text2)">(${artists.length})</span>
      </div>
      <div class="adm-search"><i class="fas fa-search"></i><input type="text" id="artist-search" placeholder="Artist veya kullanıcı ara..." style="min-width:240px" /></div>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Artist</th><th>Tür</th><th>Şarkılar</th><th>Artist'ten beri</th><th>Durum</th><th>İşlem</th></tr></thead>
          <tbody id="artists-tbody"></tbody>
        </table>
      </div>
    </div>`;

  renderTable(artists);
  $('#artist-search').addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    renderTable(artists.filter(a =>
      a.username.toLowerCase().includes(q) ||
      (a.artist_display_name||'').toLowerCase().includes(q) ||
      (a.artist_genre||'').toLowerCase().includes(q)
    ));
  });
}

async function showArtistSongsModal(artistId, artistName) {
  showModal(`🎵 ${artistName} — Şarkılar`, `<div class="loading-center" style="padding:40px"><div class="spinner"></div></div>`);
  let songs = [];
  try { songs = await adminApi('/artists/'+artistId+'/songs'); } catch(e) {
    $('#modal-body').innerHTML = `<div style="color:var(--red2);padding:20px">${escHtml(e.message)}</div>`; return;
  }

  const renderSongs = (list) => {
    const wrap = $('#artist-songs-wrap'); if (!wrap) return;
    if (!list.length) {
      wrap.innerHTML = '<div style="text-align:center;color:var(--text3);padding:32px"><i class="fas fa-music" style="font-size:28px;margin-bottom:8px;display:block"></i>Şarkı yok</div>';
      return;
    }
    wrap.innerHTML = list.map(s => {
      const isBanned = s.status === 'suspended';
      const banExpired = s.ban_until && new Date(s.ban_until) < new Date();
      return `<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border)">
        ${s.cover_url
          ? `<img src="${escHtml(s.cover_url)}" style="width:44px;height:44px;border-radius:8px;object-fit:cover;flex-shrink:0" />`
          : `<div style="width:44px;height:44px;border-radius:8px;background:var(--bg4);display:flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--text3)"><i class="fas fa-music"></i></div>`}
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(s.title)}</div>
          <div style="font-size:11px;color:var(--text2);margin-top:2px">
            ${escHtml(s.artist_name)}${s.genre ? ` · ${escHtml(s.genre)}` : ''} · ${s.play_count} dinlenme
          </div>
          ${isBanned ? `<div style="font-size:10px;color:var(--red2);margin-top:2px">
            <i class="fas fa-ban"></i> ${escHtml(s.ban_reason||'Ban')}
            ${s.ban_until && !banExpired
              ? ` · <span style="color:var(--orange)">${new Date(s.ban_until).toLocaleDateString('tr-TR')} tarihine kadar</span>`
              : s.ban_until ? ' <span style="color:var(--text3)">(süresi doldu)</span>' : ' <span style="color:var(--text3)">(kalıcı)</span>'}
          </div>` : ''}
        </div>
        <div style="display:flex;gap:4px;align-items:center;flex-shrink:0">
          ${isBanned && !banExpired
            ? `<button class="btn btn-green btn-xs song-unban-btn" data-id="${s.id}"><i class="fas fa-unlock"></i> Banı Kaldır</button>`
            : `<button class="btn btn-danger btn-xs song-ban-btn" data-id="${s.id}" data-title="${escHtml(s.title)}"><i class="fas fa-ban"></i> Ban</button>`}
          <span style="font-size:10px;color:var(--text3)">${timeAgo(s.created_at)}</span>
        </div>
      </div>`;
    }).join('');

    wrap.querySelectorAll('.song-ban-btn').forEach(btn => {
      btn.addEventListener('click', () => showSongBanModal(btn.dataset.id, btn.dataset.title, songs, renderSongs));
    });
    wrap.querySelectorAll('.song-unban-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Banı kaldırmak istediğine emin misin?')) return;
        try {
          await adminApi('/songs/'+btn.dataset.id+'/unban', { method:'POST' });
          toast('Ban kaldırıldı');
          const s = songs.find(x => x.id == btn.dataset.id);
          if (s) { s.status = 'active'; s.ban_reason = ''; s.ban_until = null; }
          renderSongs(songs);
        } catch(e) { toast(e.message, 'error'); }
      });
    });
  };

  $('#modal-body').innerHTML = `
    <div style="margin-bottom:12px;display:flex;align-items:center;justify-content:space-between">
      <span style="font-size:12px;color:var(--text2)">${songs.length} şarkı</span>
      <div class="adm-search" style="max-width:200px"><i class="fas fa-search"></i><input id="asong-search" type="text" placeholder="Ara..." style="min-width:0" /></div>
    </div>
    <div id="artist-songs-wrap"></div>`;
  renderSongs(songs);

  $('#asong-search').addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    renderSongs(songs.filter(s => s.title.toLowerCase().includes(q) || s.artist_name.toLowerCase().includes(q)));
  });
}

function showSongBanModal(songId, songTitle, songs, renderSongs) {
  showModal(`🚫 Şarkı Banla — ${songTitle}`, `
    <div style="background:rgba(220,38,38,0.07);border:1px solid var(--border-red);border-radius:10px;padding:14px;margin-bottom:16px;font-size:12px;color:var(--text2)">
      <i class="fas fa-info-circle" style="color:var(--red2);margin-right:6px"></i>
      Ban uygulanan şarkı dinleyicilere gösterilmez. Süreli ban bitince otomatik aktife döner.
    </div>
    <div class="form-group">
      <label>Ban Sebebi</label>
      <input id="ban-reason" placeholder="Telif ihlali, uygunsuz içerik..." />
    </div>
    <div class="form-group">
      <label>Ban Süresi</label>
      <select id="ban-duration">
        <option value="0">Kalıcı (elle kaldırana kadar)</option>
        <option value="1">1 Gün</option>
        <option value="3">3 Gün</option>
        <option value="7">7 Gün</option>
        <option value="14">14 Gün</option>
        <option value="30">30 Gün</option>
        <option value="custom">Özel Gün Sayısı...</option>
      </select>
    </div>
    <div id="custom-days-wrap" class="form-group hidden">
      <label>Gün Sayısı</label>
      <input id="custom-days" type="number" min="1" placeholder="Örn: 60" />
    </div>
    <div id="ban-preview" style="font-size:12px;margin-bottom:16px;padding:8px 12px;border-radius:8px;background:var(--bg4)"></div>
    <div style="display:flex;gap:8px">
      <button class="btn btn-outline" id="ban-cancel-btn" style="flex:1;justify-content:center">İptal</button>
      <button class="btn btn-primary" id="ban-confirm-btn" style="flex:1;justify-content:center"><i class="fas fa-ban"></i> Banı Uygula</button>
    </div>
    <div id="ban-err" class="form-error mt-4"></div>
  `);

  const updatePreview = () => {
    const d = $('#ban-duration').value;
    const days = d === 'custom' ? parseInt($('#custom-days')?.value)||0 : parseInt(d);
    const p = $('#ban-preview');
    if (!p) return;
    if (!days) {
      p.innerHTML = '<i class="fas fa-infinity" style="color:var(--red2);margin-right:6px"></i><span style="color:var(--red2)">Kalıcı ban — admin elle kaldırana kadar devam eder</span>';
    } else {
      const until = new Date(Date.now() + days * 86400000);
      p.innerHTML = `<i class="fas fa-clock" style="color:var(--orange);margin-right:6px"></i><span style="color:var(--orange)">Bitiş: ${until.toLocaleDateString('tr-TR', {day:'2-digit',month:'long',year:'numeric'})}</span>`;
    }
  };
  updatePreview();

  $('#ban-duration').addEventListener('change', () => {
    $('#custom-days-wrap').classList.toggle('hidden', $('#ban-duration').value !== 'custom');
    updatePreview();
  });
  $('#custom-days')?.addEventListener('input', updatePreview);
  $('#ban-cancel-btn').addEventListener('click', hideModal);

  $('#ban-confirm-btn').addEventListener('click', async () => {
    const btn = $('#ban-confirm-btn'); const err = $('#ban-err');
    const reason = $('#ban-reason').value.trim();
    const d = $('#ban-duration').value;
    const days = d === 'custom' ? parseInt($('#custom-days')?.value)||0 : parseInt(d);
    if (!reason) { err.textContent = 'Ban sebebi zorunlu'; return; }
    btn.disabled = true; btn.innerHTML = '<div class="spinner" style="width:14px;height:14px"></div>';
    try {
      await adminApi('/songs/'+songId+'/ban', { method:'POST', body:JSON.stringify({ reason, duration_days: days }) });
      toast('Şarkıya ban uygulandı');
      hideModal();
      const s = songs.find(x => x.id == songId);
      if (s) { s.status='suspended'; s.ban_reason=reason; s.ban_until=days>0?new Date(Date.now()+days*86400000).toISOString():null; }
      if (renderSongs) renderSongs(songs);
    } catch(e) { err.textContent=e.message; btn.disabled=false; btn.innerHTML='<i class="fas fa-ban"></i> Banı Uygula'; }
  });
}

function showEditArtistModal(artist, list, renderTable) {
  showModal(`✏️ Artist Düzenle — ${escHtml(artist.username)}`, `
    <div style="display:flex;align-items:center;gap:12px;padding:12px;background:var(--bg4);border-radius:10px;margin-bottom:16px">
      ${artist.avatar
        ? `<img src="${escHtml(artist.avatar)}" style="width:44px;height:44px;border-radius:50%;object-fit:cover" />`
        : `<div style="width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,var(--red),#7f1d1d);display:flex;align-items:center;justify-content:center;color:#fff;font-size:16px"><i class="fas fa-microphone-alt"></i></div>`}
      <div>
        <div style="font-weight:700">${escHtml(artist.username)}</div>
        <div style="font-size:11px;color:var(--text3)">Artist'ten beri: ${artist.artist_since ? formatDate(artist.artist_since) : '—'}</div>
      </div>
    </div>
    <div class="form-group">
      <label>Sahne Adı / Display Name</label>
      <input id="ea-display" value="${escHtml(artist.artist_display_name||'')}" placeholder="Kullanıcı adından farklı sanatçı adı..." />
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Müzik Türü</label>
        <input id="ea-genre" value="${escHtml(artist.artist_genre||'')}" placeholder="Pop, Rock, Hip-Hop..." />
      </div>
      <div class="form-group">
        <label>Website / Sosyal Medya</label>
        <input id="ea-website" value="${escHtml(artist.artist_website||'')}" placeholder="https://..." />
      </div>
    </div>
    <div class="form-group">
      <label>Artist Bio</label>
      <textarea id="ea-bio" rows="3" placeholder="Artist hakkında kısa açıklama...">${escHtml(artist.artist_bio||'')}</textarea>
    </div>
    <div style="background:rgba(220,38,38,0.07);border:1px solid var(--border-red);border-radius:10px;padding:12px;margin-bottom:16px">
      <label class="checkbox-label" style="margin:0">
        <input type="checkbox" id="ea-is-artist" ${artist.is_artist ? 'checked' : ''} />
        <span><i class="fas fa-microphone-alt" style="color:var(--red2);margin-right:6px"></i> Artist rozeti aktif</span>
      </label>
      <div style="font-size:11px;color:var(--text3);margin-top:6px;margin-left:26px">Rozeti kaldırırsan kullanıcı yeni şarkı yükleyemez. Mevcut şarkılar silinmez.</div>
    </div>
    <button class="btn btn-primary" id="ea-save" style="width:100%;justify-content:center"><i class="fas fa-save"></i> Kaydet</button>
    <div id="ea-err" class="form-error mt-4"></div>
  `);

  $('#ea-save').addEventListener('click', async () => {
    const btn = $('#ea-save'); const err = $('#ea-err');
    btn.disabled=true; btn.innerHTML='<div class="spinner" style="width:14px;height:14px"></div> Kaydediliyor...';
    try {
      const body = {
        artist_display_name: $('#ea-display').value.trim(),
        artist_genre: $('#ea-genre').value.trim(),
        artist_website: $('#ea-website').value.trim(),
        artist_bio: $('#ea-bio').value.trim(),
        is_artist: $('#ea-is-artist').checked ? 1 : 0
      };
      await adminApi('/artists/'+artist.id, { method:'PUT', body:JSON.stringify(body) });
      toast('Artist bilgileri güncellendi');
      const idx = list.findIndex(a => a.id == artist.id);
      if (idx !== -1) {
        if (!body.is_artist) { list.splice(idx, 1); }
        else { list[idx] = { ...list[idx], ...body }; }
      }
      hideModal();
      if (renderTable) renderTable(list);
    } catch(e) { err.textContent=e.message; btn.disabled=false; btn.innerHTML='<i class="fas fa-save"></i> Kaydet'; }
  });
}

// ===== LEVELS =====
async function renderLevels(main) {
  let levels = [];
  try { levels = await adminApi('/levels'); } catch (e) {
    main.innerHTML = `<p style="color:var(--red2);padding:20px">${e.message}</p>`; return;
  }
  const canManageLevels = adminProfile?.is_super_admin || hasPermission('can_manage_levels');
  const renderTable = () => {
    const tbody = $('#levels-tbody'); if (!tbody) return;
    if (!levels.length) { tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text3);padding:32px">Seviye yok</td></tr>'; return; }
    tbody.innerHTML = levels.map(l => `<tr>
      <td><span style="font-size:18px"><i class="${escHtml(l.icon||'fas fa-star')}" style="color:${escHtml(l.color||'#aaa')}"></i></span></td>
      <td style="font-weight:600">${escHtml(l.name)}</td>
      <td><span class="badge" style="background:${escHtml(l.color||'#666')};color:#fff;border:none">${escHtml(l.color||'—')}</span></td>
      <td style="font-size:12px;color:var(--text2)">
        Forum: ${l.min_forums||0} / Kitap: ${l.min_books||0} / Yorum: ${l.min_comments||0}
        ${l.require_any ? '<span class="badge badge-blue" style="margin-left:4px">veya</span>' : '<span class="badge badge-gray" style="margin-left:4px">ve</span>'}
      </td>
      <td style="font-size:12px;color:var(--text2)">${l.order_num}</td>
      <td>
        <div style="display:flex;gap:4px">
          ${canManageLevels ? `<button class="btn btn-outline btn-xs edit-level-btn" data-id="${l.id}" title="Düzenle"><i class="fas fa-edit"></i></button><button class="btn btn-danger btn-xs del-level-btn" data-id="${l.id}"><i class="fas fa-trash"></i></button>` : '<span style="color:var(--text3);font-size:12px"><i class="fas fa-eye"></i> Sadece görüntüleme</span>'}
        </div>
      </td>
    </tr>`).join('');
    tbody.querySelectorAll('.edit-level-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const l = levels.find(x => x.id == btn.dataset.id); if (!l) return;
        showModal(`✏️ Seviye Düzenle — ${l.name}`, `
          <div class="form-group"><label>İsim</label><input id="elv-name" value="${escHtml(l.name)}" /></div>
          <div class="form-row">
            <div class="form-group"><label>Min. Forum</label><input id="elv-forums" type="number" value="${l.min_forums||0}" /></div>
            <div class="form-group"><label>Min. Kitap</label><input id="elv-books" type="number" value="${l.min_books||0}" /></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>Min. Yorum</label><input id="elv-comments" type="number" value="${l.min_comments||0}" /></div>
            <div class="form-group"><label>Min. Kitap Sayfası</label><input id="elv-pages" type="number" value="${l.min_book_pages||0}" /></div>
          </div>
          <div class="form-group">
            <label class="checkbox-label" style="margin:0">
              <input type="checkbox" id="elv-require-any" style="width:auto" ${l.require_any ? 'checked' : ''} />
              <div>
                <span style="font-weight:600;font-size:13px">Herhangi birini tamamlayınca atla</span>
                <div style="font-size:11px;color:var(--text3);margin-top:2px">İşaretliyse konu, kitap veya yorumdan birini yapan atlar.</div>
              </div>
            </label>
          </div>
          <div id="elv-err" class="form-error"></div>
          <button class="btn btn-primary" id="elv-save" style="width:100%;justify-content:center;margin-top:12px"><i class="fas fa-save"></i> Kaydet</button>
        `);
        $('#elv-save').addEventListener('click', async () => {
          const btn2 = $('#elv-save'); const err = $('#elv-err');
          btn2.disabled=true; btn2.innerHTML='<div class="spinner" style="width:14px;height:14px"></div>';
          try {
            const body = {
              name: $('#elv-name').value.trim() || l.name,
              min_forums: +$('#elv-forums').value,
              min_books: +$('#elv-books').value,
              min_comments: +$('#elv-comments').value,
              min_book_pages: +$('#elv-pages').value,
              require_any: $('#elv-require-any').checked ? 1 : 0
            };
            await adminApi('/level/'+l.id, { method:'PUT', body:JSON.stringify(body) });
            toast('Seviye güncellendi');
            const idx = levels.findIndex(x=>x.id==l.id);
            if (idx !== -1) levels[idx] = { ...levels[idx], ...body };
            hideModal(); renderTable();
          } catch(e) { err.textContent=e.message; btn2.disabled=false; btn2.innerHTML='<i class="fas fa-save"></i> Kaydet'; }
        });
      });
    });
    tbody.querySelectorAll('.del-level-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Bu seviyeyi silmek istediğine emin misin?')) return;
        try { await adminApi('/level/'+btn.dataset.id, {method:'DELETE'}); toast('Seviye silindi'); levels = levels.filter(l=>l.id!=btn.dataset.id); renderTable(); }
        catch (e) { toast(e.message, 'error'); }
      });
    });
  };
  main.innerHTML = `
    <div class="adm-section-header">
      <div class="adm-section-title"><div class="icon-pill"><i class="fas fa-layer-group"></i></div> Seviyeler</div>
          ${canManageLevels ? '<button class="btn btn-primary btn-sm" id="new-level-btn"><i class="fas fa-plus"></i> Yeni Seviye</button>' : '<span style="color:var(--text3);font-size:12px"><i class="fas fa-eye"></i> Sadece görüntüleme</span>'}
    </div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>İkon</th><th>İsim</th><th>Renk</th><th>Koşullar</th><th>Sıra</th><th>İşlem</th></tr></thead>
          <tbody id="levels-tbody"></tbody>
        </table>
      </div>
    </div>`;
  renderTable();
  $('#new-level-btn')?.addEventListener('click', () => {
    showModal('Yeni Seviye Ekle', `
      <div class="form-group"><label>İsim</label><input id="lv-name" /></div>
      <div class="form-row">
        <div class="form-group" style="flex:1">
          <label>İkon <span style="font-size:11px;color:var(--text3)">(FA class veya emoji)</span></label>
          <div style="display:flex;gap:8px;align-items:center">
            <div id="lv-icon-preview" style="width:36px;height:36px;background:var(--bg4);border:1px solid var(--border);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">
              <i class="fas fa-star"></i>
            </div>
            <input id="lv-icon" placeholder="fas fa-star veya ⭐" value="fas fa-star" style="flex:1" />
          </div>
          <button type="button" class="btn btn-outline btn-sm" id="lv-icon-picker-btn" style="margin-top:6px;width:100%"><i class="fas fa-icons"></i> İkon Seç</button>
          <div id="lv-icon-grid" style="display:none;max-height:220px;overflow-y:auto;background:var(--bg4);border:1px solid var(--border);border-radius:8px;padding:8px;margin-top:6px;display:grid;grid-template-columns:repeat(8,1fr);gap:4px"></div>
        </div>
        <div class="form-group" style="flex:0 0 100px">
          <label>Renk</label>
          <input id="lv-color" type="color" value="#dc2626" style="height:36px;padding:2px;cursor:pointer" />
        </div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Min. Forum</label><input id="lv-forums" type="number" value="0" /></div>
        <div class="form-group"><label>Min. Kitap</label><input id="lv-books" type="number" value="0" /></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Min. Kitap Sayfası</label><input id="lv-pages" type="number" value="0" /></div>
        <div class="form-group"><label>Sıra</label><input id="lv-order" type="number" value="${levels.length+1}" /></div>
      </div>
      <div class="form-group">
        <label class="checkbox-label" style="margin:0">
          <input type="checkbox" id="lv-require-any" style="width:auto" />
          <div>
            <span style="font-weight:600;font-size:13px">Herhangi birini tamamlayınca atla</span>
            <div style="font-size:11px;color:var(--text3);margin-top:2px">İşaretliyse konu, kitap veya yorumdan birini yapan atlar. İşaretsizse hepsini yapması gerekir.</div>
          </div>
        </label>
      </div>
      <div id="lv-err" class="form-error"></div>
      <button class="btn btn-primary" style="width:100%;justify-content:center;margin-top:12px" id="lv-save-btn"><i class="fas fa-save"></i> Kaydet</button>
    `);

    // İkon önizleme güncelleyici
    const iconInput = $('#lv-icon');
    const iconPreview = $('#lv-icon-preview');
    const iconGrid = $('#lv-icon-grid');
    let gridOpen = false;

    const updatePreview = () => {
      const v = iconInput.value.trim();
      if (v.startsWith('fa')) {
        iconPreview.innerHTML = `<i class="${escHtml(v)}"></i>`;
      } else {
        iconPreview.textContent = v || '?';
      }
    };
    iconInput.addEventListener('input', updatePreview);

    // İkon grid'ini aç/kapat
    const FA_ICONS = [
      'fas fa-star','fas fa-fire','fas fa-crown','fas fa-gem','fas fa-bolt','fas fa-heart',
      'fas fa-shield','fas fa-dragon','fas fa-feather','fas fa-pen','fas fa-book',
      'fas fa-seedling','fas fa-leaf','fas fa-tree','fas fa-mountain','fas fa-sun',
      'fas fa-moon','fas fa-cloud','fas fa-snowflake','fas fa-wind',
      'fas fa-trophy','fas fa-medal','fas fa-award','fas fa-certificate',
      'fas fa-graduation-cap','fas fa-user-graduate','fas fa-user',
      'fas fa-robot','fas fa-skull','fas fa-ghost','fas fa-hat-wizard',
      'fas fa-rocket','fas fa-satellite','fas fa-meteor','fas fa-globe',
      'fas fa-map-pin','fas fa-compass','fas fa-binoculars',
      'fas fa-code','fas fa-laptop-code','fas fa-terminal','fas fa-bug',
      'fas fa-music','fas fa-headphones','fas fa-microphone','fas fa-guitar',
      'fas fa-camera','fas fa-palette','fas fa-brush','fas fa-film',
      'fas fa-gamepad','fas fa-dice','fas fa-chess',
      'fas fa-coffee','fas fa-mug-hot','fas fa-beer',
      'fas fa-dumbbell','fas fa-running','fas fa-bicycle','fas fa-futbol',
      'fas fa-car','fas fa-plane','fas fa-ship',
      'fas fa-cat','fas fa-dog','fas fa-fish','fas fa-horse',
      'fas fa-circle','fas fa-square','fas fa-diamond','fas fa-infinity'
    ];

    $('#lv-icon-picker-btn').addEventListener('click', () => {
      gridOpen = !gridOpen;
      if (gridOpen) {
        iconGrid.style.display = 'grid';
        iconGrid.innerHTML = FA_ICONS.map(ic => `
          <button type="button" class="icon-pick-btn" data-icon="${ic}" title="${ic}"
            style="background:var(--bg3);border:1px solid var(--border);border-radius:6px;padding:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;transition:all .15s">
            <i class="${ic}"></i>
          </button>`).join('');
        iconGrid.querySelectorAll('.icon-pick-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            iconInput.value = btn.dataset.icon;
            updatePreview();
            iconGrid.style.display = 'none';
            gridOpen = false;
            // Seçilen ikonu vurgula
            iconGrid.querySelectorAll('.icon-pick-btn').forEach(b => b.style.background = 'var(--bg3)');
            btn.style.background = 'rgba(220,38,38,0.2)';
          });
          btn.addEventListener('mouseover', () => btn.style.background = 'rgba(220,38,38,0.1)');
          btn.addEventListener('mouseout', () => btn.style.background = 'var(--bg3)');
        });
      } else {
        iconGrid.style.display = 'none';
      }
    });

    $('#lv-save-btn').addEventListener('click', async () => {
      const err = $('#lv-err');
      const name = $('#lv-name').value.trim();
      if (!name) { err.textContent='İsim zorunlu'; return; }
      try {
        const body = { name, icon:$('#lv-icon').value.trim()||'fas fa-star', color:$('#lv-color').value, min_forums:+$('#lv-forums').value, min_books:+$('#lv-books').value, min_book_pages:+$('#lv-pages').value, order_num:+$('#lv-order').value, require_any: $('#lv-require-any').checked ? 1 : 0 };
        const nl = await adminApi('/levels', {method:'POST', body:JSON.stringify(body)});
        levels.push(nl); renderTable(); hideModal(); toast('Seviye eklendi');
      } catch(e) { err.textContent=e.message; }
    });
  });
}

// ===== TAGS =====
async function renderTags(main) {
  let tags = [];
  try { tags = await adminApi('/tags'); } catch (e) {
    main.innerHTML = `<p style="color:var(--red2);padding:20px">${e.message}</p>`; return;
  }
  const renderTable = () => {
    const tbody = $('#tags-tbody'); if (!tbody) return;
    if (!tags.length) { tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text3);padding:32px">Etiket yok</td></tr>'; return; }
    tbody.innerHTML = tags.map(t => `<tr>
      <td><span class="badge" style="background:${escHtml(t.color||'#666')}22;color:${escHtml(t.color||'#aaa')};border:1px solid ${escHtml(t.color||'#666')}44">${escHtml(t.name)}</span></td>
      <td style="font-size:12px;color:var(--text3)">${escHtml(t.color||'—')}</td>
      <td>${t.is_system ? '<span class="badge badge-blue">Sistem</span>' : '<span class="badge badge-gray">Özel</span>'}</td>
      <td><button class="btn btn-danger btn-xs del-tag-btn" data-id="${t.id}" ${t.is_system?'disabled':''} title="${t.is_system?'Sistem etiketi silinemez':'Sil'}"><i class="fas fa-trash"></i></button></td>
    </tr>`).join('');
    tbody.querySelectorAll('.del-tag-btn:not([disabled])').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Bu etiketi silmek istediğine emin misin?')) return;
        try { await adminApi('/tag/'+btn.dataset.id, {method:'DELETE'}); toast('Etiket silindi'); tags = tags.filter(t=>t.id!=btn.dataset.id); renderTable(); }
        catch (e) { toast(e.message, 'error'); }
      });
    });
  };
  main.innerHTML = `
    <div class="adm-section-header">
      <div class="adm-section-title"><div class="icon-pill"><i class="fas fa-tags"></i></div> Etiketler</div>
      <button class="btn btn-primary btn-sm" id="new-tag-btn"><i class="fas fa-plus"></i> Yeni Etiket</button>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Etiket</th><th>Renk</th><th>Tür</th><th>İşlem</th></tr></thead>
          <tbody id="tags-tbody"></tbody>
        </table>
      </div>
    </div>`;
  renderTable();
  $('#new-tag-btn').addEventListener('click', () => {
    showModal('Yeni Etiket Ekle', `
      <div class="form-group"><label>İsim</label><input id="tag-name" /></div>
      <div class="form-group"><label>Renk</label><input id="tag-color" type="color" value="#5865F2" /></div>
      <div id="tag-err" class="form-error"></div>
      <button class="btn btn-primary" style="width:100%;justify-content:center;margin-top:12px" id="tag-save-btn"><i class="fas fa-save"></i> Kaydet</button>
    `);
    $('#tag-save-btn').addEventListener('click', async () => {
      const err = $('#tag-err');
      const name = $('#tag-name').value.trim();
      if (!name) { err.textContent='İsim zorunlu'; return; }
      try {
        const nt = await adminApi('/tags', {method:'POST', body:JSON.stringify({name, color:$('#tag-color').value})});
        tags.push(nt); renderTable(); hideModal(); toast('Etiket eklendi');
      } catch(e) { err.textContent=e.message; }
    });
  });
}

// ===== LOGS =====
async function renderLogs(main) {
  let logs = [];
  try { logs = await adminApi('/logs'); } catch (e) {
    main.innerHTML = `<p style="color:var(--red2);padding:20px">${e.message}</p>`; return;
  }
  main.innerHTML = `
    <div class="adm-section-header">
      <div class="adm-section-title"><div class="icon-pill"><i class="fas fa-history"></i></div> Sistem Logları <span style="font-size:13px;font-weight:400;color:var(--text2)">(${logs.length})</span></div>
      <div class="adm-search"><i class="fas fa-search"></i><input type="text" id="log-search" placeholder="Eylem veya aktör ara..." style="min-width:240px" /></div>
    </div>
    <div class="card">
      <div id="logs-list">
        ${logs.length ? logs.map(l => `
          <div style="padding:10px 16px;border-bottom:1px solid var(--border);font-size:13px;display:flex;align-items:center;gap:10px">
            <span style="color:var(--red2);font-weight:600;min-width:100px">${escHtml(l.actor)}</span>
            <span style="color:var(--text2);font-size:11px;margin-right:4px"><i class="fas fa-arrow-right"></i></span>
            <span style="flex:1">${escHtml(l.action)}${l.target?' <span style="color:var(--text3)">→ '+escHtml(l.target)+'</span>':''}</span>
            <span style="color:var(--text3);font-size:11px;white-space:nowrap">${timeAgo(l.created_at)}</span>
          </div>`).join('') : '<div style="padding:32px;text-align:center;color:var(--text3)">Log yok</div>'}
      </div>
    </div>`;
  $('#log-search').addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    const filtered = logs.filter(l => l.actor.toLowerCase().includes(q) || l.action.toLowerCase().includes(q));
    $('#logs-list').innerHTML = filtered.length ? filtered.map(l => `
      <div style="padding:10px 16px;border-bottom:1px solid var(--border);font-size:13px;display:flex;align-items:center;gap:10px">
        <span style="color:var(--red2);font-weight:600;min-width:100px">${escHtml(l.actor)}</span>
        <span style="color:var(--text2);font-size:11px;margin-right:4px"><i class="fas fa-arrow-right"></i></span>
        <span style="flex:1">${escHtml(l.action)}${l.target?' <span style="color:var(--text3)">→ '+escHtml(l.target)+'</span>':''}</span>
        <span style="color:var(--text3);font-size:11px;white-space:nowrap">${timeAgo(l.created_at)}</span>
      </div>`).join('') : '<div style="padding:32px;text-align:center;color:var(--text3)">Sonuç bulunamadı</div>';
  });
}

async function renderRouteLogs(main) {
  let logs = [];
  try { logs = await adminApi('/route-logs'); } catch (e) { main.innerHTML = `<p style="color:var(--red2);padding:20px">${escHtml(e.message)}</p>`; return; }
  const getRedirect = log => { try { return JSON.parse(log.detail || '{}').redirectTarget || '—'; } catch { return log.detail || '—'; } };
  const render = rows => rows.length ? rows.map(log => { let detail = {}; try { detail = JSON.parse(log.detail || '{}'); } catch {} const place = [log.city, log.country].filter(Boolean).join(', ') || 'Konum yok'; return `<div class="route-log-row"><div class="route-log-main"><span class="route-log-user"><i class="fas fa-user"></i>${escHtml(log.actor || 'anonymous')}</span><span class="route-log-route">${escHtml(log.target || '—')}</span><span class="route-log-arrow"><i class="fas fa-arrow-right"></i></span><span class="route-log-redirect">${escHtml(detail.redirectTarget || '—')}</span></div><div class="route-log-meta"><span><i class="fas fa-network-wired"></i>${escHtml(log.ip || '—')}</span><span><i class="fas fa-mobile-screen"></i>${escHtml(log.device || '—')}</span><span><i class="fas fa-desktop"></i>${escHtml(log.operating_system || '—')}</span><span><i class="fas fa-location-dot"></i>${escHtml(place)}</span><span title="${escHtml(log.user_agent || '')}"><i class="fas fa-globe"></i>User-Agent</span><span><i class="fas fa-clock"></i>${formatDate(log.created_at)}</span><span><i class="fas fa-shield-halved"></i>${escHtml(detail.matchedRoute || '—')}</span></div></div>`; }).join('') : '<div style="padding:36px;text-align:center;color:var(--text3)">Route denemesi bulunamadı</div>';
  main.innerHTML = `<div class="adm-section-header"><div class="adm-section-title"><div class="icon-pill"><i class="fas fa-route"></i></div> Route Log <span style="font-size:13px;font-weight:400;color:var(--text2)">(${logs.length})</span></div><div class="adm-search"><i class="fas fa-search"></i><input id="route-log-search" type="text" placeholder="Kullanıcı, IP, route, tarih veya hedef ara..." style="min-width:300px"></div></div><div class="card"><div id="route-logs-list">${render(logs)}</div></div>`;
  $('#route-log-search').addEventListener('input', event => { const q = event.target.value.toLowerCase(); $('#route-logs-list').innerHTML = render(logs.filter(log => JSON.stringify(log).toLowerCase().includes(q) || getRedirect(log).toLowerCase().includes(q))); });
}

async function renderAuthorityLogs(main) {
  let logs = [];
  try { logs = await adminApi('/authority-logs'); } catch (e) { main.innerHTML = `<p style="color:var(--red2);padding:20px">${escHtml(e.message)}</p>`; return; }
  const render = rows => rows.length ? rows.map(log => `<div class="route-log-row"><div class="route-log-main"><span class="route-log-user"><i class="fas fa-user-shield"></i>${escHtml(log.actor || '—')}</span><span class="route-log-route">${escHtml(log.action || '—')}</span><span class="route-log-arrow"><i class="fas fa-arrow-right"></i></span><span class="route-log-redirect">${escHtml(log.target || '—')}</span></div><div class="route-log-meta"><span><i class="fas fa-network-wired"></i>${escHtml(log.ip || '—')}</span><span><i class="fas fa-clock"></i>${formatDate(log.created_at)}</span><span><i class="fas fa-file-lines"></i>${escHtml(log.detail || '—')}</span></div></div>`).join('') : '<div style="padding:36px;text-align:center;color:var(--text3)">Yetkili müdahalesi bulunamadı</div>';
  main.innerHTML = `<div class="adm-section-header"><div class="adm-section-title"><div class="icon-pill"><i class="fas fa-user-shield"></i></div> Yetkili Logları <span style="font-size:13px;font-weight:400;color:var(--text2)">(${logs.length})</span></div><div class="adm-search"><i class="fas fa-search"></i><input id="authority-log-search" type="text" placeholder="Yetkili, işlem, kullanıcı, IP veya tarih ara..." style="min-width:300px"></div></div><div class="card"><div id="authority-logs-list">${render(logs)}</div></div>`;
  $('#authority-log-search').addEventListener('input', event => { const q = event.target.value.toLowerCase(); $('#authority-logs-list').innerHTML = render(logs.filter(log => JSON.stringify(log).toLowerCase().includes(q))); });
}

// ===== MESSAGES =====
async function renderAdminMessages(main) {
  let users = [];
  try { users = await adminApi('/users'); } catch (e) {
    main.innerHTML = `<p style="color:var(--red2);padding:20px">${e.message}</p>`; return;
  }
  main.innerHTML = `
    <div class="adm-section-header">
      <div class="adm-section-title"><div class="icon-pill"><i class="fas fa-envelope"></i></div> Mesajlar <span style="font-size:13px;font-weight:400;color:var(--text2)">(${users.length} kullanıcı)</span></div>
      <div class="adm-search"><i class="fas fa-search"></i><input id="admin-message-user-search" type="text" placeholder="Kullanıcı veya mesaj ara..." style="min-width:260px"></div>
    </div>
    <div class="card admin-message-users-card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Kullanıcı</th><th>E-posta</th><th>İşlem</th></tr></thead><tbody id="admin-message-users-body"></tbody>
        </table>
      </div>
    </div>`;
  const searchResults = document.createElement('div');
  searchResults.id = 'admin-message-search-results';
  searchResults.className = 'card admin-message-search-results';
  searchResults.style.display = 'none';
  main.appendChild(searchResults);
  const showAudit = async (conversationId, title) => {
    const audit = await adminApi('/conversations/' + conversationId + '/messages');
    const events = [...audit.messages.map(message => ({ ...message, event_type: 'message', event_time: message.created_at })), ...audit.calls.map(call => ({ ...call, event_type: 'call', event_time: call.created_at }))].sort((a, b) => new Date(a.event_time) - new Date(b.event_time));
    showModal(title, `<div class="admin-audit-list">${events.length ? events.map(event => event.event_type === 'call' ? `<div class="admin-call-event"><i class="fas fa-phone"></i><span><small>${formatDate(event.event_time)}</small><strong>${escHtml(event.caller_username)}</strong> ${event.status === 'connected' ? 'arama başlattı, cevaplandı ve sonlandı' : event.status === 'ended' ? 'arama sonlandı' : 'arama başlattı, cevap bekleniyor'}</span></div>` : `<div class="admin-audit-message ${event.audit_status !== 'visible' ? 'is-deleted' : ''}"><span class="admin-audit-sender"><small>${formatDate(event.created_at)}</small>${escHtml(event.sender_username)}</span><div>${escHtml(event.content || '[Medya]')}</div>${event.audit_status === 'deleted_for_all' ? '<em>Herkesten silindi</em>' : event.audit_status === 'deleted_for_user' ? '<em>Kendisinden silindi</em>' : ''}</div>`).join('') : '<div class="admin-audit-empty">Mesaj veya arama kaydı yok.</div>'}</div>`);
  };
  const renderUsers = list => {
    const body = $('#admin-message-users-body'); if (!body) return;
    body.innerHTML = list.length ? list.map(user => `<tr><td><strong>${escHtml(user.username)}</strong></td><td style="color:var(--text3)">${escHtml(user.email || '—')}</td><td><button class="btn btn-outline btn-xs admin-user-messages" data-id="${user.id}" data-username="${escHtml(user.username)}"><i class="fas fa-comments"></i> Mesajlarını gör</button></td></tr>`).join('') : '<tr><td colspan="3" style="text-align:center;color:var(--text3);padding:32px">Kullanıcı bulunamadı</td></tr>';
    body.querySelectorAll('.admin-user-messages').forEach(btn => btn.addEventListener('click', async () => {
      try {
        const convs = await adminApi('/users/' + btn.dataset.id + '/conversations');
        showModal(`${btn.dataset.username} - DM listesi`, `<div class="admin-conversation-list">${convs.length ? convs.map(c => `<button class="admin-conversation-choice" data-id="${c.id}" data-u1="${escHtml(c.user1)}" data-u2="${escHtml(c.user2)}"><span><strong>${escHtml(c.user1)}</strong> <i class="fas fa-arrow-right"></i> <strong>${escHtml(c.user2)}</strong></span><small>${c.message_count} mesaj · ${formatDate(c.last_message_at)}</small></button>`).join('') : '<div class="admin-audit-empty">Bu kullanıcının konuşması yok.</div>'}</div>`);
        document.querySelectorAll('.admin-conversation-choice').forEach(choice => choice.addEventListener('click', async () => {
          await showAudit(choice.dataset.id, `${choice.dataset.u1} ↔ ${choice.dataset.u2}`);
        }));
      } catch(e) { toast(e.message, 'error'); }
    }));
  };
  renderUsers(users);
  let searchTimer;
  $('#admin-message-user-search')?.addEventListener('input', event => {
    const q = event.target.value.trim();
    const lowered = q.toLocaleLowerCase('tr-TR');
    renderUsers(users.filter(user => `${user.username} ${user.email || ''}`.toLocaleLowerCase('tr-TR').includes(lowered)));
    clearTimeout(searchTimer);
    if (q.length < 2) { searchResults.style.display = 'none'; searchResults.innerHTML = ''; return; }
    searchTimer = setTimeout(async () => {
      try {
        const results = await adminApi('/messages/search?q=' + encodeURIComponent(q));
        searchResults.style.display = '';
        searchResults.innerHTML = `<div class="card-header"><span><i class="fas fa-message" style="color:var(--red2);margin-right:8px"></i>Mesaj sonuçları (${results.length})</span></div><div class="admin-message-search-list">${results.length ? results.map(result => `<button class="admin-message-search-result" data-conversation-id="${result.conversation_id}" data-title="${escHtml(result.user1)} ↔ ${escHtml(result.user2)}"><span class="admin-search-result-meta"><strong>${escHtml(result.sender_username)}</strong> · ${formatDate(result.created_at)}</span><span class="admin-search-result-users">${escHtml(result.user1)} ↔ ${escHtml(result.user2)}</span><span class="admin-search-result-content ${result.audit_status !== 'visible' ? 'is-deleted' : ''}">${escHtml(result.content || '[Medya]')}</span>${result.audit_status === 'deleted_for_all' ? '<em>Herkesten silindi</em>' : result.audit_status === 'deleted_for_user' ? '<em>Kendisinden silindi</em>' : ''}</button>`).join('') : '<div class="admin-audit-empty">Bu metni içeren mesaj bulunamadı.</div>'}</div>`;
        searchResults.querySelectorAll('.admin-message-search-result').forEach(result => result.addEventListener('click', () => showAudit(result.dataset.conversationId, result.dataset.title)));
      } catch (error) { searchResults.style.display = ''; searchResults.innerHTML = `<div class="admin-audit-empty">${escHtml(error.message)}</div>`; }
    }, 250);
  });
}

// ===== DUYURULAR =====
async function renderAnnouncements(main) {
  let anns = [];
  try { anns = await adminApi('/announcements'); } catch (e) { main.innerHTML = `<p style="color:var(--red2);padding:20px">${e.message}</p>`; return; }
  main.innerHTML = `
    <div class="adm-section-header">
      <div class="adm-section-title"><div class="icon-pill"><i class="fas fa-bullhorn"></i></div> Duyurular</div>
      <button class="btn btn-primary btn-sm" id="ann-new-btn"><i class="fas fa-plus"></i> Yeni Duyuru</button>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Başlık</th><th>Konum</th><th>Boyut</th><th>Bitiş</th><th>Durum</th><th>İşlem</th></tr></thead>
          <tbody id="ann-tbody"></tbody>
        </table>
      </div>
    </div>`;
  renderAnnTable(anns);
  $('#ann-new-btn').addEventListener('click', () => showAnnModal(null, anns));
}

function renderAnnTable(anns) {
  const tbody = $('#ann-tbody'); if (!tbody) return;
  if (!anns.length) { tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text3);padding:32px">Duyuru yok</td></tr>'; return; }
  tbody.innerHTML = anns.map(a => `<tr>
    <td>
      <div style="display:flex;align-items:center;gap:8px">
        <div style="width:12px;height:12px;border-radius:3px;background:${escHtml(a.bg_color)};border:1px solid ${escHtml(a.border_color)};flex-shrink:0"></div>
        <strong>${escHtml(a.title)}</strong>
      </div>
      <div style="font-size:11px;color:var(--text3);margin-top:2px;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(a.content)}</div>
    </td>
    <td><span class="badge badge-gray">${a.position||'top'}</span></td>
    <td><span class="badge badge-gray">${a.size||'normal'}</span></td>
    <td style="font-size:11px;color:var(--text2)">${a.expires_at ? formatDate(a.expires_at) : '∞ Süresiz'}</td>
    <td>${a.active ? '<span class="badge badge-green"><i class="fas fa-circle" style="font-size:8px"></i> Aktif</span>' : '<span class="badge badge-gray">Pasif</span>'}</td>
    <td>
      <div style="display:flex;gap:4px">
        <button class="btn btn-outline btn-xs ann-edit-btn" data-id="${a.id}"><i class="fas fa-edit"></i></button>
        <button class="btn btn-danger btn-xs ann-del-btn" data-id="${a.id}"><i class="fas fa-trash"></i></button>
      </div>
    </td>
  </tr>`).join('');
  tbody.addEventListener('click', async e => {
    const edit = e.target.closest('.ann-edit-btn');
    const del = e.target.closest('.ann-del-btn');
    if (edit) { const a = anns.find(x => x.id == edit.dataset.id); if (a) showAnnModal(a, anns); }
    if (del) { if (!confirm('Duyuru silinsin mi?')) return; try { await adminApi('/announcements/'+del.dataset.id, {method:'DELETE'}); toast('Silindi'); loadSection('announcements'); } catch(e){toast(e.message,'error');} }
  });
}

function showAnnModal(ann, anns) {
  const isEdit = !!ann;
  showModal(isEdit ? 'Duyuru Düzenle' : 'Yeni Duyuru', `
    <div class="form-group"><label>Başlık</label><input id="ann-title" value="${escHtml(ann?.title||'')}" placeholder="Duyuru başlığı..." /></div>
    <div class="form-group"><label>İçerik</label><textarea id="ann-content" rows="3" placeholder="Duyuru metni...">${escHtml(ann?.content||'')}</textarea></div>
    <div class="form-row">
      <div class="form-group"><label>Arka Plan Rengi</label><input id="ann-bg" type="color" value="${ann?.bg_color||'#dc2626'}" style="height:38px;cursor:pointer" /></div>
      <div class="form-group"><label>Yazı Rengi</label><input id="ann-text-color" type="color" value="${ann?.text_color||'#ffffff'}" style="height:38px;cursor:pointer" /></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Kenarlık Rengi</label><input id="ann-border" type="color" value="${ann?.border_color||'#991b1b'}" style="height:38px;cursor:pointer" /></div>
      <div class="form-group"><label>Konum</label>
        <select id="ann-pos">
          <option value="top" ${ann?.position==='top'?'selected':''}>Üst</option>
          <option value="bottom" ${ann?.position==='bottom'?'selected':''}>Alt</option>
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Boyut</label>
        <select id="ann-size">
          <option value="small" ${ann?.size==='small'?'selected':''}>Küçük</option>
          <option value="normal" ${ann?.size==='normal'||!ann?.size?'selected':''}>Normal</option>
          <option value="large" ${ann?.size==='large'?'selected':''}>Büyük</option>
        </select>
      </div>
      <div class="form-group"><label>Durum</label>
        <select id="ann-active">
          <option value="1" ${ann?.active!==0?'selected':''}>Aktif</option>
          <option value="0" ${ann?.active===0?'selected':''}>Pasif</option>
        </select>
      </div>
    </div>
    <div style="background:var(--bg4);border-radius:10px;padding:14px;margin-bottom:16px">
      <div style="font-size:11px;font-weight:600;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">Süre Ayarı</div>
      <div class="form-row" style="margin-bottom:0">
        <div class="form-group" style="margin-bottom:0"><label>Değer (0 = süresiz)</label><input id="ann-dur-val" type="number" min="0" value="0" /></div>
        <div class="form-group" style="margin-bottom:0"><label>Birim</label>
          <select id="ann-dur-type">
            <option value="seconds">Saniye</option>
            <option value="minutes">Dakika</option>
            <option value="hours" selected>Saat</option>
            <option value="days">Gün</option>
          </select>
        </div>
      </div>
    </div>
    <div id="ann-preview" style="margin-bottom:16px"></div>
    <button class="btn btn-primary" id="ann-save-btn" style="width:100%;justify-content:center">${isEdit?'Güncelle':'Oluştur'}</button>
    <div id="ann-error" class="form-error mt-4"></div>
  `);

  function updatePreview() {
    const pre = $('#ann-preview'); if (!pre) return;
    const bg = $('#ann-bg')?.value||'#dc2626', tc = $('#ann-text-color')?.value||'#fff', bc = $('#ann-border')?.value||'#991b1b';
    const title = $('#ann-title')?.value||'Başlık', content = $('#ann-content')?.value||'İçerik';
    pre.innerHTML = `<div style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Önizleme</div>
      <div style="background:${bg};color:${tc};border:2px solid ${bc};border-radius:8px;padding:10px 14px;font-size:13px">
        <strong>${escHtml(title)}</strong> <span>${escHtml(content)}</span>
      </div>`;
  }
  ['#ann-bg','#ann-text-color','#ann-border','#ann-title','#ann-content'].forEach(sel => { const el=$(sel); if(el) el.addEventListener('input', updatePreview); });
  updatePreview();

  $('#ann-save-btn').addEventListener('click', async () => {
    const body = {
      title: $('#ann-title').value.trim(), content: $('#ann-content').value.trim(),
      bg_color: $('#ann-bg').value, text_color: $('#ann-text-color').value,
      border_color: $('#ann-border').value, position: $('#ann-pos').value,
      size: $('#ann-size').value, active: parseInt($('#ann-active').value),
      duration_type: $('#ann-dur-type').value, duration_value: $('#ann-dur-val').value
    };
    if (!body.title || !body.content) { $('#ann-error').textContent = 'Başlık ve içerik zorunlu'; return; }
    try {
      if (isEdit) await adminApi('/announcements/'+ann.id, {method:'PUT', body:JSON.stringify(body)});
      else await adminApi('/announcements', {method:'POST', body:JSON.stringify(body)});
      toast(isEdit ? 'Duyuru güncellendi' : 'Duyuru oluşturuldu'); hideModal(); loadSection('announcements');
    } catch (e) { $('#ann-error').textContent = e.message; }
  });
}

// ===== ADMIN: MÜZİKLER =====
async function renderAdminSongs(main) {
  let songs = [];
  try { songs = await adminApi('/songs'); } catch (e) { main.innerHTML = `<p style="color:var(--red2);padding:20px">${e.message}</p>`; return; }
  main.innerHTML = `
    <div class="adm-section-header">
      <div class="adm-section-title"><div class="icon-pill"><i class="fas fa-music"></i></div> Müzikler <span style="font-size:13px;font-weight:400;color:var(--text2)">(${songs.length})</span></div>
      <div class="adm-search"><i class="fas fa-search"></i><input type="text" id="song-search" placeholder="Şarkı, sanatçı, dağıtıcı ara..." style="min-width:220px" /></div>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Kapak</th><th>Başlık / Sanatçı</th><th>Tür</th><th>Dağıtıcı</th><th>Dinlenme</th><th>Durum</th><th>Yükleyen</th><th>Tarih</th><th>İşlem</th></tr></thead>
          <tbody id="songs-tbody"></tbody>
        </table>
      </div>
    </div>`;
  const render = (list) => {
    const t = document.getElementById('songs-tbody'); if (!t) return;
    if (!list.length) { t.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--text3);padding:32px">Şarkı yok</td></tr>'; return; }
    t.innerHTML = list.map(s => `<tr>
      <td>${s.cover_url ? `<img src="${escHtml(s.cover_url)}" style="width:40px;height:40px;border-radius:6px;object-fit:cover" />` : `<div style="width:40px;height:40px;border-radius:6px;background:var(--bg4);display:flex;align-items:center;justify-content:center;color:var(--text3)"><i class="fas fa-music"></i></div>`}</td>
      <td>
        <div style="font-weight:600;font-size:13px">${escHtml(s.title)}</div>
        <div style="font-size:11px;color:var(--text2)">${escHtml(s.artist_name)}</div>
      </td>
      <td style="font-size:12px;color:var(--text2)">${escHtml(s.genre||'-')}</td>
      <td style="font-size:12px;color:var(--text2)">${escHtml(s.distributor||'-')}</td>
      <td style="font-size:12px">${s.play_count}</td>
      <td>${s.status === 'active' ? '<span class="badge badge-green">Aktif</span>' : s.status === 'suspended' ? '<span class="badge badge-red">Askıda</span>' : `<span class="badge badge-gray">${escHtml(s.status)}</span>`}</td>
      <td style="font-size:11px;color:var(--text2)">${escHtml(s.uploader||'-')}</td>
      <td style="font-size:11px;color:var(--text3)">${timeAgo(s.created_at)}</td>
      <td>
        <div style="display:flex;gap:4px;flex-wrap:wrap">
          <button class="btn btn-outline btn-xs es-btn" data-id="${s.id}" title="Düzenle"><i class="fas fa-edit"></i></button>
          ${s.status === 'active'
            ? `<button class="btn btn-danger btn-xs sus-btn" data-id="${s.id}" title="Askıya Al"><i class="fas fa-pause"></i></button>`
            : `<button class="btn btn-green btn-xs unsus-btn" data-id="${s.id}" title="Aktife Al"><i class="fas fa-play"></i></button>`}
          <button class="btn btn-danger btn-xs ds-btn" data-id="${s.id}" title="Sil"><i class="fas fa-trash"></i></button>
        </div>
      </td>
    </tr>`).join('');

    t.addEventListener('click', async e => {
      const es = e.target.closest('.es-btn');
      const sus = e.target.closest('.sus-btn');
      const unsus = e.target.closest('.unsus-btn');
      const ds = e.target.closest('.ds-btn');
      if (es) { const s = list.find(x => x.id == es.dataset.id); if (s) showSongEditModal(s); }
      if (sus) {
        if (!confirm('Şarkı askıya alınsın mı?')) return;
        try { await adminApi('/songs/'+sus.dataset.id, {method:'PUT', body:JSON.stringify({status:'suspended'})}); toast('Askıya alındı'); loadSection('songs'); } catch(e){toast(e.message,'error');}
      }
      if (unsus) {
        try { await adminApi('/songs/'+unsus.dataset.id, {method:'PUT', body:JSON.stringify({status:'active'})}); toast('Aktife alındı'); loadSection('songs'); } catch(e){toast(e.message,'error');}
      }
      if (ds) { if (!confirm('Şarkı kalıcı silinsin mi?')) return; try { await adminApi('/songs/'+ds.dataset.id, {method:'DELETE'}); toast('Silindi'); loadSection('songs'); } catch(e){toast(e.message,'error');} }
    });
  };
  render(songs);
  document.getElementById('song-search').addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    render(songs.filter(s => s.title.toLowerCase().includes(q) || s.artist_name.toLowerCase().includes(q) || (s.distributor||'').toLowerCase().includes(q)));
  });
}

function showSongEditModal(song) {
  showModal(`Şarkı Düzenle — ${escHtml(song.title)}`, `
    <div class="form-row">
      <div class="form-group"><label>Şarkı Adı</label><input id="se-title" value="${escHtml(song.title)}" /></div>
      <div class="form-group"><label>Sanatçı Adı</label><input id="se-artist" value="${escHtml(song.artist_name)}" /></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Dağıtıcı</label><input id="se-dist" value="${escHtml(song.distributor||'')}" /></div>
      <div class="form-group"><label>Tür</label><input id="se-genre" value="${escHtml(song.genre||'')}" /></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Dinlenme Sayısı</label><input id="se-plays" type="number" value="${song.play_count}" /></div>
      <div class="form-group"><label>Durum</label>
        <select id="se-status">
          <option value="active" ${song.status==='active'?'selected':''}>Aktif</option>
          <option value="suspended" ${song.status==='suspended'?'selected':''}>Askıda</option>
          <option value="deleted" ${song.status==='deleted'?'selected':''}>Silindi</option>
        </select>
      </div>
    </div>
    <div class="form-group"><label>Şarkı Sözleri</label><textarea id="se-lyrics" rows="6">${escHtml(song.lyrics||'')}</textarea></div>
    <div class="form-group"><label>Yeni Ses Dosyası (boş bırak = değişme)</label>
      <input type="file" id="se-audio" accept="audio/*" style="background:var(--bg3);border:1px dashed var(--border);padding:8px;cursor:pointer;border-radius:8px" />
    </div>
    <div class="form-group"><label>Yeni Kapak Fotoğrafı (boş bırak = değişme)</label>
      <input type="file" id="se-cover" accept="image/*" style="background:var(--bg3);border:1px dashed var(--border);padding:8px;cursor:pointer;border-radius:8px" />
    </div>
    <button class="btn btn-primary" id="se-save" style="width:100%;justify-content:center"><i class="fas fa-save"></i> Kaydet</button>
    <div id="se-msg" class="form-error mt-4"></div>
  `);
  document.getElementById('se-save').addEventListener('click', async () => {
    const btn = document.getElementById('se-save');
    btn.disabled = true; btn.innerHTML = '<div class="spinner" style="width:14px;height:14px"></div> Kaydediliyor...';
    const fd = new FormData();
    fd.append('title', document.getElementById('se-title').value.trim());
    fd.append('artist_name', document.getElementById('se-artist').value.trim());
    fd.append('distributor', document.getElementById('se-dist').value.trim());
    fd.append('genre', document.getElementById('se-genre').value.trim());
    fd.append('lyrics', document.getElementById('se-lyrics').value.trim());
    fd.append('play_count', document.getElementById('se-plays').value);
    fd.append('status', document.getElementById('se-status').value);
    const af = document.getElementById('se-audio').files[0]; if(af) fd.append('audio', af);
    const cf = document.getElementById('se-cover').files[0]; if(cf) fd.append('cover', cf);
    try {
      const res = await fetch('/api/admin/songs/'+song.id, { method:'PUT', headers:{'X-Admin-Token':adminToken}, body:fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error||'Hata');
      toast('Şarkı güncellendi'); hideModal(); loadSection('songs');
    } catch(e) { document.getElementById('se-msg').textContent=e.message; btn.disabled=false; btn.innerHTML='<i class="fas fa-save"></i> Kaydet'; }
  });
}

// ===== ADMIN: ARTİST BAŞVURULARI =====
async function renderArtistApps(main) {
  let apps = [];
  try { apps = await adminApi('/artist-applications'); } catch (e) { main.innerHTML = `<p style="color:var(--red2);padding:20px">${e.message}</p>`; return; }
  const pending = apps.filter(a => a.status === 'pending');
  const others = apps.filter(a => a.status !== 'pending');
  main.innerHTML = `
    <div class="adm-section-header">
      <div class="adm-section-title">
        <div class="icon-pill"><i class="fas fa-microphone"></i></div>
        Artist Başvuruları
        ${pending.length ? `<span class="adm-nav-badge">${pending.length}</span>` : ''}
      </div>
    </div>
    ${pending.length ? `
    <div style="margin-bottom:24px">
      <div style="font-size:12px;font-weight:600;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">⏳ Bekleyen (${pending.length})</div>
      <div class="card">
        <div class="table-wrap">
          <table>
            <thead><tr><th>Kullanıcı</th><th>Tür</th><th>Örnek</th><th>Not</th><th>Tarih</th><th>İşlem</th></tr></thead>
            <tbody id="pending-tbody"></tbody>
          </table>
        </div>
      </div>
    </div>` : '<div class="card" style="margin-bottom:20px"><div class="card-body" style="text-align:center;color:var(--text3);padding:30px"><i class="fas fa-check-circle" style="font-size:28px;margin-bottom:8px;color:var(--green)"></i><div>Bekleyen başvuru yok</div></div></div>'}
    ${others.length ? `
    <div>
      <div style="font-size:12px;font-weight:600;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">Geçmiş Başvurular</div>
      <div class="card">
        <div class="table-wrap">
          <table>
            <thead><tr><th>Kullanıcı</th><th>Tür</th><th>Durum</th><th>İnceleme</th><th>Tarih</th></tr></thead>
            <tbody>${others.map(a => `<tr>
              <td>
                <div style="display:flex;align-items:center;gap:8px">
                  ${a.avatar ? `<img src="${escHtml(a.avatar)}" style="width:28px;height:28px;border-radius:50%;object-fit:cover" />` : `<div style="width:28px;height:28px;border-radius:50%;background:var(--surface2);display:flex;align-items:center;justify-content:center"><i class="fas fa-user" style="font-size:11px"></i></div>`}
                  <strong>${escHtml(a.username)}</strong>
                </div>
              </td>
              <td style="font-size:12px">${escHtml(a.genre)}</td>
              <td>${a.status === 'accepted' ? '<span class="badge badge-green"><i class="fas fa-check"></i> Onaylandı</span>' : '<span class="badge badge-red"><i class="fas fa-times"></i> Reddedildi</span>'}</td>
              <td style="font-size:11px;color:var(--text3)">${a.reviewed_at ? timeAgo(a.reviewed_at) : '-'}</td>
              <td style="font-size:11px;color:var(--text3)">${timeAgo(a.created_at)}</td>
            </tr>`).join('')}</tbody>
          </table>
        </div>
      </div>
    </div>` : ''}`;

  const pt = document.getElementById('pending-tbody');
  if (pt && pending.length) {
    pt.innerHTML = pending.map(a => `<tr>
      <td>
        <div style="display:flex;align-items:center;gap:8px">
          ${a.avatar ? `<img src="${escHtml(a.avatar)}" style="width:32px;height:32px;border-radius:50%;object-fit:cover" />` : `<div style="width:32px;height:32px;border-radius:50%;background:var(--surface2);display:flex;align-items:center;justify-content:center"><i class="fas fa-user" style="font-size:12px"></i></div>`}
          <div>
            <div style="font-weight:600;font-size:13px">${escHtml(a.username)}</div>
            <div style="font-size:10px;color:var(--text3)">#${a.user_id}</div>
          </div>
        </div>
      </td>
      <td style="font-size:12px">${escHtml(a.genre)}</td>
      <td>
        ${a.sample_song_url ? `<a href="${escHtml(a.sample_song_url)}" target="_blank" class="btn btn-outline btn-xs"><i class="fas fa-external-link-alt"></i> URL</a>` : ''}
        ${a.sample_song_file ? `<a href="${escHtml(a.sample_song_file)}" target="_blank" class="btn btn-outline btn-xs"><i class="fas fa-music"></i> Dosya</a>` : ''}
      </td>
      <td style="font-size:12px;color:var(--text2);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(a.note||'-')}</td>
      <td style="font-size:11px;color:var(--text3)">${timeAgo(a.created_at)}</td>
      <td>
        <div style="display:flex;gap:6px">
          <button class="btn btn-green btn-sm approve-app-btn" data-id="${a.id}" data-uid="${a.user_id}">
            <i class="fas fa-check"></i> Onayla
          </button>
          <button class="btn btn-danger btn-sm reject-app-btn" data-id="${a.id}">
            <i class="fas fa-times"></i> Reddet
          </button>
        </div>
      </td>
    </tr>`).join('');

    pt.addEventListener('click', async e => {
      const approve = e.target.closest('.approve-app-btn');
      const reject = e.target.closest('.reject-app-btn');
      if (approve) {
        if (!confirm('Başvuru onaylansın mı? Kullanıcıya artist rozeti verilecek.')) return;
        try {
          await adminApi('/artist-applications/'+approve.dataset.id+'/review', { method:'POST', body:JSON.stringify({status:'accepted'}) });
          toast('✓ Artist rozeti verildi!'); loadSection('artist-apps');
        } catch(e) { toast(e.message, 'error'); }
      }
      if (reject) {
        if (!confirm('Başvuru reddedilsin mi?')) return;
        try {
          await adminApi('/artist-applications/'+reject.dataset.id+'/review', { method:'POST', body:JSON.stringify({status:'rejected'}) });
          toast('Başvuru reddedildi'); loadSection('artist-apps');
        } catch(e) { toast(e.message, 'error'); }
      }
    });
  }
}

// ===== SETTINGS =====
async function renderSettings(main) {
  let settings = {};
  try { const rows = await adminApi('/settings'); settings = rows; } catch {}

  main.innerHTML = `
    <div class="adm-section-header"><div class="adm-section-title"><div class="icon-pill"><i class="fas fa-cog"></i></div> Site Ayarları</div></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      <div class="card">
        <div class="card-header"><span><i class="fas fa-palette" style="color:var(--red2);margin-right:8px"></i>Genel</span></div>
        <div class="card-body">
          <div class="form-group"><label>Site Adı</label><input id="s-sitename" value="${escHtml(settings['site_name']||'')}" /></div>
          <div class="form-group"><label>Site Açıklaması</label><textarea id="s-desc" rows="3">${escHtml(settings['site_description']||'')}</textarea></div>
          <button class="btn btn-primary" id="s-general-save" style="width:100%;justify-content:center"><i class="fas fa-save"></i> Kaydet</button>
          <div id="s-general-msg" class="form-error mt-4"></div>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><span><i class="fas fa-phone-volume" style="color:var(--red2);margin-right:8px"></i>Sesli Arama Sesi</span></div>
        <div class="card-body">
          <div class="form-group"><label>Zil sesi URL'si</label><input id="s-call-ringtone-url" type="url" value="${escHtml(settings['call_ringtone_url']||'')}" placeholder="https://site.com/ring.mp3" /></div>
          <div class="form-group"><label>MP3 dosyası</label><input id="s-call-ringtone-file" type="file" accept="audio/mpeg,audio/ogg,audio/wav,audio/*" /></div>
          <button class="btn btn-primary" id="s-call-ringtone-save" style="width:100%;justify-content:center"><i class="fas fa-save"></i> Zil sesini kaydet</button>
          <div id="s-call-ringtone-msg" class="form-error mt-4"></div>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><span><i class="fas fa-lock" style="color:var(--red2);margin-right:8px"></i>Güvenlik</span></div>
        <div class="card-body">
          <div class="form-group"><label>Ana Admin Kullanıcı Adı</label><input id="s-admin-username" value="${escHtml(settings['admin_username'] || 'Tarator')}" /></div>
          <div class="form-group"><label>Yeni Admin Şifresi</label><input id="s-newpw" type="password" placeholder="Boş bırakırsan değişmez" /></div>
          <div class="form-group"><label>Şifreyi Onayla</label><input id="s-newpw2" type="password" placeholder="••••••" /></div>
          <button class="btn btn-primary" id="s-pw-save" style="width:100%;justify-content:center"><i class="fas fa-key"></i> Şifreyi Güncelle</button>
          <div id="s-pw-msg" class="form-error mt-4"></div>
        </div>
      </div>
      <div class="card adm-feature-card" style="grid-column:1 / -1">
        <div class="card-header"><span><i class="fas fa-route" style="color:var(--red2);margin-right:8px"></i>Route Koruması</span><span class="adm-setting-status ${settings['route_protection_enabled']==='1'?'is-on':''}">${settings['route_protection_enabled']==='1'?'AKTİF':'KAPALI'}</span></div>
        <div class="card-body">
          <div class="adm-feature-copy"><strong>Hassas sayfaları görünmez yap</strong><p>Tanımlanan route'lara gelen ziyaretçiler seçtiğiniz adrese yönlendirilir ve denemeler sistem loglarına kaydedilir.</p></div>
          <label class="adm-toggle-row" for="s-route-protection"><span><i class="fas fa-shield-halved"></i> Route korumasını etkinleştir</span><span class="adm-toggle"><input type="checkbox" id="s-route-protection" ${settings['route_protection_enabled']==='1'?'checked':''}><span></span></span></label>
          <div class="form-group"><label>Korunacak route'lar</label><textarea id="s-protected-routes" rows="3" placeholder="Her satıra bir route: /admin\n/yonetim">${escHtml((() => { try { return JSON.parse(settings['protected_routes'] || '[]').join('\n'); } catch { return settings['protected_routes'] || ''; } })())}</textarea></div>
          <div class="form-group"><label>Yönlendirme adresi</label><input id="s-route-redirect" value="${escHtml(settings['route_redirect'] || '/')}" placeholder="/" /></div>
          <button class="btn btn-primary" id="s-route-save" style="width:100%;justify-content:center"><i class="fas fa-save"></i> Koruma Ayarlarını Kaydet</button>
          <div id="s-route-msg" class="form-error mt-4"></div>
        </div>
      </div>
      <div class="card adm-feature-card">
        <div class="card-header"><span><i class="fas fa-user-shield" style="color:var(--red2);margin-right:8px"></i>Sosyal Medya Uygulaması</span><span class="adm-setting-status ${settings['first_visit_auth']==='1'?'is-on':''}">${settings['first_visit_auth']==='1'?'AÇIK':'KAPALI'}</span></div>
        <div class="card-body">
          <div class="adm-feature-copy">
            <strong>İlk ziyarette kayıt / giriş iste</strong>
            <p>Anonim ziyaretçiler ana sayfaya ilk geldiklerinde doğrudan modern giriş ekranına yönlendirilir. Ayar kapatıldığında normal ziyaret akışı devam eder.</p>
          </div>
          <label class="adm-toggle-row" for="s-first-visit-auth">
            <span><i class="fas fa-door-open"></i> İlk ana sayfa ziyaretinde auth ekranını göster</span>
            <span class="adm-toggle"><input type="checkbox" id="s-first-visit-auth" ${settings['first_visit_auth']==='1'?'checked':''}><span></span></span>
          </label>
          <button class="btn btn-primary" id="s-first-visit-auth-save" style="width:100%;justify-content:center"><i class="fas fa-save"></i> Ayarı Kaydet</button>
          <div id="s-first-visit-auth-msg" class="form-error mt-4"></div>
        </div>
      </div>
      <div class="card adm-feature-card" style="grid-column:1 / -1">
        <div class="card-header"><span><i class="fas fa-table-columns" style="color:var(--red2);margin-right:8px"></i>Profil Sekmeleri</span></div>
        <div class="card-body">
          <p style="font-size:12px;color:var(--text2);margin-bottom:14px">Profillerdeki Forumlar, Kitaplar, Fotoğraflar gibi sekmelerin sırasını belirleyin.</p>
          <div id="profile-tabs-order" style="display:grid;gap:8px"></div>
          <button class="btn btn-primary" id="profile-tabs-save" style="width:100%;justify-content:center;margin-top:14px"><i class="fas fa-save"></i> Sekme Sırasını Kaydet</button>
          <div id="profile-tabs-msg" class="form-error mt-4"></div>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><span><i class="fas fa-file-alt" style="color:var(--red2);margin-right:8px"></i>Footer</span></div>
        <div class="card-body">
          <div class="form-group"><label>Footer metni</label><input id="s-footer" value="${escHtml(settings['footer_copyright_text'] || '© 2026 İsmail D. Tüm hakları saklıdır.')}" placeholder="© 2026 İsmail D. Tüm hakları saklıdır." /></div>
          <button class="btn btn-primary" id="s-footer-save" style="width:100%;justify-content:center"><i class="fas fa-save"></i> Kaydet</button>
          <div id="s-footer-msg" class="form-error mt-4"></div>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><span><i class="fas fa-shield-halved" style="color:var(--red2);margin-right:8px"></i>KVKK Metni</span></div>
        <div class="card-body">
          <div class="form-group"><textarea id="s-kvkk" rows="5">${escHtml(settings['kvkk_text']||'')}</textarea></div>
          <button class="btn btn-primary" id="s-kvkk-save" style="width:100%;justify-content:center"><i class="fas fa-save"></i> Kaydet</button>
          <div id="s-kvkk-msg" class="form-error mt-4"></div>
        </div></div>
        <div class="card"><div class="card-header"><span><i class="fas fa-ban" style="color:var(--accent-red2)"></i> Engelleme Ayarları</span></div><div class="card-body">
          <div class="form-group" style="display:flex;align-items:center;gap:12px;margin-bottom:4px">
            <input type="checkbox" id="s-block-new-accounts" ${settings['block_new_accounts']==='1'?'checked':''} style="width:18px;height:18px;cursor:pointer" />
            <div>
              <label for="s-block-new-accounts" style="cursor:pointer;font-weight:600">Yeni Hesap Koruması</label>
              <div style="font-size:12px;color:var(--text-muted);margin-top:2px">Açıksa, engellenen kişinin IP adresiyle yeni açılmış hesaplar da engellenen kişiyle aynı muameleyi görür (mesaj gönderemez).</div>
            </div>
          </div>
          <button class="btn btn-primary btn-sm" id="s-block-new-save" style="margin-top:12px"><i class="fas fa-save"></i> Kaydet</button>
          <div id="s-block-new-msg" class="form-error mt-4"></div>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><span><i class="fas fa-video" style="color:var(--red2);margin-right:8px"></i>Video Yayınlama</span></div>
        <div class="card-body">
          <div class="form-group"><label>Yükleme başarı mesajı</label><input id="s-video-success-text" value="${escHtml(settings['video_upload_success_text']||'YÜKLENDİ')}" /></div>
          <div class="form-group"><label>Başarı popup süresi (sn)</label><input id="s-video-success-duration" type="number" min="1" max="10" value="${escHtml(settings['video_upload_success_duration']||'3')}" /></div>
          <div class="form-group"><label>Varsayılan açıklama</label><textarea id="s-video-default-desc" rows="3">${escHtml(settings['video_default_description']||'')}</textarea></div>
          <div class="form-group"><label>Boş açıklama metni</label><textarea id="s-video-empty-desc" rows="3">${escHtml(settings['video_empty_description_text']||'Bu videoya bir açıklama eklenmemiş.')}</textarea></div>
          <button class="btn btn-primary" id="s-video-save" style="width:100%;justify-content:center"><i class="fas fa-save"></i> Kaydet</button>
          <div id="s-video-msg" class="form-error mt-4"></div>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><span><i class="fas fa-bolt" style="color:var(--red2);margin-right:8px"></i>Reals</span></div>
        <div class="card-body">
          <div class="form-group"><label>Reals ilk hatırlatma metni (kısa)</label><textarea id="s-reals-reminder" rows="3">${escHtml(settings['reals_reminder']||'')}</textarea></div>
          <div class="form-group"><label>Hatırlatma yalnızca ilk ziyaret için gösterilsin</label><div style="font-size:12px;color:var(--text2)">Kullanıcı Reals sayfasına ilk girdiğinde bir kez gösterilecek.</div></div>
          <button class="btn btn-primary" id="s-reals-save" style="width:100%;justify-content:center"><i class="fas fa-save"></i> Kaydet</button>
          <div id="s-reals-msg" class="form-error mt-4"></div>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><span><i class="fas fa-music" style="color:var(--red2);margin-right:8px"></i>Şarkı Yayınlama Kuralları</span></div>
        <div class="card-body">
          <div class="form-group"><label>Kendi Şarkım – Kurallar</label><textarea id="s-music-own" rows="4">${escHtml(settings['music_own_rules']||'')}</textarea></div>
          <button class="btn btn-primary btn-sm" id="s-music-own-save" style="width:100%;justify-content:center;margin-bottom:16px"><i class="fas fa-save"></i> Kaydet</button>
          <label class="checkbox-label" style="margin-bottom:12px">
            <input type="checkbox" id="s-other-songs-enabled" ${settings['other_songs_enabled']!=='0'?'checked':''} />
            "Başkasının Şarkısı" özelliğini etkinleştir
          </label>
          <button class="btn btn-primary btn-sm" id="s-other-toggle-save" style="width:100%;justify-content:center;margin-bottom:16px"><i class="fas fa-save"></i> Kaydet</button>
          <div class="form-group"><label>Başkasının Şarkısı – Kurallar</label><textarea id="s-music-other" rows="4">${escHtml(settings['music_other_rules']||'')}</textarea></div>
          <button class="btn btn-primary btn-sm" id="s-music-other-save" style="width:100%;justify-content:center"><i class="fas fa-save"></i> Kaydet</button>
          <div id="s-music-msg" class="form-error mt-4"></div>
        </div>
      </div>
      <div class="card" style="grid-column: 1 / -1">
        <div class="card-header"><span><i class="fas fa-mobile-screen-button" style="color:var(--red2);margin-right:8px"></i>Kullanıcı Tema Davranışı</span></div>
        <div class="card-body">
          <label class="adm-toggle-row" for="s-device-theme"><span><i class="fas fa-sun"></i> Telefon temasına otomatik uyum</span><span class="adm-toggle"><input type="checkbox" id="s-device-theme" ${settings['device_theme_enabled'] !== '0' ? 'checked' : ''}><span></span></span></label>
          <label class="adm-toggle-row" for="s-theme-picker"><span><i class="fas fa-eye"></i> Koyu/açık tema seçimini göster</span><span class="adm-toggle"><input type="checkbox" id="s-theme-picker" ${settings['theme_picker_enabled'] !== '0' ? 'checked' : ''}><span></span></span></label>
          <p style="font-size:12px;color:var(--text3);margin:8px 0 16px">Kapalıysa kullanıcılar yalnızca açık veya koyu temayı seçebilir.</p>
          <div style="display:flex;gap:24px;flex-wrap:wrap">
            <div><label>Açık tema hat rengi</label><input type="color" id="s-light-primary" value="${settings['light_primary_color'] || '#dc2626'}" style="width:64px;height:42px;padding:3px" /></div>
            <div><label>Açık tema arka plan rengi</label><input type="color" id="s-light-background" value="${settings['light_background_color'] || '#f8f9fa'}" style="width:64px;height:42px;padding:3px" /></div>
          </div>
          <div style="margin-top:16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap"><button class="btn btn-primary" id="s-light-theme-save"><i class="fas fa-save"></i> Kaydet</button><div id="s-light-theme-msg" class="form-error"></div></div>
        </div>
      </div>
      <div class="card" style="grid-column: 1 / -1">
        <div class="card-header"><span><i class="fas fa-book-open" style="color:#a16207;margin-right:8px"></i>Kitap Sayfası Arka Plan Rengi</span></div>
        <div class="card-body">
          <p style="font-size:13px;color:var(--text2);margin-bottom:16px">Okuyucu ekranındaki sayfa arka plan rengini ayarlayın. Varsayılan: <code>#F4ECD8</code> (eski kitap sayfası)</p>
          <div style="display:flex;align-items:flex-start;gap:24px;flex-wrap:wrap">
            <div>
              <label style="margin-bottom:8px">Renk Seçici</label>
              <div style="display:flex;align-items:center;gap:12px">
                <input type="color" id="s-book-bg-picker" value="${settings['book_bg_color']||'#F4ECD8'}"
                  style="width:64px;height:48px;border-radius:10px;border:2px solid var(--border);padding:4px;cursor:pointer;background:var(--bg4);flex-shrink:0" />
                <div>
                  <div style="font-size:11px;color:var(--text3);margin-bottom:4px">Önizleme</div>
                  <div id="s-book-bg-preview" style="width:220px;height:54px;border-radius:8px;border:1px solid var(--border);background:${settings['book_bg_color']||'#F4ECD8'};display:flex;align-items:center;justify-content:center">
                    <span style="font-family:'Literata',Georgia,serif;font-size:14px;color:#2c1a0e;opacity:0.75">Kitap metni önizleme</span>
                  </div>
                </div>
              </div>
            </div>
            <div style="flex:1;min-width:200px">
              <label style="margin-bottom:8px">Hex Kodu</label>
              <div style="display:flex;gap:8px;align-items:center">
                <input type="text" id="s-book-bg-hex" value="${settings['book_bg_color']||'#F4ECD8'}"
                  placeholder="#F4ECD8" maxlength="7"
                  style="font-family:monospace;font-size:15px;letter-spacing:2px;max-width:160px" />
                <button class="btn btn-outline btn-sm" id="s-book-bg-apply-hex"><i class="fas fa-eye"></i> Önizle</button>
              </div>
              <div style="margin-top:12px">
                <div style="font-size:11px;color:var(--text3);margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px">Hazır Renkler</div>
                <div style="display:flex;gap:8px;flex-wrap:wrap" id="s-book-bg-presets">
                  ${[['#F4ECD8','Eski Kitap'],['#FFFDF5','Krem'],['#FFF8E7','Sıcak Beyaz'],['#E8F4E8','Yeşilimsi'],['#E8F0F8','Mavi Ton'],['#2c1a0e','Koyu Kahve'],['#1a1a2e','Gece'],['#0f0f0f','Siyah']].map(([c,n])=>`<button class="s-book-bg-preset" data-color="${c}" title="${n}" style="width:28px;height:28px;border-radius:6px;border:2px solid ${(settings['book_bg_color']||'#F4ECD8')===c?'var(--text)':'transparent'};background:${c};cursor:pointer;transition:all 0.15s"></button>`).join('')}
                </div>
              </div>
            </div>
          </div>
          <div style="margin-top:16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
            <button class="btn btn-primary" id="s-book-bg-save"><i class="fas fa-save"></i> Kaydet</button>
            <button class="btn btn-outline" id="s-book-bg-reset"><i class="fas fa-undo"></i> Varsayılan</button>
            <div id="s-book-bg-msg" class="form-error"></div>
          </div>
        </div>
      </div>
      <div class="card" style="grid-column: 1 / -1">
        <div class="card-header"><span><i class="fas fa-palette" style="color:var(--red2);margin-right:8px"></i>Ana Hat Rengi</span></div>
        <div class="card-body">
          <p style="font-size:13px;color:var(--text2);margin-bottom:16px">Sitenin genel tema rengini buradan ayarlayabilirsiniz. Bu renk butonlar, kenarlıklar ve vurgular gibi tüm ana elemanlara otomatik olarak uygulanır.</p>
          <div style="display:flex;align-items:flex-start;gap:24px;flex-wrap:wrap">
            <div>
              <label style="margin-bottom:8px">Renk Seçici</label>
              <div style="display:flex;align-items:center;gap:12px">
                <input type="color" id="s-color-picker" value="${settings['primary_color']||'#BDA275'}"
                  style="width:64px;height:48px;border-radius:10px;border:2px solid var(--border);padding:4px;cursor:pointer;background:var(--bg4);flex-shrink:0" />
                <div>
                  <div style="font-size:11px;color:var(--text3);margin-bottom:4px">Seçili renk</div>
                  <div id="s-color-preview" style="width:120px;height:36px;border-radius:8px;border:1px solid var(--border);background:${settings['primary_color']||'#BDA275'}"></div>
                </div>
              </div>
            </div>
            <div style="flex:1;min-width:200px">
              <label style="margin-bottom:8px">Hex Kodu</label>
              <div style="display:flex;gap:8px;align-items:center">
                <input type="text" id="s-color-hex" value="${settings['primary_color']||'#BDA275'}"
                  placeholder="#BDA275" maxlength="7"
                  style="font-family:monospace;font-size:15px;letter-spacing:2px;max-width:160px" />
                <button class="btn btn-outline btn-sm" id="s-color-apply-hex" style="flex-shrink:0"><i class="fas fa-eye"></i> Önizle</button>
              </div>
              <div style="margin-top:12px">
                <div style="font-size:11px;color:var(--text3);margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px">Hazır Renkler</div>
                <div style="display:flex;gap:8px;flex-wrap:wrap" id="s-color-presets">
                  ${[['#BDA275','Kahve-Amber'],['#dc2626','Kırmızı'],['#5865F2','Mavi'],['#22c55e','Yeşil'],['#a855f7','Mor'],['#f97316','Turuncu'],['#06b6d4','Cyan'],['#eab308','Altın'],['#ec4899','Pembe'],['#64748b','Gri']].map(([c,n])=>`<button class="s-color-preset" data-color="${c}" title="${n}" style="width:28px;height:28px;border-radius:6px;border:2px solid ${(settings['primary_color']||'#BDA275')===c?'var(--text)':'transparent'};background:${c};cursor:pointer;transition:all 0.15s"></button>`).join('')}
                </div>
              </div>
            </div>
          </div>
          <div style="margin-top:16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
            <button class="btn btn-primary" id="s-color-save"><i class="fas fa-save"></i> Kaydet ve Uygula</button>
            <button class="btn btn-outline" id="s-color-reset"><i class="fas fa-undo"></i> Varsayılan</button>
            <div id="s-color-msg" class="form-error"></div>
          </div>
        </div>
      </div>
      <div class="card" style="grid-column: 1 / -1">
        <div class="card-header"><span><i class="fas fa-fill-drip" style="color:var(--red2);margin-right:8px"></i>Site Arka Plan Rengi</span></div>
        <div class="card-body">
          <p style="font-size:13px;color:var(--text2);margin-bottom:16px">Siyah ana arka plan yerine kullanılacak rengi belirleyin. Varsayılan renk: <code>#121212</code>.</p>
          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
            <input type="color" id="s-bg-color-picker" value="${settings['background_color']||'#121212'}" style="width:64px;height:48px;border-radius:10px;border:2px solid var(--border);padding:4px;cursor:pointer;background:var(--bg4)" />
            <input type="text" id="s-bg-color-hex" value="${settings['background_color']||'#121212'}" maxlength="7" placeholder="#121212" style="font-family:monospace;font-size:15px;letter-spacing:2px;max-width:160px" />
            <div id="s-bg-color-preview" style="width:120px;height:36px;border-radius:8px;border:1px solid var(--border);background:${settings['background_color']||'#121212'}"></div>
          </div>
          <div style="margin-top:16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
            <button class="btn btn-primary" id="s-bg-color-save"><i class="fas fa-save"></i> Kaydet ve Uygula</button>
            <button class="btn btn-outline" id="s-bg-color-reset"><i class="fas fa-undo"></i> #121212 Yap</button>
            <div id="s-bg-color-msg" class="form-error"></div>
          </div>
        </div>
      </div>
    </div>`;

  async function saveSetting(key, value, msgEl) {
    try {
      const response = await fetch('/api/admin/settings', { method:'POST', headers:{'Content-Type':'application/json','X-Admin-Token':adminToken}, body:JSON.stringify({key,value}) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Ayar kaydedilemedi');
      toast('Kaydedildi');
    } catch(e) { if(msgEl) msgEl.textContent=e.message; }
  }

  document.getElementById('s-light-theme-save')?.addEventListener('click', async () => {
    const msg = document.getElementById('s-light-theme-msg');
    await saveSetting('device_theme_enabled', document.getElementById('s-device-theme').checked ? '1' : '0', msg);
    await saveSetting('theme_picker_enabled', document.getElementById('s-theme-picker').checked ? '1' : '0', msg);
    await saveSetting('light_primary_color', document.getElementById('s-light-primary').value, msg);
    await saveSetting('light_background_color', document.getElementById('s-light-background').value, msg);
    msg.style.color = 'var(--green)'; msg.textContent = 'Tema ayarları kaydedildi';
  });

  document.getElementById('s-route-save')?.addEventListener('click', async () => {
    const msg = document.getElementById('s-route-msg');
    const routes = document.getElementById('s-protected-routes').value.split('\n').map(route => route.trim()).filter(route => route.startsWith('/')).filter((route, index, all) => all.indexOf(route) === index);
    const redirect = document.getElementById('s-route-redirect').value.trim() || '/';
    await saveSetting('route_protection_enabled', document.getElementById('s-route-protection').checked ? '1' : '0', msg);
    await saveSetting('protected_routes', JSON.stringify(routes), msg);
    await saveSetting('route_redirect', redirect, msg);
    msg.style.color = 'var(--green)'; msg.textContent = 'Route koruma ayarları kaydedildi';
  });

  const profileTabOptions = [
    ['forums', 'Forumlar', 'fas fa-comments'], ['books', 'Kitaplar', 'fas fa-book'],
    ['photos', 'Fotoğraflar', 'fas fa-images'], ['groups', 'Gruplar', 'fas fa-users'],
    ['videos', 'Videolar', 'fas fa-video'], ['saved', 'Kaydedilenler', 'fas fa-bookmark'], ['songs', 'Müzikler', 'fas fa-music']
  ];
  const profileTabsOrder = document.getElementById('profile-tabs-order');
  if (profileTabsOrder) {
    let configured = [];
    try { configured = JSON.parse(settings.profile_tabs || '[]'); } catch {}
    const order = [...configured, ...profileTabOptions.map(([id]) => id).filter(id => !configured.includes(id))];
    profileTabsOrder.innerHTML = order.map(id => {
      const item = profileTabOptions.find(option => option[0] === id);
      return item ? `<div class="profile-tab-order-row" data-id="${item[0]}"><span><i class="${item[2]}"></i>${item[1]}</span><span><button type="button" class="btn btn-ghost btn-xs profile-tab-up" title="Yukarı taşı"><i class="fas fa-chevron-up"></i></button><button type="button" class="btn btn-ghost btn-xs profile-tab-down" title="Aşağı taşı"><i class="fas fa-chevron-down"></i></button></span></div>` : '';
    }).join('');
    profileTabsOrder.addEventListener('click', event => {
      const row = event.target.closest('.profile-tab-order-row');
      if (!row) return;
      if (event.target.closest('.profile-tab-up') && row.previousElementSibling) profileTabsOrder.insertBefore(row, row.previousElementSibling);
      if (event.target.closest('.profile-tab-down') && row.nextElementSibling) profileTabsOrder.insertBefore(row.nextElementSibling, row);
    });
    document.getElementById('profile-tabs-save')?.addEventListener('click', async () => {
      const selected = Array.from(profileTabsOrder.children).map(row => row.dataset.id);
      await saveSetting('profile_tabs', JSON.stringify(selected), document.getElementById('profile-tabs-msg'));
      const msg = document.getElementById('profile-tabs-msg');
      msg.style.color = 'var(--green)'; msg.textContent = '✓ Sekme sırası kaydedildi';
    });
  }

  document.getElementById('s-general-save').addEventListener('click', async () => {
    const msg = document.getElementById('s-general-msg');
    await saveSetting('site_name', document.getElementById('s-sitename').value.trim(), msg);
    await saveSetting('site_description', document.getElementById('s-desc').value.trim(), msg);
  });
  document.getElementById('s-call-ringtone-save')?.addEventListener('click', async () => {
    const msg = document.getElementById('s-call-ringtone-msg');
    try {
      const file = document.getElementById('s-call-ringtone-file').files[0];
      let url = document.getElementById('s-call-ringtone-url').value.trim();
      if (file) {
        const form = new FormData(); form.append('ringtone', file);
        const response = await fetch('/api/admin/upload-call-ringtone', { method:'POST', headers:{'X-Admin-Token':adminToken}, body:form });
        const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Dosya yüklenemedi'); url = result.url;
      }
      await saveSetting('call_ringtone_url', url, msg); msg.style.color = 'var(--green)'; msg.textContent = 'Arama zil sesi kaydedildi';
    } catch (error) { msg.textContent = error.message; }
  });
  document.getElementById('s-pw-save').addEventListener('click', async () => {
    const msg = document.getElementById('s-pw-msg');
    const adminUsername = document.getElementById('s-admin-username').value.trim();
    if (!adminUsername) { msg.textContent='Ana admin kullanıcı adı boş olamaz'; return; }
    const pw = document.getElementById('s-newpw').value, pw2 = document.getElementById('s-newpw2').value;
    if (!pw) { msg.textContent='Şifre boş olamaz'; return; }
    if (pw !== pw2) { msg.textContent='Şifreler eşleşmiyor'; return; }
    const hashHex = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(pw)))).map(b=>b.toString(16).padStart(2,'0')).join('');
    await saveSetting('admin_password', hashHex, msg);
    await saveSetting('admin_username', adminUsername, msg);
    adminToken = hashHex; sessionStorage.setItem('admin_token', adminToken);
    msg.style.color='var(--green)'; msg.textContent='Şifre güncellendi';
  });
  document.getElementById('s-first-visit-auth-save')?.addEventListener('click', async () => {
    const msg = document.getElementById('s-first-visit-auth-msg');
    await saveSetting('first_visit_auth', document.getElementById('s-first-visit-auth').checked ? '1' : '0', msg);
    msg.style.color = 'var(--green)';
    msg.textContent = '✓ Ayar kaydedildi';
  });
  document.getElementById('s-footer-save').addEventListener('click', async () => {
    const msg = document.getElementById('s-footer-msg');
    await saveSetting('footer_copyright_text', document.getElementById('s-footer').value.trim() || '© 2026 İsmail D. Tüm hakları saklıdır.', msg);
  });
  document.getElementById('s-kvkk-save').addEventListener('click', async () => {
    await saveSetting('kvkk_text', document.getElementById('s-kvkk').value.trim(), document.getElementById('s-kvkk-msg'));

  document.getElementById('s-block-new-save')?.addEventListener('click', async () => {
    const val = document.getElementById('s-block-new-accounts').checked ? '1' : '0';
    const msg = document.getElementById('s-block-new-msg');
    await saveSetting('block_new_accounts', val, msg);
    msg.style.color = 'var(--accent-green)';
    msg.textContent = 'Kaydedildi';
    setTimeout(() => { msg.textContent = ''; }, 2000);
  });
  });
  document.getElementById('s-music-own-save').addEventListener('click', async () => {
    await saveSetting('music_own_rules', document.getElementById('s-music-own').value.trim(), document.getElementById('s-music-msg'));
  });
  document.getElementById('s-other-toggle-save').addEventListener('click', async () => {
    await saveSetting('other_songs_enabled', document.getElementById('s-other-songs-enabled').checked ? '1' : '0', document.getElementById('s-music-msg'));
  });
  document.getElementById('s-music-other-save').addEventListener('click', async () => {
    await saveSetting('music_other_rules', document.getElementById('s-music-other').value.trim(), document.getElementById('s-music-msg'));
  });
  document.getElementById('s-video-save').addEventListener('click', async () => {
    const msg = document.getElementById('s-video-msg');
    try {
      await adminApi('/video-settings', { method:'POST', body: JSON.stringify({
        uploadSuccessText: document.getElementById('s-video-success-text').value.trim(),
        uploadSuccessDuration: document.getElementById('s-video-success-duration').value.trim(),
        defaultDescription: document.getElementById('s-video-default-desc').value.trim(),
        emptyDescriptionText: document.getElementById('s-video-empty-desc').value.trim()
      }) });
      toast('Video ayarları kaydedildi');
      msg.style.color='var(--green)'; msg.textContent='✓ Kaydedildi';
    } catch (e) { msg.textContent=e.message; }
  });

  // Reals reminder save
  document.getElementById('s-reals-save')?.addEventListener('click', async () => {
    const msg = document.getElementById('s-reals-msg');
    try {
      await saveSetting('reals_reminder', document.getElementById('s-reals-reminder').value.trim(), msg);
      msg.style.color='var(--green)'; msg.textContent='✓ Kaydedildi';
    } catch (e) { msg.textContent=e.message; }
  });

  // ===== TEMA RENGİ =====
  const colorPicker = document.getElementById('s-color-picker');
  const colorHex = document.getElementById('s-color-hex');
  const colorPreview = document.getElementById('s-color-preview');
  const colorMsg = document.getElementById('s-color-msg');

  function syncColorUI(hex) {
    if (colorPicker) colorPicker.value = hex;
    if (colorHex) colorHex.value = hex;
    if (colorPreview) colorPreview.style.background = hex;
    document.querySelectorAll('.s-color-preset').forEach(btn => {
      btn.style.border = btn.dataset.color === hex ? '2px solid var(--text)' : '2px solid transparent';
    });
    applyThemeColor(hex);
  }

  if (colorPicker) {
    colorPicker.addEventListener('input', () => syncColorUI(colorPicker.value));
  }

  document.getElementById('s-color-apply-hex')?.addEventListener('click', () => {
    let hex = colorHex.value.trim();
    if (!hex.startsWith('#')) hex = '#' + hex;
    if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
      syncColorUI(hex);
    } else {
      colorMsg.textContent = 'Geçerli bir hex kodu girin (örn: #BDA275)';
    }
  });

  colorHex?.addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('s-color-apply-hex')?.click();
  });

  document.querySelectorAll('.s-color-preset').forEach(btn => {
    btn.addEventListener('click', () => syncColorUI(btn.dataset.color));
  });

  document.getElementById('s-color-save')?.addEventListener('click', async () => {
    colorMsg.textContent = '';
    const hex = colorHex ? colorHex.value.trim() : colorPicker.value;
    const finalHex = hex.startsWith('#') ? hex : '#' + hex;
    if (!/^#[0-9A-Fa-f]{6}$/.test(finalHex)) {
      colorMsg.style.color='var(--red2)'; colorMsg.textContent='Geçersiz renk kodu';
      return;
    }
    try {
      await fetch('/api/admin/settings', {
        method:'POST',
        headers:{'Content-Type':'application/json','X-Admin-Token':adminToken},
        body:JSON.stringify({key:'primary_color', value:finalHex})
      });
      applyThemeColor(finalHex);
      syncColorUI(finalHex);
      toast('Tema rengi kaydedildi!');
      colorMsg.style.color='var(--green)'; colorMsg.textContent='✓ Kaydedildi';
    } catch(e) { colorMsg.style.color='var(--red2)'; colorMsg.textContent=e.message; }
  });

  document.getElementById('s-color-reset')?.addEventListener('click', async () => {
    const defaultColor = '#BDA275';
    syncColorUI(defaultColor);
    try {
      await fetch('/api/admin/settings', {
        method:'POST',
        headers:{'Content-Type':'application/json','X-Admin-Token':adminToken},
        body:JSON.stringify({key:'primary_color', value:defaultColor})
      });
      toast('Varsayılan renge döndürüldü');
      colorMsg.style.color='var(--green)'; colorMsg.textContent='✓ Sıfırlandı';
    } catch(e) { colorMsg.style.color='var(--red2)'; colorMsg.textContent=e.message; }
  });

  const bgPicker = document.getElementById('s-bg-color-picker');
  const bgHex = document.getElementById('s-bg-color-hex');
  const bgPreview = document.getElementById('s-bg-color-preview');
  const bgMsg = document.getElementById('s-bg-color-msg');
  const syncBackgroundUI = hex => {
    if (bgPicker) bgPicker.value = hex;
    if (bgHex) bgHex.value = hex;
    if (bgPreview) bgPreview.style.background = hex;
    document.documentElement.style.setProperty('--bg-primary', hex);
  };
  bgPicker?.addEventListener('input', () => syncBackgroundUI(bgPicker.value));
  bgHex?.addEventListener('input', () => { if (/^#[0-9A-Fa-f]{6}$/.test(bgHex.value.trim())) syncBackgroundUI(bgHex.value.trim()); });
  document.getElementById('s-bg-color-save')?.addEventListener('click', async () => {
    const hex = (bgHex?.value || '').trim();
    if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) { bgMsg.textContent = 'Geçerli bir hex kodu girin.'; return; }
    await saveSetting('background_color', hex, bgMsg);
    syncBackgroundUI(hex); bgMsg.style.color = 'var(--green)'; bgMsg.textContent = '✓ Kaydedildi';
  });
  document.getElementById('s-bg-color-reset')?.addEventListener('click', async () => {
    await saveSetting('background_color', '#121212', bgMsg);
    syncBackgroundUI('#121212'); bgMsg.style.color = 'var(--green)'; bgMsg.textContent = '✓ Sıfırlandı';
  });

  // ===== KİTAP ARKA PLAN RENGİ =====
  const bookBgPicker = document.getElementById('s-book-bg-picker');
  const bookBgHex    = document.getElementById('s-book-bg-hex');
  const bookBgPreview = document.getElementById('s-book-bg-preview');
  const bookBgMsg    = document.getElementById('s-book-bg-msg');

  function syncBookBgUI(hex) {
    if (bookBgPicker)  bookBgPicker.value = hex;
    if (bookBgHex)     bookBgHex.value    = hex;
    if (bookBgPreview) bookBgPreview.style.background = hex;
    document.querySelectorAll('.s-book-bg-preset').forEach(btn => {
      btn.style.border = btn.dataset.color === hex ? '2px solid var(--text)' : '2px solid transparent';
    });
  }

  bookBgPicker?.addEventListener('input', () => syncBookBgUI(bookBgPicker.value));

  document.getElementById('s-book-bg-apply-hex')?.addEventListener('click', () => {
    let hex = bookBgHex.value.trim();
    if (!hex.startsWith('#')) hex = '#' + hex;
    if (/^#[0-9A-Fa-f]{6}$/.test(hex)) syncBookBgUI(hex);
    else { bookBgMsg.style.color='var(--red2)'; bookBgMsg.textContent='Geçerli bir hex kodu girin (örn: #F4ECD8)'; }
  });

  bookBgHex?.addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('s-book-bg-apply-hex')?.click();
  });

  document.querySelectorAll('.s-book-bg-preset').forEach(btn => {
    btn.addEventListener('click', () => syncBookBgUI(btn.dataset.color));
  });

  document.getElementById('s-book-bg-save')?.addEventListener('click', async () => {
    bookBgMsg.textContent = '';
    let hex = (bookBgHex ? bookBgHex.value.trim() : bookBgPicker.value);
    if (!hex.startsWith('#')) hex = '#' + hex;
    if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) {
      bookBgMsg.style.color='var(--red2)'; bookBgMsg.textContent='Geçersiz renk kodu'; return;
    }
    try {
      await fetch('/api/admin/settings', {
        method:'POST',
        headers:{'Content-Type':'application/json','X-Admin-Token':adminToken},
        body:JSON.stringify({key:'book_bg_color', value:hex})
      });
      syncBookBgUI(hex);
      toast('Kitap arka plan rengi kaydedildi!');
      bookBgMsg.style.color='var(--green)'; bookBgMsg.textContent='✓ Kaydedildi';
    } catch(e) { bookBgMsg.style.color='var(--red2)'; bookBgMsg.textContent=e.message; }
  });

  document.getElementById('s-book-bg-reset')?.addEventListener('click', async () => {
    const def = '#F4ECD8';
    syncBookBgUI(def);
    try {
      await fetch('/api/admin/settings', {
        method:'POST',
        headers:{'Content-Type':'application/json','X-Admin-Token':adminToken},
        body:JSON.stringify({key:'book_bg_color', value:def})
      });
      toast('Kitap arka plan varsayılana döndürüldü');
      bookBgMsg.style.color='var(--green)'; bookBgMsg.textContent='✓ Sıfırlandı';
    } catch(e) { bookBgMsg.style.color='var(--red2)'; bookBgMsg.textContent=e.message; }
  });
}




// ===================================================================
// MAĞAZA (STORE) ADMIN SECTIONS - admin.js'ye eklenecek
// loadSection() map'ine şunları ekle:
//   'shop': renderShop,
//   'shop-orders': renderShopOrders,
//   'shop-settings': renderShopSettings,
// ===================================================================

// ===== MAĞAZA ÜRÜN YÖNETİMİ =====
async function renderShop(main) {
  main.innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';
  let products = [];
  try { products = await adminApi('/shop/products'); } catch(e) {
    main.innerHTML = `<div class="adm-section-header"><div class="adm-section-title"><div class="icon-pill"><i class="fas fa-store"></i></div> Mağaza</div></div><div class="card"><div class="card-body" style="color:var(--red2);padding:20px"><i class="fas fa-exclamation-circle"></i> ${escHtml(e.message)}</div></div>`;
    return;
  }

  main.innerHTML = `
  <div class="adm-section-header" style="align-items:center">
    <div class="adm-section-title"><div class="icon-pill"><i class="fas fa-store"></i></div> Mağaza Ürünleri <span style="font-size:13px;font-weight:400;color:var(--text2)">(${products.length})</span></div>
    <button class="btn btn-primary" id="shop-add-btn"><i class="fas fa-plus"></i> Yeni Ürün</button>
  </div>
  <div id="shop-products-list">
    ${products.length === 0 ? `<div class="card"><div class="card-body" style="padding:40px;text-align:center;color:var(--text2)"><i class="fas fa-store-alt-slash" style="font-size:40px;opacity:.3;display:block;margin-bottom:12px"></i>Henüz ürün yok.</div></div>` : ''}
  </div>`;

  function renderProductList(list) {
    const container = document.getElementById('shop-products-list');
    if (!container) return;
    if (!list.length) {
      container.innerHTML = `<div class="card"><div class="card-body" style="padding:40px;text-align:center;color:var(--text2)"><i class="fas fa-store-alt-slash" style="font-size:40px;opacity:.3;display:block;margin-bottom:12px"></i>Henüz ürün yok.</div></div>`;
      return;
    }
    const typeColors = { vip: '#fbbf24', plus: '#818cf8', admin: '#22c55e' };
    const typeIcons  = { vip: 'fas fa-gem', plus: 'fas fa-plus-circle', admin: 'fas fa-shield-alt' };
    container.innerHTML = `<div class="card"><div class="card-body" style="padding:0">
      <table class="admin-table">
        <thead><tr>
          <th>Ürün</th><th>Tür</th><th>Fiyat</th><th>Orijinal</th><th>Süre</th><th>Durum</th><th>Sıra</th><th>İşlem</th>
        </tr></thead>
        <tbody>
          ${list.map(p => {
            const color = typeColors[p.type] || '#aaa';
            const icon  = typeIcons[p.type]  || 'fas fa-box';
            const hasSale = p.original_price && parseFloat(p.original_price) > parseFloat(p.price);
            const discountPct = hasSale ? Math.round((1 - parseFloat(p.price)/parseFloat(p.original_price)) * 100) : 0;
            return `<tr>
              <td>
                <div style="display:flex;align-items:center;gap:10px">
                  <div style="width:32px;height:32px;border-radius:8px;background:${color}22;color:${color};display:flex;align-items:center;justify-content:center"><i class="${escHtml(p.badge_icon||icon)}"></i></div>
                  <div>
                    <div style="font-weight:600;font-size:13px">${escHtml(p.name)}</div>
                    ${p.description ? `<div style="font-size:11px;color:var(--text2)">${escHtml(p.description.substring(0,50))}${p.description.length>50?'...':''}</div>` : ''}
                  </div>
                </div>
              </td>
              <td><span style="color:${color};font-weight:600;text-transform:uppercase;font-size:12px">${escHtml(p.type)}</span></td>
              <td>
                <span style="font-weight:700;font-size:15px">${parseFloat(p.price).toFixed(2)} ₺</span>
                ${hasSale ? `<span style="margin-left:4px;background:#ef444422;color:#ef4444;font-size:10px;font-weight:700;padding:1px 6px;border-radius:20px">-%${discountPct}</span>` : ''}
              </td>
              <td>${p.original_price ? `<span style="text-decoration:line-through;color:var(--text2);font-size:13px">${parseFloat(p.original_price).toFixed(2)} ₺</span>` : '-'}</td>
              <td>${p.duration_days} gün</td>
              <td>
                <span class="toggle-visible" data-id="${p.id}" data-visible="${p.visible}" style="cursor:pointer;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;${p.visible?'background:#22c55e18;color:#22c55e;border:1px solid #22c55e33':'background:#ef444418;color:#ef4444;border:1px solid #ef444433'}">
                  ${p.visible ? '<i class="fas fa-eye"></i> Görünür' : '<i class="fas fa-eye-slash"></i> Gizli'}
                </span>
              </td>
              <td>${p.sort_order}</td>
              <td>
                <div style="display:flex;gap:6px">
                  <button class="btn btn-outline btn-sm shop-edit-btn" data-id="${p.id}"><i class="fas fa-edit"></i></button>
                  <button class="btn btn-sm shop-del-btn" data-id="${p.id}" style="background:#ef444420;color:#ef4444;border:1px solid #ef444430"><i class="fas fa-trash"></i></button>
                </div>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div></div>`;

    // Toggle görünürlük
    container.querySelectorAll('.toggle-visible').forEach(el => {
      el.addEventListener('click', async () => {
        const id = el.dataset.id;
        const newVisible = el.dataset.visible === '1' ? 0 : 1;
        try {
          const updated = await adminApi('/shop/products/' + id, { method: 'PUT', body: JSON.stringify({ visible: newVisible }) });
          const idx = products.findIndex(p => String(p.id) === String(id));
          if (idx !== -1) products[idx] = updated;
          renderProductList(products);
          toast(newVisible ? 'Ürün görünür yapıldı' : 'Ürün gizlendi');
        } catch(e) { toast(e.message, 'error'); }
      });
    });

    // Düzenle
    container.querySelectorAll('.shop-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = products.find(x => String(x.id) === String(btn.dataset.id));
        if (!p) return;
        showProductModal(p, async (data) => {
          try {
            const updated = await adminApi('/shop/products/' + p.id, { method: 'PUT', body: JSON.stringify(data) });
            const idx = products.findIndex(x => x.id === p.id);
            if (idx !== -1) products[idx] = updated;
            renderProductList(products);
            hideModal();
            toast('Ürün güncellendi');
          } catch(e) { toast(e.message, 'error'); }
        });
      });
    });

    // Sil
    container.querySelectorAll('.shop-del-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Bu ürün silinsin mi?')) return;
        try {
          await adminApi('/shop/products/' + btn.dataset.id, { method: 'DELETE' });
          const idx = products.findIndex(p => String(p.id) === String(btn.dataset.id));
          if (idx !== -1) products.splice(idx, 1);
          renderProductList(products);
          toast('Ürün silindi');
        } catch(e) { toast(e.message, 'error'); }
      });
    });
  }

  function showProductModal(existing, onSave) {
    const features = existing ? (() => { try { return JSON.parse(existing.features || '[]'); } catch { return []; } })() : [];
    showModal(existing ? 'Ürün Düzenle' : 'Yeni Ürün Ekle', `
      <style>
        .shop-form-group { margin-bottom:14px; }
        .shop-form-group label { display:block;font-size:11px;font-weight:600;color:var(--text2);margin-bottom:5px;text-transform:uppercase;letter-spacing:.5px }
        .shop-feat-row { display:flex;gap:6px;margin-bottom:6px }
        .shop-feat-row input { flex:1 }
      </style>
      <div class="shop-form-group">
        <label>Ürün Adı *</label>
        <input id="sp-name" type="text" value="${escHtml(existing?.name||'')}">
      </div>
      <div class="shop-form-group">
        <label>Açıklama</label>
        <textarea id="sp-desc" rows="2">${escHtml(existing?.description||'')}</textarea>
      </div>
      <div class="shop-form-group">
        <label>Tür *</label>
        <select id="sp-type">
          <option value="vip" ${existing?.type==='vip'?'selected':''}>VIP</option>
          <option value="plus" ${existing?.type==='plus'?'selected':''}>Plus</option>
          <option value="admin" ${existing?.type==='admin'?'selected':''}>Admin</option>
        </select>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div class="shop-form-group">
          <label>Fiyat (₺) *</label>
          <input id="sp-price" type="number" step="0.01" min="0" value="${existing?.price||''}">
        </div>
        <div class="shop-form-group">
          <label>Orijinal Fiyat (₺) <small style="text-transform:none;font-weight:400">(indirim için)</small></label>
          <input id="sp-orig" type="number" step="0.01" min="0" value="${existing?.original_price||''}">
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div class="shop-form-group">
          <label>Süre (gün)</label>
          <input id="sp-days" type="number" min="1" value="${existing?.duration_days||30}">
        </div>
        <div class="shop-form-group">
          <label>Sıra</label>
          <input id="sp-sort" type="number" value="${existing?.sort_order||0}">
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div class="shop-form-group">
          <label>Rozet İkonu (Font Awesome)</label>
          <input id="sp-icon" type="text" value="${escHtml(existing?.badge_icon||'fas fa-gem')}" placeholder="fas fa-gem">
        </div>
        <div class="shop-form-group">
          <label>Rozet Rengi</label>
          <input id="sp-color" type="color" value="${existing?.badge_color||'#fbbf24'}" style="width:100%;height:38px;padding:2px;cursor:pointer">
        </div>
      </div>
      <div class="shop-form-group">
        <label>Özellikler</label>
        <div id="sp-feats-list">
          ${features.map((f,i)=>`<div class="shop-feat-row"><input class="sp-feat-input" type="text" value="${escHtml(f)}"><button type="button" class="btn-remove-feat btn btn-sm" style="background:#ef444420;color:#ef4444;border:1px solid #ef444430;padding:0 10px"><i class="fas fa-times"></i></button></div>`).join('')}
        </div>
        <button type="button" id="sp-add-feat" class="btn btn-outline btn-sm" style="margin-top:6px"><i class="fas fa-plus"></i> Özellik Ekle</button>
      </div>
      <div class="shop-form-group">
        <label>Görünürlük</label>
        <select id="sp-visible">
          <option value="1" ${existing?.visible!=0?'selected':''}>Görünür</option>
          <option value="0" ${existing?.visible==0?'selected':''}>Gizli</option>
        </select>
      </div>
      <div style="display:flex;gap:10px;margin-top:16px">
        <button id="sp-save" class="btn btn-primary" style="flex:1"><i class="fas fa-save"></i> Kaydet</button>
        <button onclick="hideModal()" class="btn btn-outline" style="flex:1">İptal</button>
      </div>
    `);

    document.getElementById('sp-add-feat')?.addEventListener('click', () => {
      const list = document.getElementById('sp-feats-list');
      const row = document.createElement('div');
      row.className = 'shop-feat-row';
      row.innerHTML = `<input class="sp-feat-input" type="text" placeholder="özellik..."><button type="button" class="btn-remove-feat btn btn-sm" style="background:#ef444420;color:#ef4444;border:1px solid #ef444430;padding:0 10px"><i class="fas fa-times"></i></button>`;
      list.appendChild(row);
      row.querySelector('.btn-remove-feat').addEventListener('click', () => row.remove());
    });

    document.getElementById('sp-feats-list')?.querySelectorAll('.btn-remove-feat').forEach(btn => {
      btn.addEventListener('click', () => btn.closest('.shop-feat-row').remove());
    });

    document.getElementById('sp-save')?.addEventListener('click', () => {
      const name = document.getElementById('sp-name')?.value.trim();
      const type = document.getElementById('sp-type')?.value;
      const price = parseFloat(document.getElementById('sp-price')?.value);
      if (!name || !type || isNaN(price)) { toast('Ad, tür ve fiyat zorunlu', 'error'); return; }
      const origVal = document.getElementById('sp-orig')?.value;
      const feats = Array.from(document.querySelectorAll('.sp-feat-input')).map(i=>i.value.trim()).filter(Boolean);
      onSave({
        name, description: document.getElementById('sp-desc')?.value||'',
        features: feats, type, price,
        original_price: origVal ? parseFloat(origVal) : null,
        duration_days: parseInt(document.getElementById('sp-days')?.value)||30,
        visible: parseInt(document.getElementById('sp-visible')?.value),
        badge_icon: document.getElementById('sp-icon')?.value.trim()||'fas fa-gem',
        badge_color: document.getElementById('sp-color')?.value||'#fbbf24',
        sort_order: parseInt(document.getElementById('sp-sort')?.value)||0
      });
    });
  }

  renderProductList(products);

  document.getElementById('shop-add-btn')?.addEventListener('click', () => {
    showProductModal(null, async (data) => {
      try {
        const created = await adminApi('/shop/products', { method: 'POST', body: JSON.stringify(data) });
        products.push(created);
        renderProductList(products);
        hideModal();
        toast('Ürün eklendi');
      } catch(e) { toast(e.message, 'error'); }
    });
  });
}

// ===== MAĞAZA SİPARİŞLERİ =====
async function renderShopOrders(main) {
  main.innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';

  const statusMap = {
    pending:   { label:'Bekliyor',   color:'#f59e0b', bg:'#f59e0b18', border:'#f59e0b30' },
    completed: { label:'Tamamlandı', color:'#22c55e', bg:'#22c55e18', border:'#22c55e30' },
    failed:    { label:'Başarısız',  color:'#ef4444', bg:'#ef444418', border:'#ef444430' },
    refunded:  { label:'İade',       color:'#818cf8', bg:'#818cf818', border:'#818cf830' },
  };

  let orders = [];
  try { orders = await adminApi('/shop/orders?limit=200'); } catch(e) {
    main.innerHTML = `<div class="adm-section-header"><div class="adm-section-title"><div class="icon-pill"><i class="fas fa-receipt"></i></div> Siparişler</div></div><div class="card"><div class="card-body" style="color:var(--red2);padding:20px">${escHtml(e.message)}</div></div>`;
    return;
  }

  const filterHTML = (status='') => `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">
      ${['','pending','completed','failed','refunded'].map(s => {
        const m = statusMap[s] || { label:'Tümü', color:'var(--text)', bg:'var(--bg4)', border:'var(--border)' };
        const active = s === status;
        return `<button class="shop-order-filter-btn btn btn-sm" data-status="${s}" style="background:${active?m.bg:'transparent'};color:${active?m.color:'var(--text2)'};border:1px solid ${active?m.border:'var(--border)'};font-weight:${active?700:400}">${s?m.label:'Tümü'} ${s?`(${orders.filter(o=>o.status===s).length})`:''}</button>`;
      }).join('')}
    </div>`;

  function renderOrderTable(filteredOrders) {
    const tbody = document.getElementById('shop-orders-tbody');
    if (!tbody) return;
    if (!filteredOrders.length) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text2)">Sipariş bulunamadı</td></tr>`;
      return;
    }
    tbody.innerHTML = filteredOrders.map(o => {
      const sm = statusMap[o.status] || { label:o.status, color:'var(--text)', bg:'var(--bg4)', border:'var(--border)' };
      const typeColors = { vip:'#fbbf24', plus:'#818cf8', admin:'#22c55e' };
      const tc = typeColors[o.product_type] || '#aaa';
      return `<tr>
        <td style="font-weight:600;font-size:13px">#${o.id}</td>
        <td>
          <div style="font-weight:600">${escHtml(o.username||'—')}</div>
          <div style="font-size:11px;color:var(--text2)">${escHtml(o.email||'')}</div>
        </td>
        <td>
          <div style="font-weight:600">${escHtml(o.product_name)}</div>
          <span style="color:${tc};font-size:11px;font-weight:700;text-transform:uppercase">${escHtml(o.product_type)}</span>
        </td>
        <td style="font-weight:700;font-size:15px">${parseFloat(o.amount||0).toFixed(2)} ₺</td>
        <td><span style="background:${sm.bg};color:${sm.color};border:1px solid ${sm.border};padding:3px 9px;border-radius:20px;font-size:11px;font-weight:600">${sm.label}</span></td>
        <td style="font-size:12px;color:var(--text2)">${o.shopier_order_id||'—'}</td>
        <td style="font-size:12px">${formatDate(o.created_at)}</td>
        <td>
          <select class="order-status-select" data-id="${o.id}" style="font-size:11px;padding:4px 8px;background:var(--bg4);border:1px solid var(--border);color:var(--text);border-radius:6px;cursor:pointer">
            <option value="pending"   ${o.status==='pending'?'selected':''}>Bekliyor</option>
            <option value="completed" ${o.status==='completed'?'selected':''}>Tamamlandı</option>
            <option value="failed"    ${o.status==='failed'?'selected':''}>Başarısız</option>
            <option value="refunded"  ${o.status==='refunded'?'selected':''}>İade</option>
          </select>
        </td>
      </tr>`;
    }).join('');

    tbody.querySelectorAll('.order-status-select').forEach(sel => {
      sel.addEventListener('change', async () => {
        const id = sel.dataset.id;
        const newStatus = sel.value;
        try {
          await adminApi('/shop/orders/' + id, { method: 'PUT', body: JSON.stringify({ status: newStatus }) });
          const idx = orders.findIndex(o => String(o.id) === String(id));
          if (idx !== -1) orders[idx].status = newStatus;
          toast('Sipariş durumu güncellendi');
          const activeFilter = document.querySelector('.shop-order-filter-btn.active-filter')?.dataset.status || '';
          renderOrderTable(activeFilter ? orders.filter(o=>o.status===activeFilter) : orders);
        } catch(e) { toast(e.message, 'error'); sel.value = orders.find(o=>String(o.id)===String(id))?.status || sel.value; }
      });
    });
  }

  const statsCompleted = orders.filter(o=>o.status==='completed');
  const totalRevenue = statsCompleted.reduce((s,o)=>s+parseFloat(o.amount||0),0);

  main.innerHTML = `
  <div class="adm-section-header">
    <div class="adm-section-title"><div class="icon-pill"><i class="fas fa-receipt"></i></div> Siparişler <span style="font-size:13px;font-weight:400;color:var(--text2)">(${orders.length})</span></div>
  </div>
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin-bottom:20px">
    <div class="card" style="text-align:center;padding:16px">
      <div style="font-size:22px;font-weight:800;color:#22c55e">${statsCompleted.length}</div>
      <div style="font-size:11px;color:var(--text2);margin-top:4px">Tamamlanan</div>
    </div>
    <div class="card" style="text-align:center;padding:16px">
      <div style="font-size:22px;font-weight:800;color:#f59e0b">${orders.filter(o=>o.status==='pending').length}</div>
      <div style="font-size:11px;color:var(--text2);margin-top:4px">Bekleyen</div>
    </div>
    <div class="card" style="text-align:center;padding:16px">
      <div style="font-size:22px;font-weight:800;color:var(--red2)">${totalRevenue.toFixed(2)} ₺</div>
      <div style="font-size:11px;color:var(--text2);margin-top:4px">Toplam Gelir</div>
    </div>
    <div class="card" style="text-align:center;padding:16px">
      <div style="font-size:22px;font-weight:800">${orders.filter(o=>o.status==='refunded').length}</div>
      <div style="font-size:11px;color:var(--text2);margin-top:4px">İade</div>
    </div>
  </div>
  <div class="card">
    <div class="card-body">
      <div id="shop-order-filter-wrap">${filterHTML()}</div>
      <div style="overflow-x:auto">
        <table class="admin-table">
          <thead><tr>
            <th>#</th><th>Kullanıcı</th><th>Ürün</th><th>Tutar</th><th>Durum</th><th>Shopier ID</th><th>Tarih</th><th>Güncelle</th>
          </tr></thead>
          <tbody id="shop-orders-tbody"></tbody>
        </table>
      </div>
    </div>
  </div>`;

  renderOrderTable(orders);

  document.getElementById('shop-order-filter-wrap')?.addEventListener('click', e => {
    const btn = e.target.closest('.shop-order-filter-btn');
    if (!btn) return;
    document.querySelectorAll('.shop-order-filter-btn').forEach(b => {
      b.classList.remove('active-filter');
      const s = b.dataset.status;
      const m = statusMap[s] || { color:'var(--text)', bg:'transparent', border:'var(--border)' };
      b.style.background = 'transparent'; b.style.color = 'var(--text2)'; b.style.border = '1px solid var(--border)'; b.style.fontWeight = '400';
    });
    btn.classList.add('active-filter');
    const s = btn.dataset.status;
    const m = statusMap[s] || { color:'var(--text)', bg:'var(--bg4)', border:'var(--border)' };
    btn.style.background = s ? m.bg : 'var(--bg4)';
    btn.style.color = s ? m.color : 'var(--text)';
    btn.style.border = '1px solid ' + (s ? m.border : 'var(--border)');
    btn.style.fontWeight = '700';
    renderOrderTable(s ? orders.filter(o=>o.status===s) : orders);
  });
}

// ===== SHOPIER ÖDEME AYARLARI =====
async function renderShopSettings(main) {
  main.innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';
  let setts = {};
  try { setts = await adminApi('/shop/settings'); } catch {}

  main.innerHTML = `
  <div class="adm-section-header">
    <div class="adm-section-title"><div class="icon-pill"><i class="fas fa-credit-card"></i></div> Ödeme Sistemi (Shopier)</div>
  </div>
  <style>
    .pay-section { background:var(--bg2);border:1px solid var(--border);border-radius:14px;padding:24px;margin-bottom:20px }
    .pay-section h3 { font-size:15px;font-weight:700;margin-bottom:16px;display:flex;align-items:center;gap:8px }
    .pay-field { margin-bottom:14px }
    .pay-field label { display:block;font-size:11px;font-weight:600;color:var(--text2);margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px }
    .pay-field input, .pay-field select { width:100%;padding:10px 12px;background:var(--bg3);border:1px solid var(--border);color:var(--text);border-radius:8px;font-size:13px;outline:none }
    .pay-field input:focus { border-color:rgba(189,162,117,.5) }
    .pay-status { display:flex;align-items:center;gap:8px;padding:12px 16px;border-radius:10px;margin-bottom:20px;font-size:13px;font-weight:600 }
    .pay-status.active { background:#22c55e18;border:1px solid #22c55e30;color:#22c55e }
    .pay-status.inactive { background:#ef444418;border:1px solid #ef444430;color:#ef4444 }
  </style>

  <div class="${setts.shopier_enabled==='1'?'pay-status active':'pay-status inactive'}" id="pay-status-banner">
    <i class="fas fa-${setts.shopier_enabled==='1'?'check-circle':'exclamation-circle'}"></i>
    ${setts.shopier_enabled==='1'?'Ödeme sistemi aktif — Shopier entegrasyonu çalışıyor.':'Ödeme sistemi pasif — Aşağıdaki bilgileri girerek aktifleştirin.'}
  </div>

  <div class="pay-section">
    <h3><i class="fas fa-key" style="color:#fbbf24"></i> Shopier API Bilgileri</h3>
    <p style="font-size:12px;color:var(--text2);margin-bottom:16px;line-height:1.5">
      Shopier hesabınızdan API Ayarları sayfasına gidin. <strong>API Key</strong>, <strong>API Secret</strong> ve <strong>Website Index</strong> bilgilerini buraya girin.
      Tüm bilgileri doldurduktan sonra sistemi aktifleştirin.
    </p>

    <div class="pay-field">
      <label>Shopier API Key</label>
      <input id="ss-api-key" type="text" value="${escHtml(setts.shopier_api_key||'')}" placeholder="Shopier API Key'inizi girin">
    </div>
    <div class="pay-field">
      <label>Shopier API Secret</label>
      <input id="ss-api-secret" type="password" value="${escHtml(setts.shopier_api_secret||'')}" placeholder="Shopier API Secret'inizi girin">
    </div>
    <div class="pay-field">
      <label>Website Index</label>
      <input id="ss-website-index" type="text" value="${escHtml(setts.shopier_website_index||'1')}" placeholder="Genellikle 1">
    </div>

    <div class="pay-field">
      <label>Sistem Durumu</label>
      <select id="ss-enabled">
        <option value="1" ${setts.shopier_enabled==='1'?'selected':''}>✅ Aktif — Ödemeler alınıyor</option>
        <option value="0" ${setts.shopier_enabled!=='1'?'selected':''}>❌ Pasif — Ödemeler devre dışı</option>
      </select>
    </div>

    <button id="ss-save" class="btn btn-primary" style="width:100%;margin-top:8px">
      <i class="fas fa-save"></i> Ayarları Kaydet & Aktifleştir
    </button>
    <div id="ss-msg" style="margin-top:10px;font-size:12px;text-align:center"></div>
  </div>

  <div class="pay-section">
    <h3><i class="fas fa-info-circle" style="color:#5865F2"></i> Webhook Bilgisi</h3>
    <p style="font-size:12px;color:var(--text2);line-height:1.6;margin-bottom:10px">
      Shopier panelinde <strong>Geri Bildirim URL'si</strong> (callback/IPN) olarak aşağıdaki adresi girin:
    </p>
    <div style="background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:12px;font-family:monospace;font-size:13px;word-break:break-all;user-select:all;color:var(--text)">
      <span id="webhook-url">${location.origin}/api/shop/webhook</span>
    </div>
    <button onclick="navigator.clipboard.writeText(document.getElementById('webhook-url').textContent);window.adminToastFn&&window.adminToastFn('Kopyalandı!')" class="btn btn-outline btn-sm" style="margin-top:10px">
      <i class="fas fa-copy"></i> Kopyala
    </button>
  </div>

  <div class="pay-section">
    <h3><i class="fas fa-question-circle" style="color:#06b6d4"></i> Nasıl Ayarlanır?</h3>
    <ol style="font-size:13px;color:var(--text2);line-height:2;padding-left:20px">
      <li>Shopier hesabınıza giriş yapın → <strong>Ayarlar</strong> → <strong>API Entegrasyonu</strong></li>
      <li>API Key ve API Secret bilgilerini kopyalayın</li>
      <li>Website Index'i öğrenin (genellikle 1)</li>
      <li>Yukarıdaki webhook URL'sini Shopier'daki <strong>Callback URL</strong> alanına girin</li>
      <li>Tüm bilgileri doldurun → <strong>Kaydet & Aktifleştir</strong> butonuna tıklayın</li>
      <li>Sistem otomatik olarak aktif hale gelir ✅</li>
    </ol>
  </div>`;

  document.getElementById('ss-save')?.addEventListener('click', async () => {
    const apiKey     = document.getElementById('ss-api-key')?.value.trim();
    const apiSecret  = document.getElementById('ss-api-secret')?.value.trim();
    const webIdx     = document.getElementById('ss-website-index')?.value.trim() || '1';
    const enabled    = document.getElementById('ss-enabled')?.value;
    const msg        = document.getElementById('ss-msg');

    if (enabled === '1' && (!apiKey || !apiSecret)) {
      msg.style.color = 'var(--red2)';
      msg.textContent = '⚠️ Sistemi aktifleştirmek için API Key ve API Secret zorunludur!';
      return;
    }

    try {
      await adminApi('/shop/settings', {
        method: 'POST',
        body: JSON.stringify({
          shopier_api_key: apiKey,
          shopier_api_secret: apiSecret,
          shopier_website_index: webIdx,
          shopier_enabled: enabled
        })
      });
      msg.style.color = '#22c55e';
      msg.textContent = '✅ Ayarlar kaydedildi! Ödeme sistemi ' + (enabled==='1'?'aktif edildi.':'pasif yapıldı.');
      const banner = document.getElementById('pay-status-banner');
      if (banner) {
        banner.className = enabled==='1' ? 'pay-status active' : 'pay-status inactive';
        banner.innerHTML = `<i class="fas fa-${enabled==='1'?'check-circle':'exclamation-circle'}"></i> ${enabled==='1'?'Ödeme sistemi aktif — Shopier entegrasyonu çalışıyor.':'Ödeme sistemi pasif — Ödemeler devre dışı.'}`;
      }
      toast('Ödeme ayarları kaydedildi');
    } catch(e) {
      msg.style.color = 'var(--red2)';
      msg.textContent = '❌ Hata: ' + e.message;
    }
  });

  // toast referansı
  window.adminToastFn = toast;
}
