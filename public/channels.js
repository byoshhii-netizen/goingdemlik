// ===== KANAL SİSTEMİ JAVASCRIPT =====

let currentGroupSlug = null;
let currentChannelId = null;
let groupChannels = [];
let channelMessagePoll = null;

async function loadGroupChannels(groupSlug) {
  try {
    currentGroupSlug = groupSlug;
    const response = await fetch(`/api/group/${groupSlug}/channels`);
    const channels = await response.json();
    groupChannels = channels;

    // Kanal listesini render et
    const channelList = document.getElementById('group-channels-list');
    channelList.innerHTML = '';

    channels.forEach(channel => {
      const item = document.createElement('div');
      item.className = 'channel-item';
      if (currentChannelId === channel.id) item.classList.add('active');
      
      item.innerHTML = `
        <div class="channel-item-icon"><i class="${channel.icon || 'fas fa-hashtag'}"></i></div>
        <div class="channel-item-name">${channel.name}</div>
        ${channel.message_count > 0 ? `<div class="channel-item-badge">${channel.message_count}</div>` : ''}
      `;

      item.addEventListener('click', () => {
        selectChannel(groupSlug, channel.id, channel.name, channel.icon);
      });

      channelList.appendChild(item);
    });

    // Varsayılan kanalı seç (varsa)
    const defaultChannel = channels.find(c => c.is_default);
    if (defaultChannel && !currentChannelId) {
      selectChannel(groupSlug, defaultChannel.id, defaultChannel.name, defaultChannel.icon);
    }

    // Kanal oluştur butonunu göster
    const createBtn = document.getElementById('channel-create-btn');
    if (createBtn) {
      createBtn.onclick = () => showChannelCreatorModal(groupSlug);
    }
  } catch (e) {
    console.error('Kanal yükleme hatası:', e);
  }
}

async function selectChannel(groupSlug, channelId, channelName, channelIcon) {
  currentChannelId = channelId;
  
  // UI güncelle
  document.querySelectorAll('.channel-item').forEach(item => item.classList.remove('active'));
  event.target.closest('.channel-item')?.classList.add('active');

  // Kanal mesajlarını yükle
  await loadChannelMessages(groupSlug, channelId);
}

async function loadChannelMessages(groupSlug, channelId) {
  try {
    const response = await fetch(`/api/group/${groupSlug}/channel/${channelId}/messages?limit=100`);
    const messages = await response.json();

    // Mesaj alanını oluştur veya güncelle
    let messageArea = document.getElementById('group-channel-messages-area');
    if (!messageArea) {
      messageArea = document.createElement('div');
      messageArea.id = 'group-channel-messages-area';
      messageArea.className = 'group-channel-messages';
      // Grup mesaj alanına ekle (varsa) veya yeni konteyner oluştur
      const container = document.querySelector('.group-main-chat') || document.querySelector('[class*="group"]');
      if (container) container.appendChild(messageArea);
    }

    messageArea.innerHTML = '';
    messages.forEach(msg => {
      const msgEl = document.createElement('div');
      msgEl.className = 'group-channel-message';
      
      const avatar = msg.avatar || '/default-avatar.png';
      const time = new Date(msg.created_at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
      
      msgEl.innerHTML = `
        <img src="${avatar}" alt="${msg.username}" class="group-channel-message-avatar" />
        <div class="group-channel-message-content">
          <div class="group-channel-message-header">
            <div class="group-channel-message-username">${msg.username}</div>
            <div class="group-channel-message-time">${time}</div>
          </div>
          ${msg.content ? `<div class="group-channel-message-text">${msg.content}</div>` : ''}
          ${msg.image_url ? `<img src="${msg.image_url}" alt="Message" class="group-channel-message-image" />` : ''}
        </div>
      `;
      
      messageArea.appendChild(msgEl);
    });

    // Scroll to bottom
    messageArea.scrollTop = messageArea.scrollHeight;

    // Mesaj gönderme formunu ekle
    setupChannelMessageForm(groupSlug, channelId);
  } catch (e) {
    console.error('Kanal mesajları yükleme hatası:', e);
  }
}

function setupChannelMessageForm(groupSlug, channelId) {
  // Var olan formu kaldır
  const existingForm = document.getElementById('channel-message-form');
  if (existingForm) existingForm.remove();

  // Yeni form oluştur
  const formContainer = document.createElement('div');
  formContainer.id = 'channel-message-form';
  formContainer.style.cssText = 'padding: 12px; border-top: 1px solid var(--border); display: flex; gap: 8px; align-items: flex-end;';
  
  formContainer.innerHTML = `
    <textarea id="channel-message-input" class="channel-settings-input" placeholder="Mesaj yaz..." style="flex: 1; resize: none; min-height: 40px; max-height: 120px;"></textarea>
    <button id="channel-message-send" class="btn-channel primary" style="width: 40px; height: 40px; padding: 0;">
      <i class="fas fa-paper-plane"></i>
    </button>
  `;

  const messageArea = document.getElementById('group-channel-messages-area');
  if (messageArea) {
    messageArea.parentElement.appendChild(formContainer);

    document.getElementById('channel-message-send').addEventListener('click', async () => {
      const input = document.getElementById('channel-message-input');
      const content = input.value.trim();
      if (!content) return;

      try {
        const response = await fetch(`/api/group/${groupSlug}/channel/${channelId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content })
        });

        if (response.ok) {
          input.value = '';
          // Mesajları yeniden yükle
          await loadChannelMessages(groupSlug, channelId);
        }
      } catch (e) {
        console.error('Mesaj gönderme hatası:', e);
      }
    });
  }
}

function showChannelCreatorModal(groupSlug) {
  const modal = document.getElementById('channel-settings-modal');
  const title = document.getElementById('channel-settings-title');
  const nameInput = document.getElementById('channel-name-input');
  const iconInput = document.getElementById('channel-icon-input');
  const descInput = document.getElementById('channel-description-input');
  const canWrite = document.getElementById('channel-can-write');
  const canViewHistory = document.getElementById('channel-can-view-history');
  const visibility = document.getElementById('channel-visibility');
  const deleteBtn = document.getElementById('channel-settings-delete');

  title.textContent = 'Yeni Kanal Oluştur';
  nameInput.value = '';
  iconInput.value = 'fas fa-hashtag';
  descInput.value = '';
  canWrite.checked = true;
  canViewHistory.checked = true;
  visibility.value = 'all';
  deleteBtn.style.display = 'none';

  const preview = document.getElementById('channel-icon-preview');
  preview.innerHTML = '<i class="fas fa-hashtag"></i>';

  iconInput.addEventListener('input', (e) => {
    preview.innerHTML = `<i class="${e.target.value}"></i>`;
  });

  const saveBtn = document.getElementById('channel-settings-save');
  const cancelBtn = document.getElementById('channel-settings-cancel');

  saveBtn.onclick = async () => {
    const name = nameInput.value.trim();
    if (!name) return alert('Kanal adı gerekli');

    try {
      const response = await fetch(`/api/group/${groupSlug}/channels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          icon: iconInput.value,
          description: descInput.value
        })
      });

      if (response.ok) {
        modal.classList.remove('visible');
        await loadGroupChannels(groupSlug);
        toast('Kanal oluşturuldu', 'success');
      } else {
        const error = await response.json();
        alert('Hata: ' + error.error);
      }
    } catch (e) {
      console.error('Kanal oluşturma hatası:', e);
    }
  };

  cancelBtn.onclick = () => modal.classList.remove('visible');
  modal.classList.add('visible');
}

function showChannelSettingsModal(groupSlug, channelId) {
  const channel = groupChannels.find(c => c.id === channelId);
  if (!channel) return;

  const modal = document.getElementById('channel-settings-modal');
  const title = document.getElementById('channel-settings-title');
  const nameInput = document.getElementById('channel-name-input');
  const iconInput = document.getElementById('channel-icon-input');
  const descInput = document.getElementById('channel-description-input');
  const canWrite = document.getElementById('channel-can-write');
  const canViewHistory = document.getElementById('channel-can-view-history');
  const visibility = document.getElementById('channel-visibility');
  const deleteBtn = document.getElementById('channel-settings-delete');

  title.textContent = 'Kanal Ayarları: ' + channel.name;
  nameInput.value = channel.name;
  iconInput.value = channel.icon || 'fas fa-hashtag';
  descInput.value = channel.description || '';
  canWrite.checked = channel.can_write;
  canViewHistory.checked = channel.can_view_history;
  visibility.value = channel.visibility || 'all';
  deleteBtn.style.display = channel.is_default ? 'none' : 'block';

  const preview = document.getElementById('channel-icon-preview');
  preview.innerHTML = `<i class="${channel.icon || 'fas fa-hashtag'}"></i>`;

  iconInput.addEventListener('input', (e) => {
    preview.innerHTML = `<i class="${e.target.value}"></i>`;
  });

  const saveBtn = document.getElementById('channel-settings-save');
  const cancelBtn = document.getElementById('channel-settings-cancel');

  saveBtn.onclick = async () => {
    const name = nameInput.value.trim();
    if (!name) return alert('Kanal adı gerekli');

    try {
      const response = await fetch(`/api/group/${groupSlug}/channel/${channelId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          icon: iconInput.value,
          description: descInput.value,
          can_write: canWrite.checked,
          can_view_history: canViewHistory.checked,
          visibility: visibility.value
        })
      });

      if (response.ok) {
        modal.classList.remove('visible');
        await loadGroupChannels(groupSlug);
        toast('Kanal güncellendi', 'success');
      } else {
        const error = await response.json();
        alert('Hata: ' + error.error);
      }
    } catch (e) {
      console.error('Kanal güncelleme hatası:', e);
    }
  };

  deleteBtn.onclick = async () => {
    if (!confirm('Bu kanalı silmek istediğinize emin misiniz?')) return;

    try {
      const response = await fetch(`/api/group/${groupSlug}/channel/${channelId}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        modal.classList.remove('visible');
        await loadGroupChannels(groupSlug);
        toast('Kanal silindi', 'success');
      } else {
        const error = await response.json();
        alert('Hata: ' + error.error);
      }
    } catch (e) {
      console.error('Kanal silme hatası:', e);
    }
  };

  cancelBtn.onclick = () => modal.classList.remove('visible');
  modal.classList.add('visible');
}

async function setupApprovalSystem(groupSlug) {
  try {
    const response = await fetch(`/api/group/${groupSlug}/approval/requests`);
    const requests = await response.json();

    const container = document.getElementById('approval-requests-container');
    container.innerHTML = '';

    requests.forEach(req => {
      const item = document.createElement('div');
      item.className = 'approval-request-item';
      
      const avatar = req.avatar || '/default-avatar.png';
      const time = new Date(req.requested_at).toLocaleDateString('tr-TR');

      item.innerHTML = `
        <img src="${avatar}" alt="${req.username}" class="approval-request-avatar" />
        <div class="approval-request-info">
          <div class="approval-request-username">${req.username}</div>
          ${req.bio ? `<div class="approval-request-bio">${req.bio}</div>` : ''}
          <div class="approval-request-time">Talep Tarihi: ${time}</div>
        </div>
        <div class="approval-request-actions">
          <button class="btn btn-primary" style="flex: 1;" onclick="respondToApprovalRequest('${groupSlug}', ${req.id}, true)">
            <i class="fas fa-check"></i> Onayla
          </button>
          <button class="btn btn-danger" style="flex: 1;" onclick="respondToApprovalRequest('${groupSlug}', ${req.id}, false)">
            <i class="fas fa-times"></i> Reddet
          </button>
        </div>
      `;

      container.appendChild(item);
    });

    if (requests.length === 0) {
      container.innerHTML = '<p style="text-align: center; color: var(--text-muted); padding: 20px;">Bekleyen talep yok</p>';
    }
  } catch (e) {
    console.error('Onay talepleri yükleme hatası:', e);
  }
}

async function respondToApprovalRequest(groupSlug, requestId, approved) {
  try {
    const response = await fetch(`/api/group/${groupSlug}/approval/respond/${requestId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved })
    });

    if (response.ok) {
      toast(approved ? 'Kullanıcı onaylandı' : 'Talep reddedildi', 'success');
      await setupApprovalSystem(groupSlug);
    }
  } catch (e) {
    console.error('Onay yanıtı hatası:', e);
  }
}

function showApprovalSystemModal(groupSlug) {
  const modal = document.getElementById('approval-settings-modal');
  const toggle = document.getElementById('approval-toggle');
  const section = document.getElementById('approval-requests-section');
  const close = document.getElementById('approval-settings-close');

  // Onay sisteminin durumunu kontrol et
  fetch(`/api/group/${groupSlug}`)
    .then(r => r.json())
    .then(group => {
      toggle.checked = false; // Burada gerçek API'dan kontrol et
    });

  toggle.onchange = async () => {
    try {
      await fetch(`/api/group/${groupSlug}/approval/toggle`, {
        method: 'POST'
      });
      section.style.display = toggle.checked ? 'block' : 'none';
      if (toggle.checked) {
        await setupApprovalSystem(groupSlug);
      }
      toast(toggle.checked ? 'Onay sistemi aktifleştirildi' : 'Onay sistemi deaktifleştirildi', 'success');
    } catch (e) {
      console.error('Onay sistemi toggle hatası:', e);
    }
  };

  close.onclick = () => modal.classList.remove('visible');
  modal.classList.add('visible');
}

// Kanallar sidebar'ı göster/gizle (mobil)
function toggleChannelsSidebar() {
  const sidebar = document.getElementById('group-channels-sidebar');
  sidebar?.classList.toggle('visible');
}

// Export edilmiş fonksiyonlar
window.loadGroupChannels = loadGroupChannels;
window.selectChannel = selectChannel;
window.showChannelSettingsModal = showChannelSettingsModal;
window.showApprovalSystemModal = showApprovalSystemModal;
window.toggleChannelsSidebar = toggleChannelsSidebar;

// ===== KANAL SİSTEMİ JAVASCRIPT SONU =====
