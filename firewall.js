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

  // Kategori anahtarları: her biri açılıp kapatılabilir ve puanı değiştirilebilir
  categories: {},

  // Honeypot: buraya dokunan anında yasaklanır
  honeypot_enabled: true,
  honeypot_paths: ['/wp-login.php', '/wp-admin/', '/phpmyadmin/', '/.env', '/.git/config'],

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

function normalizeIp(value) {
  return String(value || '').replace(/^::ffff:/i, '').trim().slice(0, 64);
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
    allowlist: new Set(),
    allowPrefixes: [],      // "1.2.3." gibi önek eşleşmeleri
    loadedAt: 0,
    ready: false
  };

  const rate = new SlidingWindow();
  const notFound = new SlidingWindow();
  const scores = new ScoreBook();
  const banNoticeThrottle = new Map(); // yasaklı IP'nin logunu saniyede bir kez yaz

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
      for (const row of rows) {
        next.set(normalizeIp(row.ip), {
          id: row.id,
          reason: row.reason || '',
          permanent: Boolean(row.permanent),
          expiresAt: row.expires_at ? new Date(row.expires_at).getTime() : null
        });
      }
      state.bans = next;
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
    if (!ban) return null;
    if (!ban.permanent && ban.expiresAt && ban.expiresAt <= now) {
      state.bans.delete(ip);
      return null;
    }
    return ban;
  }

  // ── Yasaklama ──────────────────────────────────────────────────────────────
  async function banIp(ip, { reason, category, score, createdBy = 'auto', minutes, permanent = false } = {}) {
    const address = normalizeIp(ip);
    if (!address || isAllowed(address)) return null;
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
      state.bans.set(address, {
        id: row?.id,
        reason: String(reason || ''),
        permanent: Boolean(row?.permanent ?? isPermanent),
        expiresAt: row?.expires_at ? new Date(row.expires_at).getTime() : (expiresAt ? expiresAt.getTime() : null)
      });
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
    scores.reset(address);
    try {
      await query('UPDATE firewall_bans SET active=FALSE, released_at=NOW() WHERE ip=$1 AND active=TRUE', [address]);
      return true;
    } catch (error) {
      console.error('[firewall] Yasak kaldırılamadı:', error.message);
      return false;
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

    // 4) Honeypot — anında yasak
    if (config.honeypot_enabled) {
      const lowered = reqPath.toLowerCase();
      const trap = config.honeypot_paths.find(entry => {
        const value = String(entry || '').toLowerCase().trim();
        return value && (lowered === value || lowered.startsWith(value));
      });
      if (trap) {
        const hit = {
          ruleId: 'honeypot', label: `Honeypot: ${trap}`, category: 'honeypot',
          severity: 5, score: CATEGORIES.honeypot.score, action: enforcing ? 'banned' : 'monitor', matched: trap
        };
        writeEvent(req, ip, hit, 'Honeypot tetiklendi');
        if (enforcing) {
          banIp(ip, { reason: `Honeypot: ${trap}`, category: 'honeypot', score: hit.score }).catch(() => {});
          return deny(req, res, config);
        }
        return next();
      }
    }

    // 5) Hız sınırı
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
    const wantsBan = hits.some(hit => hit.action === 'ban') || windowTotal >= config.score_threshold;
    const wantsBlock = wantsBan || hits.some(hit => hit.action === 'block');

    let action = 'log';
    if (!enforcing) action = 'monitor';
    else if (wantsBan) action = 'banned';
    else if (wantsBlock) action = 'blocked';

    for (const hit of hits) {
      writeEvent(req, ip, { ...hit, action }, `Pencere puanı: ${windowTotal}/${config.score_threshold}`);
    }

    if (!enforcing) return next();

    if (wantsBan) {
      banIp(ip, {
        reason: worst ? `${worst.label} (${worst.matched})` : 'Puan eşiği aşıldı',
        category: worst?.category || 'custom',
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
    get config() { return state.config; },
    get rules() { return state.rules; },
    get bans() { return state.bans; },
    get stats() { return { ...stats, queue: queue.length, bans: state.bans.size, rules: state.rules.length }; },
    CATEGORIES,
    DEFAULT_CONFIG,
    BUILTIN_RULES,
    SETTING_KEY: FIREWALL_SETTING_KEY
  };
}

module.exports = { createFirewall, CATEGORIES, DEFAULT_CONFIG, FIREWALL_SETTING_KEY };
