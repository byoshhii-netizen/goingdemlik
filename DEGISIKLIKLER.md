# Yapılan Değişiklikler

## 🔐 Güvenlik

### scrypt Şifre Hashing
- Kullanıcı ve admin şifreleri sunucuda rastgele salt ve güçlü parametrelerle **scrypt** kullanılarak hashlenir
- Mevcut SHA-256 hashli hesaplar ilk başarılı girişte otomatik olarak scrypt'e yükseltilir
- Şifre işlemleri tarayıcıda hashlenmez; admin şifresi de sunucuda hashlenir

### Brute Force Koruması
- `express-rate-limit` ile 15 dakikada maksimum **5 giriş denemesi**
- Başarısız deneme sonrası 15 dakika bekleme zorunluluğu

### Kaynak Kod Koruması
- `admin.js` dosyası artık **doğrudan erişilemez** — admin token + IP kontrolü gerekir
- `database.js`, `server.js` vs. `public/` klasöründen **kaldırıldı**
- `build.js` betiğiyle `admin.js` ve `app.js` **obfuscate** edilebilir:
  ```bash
  npm install
  node build.js
  ```

### Güvenli HTTP Headers
- X-Content-Type-Options, X-Frame-Options, X-XSS-Protection
- Content-Security-Policy
- Referrer-Policy

## 📱 Giriş Ekranı

- **CigCig logosu** üstte görünür
- **Kullanıcı adı VEYA e-posta** ile giriş yapılabilir
- Mobil uyumlu modern tasarım (auth-glass)
- Şifre göster/gizle butonu
- Enter tuşuyla giriş

## 📝 Kayıt Ekranı

- **CigCig logosu** üstte görünür
- Kullanıcı adı, e-posta, şifre alanları
- **Gizli / Açık hesap seçimi** (toggle buton)
  - Açık: profil herkese görünür
  - Gizli: yalnızca onaylı takipçiler görebilir
- KVKK onay kutusu
- Mobil uyumlu modern tasarım

## 🗑️ Kaldırılan Öğeler

- Mobil alt çubuk (bottom bar) ikonları kaldırıldı
- `public/` klasöründeki gereksiz dosyalar temizlendi:
  - `database.js`, `server.js`, `find_error.js`, `count_braces.js`, `parse.js`
  - `test-db.js`, `test_parse.js`, `test_parse2.js`
  - `package.json`, `package-lock.json`, `docker-compose.yml`, `Dockerfile`
  - İç içe `public/public/` klasörü

## 🗄️ Veritabanı

- `users` tablosuna `account_type TEXT DEFAULT 'public'` kolonu eklendi

