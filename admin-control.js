'use strict';
// =============================================================================
// CIGCIG KONTROL MERKEZİ — ana admin için tüm içerik, kullanıcı ve site kontrolü
// -----------------------------------------------------------------------------
// Güvenlik:
//  * Tüm uçlar yalnızca ana admine açıktır (requireSuper).
//  * SQL yalnızca aşağıdaki sabit kayıt defterinden kurulur; istemciden gelen
//    hiçbir değer tablo/sütun adı olarak kullanılmaz — yalnızca parametre olur.
//  * Her değiştirici işlem system_logs'a yazılır.
// =============================================================================

const CONTENT_TYPES = {
  forum: {
    label: 'Forum konuları', icon: 'comments', group: 'Yazılar',
    from: 'forums t', id: 't.id', owner: 't.user_id',
    title: 't.title', body: 'LEFT(t.content, 240)', media: "NULLIF(COALESCE(NULLIF(t.thumbnail,''), t.banner_image), '')",
    link: "'/forum/' || t.slug", created: 't.created_at', metric: 'COALESCE(t.views,0)', metricLabel: 'görüntülenme',
    search: ['t.title', 't.content'], suspendType: 'forum', deleteSql: 'DELETE FROM forums WHERE id=$1'
  },
  forum_comment: {
    label: 'Forum yorumları', icon: 'comment', group: 'Yorumlar',
    from: 'forum_comments t LEFT JOIN forums p ON p.id=t.forum_id', id: 't.id', owner: 't.user_id',
    title: "COALESCE(p.title, 'Silinmiş konu')", body: 'LEFT(t.content, 240)', media: 'NULL',
    link: "'/forum/' || p.slug", created: 't.created_at', search: ['t.content'],
    deleteSql: 'DELETE FROM forum_comments WHERE id=$1'
  },
  poem: {
    label: 'Şiirler', icon: 'feather', group: 'Yazılar',
    from: 'poems t', id: 't.id', owner: 't.user_id',
    title: 't.title', body: 'LEFT(t.content, 240)', media: 'NULL',
    link: "'/siir/' || t.slug", created: 't.created_at', metric: 'COALESCE(t.views,0)', metricLabel: 'görüntülenme',
    search: ['t.title', 't.content'], hidden: 'COALESCE(t.is_hidden,0)=1',
    hideSql: 'UPDATE poems SET is_hidden=1 WHERE id=$1', unhideSql: 'UPDATE poems SET is_hidden=0 WHERE id=$1',
    deleteSql: 'DELETE FROM poems WHERE id=$1'
  },
  poem_comment: {
    label: 'Şiir yorumları', icon: 'comment', group: 'Yorumlar',
    from: 'poem_comments t LEFT JOIN poems p ON p.id=t.poem_id', id: 't.id', owner: 't.user_id',
    title: "COALESCE(p.title, 'Silinmiş şiir')", body: 'LEFT(t.content, 240)', media: 'NULL',
    link: "'/siir/' || p.slug", created: 't.created_at', search: ['t.content'],
    deleteSql: 'DELETE FROM poem_comments WHERE id=$1'
  },
  book: {
    label: 'Kitaplar', icon: 'book', group: 'Yazılar',
    from: 'books t', id: 't.id', owner: 't.user_id',
    title: 't.title', body: 'LEFT(COALESCE(t.preface,\'\'), 240)', media: "NULLIF(t.cover_image,'')",
    link: "'/kitap/' || t.slug", created: 't.created_at', metric: 'COALESCE(t.page_count,0)', metricLabel: 'sayfa',
    search: ['t.title', 't.author_name'], suspendType: 'book', hidden: 'COALESCE(t.is_hidden,0)=1',
    hideSql: 'UPDATE books SET is_hidden=1 WHERE id=$1', unhideSql: 'UPDATE books SET is_hidden=0 WHERE id=$1',
    deleteSql: 'DELETE FROM books WHERE id=$1'
  },
  book_comment: {
    label: 'Kitap yorumları', icon: 'comment', group: 'Yorumlar',
    from: 'book_comments t LEFT JOIN books p ON p.id=t.book_id', id: 't.id', owner: 't.user_id',
    title: "COALESCE(p.title, 'Silinmiş kitap')", body: 'LEFT(t.content, 240)', media: 'NULL',
    link: "'/kitap/' || p.slug", created: 't.created_at', search: ['t.content'],
    deleteSql: 'DELETE FROM book_comments WHERE id=$1'
  },
  photo: {
    label: 'Fotoğraflar', icon: 'image', group: 'Medya',
    from: 'photos t', id: 't.id', owner: 't.user_id',
    title: "COALESCE(NULLIF(t.title,''), LEFT(t.caption, 80), 'Fotoğraf')", body: 'LEFT(COALESCE(t.caption,\'\'), 240)', media: 't.url',
    link: "'/foto/' || t.id", created: 't.created_at', metric: 'COALESCE(t.like_count,0)', metricLabel: 'beğeni',
    search: ['t.title', 't.caption'], suspendType: 'photo', deleteSql: 'DELETE FROM photos WHERE id=$1'
  },
  photo_comment: {
    label: 'Fotoğraf yorumları', icon: 'comment', group: 'Yorumlar',
    from: 'photo_comments t', id: 't.id', owner: 't.user_id',
    title: "'Fotoğraf #' || t.photo_id", body: 'LEFT(t.content, 240)', media: 'NULL',
    link: "'/foto/' || t.photo_id", created: 't.created_at', search: ['t.content'],
    deleteSql: 'DELETE FROM photo_comments WHERE id=$1'
  },
  reals: {
    label: 'Reals', icon: 'clapperboard', group: 'Medya',
    from: 'videos t', id: 't.id', owner: 't.user_id', where: 'COALESCE(t.is_reals,0)=1',
    title: 't.title', body: 'LEFT(COALESCE(t.description,\'\'), 240)', media: "NULLIF(t.thumbnail_url,'')",
    link: "'/reals/' || t.slug", created: 't.created_at', metric: 'COALESCE(t.views,0)', metricLabel: 'izlenme',
    search: ['t.title', 't.description'], suspendType: 'reals', deleteSql: 'DELETE FROM videos WHERE id=$1 AND COALESCE(is_reals,0)=1'
  },
  video: {
    label: 'Videolar', icon: 'video', group: 'Medya',
    from: 'videos t', id: 't.id', owner: 't.user_id', where: 'COALESCE(t.is_reals,0)=0',
    title: 't.title', body: 'LEFT(COALESCE(t.description,\'\'), 240)', media: "NULLIF(t.thumbnail_url,'')",
    link: "'/video/' || t.slug", created: 't.created_at', metric: 'COALESCE(t.views,0)', metricLabel: 'izlenme',
    search: ['t.title', 't.description'], suspendType: 'video', deleteSql: 'DELETE FROM videos WHERE id=$1 AND COALESCE(is_reals,0)=0'
  },
  video_comment: {
    label: 'Video/Reals yorumları', icon: 'comment', group: 'Yorumlar',
    from: 'video_comments t LEFT JOIN videos p ON p.id=t.video_id', id: 't.id', owner: 't.user_id',
    title: "COALESCE(p.title, 'Silinmiş video')", body: 'LEFT(t.content, 240)', media: 'NULL',
    link: "CASE WHEN COALESCE(p.is_reals,0)=1 THEN '/reals/' ELSE '/video/' END || p.slug", created: 't.created_at', search: ['t.content'],
    deleteSql: 'DELETE FROM video_comments WHERE id=$1'
  },
  story: {
    label: 'Hikayeler', icon: 'circle-play', group: 'Medya',
    from: 'stories t', id: 't.id', owner: 't.user_id',
    title: "COALESCE(NULLIF(t.caption,''), 'Hikaye')", body: "t.media_type || CASE WHEN t.expires_at < NOW() AND COALESCE(t.is_permanent,0)=0 THEN ' · süresi doldu' ELSE '' END",
    media: "CASE WHEN t.media_type='image' THEN t.media_url ELSE NULL END",
    link: "'/hikaye/' || COALESCE(t.public_id, t.id::text)", created: 't.created_at', search: ['t.caption'],
    suspendType: 'story', deleteSql: 'DELETE FROM stories WHERE id=$1'
  },
  story_reply: {
    label: 'Hikaye yanıtları', icon: 'reply', group: 'Yorumlar',
    from: 'story_replies t', id: 't.id', owner: 't.user_id',
    title: "'Hikaye #' || t.story_id", body: 'LEFT(t.content, 240)', media: 'NULL',
    link: 'NULL', created: 't.created_at', search: ['t.content'],
    deleteSql: 'DELETE FROM story_replies WHERE id=$1'
  },
  song: {
    label: 'Şarkılar', icon: 'music', group: 'Müzik',
    from: 'songs t', id: 't.id', owner: 't.uploader_id',
    title: "t.title || ' — ' || COALESCE(t.artist_name,'')", body: "COALESCE(t.genre,'') || ' · ' || COALESCE(t.status,'')", media: "NULLIF(t.cover_url,'')",
    link: "'/muzik/' || t.slug", created: 't.created_at', metric: 'COALESCE(t.play_count,0)', metricLabel: 'dinlenme',
    search: ['t.title', 't.artist_name', 't.genre'], suspendType: 'song', deleteSql: 'DELETE FROM songs WHERE id=$1'
  },
  playlist: {
    label: 'Playlistler', icon: 'list-ul', group: 'Müzik',
    from: 'playlists t', id: 't.id', owner: 't.user_id',
    title: 't.name', body: "LEFT(COALESCE(t.description,''), 240) || CASE WHEN COALESCE(t.is_public,0)=1 THEN '' ELSE ' · gizli' END",
    media: "NULLIF(t.cover_url,'')", link: "'/playlist/' || COALESCE(t.public_id, t.id::text)", created: 't.created_at',
    search: ['t.name', 't.description'], deleteSql: 'DELETE FROM playlists WHERE id=$1'
  },
  group: {
    label: 'Gruplar', icon: 'people-group', group: 'Topluluk',
    from: 'groups t', id: 't.id', owner: 't.owner_id',
    title: 't.name', body: 'LEFT(COALESCE(t.description,\'\'), 240)', media: "NULLIF(COALESCE(NULLIF(t.logo_url,''), t.cover_image),'')",
    link: "'/grup/' || t.slug", created: 't.created_at', metric: 'COALESCE(t.member_count,0)', metricLabel: 'üye',
    search: ['t.name', 't.description'], suspendType: 'group', deleteSql: 'DELETE FROM groups WHERE id=$1'
  },
  group_message: {
    label: 'Grup mesajları', icon: 'message', group: 'Topluluk',
    from: 'group_messages t LEFT JOIN groups p ON p.id=t.group_id', id: 't.id', owner: 't.user_id',
    title: "COALESCE(p.name, 'Silinmiş grup')", body: "LEFT(COALESCE(NULLIF(t.content,''), CASE WHEN t.image_url IS NOT NULL AND t.image_url<>'' THEN '[görsel]' WHEN t.voice_url IS NOT NULL AND t.voice_url<>'' THEN '[sesli mesaj]' ELSE '' END), 240)",
    media: "NULLIF(t.image_url,'')", link: "'/grup/' || p.slug", created: 't.created_at', search: ['t.content'],
    deleteSql: 'DELETE FROM group_messages WHERE id=$1'
  },
  newspaper: {
    label: 'Gazeteler', icon: 'newspaper', group: 'Yazılar',
    from: 'newspapers t', id: 't.id', owner: 't.journalist_id',
    title: 't.newspaper_name', body: "'Sayı ' || COALESCE(t.issue_number::text,'—')", media: "NULLIF(t.image_url,'')",
    link: "'/gazete/' || t.id", created: 't.created_at', search: ['t.newspaper_name'],
    deleteSql: 'DELETE FROM newspapers WHERE id=$1'
  },
  newspaper_comment: {
    label: 'Gazete yorumları', icon: 'comment', group: 'Yorumlar',
    from: 'newspaper_comments t', id: 't.id', owner: 't.user_id',
    title: "'Gazete #' || t.newspaper_id", body: 'LEFT(t.content, 240)', media: 'NULL',
    link: "'/gazete/' || t.newspaper_id", created: 't.created_at', search: ['t.content'],
    deleteSql: 'DELETE FROM newspaper_comments WHERE id=$1'
  },
  gif: {
    label: 'Cig GIF\'ler', icon: 'film', group: 'Medya',
    from: 'cig_gifs t', id: 't.id', owner: 't.user_id', where: 't.deleted_at IS NULL',
    title: "t.media_type || ' · ' || t.width || '×' || t.height", body: "COALESCE((SELECT string_agg(k.keyword, ' ') FROM cig_gif_keywords k WHERE k.gif_id=t.id), '')",
    media: 't.media_url', link: 'NULL', created: 't.created_at', metric: 'COALESCE(t.use_count,0)', metricLabel: 'kullanım',
    search: ["(SELECT string_agg(k.keyword, ' ') FROM cig_gif_keywords k WHERE k.gif_id=t.id)"],
    hidden: 'COALESCE(t.is_hidden,0)=1',
    hideSql: 'UPDATE cig_gifs SET is_hidden=1 WHERE id=$1', unhideSql: 'UPDATE cig_gifs SET is_hidden=0 WHERE id=$1',
    deleteSql: 'UPDATE cig_gifs SET deleted_at=NOW() WHERE id=$1'
  },
  note: {
    label: 'Notlar', icon: 'note-sticky', group: 'Topluluk',
    from: 'dm_notes t', id: 't.user_id', owner: 't.user_id',
    title: "'Not'", body: "t.content || CASE WHEN t.expires_at < NOW() THEN ' · süresi doldu' ELSE '' END", media: 'NULL',
    link: 'NULL', created: 't.created_at', search: ['t.content'],
    deleteSql: 'DELETE FROM dm_notes WHERE user_id=$1'
  }
};

// Ana admin tarafından açılıp kapatılabilen site anahtarları
const SWITCHES = [
  { key: 'site_maintenance_enabled', group: 'Acil durum', label: 'Site bakım modu', hint: 'Ziyaretçiler bakım ekranı görür. Yönetim paneli açık kalır.', danger: true },
  { key: 'readonly_mode_enabled', group: 'Acil durum', label: 'Salt okunur mod', hint: 'Kimse yeni içerik paylaşamaz, mesaj atamaz, beğenemez. Okuma devam eder.', danger: true },
  { key: 'registration_closed', group: 'Acil durum', label: 'Yeni kayıtları kapat', hint: 'Kayıt formu çalışmaz; mevcut üyeler giriş yapabilir.', danger: true },
  { key: 'first_visit_auth', group: 'Erişim', label: 'Siteyi görmek için giriş zorunlu', hint: 'Giriş yapmayan ziyaretçiler kayıt ekranına yönlenir.' },
  { key: 'mobile_home_auth_required', group: 'Erişim', label: 'Mobil ana sayfa için giriş zorunlu' },
  { key: 'route_protection_enabled', group: 'Erişim', label: 'Route koruması', hint: 'Tanımlı hassas yolları gizler ve yönlendirir.' },
  { key: 'reals_maintenance_enabled', group: 'Reals', label: 'Reals bakım modu', hint: 'Açıkken kimse Reals yükleyemez.', danger: true },
  { key: 'reals_in_media_enabled', group: 'Reals', label: 'Reals medya akışında görünsün', defaultOn: true },
  { key: 'reals_info_enabled', group: 'Reals', label: 'Reals bilgi notu', defaultOn: true },
  { key: 'level_system_enabled', group: 'Özellikler', label: 'Seviye sistemi' },
  { key: 'badge_system_enabled', group: 'Özellikler', label: 'Rozet sistemi' },
  { key: 'other_songs_enabled', group: 'Özellikler', label: 'Diğer şarkılar bölümü' },
  { key: 'beta_mode_enabled', group: 'Özellikler', label: 'Beta modu' },
  { key: 'content_count_combined', group: 'Özellikler', label: 'İçerik sayılarını birleştir' },
  { key: 'theme_picker_enabled', group: 'Görünüm', label: 'Tema seçici' },
  { key: 'device_theme_enabled', group: 'Görünüm', label: 'Cihaz temasını izle' },
  { key: 'dm_wallpaper_enabled', group: 'Görünüm', label: 'Sohbet arka plan deseni' },
  { key: 'nsfw_protection_enabled', group: 'Güvenlik', label: 'NSFW koruması', hint: 'Sağlayıcı ayarı NSFW sayfasında.' },
  { key: 'nsfw_blur_enabled', group: 'Güvenlik', label: 'Sınırdaki içeriği bulanıklaştır' }
];
const SWITCH_KEYS = new Set(SWITCHES.map(item => item.key));

// Kullanıcı üzerinde düzenlenebilir alanlar ve türleri
const USER_FIELDS = {
  nickname: { type: 'text', max: 60 },
  email: { type: 'email', max: 190 },
  bio: { type: 'text', max: 500 },
  title: { type: 'text', max: 80 },
  location: { type: 'text', max: 80 },
  name_color: { type: 'color' },
  is_private: { type: 'bool' },
  is_red_verified: { type: 'bool' },
  is_vip: { type: 'bool' },
  is_plus: { type: 'bool' },
  is_artist: { type: 'bool' },
  email_verified: { type: 'bool' },
  show_in_suggestions: { type: 'bool' },
  allow_mentions: { type: 'bool' }
};

function registerAdminControl(app, deps) {
  const { query, adminMiddleware, logAction, getIp, getClientInfo, firewall, env } = deps;

  const requireSuper = (req, res, next) => {
    if (!req.adminUser?.isSuperAdmin) return res.status(403).json({ error: 'Kontrol merkezi yalnızca ana admine açıktır.' });
    next();
  };
  const guard = [adminMiddleware, requireSuper];
  const actor = req => req.adminUser?.username || 'admin';
  const audit = (req, action, target, detail) =>
    logAction(actor(req), action, String(target || '').slice(0, 190), typeof detail === 'string' ? detail : JSON.stringify(detail || {}), getIp(req), getClientInfo(req)).catch(() => {});
  const safe = handler => async (req, res) => {
    try { await handler(req, res); }
    catch (error) {
      console.error('[kontrol-merkezi]', req.method, req.path, error.message);
      if (!res.headersSent) res.status(500).json({ error: error.message || 'İşlem başarısız.' });
    }
  };

  // Gerekli sütunlar yoksa ekle (idempotent)
  query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS nickname TEXT DEFAULT '';
         ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_pin_hash TEXT DEFAULT '';
         ALTER TABLE users ADD COLUMN IF NOT EXISTS app_lock_enabled INTEGER DEFAULT 0;
         ALTER TABLE users ADD COLUMN IF NOT EXISTS app_lock_hash TEXT DEFAULT '';
         CREATE INDEX IF NOT EXISTS idx_system_logs_action_created ON system_logs(action, created_at DESC);`)
    .catch(error => console.error('[kontrol-merkezi] şema hazırlanamadı:', error.message));

  // ── Acil durum anahtarları: bellekte, 10 sn'de bir tazelenir ─────────────────
  const emergency = { maintenance: false, maintenanceMessage: '', readonly: false, registrationClosed: false, at: 0 };
  async function refreshEmergency() {
    try {
      const { rows } = await query("SELECT key, value FROM settings WHERE key = ANY($1)",
        [['site_maintenance_enabled', 'site_maintenance_message', 'readonly_mode_enabled', 'registration_closed']]);
      const map = Object.fromEntries(rows.map(row => [row.key, row.value]));
      emergency.maintenance = map.site_maintenance_enabled === '1';
      emergency.maintenanceMessage = map.site_maintenance_message || 'CigCig kısa bir bakımda. Birazdan geri döneceğiz.';
      emergency.readonly = map.readonly_mode_enabled === '1';
      emergency.registrationClosed = map.registration_closed === '1';
      emergency.at = Date.now();
    } catch { /* tablo henüz yoksa sessiz geç */ }
  }
  refreshEmergency();
  setInterval(refreshEmergency, 10000).unref?.();

  const isAdminPath = p => p.startsWith('/api/admin') || p.startsWith('/api/vmb-admin') || deps.isAdminPanelRequestPath?.(p)
    || p === '/vmb-panel' || p === '/vmb-panel.html';
  const STATIC_ASSET = /\.(css|js|mjs|map|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|json|webmanifest|txt|xml)$/i;
  const READONLY_ALLOWED = [/^\/api\/auth\/(login|logout|2fa|forgot-password|verify-registration-email)/, /^\/api\/me\/app-lock\/unlock$/, /^\/api\/push\//, /^\/api\/presence/];

  app.use((req, res, next) => {
    if (isAdminPath(req.path)) return next();
    if (emergency.registrationClosed && req.method === 'POST' && /^\/api\/auth\/(register|quick-registration)/.test(req.path)) {
      return res.status(403).json({ error: 'Yeni kayıtlar şu an kapalı.', code: 'REGISTRATION_CLOSED' });
    }
    if (emergency.maintenance) {
      if (STATIC_ASSET.test(req.path) || req.path === '/api/settings/public' || req.path === '/api/app-version') return next();
      res.setHeader('Retry-After', '600');
      res.setHeader('Cache-Control', 'no-store');
      if (req.path.startsWith('/api/')) return res.status(503).json({ error: emergency.maintenanceMessage, code: 'SITE_MAINTENANCE' });
      return res.status(503).type('html').send(`<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bakımdayız · CigCig</title>
<style>html,body{height:100%;margin:0}body{display:grid;place-items:center;background:#08080c;color:#ececf3;font:16px/1.6 system-ui,-apple-system,Segoe UI,sans-serif;text-align:center;padding:24px}
.b{max-width:420px}.l{font:800 44px/1 Georgia,serif;letter-spacing:-1px;margin-bottom:18px}.m{color:#a0a0b4}.d{width:44px;height:44px;margin:26px auto 0;border:3px solid #26262f;border-top-color:#e11d48;border-radius:50%;animation:s 1s linear infinite}@keyframes s{to{transform:rotate(360deg)}}</style></head>
<body><div class="b"><div class="l">CigCig</div><p class="m">${String(emergency.maintenanceMessage).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c])}</p><div class="d"></div></div></body></html>`);
    }
    if (emergency.readonly && req.path.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)
      && !READONLY_ALLOWED.some(pattern => pattern.test(req.path))) {
      return res.status(503).json({ error: 'Site şu an salt okunur modda. Paylaşım ve mesajlaşma geçici olarak kapalı.', code: 'READONLY_MODE' });
    }
    next();
  });

  // ── Genel bakış ────────────────────────────────────────────────────────────
  app.get('/api/admin/cc/overview', ...guard, safe(async (req, res) => {
    const countSql = Object.entries(CONTENT_TYPES).map(([key, type]) =>
      `SELECT '${key}' AS type, COUNT(*)::int AS total, COUNT(*) FILTER (WHERE ${type.created} > NOW() - interval '24 hours')::int AS last_24h FROM ${type.from}${type.where ? ` WHERE ${type.where}` : ''}`
    );
    const settled = await Promise.allSettled([
      ...countSql.map(sql => query(sql)),
      query(`SELECT COUNT(*)::int AS total,
                    COUNT(*) FILTER (WHERE created_at > NOW() - interval '24 hours')::int AS new_24h,
                    COUNT(*) FILTER (WHERE last_active > NOW() - interval '24 hours')::int AS active_24h,
                    COUNT(*) FILTER (WHERE last_active > NOW() - interval '5 minutes')::int AS online,
                    COUNT(*) FILTER (WHERE COALESCE(banned,0)=1)::int AS banned
             FROM users WHERE COALESCE(is_deleted,0)=0`),
      query('SELECT pg_database_size(current_database())::bigint AS bytes'),
      query(`SELECT id, actor, target, detail, created_at FROM system_logs WHERE action='upload_failed' ORDER BY created_at DESC LIMIT 6`),
      query(`SELECT id, actor, action, target, created_at FROM system_logs
             WHERE action NOT IN ('upload_failed','restricted_route_attempt') ORDER BY created_at DESC LIMIT 10`),
      query(`SELECT COUNT(*)::int AS open FROM user_reports WHERE COALESCE(status,'open')='open'`)
    ]);
    const content = {};
    settled.slice(0, countSql.length).forEach((result, index) => {
      const key = Object.keys(CONTENT_TYPES)[index];
      content[key] = result.status === 'fulfilled' ? result.value.rows[0] : { total: null, last_24h: null, error: result.reason?.message };
    });
    const pick = (offset, fallback) => {
      const result = settled[countSql.length + offset];
      return result?.status === 'fulfilled' ? result.value.rows : fallback;
    };
    const memory = process.memoryUsage();
    res.json({
      content,
      types: Object.fromEntries(Object.entries(CONTENT_TYPES).map(([key, type]) => [key, { label: type.label, icon: type.icon, group: type.group }])),
      users: pick(0, [{}])[0] || {},
      db_bytes: Number(pick(1, [{}])[0]?.bytes) || 0,
      upload_failures: pick(2, []),
      recent_actions: pick(3, []),
      open_reports: pick(4, [{}])[0]?.open ?? null,
      emergency,
      system: {
        uptime_seconds: Math.round(process.uptime()),
        node: process.version,
        rss: memory.rss,
        heap_used: memory.heapUsed,
        app_version: env.APP_ASSET_VERSION
      },
      integrations: integrationStatus()
    });
  }));

  function integrationStatus() {
    const e = process.env;
    const has = (...keys) => keys.every(key => String(e[key] || '').trim());
    const fw = firewall?.config || {};
    return [
      { key: 'storage', label: 'Medya depolama', ok: env.USE_R2 || env.USE_CLOUDINARY, value: env.USE_R2 ? 'Cloudflare R2' : env.USE_CLOUDINARY ? 'Cloudinary' : 'Sunucu diski (kalıcı değil)', warn: !env.USE_R2 && !env.USE_CLOUDINARY },
      { key: 'r2', label: 'Cloudflare R2', ok: !!env.USE_R2, value: env.USE_R2 ? 'Bağlı' : 'Ayarlı değil', envs: ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME', 'R2_PUBLIC_URL'] },
      { key: 'cloudinary', label: 'Cloudinary', ok: !!env.USE_CLOUDINARY, value: env.USE_CLOUDINARY ? 'Bağlı' : 'Ayarlı değil', envs: ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'] },
      { key: 'giphy', label: 'GIPHY', ok: has('GIPHY_API_KEY'), value: has('GIPHY_API_KEY') ? 'Bağlı' : 'Anahtar yok', envs: ['GIPHY_API_KEY'] },
      { key: 'webpush', label: 'Anlık bildirimler', ok: has('WEB_PUSH_PUBLIC_KEY', 'WEB_PUSH_PRIVATE_KEY'), value: has('WEB_PUSH_PUBLIC_KEY', 'WEB_PUSH_PRIVATE_KEY') ? 'Bağlı' : 'VAPID anahtarı yok', envs: ['WEB_PUSH_PUBLIC_KEY', 'WEB_PUSH_PRIVATE_KEY'] },
      { key: 'spotify', label: 'Spotify', ok: has('SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET'), value: has('SPOTIFY_CLIENT_ID') ? 'Bağlı' : 'Ayarlı değil', envs: ['SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET'] },
      { key: 'mail', label: 'E-posta gönderimi', ok: has('SMTP_HOST') || has('RESEND_API_KEY'), value: has('SMTP_HOST') ? 'SMTP' : has('RESEND_API_KEY') ? 'Resend' : 'Ayarlı değil', envs: ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'] },
      { key: 'firewall', label: 'Güvenlik duvarı', ok: fw.enabled && fw.mode === 'block', value: !fw.enabled || fw.mode === 'off' ? 'Kapalı' : fw.mode === 'monitor' ? 'İzleme modu' : 'Koruma açık', link: 'firewall' },
      { key: 'nsfw', label: 'NSFW koruması', ok: null, value: 'NSFW sayfasında', link: 'nsfw' }
    ];
  }

  // ── İçerik ─────────────────────────────────────────────────────────────────
  app.get('/api/admin/cc/content-types', ...guard, (req, res) => {
    res.json(Object.entries(CONTENT_TYPES).map(([key, type]) => ({
      key, label: type.label, icon: type.icon, group: type.group,
      can_suspend: !!type.suspendType, can_hide: !!type.hideSql, metric_label: type.metricLabel || ''
    })));
  });

  async function resolveUserId(raw) {
    const value = String(raw || '').trim().replace(/^@/, '');
    if (!value) return null;
    if (/^\d+$/.test(value)) return Number(value);
    const { rows } = await query('SELECT id FROM users WHERE LOWER(username)=LOWER($1)', [value]);
    return rows[0]?.id ?? -1;
  }

  function statusExpr(type) {
    const suspended = type.suspendType
      ? `EXISTS (SELECT 1 FROM content_suspensions cs WHERE cs.content_type='${type.suspendType}' AND cs.content_id=${type.id})`
      : 'FALSE';
    const hidden = type.hidden || 'FALSE';
    return { suspended, hidden };
  }

  app.get('/api/admin/cc/content/:type', ...guard, safe(async (req, res) => {
    const type = CONTENT_TYPES[req.params.type];
    if (!type) return res.status(404).json({ error: 'Bilinmeyen içerik türü.' });
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 40, 1), 200);
    const offset = Math.min(Math.max(Number.parseInt(req.query.offset, 10) || 0, 0), 1000000);
    const params = [];
    const where = [];
    if (type.where) where.push(type.where);
    const { suspended, hidden } = statusExpr(type);
    const q = String(req.query.q || '').trim().slice(0, 120);
    if (q) {
      params.push(`%${q}%`);
      const ph = `$${params.length}`;
      where.push(`(${type.search.map(expr => `${expr} ILIKE ${ph}`).join(' OR ')} OR u.username ILIKE ${ph})`);
    }
    if (req.query.user) {
      const userId = await resolveUserId(req.query.user);
      params.push(userId ?? -1);
      where.push(`${type.owner}=$${params.length}`);
    }
    const status = String(req.query.status || '');
    if (status === 'suspended') where.push(suspended);
    if (status === 'hidden') where.push(hidden);
    if (status === 'active') where.push(`NOT (${suspended}) AND NOT (${hidden})`);
    if (req.query.since) {
      params.push(String(Math.max(1, Number.parseInt(req.query.since, 10) || 24)));
      where.push(`${type.created} > NOW() - ($${params.length} || ' hours')::interval`);
    }
    const sorts = {
      new: `${type.created} DESC`,
      old: `${type.created} ASC`,
      top: type.metric ? `${type.metric} DESC, ${type.created} DESC` : `${type.created} DESC`
    };
    const order = sorts[req.query.sort] || sorts.new;
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const base = `FROM ${type.from} LEFT JOIN users u ON u.id=${type.owner} ${whereSql}`;
    const countParams = params.slice();
    params.push(limit, offset);
    const [list, count] = await Promise.all([
      query(`SELECT ${type.id} AS id, ${type.title} AS title, ${type.body} AS body, ${type.media} AS media,
                    ${type.link} AS link, ${type.created} AS created_at, ${type.metric || 'NULL'} AS metric,
                    ${suspended} AS suspended, ${hidden} AS hidden,
                    u.id AS owner_id, u.username AS owner_username, u.avatar AS owner_avatar
             ${base} ORDER BY ${order} LIMIT $${params.length - 1} OFFSET $${params.length}`, params),
      query(`SELECT COUNT(*)::int AS total ${base}`, countParams)
    ]);
    res.json({ items: list.rows, total: count.rows[0]?.total || 0, limit, offset });
  }));

  async function applyContentAction(req, typeKey, id, action, reason) {
    const type = CONTENT_TYPES[typeKey];
    if (!type) throw Object.assign(new Error('Bilinmeyen içerik türü.'), { status: 404 });
    const numericId = Number.parseInt(id, 10);
    if (!Number.isSafeInteger(numericId) || numericId < 1) throw Object.assign(new Error('Geçersiz içerik.'), { status: 400 });

    if (action === 'suspend') {
      if (!type.suspendType) throw Object.assign(new Error('Bu tür askıya alınamaz; gizleyin veya silin.'), { status: 400 });
      const text = String(reason || '').trim().slice(0, 500) || 'Yönetici kararıyla askıya alındı';
      await query(`INSERT INTO content_suspensions (content_type,content_id,reason,suspended_by) VALUES ($1,$2,$3,$4)
                   ON CONFLICT (content_type,content_id) DO UPDATE SET reason=EXCLUDED.reason, suspended_by=EXCLUDED.suspended_by, created_at=NOW()`,
        [type.suspendType, numericId, text, req.adminUser.id || null]);
      if (typeKey === 'story') await query('UPDATE stories SET is_suspended=1 WHERE id=$1', [numericId]);
      if (typeKey === 'song') await query("UPDATE songs SET status='suspended', ban_reason=$1, ban_until=NULL WHERE id=$2", [text, numericId]);
      const { rows } = await query(`SELECT ${type.owner} AS owner FROM ${type.from} WHERE ${type.id}=$1 LIMIT 1`, [numericId]);
      if (rows[0]?.owner) {
        await query('INSERT INTO notifications (user_id,type,actor_username,title,body,link) VALUES ($1,$2,$3,$4,$5,$6)',
          [rows[0].owner, 'content_suspended', 'CigCig Yetkilileri', 'İçeriğiniz askıya alındı', `İçeriğiniz şu nedenle askıya alındı: ${text}`, '/bildirimler']).catch(() => {});
      }
    } else if (action === 'unsuspend') {
      if (!type.suspendType) throw Object.assign(new Error('Bu tür askıya alınamaz.'), { status: 400 });
      await query('DELETE FROM content_suspensions WHERE content_type=$1 AND content_id=$2', [type.suspendType, numericId]);
      if (typeKey === 'story') await query('UPDATE stories SET is_suspended=0 WHERE id=$1', [numericId]);
      if (typeKey === 'song') await query("UPDATE songs SET status='active', ban_reason=NULL, ban_until=NULL WHERE id=$1 AND status='suspended'", [numericId]);
    } else if (action === 'hide' || action === 'unhide') {
      const sql = action === 'hide' ? type.hideSql : type.unhideSql;
      if (!sql) throw Object.assign(new Error('Bu tür gizlenemez.'), { status: 400 });
      await query(sql, [numericId]);
    } else if (action === 'delete') {
      try {
        const result = await query(type.deleteSql, [numericId]);
        if (!result.rowCount) throw Object.assign(new Error('İçerik bulunamadı.'), { status: 404 });
      } catch (error) {
        if (error.code === '23503') throw Object.assign(new Error('Bu içeriğe bağlı başka kayıtlar var; önce askıya almayı deneyin.'), { status: 409 });
        throw error;
      }
      if (type.suspendType) await query('DELETE FROM content_suspensions WHERE content_type=$1 AND content_id=$2', [type.suspendType, numericId]).catch(() => {});
    } else {
      throw Object.assign(new Error('Geçersiz işlem.'), { status: 400 });
    }
    await audit(req, `cc_content_${action}`, `${typeKey}#${numericId}`, { type: typeKey, id: numericId, reason: reason || '' });
  }

  app.post('/api/admin/cc/content/:type/:id/:action', ...guard, async (req, res) => {
    try {
      await applyContentAction(req, req.params.type, req.params.id, req.params.action, req.body?.reason);
      res.json({ ok: true });
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message });
    }
  });

  app.post('/api/admin/cc/content/:type/bulk', ...guard, async (req, res) => {
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).slice(0, 200);
    const action = String(req.body?.action || '');
    if (!ids.length) return res.status(400).json({ error: 'Seçili içerik yok.' });
    const results = { ok: 0, failed: [] };
    for (const id of ids) {
      try { await applyContentAction(req, req.params.type, id, action, req.body?.reason); results.ok++; }
      catch (error) { results.failed.push({ id, error: error.message }); }
    }
    res.json(results);
  });

  // ── Kullanıcılar ───────────────────────────────────────────────────────────
  app.get('/api/admin/cc/users', ...guard, safe(async (req, res) => {
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 200);
    const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);
    const params = [];
    const where = ['COALESCE(u.is_deleted,0)=0'];
    const q = String(req.query.q || '').trim().slice(0, 120);
    if (q) {
      params.push(`%${q}%`);
      where.push(`(u.username ILIKE $${params.length} OR u.nickname ILIKE $${params.length} OR u.email ILIKE $${params.length} OR u.ip ILIKE $${params.length})`);
    }
    const filters = {
      banned: 'COALESCE(u.banned,0)=1', admin: 'COALESCE(u.is_admin,0)=1', verified: 'COALESCE(u.is_red_verified,0)=1',
      vip: 'COALESCE(u.is_vip,0)=1 OR COALESCE(u.is_plus,0)=1', artist: 'COALESCE(u.is_artist,0)=1',
      online: "u.last_active > NOW() - interval '5 minutes'", new: "u.created_at > NOW() - interval '7 days'",
      unverified_email: 'COALESCE(u.email_verified,0)=0'
    };
    if (filters[req.query.filter]) where.push(`(${filters[req.query.filter]})`);
    const sorts = { new: 'u.created_at DESC', old: 'u.created_at ASC', active: 'u.last_active DESC NULLS LAST', name: 'u.username ASC' };
    const order = sorts[req.query.sort] || sorts.new;
    const whereSql = `WHERE ${where.join(' AND ')}`;
    const countParams = params.slice();
    params.push(limit, offset);
    const [list, count] = await Promise.all([
      query(`SELECT u.id, u.username, u.nickname, u.email, u.avatar, u.avatar_removed, u.created_at, u.last_active,
                    u.banned, u.ban_type, u.is_admin, u.is_red_verified, u.is_vip, u.is_plus, u.is_artist, u.is_private,
                    u.email_verified, u.two_factor_method, u.ip
             FROM users u ${whereSql} ORDER BY ${order} LIMIT $${params.length - 1} OFFSET $${params.length}`, params),
      query(`SELECT COUNT(*)::int AS total FROM users u ${whereSql}`, countParams)
    ]);
    res.json({ items: list.rows, total: count.rows[0]?.total || 0 });
  }));

  app.get('/api/admin/cc/users/:id', ...guard, safe(async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    const { rows } = await query('SELECT * FROM users WHERE id=$1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
    const {
      password_hash, two_factor_answer_hash, two_factor_pin_hash, app_lock_hash, spotify_token, spotify_refresh,
      email_verification_token_hash, ...user
    } = rows[0];
    user.has_pin = Boolean(two_factor_pin_hash);
    user.has_app_lock = Number(rows[0].app_lock_enabled) === 1 && Boolean(app_lock_hash);

    const countSql = Object.entries(CONTENT_TYPES).map(([key, type]) =>
      query(`SELECT '${key}' AS type, COUNT(*)::int AS total FROM ${type.from} WHERE ${type.owner}=$1${type.where ? ` AND ${type.where}` : ''}`, [id]));
    const [counts, sessions, logins, restrictions, logs, social] = await Promise.all([
      Promise.allSettled(countSql),
      query('SELECT token, created_at, expires_at, last_seen_at, ip, device, browser, os, location FROM sessions WHERE user_id=$1 AND expires_at > NOW() ORDER BY last_seen_at DESC NULLS LAST LIMIT 30', [id]).catch(() => ({ rows: [] })),
      query('SELECT * FROM login_events WHERE user_id=$1 ORDER BY created_at DESC LIMIT 15', [id]).catch(() => ({ rows: [] })),
      query('SELECT * FROM user_restrictions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20', [id]).catch(() => ({ rows: [] })),
      query('SELECT id, actor, action, target, detail, created_at FROM system_logs WHERE actor=$1 OR target=$1 ORDER BY created_at DESC LIMIT 25', [rows[0].username]).catch(() => ({ rows: [] })),
      query(`SELECT
               (SELECT COUNT(*) FROM follows WHERE following_id=$1 AND status='accepted')::int AS followers,
               (SELECT COUNT(*) FROM follows WHERE follower_id=$1 AND status='accepted')::int AS following,
               (SELECT COUNT(*) FROM dm_messages WHERE sender_id=$1)::int AS dm_sent,
               (SELECT COUNT(*) FROM user_reports WHERE target_user_id=$1)::int AS reports_against`, [id]).catch(() => ({ rows: [{}] }))
    ]);
    const contentCounts = {};
    counts.forEach((result, index) => {
      contentCounts[Object.keys(CONTENT_TYPES)[index]] = result.status === 'fulfilled' ? result.value.rows[0].total : null;
    });
    res.json({
      user,
      content_counts: contentCounts,
      sessions: sessions.rows.map(session => ({ ...session, token: undefined, token_hint: String(session.token || '').slice(-6) })),
      logins: logins.rows,
      restrictions: restrictions.rows,
      logs: logs.rows,
      social: social.rows[0] || {},
      editable: USER_FIELDS
    });
  }));

  app.patch('/api/admin/cc/users/:id', ...guard, safe(async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    const sets = [];
    const params = [];
    for (const [field, spec] of Object.entries(USER_FIELDS)) {
      if (!(field in (req.body || {}))) continue;
      let value = req.body[field];
      if (spec.type === 'bool') value = value === true || value === 1 || value === '1' ? 1 : 0;
      else if (spec.type === 'color') {
        value = String(value || '').trim();
        if (value && !/^#[0-9a-f]{6}$/i.test(value)) return res.status(400).json({ error: 'Renk #RRGGBB biçiminde olmalı.' });
      } else if (spec.type === 'email') {
        value = String(value || '').trim().toLowerCase();
        if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return res.status(400).json({ error: 'E-posta geçersiz.' });
        if (value) {
          const { rows } = await query('SELECT 1 FROM users WHERE LOWER(email)=$1 AND id<>$2', [value, id]);
          if (rows.length) return res.status(409).json({ error: 'Bu e-posta başka bir hesapta kayıtlı.' });
        }
      } else {
        value = String(value ?? '').slice(0, spec.max || 500);
      }
      params.push(value);
      sets.push(`${field}=$${params.length}`);
    }
    if ('username' in (req.body || {})) {
      const username = String(req.body.username || '').trim();
      if (!/^[A-Za-z0-9_.]{3,30}$/.test(username)) return res.status(400).json({ error: 'Kullanıcı adı 3-30 karakter; harf, rakam, _ ve . olabilir.' });
      const { rows } = await query('SELECT 1 FROM users WHERE LOWER(username)=LOWER($1) AND id<>$2', [username, id]);
      if (rows.length) return res.status(409).json({ error: 'Bu kullanıcı adı alınmış.' });
      params.push(username);
      sets.push(`username=$${params.length}`);
    }
    if (!sets.length) return res.status(400).json({ error: 'Değişiklik yok.' });
    params.push(id);
    const { rowCount } = await query(`UPDATE users SET ${sets.join(', ')} WHERE id=$${params.length}`, params);
    if (!rowCount) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
    await audit(req, 'cc_user_edit', `user#${id}`, Object.keys(req.body || {}));
    res.json({ ok: true });
  }));

  const USER_ACTIONS = {
    logout_all: { label: 'Tüm oturumları kapat', sql: ['DELETE FROM sessions WHERE user_id=$1'] },
    reset_2fa: { label: 'İki aşamalı doğrulamayı sıfırla', sql: ["UPDATE users SET two_factor_method='none', two_factor_question='', two_factor_answer_hash='', two_factor_pin_hash='' WHERE id=$1"] },
    reset_app_lock: { label: 'Uygulama şifresini kaldır', sql: ["UPDATE users SET app_lock_enabled=0, app_lock_hash='' WHERE id=$1"] },
    reset_chat_lock: {
      label: 'Sohbet kilitlerini sıfırla',
      sql: [
        "UPDATE dm_conversations SET hidden_by_user1=0, hidden_pass_user1='', lock_mode_user1='' WHERE user1_id=$1",
        "UPDATE dm_conversations SET hidden_by_user2=0, hidden_pass_user2='', lock_mode_user2='' WHERE user2_id=$1",
        "UPDATE dm_user_settings SET search_code_hash='', icon_code_hash='', search_unlock_enabled=0, icon_unlock_enabled=0, updated_at=NOW() WHERE user_id=$1"
      ]
    },
    remove_avatar: { label: 'Profil fotoğrafını kaldır', sql: ['UPDATE users SET avatar_removed=1 WHERE id=$1'] },
    force_password_reset: { label: 'Şifre değiştirmeye zorla', sql: ["UPDATE users SET password_reset_required=1, password_reset_expires_at=NOW() + interval '7 days' WHERE id=$1"] },
    verify_email: { label: 'E-postayı doğrulanmış say', sql: ['UPDATE users SET email_verified=1 WHERE id=$1'] },
    clear_bio: { label: 'Biyografiyi temizle', sql: ["UPDATE users SET bio='', links='[]' WHERE id=$1"] }
  };

  app.post('/api/admin/cc/users/:id/action', ...guard, safe(async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    const action = USER_ACTIONS[req.body?.action];
    if (!action) return res.status(400).json({ error: 'Geçersiz işlem.' });
    const { rows } = await query('SELECT id, username, is_admin FROM users WHERE id=$1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
    for (const sql of action.sql) await query(sql, [id]);
    await audit(req, `cc_user_${req.body.action}`, rows[0].username, action.label);
    res.json({ ok: true, message: `${action.label}: tamam` });
  }));

  app.delete('/api/admin/cc/users/:id/sessions/:hint', ...guard, safe(async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    const hint = String(req.params.hint || '');
    if (!/^[A-Za-z0-9_-]{4,12}$/.test(hint)) return res.status(400).json({ error: 'Geçersiz oturum.' });
    const { rowCount } = await query('DELETE FROM sessions WHERE user_id=$1 AND RIGHT(token, $2) = $3', [id, hint.length, hint]);
    await audit(req, 'cc_user_session_revoke', `user#${id}`, hint);
    res.json({ ok: true, removed: rowCount });
  }));

  // ── Site anahtarları ───────────────────────────────────────────────────────
  app.get('/api/admin/cc/switches', ...guard, safe(async (req, res) => {
    const keys = [...SWITCH_KEYS, 'site_maintenance_message'];
    const { rows } = await query('SELECT key, value FROM settings WHERE key = ANY($1)', [keys]);
    const map = Object.fromEntries(rows.map(row => [row.key, row.value]));
    res.json({
      switches: SWITCHES.map(item => ({
        ...item,
        value: map[item.key] === undefined ? !!item.defaultOn : map[item.key] === '1'
      })),
      maintenance_message: map.site_maintenance_message || ''
    });
  }));

  app.put('/api/admin/cc/switches', ...guard, safe(async (req, res) => {
    const key = String(req.body?.key || '');
    if (key === 'site_maintenance_message') {
      const value = String(req.body?.value || '').trim().slice(0, 300);
      await query('INSERT INTO settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', [key, value]);
      await refreshEmergency();
      return res.json({ ok: true });
    }
    if (!SWITCH_KEYS.has(key)) return res.status(400).json({ error: 'Bilinmeyen anahtar.' });
    const value = req.body?.value === true || req.body?.value === 1 || req.body?.value === '1' ? '1' : '0';
    await query('INSERT INTO settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', [key, value]);
    if (key.startsWith('nsfw_')) deps.onNsfwChange?.();
    await refreshEmergency();
    await audit(req, 'cc_switch', key, value);
    res.json({ ok: true, key, value: value === '1' });
  }));

  // ── Yükleme hataları ───────────────────────────────────────────────────────
  app.get('/api/admin/cc/upload-failures', ...guard, safe(async (req, res) => {
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 100, 1), 500);
    const { rows } = await query(`SELECT id, actor, target AS stage, detail, ip, device, operating_system, user_agent, created_at
      FROM system_logs WHERE action='upload_failed' ORDER BY created_at DESC LIMIT $1`, [limit]);
    res.json(rows.map(row => {
      let detail = {};
      try { detail = JSON.parse(row.detail || '{}'); } catch {}
      return { ...row, detail };
    }));
  }));

  // ── Denetim kaydı (tüm yönetici işlemleri) ─────────────────────────────────
  app.get('/api/admin/cc/audit', ...guard, safe(async (req, res) => {
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 200, 1), 1000);
    const params = [];
    const where = [];
    const q = String(req.query.q || '').trim().slice(0, 120);
    if (q) { params.push(`%${q}%`); where.push(`(actor ILIKE $1 OR action ILIKE $1 OR target ILIKE $1 OR detail ILIKE $1)`); }
    if (req.query.action) { params.push(String(req.query.action).slice(0, 64)); where.push(`action=$${params.length}`); }
    params.push(limit);
    const { rows } = await query(`SELECT id, actor, action, target, detail, ip, device, created_at FROM system_logs
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT $${params.length}`, params);
    res.json(rows);
  }));

  return { CONTENT_TYPES, SWITCHES, refreshEmergency, emergency };
}

module.exports = { registerAdminControl, CONTENT_TYPES, SWITCHES };
