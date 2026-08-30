(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const state = { section: 'members', members: [], badges: [], files: [], selectedFile: null, settings: {} };
  let token = sessionStorage.getItem('vmb_admin_token') || '';

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[char]));
  }
  function date(value, withTime = true) {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('tr-TR', { day:'2-digit', month:'short', year:'numeric', ...(withTime ? { hour:'2-digit', minute:'2-digit' } : {}) });
  }
  function initials(name) { return String(name || '?').slice(0, 2).toLocaleUpperCase('tr-TR'); }
  function avatar(user, small = false) {
    return user?.avatar && !user.avatar_removed ? `<img class="avatar${small ? ' small-avatar' : ''}" src="${esc(user.avatar)}" alt="">` : `<span class="avatar${small ? ' small-avatar' : ''}">${esc(initials(user?.username))}</span>`;
  }
  function badge(name) {
    return String(name || '').toLocaleLowerCase('tr-TR') === 'vmb yönetim'
      ? '<span class="badge-chip badge-manager"><i class="fa fa-crown"></i> VMB Yönetim</span>'
      : '<span class="badge-chip badge-vmb"><i class="fa fa-shield-halved"></i> VMB</span>';
  }
  function toast(message, error = false) {
    const node = document.createElement('div');
    node.className = `toast${error ? ' error' : ''}`;
    node.textContent = message;
    $('#toast-root').appendChild(node);
    setTimeout(() => node.remove(), 3400);
  }
  async function api(path, options = {}) {
    const headers = { ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...(options.headers || {}) };
    if (token) headers['X-VMB-Admin-Token'] = token;
    const response = await fetch('/api/vmb-admin' + path, { ...options, headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) signOut(false);
      throw new Error(data.error || 'İşlem gerçekleştirilemedi');
    }
    return data;
  }
  function signOut(callApi = true) {
    if (callApi && token) fetch('/api/vmb-admin/auth/logout', { method:'DELETE', headers:{ 'X-VMB-Admin-Token': token } }).catch(() => {});
    token = ''; sessionStorage.removeItem('vmb_admin_token');
    $('#panel-shell').classList.add('hidden'); $('#login-screen').classList.remove('hidden');
  }
  function showModal(title, body, onSubmit) {
    const root = $('#modal-root');
    root.innerHTML = `<section class="modal" role="dialog" aria-modal="true"><header class="modal-head"><h3>${esc(title)}</h3><button class="modal-close" type="button"><i class="fa fa-xmark"></i></button></header><div class="modal-body">${body}</div></section>`;
    root.classList.remove('hidden');
    $('.modal-close', root).onclick = closeModal;
    root.onclick = event => { if (event.target === root) closeModal(); };
    if (onSubmit) $('.modal-form', root)?.addEventListener('submit', async event => { event.preventDefault(); await onSubmit(new FormData(event.currentTarget)); });
  }
  function closeModal() { $('#modal-root').classList.add('hidden'); $('#modal-root').innerHTML = ''; }
  function formField(label, id, value = '', type = 'text', full = false) {
    return `<div class="field${full ? ' full' : ''}"><label for="${id}">${esc(label)}</label>${type === 'textarea' ? `<textarea id="${id}" name="${id}">${esc(value)}</textarea>` : `<input id="${id}" name="${id}" type="${type}" value="${esc(value)}">`}</div>`;
  }
  function renderStats(overview) {
    const items = [
      ['VMB Üyesi', overview.members, 'fa-users', 'var(--gold)'],
      ['Yönetim', overview.managers, 'fa-crown', 'var(--gold-2)'],
      ['Arşiv Dosyası', overview.files, 'fa-folder-tree', 'var(--blue)'],
      ['Okuma Aktivitesi', overview.activity, 'fa-chart-line', 'var(--green)']
    ];
    $('#stats-strip').innerHTML = items.map(([label, value, icon, color]) => `<div class="stat" style="--stat-color:${color}"><i class="stat-icon fa ${icon}"></i><div class="stat-label">${label}</div><div class="stat-value">${Number(value || 0).toLocaleString('tr-TR')}</div></div>`).join('');
  }
  async function refreshOverview() { renderStats(await api('/overview')); }

  async function renderMembers() {
    state.members = await api('/members');
    const main = $('#page-content');
    main.innerHTML = `<div class="page-head"><div><div class="page-kicker">ERİŞİM KONTROLÜ</div><h1 class="page-title">VMB <span>Üyeleri</span></h1><p class="page-subtitle">Üyelik durumu, son okunan içerik ve klasör hareketlerini incele.</p></div><div class="head-actions"><button class="soft-btn" id="refresh-members"><i class="fa fa-rotate"></i> Yenile</button></div></div>
      <div class="toolbar"><div class="search-wrap"><i class="fa fa-magnifying-glass"></i><input class="search-input" id="member-search" placeholder="Kullanıcı adı veya e-posta ara"></div><span class="small muted">${state.members.length} aktif VMB üyesi</span></div>
      <div id="members-grid" class="members-grid"></div>`;
    const draw = () => {
      const query = ($('#member-search').value || '').toLocaleLowerCase('tr-TR');
      const items = state.members.filter(member => `${member.username} ${member.email}`.toLocaleLowerCase('tr-TR').includes(query));
      $('#members-grid').innerHTML = items.length ? items.map(member => `<article class="member-card" data-id="${esc(member.id)}">
        <div class="member-top">${avatar(member)}<div><div class="member-name">${esc(member.username)}</div><div class="member-email">${esc(member.email)}</div></div><i class="arrow fa fa-chevron-right"></i></div>
        <div style="margin-top:11px">${badge(member.badge_name)}</div>
        <div class="member-meta"><div><div class="meta-label">Üyelik başlangıcı</div><div class="meta-value">${date(member.vmb_granted_at || member.created_at, false)}</div></div><div><div class="meta-label">Son hareket</div><div class="meta-value">${esc(member.last_activity?.detail || 'Henüz aktivite yok')}</div></div></div>
      </article>`).join('') : `<div class="section-card empty" style="grid-column:1/-1"><i class="fa fa-user-slash"></i><p>Aramanla eşleşen VMB üyesi bulunamadı.</p></div>`;
      $$('.member-card', $('#members-grid')).forEach(card => card.onclick = () => openMember(card.dataset.id));
    };
    $('#member-search').oninput = draw; $('#refresh-members').onclick = () => renderMembers().catch(showError); draw();
  }
  async function openMember(id) {
    const data = await api('/members/' + encodeURIComponent(id));
    const m = data.member;
    const last = m.last_active ? date(m.last_active) : '—';
    const activity = data.activity?.length ? data.activity.map(item => `<div class="reader-row"><i class="fa ${item.activity_type === 'page' ? 'fa-file-lines' : item.activity_type === 'folder' ? 'fa-folder' : 'fa-folder-tree'}" style="color:var(--gold)"></i><div style="flex:1"><strong>${esc(item.detail || 'VMB içeriği')}</strong><small>${esc(item.file_title || 'Arşiv')} ${item.folder_name ? ' / ' + esc(item.folder_name) : ''} · ${date(item.viewed_at)}</small></div><span class="small faint">${esc(item.activity_type)}</span></div>`).join('') : '<div class="empty"><p>Henüz okuma veya klasör aktivitesi yok.</p></div>';
    const reads = data.reads?.length ? data.reads.map(item => `<div class="content-item"><i class="fa fa-book-open"></i><div class="content-item-main"><strong>${esc(item.title)}${item.is_hidden ? '<span class="hidden-label"><i class="fa fa-eye-slash"></i> gizli</span>' : ''}</strong><small>Son erişim ${date(item.last_viewed)} · ${item.visits} hareket</small></div></div>`).join('') : '<div class="muted small">Dosya okuması yok.</div>';
    showModal(`${m.username} · VMB üye profili`, `<div class="member-top" style="margin-bottom:20px">${avatar(m)}<div><div class="member-name">${esc(m.username)}</div><div class="member-email">${esc(m.email)}</div><div style="margin-top:8px">${badge(m.badge_name)}</div></div></div>
      <div class="form-grid"><div><div class="meta-label">VMB’ye katılım</div><div class="meta-value">${date(m.vmb_granted_at || m.created_at)}</div></div><div><div class="meta-label">Platformda son aktif</div><div class="meta-value">${last}</div></div><div><div class="meta-label">Biyografi</div><div class="meta-value">${esc(m.bio || '—')}</div></div><div><div class="meta-label">Toplam aktivite</div><div class="meta-value">${data.activity.length}</div></div></div>
      <div class="content-block" style="padding:17px 0 0;border-bottom:0"><h4><i class="fa fa-book-open" style="color:var(--gold)"></i> Okuduğu dosyalar</h4><div class="content-list">${reads}</div></div>
      <div class="content-block" style="padding:20px 0 0;border-bottom:0"><h4><i class="fa fa-clock-rotate-left" style="color:var(--gold)"></i> Son 100 hareket</h4><div>${activity}</div></div>
      <div class="modal-actions"><button class="danger-btn" id="cancel-membership"><i class="fa fa-user-minus"></i> Üyeliği iptal et</button><button class="soft-btn" type="button" onclick="document.querySelector('#modal-root .modal-close').click()">Kapat</button></div>`);
    $('#cancel-membership').onclick = async () => {
      if (!confirm(`${m.username} kullanıcısının VMB üyeliği iptal edilsin mi?`)) return;
      try { await api(`/users/${m.id}/membership`, { method:'PUT', body:JSON.stringify({ active:false }) }); closeModal(); toast('VMB üyeliği iptal edildi'); renderMembers(); refreshOverview(); } catch (error) { showError(error); }
    };
  }

  async function renderBadges() {
    state.badges = await api('/badges');
    $('#page-content').innerHTML = `<div class="page-head"><div><div class="page-kicker">YETKİ MODELİ</div><h1 class="page-title">VMB <span>Rozetleri</span></h1><p class="page-subtitle">VMB alanına erişim ve arşiv yönetimi yetkisini ayrı ayrı dağıt.</p></div></div>
      <div class="badge-grid">${state.badges.map((item, index) => `<article class="badge-card${index ? ' manager' : ''}"><div class="badge-symbol"><i class="${esc(item.icon)}"></i></div><h3>${esc(item.name)}</h3><p>${esc(item.description)}</p><div class="badge-count"><strong>${item.member_count}</strong> aktif atama</div></article>`).join('')}</div>
      <section class="section-card assignment-card"><h3>Rozet ata veya geri al</h3><p class="small muted">Kullanıcıyı ara; VMB veya VMB Yönetim rozetini tek tıkla uygula.</p><div class="assignment-row"><div class="field"><label>Kullanıcı ara</label><input id="badge-user-search" placeholder="Kullanıcı adı veya e-posta"></div><div class="field"><label>Rozet</label><select id="badge-choice"><option>VMB</option><option>VMB Yönetim</option></select></div><button class="primary-btn" id="search-users"><i class="fa fa-search"></i> Ara</button></div><div id="user-results"></div></section>`;
    $('#search-users').onclick = searchUsers; $('#badge-user-search').onkeydown = event => { if (event.key === 'Enter') searchUsers(); };
  }
  async function searchUsers() {
    const query = $('#badge-user-search').value.trim();
    if (!query) return toast('Önce kullanıcı adı veya e-posta yazın', true);
    const users = await api('/users?search=' + encodeURIComponent(query));
    $('#user-results').innerHTML = users.length ? users.map(user => `<div class="user-result"><div class="member-top">${avatar(user, true)}<div><strong>${esc(user.username)}</strong><div class="small faint">${esc(user.email)}</div></div></div><div style="display:flex;gap:5px;align-items:center">${user.is_vmb ? badge(user.badge_name) : '<span class="small faint">VMB değil</span>'}<button class="primary-btn" data-assign="${user.id}" style="padding:8px 10px;font-size:11px">Uygula</button></div></div>`).join('') : '<div class="empty"><p>Kullanıcı bulunamadı.</p></div>';
    $$('[data-assign]', $('#user-results')).forEach(button => button.onclick = async () => {
      try { await api(`/users/${button.dataset.assign}/badge`, { method:'PUT', body:JSON.stringify({ badge: $('#badge-choice').value }) }); toast('Rozet atandı'); renderBadges(); refreshOverview(); } catch (error) { showError(error); }
    });
  }

  async function renderFiles() {
    state.files = await api('/files');
    $('#page-content').innerHTML = `<div class="page-head"><div><div class="page-kicker">GİZLİ ARŞİV</div><h1 class="page-title">VMB <span>Dosyaları</span></h1><p class="page-subtitle">Dosya, klasör, belge ve arşiv eklerini düzenle. Gizli öğeler yalnızca bu merkezde yönetilir.</p></div><div class="head-actions"><button class="soft-btn" id="edit-vmb-page"><i class="fa fa-sliders"></i> VMB sayfası</button><button class="primary-btn" id="new-file"><i class="fa fa-plus"></i> Yeni dosya</button></div></div>
      <div class="file-layout"><section class="section-card"><div class="section-card-header"><strong>Arşiv dosyaları</strong><span class="small muted">${state.files.length} dosya</span></div><div id="file-list" class="file-list"></div></section><section id="file-detail" class="section-card file-detail"><div class="empty"><i class="fa fa-folder-open"></i><p>Detayları görmek için bir dosya seçin.</p></div></section></div>`;
    $('#file-list').innerHTML = state.files.length ? state.files.map(file => `<button class="file-row" data-id="${file.id}"><i class="fa fa-folder-tree"></i><span style="min-width:0;flex:1"><strong>${esc(file.title)}${file.is_hidden ? '<span class="hidden-label"><i class="fa fa-eye-slash"></i> gizli</span>' : ''}</strong><small>${file.folder_count} klasör · ${file.page_count} belge · ${file.reader_count} okuyucu</small></span><i class="file-arrow fa fa-chevron-right"></i></button>`).join('') : '<div class="empty"><i class="fa fa-folder-plus"></i><p>Henüz dosya eklenmedi.</p></div>';
    $$('.file-row').forEach(row => row.onclick = () => openFile(row.dataset.id));
    $('#new-file').onclick = () => openFileForm();
    $('#edit-vmb-page').onclick = openVmbPageForm;
  }
  async function openVmbPageForm() {
    const settings = await api('/settings');
    showModal('VMB sayfasını düzenle', `<form class="modal-form"><div class="form-grid">${formField('Tanıtım metni','vmb_intro',settings.vmb_intro || '','textarea',true)}${formField('Kurucu adı','vmb_founder',settings.vmb_founder || '')}${formField('Grup bağlantısı','vmb_group_url',settings.vmb_group_url || '')}${formField('Kapak görseli URL','vmb_image_url',settings.vmb_image_url || '')}</div><p class="small muted" style="margin:14px 0 0">Bu alanlar kullanıcıların /vmb sayfasında gördüğü hero alanını günceller.</p><div class="modal-actions"><button class="soft-btn" type="button" onclick="document.querySelector('#modal-root .modal-close').click()">Vazgeç</button><button class="primary-btn" type="submit">Sayfayı kaydet</button></div></form>`, async data => {
      try { await api('/settings', { method:'PUT', body:JSON.stringify({ vmb_intro:data.get('vmb_intro'), vmb_founder:data.get('vmb_founder'), vmb_group_url:data.get('vmb_group_url'), vmb_image_url:data.get('vmb_image_url') }) }); closeModal(); toast('VMB sayfası güncellendi'); } catch (error) { showError(error); }
    });
  }
  async function openFile(id) {
    const data = await api('/files/' + encodeURIComponent(id));
    state.selectedFile = data;
    $$('.file-row').forEach(row => row.classList.toggle('selected', String(row.dataset.id) === String(id)));
    const f = data.file;
    const folders = data.folders || [], pages = data.pages || [], assets = data.assets || [];
    const folderItems = folders.length ? folders.map(item => `<div class="content-item"><i class="fa fa-folder${item.is_hidden ? '-closed' : ''}"></i><div class="content-item-main"><strong>${esc(item.name)}${item.is_hidden ? '<span class="hidden-label"><i class="fa fa-eye-slash"></i> gizli</span>' : ''}</strong><small>${item.parent_id ? 'Alt klasör' : 'Kök klasör'} · ${esc(item.created_by_username || 'Panel')} · ${date(item.created_at)}</small></div><div class="item-actions"><button class="tiny-btn" data-edit-folder="${item.id}"><i class="fa fa-pen"></i></button><button class="tiny-btn red" data-delete-folder="${item.id}"><i class="fa fa-trash"></i></button></div></div>`).join('') : '<div class="muted small">Klasör yok.</div>';
    const pageItems = pages.length ? pages.map(item => `<div class="content-item"><i class="fa fa-file-lines"></i><div class="content-item-main"><strong>${esc(item.title)}${item.is_hidden ? '<span class="hidden-label"><i class="fa fa-eye-slash"></i> gizli</span>' : ''}</strong><small>${esc(item.folder_name)} · ${esc(item.created_by_username || 'Panel')} · ${date(item.created_at)}</small></div><div class="item-actions"><button class="tiny-btn" data-edit-page="${item.id}"><i class="fa fa-pen"></i></button><button class="tiny-btn red" data-delete-page="${item.id}"><i class="fa fa-trash"></i></button></div></div>`).join('') : '<div class="muted small">Belge yok.</div>';
    const assetItems = assets.length ? assets.map(item => `<div class="content-item"><i class="fa fa-paperclip"></i><div class="content-item-main"><strong>${esc(item.name)}${item.is_hidden ? '<span class="hidden-label"><i class="fa fa-eye-slash"></i> gizli</span>' : ''}</strong><small>${esc(item.folder_name)} · ${Math.round((item.size_bytes || 0) / 1024)} KB · ${date(item.created_at)}</small></div><div class="item-actions"><a class="tiny-btn" href="${esc(item.url)}" target="_blank" rel="noopener"><i class="fa fa-arrow-up-right-from-square"></i></a><button class="tiny-btn red" data-delete-asset="${item.id}"><i class="fa fa-trash"></i></button></div></div>`).join('') : '<div class="muted small">Ek dosya yok.</div>';
    const readerItems = data.readers?.length ? data.readers.map(reader => `<div class="reader-row">${avatar(reader, true)}<div><strong>${esc(reader.username)}</strong><small>${esc(reader.opened_types || 'okuma')} · ${date(reader.last_viewed)}</small></div><span class="visits">${reader.visits} hareket</span></div>`).join('') : '<div class="muted small">Bu dosya henüz okunmamış.</div>';
    $('#file-detail').innerHTML = `<div class="file-hero"><div class="file-hero-top"><div><div class="page-kicker">DOSYA DETAYI</div><h2>${esc(f.title)}${f.is_hidden ? '<span class="hidden-label"><i class="fa fa-eye-slash"></i> gizli</span>' : ''}</h2><p>${esc(f.description || 'Açıklama eklenmemiş.')}<br><span class="small faint">Oluşturan: ${esc(f.created_by_username || 'Panel')} · ${date(f.created_at)}</span></p></div><div class="inline-actions"><button class="soft-btn" id="edit-file"><i class="fa fa-pen"></i></button><button class="danger-btn" id="delete-file"><i class="fa fa-trash"></i></button></div></div><div class="file-pills"><span class="pill">${folders.length} klasör</span><span class="pill">${pages.length} belge</span><span class="pill">${assets.length} ek</span><span class="pill">${data.readers.length} okuyucu</span></div></div>
      <div class="content-block"><div class="inline-actions"><button class="soft-btn" id="new-folder"><i class="fa fa-folder-plus"></i> Klasör</button>${folders.length ? `<button class="soft-btn" id="new-page"><i class="fa fa-file-circle-plus"></i> Belge</button><button class="soft-btn" id="upload-asset"><i class="fa fa-paperclip"></i> Ek dosya</button>` : ''}</div></div>
      <div class="content-block"><h4><i class="fa fa-folder-tree" style="color:var(--blue)"></i> Klasörler</h4><div class="content-list">${folderItems}</div></div>
      <div class="content-block"><h4><i class="fa fa-file-lines" style="color:var(--blue)"></i> Belgeler</h4><div class="content-list">${pageItems}</div></div>
      <div class="content-block"><h4><i class="fa fa-paperclip" style="color:var(--blue)"></i> Ek dosyalar</h4><div class="content-list">${assetItems}</div></div>
      <div class="content-block"><h4><i class="fa fa-eye" style="color:var(--green)"></i> Kimler okudu?</h4>${readerItems}</div>`;
    $('#edit-file').onclick = () => openFileForm(f);
    $('#delete-file').onclick = () => deleteResource(`/files/${f.id}`, 'Dosya ve tüm içeriği silinsin mi?', renderFiles);
    $('#new-folder').onclick = () => openFolderForm(f.id, folders);
    $('#new-page')?.addEventListener('click', () => openPageForm(folders));
    $('#upload-asset')?.addEventListener('click', () => openAssetForm(folders));
    $$('[data-edit-folder]').forEach(button => button.onclick = () => openFolderForm(f.id, folders, folders.find(item => String(item.id) === String(button.dataset.editFolder))));
    $$('[data-delete-folder]').forEach(button => button.onclick = () => deleteResource(`/folders/${button.dataset.deleteFolder}`, 'Klasör ve içeriği silinsin mi?', () => openFile(f.id)));
    $$('[data-edit-page]').forEach(button => button.onclick = () => openPageForm(folders, pages.find(item => String(item.id) === String(button.dataset.editPage))));
    $$('[data-delete-page]').forEach(button => button.onclick = () => deleteResource(`/pages/${button.dataset.deletePage}`, 'Belge silinsin mi?', () => openFile(f.id)));
    $$('[data-delete-asset]').forEach(button => button.onclick = () => deleteResource(`/assets/${button.dataset.deleteAsset}`, 'Ek dosya kaldırılsın mı?', () => openFile(f.id)));
  }
  function openFileForm(file = null) {
    showModal(file ? 'Dosyayı düzenle' : 'Yeni VMB dosyası', `<form class="modal-form"><div class="form-grid">${formField('Dosya adı','title',file?.title || '')}${formField('Açıklama','description',file?.description || '','textarea',true)}<label class="check-field full"><input name="is_hidden" type="checkbox" ${file?.is_hidden ? 'checked' : ''}> Bu dosyayı gizle</label></div><div class="modal-actions"><button class="soft-btn" type="button" onclick="document.querySelector('#modal-root .modal-close').click()">Vazgeç</button><button class="primary-btn" type="submit">Kaydet</button></div></form>`, async data => {
      try { await api(file ? `/files/${file.id}` : '/files', { method:file ? 'PUT' : 'POST', body:JSON.stringify({ title:data.get('title'), description:data.get('description'), is_hidden:data.has('is_hidden') }) }); closeModal(); toast(file ? 'Dosya güncellendi' : 'Dosya oluşturuldu'); renderFiles(); refreshOverview(); } catch (error) { showError(error); }
    });
  }
  function openFolderForm(fileId, folders, folder = null) {
    const parents = folders.filter(item => String(item.id) !== String(folder?.id));
    showModal(folder ? 'Klasörü düzenle' : 'Yeni klasör', `<form class="modal-form"><div class="form-grid">${formField('Klasör adı','name',folder?.name || '')}${formField('Açıklama','description',folder?.description || '','textarea',true)}${!folder ? `<div class="field full"><label>Üst klasör</label><select name="parent_id"><option value="">Kök klasör</option>${parents.map(item => `<option value="${item.id}">${esc(item.name)}</option>`).join('')}</select></div>` : ''}<label class="check-field full"><input name="is_hidden" type="checkbox" ${folder?.is_hidden ? 'checked' : ''}> Bu klasörü gizle</label></div><div class="modal-actions"><button class="soft-btn" type="button" onclick="document.querySelector('#modal-root .modal-close').click()">Vazgeç</button><button class="primary-btn" type="submit">Kaydet</button></div></form>`, async data => {
      try { await api(folder ? `/folders/${folder.id}` : '/folders', { method:folder ? 'PUT' : 'POST', body:JSON.stringify({ file_id:fileId, parent_id:data.get('parent_id') || null, name:data.get('name'), description:data.get('description'), is_hidden:data.has('is_hidden') }) }); closeModal(); toast(folder ? 'Klasör güncellendi' : 'Klasör oluşturuldu'); openFile(fileId); } catch (error) { showError(error); }
    });
  }
  function openPageForm(folders, page = null) {
    const folderOptions = folders.map(item => `<option value="${item.id}" ${String(item.id) === String(page?.folder_id) ? 'selected' : ''}>${esc(item.name)}</option>`).join('');
    showModal(page ? 'Belgeyi düzenle' : 'Yeni VMB belgesi', `<form class="modal-form"><div class="form-grid">${!page ? `<div class="field full"><label>Klasör</label><select name="folder_id" required>${folderOptions}</select></div>` : ''}${formField('Belge başlığı','title',page?.title || '')}${formField('Görsel URL (opsiyonel)','image_url',page?.image_url || '')}${formField('İçerik','content',page?.content || '','textarea',true)}<label class="check-field full"><input name="is_hidden" type="checkbox" ${page?.is_hidden ? 'checked' : ''}> Bu belgeyi gizle</label></div><div class="modal-actions"><button class="soft-btn" type="button" onclick="document.querySelector('#modal-root .modal-close').click()">Vazgeç</button><button class="primary-btn" type="submit">Kaydet</button></div></form>`, async data => {
      try { const endpoint = page ? `/pages/${page.id}` : `/folders/${data.get('folder_id')}/pages`; await api(endpoint, { method:page ? 'PUT' : 'POST', body:JSON.stringify({ title:data.get('title'), content:data.get('content'), image_url:data.get('image_url'), is_hidden:data.has('is_hidden') }) }); closeModal(); toast(page ? 'Belge güncellendi' : 'Belge oluşturuldu'); openFile(state.selectedFile.file.id); } catch (error) { showError(error); }
    });
  }
  function openAssetForm(folders) {
    showModal('Arşive dosya ekle', `<form class="modal-form"><div class="form-grid"><div class="field full"><label>Klasör</label><select name="folder_id" required>${folders.map(item => `<option value="${item.id}">${esc(item.name)}</option>`).join('')}</select></div>${formField('Görünen ad','name','')}<div class="field"><label>Dosya</label><input name="file" type="file" required></div><label class="check-field full"><input name="is_hidden" type="checkbox"> Bu eki gizle</label></div><div class="modal-actions"><button class="soft-btn" type="button" onclick="document.querySelector('#modal-root .modal-close').click()">Vazgeç</button><button class="primary-btn" type="submit">Yükle</button></div></form>`, async data => {
      try { await api(`/folders/${data.get('folder_id')}/assets`, { method:'POST', body:data }); closeModal(); toast('Dosya yüklendi'); openFile(state.selectedFile.file.id); } catch (error) { showError(error); }
    });
  }
  async function deleteResource(path, message, done) {
    if (!confirm(message)) return;
    try { await api(path, { method:'DELETE' }); toast('Silindi'); await done(); refreshOverview(); } catch (error) { showError(error); }
  }
  function showError(error) { toast(error?.message || 'Bir hata oluştu', true); }
  async function boot() {
    try {
      const me = await api('/me');
      $('#topbar-user').textContent = me.username;
      $('#login-screen').classList.add('hidden'); $('#panel-shell').classList.remove('hidden');
      await refreshOverview(); await renderMembers();
    } catch { signOut(false); }
  }
  $('#login-form').addEventListener('submit', async event => {
    event.preventDefault(); const error = $('#login-error'); error.textContent = '';
    try {
      const result = await fetch('/api/vmb-admin/auth/login', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ username:$('#login-username').value.trim(), password:$('#login-password').value }) });
      const data = await result.json(); if (!result.ok) throw new Error(data.error || 'Giriş başarısız');
      token = data.token; sessionStorage.setItem('vmb_admin_token', token); await boot();
    } catch (err) { error.textContent = err.message; }
  });
  $('#logout-btn').onclick = () => signOut(true);
  $$('#main-nav .nav-btn').forEach(button => button.onclick = async () => {
    $$('#main-nav .nav-btn').forEach(item => item.classList.toggle('active', item === button));
    try { if (button.dataset.section === 'members') await renderMembers(); if (button.dataset.section === 'badges') await renderBadges(); if (button.dataset.section === 'files') await renderFiles(); await refreshOverview(); } catch (error) { showError(error); }
  });
  if (token) boot();
})();