// ===== KANAL SİSTEMİ ENTEGRASYON (renderGroupDetail içinde çağrılacak) =====

async function setupChannelSystem(groupSlug, isOwner, isMod, isMember) {
  if (!isMember) return; // Üye değilseyse kanal sistemini kurma

  // Kanal sidebar'ını göster
  const sidebar = document.getElementById('group-channels-sidebar');
  if (sidebar) sidebar.classList.add('visible');

  // Kanalları yükle
  await loadGroupChannels(groupSlug);

  // Onay sistemini kontrol et
  checkApprovalSystem(groupSlug, isOwner);
}

async function checkApprovalSystem(groupSlug, isOwner) {
  try {
    // Approval system durumunu kontrol et
    const response = await fetch(`/api/group/${groupSlug}/approval/requests`);
    if (response.status === 200 && isOwner) {
      // Onay sisteminin aktif olup olmadığını görmek için pending requests'i kontrol et
      const requests = await response.json();
      if (requests.length > 0) {
        const modal = document.getElementById('approval-settings-modal');
        if (modal) {
          const section = document.getElementById('approval-requests-section');
          const container = document.getElementById('approval-requests-container');
          if (section && container) {
            section.style.display = 'block';
            await setupApprovalSystem(groupSlug);
          }
        }
      }
    }
  } catch (e) {
    console.error('Onay sistemi kontrol hatası:', e);
  }
}

function integrateChannelsIntoGroupUI(groupSlug, isOwner) {
  // Grup header'ına kanal ayarları düğmesi ekle
  const groupHeader = document.querySelector('.group-hero-actions');
  if (!groupHeader) return;

  if (isOwner) {
    const approvalBtn = document.createElement('button');
    approvalBtn.className = 'btn btn-outline btn-sm';
    approvalBtn.id = 'approval-system-btn';
    approvalBtn.innerHTML = '<i class="fas fa-check-circle"></i> Onay Sistemi';
    approvalBtn.onclick = () => showApprovalSystemModal(groupSlug);
    
    groupHeader.appendChild(approvalBtn);
  }

  // Mobil kanal toggle düğmesi ekle
  const mobileToggle = document.createElement('button');
  mobileToggle.className = 'mobile-channels-toggle';
  mobileToggle.innerHTML = '<i class="fas fa-bars"></i>';
  mobileToggle.onclick = toggleChannelsSidebar;
  
  const groupHero = document.querySelector('.group-hero-actions');
  if (groupHero) {
    groupHero.insertBefore(mobileToggle, groupHero.firstChild);
  }
}

// Export functions
window.setupChannelSystem = setupChannelSystem;
window.checkApprovalSystem = checkApprovalSystem;
window.integrateChannelsIntoGroupUI = integrateChannelsIntoGroupUI;

// ===== KANAL SİSTEMİ ENTEGRASYON SONU =====
