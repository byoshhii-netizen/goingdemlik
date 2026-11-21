# CigCig SEO Notları (21 Kasım 2026)

## Ne değişti?

### En kritik düzeltme
Sunucu her sayfa için Google'ın okuyacağı içeriği hazırlıyordu, ama `index.html` içindeki
yükleme iskeleti yüzünden bu içerik sayfaya **hiç eklenmiyordu**. Google konu, şiir ve kitap
sayfalarında boş bir sayfa görüyordu. Bu düzeltildi (`<!-- APP_CONTENT_START -->` işaretleri).

### Yeni dosya: `seo.js`
- **/sitemap.xml** artık bir site haritası dizini. İçerik türüne göre ayrı haritalara ayrılıyor:
  `/sitemap-konular.xml`, `-siirler`, `-kitaplar`, `-kitap-sayfalari`, `-muzikler`, `-fotograflar`,
  `-videolar`, `-reals`, `-gazeteler`, `-gruplar`, `-profiller`, `-etiketler`, `-sayfalar`.
  - Fotoğraflar `image:image` etiketiyle eklendi (Google Görseller için).
  - Videolar ve Reals `video:video` etiketiyle eklendi (Google Videolar için).
  - 40.000 adresi geçen türler otomatik sayfalanıyor (`-2.xml`, `-3.xml`...).
  - +18 işaretli içerik, gizli, silinmiş ve banlı hesaplar haritaya girmiyor.
- **Profil sayfaları** (`/profil/kullanici`) artık Google'a dolu geliyor: biyografi, avatar,
  takipçi sayısı ve kişinin konuları, şiirleri, kitapları, fotoğrafları, videoları ve müzikleri,
  ayrıca `ProfilePage` şeması. **Gizli hesaplar `noindex`**, yani Google'da çıkmaz.
- **Ana sayfa** bütün bölümleri ve son içerikleri listeliyor. "CigCig" aramasında alt bağlantıların
  (sitelinks) çıkması için gerekli iç bağlantı yapısı bu.
- **/arama?q=...** sunucu tarafında sonuç üretiyor. Google'daki site içi arama şeması da artık buraya bakıyor.
- Mesajlar, ayarlar, arkadaşlar, siparişler ve bildirimler `noindex` ve robots.txt'de engelli.
- **IndexNow (isteğe bağlı):** Railway'de `INDEXNOW_KEY` değişkenine 32 karakterlik rastgele bir
  harf ve rakam dizisi girersen yeni içerikler her 30 dakikada bir Bing ve Yandex'e bildirilir.

### `server.js` değişiklikleri
- Her sayfaya **BreadcrumbList** (CigCig › Konular › Başlık), `og:type`, `og:locale` ve görsel alt metni eklendi.
- **Konu sayfaları (Ekşi tarzı):** tam metin, tüm yorumlar (sayfada ve şemada), etiketler,
  beğeni ve yorum sayıları. Bir yorumdaki cümle aratıldığında da konu çıkabilir.
- Şiir, video, Reals, gazete ve kitap sayfalarına yorumlar eklendi.
- Videolara süre, izlenme sayısı ve yükleyen bilgisi eklendi.
- Fotoğraflara Google Görseller için yaratıcı, telif ve konum bilgisi eklendi.
- "İlk ziyarette giriş zorunlu" ayarı açıkken Google'ın şiir, video, Reals, fotoğraf, grup ve gazete
  sayfalarına girememesi düzeltildi. Bu sayfalar konu, kitap ve müzik gibi misafirlere açık.
  **Not:** Ana sayfa bu ayar açıkken hâlâ girişe yönlendiriyor. Ayar açıksa sitelinks zayıflar.

### `public/index.html`
- Site içi arama şeması `/arama?q=` adresine yönlendirildi (eskiden hatalıydı).
- Geçersiz `SiteLinksSearchBox` şeması kaldırıldı. WebSite ve Organization tek bir grafikte birleşti, kare logo eklendi.
- Menüdeki "Konular" bağlantısı yönlendirmesiz `/forum` adresine çevrildi.

## Yayına aldıktan sonra yapılacaklar (Google Search Console)
1. https://search.google.com/search-console adresinden cigcig.xyz mülkünü aç.
2. **Site haritaları** bölümünde eski haritayı sil, `sitemap.xml` ekle.
3. **URL denetimi** ile ana sayfayı, bir konuyu ve bir profili denetleyip **Dizine eklenmeyi iste**.
4. https://search.google.com/test/rich-results ile bir konu sayfasını test et.
5. Bing Webmaster Tools ve Yandex Webmaster'a da aynı site haritasını ekle.

Sonuçların Google'da görünmesi genelde birkaç gün ile birkaç hafta sürer. Sitelinks'i Google
kendisi seçer, zorla eklenemez.

## Geri alma
Eski dosyalar `yedek-seo-20261121/` klasöründe. `server.js` ve `public/index.html` dosyalarını
oradakilerle değiştirip `seo.js` dosyasını silmen yeterli.
