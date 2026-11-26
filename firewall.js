'use strict';
// =============================================================================
// CIGCIG GÜVENLİK DUVARI (WAF)
// -----------------------------------------------------------------------------
// Amaç: /.env, /.git/config gibi tarama denemelerini ve bilinen saldırı
// imzalarını istek daha uygulamaya ulaşmadan yakalamak, puanlamak, loglamak ve
// eşiği aşan IP'leri otomatik olarak yasaklamak.
//
// Tasarım ilkeleri:
//  * Sıcak yol (her istek) tamamen senkron ve bellek içidir. Veritabanına
//    yazmak istek döngüsünü hiçbir zaman bekletmez; olaylar kuyruğa alınır ve
//    toplu halde yazılır.
//  * Yasak listesi, izin listesi, kurallar ve ayarlar bellekte tutulur; sadece
//    değişiklik olduğunda veya periyodik tazelemede veritabanından okunur.
//  * Düzenli ifadeler yalnızca yapılandırma sürümü değiştiğinde derlenir.
//  * Mod "monitor" iken hiçbir istek engellenmez; sadece ne olacağı loglanır.
//    Bu, kuralları canlıda yanlış pozitif üretmeden ayarlamayı mümkün kılar.
// =============================================================================

const FIREWALL_SETTING_KEY = 'firewall_config';

// ─────────────────────────────────────────────────────────────────────────────
// Varsayılan yapılandırma
// ─────────────────────────────────────────────────────────────────────────────
const DEFAULT_CONFIG = {
  enabled: true,
  // off      → tamamen devre dışı (hiç log yok)
  // monitor  → yakalar ve loglar, engellemez (kural ayarı için)
  // block    → yakalar, loglar ve engeller
  mode: 'block',

  // Hangi olaylar veritabanına yazılsın
  // all        → eşleşen her kural
  // suspicious → severity >= 2
  // blocked    → sadece engellenen/yasaklanan istekler
  log_level: 'all',

  // Puanlama: bir IP pencere içinde eşiği aşarsa yasaklanır
  score_threshold: 12,
  score_window_seconds: 300,

  // Yasak süreleri
  ban_minutes: 1440,              // ilk yasak: 24 saat
  ban_escalation: true,           // tekrar edende süre katlanır
  bans_before_permanent: 4,       // bu kadar yasaktan sonra kalıcı

  // Hız sınırı (tüm site, IP başına)
  rate_enabled: true,
  rate_window_seconds: 10,
  rate_max_requests: 150,
  rate_score: 6,

  // 404 fırtınası: kısa sürede çok sayıda bulunamayan yol = tarayıcı
  notfound_enabled: true,
  notfound_window_seconds: 60,
  notfound_max: 20,
  notfound_score: 8,

  // ── Ani yük (burst) ve DDoS ────────────────────────────────────────────────
  // Hız sınırı bir IP'nin ortalama hızını ölçer; burst çok kısa penceredeki
  // ani patlamayı yakalar. DDoS katmanı ise sitenin TOPLAM hızını izler: toplam
  // saniye/istek bir eşiği aşarsa "saldırı altında" moduna geçilir ve o süre
  // boyunca IP başına izin verilen hız otomatik olarak sıkılaştırılır.
  ddos_enabled: true,
  burst_window_seconds: 3,
  burst_max_requests: 60,
  burst_score: 10,
  ddos_global_rps: 800,            // saniyedeki toplam istek bunu aşarsa saldırı altı
  ddos_under_attack_ip_rps: 15,    // saldırı altında IP başına saniye üst sınırı
  ddos_under_attack_seconds: 120,  // bir sıçramadan sonra bu kadar süre sıkı kal

  // ── Alt ağ (subnet) davranışı ──────────────────────────────────────────────
  // Ardışık IP'lerden (152.233.12.x, 152.233.13.x) gelen dağıtık denemeyi tek
  // tek IP gibi değil, bir blok olarak değerlendirir. Bir /24 (IPv6'da /64)
  // içinde kısa sürede birden çok farklı IP tetiklerse puanları çarpanla büyür
  // ve eşiği aşan blok topluca yasaklanabilir.
  subnet_enabled: true,
  subnet_window_seconds: 600,
  subnet_distinct_ips: 4,          // pencerede bu kadar farklı IP = blok "sıcak"
  subnet_score_threshold: 40,      // sıcak blok toplam puanı bunu aşarsa blok yasağı
  subnet_multiplier: 2,            // sıcak bloktaki her IP'nin puanı bu kat büyür
  subnet_ban_whole: true,         // eşik aşılınca tek IP yerine tüm /24 (IPv6 /64) yasakla
  subnet_rate_max: 600,            // blok başına penceredeki istek üst sınırı

  // ── Kaba kuvvet (brute force) ───────────────────────────────────────────────
  // Giriş uçları başarısız denemeleri firewall'a bildirir. IP ya da hesap başına
  // başarısız deneme eşiği aşılınca giriş bir süre kilitlenir ve IP yasaklanır.
  bruteforce_enabled: true,
  bruteforce_window_seconds: 900,
  bruteforce_ip_max: 10,           // IP başına penceredeki başarısız giriş
  bruteforce_account_max: 6,       // hesap başına penceredeki başarısız giriş
  bruteforce_score: 6,             // her başarısız denemede eklenen puan
  bruteforce_lock_minutes: 30,     // giriş kilidi süresi
  bruteforce_ban: true,            // eşik aşılınca IP'yi yasakla

  // Kategori anahtarları: her biri açılıp kapatılabilir ve puanı değiştirilebilir
  categories: {},

  // Honeypot: buraya dokunan anında yasaklanır
  honeypot_enabled: true,
  honeypot_paths: ['/wp-login.php', '/wp-admin/', '/phpmyadmin/', '/.env', '/.git/config'],
  // Honeypot güvenceleri — yanlış pozitifleri azaltır:
  //  honeypot_action: ban | block | score  (score = anında yasak yok, sadece puan)
  //  honeypot_ignore_prefetch: prefetch/preload/erişilebilirlik isteklerini yok say
  //  honeypot_grace: >0 ise pencere içinde ilk N dokunuş yalnızca puanlanır
  //  honeypot_fields: gizli form alanı adları (POST gövdesinde doluysa bot sinyali)
  honeypot_action: 'ban',
  honeypot_ignore_prefetch: true,
  honeypot_grace: 0,
  honeypot_grace_window_seconds: 600,
  honeypot_fields: [],

  // Ülke filtresi (Cloudflare cf-ipcountry başlığı gerekir)
  country_mode: 'off',            // off | allow | block
  country_list: [],

  // Statik dosyalar taranmasın (performans)
  skip_static: true,

  // İstek gövdesini tara. VARSAYILAN KAPALI: forum/mesaj gibi yerlerde kullanıcı
  // kod parçacığı yazabilir ve bu yanlış pozitif üretir. Açmadan önce birkaç gün
  // "monitor" modunda izlemek doğru olur.
  inspect_body: false,
  body_scan_limit: 8192,

  // Motorun tamamen atlayacağı yol önekleri (admin paneli, arama vb.)
  skip_paths: [],

  // Log bakımı
  log_retention_days: 30,
  log_max_rows: 100000,

  // Engellenen istekte dönecek yanıt
  block_status: 403,
  block_message: 'Erişim engellendi.'
};

// ─────────────────────────────────────────────────────────────────────────────
// Kategoriler — her biri admin panelinden açılır/kapanır, puanı değiştirilir
// ─────────────────────────────────────────────────────────────────────────────
const CATEGORIES = {
  sensitive_path: { label: 'Hassas dosya taraması', score: 12, severity: 4, action: 'block' },
  traversal:      { label: 'Dizin aşımı', score: 12, severity: 4, action: 'block' },
  sqli:           { label: 'SQL enjeksiyonu', score: 14, severity: 5, action: 'block' },
  xss:            { label: 'XSS denemesi', score: 10, severity: 4, action: 'block' },
  rce:            { label: 'Komut çalıştırma', score: 16, severity: 5, action: 'block' },
  lfi:            { label: 'Yerel/uzak dosya dahil etme', score: 14, severity: 5, action: 'block' },
  jndi:           { label: 'JNDI / Log4Shell', score: 20, severity: 5, action: 'ban' },
  ssti:           { label: 'Şablon enjeksiyonu', score: 12, severity: 4, action: 'block' },
  nosqli:         { label: 'NoSQL enjeksiyonu', score: 10, severity: 4, action: 'block' },
  crlf:           { label: 'CRLF / başlık enjeksiyonu', score: 10, severity: 4, action: 'block' },
  scanner_ua:     { label: 'Tarayıcı aracı (sqlmap, nikto…)', score: 14, severity: 4, action: 'ban' },
  // Kütüphane istemcileri meşru olabilir (mobil uygulama, entegrasyon):
  // varsayılan olarak yalnızca loglanır, engellenmez.
  bad_bot:        { label: 'Şüpheli istemci', score: 2, severity: 2, action: 'log' },
  bad_method:     { label: 'Beklenmeyen HTTP metodu', score: 8, severity: 3, action: 'block' },
  protocol:       { label: 'Protokol anomalisi', score: 10, severity: 4, action: 'block' },
  upload_probe:   { label: 'Web shell / yükleme denemesi', score: 16, severity: 5, action: 'block' },
  honeypot:       { label: 'Honeypot', score: 100, severity: 5, action: 'ban' },
  rate:           { label: 'Hız sınırı', score: 6, severity: 3, action: 'block' },
  notfound:       { label: '404 fırtınası', score: 8, severity: 3, action: 'ban' },
  burst:          { label: 'Ani yük (flood)', score: 10, severity: 4, action: 'block' },
  ddos:           { label: 'DDoS / saldırı altında', score: 12, severity: 5, action: 'block' },
  subnet:         { label: 'Alt ağ saldırısı', score: 20, severity: 4, action: 'ban' },
  bruteforce:     { label: 'Kaba kuvvet (giriş)', score: 6, severity: 4, action: 'block' },
  country:        { label: 'Ülke filtresi', score: 100, severity: 3, action: 'block' },
  custom:         { label: 'Özel kural', score: 10, severity: 3, action: 'block' }
};

// ─────────────────────────────────────────────────────────────────────────────
// Yerleşik kural seti
// target: path | query | body | ua | referer | any  (any = path+query+body)
// ─────────────────────────────────────────────────────────────────────────────
const BUILTIN_RULES = [
  // ── Hassas dosya ve yönetim paneli taramaları ──────────────────────────────
  ['sp-env',        'sensitive_path', 'path', /(^|\/)\.env(\.|$|\/)|(^|\/)\.env\.(local|prod|production|dev|example|backup)/i, 'Ortam değişkeni dosyası'],
  ['sp-git',        'sensitive_path', 'path', /(^|\/)\.git(\/|$)|\/\.git\/(config|HEAD|index|logs)/i, 'Git deposu'],
  ['sp-vcs',        'sensitive_path', 'path', /(^|\/)\.(svn|hg|bzr)(\/|$)/i, 'Sürüm kontrol dizini'],
  ['sp-ssh',        'sensitive_path', 'path', /(^|\/)\.(ssh|aws|azure|gcloud|docker|kube)(\/|$)|id_rsa|\.pem$|known_hosts/i, 'Kimlik/anahtar dosyası'],
  ['sp-wp',         'sensitive_path', 'path', /\/wp-(admin|login|content|includes|json|config)|xmlrpc\.php|wlwmanifest\.xml/i, 'WordPress taraması'],
  ['sp-dbadmin',    'sensitive_path', 'path', /\/(phpmyadmin|pma|myadmin|phpMyAdmin|adminer|dbadmin|mysqlmanager|sqlitemanager)(\/|\.php|$)/i, 'Veritabanı paneli'],
  ['sp-config',     'sensitive_path', 'path', /\/(config|configuration|settings|secrets|credentials)\.(php|json|yml|yaml|xml|ini|bak|old|txt)$/i, 'Yapılandırma dosyası'],
  ['sp-dump',       'sensitive_path', 'path', /\.(sql|sqlite|db|dump|bak|old|swp|save|orig|rar|7z|tar\.gz|tgz)$/i, 'Yedek / veritabanı dökümü'],
  ['sp-server',     'sensitive_path', 'path', /\/(web\.config|\.htaccess|\.htpasswd|server-status|server-info|nginx\.conf|httpd\.conf)(\/|$)/i, 'Sunucu yapılandırması'],
  ['sp-appsec',     'sensitive_path', 'path', /\/(appsettings(\.\w+)?\.json|application\.(properties|yml)|docker-compose\.ya?ml|Dockerfile|Procfile)$/i, 'Uygulama yapılandırması'],
  ['sp-actuator',   'sensitive_path', 'path', /\/(actuator|management)\/(env|health|heapdump|beans|configprops|mappings)/i, 'Spring Actuator'],
  ['sp-laravel',    'sensitive_path', 'path', /\/(_ignition\/execute-solution|telescope\/requests|_debugbar|storage\/logs\/laravel\.log)/i, 'Laravel açığı'],
  ['sp-phpunit',    'sensitive_path', 'path', /vendor\/(phpunit|bin)\/.*eval-stdin\.php|eval-stdin\.php/i, 'PHPUnit RCE'],
  ['sp-cgi',        'sensitive_path', 'path', /\/cgi-bin\/|\.cgi$|\/bin\/sh|shellshock/i, 'CGI / Shellshock'],
  ['sp-ide',        'sensitive_path', 'path', /\/\.(vscode|idea|project|settings)(\/|$)|\.DS_Store$/i, 'Geliştirici dosyası'],
  ['sp-cloudmeta',  'sensitive_path', 'any',  /169\.254\.169\.254|\/latest\/meta-data|metadata\.google\.internal/i, 'Bulut metadata SSRF'],
  ['sp-panel',      'sensitive_path', 'path', /\/(solr|jenkins|grafana|kibana|elasticsearch|rabbitmq|consul|zabbix|nagios)\/(admin|login)/i, 'Üçüncü parti panel'],
  ['sp-struts',     'sensitive_path', 'path', /\.action(\?|$)|\.do(\?|$)|struts/i, 'Struts taraması'],

  // ── Dizin aşımı ────────────────────────────────────────────────────────────
  ['tr-dotdot',     'traversal', 'any', /(\.\.\/|\.\.\\|%2e%2e[\/\\%]|%252e%252e|\.\.%2f|\.\.%5c|\.{4,}[\/\\])/i, 'Dizin aşımı dizisi'],
  ['tr-etc',        'traversal', 'any', /\/etc\/(passwd|shadow|hosts|group)|\/proc\/self\/(environ|cmdline)|\/windows\/win\.ini|boot\.ini/i, 'Sistem dosyası hedefi'],

  // ── SQL enjeksiyonu ────────────────────────────────────────────────────────
  ['sq-union',      'sqli', 'any', /\bunion\s*(all\s*)?select\b/i, 'UNION SELECT'],
  ['sq-tauto',      'sqli', 'any', /(\bor\b|\band\b)\s*['"`]?\s*\d+\s*(=|<>|like)\s*['"`]?\s*\d+/i, 'Her zaman doğru koşul'],
  ['sq-time',       'sqli', 'any', /\b(sleep|benchmark|pg_sleep|waitfor\s+delay|dbms_pipe\.receive_message)\s*\(/i, 'Zaman tabanlı SQLi'],
  ['sq-meta',       'sqli', 'any', /\b(information_schema|pg_catalog|sysobjects|mysql\.user|pg_shadow)\b/i, 'Şema keşfi'],
  ['sq-file',       'sqli', 'any', /\b(load_file|into\s+(out|dump)file|xp_cmdshell|exec\s+master)\b/i, 'SQL üzerinden dosya/komut'],
  ['sq-comment',    'sqli', 'any', /('|%27)\s*(--|#|\/\*)|\/\*!\d+/i, 'SQL yorum kaçışı'],
  ['sq-stack',      'sqli', 'any', /;\s*(drop|alter|truncate|insert|update|delete)\s+(table|from|into|database)\b/i, 'Yığın sorgu'],

  // ── XSS ────────────────────────────────────────────────────────────────────
  ['xs-script',     'xss', 'any', /<\s*script\b|<\s*\/\s*script\s*>|%3cscript/i, 'Script etiketi'],
  ['xs-handler',    'xss', 'any', /\bon(error|load|click|mouseover|focus|animationstart|toggle)\s*=/i, 'Olay işleyici'],
  ['xs-proto',      'xss', 'any', /javascript\s*:|vbscript\s*:|data:text\/html/i, 'Script protokolü'],
  ['xs-tag',        'xss', 'any', /<\s*(iframe|object|embed|svg|img|body|details|marquee)[^>]*\bon\w+\s*=/i, 'Olaylı HTML etiketi'],
  ['xs-sink',       'xss', 'any', /document\.(cookie|domain|write)|window\.(location|name)\s*=|eval\s*\(|atob\s*\(/i, 'Tehlikeli JS çağrısı'],

  // ── Komut çalıştırma ───────────────────────────────────────────────────────
  ['rc-shell',      'rce', 'any', /[;|&`]\s*(cat|ls|id|whoami|uname|pwd|ps|curl|wget|nc|bash|sh|python|perl|ruby|powershell)\b/i, 'Kabuk komutu zinciri'],
  ['rc-subst',      'rce', 'any', /\$\(\s*\w+|`\s*\w+\s*`|\$\{IFS\}/i, 'Komut ikamesi'],
  ['rc-bin',        'rce', 'any', /\/bin\/(ba|z|da)?sh\b|cmd\.exe|powershell\.exe|\/usr\/bin\/env/i, 'Kabuk ikili dosyası'],
  ['rc-revshell',   'rce', 'any', /nc\s+-[a-z]*e|bash\s+-i\s*>&|\/dev\/tcp\/|mkfifo\s/i, 'Ters kabuk'],
  ['rc-encode',     'rce', 'any', /base64\s+-d|echo\s+[A-Za-z0-9+\/=]{40,}\s*\|\s*base64/i, 'Kodlanmış yük'],

  // ── Dosya dahil etme ───────────────────────────────────────────────────────
  ['lf-wrapper',    'lfi', 'any', /(php|data|expect|zip|phar|glob|file)\s*:\s*\/\//i, 'PHP akış sarmalayıcı'],
  ['lf-filter',     'lfi', 'any', /php:\/\/(input|filter)|convert\.base64-encode/i, 'php://filter'],
  ['lf-remote',     'lfi', 'any', /[?&](file|page|include|path|template|doc|document|folder|root|pg|style|lang)=\s*(https?|ftp):\/\//i, 'Uzak dosya dahil etme'],

  // ── JNDI / Log4Shell ───────────────────────────────────────────────────────
  ['jn-jndi',       'jndi', 'any', /\$\{\s*jndi\s*:|\$\{(lower|upper|env|sys|date|java)\s*:/i, 'JNDI arama ifadesi'],

  // ── Şablon enjeksiyonu ─────────────────────────────────────────────────────
  ['st-expr',       'ssti', 'any', /\{\{\s*[\d'"].*[*+].*\}\}|\$\{\s*\d+\s*[*+]\s*\d+\s*\}|<%=.*%>|\{%\s*(import|include|extends)/i, 'Şablon ifadesi'],
  ['st-class',      'ssti', 'any', /__class__|__globals__|__subclasses__|getRuntime\(\)|freemarker\.template/i, 'Nesne grafiği erişimi'],

  // ── NoSQL ──────────────────────────────────────────────────────────────────
  ['nq-op',         'nosqli', 'any', /\[\s*\$(ne|gt|lt|gte|lte|in|nin|regex|where|exists)\s*\]|"\$where"\s*:|\{\s*"\$ne"/i, 'Mongo operatörü'],

  // ── CRLF ve protokol ───────────────────────────────────────────────────────
  ['cr-inject',     'crlf', 'any', /%0d%0a|%0a%0d|\r\n(set-cookie|location|content-length)\s*:/i, 'Başlık enjeksiyonu'],
  ['pr-nullbyte',   'protocol', 'any', /%00|\u0000/i, 'Null bayt'],
  ['pr-absuri',     'protocol', 'path', /^https?:\/\//i, 'Mutlak URI ile vekil denemesi'],
  ['pr-overlong',   'protocol', 'path', /%c0%ae|%e0%80%ae|%uff0e/i, 'Aşırı uzun unicode kodlaması'],

  // ── Web shell / yükleme ────────────────────────────────────────────────────
  ['up-shell',      'upload_probe', 'path', /\/(shell|c99|r57|wso|b374k|alfa|indoxploit|mini|cmd|up|upload|backdoor)\.(php\d?|phtml|asp|aspx|jsp|jspx)$/i, 'Bilinen web shell adı'],
  ['up-ext',        'upload_probe', 'path', /\.(php\d?|phtml|phar|asp|aspx|jsp|jspx|cfm|pl|py|sh|exe|dll)(\?|$)/i, 'Çalıştırılabilir uzantı'],

  // ── Tarama araçları ────────────────────────────────────────────────────────
  ['ua-scanner',    'scanner_ua', 'ua', /(sqlmap|nikto|nmap|masscan|zgrab|nuclei|acunetix|netsparker|wpscan|joomscan|dirbuster|dirsearch|gobuster|feroxbuster|ffuf|wfuzz|hydra|havij|openvas|qualys|arachni|w3af|skipfish|metasploit|zmeu|morfeus|xmrig)/i, 'Bilinen tarama aracı'],
  ['ua-lib',        'bad_bot', 'ua', /(python-requests|python-urllib|go-http-client|libwww-perl|java\/\d|okhttp|axios\/|node-fetch|guzzlehttp|scrapy|httpclient|winhttp|curl\/|wget\/)/i, 'Otomatik istemci kütüphanesi'],
  ['ua-empty',      'bad_bot', 'ua', /^$/, 'User-Agent yok']
];

// ─────────────────────────────────────────────────────────────────────────────
// Yardımcılar
// ─────────────────────────────────────────────────────────────────────────────
const STATIC_EXT = /\.(css|js|mjs|map|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|eot|mp4|webm|mp3|m4a|wav|ogg|pdf)$/i;
const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;

function normalizeIp(value) {
  return String(value || '').replace(/^::ffff:/i, '').trim().slice(0, 64);
}

// Bir IP'nin ait olduğu alt ağı döndürür:
//   key    → bellek içi sayaç anahtarı (ör. "152.233.13." ya da "2a01:4f8:1c:...:")
//   cidr   → yasak kaydında saklanacak okunur blok (ör. "152.233.13.0/24")
//   prefix → yasak eşleşmesi için IP önekiyle karşılaştırılacak dize
// IPv4'te /24, IPv6'da ilk 4 grup (/64) kullanılır. Eşleştirilemezse null.
function subnetOf(ip) {
  const value = normalizeIp(ip).toLowerCase();
  if (IPV4_RE.test(value)) {
    const octets = value.split('.');
    if (octets.length === 4 && octets.every(o => Number(o) >= 0 && Number(o) <= 255)) {
      const prefix = `${octets[0]}.${octets[1]}.${octets[2]}.`;
      return { key: `v4:${prefix}`, cidr: `${prefix}0/24`, prefix };
    }
    return null;
  }
  if (value.includes(':')) {
    // IPv6 — ilk 4 hextet'i al (/64). "::" kısaltmasını güvenle çözmeye çalışma;
    // önek yeterli ayrımı sağlar.
    const head = value.split('::')[0];
    const groups = head.split(':').filter(Boolean).slice(0, 4);
    if (groups.length) {
      const prefix = groups.join(':') + ':';
      return { key: `v6:${prefix}`, cidr: `${groups.join(':')}::/64`, prefix };
    }
  }
  return null;
}

// Bir CIDR/blok yasak kaydı (ör. "152.233.13.0/24" veya "152.233.13.*") verilen
// IP'yi kapsıyor mu? Kapsıyorsa eşleşme öneki döner, yoksa null.
function cidrPrefix(entry) {
  const value = String(entry || '').trim().toLowerCase();
  if (value.endsWith('.0/24') || value.endsWith('.*')) {
    return value.replace(/\.0\/24$/, '.').replace(/\.\*$/, '.');
  }
  if (value.endsWith('::/64')) {
    return value.replace(/::\/64$/, ':');
  }
  if (value.includes('/')) {
    // Diğer CIDR'ler için kaba önek: ağ kısmının son sıfır grubunu kırp.
    return value.split('/')[0].replace(/(\.|:)0+$/, '$1');
  }
  return null;
}

// Prefetch / preload / erişilebilirlik isteği mi? Tarayıcı eklentileri ve ön
// yükleyiciler kullanıcı hiç tıklamadan honeypot bağlantısına gidebilir; bu
// isteklerde honeypot'u tetiklemek yanlış pozitif üretir.
function looksLikePrefetch(req) {
  const get = name => String(req.get?.(name) || '').toLowerCase();
  const purpose = get('sec-purpose') || get('purpose') || get('x-purpose') || get('x-moz');
  if (/prefetch|preload|prerender/.test(purpose)) return true;
  if (get('x-moz') === 'prefetch') return true;
  // Tarayıcıların güvenli/ön-getirme sinyalleri
  const secFetch = get('sec-fetch-mode');
  if (get('x-requested-with') === 'preload') return true;
  return false;
}

function safeDecode(value) {
  const raw = String(value || '');
  let current = raw;
  // Çok katmanlı kodlamayı aç; saldırganlar %252e gibi ikinci kat kullanır.
  for (let pass = 0; pass < 3; pass++) {
    let decoded;
    try { decoded = decodeURIComponent(current); } catch { break; }
    if (decoded === current) break;
    current = decoded;
  }
  return current;
}

function compileRule(entry) {
  if (Array.isArray(entry)) {
    const [id, category, target, pattern, label] = entry;
    return { id, category, target, regex: pattern, label, builtin: true, enabled: true };
  }
  // Veritabanından gelen özel kural
  let regex = null;
  try { regex = new RegExp(entry.pattern, entry.flags || 'i'); } catch { return null; }
  return {
    id: `custom-${entry.id}`,
    dbId: entry.id,
    category: entry.category && CATEGORIES[entry.category] ? entry.category : 'custom',
    target: ['path', 'query', 'body', 'ua', 'referer', 'any'].includes(entry.target) ? entry.target : 'any',
    regex,
    label: entry.label || 'Özel kural',
    builtin: false,
    enabled: entry.enabled !== false && entry.enabled !== 0,
    scoreOverride: Number.isFinite(Number(entry.score)) && Number(entry.score) > 0 ? Number(entry.score) : null,
    actionOverride: ['log', 'block', 'ban'].includes(entry.action) ? entry.action : null
  };
}

// Kayan pencere sayacı: IP başına zaman damgası listesi, pencere dışı atılır.
class SlidingWindow {
  constructor(maxKeys = 20000) {
    this.map = new Map();
    this.maxKeys = maxKeys;
  }
  hit(key, windowMs, now) {
    let stamps = this.map.get(key);
    if (!stamps) {
      if (this.map.size >= this.maxKeys) this.prune(now, windowMs);
      stamps = [];
      this.map.set(key, stamps);
    }
    const cutoff = now - windowMs;
    while (stamps.length && stamps[0] < cutoff) stamps.shift();
    stamps.push(now);
    return stamps.length;
  }
  prune(now, windowMs) {
    const cutoff = now - windowMs;
    for (const [key, stamps] of this.map) {
      while (stamps.length && stamps[0] < cutoff) stamps.shift();
      if (!stamps.length) this.map.delete(key);
    }
  }
  clear() { this.map.clear(); }
}

// IP başına puan biriktirici
class ScoreBook {
  constructor() { this.map = new Map(); }
  add(ip, points, windowMs, now) {
    let entry = this.map.get(ip);
    if (!entry || now - entry.start > windowMs) {
      entry = { start: now, total: 0, hits: 0 };
      this.map.set(ip, entry);
    }
    entry.total += points;
    entry.hits += 1;
    entry.last = now;
    return entry.total;
  }
  get(ip) { return this.map.get(ip)?.total || 0; }
  reset(ip) { this.map.delete(ip); }
  prune(now, windowMs) {
    for (const [ip, entry] of this.map) {
      if (now - entry.start > windowMs * 2) this.map.delete(ip);
    }
  }
  clear() { this.map.clear(); }
}

// =============================================================================
// Fabrika
// =============================================================================
function createFirewall({ query, getIp, getClientInfo, onBan, isExempt } = {}) {
  if (typeof query !== 'function') throw new Error('firewall: query gerekli');

  const state = {
    config: { ...DEFAULT_CONFIG, categories: {} },
    rules: BUILTIN_RULES.map(compileRule),
    customRules: [],
    bans: new Map(),        // ip -> { id, expiresAt (ms|null), reason, permanent }
    banPrefixes: [],        // [{ prefix, ban }] — blok/CIDR yasakları
    allowlist: new Set(),
    allowPrefixes: [],      // "1.2.3." gibi önek eşleşmeleri
    loadedAt: 0,
    ready: false,
    underAttackUntil: 0     // bu zamana kadar "saldırı altında" sıkı mod
  };

  const rate = new SlidingWindow();
  const notFound = new SlidingWindow();
  const burst = new SlidingWindow();          // çok kısa pencere — ani yük
  const attackRate = new SlidingWindow();     // saldırı altında IP başına sn hızı
  const subnetRate = new SlidingWindow();     // blok başına istek hızı
  const scores = new ScoreBook();
  const subnetScores = new ScoreBook();       // blok başına puan
  const subnetMembers = new Map();            // subnetKey -> Map(ip -> lastTs)
  const authFailIp = new SlidingWindow();     // IP başına başarısız giriş
  const authFailAccount = new SlidingWindow(); // hesap başına başarısız giriş
  const loginLocks = new Map();               // "ip:x" / "acct:x" -> kilit bitişi (ms)
  const banNoticeThrottle = new Map(); // yasaklı IP'nin logunu saniyede bir kez yaz

  // Genel istek hızı (DDoS tespiti): son birkaç saniyenin saniyelik kovaları
  const globalBuckets = new Map(); // saniye epoch -> sayaç

  const stats = {
    inspected: 0, matched: 0, blocked: 0, banned: 0,
    queued: 0, written: 0, dropped: 0, lastError: ''
  };

  // ── Olay yazma kuyruğu ─────────────────────────────────────────────────────
  // İstek döngüsü asla veritabanını beklemez.
  const queue = [];
  const QUEUE_MAX = 5000;
  let flushing = false;
  let flushTimer = null;

  function enqueue(event) {
    if (queue.length >= QUEUE_MAX) { stats.dropped++; return; }
    queue.push(event);
    stats.queued++;
    if (!flushTimer) flushTimer = setTimeout(flush, 400);
  }

  async function flush() {
    flushTimer = null;
    if (flushing || !queue.length) return;
    flushing = true;
    const batch = queue.splice(0, 200);
    try {
      const columns = 20;
      const values = [];
      const placeholders = batch.map((event, index) => {
        const base = index * columns;
        values.push(
          event.ip, event.method, event.path, event.query_string, event.host,
          event.referer, event.user_agent, event.rule_id, event.rule_label, event.category,
          event.severity, event.score, event.action, event.matched, event.country,
          event.city, event.device, event.operating_system, event.actor, event.detail
        );
        return `(${Array.from({ length: columns }, (_, c) => `$${base + c + 1}`).join(',')})`;
      }).join(',');
      await query(
        `INSERT INTO firewall_events
          (ip,method,path,query_string,host,referer,user_agent,rule_id,rule_label,category,
           severity,score,action,matched,country,city,device,operating_system,actor,detail)
         VALUES ${placeholders}`,
        values
      );
      stats.written += batch.length;
    } catch (error) {
      stats.lastError = error.message;
      console.error('[firewall] Olay yazılamadı:', error.message);
    } finally {
      flushing = false;
      if (queue.length) flushTimer = setTimeout(flush, 200);
    }
  }

  // ── Yapılandırma / kural / yasak yükleme ───────────────────────────────────
  async function reload() {
    try {
      const { rows } = await query("SELECT value FROM settings WHERE key=$1", [FIREWALL_SETTING_KEY]);
      let stored = {};
      if (rows.length) { try { stored = JSON.parse(rows[0].value) || {}; } catch {} }
      const categories = {};
      for (const [key, meta] of Object.entries(CATEGORIES)) {
        const override = stored.categories?.[key] || {};
        categories[key] = {
          label: meta.label,
          enabled: override.enabled !== false,
          score: Number.isFinite(Number(override.score)) ? Math.max(0, Number(override.score)) : meta.score,
          severity: meta.severity,
          action: ['log', 'block', 'ban'].includes(override.action) ? override.action : (meta.action || 'block')
        };
      }
      state.config = { ...DEFAULT_CONFIG, ...stored, categories };
      if (!Array.isArray(state.config.honeypot_paths)) state.config.honeypot_paths = DEFAULT_CONFIG.honeypot_paths;
      if (!Array.isArray(state.config.country_list)) state.config.country_list = [];
      if (!Array.isArray(state.config.skip_paths)) state.config.skip_paths = [];
    } catch (error) {
      console.error('[firewall] Ayarlar okunamadı:', error.message);
    }

    try {
      const { rows } = await query('SELECT * FROM firewall_rules ORDER BY id');
      state.customRules = rows.map(compileRule).filter(Boolean);
      state.rules = BUILTIN_RULES.map(compileRule).concat(state.customRules);
    } catch (error) {
      console.error('[firewall] Özel kurallar okunamadı:', error.message);
    }

    await refreshBans();
    await refreshAllowlist();
    state.loadedAt = Date.now();
    state.ready = true;
  }

  async function refreshBans() {
    try {
      const { rows } = await query(
        "SELECT id, ip, reason, permanent, expires_at FROM firewall_bans WHERE active=TRUE AND (permanent=TRUE OR expires_at > NOW())"
      );
      const next = new Map();
      const prefixes = [];
      for (const row of rows) {
        const rawIp = String(row.ip || '').trim();
        const entry = {
          id: row.id,
          reason: row.reason || '',
          permanent: Boolean(row.permanent),
          expiresAt: row.expires_at ? new Date(row.expires_at).getTime() : null
        };
        const prefix = cidrPrefix(rawIp);
        if (prefix) {
          prefixes.push({ prefix, ban: { ...entry, cidr: rawIp } });
        } else {
          next.set(normalizeIp(rawIp), entry);
        }
      }
      state.bans = next;
      state.banPrefixes = prefixes;
    } catch (error) {
      console.error('[firewall] Yasak listesi okunamadı:', error.message);
    }
  }

  async function refreshAllowlist() {
    try {
      const { rows } = await query('SELECT ip FROM firewall_allowlist');
      const exact = new Set();
      const prefixes = [];
      for (const row of rows) {
        const value = normalizeIp(row.ip);
        if (!value) continue;
        if (value.endsWith('*')) prefixes.push(value.slice(0, -1));
        else if (value.includes('/')) prefixes.push(value.split('/')[0].replace(/\.\d+$/, '.'));
        else exact.add(value);
      }
      state.allowlist = exact;
      state.allowPrefixes = prefixes;
    } catch (error) {
      console.error('[firewall] İzin listesi okunamadı:', error.message);
    }
  }

  function isAllowed(ip) {
    if (state.allowlist.has(ip)) return true;
    for (const prefix of state.allowPrefixes) {
      if (prefix && ip.startsWith(prefix)) return true;
    }
    return false;
  }

  function activeBan(ip, now) {
    const ban = state.bans.get(ip);
    if (ban) {
      if (!ban.permanent && ban.expiresAt && ban.expiresAt <= now) {
        state.bans.delete(ip);
      } else {
        return ban;
      }
    }
    // Blok / CIDR yasakları: IP bir yasaklı alt ağın içinde mi?
    if (state.banPrefixes.length) {
      for (const item of state.banPrefixes) {
        if (!item.prefix || !ip.startsWith(item.prefix)) continue;
        const sub = item.ban;
        if (!sub.permanent && sub.expiresAt && sub.expiresAt <= now) continue;
        return sub;
      }
    }
    return null;
  }

  // ── Yasaklama ──────────────────────────────────────────────────────────────
  async function banIp(ip, { reason, category, score, createdBy = 'auto', minutes, permanent = false } = {}) {
    const address = normalizeIp(ip);
    if (!address || isAllowed(address)) return null;
    const asPrefix = cidrPrefix(address); // blok (CIDR) yasağı mı?
    const config = state.config;
    let priorCount = 0;
    try {
      const { rows } = await query('SELECT COUNT(*)::int AS total FROM firewall_bans WHERE ip=$1', [address]);
      priorCount = rows[0]?.total || 0;
    } catch {}

    let isPermanent = permanent;
    let durationMinutes = Number.isFinite(Number(minutes)) ? Number(minutes) : config.ban_minutes;
    if (!isPermanent && config.ban_escalation) {
      durationMinutes = durationMinutes * Math.pow(2, Math.min(priorCount, 6));
      if (config.bans_before_permanent > 0 && priorCount + 1 >= config.bans_before_permanent) isPermanent = true;
    }
    const expiresAt = isPermanent ? null : new Date(Date.now() + durationMinutes * 60000);

    try {
      const { rows } = await query(
        `INSERT INTO firewall_bans (ip, reason, category, score, permanent, expires_at, created_by, hit_count, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,1,TRUE)
         ON CONFLICT (ip) WHERE active
         DO UPDATE SET reason=EXCLUDED.reason, category=EXCLUDED.category, score=EXCLUDED.score,
                       permanent=firewall_bans.permanent OR EXCLUDED.permanent,
                       expires_at=EXCLUDED.expires_at, hit_count=firewall_bans.hit_count+1,
                       created_at=NOW()
         RETURNING id, permanent, expires_at`,
        [address, String(reason || '').slice(0, 300), String(category || '').slice(0, 64), Math.round(score || 0), isPermanent, expiresAt, String(createdBy).slice(0, 64)]
      );
      const row = rows[0];
      const memEntry = {
        id: row?.id,
        reason: String(reason || ''),
        permanent: Boolean(row?.permanent ?? isPermanent),
        expiresAt: row?.expires_at ? new Date(row.expires_at).getTime() : (expiresAt ? expiresAt.getTime() : null)
      };
      if (asPrefix) {
        // Aynı bloğun eski kaydını değiştirip yenisini ekle
        state.banPrefixes = state.banPrefixes.filter(item => item.prefix !== asPrefix);
        state.banPrefixes.push({ prefix: asPrefix, ban: { ...memEntry, cidr: address } });
        subnetScores.reset(`v4:${asPrefix}`);
        subnetScores.reset(`v6:${asPrefix}`);
      } else {
        state.bans.set(address, memEntry);
      }
      scores.reset(address);
      stats.banned++;
      if (typeof onBan === 'function') {
        try { onBan({ ip: address, reason, category, permanent: isPermanent, expiresAt }); } catch {}
      }
      return state.bans.get(address);
    } catch (error) {
      console.error('[firewall] Yasak eklenemedi:', error.message);
      return null;
    }
  }

  async function unbanIp(ip) {
    const address = normalizeIp(ip);
    state.bans.delete(address);
    const asPrefix = cidrPrefix(address);
    if (asPrefix) state.banPrefixes = state.banPrefixes.filter(item => item.prefix !== asPrefix);
    scores.reset(address);
    try {
      await query('UPDATE firewall_bans SET active=FALSE, released_at=NOW() WHERE ip=$1 AND active=TRUE', [address]);
      return true;
    } catch (error) {
      console.error('[firewall] Yasak kaldırılamadı:', error.message);
      return false;
    }
  }

  // ── Alt ağ (subnet) takibi ─────────────────────────────────────────────────
  // Bir bloğun pencere içindeki farklı IP sayısını sayar; ardışık IP'lerden
  // gelen dağıtık saldırıyı görünür kılar.
  function subnetTrackIp(key, ip, now, windowMs) {
    let members = subnetMembers.get(key);
    if (!members) { members = new Map(); subnetMembers.set(key, members); }
    members.set(ip, now);
    const cutoff = now - windowMs;
    for (const [addr, ts] of members) if (ts < cutoff) members.delete(addr);
    return members.size;
  }

  // ── DDoS: genel istek hızı ──────────────────────────────────────────────────
  function recordGlobalRequest(now) {
    const sec = Math.floor(now / 1000);
    globalBuckets.set(sec, (globalBuckets.get(sec) || 0) + 1);
    // Son 3 saniyenin dışını at
    for (const bucket of globalBuckets.keys()) if (bucket < sec - 3) globalBuckets.delete(bucket);
  }
  function currentRps(now) {
    const sec = Math.floor(now / 1000);
    // Bir önceki tam saniyenin sayısı en kararlı ölçüdür
    return globalBuckets.get(sec - 1) || globalBuckets.get(sec) || 0;
  }

  // ── Kaba kuvvet (brute force) ───────────────────────────────────────────────
  // server.js giriş uçlarından çağrılır. Her başarısız denemeyi IP ve hesap
  // bazında sayar; eşik aşılınca girişi kilitler ve (ayarlıysa) IP'yi yasaklar.
  function loginBlocked(ip, account) {
    const config = state.config;
    if (!config.bruteforce_enabled) return null;
    const now = Date.now();
    const address = normalizeIp(ip);
    const ipLock = loginLocks.get(`ip:${address}`);
    if (ipLock && ipLock > now) return { scope: 'ip', until: ipLock };
    const acct = String(account || '').trim().toLowerCase();
    if (acct) {
      const acctLock = loginLocks.get(`acct:${acct}`);
      if (acctLock && acctLock > now) return { scope: 'account', until: acctLock };
    }
    return null;
  }

  function registerAuthFailure(ip, account, req) {
    const config = state.config;
    if (!config.bruteforce_enabled) return { locked: false };
    const now = Date.now();
    const address = normalizeIp(ip);
    const acct = String(account || '').trim().toLowerCase().slice(0, 190);
    const windowMs = config.bruteforce_window_seconds * 1000;
    const ipCount = authFailIp.hit(`${address}`, windowMs, now);
    const acctCount = acct ? authFailAccount.hit(acct, windowMs, now) : 0;

    // Her başarısız deneme puan da ekler (diğer kurallarla birikir)
    const subject = { method: req?.method || 'POST', path: req?.path || '/login' };
    const overIp = ipCount >= config.bruteforce_ip_max;
    const overAcct = acct && acctCount >= config.bruteforce_account_max;
    let locked = false;

    if (overIp || overAcct) {
      const lockMs = config.bruteforce_lock_minutes * 60000;
      if (overIp) loginLocks.set(`ip:${address}`, now + lockMs);
      if (overAcct) loginLocks.set(`acct:${acct}`, now + lockMs);
      locked = true;
      const label = overIp
        ? `Kaba kuvvet: ${ipCount} başarısız giriş (IP)`
        : `Kaba kuvvet: ${acctCount} başarısız giriş (@${acct})`;
      if (req) {
        writeEvent(req, address, {
          ruleId: 'bruteforce', label, category: 'bruteforce',
          severity: 4, score: config.bruteforce_score, action: 'blocked', matched: String(overIp ? ipCount : acctCount)
        }, `Hesap: ${acct || '—'}`);
      }
      if (overIp && config.bruteforce_ban) {
        banIp(address, { reason: label, category: 'bruteforce', score: config.bruteforce_score * ipCount }).catch(() => {});
      }
    } else {
      // Eşik altı: sadece puanla, birikimi score defterine ekle
      scores.add(address, config.bruteforce_score, config.score_window_seconds * 1000, now);
      if (req) {
        writeEvent(req, address, {
          ruleId: 'bruteforce-try', label: `Başarısız giriş denemesi (${ipCount})`, category: 'bruteforce',
          severity: 2, score: config.bruteforce_score, action: 'log', matched: String(ipCount)
        }, `Hesap: ${acct || '—'}`);
      }
    }
    return { locked, ipCount, acctCount };
  }

  function registerAuthSuccess(ip, account) {
    const address = normalizeIp(ip);
    authFailIp.map.delete(`${address}`);
    loginLocks.delete(`ip:${address}`);
    const acct = String(account || '').trim().toLowerCase();
    if (acct) {
      authFailAccount.map.delete(acct);
      loginLocks.delete(`acct:${acct}`);
    }
  }

  // ── Kural motoru ───────────────────────────────────────────────────────────
  // Saf fonksiyon: aynı girdi için aynı sonucu verir, bu yüzden admin panelindeki
  // "kural testi" de birebir aynı yolu kullanır.
  function evaluate({ method, path: reqPath, queryString, body, userAgent, referer }) {
    const config = state.config;
    const decodedPath = safeDecode(reqPath);
    const decodedQuery = safeDecode(queryString || '');
    const bodyText = config.inspect_body && body ? String(body).slice(0, config.body_scan_limit) : '';
    const anyText = `${decodedPath}?${decodedQuery} ${bodyText}`;
    const hits = [];

    for (const rule of state.rules) {
      if (!rule || !rule.enabled) continue;
      const category = config.categories[rule.category];
      if (category && category.enabled === false) continue;
      let subject;
      switch (rule.target) {
        case 'path': subject = decodedPath; break;
        case 'query': subject = decodedQuery; break;
        case 'body': subject = bodyText; break;
        case 'ua': subject = userAgent || ''; break;
        case 'referer': subject = referer || ''; break;
        default: subject = anyText;
      }
      if (subject === undefined || subject === null) continue;
      const match = rule.regex.exec(subject);
      if (!match) continue;
      hits.push({
        ruleId: rule.id,
        label: rule.label,
        category: rule.category,
        severity: category?.severity ?? CATEGORIES[rule.category]?.severity ?? 3,
        score: rule.scoreOverride ?? category?.score ?? CATEGORIES[rule.category]?.score ?? 5,
        action: rule.actionOverride ?? category?.action ?? 'block',
        matched: String(match[0]).slice(0, 180)
      });
    }

    if (!ALLOWED_METHODS.has(method)) {
      const category = config.categories.bad_method;
      if (!category || category.enabled !== false) {
        hits.push({
          ruleId: 'mt-unknown', label: `Beklenmeyen metot: ${method}`, category: 'bad_method',
          severity: 3, score: category?.score ?? CATEGORIES.bad_method.score,
          action: category?.action ?? 'block', matched: method
        });
      }
    }
    return hits;
  }

  // ── Ana middleware ─────────────────────────────────────────────────────────
  function middleware(req, res, next) {
    const config = state.config;
    if (!state.ready || !config.enabled || config.mode === 'off') return next();

    // Yönetim paneli her zaman muaftır: yöneticinin kendi IP'sinin yanlışlıkla
    // yasaklanıp panele erişimini kaybetmesi, duvarın engelleyebileceği her
    // şeyden daha kötü bir sonuçtur. Bu yollar zaten admin oturumu ister.
    if (typeof isExempt === 'function') {
      try { if (isExempt(req)) return next(); } catch {}
    }

    const ip = normalizeIp(typeof getIp === 'function' ? getIp(req) : req.ip);
    if (!ip) return next();
    if (isAllowed(ip)) return next();

    const now = Date.now();
    const reqPath = req.path || '/';
    const enforcing = config.mode === 'block';

    // 1) Zaten yasaklı mı?
    const ban = activeBan(ip, now);
    if (ban) {
      const lastNotice = banNoticeThrottle.get(ip) || 0;
      if (now - lastNotice > 2000) {
        banNoticeThrottle.set(ip, now);
        writeEvent(req, ip, {
          ruleId: 'ban-active', label: 'Yasaklı IP isteği', category: 'honeypot',
          severity: 5, score: 0, action: 'blocked', matched: ban.reason || 'yasaklı'
        }, 'Yasak sürüyor');
      }
      if (!enforcing) return next();
      return deny(req, res, config);
    }

    // 2) Statik dosyalar ve admin tarafından muaf tutulan yollar taranmasın
    if (config.skip_static && STATIC_EXT.test(reqPath)) return next();
    if (config.skip_paths.length) {
      const lowered = reqPath.toLowerCase();
      for (const entry of config.skip_paths) {
        const prefix = String(entry || '').toLowerCase().trim();
        if (prefix && lowered.startsWith(prefix)) return next();
      }
    }

    stats.inspected++;

    // 3) Ülke filtresi
    const country = String(req.get?.('cf-ipcountry') || '').toUpperCase().trim();
    if (config.country_mode !== 'off' && country && country !== 'XX') {
      const listed = config.country_list.includes(country);
      const blockedByCountry = config.country_mode === 'block' ? listed : !listed;
      if (blockedByCountry) {
        const hit = {
          ruleId: 'geo-filter', label: `Ülke filtresi: ${country}`, category: 'country',
          severity: 3, score: 0, action: 'block', matched: country
        };
        writeEvent(req, ip, { ...hit, action: enforcing ? 'blocked' : 'monitor' }, 'Ülke kuralı');
        if (enforcing) return deny(req, res, config);
        return next();
      }
    }

    // 4) Honeypot — güvencelerle
    let honeypotHit = null; // 'score' modunda puanlama hattına katılır
    // GÜVENCE 1 (yanlış pozitif): prefetch/preload/erişilebilirlik istekleri
    //   honeypot'u tetiklemez; tarayıcı eklentisi veya ön yükleyici yüzünden
    //   masum ziyaretçi yasaklanmasın.
    // GÜVENCE 2: honeypot_action ile sonuç seçilir (ban / block / sadece puan).
    // GÜVENCE 3: honeypot_grace>0 ise bloktaki ilk N dokunuş yalnız puanlanır.
    const prefetch = config.honeypot_ignore_prefetch && looksLikePrefetch(req);
    if (config.honeypot_enabled && !prefetch) {
      const lowered = reqPath.toLowerCase();
      // Hem tam yol hem de gizli form alanı tuzağı
      let trap = config.honeypot_paths.find(entry => {
        const value = String(entry || '').toLowerCase().trim();
        return value && (lowered === value || lowered.startsWith(value));
      });
      // Gizli form alanı: POST gövdesinde tanımlı tuzak alan doluysa = bot
      if (!trap && Array.isArray(config.honeypot_fields) && config.honeypot_fields.length
          && req.body && typeof req.body === 'object') {
        const filled = config.honeypot_fields.find(name => {
          const key = String(name || '').trim();
          return key && req.body[key] != null && String(req.body[key]).trim() !== '';
        });
        if (filled) trap = `form:${filled}`;
      }
      if (trap) {
        // Honeypot puanı admin panelinden ayarlanabilir (kategori puanı).
        const hpScore = Number.isFinite(Number(config.categories?.honeypot?.score))
          ? Number(config.categories.honeypot.score) : CATEGORIES.honeypot.score;
        const graceWindow = (config.honeypot_grace_window_seconds || 600) * 1000;
        const touches = config.honeypot_grace > 0 ? rate.hit(`hp:${ip}`, graceWindow, now) : 999;
        const inGrace = config.honeypot_grace > 0 && touches <= config.honeypot_grace;
        // Tolerans içinde: yalnızca yumuşak puan (tek dokunuş tek başına eşiği
        // aşmasın ki masum ziyaretçi ilk kazada yasaklanmasın).
        const mode = inGrace ? 'grace' : (config.honeypot_action || 'ban');
        const doBan = enforcing && mode === 'ban';
        const doBlock = enforcing && (mode === 'ban' || mode === 'block');
        const hit = {
          ruleId: 'honeypot', label: `Honeypot: ${trap}`, category: 'honeypot',
          severity: 5, score: hpScore,
          action: !enforcing ? 'monitor' : (doBan ? 'banned' : doBlock ? 'blocked' : 'log'),
          matched: trap
        };
        writeEvent(req, ip, hit, inGrace ? `Honeypot (tolerans ${touches}/${config.honeypot_grace})` : 'Honeypot tetiklendi');
        if (doBan) {
          banIp(ip, { reason: `Honeypot: ${trap}`, category: 'honeypot', score: hpScore }).catch(() => {});
        }
        if (doBlock) return deny(req, res, config);
        if (mode === 'grace') {
          // Eşiğin yaklaşık dörtte biri kadar yumuşak puan; birikir ama ilk
          // dokunuş küçük başka sinyallerle birleşse bile masumu yasaklamaz.
          const soft = Math.max(1, Math.min(hpScore, Math.ceil(config.score_threshold / 4)));
          scores.add(ip, soft, config.score_window_seconds * 1000, now);
          // honeypot'tan sonra isteğin kalan motoruna devam (başka sinyal varsa birikir)
        } else if (mode === 'score') {
          // Puan modu: honeypot puanını normal pencere puanlamasına ekle; eşiği
          // aşarsa standart yolla yasaklanır. Burada erken dönme; honeypotHit
          // aşağıda hits'e katılır.
          honeypotHit = hit;
        } else {
          // ban/block dışı beklenmeyen değerlerde güvenli taraf: engelleme
          return next();
        }
      }
    }

    // 5) DDoS / ani yük (burst) ve "saldırı altında" modu
    let floodHit = null;
    if (config.ddos_enabled) {
      recordGlobalRequest(now);
      // Genel hız sıçraması: toplam RPS eşiği aşarsa sıkı moda geç
      if (config.ddos_global_rps > 0 && currentRps(now) > config.ddos_global_rps) {
        state.underAttackUntil = now + (config.ddos_under_attack_seconds || 120) * 1000;
      }
      const underAttack = now < state.underAttackUntil;
      if (underAttack && config.ddos_under_attack_ip_rps > 0) {
        const perSec = attackRate.hit(ip, 1000, now);
        if (perSec > config.ddos_under_attack_ip_rps) {
          floodHit = {
            ruleId: 'ddos-shield', label: `Saldırı altında: IP hızı aşıldı (${perSec}/sn)`,
            category: 'ddos', severity: 5, score: CATEGORIES.ddos.score, action: 'block', matched: String(perSec)
          };
        }
      }
      // Çok kısa penceredeki ani patlama (tek IP flood)
      if (!floodHit && config.burst_max_requests > 0) {
        const burstCount = burst.hit(ip, config.burst_window_seconds * 1000, now);
        if (burstCount > config.burst_max_requests) {
          floodHit = {
            ruleId: 'burst', label: `Ani yük (${burstCount}/${config.burst_window_seconds}sn)`,
            category: 'burst', severity: 4, score: config.burst_score, action: 'block', matched: String(burstCount)
          };
        }
      }
    }

    // 6) Hız sınırı
    let rateHit = null;
    if (config.rate_enabled) {
      const count = rate.hit(ip, config.rate_window_seconds * 1000, now);
      if (count > config.rate_max_requests) {
        rateHit = {
          ruleId: 'rate-limit', label: `Hız sınırı aşıldı (${count}/${config.rate_window_seconds}sn)`,
          category: 'rate', severity: 3, score: config.rate_score, action: 'block', matched: String(count)
        };
      }
    }

    // 6) Kural motoru
    let bodyText = '';
    if (config.inspect_body && req.body && typeof req.body === 'object') {
      try { bodyText = JSON.stringify(req.body).slice(0, config.body_scan_limit); } catch {}
    }
    const hits = evaluate({
      method: req.method,
      path: reqPath,
      queryString: req.originalUrl?.split('?')[1] || '',
      body: bodyText,
      userAgent: String(req.get?.('user-agent') || ''),
      referer: String(req.get?.('referer') || '')
    });
    if (rateHit) hits.push(rateHit);
    if (floodHit) hits.push(floodHit);
    if (honeypotHit) hits.push(honeypotHit);

    // 7) 404 fırtınası — yanıt bittiğinde ölç
    if (config.notfound_enabled) {
      res.on('finish', () => {
        if (res.statusCode !== 404) return;
        const count = notFound.hit(ip, config.notfound_window_seconds * 1000, Date.now());
        if (count <= config.notfound_max) return;
        const hit = {
          ruleId: 'notfound-storm', label: `404 fırtınası (${count} istek)`, category: 'notfound',
          severity: 3, score: config.notfound_score, action: 'ban', matched: String(count)
        };
        writeEvent(req, ip, { ...hit, action: enforcing ? 'banned' : 'monitor' }, '404 taraması');
        if (enforcing) banIp(ip, { reason: hit.label, category: 'notfound', score: hit.score }).catch(() => {});
      });
    }

    if (!hits.length) return next();
    stats.matched++;

    // 8) Puanla
    const totalPoints = hits.reduce((sum, hit) => sum + (hit.score || 0), 0);
    const windowTotal = scores.add(ip, totalPoints, config.score_window_seconds * 1000, now);
    const worst = hits.reduce((top, hit) => (hit.severity > (top?.severity ?? -1) ? hit : top), null);

    // 8b) Alt ağ (subnet) değerlendirmesi — ardışık IP'lerden gelen dağıtık
    // saldırıyı blok olarak gör. Blokta birden çok farklı IP tetiklendiyse
    // puanlar çarpanla büyür; eşik aşılırsa tüm blok yasaklanabilir.
    let subnetBan = null;
    if (config.subnet_enabled) {
      const sub = subnetOf(ip);
      if (sub) {
        const subWindow = config.subnet_window_seconds * 1000;
        const distinct = subnetTrackIp(sub.key, ip, now, subWindow);
        const hot = distinct >= config.subnet_distinct_ips;
        const factor = hot ? Math.max(1, config.subnet_multiplier) : 1;
        const subTotal = subnetScores.add(sub.key, totalPoints * factor, subWindow, now);
        const subReqs = subnetRate.hit(sub.key, subWindow, now);
        const overScore = hot && subTotal >= config.subnet_score_threshold;
        const overRate = config.subnet_rate_max > 0 && subReqs > config.subnet_rate_max && distinct >= 2;
        if (enforcing && (overScore || overRate)) {
          subnetBan = {
            cidr: sub.cidr,
            reason: `Alt ağ saldırısı: ${distinct} IP · ${subTotal} puan · ${subReqs} istek`,
            distinct, subTotal
          };
        } else if (hot) {
          // Bloğu sıcak ama eşik altı: olayı görünür kıl
          writeEvent(req, ip, {
            ruleId: 'subnet-hot', label: `Alt ağ hareketli: ${sub.cidr} (${distinct} IP)`, category: 'subnet',
            severity: 3, score: 0, action: enforcing ? 'blocked' : 'monitor', matched: sub.cidr
          }, `Blok puanı: ${subTotal}/${config.subnet_score_threshold}`);
        }
      }
    }

    const wantsBan = hits.some(hit => hit.action === 'ban') || windowTotal >= config.score_threshold || Boolean(subnetBan);
    const wantsBlock = wantsBan || hits.some(hit => hit.action === 'block');

    let action = 'log';
    if (!enforcing) action = 'monitor';
    else if (wantsBan) action = 'banned';
    else if (wantsBlock) action = 'blocked';

    for (const hit of hits) {
      writeEvent(req, ip, { ...hit, action }, `Pencere puanı: ${windowTotal}/${config.score_threshold}`);
    }

    if (!enforcing) return next();

    if (subnetBan && config.subnet_ban_whole) {
      // Tüm bloğu yasakla — tek tek IP yerine /24 (IPv6 /64)
      writeEvent(req, ip, {
        ruleId: 'subnet-ban', label: `Alt ağ yasaklandı: ${subnetBan.cidr}`, category: 'subnet',
        severity: 5, score: subnetBan.subTotal, action: 'banned', matched: subnetBan.cidr
      }, subnetBan.reason);
      banIp(subnetBan.cidr, { reason: subnetBan.reason, category: 'subnet', score: subnetBan.subTotal }).catch(() => {});
      stats.blocked++;
      return deny(req, res, config);
    }

    if (wantsBan) {
      banIp(ip, {
        reason: subnetBan ? subnetBan.reason : (worst ? `${worst.label} (${worst.matched})` : 'Puan eşiği aşıldı'),
        category: subnetBan ? 'subnet' : (worst?.category || 'custom'),
        score: windowTotal
      }).catch(() => {});
      stats.blocked++;
      return deny(req, res, config);
    }
    if (wantsBlock) {
      stats.blocked++;
      return deny(req, res, config);
    }
    return next();
  }

  function deny(req, res, config) {
    const status = Number(config.block_status) || 403;
    res.status(status);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex');
    if (String(req.path || '').startsWith('/api/')) {
      return res.json({ error: config.block_message || 'Erişim engellendi.', code: 'FIREWALL_BLOCKED' });
    }
    return res.type('text/plain; charset=utf-8').send(config.block_message || 'Erişim engellendi.');
  }

  function writeEvent(req, ip, hit, detail) {
    const level = state.config.log_level;
    if (level === 'blocked' && !['blocked', 'banned'].includes(hit.action)) return;
    if (level === 'suspicious' && (hit.severity || 0) < 2) return;
    const client = typeof getClientInfo === 'function' ? getClientInfo(req) : {};
    enqueue({
      ip,
      method: String(req.method || '').slice(0, 10),
      path: String(req.path || '').slice(0, 512),
      query_string: String(req.originalUrl?.split('?')[1] || '').slice(0, 512),
      host: String(req.get?.('host') || '').slice(0, 190),
      referer: String(req.get?.('referer') || '').slice(0, 512),
      user_agent: String(client.userAgent || req.get?.('user-agent') || '').slice(0, 512),
      rule_id: String(hit.ruleId || '').slice(0, 64),
      rule_label: String(hit.label || '').slice(0, 190),
      category: String(hit.category || '').slice(0, 48),
      severity: Number(hit.severity) || 1,
      score: Number(hit.score) || 0,
      action: String(hit.action || 'log').slice(0, 16),
      matched: String(hit.matched || '').slice(0, 190),
      country: String(client.country || '').slice(0, 64),
      city: String(client.city || '').slice(0, 128),
      device: String(client.device || '').slice(0, 48),
      operating_system: String(client.operatingSystem || '').slice(0, 48),
      actor: String(req.user?.username || 'anonymous').slice(0, 64),
      detail: String(detail || '').slice(0, 300)
    });
  }

  // ── Bakım ──────────────────────────────────────────────────────────────────
  async function prune() {
    const config = state.config;
    const now = Date.now();
    rate.prune(now, config.rate_window_seconds * 1000);
    notFound.prune(now, config.notfound_window_seconds * 1000);
    scores.prune(now, config.score_window_seconds * 1000);
    burst.prune(now, config.burst_window_seconds * 1000);
    attackRate.prune(now, 2000);
    subnetRate.prune(now, config.subnet_window_seconds * 1000);
    subnetScores.prune(now, config.subnet_window_seconds * 1000);
    authFailIp.prune(now, config.bruteforce_window_seconds * 1000);
    authFailAccount.prune(now, config.bruteforce_window_seconds * 1000);
    // Süresi dolmuş alt ağ üyeleri ve giriş kilitleri
    const subCutoff = now - config.subnet_window_seconds * 1000;
    for (const [key, members] of subnetMembers) {
      for (const [addr, ts] of members) if (ts < subCutoff) members.delete(addr);
      if (!members.size) subnetMembers.delete(key);
    }
    for (const [key, until] of loginLocks) if (until <= now) loginLocks.delete(key);
    if (banNoticeThrottle.size > 5000) banNoticeThrottle.clear();
    try {
      if (config.log_retention_days > 0) {
        await query(`DELETE FROM firewall_events WHERE created_at < NOW() - ($1 || ' days')::interval`, [String(config.log_retention_days)]);
      }
      if (config.log_max_rows > 0) {
        await query(
          `DELETE FROM firewall_events WHERE id IN (
             SELECT id FROM firewall_events ORDER BY id DESC OFFSET $1
           )`,
          [config.log_max_rows]
        );
      }
      await query('UPDATE firewall_bans SET active=FALSE, released_at=NOW() WHERE active=TRUE AND permanent=FALSE AND expires_at <= NOW()');
    } catch (error) {
      console.error('[firewall] Bakım hatası:', error.message);
    }
    await refreshBans();
  }

  let timers = [];
  async function start() {
    await reload();
    timers.push(setInterval(() => { refreshBans().catch(() => {}); }, 30000));
    timers.push(setInterval(() => { prune().catch(() => {}); }, 10 * 60000));
    timers.forEach(timer => timer.unref?.());
    console.log(`[firewall] Hazır — mod: ${state.config.mode}, kural: ${state.rules.length}, yasaklı: ${state.bans.size}`);
  }

  function stop() {
    timers.forEach(clearInterval);
    timers = [];
    if (flushTimer) clearTimeout(flushTimer);
  }

  return {
    middleware,
    start,
    stop,
    reload,
    flush,
    prune,
    banIp,
    unbanIp,
    refreshBans,
    refreshAllowlist,
    evaluate,
    isAllowed,
    normalizeIp,
    subnetOf,
    // Brute force — giriş uçlarından çağrılır
    registerAuthFailure,
    registerAuthSuccess,
    loginBlocked,
    get config() { return state.config; },
    get rules() { return state.rules; },
    get bans() { return state.bans; },
    get underAttack() { return Date.now() < state.underAttackUntil; },
    get stats() {
      return {
        ...stats,
        queue: queue.length,
        bans: state.bans.size + state.banPrefixes.length,
        subnet_bans: state.banPrefixes.length,
        rules: state.rules.length,
        under_attack: Date.now() < state.underAttackUntil,
        rps: currentRps(Date.now()),
        tracked_subnets: subnetMembers.size,
        login_locks: loginLocks.size
      };
    },
    CATEGORIES,
    DEFAULT_CONFIG,
    BUILTIN_RULES,
    SETTING_KEY: FIREWALL_SETTING_KEY
  };
}

module.exports = { createFirewall, CATEGORIES, DEFAULT_CONFIG, FIREWALL_SETTING_KEY };
