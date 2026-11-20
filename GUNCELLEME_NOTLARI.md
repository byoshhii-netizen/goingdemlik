# Güncelleme Notları — Reals, Mesajlar, Yönetim Paneli, Güvenlik

## Reals (Instagram Reels seviyesi)
- Akış baştan yazıldı (`renderRealsFeed`, `ig-*` sınıfları, `public/cigcig-pro.css`).
- CSS scroll-snap + IntersectionObserver: kaydırma biter bitmez oynatma; sadece aktif ±1 videonun kaynağı yüklü (iOS/Android bellek sınırı), sonraki video önceden yüklenir, yavaş bağlantıda yalnızca meta veri.
- Sonsuz akış (20'şer sayfa), Cloudinary videoları için otomatik kalite/codec (`q_auto`, iPhone'da H.264/MP4) ve otomatik kapak görseli; hata olursa orijinal adrese geri düşer.
- Dokun: ses aç/kapat · Basılı tut: duraklat (arayüz gizlenir) · Çift dokun: kalp animasyonlu beğeni · Sürüklenebilir ilerleme çubuğu.
- Yorumlar ve seçenekler için sürükleyerek kapanan alt sayfa; masaüstünde Instagram web düzeni ve yukarı/aşağı tuşları.
- Sekme gizlenince durur, sayfadan çıkınca tüm dinleyiciler ve videolar temizlenir.

## Mesajlar (WhatsApp tarzı)
- Sesli mesaj: basılı tut-kaydet, bırak-gönder, sola kaydır-iptal, yukarı kaydır-kilitle (duraklat/devam), masaüstünde tek tık. Dalga formu, yükleme yüzdesi, başarısızsa tekrar gönder.
- Kayıtlar sunucu üzerinden Cloudinary'ye (`cigcig/voice`) yüklenir, MP3 olarak oynatılır; imzalı token ile doğrulanır.
- Oynatıcı: sürükleyerek sarma, 1×/1.5×/2× hız, tek seferde tek ses, art arda gelen sesli mesajları otomatik oynatma, "dinlendi" bildirimi (mavi mikrofon).
- Saat (14:05) ve gün ayraçları (Bugün/Dün/tarih), mobilde hap şeklinde giriş alanı, yazınca gönder / boşken mikrofon butonu, iOS zoom engeli (16px).
- Performans: ekran dışı mesajlar çizilmez (`content-visibility`), eski mesajlar yukarı kaydırınca sayfa sayfa yüklenir, anlık bağlantı açıkken 2.5 sn'lik sorgu yerine 20 sn'de bir eşitleme, sekme arka plandayken sorgu yok, bağlantı geri gelince anında eşitleme.

## Yönetim paneli (/gubukgak)
- Her bölümün kendi adresi var (`/gubukgak/kullanicilar` vb.); yenileme, paylaşma, geri/ileri tuşları çalışır.
- Yeni kabuk: gruplanmış ve katlanabilir menü, menü içi arama, Ctrl+K hızlı geçiş, mobil çekmece menü, yeni giriş ekranı.
- Yeni Kontrol Merkezi: tek istekte özet (`/api/admin/overview`), bekleyen işler ve menüde rozetler, hızlı işlemler, son işlemler.
- Üst bardaki tüm kullanıcı/konu listelerini indiren ağır istek kaldırıldı.

## Güvenlik
- Async route hataları artık süreci düşürmüyor (Express 4 async sarmalayıcı + unhandledRejection kaydı); 5xx yanıtlarında iç hata ayrıntısı sızmıyor.
- Yüklenen dosyalar: uzantı izinli listeden belirleniyor (HTML yüklenip çalıştırılamaz), `/uploads` için sandbox CSP.
- DM: yanıtlanan mesajın aynı sohbete ait olması zorunlu (başka sohbetlerin içeriği sızamaz), mesaj uzunluğu sınırı, fotoğraf adresi doğrulaması, paylaşım kimliklerinin doğrulanması.
- Admin IP kısıtı taklit edilebilen `X-Forwarded-For` yerine güvenilir `req.ip` kullanıyor; admin yanıtları `no-store`, panel `noindex`.
- HSTS, COOP, ek CSP direktifleri (object-src, base-uri, frame-ancestors); mikrofon/kamera yalnızca kendi alan adında.
- `toast` ve `escHtml` XSS'e karşı sertleştirildi; VMB panel girişi sabit zamanlı karşılaştırma.
- Socket.io mesaj boyutu sınırı.

## 2. Tur güncellemeleri
- Ana sayfa gönderileri ve Reals kartları Instagram akışı düzenine geçti (kenardan kenara medya, ikon eylem satırı, kullanıcı adı + açıklama).
- Profil fotoğrafına dokununca Instagram gibi büyütme; profil kapak görseli Instagram tarzı.
- Gazeteler: kompakt üst kısım, "Gazete yayınla" sadece gazetecilere, gazetelerde "+" gazeteciye gazete paneli açar. Editör telefonda engelli (≥1024px gerekir).
- Mesajlar: yeni seçim çubuğu, 26 sohbet teması, admin > Sohbet Görünümü'nden sohbet arka planı (doodle) yükleme.
- Reals: kırmızı tik; ortaya dokunmak videoyu durdurur, ses sağ üstten.
- Android mikrofon: izin yardımı penceresi ve uyumlu kayıt ayarları.
- Sesli arama (birebir + ayrı grup araması), WebRTC.
- Hikayeler: yeni Instagram tarzı görüntüleyici, yakın arkadaş (yeşil halka) göstergesi.
- 22 Instagram filtresi (Clarendon, Juno, Lark, Valencia...).

### Sesli arama için TURN sunucusu (önemli)
Mobil veri / bazı modemlerde aramaların bağlanması için TURN gerekir. Railway değişkenleri:
- `TURN_URLS` = `turn:sunucu:3478,turns:sunucu:5349` (virgülle)
- `TURN_USERNAME`, `TURN_CREDENTIAL`
- `CALL_MAX_PARTICIPANTS` (grup araması, varsayılan 8)
Ücretsiz/ucuz seçenekler: Metered.ca, Cloudflare Calls TURN, kendi coturn sunucun.
