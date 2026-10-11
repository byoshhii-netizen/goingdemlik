const crypto = require('crypto');

const LEGAL_DOCUMENT_DEFAULTS = Object.freeze({
  information_notice: `CİGCİG KİŞİSEL VERİLERİN İŞLENMESİ HAKKINDA AYDINLATMA METNİ

1. VERİ SORUMLUSU
CigCig platformunun işletmecisi, 6698 sayılı Kişisel Verilerin Korunması Kanunu ("KVKK") kapsamında veri sorumlusudur. Veri sorumlusunun güncel kimlik ve iletişim bilgileri için CigCig'in iletişim kanallarını kullanabilirsiniz.

2. İŞLENEN KİŞİSEL VERİLER
Hesap oluştururken kullanıcı adı, e-posta adresi ve doğum tarihi; isteğe bağlı profil fotoğrafı, profil bilgileri ve paylaştığınız içerikler; ayrıca hesabın ve hizmetlerin güvenliği için IP adresi, oturum, işlem ve teknik kayıtlar işlenebilir. Kullanılan özelliklere göre yorumlar, beğeniler, mesajlar, takip ve gizlilik tercihleri de işlenebilir.

3. İŞLEME AMAÇLARI VE HUKUKİ SEBEPLER
Veriler; hesabın oluşturulması ve yönetilmesi, platform özelliklerinin sunulması, kullanıcı taleplerinin karşılanması, kötüye kullanımın önlenmesi ve bilgi güvenliğinin sağlanması amaçlarıyla; sözleşmenin kurulması veya ifası, hukuki yükümlülüklerin yerine getirilmesi ve temel haklarınıza zarar vermemek kaydıyla meşru menfaat hukuki sebeplerine dayanılarak işlenir. Açık rıza gereken isteğe bağlı özelliklerde ayrıca rızanız alınır.

4. AKTARIM
Kişisel verileriniz satılmaz ve reklam amacıyla üçüncü kişilere verilmez. Hizmetin çalışması için gerekli ölçüde barındırma/veritabanı, e-posta, dosya depolama ve ödeme hizmeti sağlayıcıları verileri hizmet sağlayıcı sıfatıyla işleyebilir. Bu sağlayıcılarla yalnızca ilgili hizmet için gerekli veri paylaşılır. Kanunen yetkili kamu kurumlarına, usulüne uygun talep halinde aktarım yapılabilir. Yurt dışındaki hizmet sağlayıcılara aktarım söz konusu olduğunda KVKK'nın yurt dışına aktarım hükümleri uygulanır.

5. SAKLAMA
Veriler, hesabınız ve ilgili hizmetler sürdüğü müddetçe; sonrasında ise ilgili mevzuat ve zamanaşımı süreleri veya işleme amacı için gereken süre boyunca saklanır. Silme ve anonimleştirme talepleri, saklama yükümlülükleri saklı kalmak üzere değerlendirilir.

6. KVKK KAPSAMINDAKİ HAKLARINIZ
KVKK'nın 11. maddesi uyarınca kişisel verilerinizin işlenip işlenmediğini öğrenme, bilgi talep etme, amacını ve aktarım yapılan tarafları öğrenme, düzeltme, silme veya yok etme talep etme, otomatik analiz sonuçlarına itiraz etme ve kanuna aykırı işleme nedeniyle zararın giderilmesini isteme haklarına sahipsiniz. Başvurunuzu CigCig'in iletişim kanalları üzerinden veri sorumlusuna iletebilirsiniz.`,

  privacy_policy: `CİGCİG GİZLİLİK SÖZLEŞMESİ VE GİZLİLİK POLİTİKASI

1. GİZLİLİĞE YAKLAŞIMIMIZ
CigCig kişisel verilerinizi satmaz ve reklam hedeflemesi amacıyla üçüncü kişilere kullandırmaz. Verileriniz, platformu işletmek için zorunlu teknik hizmetleri sunan sağlayıcılar ve kanunen yetkili merciler dışında bağımsız üçüncü taraflarla paylaşılmaz. Hizmet sağlayıcılar, kendilerine verilen verileri yalnızca ilgili hizmeti sağlamak için ve talimatlarımız doğrultusunda işler.

2. TOPLANAN BİLGİLER
Hesap bilgileri (kullanıcı adı, e-posta ve doğum tarihi), sizin eklediğiniz profil ve içerik bilgileri, platform içi etkileşimleriniz ve güvenlik/teknik kayıtlar işlenebilir. Şifreler veritabanında düz metin olarak tutulmaz; tek yönlü, tuzlu ve güçlü bir parola türetme algoritmasıyla saklanır.

3. HİZMET SAĞLAYICILAR
Platformun barındırılması ve veritabanı, e-posta gönderimi, dosya/fotoğraf/video depolama ve isteğe bağlı ödeme işlemleri için hizmet sağlayıcılar kullanılabilir. Bu sağlayıcılara yalnızca hizmetin gerektirdiği veriler iletilir. Ödeme kartı bilgileri, ödeme hizmeti sağlayıcısı tarafından işlenebilir; CigCig'in kendi ödeme altyapısında tutulduğu varsayılmamalıdır. Sağlayıcıların kendi gizlilik koşulları da geçerli olabilir.

4. İÇERİK VE HESAP GİZLİLİĞİ
Paylaştığınız içeriklerin görünürlüğü, platformdaki gizlilik ayarlarına ve özelliğin niteliğine bağlıdır. Herkese açık içerikler diğer kullanıcılar tarafından görülebilir. Hesap veya içerik silme işlemleri yedekler, güvenlik kayıtları ve yasal saklama yükümlülükleri nedeniyle derhal tüm sistemlerden kaldırılmayabilir.

5. GÜVENLİK VE SAKLAMA
Verileri yetkisiz erişim, kayıp ve kötüye kullanıma karşı korumak için makul teknik ve idari önlemler uygulanır. İnternet üzerinden hiçbir aktarım veya saklama yönteminin mutlak güvenliği garanti edilemez. Veriler, hizmetin sunulması ve hukuki yükümlülüklerin yerine getirilmesi için gereken süre boyunca tutulur.

6. HAKLARINIZ VE İLETİŞİM
Kişisel verilerinizle ilgili erişim, düzeltme, silme ve diğer KVKK haklarınız için CigCig'in iletişim kanallarından başvurabilirsiniz. Ayrıntılar için Kişisel Verilerin İşlenmesi Hakkında Aydınlatma Metni'ni inceleyin.`,

  kvkk_text: `6698 SAYILI KİŞİSEL VERİLERİN KORUNMASI KANUNU (KVKK) BİLGİLENDİRMESİ

CigCig hesabı oluşturulurken kullanıcı adı, e-posta adresi ve doğum tarihi; isteğe bağlı profil ve içerik bilgileri ile hizmet güvenliği için IP/oturum kayıtları işlenebilir. Bu veriler hesap yönetimi, platformun sunulması, güvenlik ve hukuki yükümlülüklerin yerine getirilmesi amaçlarıyla kullanılır.

Verileriniz satılmaz veya reklam hedefleme amacıyla paylaşılmaz. Platformun çalışması için gereken barındırma/veritabanı, e-posta, dosya depolama ve ödeme hizmeti sağlayıcıları verileri yalnızca ilgili hizmet kapsamında işleyebilir. Kanunen yetkili mercilere, hukuka uygun talep halinde aktarım yapılabilir.

KVKK'nın 11. maddesi kapsamındaki haklarınız ve verilerinizin işlenmesine ilişkin ayrıntılar için Aydınlatma Metni'ni; verilerin korunma ve kullanım esasları için Gizlilik Sözleşmesi'ni okuyun. Başvurularınızı CigCig'in iletişim kanalları üzerinden iletebilirsiniz.

Bu bilgilendirme, Aydınlatma Metni ve Gizlilik Sözleşmesi ile birlikte değerlendirilmelidir.`
});

function createLegalDocumentsVersion(documents) {
  const content = Object.keys(LEGAL_DOCUMENT_DEFAULTS)
    .map(key => `${key}\0${String(documents[key] || '')}`)
    .join('\0');
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

module.exports = { LEGAL_DOCUMENT_DEFAULTS, createLegalDocumentsVersion };
