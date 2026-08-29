# CigCig Kanal Sistemi Rehberi

## 📋 Genel Bakış

CigCig'e kapsamlı bir **kanal sistemi** ve **onay sistemi** eklendi. Gruplar artık birden fazla kanala ayırılabilir ve yöneticiler yeni kullanıcılar için onay akışı ayarlayabilir.

---

## ✨ Ana Özellikler

### 1. **Kanal Sistemi**
- ✅ Her grupta birden fazla kanal oluşturma
- ✅ Varsayılan "kanal" adlı kanal otomatik oluşturma
- ✅ Kanal simgesi olarak Font Awesome ikonları kullanma (fas fa-...)
- ✅ Kanal açıklaması ve ayarları
- ✅ Kanal mesaj geçmişi ve görünürlük kontrolü
- ✅ Moderatör ve üye yönetimi

### 2. **Kanal Yönetimi**
- 👤 Sadece **sahibi** ve **moderatörler** kanal oluşturabilir
- 🔧 Kanal adı, simge, açıklama değiştirilebilir
- 🗑️ Kanallar silinebilir (varsayılan kanal hariç)
- 📋 Kanal mesajları ayrı ayrı saklanır
- 🔒 Kanal görünürlüğü ayarlanabilir (Tüm Üyeler, Sadece Üyeler, Sadece Moderatörler)

### 3. **Onay Sistemi**
- ✅ Grupların yeni katılım isteyenlerini onaylama sistemine geçebilmesi
- 👤 Yeni üye katılım isteği yapanlar **"onay" kanalına** yönlendirilir
- 📝 Onay kanalında sadece ilgili kullanıcı yazabilir
- ✔️ Yönetici/Sahibi onay talebini kabul veya reddedebilir
- 🔐 Onaylanan üyeler tüm kanallara erişim sağlar

### 4. **Mobil Tasarım**
- 📱 Mobil cihazlarda sol menü dropdown olur
- 🎨 Responsive CSS tasarımı
- 🖐️ Kanal değiştirme kolaylaştırıldı

---

## 🗄️ Veritabanı Tabloları

### Yeni Tablolar

#### `group_channels`
```sql
id (BIGSERIAL PRIMARY KEY)
group_id (BIGINT - groups tablosuna FK)
name (TEXT - Kanal adı)
icon (TEXT - Font Awesome ikonu, default: 'fas fa-hashtag')
description (TEXT - Kanal açıklaması)
is_default (INTEGER - Varsayılan kanal mı?)
can_view_history (INTEGER - Geçmiş görülür mü?)
can_write (INTEGER - Yazılabilir mi?)
visibility (TEXT - 'all', 'members', 'moderators', 'approval_only')
created_by (BIGINT - Kanalı oluşturan kullanıcı)
created_at (TIMESTAMP)
moderators_can_manage (INTEGER - Moderatörler yönetebilir mi?)
moderators_can_write (INTEGER - Moderatörler yazabilir mi?)
```

#### `group_channel_messages`
```sql
id (BIGSERIAL PRIMARY KEY)
channel_id (BIGINT - group_channels tablosuna FK)
user_id (BIGINT - İleti sahibi)
content (TEXT - Mesaj içeriği)
image_url (TEXT - Varsa resim URL)
edited_at (TIMESTAMP - Düzenleme zamanı)
created_at (TIMESTAMP)
```

#### `group_approval_systems`
```sql
id (BIGSERIAL PRIMARY KEY)
group_id (BIGINT UNIQUE - groups tablosuna FK)
is_enabled (INTEGER - Sistem aktif mi?)
created_at (TIMESTAMP)
updated_at (TIMESTAMP)
```

#### `group_approval_requests`
```sql
id (BIGSERIAL PRIMARY KEY)
group_id (BIGINT - groups tablosuna FK)
user_id (BIGINT - İstek yapan kullanıcı)
status (TEXT - 'pending', 'approved', 'rejected')
requested_at (TIMESTAMP)
reviewed_by (BIGINT - Inceleyici)
reviewed_at (TIMESTAMP)
rejection_reason (TEXT)
UNIQUE(group_id, user_id)
```

---

## 🔌 API Endpoints

### Kanal Yönetimi

#### `GET /api/group/:slug/channels`
Grubun tüm kanallarını listele
```json
Response: [
  {
    "id": 1,
    "name": "kanal",
    "icon": "fas fa-hashtag",
    "description": "Varsayılan kanal",
    "is_default": 1,
    "can_view_history": 1,
    "can_write": 1,
    "visibility": "all",
    "created_by_username": "owner",
    "message_count": 42
  }
]
```

#### `POST /api/group/:slug/channels`
Yeni kanal oluştur (Sahibi/Moderatör)
```json
Body: {
  "name": "Duyurular",
  "icon": "fas fa-bullhorn",
  "description": "Grup duyuruları burada yapılır"
}
```

#### `PUT /api/group/:slug/channel/:channelId`
Kanal güncelle (Sahibi/Moderatör)
```json
Body: {
  "name": "Duyurular",
  "icon": "fas fa-bullhorn",
  "description": "Güncellendi",
  "can_write": 1,
  "can_view_history": 1,
  "visibility": "all"
}
```

#### `DELETE /api/group/:slug/channel/:channelId`
Kanal sil (Sahibi/Moderatör, varsayılan kanal hariç)

### Kanal Mesajları

#### `GET /api/group/:slug/channel/:channelId/messages?limit=50&offset=0`
Kanal mesajlarını al
```json
Response: [
  {
    "id": 1,
    "channel_id": 5,
    "user_id": 123,
    "username": "user",
    "avatar": "url",
    "content": "Merhaba",
    "image_url": "",
    "edited_at": null,
    "created_at": "2026-08-29T10:00:00Z"
  }
]
```

#### `POST /api/group/:slug/channel/:channelId/messages`
Kanala mesaj gönder
```json
Body: {
  "content": "Merhaba arkadaşlar!",
  "image_url": ""
}
```

### Onay Sistemi

#### `POST /api/group/:slug/approval/toggle`
Onay sistemini aç/kapat (Sahibi)

#### `GET /api/group/:slug/approval/requests`
Bekleyen onay taleplerini listele (Sahibi)

#### `POST /api/group/:slug/approval/request`
Yeni üye tarafından onay talebi oluştur
```json
Response: {
  "id": 1,
  "group_id": 5,
  "user_id": 123,
  "status": "pending",
  "requested_at": "2026-08-29T10:00:00Z"
}
```

#### `POST /api/group/:slug/approval/respond/:requestId`
Onay talebini yanıtla (Sahibi/Moderatör)
```json
Body: {
  "approved": true,  // or false
  "rejection_reason": "Uygun olmayan kullanıcı" // Reddettiyse
}
```

---

## 🎨 Frontend Dosyaları

### CSS
- **`channels-style.css`** - Kanal sistemi stilieri
  - Kanal listesi (.group-channels-sidebar)
  - Kanal mesajları (.group-channel-messages)
  - Kanal ayarları modal (.channel-settings-modal)
  - Onay sistemi UI (.approval-request-item)
  - Mobil responsive tasarım

### JavaScript
- **`channels.js`** - Ana kanal sistemi fonksiyonları
  - `loadGroupChannels(groupSlug)` - Kanalları yükle
  - `selectChannel(groupSlug, channelId, name, icon)` - Kanal seç
  - `loadChannelMessages(groupSlug, channelId)` - Mesajları yükle
  - `showChannelCreatorModal(groupSlug)` - Kanal oluştur modal
  - `showChannelSettingsModal(groupSlug, channelId)` - Kanal ayarları modal
  - `showApprovalSystemModal(groupSlug)` - Onay sistemi modal
  - `respondToApprovalRequest(groupSlug, requestId, approved)` - Onay yanıtla
  - `toggleChannelsSidebar()` - Mobil sidebar toggle

- **`channels-integration.js`** - Grup sayfasına entegrasyon
  - `setupChannelSystem(groupSlug, isOwner, isMod, isMember)` - Sistem kur
  - `checkApprovalSystem(groupSlug, isOwner)` - Onay sistemi kontrol
  - `integrateChannelsIntoGroupUI(groupSlug, isOwner)` - UI'ye entegre

---

## 💻 Kullanım Örnekleri

### 1. Grup Sahibi Olarak Kanal Oluşturma

```javascript
// Kanal oluştur butonuna tıkla
showChannelCreatorModal('grup-slug');

// Modal'da:
// - Kanal adı: "Duyurular"
// - Simge: "fas fa-bullhorn"
// - Açıklama: "Grup duyuruları ve güncellemeler"
// - Kaydet'e tıkla
```

### 2. Kanal Ayarlarını Değiştirme

```javascript
// Kanal üzerine sağ tıkla veya ayarlar ikonuna tıkla
showChannelSettingsModal('grup-slug', channelId);

// Değişiklikler yap:
// - Kanal adını "Önemli Duyurular" olarak değiştir
// - Simgeyi "fas fa-star" yap
// - "Moderatörler yazabilir" seçeneğini aç
// - Kaydet
```

### 3. Onay Sistemini Aktivate Etme

```javascript
// Grup ayarlarından "Onay Sistemi" butonuna tıkla
showApprovalSystemModal('grup-slug');

// Toggle'ı aç
// Otomatik olarak "onay" kanalı oluşturulur
// Yeni katılım isteyenler onay kanalına yönlendirilir
```

### 4. Onay Talebine Yanıt Verme

```javascript
// Yönetici panelinde bekleyen talepleri gör
setupApprovalSystem('grup-slug');

// Onay talep kartında:
// - "Onayla" butonuna tıkla (Üyeyi kabul et)
// - veya "Reddet" butonuna tıkla (Reddetti)
// Otomatik olarak üyeler listesine eklenir veya silinir
```

---

## 🎯 Tasarım Detayları

### Kanal Listesi (Sol Sidebar)
```
┌─────────────────────────┐
│     Kanallar      [+]   │  ← Header
├─────────────────────────┤
│ #️⃣ kanal           42   │  ← Default channel
│ 📢 Duyurular             │
│ 🎮 Oyunlar               │
│ ✅ onay            (1)   │  ← Approval channel
│                         │
└─────────────────────────┘
```

### Kanal Mesajları (Ana Alan)
```
┌─────────────────────────────────┐
│ Avatar  Username    15:30        │
│ Merhaba arkadaşlar! [Resim]      │
├─────────────────────────────────┤
│ Avatar  Username2   15:32        │
│ Hoşgeldiniz!                     │
├─────────────────────────────────┤
│ [Mesaj yaz...] [Görselle] [Gönder]
└─────────────────────────────────┘
```

### Onay Sistemi Modal
```
┌──────────────────────────────────┐
│ Onay Sistemi                     │
├──────────────────────────────────┤
│ ☐ Onay sistemi aktif             │
│                                  │
│ Bekleyen Talepler:               │
│ ├─ Avatar Kullanıcı              │
│ │  "Biyografi..."                │
│ │  [Onayla] [Reddet]             │
│ └─ Avatar Kullanıcı2             │
│    "Merhaba..."                  │
│    [Onayla] [Reddet]             │
├──────────────────────────────────┤
│ [Kapat]                          │
└──────────────────────────────────┘
```

### Mobil Görünüm
- Kanal listesi: Sabit menü ◀️ (hamburger button)
- Tıkladığında full-screen overlay
- Kanal seçiminde otomatik kapanır
- Sağdan kaydırma ya da backdrop'e basarak kapanır

---

## 🔐 Güvenlik & Yetki Sistemi

| İşlem | Sahibi | Moderatör | Üye | Dış |
|-------|--------|-----------|-----|-----|
| Kanal Oluştur | ✅ | ✅ | ❌ | ❌ |
| Kanal Düzenle | ✅ | ✅ | ❌ | ❌ |
| Kanal Sil | ✅ | ✅* | ❌ | ❌ |
| Mesaj Gönder | ✅ | ✅ | ✅ | ❌ |
| Mesaj Sil (Kendi) | ✅ | ✅ | ✅ | ❌ |
| Mesaj Sil (Diğeri) | ✅ | ✅ | ❌ | ❌ |
| Onay Sistemi Ayarla | ✅ | ❌ | ❌ | ❌ |
| Onay Talebi Cevapla | ✅ | ✅* | ❌ | ❌ |

*: Ayarlara bağlı

---

## 📱 Responsive Breakpoints

- **Desktop (769px+)**: Kanal listesi sabit sol sidebar
- **Tablet/Mobile (<768px)**: Kanal listesi hamburger menü

---

## 🚀 Kurulum & Aktivasyon

### 1. Veritabanı Migrasyon
Otomatik `database.js` içindeki `initDb()` ile yapılır:
```sql
- group_channels tablosu oluştur
- group_channel_messages tablosu oluştur
- group_approval_systems tablosu oluştur
- group_approval_requests tablosu oluştur
- Varsayılan "kanal" kanalı oluştur
```

### 2. Backend API Entegrasyon
`server.js`'e 15+ yeni endpoint eklendi:
```javascript
GET/POST/PUT/DELETE /api/group/:slug/channels
GET/POST /api/group/:slug/channel/:channelId/messages
POST /api/group/:slug/approval/toggle
GET /api/group/:slug/approval/requests
POST /api/group/:slug/approval/request
POST /api/group/:slug/approval/respond/:requestId
```

### 3. Frontend Entegrasyon
- `index.html` - CSS ve JS dosyaları bağlandı
- `app.js` - `renderGroupDetail()` sonuna kanal sistemi kurulumu eklendi
- Grup sayfası açıldığında otomatik kanal listesi gösterilir

---

## 🐛 Bilinen Sorunlar & İyileştirmeler

### Gelecek Versiyonlar
- [ ] Kanal kütüğü (audit log)
- [ ] Kanal arşivleme
- [ ] Kanal başlığı/banner resmi
- [ ] Kanal pinned messages
- [ ] Kanal emoji reactions
- [ ] Kanal @mention'ları
- [ ] İleri onay sistemi (multi-step approval)
- [ ] Kanal bot integrasyonları

---

## 📞 Destek & Geliştirme

**Dosyalar:**
- Backend: `server.js` (5500+), `database.js` (1050+)
- Frontend: `app.js`, `channels.js`, `channels-integration.js`
- Stil: `channels-style.css`

**Test Edilmiş:**
✅ Kanal oluşturma/silme
✅ Mesaj gönderme/görüntüleme
✅ Onay sistemi flow
✅ Mobil responsive tasarım
✅ İzin kontrolü
✅ API rate limiting

---

## 📄 Lisans

CigCig Platform - MIT Lisansı

---

**Sürüm:** 1.0  
**Tarih:** 29 Ağustos 2026  
**Yazar:** CigCig Development Team
