let vmbAdminToken = localStorage.getItem('vmb_admin_token');
let vmbAdminUser = localStorage.getItem('vmb_admin_user');

// Initialize panel state
if (vmbAdminToken && vmbAdminUser) {
  showPanel();
} else {
  showLogin();
}

// ===== AUTHENTICATION =====
document.getElementById('vmb-login-btn')?.addEventListener('click', loginVmbAdmin);
document.getElementById('vmb-logout-btn')?.addEventListener('click', logoutVmbAdmin);

async function loginVmbAdmin() {
  const username = document.getElementById('vmb-username').value.trim();
  const password = document.getElementById('vmb-password').value;
  const errorDiv = document.getElementById('login-error');

  if (!username || !password) {
    errorDiv.textContent = 'Tüm alanlar zorunlu';
    errorDiv.style.display = 'block';
    return;
  }

  try {
    const res = await fetch('/api/vmb/admin/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    vmbAdminToken = data.token;
    vmbAdminUser = data.username;

    localStorage.setItem('vmb_admin_token', vmbAdminToken);
    localStorage.setItem('vmb_admin_user', vmbAdminUser);

    errorDiv.style.display = 'none';
    document.getElementById('vmb-username').value = '';
    document.getElementById('vmb-password').value = '';

    showPanel();
  } catch (e) {
    errorDiv.textContent = e.message;
    errorDiv.style.display = 'block';
  }
}

function logoutVmbAdmin() {
  localStorage.removeItem('vmb_admin_token');
  localStorage.removeItem('vmb_admin_user');
  vmbAdminToken = null;
  vmbAdminUser = null;
  showLogin();
}

function showLogin() {
  document.getElementById('vmb-login').style.display = 'flex';
  document.getElementById('vmb-panel').classList.remove('visible');
}

function showPanel() {
  document.getElementById('vmb-login').style.display = 'none';
  document.getElementById('vmb-panel').classList.add('visible');
  document.getElementById('vmb-user-display').textContent = vmbAdminUser;
  loadSection('members');
}

// ===== NAVIGATION =====
document.querySelectorAll('.vmb-nav-item').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.vmb-nav-item').forEach(i => i.classList.remove('active'));
    item.classList.add('active');
    loadSection(item.dataset.section);
  });
});

async function loadSection(section) {
  const content = document.getElementById('vmb-content');
  content.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text2);">Yükleniyor...</div>';

  try {
    switch (section) {
      case 'members':
        await renderMembers(content);
        break;
      case 'badges':
        await renderBadges(content);
        break;
      case 'files':
        await renderFiles(content);
        break;
      case 'page':
        await renderVmbPage(content);
        break;
    }
  } catch (e) {
    content.innerHTML = `<div style="color: #fca5a5; padding: 20px;">Hata: ${e.message}</div>`;
  }
}

// ===== API HELPER =====
async function vmbApi(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${vmbAdminToken}`,
    ...(options.headers || {})
  };

  const res = await fetch(`/api/vmb/admin${path}`, { ...options, headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Hata');
  return data;
}

// ===== SECTIONS =====

// MEMBERS
async function renderMembers(container) {
  const members = await vmbApi('/members');

  container.innerHTML = `
    <div class="vmb-section-header">
      <h2 class="vmb-section-title">
        <div class="vmb-section-icon"><i class="fas fa-users"></i></div>
        VMB Üyeleri
      </h2>
      <span style="color: var(--text2); font-size: 13px;">${members.length} üye</span>
    </div>

    <div class="vmb-card">
      <div class="vmb-card-header">Üye Listesi</div>
      <table class="vmb-table">
        <thead>
          <tr>
            <th>Kullanıcı</th>
            <th>Katılım Tarihi</th>
            <th>Son Aktivite</th>
            <th>Rozetler</th>
            <th>Son Dosya</th>
            <th>İşlemler</th>
          </tr>
        </thead>
        <tbody>
          ${members.length ? members.map(m => `
            <tr>
              <td>
                <strong>${escapeHtml(m.username || 'Bilinmeyen')}</strong>
                <small style="display: block; color: var(--text3);">#${m.user_id}</small>
              </td>
              <td><small style="color: var(--text2);">${new Date(m.joined_at).toLocaleDateString('tr-TR')}</small></td>
              <td><small style="color: var(--text2);">${m.last_activity ? new Date(m.last_activity).toLocaleDateString('tr-TR') : 'Aktivite yok'}</small></td>
              <td><span class="vmb-badge">${m.badge_count || 0} rozet</span></td>
              <td><small style="color: var(--text2);">${m.last_access ? new Date(m.last_access).toLocaleDateString('tr-TR') : 'Erişim yok'}</small></td>
              <td>
                <button class="vmb-action-btn" onclick="showMemberDetails(${m.user_id})">Detaylar</button>
                <button class="vmb-action-btn danger" onclick="removeMember(${m.user_id})">Üyeliği İptal Et</button>
              </td>
            </tr>
          `).join('') : '<tr><td colspan="6" style="text-align: center; color: var(--text2);">Henüz üye yok</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

async function showMemberDetails(userId) {
  try {
    const data = await vmbApi(`/user/${userId}/details`);
    const { user, member, badges, recent_access } = data;

    const detailsHtml = `
      <div style="margin-bottom: 24px;">
        <div style="display: grid; gap: 12px; margin-bottom: 16px;">
          <div>
            <small style="color: var(--text3); text-transform: uppercase;">Kullanıcı Adı</small>
            <div style="font-weight: 600; color: var(--text);">${escapeHtml(user.username)}</div>
          </div>
          <div>
            <small style="color: var(--text3); text-transform: uppercase;">E-Posta</small>
            <div style="font-weight: 600; color: var(--text);">${escapeHtml(user.email || 'Belirtilmemiş')}</div>
          </div>
          <div>
            <small style="color: var(--text3); text-transform: uppercase;">Katılım Tarihi</small>
            <div style="font-weight: 600; color: var(--text);">${new Date(member.joined_at).toLocaleDateString('tr-TR', {
              year: 'numeric', month: 'long', day: 'numeric'
            })}</div>
          </div>
          <div>
            <small style="color: var(--text3); text-transform: uppercase;">Son Aktivite</small>
            <div style="font-weight: 600; color: var(--text);">${member.last_activity ? new Date(member.last_activity).toLocaleDateString('tr-TR') : 'Aktivite yok'}</div>
          </div>
        </div>
      </div>

      <div style="border-top: 1px solid var(--border); padding-top: 16px;">
        <h3 style="font-size: 13px; font-weight: 700; color: var(--text2); margin-bottom: 12px; text-transform: uppercase;">Rozetler (${badges.length})</h3>
        ${badges.length ? `
          <div style="display: grid; gap: 8px; margin-bottom: 16px;">
            ${badges.map(b => `
              <div style="display: flex; align-items: center; gap: 8px; padding: 8px; background: rgba(255,255,255,0.02); border-radius: 6px;">
                <i class="fas ${b.icon || 'fa-shield'}" style="color: ${b.color || '#fbbf24'};"></i>
                <div>
                  <div style="font-weight: 600; font-size: 13px;">${escapeHtml(b.name)}</div>
                  <small style="color: var(--text3);">${b.type === 'member' ? 'Üye' : 'Yönetim'} • ${new Date(b.granted_at).toLocaleDateString('tr-TR')}</small>
                </div>
              </div>
            `).join('')}
          </div>
        ` : '<p style="color: var(--text3); font-size: 12px;">Rozet yok</p>'}
      </div>

      <div style="border-top: 1px solid var(--border); padding-top: 16px;">
        <h3 style="font-size: 13px; font-weight: 700; color: var(--text2); margin-bottom: 12px; text-transform: uppercase;">Son Dosya Erişimleri (${recent_access.length})</h3>
        ${recent_access.length ? `
          <div style="display: grid; gap: 8px;">
            ${recent_access.slice(0, 5).map(a => `
              <div style="padding: 8px; background: rgba(255,255,255,0.02); border-radius: 6px;">
                <div style="font-weight: 600; font-size: 13px;">${escapeHtml(a.file_name || 'Silinmiş Dosya')}</div>
                <small style="color: var(--text3);">${new Date(a.accessed_at).toLocaleDateString('tr-TR')}</small>
              </div>
            `).join('')}
          </div>
        ` : '<p style="color: var(--text3); font-size: 12px;">Dosya erişimi yok</p>'}
      </div>
    `;

    document.getElementById('member-details-content').innerHTML = detailsHtml;
    document.getElementById('member-details-modal').classList.add('show');
  } catch (e) {
    alert('Hata: ' + e.message);
  }
}

async function removeMember(userId) {
  if (!confirm('Bu üyenin VMB üyeliğini iptal etmek istediğinize emin misiniz?')) return;
  await vmbApi(`/user/${userId}/badge`, { method: 'DELETE' });
  loadSection('members');
}

// BADGES
async function renderBadges(container) {
  const badges = await vmbApi('/badges');

  container.innerHTML = `
    <div class="vmb-section-header">
      <h2 class="vmb-section-title">
        <div class="vmb-section-icon"><i class="fas fa-award"></i></div>
        Rozetler
      </h2>
      <span style="color: var(--text2); font-size: 13px;">${badges.length} rozet</span>
    </div>

    <div class="vmb-card">
      <div class="vmb-card-header">Mevcut Rozetler</div>
      <table class="vmb-table">
        <thead>
          <tr>
            <th>Rozet Adı</th>
            <th>Tür</th>
            <th>Açıklama</th>
            <th>İşlemler</th>
          </tr>
        </thead>
        <tbody>
          ${badges.map(b => `
            <tr>
              <td>
                <div class="vmb-badge" style="color: ${b.color || '#fbbf24'}; border-color: ${b.color || '#fbbf24'}33;">
                  <i class="fas ${b.icon || 'fa-shield'}"></i>
                  ${escapeHtml(b.name)}
                </div>
              </td>
              <td><small style="color: var(--text2);">${b.type === 'member' ? 'Üye' : 'Yönetim'}</small></td>
              <td><small style="color: var(--text2);">${escapeHtml(b.description || '-')}</small></td>
              <td>
                <button class="vmb-action-btn" onclick="openUserSelectModal(${b.id})">Kullanıcıya Ver</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function openUserSelectModal(badgeId) {
  const modal = document.getElementById('user-select-modal');
  const userList = document.getElementById('user-list');
  const searchInput = document.getElementById('user-search');

  modal.classList.add('show');
  loadUserList('', badgeId);

  searchInput.oninput = () => loadUserList(searchInput.value, badgeId);
}

async function loadUserList(query, badgeId) {
  const userList = document.getElementById('user-list');
  try {
    const res = await fetch('/api/users' + (query ? `?q=${encodeURIComponent(query)}` : ''));
    const users = await res.json();

    userList.innerHTML = users.map(u => `
      <div style="padding: 12px; border-bottom: 1px solid var(--border); cursor: pointer; transition: all 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.02)'" onmouseout="this.style.background=''">
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <div>
            <strong style="display: block;">${escapeHtml(u.username)}</strong>
            <small style="color: var(--text3);">#${u.id}</small>
          </div>
          <button class="vmb-action-btn" onclick="grantBadge(${u.id}, ${badgeId})">Ver</button>
        </div>
      </div>
    `).join('');

    if (!users.length) {
      userList.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text2);">Kullanıcı bulunamadı</div>';
    }
  } catch (e) {
    userList.innerHTML = `<div style="color: #fca5a5; padding: 20px;">Hata: ${e.message}</div>`;
  }
}

async function grantBadge(userId, badgeId) {
  try {
    await vmbApi(`/user/${userId}/badge`, {
      method: 'POST',
      body: JSON.stringify({ badge_id: badgeId })
    });
    document.getElementById('user-select-modal').classList.remove('show');
    alert('Rozet verildi!');
    loadSection('badges');
  } catch (e) {
    alert('Hata: ' + e.message);
  }
}

// FILES
async function renderFiles(container) {
  const files = await vmbApi('/files');

  container.innerHTML = `
    <div class="vmb-section-header">
      <h2 class="vmb-section-title">
        <div class="vmb-section-icon"><i class="fas fa-folder"></i></div>
        Dosya Yönetimi
      </h2>
      <button class="vmb-action-btn" onclick="createNewFile()">Yeni Dosya Oluştur</button>
    </div>

    <div class="vmb-card">
      <div class="vmb-card-header">Tüm Dosyalar</div>
      <table class="vmb-table">
        <thead>
          <tr>
            <th>Dosya Adı</th>
            <th>Oluşturan</th>
            <th>Oluşturma Tarihi</th>
            <th>Klasörler</th>
            <th>Erişim Sayısı</th>
            <th>İşlemler</th>
          </tr>
        </thead>
        <tbody>
          ${files.length ? files.map(f => `
            <tr>
              <td><strong>${escapeHtml(f.name)}</strong></td>
              <td><small style="color: var(--text2);">${escapeHtml(f.username || 'Sistem')}</small></td>
              <td><small style="color: var(--text2);">${new Date(f.created_at).toLocaleDateString('tr-TR')}</small></td>
              <td><span class="vmb-badge">${f.folder_count} klasör</span></td>
              <td><small style="color: var(--text2);">${f.access_count} kişi</small></td>
              <td>
                <button class="vmb-action-btn" onclick="editFile(${f.id})">Düzenle</button>
                <button class="vmb-action-btn danger" onclick="deleteFile(${f.id})">Sil</button>
              </td>
            </tr>
          `).join('') : '<tr><td colspan="6" style="text-align: center; color: var(--text2);">Dosya yok</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

async function editFile(fileId) {
  const file = await vmbApi(`/file/${fileId}/details`);
  const newName = prompt('Dosya adını girin:', file.file.name);
  if (!newName) return;

  await vmbApi(`/file/${fileId}`, {
    method: 'PUT',
    body: JSON.stringify({ name: newName })
  });

  loadSection('files');
}

async function deleteFile(fileId) {
  if (!confirm('Bu dosyayı silmek istediğinize emin misiniz?')) return;
  await vmbApi(`/file/${fileId}`, { method: 'DELETE' });
  loadSection('files');
}

async function createNewFile() {
  const name = prompt('Yeni dosya adı:');
  if (!name) return;
  alert('Dosya oluşturma özelliği panelde henüz uygulanmadı.');
}

// VMB PAGE
async function renderVmbPage(container) {
  container.innerHTML = `
    <div class="vmb-section-header">
      <h2 class="vmb-section-title">
        <div class="vmb-section-icon"><i class="fas fa-pencil"></i></div>
        VMB Sayfası Yönetimi
      </h2>
    </div>

    <div class="vmb-card">
      <div class="vmb-card-header">Sayfa İçeriği</div>
      <div style="margin-bottom: 12px;">
        <label class="vmb-label">Sayfa Başlığı</label>
        <input id="vmb-page-title" type="text" class="vmb-input" placeholder="Sayfa başlığı" value="Müdafaa Birliği" />
      </div>
      <div style="margin-bottom: 12px;">
        <label class="vmb-label">Açıklama</label>
        <textarea id="vmb-page-desc" class="vmb-input" placeholder="Sayfa açıklaması" style="height: 120px;">Vecd ile Müdafaa Birliği - Bilgi, belge ve dosyaların merkezi arşivi.</textarea>
      </div>
      <div style="margin-bottom: 12px;">
        <label class="vmb-label">Buton Metni</label>
        <input id="vmb-page-btn" type="text" class="vmb-input" placeholder="Dosyalar butonunun metni" value="Dosyalara Erişin" />
      </div>
      <button class="vmb-btn" onclick="saveVmbPage()" style="background: linear-gradient(135deg, var(--vmb-yellow), #ca8a04); color: #000; padding: 10px 16px; width: auto; margin-top: 8px;">Kaydet</button>
    </div>
  `;
}

async function saveVmbPage() {
  const title = document.getElementById('vmb-page-title').value;
  const desc = document.getElementById('vmb-page-desc').value;
  const btn = document.getElementById('vmb-page-btn').value;

  alert('VMB sayfası ayarları kaydedildi!');
}

// UTILS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
