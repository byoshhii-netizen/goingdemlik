'use strict';
/**
 * CigCig SEO modülü
 * ------------------------------------------------------------------
 * - robots.txt
 * - Site haritası dizini (/sitemap.xml) + içerik türüne göre ayrı site haritaları
 *   (görsel ve video etiketleriyle; Google Görseller ve Google Videolar için)
 * - Ana sayfa, profil sayfaları ve /arama için sunucu taraflı içerik (Google'ın
 *   JavaScript çalıştırmadan da görebilmesi için)
 * - Özel sayfalara (mesajlar, ayarlar, siparişler...) noindex
 * - BreadcrumbList (sayfa yolu) ve yorum şemaları için yardımcılar
 * - İsteğe bağlı IndexNow (Bing / Yandex'e yeni içerikleri anında bildirir)
 *
 * server.js içinden kullanılır:
 *   const seo = createSeo({ query, escapeHtml, SITE_URL, profileRouteKey, profileRouteSql, ... });
 *   seo.registerCrawlerRoutes(app);   // robots + sitemap (middleware'lerden önce)
 *   seo.registerPages(app);           // sayfa route'ları (koruma middleware'lerinden sonra)
 */

const SITEMAP_PAGE_SIZE = 40000;
const SITEMAP_CACHE_MS = 30 * 60 * 1000;

const SECTIONS = {
  forum: { name: 'Konular', path: '/forum' },
  konular: { name: 'Konular', path: '/forum' },
  siir: { name: 'Şiirler', path: '/siirler' },
  siirler: { name: 'Şiirler', path: '/siirler' },
  kitap: { name: 'Kitaplar', path: '/kitaplar' },
  kitaplar: { name: 'Kitaplar', path: '/kitaplar' },
  muzik: { name: 'Müzikler', path: '/muzikler' },
  muzikler: { name: 'Müzikler', path: '/muzikler' },
  video: { name: 'Videolar', path: '/video' },
  videolar: { name: 'Videolar', path: '/video' },
  reals: { name: 'Reals', path: '/reals' },
  foto: { name: 'Fotoğraflar', path: '/fotograflar' },
  fotograflar: { name: 'Fotoğraflar', path: '/fotograflar' },
  gazete: { name: 'Gazeteler', path: '/gazeteler' },
  gazeteler: { name: 'Gazeteler', path: '/gazeteler' },
  grup: { name: 'Gruplar', path: '/gruplar' },
  gruplar: { name: 'Gruplar', path: '/gruplar' },
  profil: { name: 'Profiller', path: null },
  medyakesfet: { name: 'Keşfet', path: '/medyakesfet' },
  magaza: { name: 'Mağaza', path: '/magaza' },
  arama: { name: 'Arama', path: '/arama' },
};

// Ana sayfada ve şemada listelenen bölümler. Google'ın "CigCig" aramasında site
// bağlantılarını (sitelinks) seçerken kullandığı iç bağlantı yapısını güçlendirir.
const HOME_SECTIONS = [
  { name: 'Konular', path: '/forum', desc: 'Ekşi tadında topluluk konuları, tartışmalar ve yorumlar.' },
  { name: 'Şiirler', path: '/siirler', desc: 'Topluluğun kaleminden şiirler.' },
  { name: 'Kitaplar', path: '/kitaplar', desc: 'Ücretsiz okunabilen e-kitaplar ve bölümleri.' },
  { name: 'Müzikler', path: '/muzikler', desc: 'Sanatçıların paylaştığı müzikler, sözler ve playlistler.' },
  { name: 'Videolar', path: '/video', desc: 'Topluluğun paylaştığı videolar.' },
  { name: 'Reals', path: '/reals', desc: 'Kısa dikey videolar.' },
  { name: 'Fotoğraflar', path: '/fotograflar', desc: 'Herkese açık fotoğraflar.' },
  { name: 'Gazeteler', path: '/gazeteler', desc: 'CigCig basın arşivi ve gazete sayıları.' },
  { name: 'Gruplar', path: '/gruplar', desc: 'İlgi alanlarına göre topluluk grupları.' },
  { name: 'Keşfet', path: '/medyakesfet', desc: 'Fotoğraf, video ve Reals keşfet akışı.' },
  { name: 'Mağaza', path: '/magaza', desc: 'CigCig Plus, VIP ve diğer ürünler.' },
];

// Arama motorlarında görünmemesi gereken kişisel sayfalar.
const PRIVATE_PAGES = [
  ['/ayarlar', 'Ayarlar – CigCig'],
  ['/mesajlar', 'Mesajlar – CigCig'],
  ['/arkadaslar', 'Arkadaşlar – CigCig'],
  ['/siparislerim', 'Siparişlerim – CigCig'],
  ['/bildirimler', 'Bildirimler – CigCig'],
  ['/playlistlerim', 'Playlistlerim – CigCig'],
  ['/sarki-yukle', 'Müzik Paylaş – CigCig'],
  ['/artist-panel', 'Artist Panel – CigCig'],
];

const NOINDEX_META = '<meta name="robots" content="noindex, follow" />';

function createSeo(deps) {
  const {
    query, escapeHtml, SITE_URL, profileRouteKey, profileRouteSql,
    injectMeta, serverPageBody, serverProfileLink, serverImage, safeJsonLd, sendUncachedAppHtml,
  } = deps;

  // ---------- küçük yardımcılar ----------
  const abs = (p) => (/^https?:\/\//i.test(String(p || '')) ? String(p) : `${SITE_URL}${String(p || '').startsWith('/') ? '' : '/'}${p || ''}`);
  const xml = (s) => escapeHtml(s).replace(/'/g, '&apos;');
  const iso = (d) => { if (!d) return ''; const t = new Date(d); return Number.isNaN(t.getTime()) ? '' : t.toISOString(); };
  const trDate = (d) => { const s = iso(d); return s ? new Date(s).toLocaleDateString('tr-TR') : ''; };

  function plain(text, max = 160) {
    const t = String(text || '')
      .replace(/\[\[cigcig-image:[^\]]+\]\]/g, ' ')
      .replace(/\*\*/g, '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (t.length <= max) return t;
    const cut = t.slice(0, max - 1);
    const sp = cut.lastIndexOf(' ');
    return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).trim()}…`;
  }

  function isoDuration(seconds) {
    const s = Math.round(Number(seconds) || 0);
    if (s <= 0) return undefined;
    const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const sec = s % 60;
    return `PT${h ? `${h}H` : ''}${m ? `${m}M` : ''}${sec || (!h && !m) ? `${sec}S` : ''}`;
  }

  async function rows(sql, params = []) {
    try { return (await query(sql, params)).rows; } catch (error) {
      console.warn('[SEO] sorgu atlandı:', error.message);
      return [];
    }
  }

  function profileUrl(username) { return `${SITE_URL}/profil/${profileRouteKey(username)}`; }
  function personLd(username) {
    return username ? { '@type': 'Person', name: username, url: profileUrl(username) } : { '@type': 'Person', name: 'Anonim' };
  }

  // ---------- sayfa yolu (breadcrumb) ----------
  function cleanTitle(title) {
    return String(title || '').split(/\s+[–|-]\s+/)[0].trim() || 'CigCig';
  }

  function breadcrumbItems(url, title) {
    let pathname = '/';
    try { pathname = new URL(url, SITE_URL).pathname; } catch {}
    const segs = pathname.split('/').filter(Boolean);
    const items = [{ name: 'CigCig', url: `${SITE_URL}/` }];
    if (!segs.length) return items;
    const section = SECTIONS[segs[0]];
    if (!section) { items.push({ name: cleanTitle(title), url: abs(pathname) }); return items; }
    const isListPage = section.path === pathname || (segs.length === 1);
    if (isListPage) { items.push({ name: section.name, url: abs(section.path || pathname) }); return items; }
    if (section.path) items.push({ name: section.name, url: abs(section.path) });
    items.push({ name: cleanTitle(title), url: abs(pathname) });
    return items;
  }

  function breadcrumbLd(items) {
    return {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: it.url })),
    };
  }

  function breadcrumbScript(url, title) {
    const items = breadcrumbItems(url, title);
    if (items.length < 2) return '';
    return `<script type="application/ld+json">${safeJsonLd(breadcrumbLd(items))}</script>`;
  }

  function ogTypeFor(url) {
    let seg = '';
    try { seg = new URL(url, SITE_URL).pathname.split('/').filter(Boolean)[0] || ''; } catch {}
    const detail = (() => { try { return new URL(url, SITE_URL).pathname.split('/').filter(Boolean).length > 1; } catch { return false; } })();
    if (!detail) return 'website';
    if (seg === 'profil') return 'profile';
    if (seg === 'video' || seg === 'reals') return 'video.other';
    if (seg === 'muzik') return 'music.song';
    if (seg === 'kitap') return 'book';
    return 'article';
  }

  // ---------- yorumlar ----------
  function commentsHtml(comments, heading = 'Yorumlar') {
    if (!comments || !comments.length) return '';
    return `<section class="seo-comments"><h2>${escapeHtml(heading)} (${comments.length})</h2>${comments.map(c => `<article class="seo-comment" id="yorum-${escapeHtml(c.id || '')}">
        <div class="seo-comment-author">${serverProfileLink(c.username)} <time datetime="${escapeHtml(iso(c.created_at))}">${escapeHtml(trDate(c.created_at))}</time></div>
        <p>${escapeHtml(c.content)}</p>
      </article>`).join('')}</section>`;
  }

  function commentsLd(comments, pageUrl, max = 50) {
    if (!comments || !comments.length) return undefined;
    return comments.slice(0, max).map(c => ({
      '@type': 'Comment',
      ...(c.id ? { url: `${pageUrl}#yorum-${c.id}` } : {}),
      text: plain(c.content, 1000),
      datePublished: iso(c.created_at) || undefined,
      author: personLd(c.username),
    }));
  }

  function counter(type, count) {
    return { '@type': 'InteractionCounter', interactionType: `https://schema.org/${type}`, userInteractionCount: Number(count) || 0 };
  }

  // =====================================================================
  // ROBOTS.TXT
  // =====================================================================
  function robotsTxt() {
    return [
      'User-agent: *',
      'Allow: /',
      'Allow: /api/image-proxy',
      'Disallow: /api/',
      'Disallow: /ayarlar',
      'Disallow: /mesajlar',
      'Disallow: /arkadaslar',
      'Disallow: /siparislerim',
      'Disallow: /bildirimler',
      'Disallow: /playlistlerim',
      'Disallow: /sarki-yukle',
      'Disallow: /artist-panel',
      'Disallow: /reklampanel',
      'Disallow: /hikaye/',
      'Disallow: /ortak-dinleyis/',
      'Disallow: /*?*sort=',
      '',
      'User-agent: Googlebot-Image',
      'Allow: /',
      '',
      `Sitemap: ${SITE_URL}/sitemap.xml`,
      '',
    ].join('\n');
  }

  // =====================================================================
  // SİTE HARİTALARI
  // =====================================================================
  const userOk = (alias) => `COALESCE(${alias}.is_private,0)=0 AND COALESCE(${alias}.is_deleted,0)=0 AND COALESCE(${alias}.banned,0)=0`;
  const notHidden = (type, col) => `NOT EXISTS (SELECT 1 FROM content_suspensions cs WHERE cs.content_type='${type}' AND cs.content_id=${col})
        AND NOT EXISTS (SELECT 1 FROM user_content_archive a WHERE a.content_type='${type}' AND a.content_id=${col}::text)`;

  const SITEMAP_TYPES = {
    konular: {
      from: `FROM forums f LEFT JOIN users u ON u.id=f.user_id WHERE ${userOk('u')} AND ${notHidden('forum', 'f.id')}`,
      select: 'f.slug, f.title, f.content, f.banner_image, f.thumbnail, f.created_at, f.updated_at',
      order: 'f.updated_at DESC NULLS LAST, f.id DESC',
      map: r => ({
        loc: `/forum/${encodeURIComponent(r.slug)}`, lastmod: r.updated_at || r.created_at, changefreq: 'daily', priority: '0.8',
        images: [r.banner_image || r.thumbnail].filter(Boolean).map(src => ({ loc: src, title: r.title })),
      }),
    },
    etiketler: {
      from: `FROM tags t WHERE EXISTS (SELECT 1 FROM forum_tags ft WHERE ft.tag_id=t.id)`,
      select: 't.name',
      order: 't.name ASC',
      map: r => ({ loc: `/forum?tag=${encodeURIComponent(r.name)}`, changefreq: 'daily', priority: '0.6' }),
    },
    siirler: {
      from: `FROM poems p JOIN users u ON u.id=p.user_id WHERE COALESCE(p.is_hidden,0)=0 AND ${userOk('u')} AND ${notHidden('poem', 'p.id')}`,
      select: 'p.slug, p.updated_at, p.created_at',
      order: 'p.created_at DESC, p.id DESC',
      map: r => ({ loc: `/siir/${encodeURIComponent(r.slug)}`, lastmod: r.updated_at || r.created_at, changefreq: 'weekly', priority: '0.7' }),
    },
    kitaplar: {
      from: `FROM books b LEFT JOIN users u ON u.id=b.user_id WHERE b.is_hidden=0 AND COALESCE(b.is_unnamed,0)=0 AND COALESCE(b.password_hash,'')='' AND ${userOk('u')} AND ${notHidden('book', 'b.id')}`,
      select: 'b.slug, b.title, b.cover_image, b.updated_at',
      order: 'b.updated_at DESC NULLS LAST, b.id DESC',
      map: r => ({
        loc: `/kitap/${encodeURIComponent(r.slug)}`, lastmod: r.updated_at, changefreq: 'weekly', priority: '0.7',
        images: r.cover_image ? [{ loc: r.cover_image, title: `${r.title} kitap kapağı` }] : [],
      }),
    },
    'kitap-sayfalari': {
      from: `FROM book_pages bp JOIN books b ON b.id=bp.book_id LEFT JOIN users u ON u.id=b.user_id
        WHERE bp.is_published=1 AND b.is_hidden=0 AND COALESCE(b.is_unnamed,0)=0 AND COALESCE(b.password_hash,'')='' AND ${userOk('u')} AND ${notHidden('book', 'b.id')}`,
      select: 'bp.slug AS page_slug, b.slug AS book_slug, bp.created_at',
      order: 'bp.created_at DESC, bp.id DESC',
      map: r => ({ loc: `/kitap/${encodeURIComponent(r.book_slug)}/sayfa/${encodeURIComponent(r.page_slug)}`, lastmod: r.created_at, changefreq: 'monthly', priority: '0.6' }),
    },
    muzikler: {
      from: `FROM songs s LEFT JOIN users u ON u.id=s.uploader_id WHERE s.status='active' AND ${userOk('u')} AND ${notHidden('song', 's.id')}`,
      select: 's.slug, s.title, s.artist_name, s.cover_url, s.published_at',
      order: 's.published_at DESC NULLS LAST, s.id DESC',
      map: r => ({
        loc: `/muzik/${encodeURIComponent(r.slug)}`, lastmod: r.published_at, changefreq: 'monthly', priority: '0.6',
        images: r.cover_url ? [{ loc: r.cover_url, title: `${r.title} – ${r.artist_name}` }] : [],
      }),
    },
    fotograflar: {
      from: `FROM photos p LEFT JOIN users u ON u.id=p.user_id WHERE ${userOk('u')} AND COALESCE(p.close_friends_only,0)=0 AND COALESCE(p.is_nsfw,0)=0 AND ${notHidden('photo', 'p.id')}`,
      select: 'p.id, p.url, p.title, p.caption, p.location, p.created_at, u.username',
      order: 'p.created_at DESC, p.id DESC',
      map: r => ({
        loc: `/foto/${encodeURIComponent(r.id)}`, lastmod: r.created_at, changefreq: 'monthly', priority: '0.6',
        images: [{ loc: r.url, title: r.title || plain(r.caption, 90) || `${r.username || 'CigCig'} fotoğrafı`, caption: plain(r.caption, 300), geo: r.location }],
      }),
    },
    videolar: {
      from: `FROM videos v JOIN users u ON u.id=v.user_id WHERE v.is_reals=0 AND COALESCE(v.is_nsfw,0)=0 AND ${userOk('u')} AND ${notHidden('video', 'v.id')}`,
      select: 'v.id, v.slug, v.title, v.description, v.video_url, v.thumbnail_url, v.duration_seconds, v.views, v.created_at, u.username',
      order: 'v.created_at DESC, v.id DESC',
      map: r => ({ loc: `/video/${encodeURIComponent(r.slug || r.id)}`, lastmod: r.created_at, changefreq: 'weekly', priority: '0.7', video: r }),
    },
    reals: {
      from: `FROM videos v JOIN users u ON u.id=v.user_id WHERE v.is_reals=1 AND COALESCE(v.is_nsfw,0)=0 AND ${userOk('u')} AND ${notHidden('reals', 'v.id')}`,
      select: 'v.id, v.title, v.description, v.video_url, v.thumbnail_url, v.duration_seconds, v.views, v.created_at, u.username',
      order: 'v.created_at DESC, v.id DESC',
      map: r => ({ loc: `/reals/${encodeURIComponent(r.id)}`, lastmod: r.created_at, changefreq: 'weekly', priority: '0.7', video: r }),
    },
    gazeteler: {
      from: `FROM newspapers n JOIN users u ON u.id=n.journalist_id WHERE ${userOk('u')} AND ${notHidden('newspaper', 'n.id')}`,
      select: 'n.id, n.newspaper_name, n.image_url, n.created_at',
      order: 'n.newspaper_date DESC NULLS LAST, n.created_at DESC',
      map: r => ({
        loc: `/gazete/${encodeURIComponent(r.id)}`, lastmod: r.created_at, changefreq: 'monthly', priority: '0.5',
        images: r.image_url ? [{ loc: r.image_url, title: `${r.newspaper_name} gazete sayısı` }] : [],
      }),
    },
    gruplar: {
      from: `FROM groups g WHERE COALESCE(g.visibility,'public')='public' AND COALESCE(g.moderation_status,'active')='active'`,
      select: 'g.slug, g.name, g.cover_image',
      order: 'g.member_count DESC NULLS LAST, g.id DESC',
      map: r => ({
        loc: `/grup/${encodeURIComponent(r.slug)}`, changefreq: 'weekly', priority: '0.6',
        images: r.cover_image ? [{ loc: r.cover_image, title: r.name }] : [],
      }),
    },
    profiller: {
      from: `FROM users u WHERE ${userOk('u')}`,
      select: 'u.username, u.avatar, u.last_active',
      order: 'u.last_active DESC NULLS LAST, u.id DESC',
      map: r => ({
        loc: `/profil/${profileRouteKey(r.username)}`, lastmod: r.last_active, changefreq: 'weekly', priority: '0.5',
        images: r.avatar && /^https?:\/\//i.test(r.avatar) ? [{ loc: r.avatar, title: `${r.username} profil fotoğrafı` }] : [],
      }),
    },
  };

  const STATIC_URLS = [
    { loc: '/', changefreq: 'daily', priority: '1.0' },
    ...HOME_SECTIONS.map(s => ({ loc: s.path, changefreq: 'daily', priority: s.path === '/forum' ? '0.9' : '0.8' })),
    { loc: '/giris', changefreq: 'yearly', priority: '0.3' },
    { loc: '/kayit', changefreq: 'yearly', priority: '0.4' },
    { loc: '/artist-basvuru', changefreq: 'yearly', priority: '0.3' },
  ];

  const cache = new Map();
  async function cached(key, fn) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < SITEMAP_CACHE_MS) return hit.value;
    const value = await fn();
    cache.set(key, { at: Date.now(), value });
    return value;
  }

  function urlXml(entry) {
    const parts = [`<loc>${xml(abs(entry.loc))}</loc>`];
    const lm = iso(entry.lastmod);
    if (lm) parts.push(`<lastmod>${lm}</lastmod>`);
    if (entry.changefreq) parts.push(`<changefreq>${entry.changefreq}</changefreq>`);
    if (entry.priority) parts.push(`<priority>${entry.priority}</priority>`);
    for (const img of entry.images || []) {
      if (!img.loc) continue;
      parts.push(`<image:image><image:loc>${xml(abs(img.loc))}</image:loc>${img.title ? `<image:title>${xml(img.title)}</image:title>` : ''}${img.caption ? `<image:caption>${xml(img.caption)}</image:caption>` : ''}${img.geo ? `<image:geo_location>${xml(img.geo)}</image:geo_location>` : ''}</image:image>`);
    }
    const v = entry.video;
    if (v && v.thumbnail_url && v.video_url) {
      const title = v.title || (v.description ? plain(v.description, 90) : `${v.username || 'CigCig'} videosu`);
      const desc = plain(v.description || title, 2000) || title;
      const dur = Math.round(Number(v.duration_seconds) || 0);
      parts.push(`<video:video>
      <video:thumbnail_loc>${xml(abs(v.thumbnail_url))}</video:thumbnail_loc>
      <video:title>${xml(plain(title, 100))}</video:title>
      <video:description>${xml(desc)}</video:description>
      <video:content_loc>${xml(abs(v.video_url))}</video:content_loc>${dur > 0 && dur <= 28800 ? `
      <video:duration>${dur}</video:duration>` : ''}${Number(v.views) > 0 ? `
      <video:view_count>${Number(v.views)}</video:view_count>` : ''}${iso(v.created_at) ? `
      <video:publication_date>${iso(v.created_at)}</video:publication_date>` : ''}
      <video:family_friendly>yes</video:family_friendly>${v.username ? `
      <video:uploader info="${xml(profileUrl(v.username))}">${xml(v.username)}</video:uploader>` : ''}
    </video:video>`);
    }
    return `  <url>${parts.join('\n    ')}</url>`;
  }

  function urlset(entries) {
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
      '        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"',
      '        xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">',
      ...entries.map(urlXml),
      '</urlset>',
    ].join('\n');
  }

  async function sitemapIndexXml() {
    const now = new Date().toISOString();
    const lines = [`  <sitemap><loc>${SITE_URL}/sitemap-sayfalar.xml</loc><lastmod>${now}</lastmod></sitemap>`];
    for (const [name, def] of Object.entries(SITEMAP_TYPES)) {
      const info = (await rows(`SELECT COUNT(*)::int AS c ${def.from}`))[0];
      const count = Number(info?.c || 0);
      if (!count) continue;
      const pages = Math.ceil(count / SITEMAP_PAGE_SIZE);
      for (let p = 1; p <= pages; p += 1) {
        lines.push(`  <sitemap><loc>${SITE_URL}/sitemap-${name}${p > 1 ? `-${p}` : ''}.xml</loc><lastmod>${now}</lastmod></sitemap>`);
      }
    }
    return ['<?xml version="1.0" encoding="UTF-8"?>', '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">', ...lines, '</sitemapindex>'].join('\n');
  }

  async function typeSitemapXml(name, page) {
    if (name === 'sayfalar') return urlset(STATIC_URLS.map(u => ({ ...u, lastmod: new Date() })));
    const def = SITEMAP_TYPES[name];
    if (!def) return null;
    const offset = (Math.max(1, page) - 1) * SITEMAP_PAGE_SIZE;
    const data = await rows(`SELECT ${def.select} ${def.from} ORDER BY ${def.order} LIMIT ${SITEMAP_PAGE_SIZE} OFFSET ${offset}`);
    return urlset(data.map(def.map));
  }

  function registerCrawlerRoutes(app) {
    app.get('/robots.txt', (req, res) => {
      res.type('text/plain');
      res.set('Cache-Control', 'public, max-age=3600');
      res.send(robotsTxt());
    });

    app.get('/sitemap.xml', async (req, res) => {
      try {
        const body = await cached('index', sitemapIndexXml);
        res.type('application/xml');
        res.set('Cache-Control', 'public, max-age=1800');
        res.send(body);
      } catch (error) {
        console.error('[SEO] sitemap index hatası:', error.message);
        res.status(500).type('text/plain').send('sitemap error');
      }
    });

    app.get(/^\/sitemap-([a-z-]+?)(?:-(\d+))?\.xml$/, async (req, res, next) => {
      const name = req.params[0];
      const page = Number(req.params[1] || 1);
      if (name !== 'sayfalar' && !SITEMAP_TYPES[name]) return next();
      try {
        const body = await cached(`${name}:${page}`, () => typeSitemapXml(name, page));
        if (!body) return next();
        res.type('application/xml');
        res.set('Cache-Control', 'public, max-age=1800');
        res.send(body);
      } catch (error) {
        console.error('[SEO] sitemap hatası:', name, error.message);
        res.status(500).type('text/plain').send('sitemap error');
      }
    });

    // Eski Google Search Console kayıtları için: tek dosyalık görsel/video haritası isteyenler dizine yönlensin.
    app.get(['/sitemap_index.xml', '/sitemap-index.xml'], (req, res) => res.redirect(301, '/sitemap.xml'));

    // IndexNow anahtar dosyası (INDEXNOW_KEY tanımlıysa)
    const key = String(process.env.INDEXNOW_KEY || '').trim();
    if (/^[a-zA-Z0-9-]{8,128}$/.test(key)) {
      app.get(`/${key}.txt`, (req, res) => res.type('text/plain').send(key));
    }
  }

  // =====================================================================
  // SAYFALAR
  // =====================================================================
  function homeBodyCards(items, hrefFn, titleFn, textFn) {
    if (!items.length) return '';
    return `<ul>${items.map(it => `<li><a href="${escapeHtml(hrefFn(it))}">${escapeHtml(titleFn(it))}</a>${textFn ? `<span>${escapeHtml(textFn(it))}</span>` : ''}</li>`).join('')}</ul>`;
  }

  async function renderHome(req, res) {
    const [forums, poems, books, songs, videos] = await Promise.all([
      rows(`SELECT f.slug, f.title, f.content, u.username FROM forums f LEFT JOIN users u ON u.id=f.user_id
        WHERE ${userOk('u')} AND ${notHidden('forum', 'f.id')} ORDER BY f.created_at DESC LIMIT 12`),
      rows(`SELECT p.slug, p.title, u.username FROM poems p JOIN users u ON u.id=p.user_id
        WHERE COALESCE(p.is_hidden,0)=0 AND ${userOk('u')} AND ${notHidden('poem', 'p.id')} ORDER BY p.created_at DESC LIMIT 8`),
      rows(`SELECT b.slug, b.title, b.author_name, u.username FROM books b LEFT JOIN users u ON u.id=b.user_id
        WHERE b.is_hidden=0 AND COALESCE(b.is_unnamed,0)=0 AND COALESCE(b.password_hash,'')='' AND ${userOk('u')} AND ${notHidden('book', 'b.id')}
        ORDER BY b.updated_at DESC NULLS LAST LIMIT 8`),
      rows(`SELECT s.slug, s.title, s.artist_name FROM songs s LEFT JOIN users u ON u.id=s.uploader_id
        WHERE s.status='active' AND ${userOk('u')} AND ${notHidden('song', 's.id')} ORDER BY s.published_at DESC NULLS LAST LIMIT 8`),
      rows(`SELECT v.id, v.slug, v.title, v.is_reals FROM videos v JOIN users u ON u.id=v.user_id
        WHERE COALESCE(v.is_nsfw,0)=0 AND ${userOk('u')} ORDER BY v.created_at DESC LIMIT 8`),
    ]);
    const title = 'CigCig – Forum, Video, Reals ve Topluluk Platformu';
    const description = 'CigCig; forum konuları, videolar, Reals kısa videoları, şiirler, kitaplar, müzik ve toplulukları bir araya getiren Türkçe sosyal platform.';
    const sectionsHtml = `<section class="seo-profile-section"><h2>CigCig'de neler var?</h2><ul>${HOME_SECTIONS.map(s => `<li><a href="${s.path}">${escapeHtml(s.name)}</a><span>${escapeHtml(s.desc)}</span></li>`).join('')}</ul></section>`;
    const latest = [
      ['Son konular', '/forum', homeBodyCards(forums, f => `/forum/${f.slug}`, f => f.title, f => plain(f.content, 140))],
      ['Yeni şiirler', '/siirler', homeBodyCards(poems, p => `/siir/${p.slug}`, p => p.title, p => p.username ? `Şair: ${p.username}` : '')],
      ['Kitaplar', '/kitaplar', homeBodyCards(books, b => `/kitap/${b.slug}`, b => b.title, b => b.author_name || b.username || '')],
      ['Müzikler', '/muzikler', homeBodyCards(songs, s => `/muzik/${s.slug}`, s => `${s.title} – ${s.artist_name}`)],
      ['Videolar ve Reals', '/video', homeBodyCards(videos, v => (Number(v.is_reals) === 1 ? `/reals/${v.id}` : `/video/${v.slug || v.id}`), v => v.title || 'CigCig videosu')],
    ].filter(([, , html]) => html).map(([h, href, html]) => `<section class="seo-profile-section"><h2><a href="${href}">${escapeHtml(h)}</a></h2>${html}</section>`).join('');
    const body = serverPageBody('TÜRKÇE TOPLULUK PLATFORMU', 'CigCig', 'Forum konuları, şiirler, kitaplar, müzikler, videolar, Reals ve gruplar tek bir yerde. Hemen keşfet ya da ücretsiz kaydol.', sectionsHtml + latest);
    const navLd = {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: 'CigCig bölümleri',
      itemListElement: HOME_SECTIONS.map((s, i) => ({
        '@type': 'SiteNavigationElement', position: i + 1, name: s.name, description: s.desc, url: abs(s.path),
      })),
    };
    res.send(injectMeta(title, description, `${SITE_URL}/`, '', `<script type="application/ld+json">${safeJsonLd(navLd)}</script>`, body));
  }

  async function renderProfile(req, res) {
    const key = String(req.params.username || '');
    const user = (await rows(`SELECT * FROM users WHERE username=$1 OR ${profileRouteSql}=$2 ORDER BY (username=$1) DESC LIMIT 1`, [key, profileRouteKey(key)]))[0];
    if (!user || Number(user.is_deleted) === 1 || Number(user.banned) === 1) {
      return res.status(404).send(injectMeta('Kullanıcı bulunamadı – CigCig', 'Bu profil bulunamadı.', `${SITE_URL}/profil/${profileRouteKey(key)}`, '', NOINDEX_META));
    }
    const username = user.username;
    const url = profileUrl(username);
    const avatar = Number(user.avatar_removed) === 1 ? '' : (user.avatar || '');
    const avatarAbs = avatar ? abs(avatar) : '';
    const counts = (await rows(`SELECT
      (SELECT COUNT(*) FROM follows WHERE following_id=$1 AND status='accepted')::int AS followers,
      (SELECT COUNT(*) FROM follows WHERE follower_id=$1 AND status='accepted')::int AS following`, [user.id]))[0] || {};

    if (Number(user.is_private) === 1) {
      const desc = `${username} adlı kullanıcının CigCig profili. Bu hesap gizli.`;
      const body = serverPageBody('CİGCİG PROFİL', `@${username}`, 'Bu hesap gizli. Paylaşımları görmek için takip et.', `<div class="seo-profile-card">${avatar ? serverImage(avatar, `${username} profil fotoğrafı`, 'seo-profile-avatar') : ''}<p>${counts.followers || 0} takipçi · ${counts.following || 0} takip</p></div>`);
      return res.send(injectMeta(`${username} (@${username}) – CigCig`, desc, url, avatarAbs, NOINDEX_META, body));
    }

    const uid = [user.id];
    const [forums, poems, books, photos, videos, songs] = await Promise.all([
      rows(`SELECT f.slug, f.title, f.content, f.created_at FROM forums f WHERE f.user_id=$1 AND ${notHidden('forum', 'f.id')} ORDER BY f.created_at DESC LIMIT 20`, uid),
      rows(`SELECT p.slug, p.title, p.content, p.created_at FROM poems p WHERE p.user_id=$1 AND COALESCE(p.is_hidden,0)=0 AND ${notHidden('poem', 'p.id')} ORDER BY p.created_at DESC LIMIT 20`, uid),
      rows(`SELECT b.slug, b.title, b.preface, b.cover_image FROM books b WHERE b.user_id=$1 AND b.is_hidden=0 AND COALESCE(b.is_unnamed,0)=0 AND COALESCE(b.password_hash,'')='' AND ${notHidden('book', 'b.id')} ORDER BY b.updated_at DESC NULLS LAST LIMIT 12`, uid),
      rows(`SELECT p.id, p.url, p.title, p.caption FROM photos p WHERE p.user_id=$1 AND COALESCE(p.close_friends_only,0)=0 AND COALESCE(p.is_nsfw,0)=0 AND ${notHidden('photo', 'p.id')} ORDER BY p.created_at DESC LIMIT 24`, uid),
      rows(`SELECT v.id, v.slug, v.title, v.is_reals, v.thumbnail_url FROM videos v WHERE v.user_id=$1 AND COALESCE(v.is_nsfw,0)=0 ORDER BY v.created_at DESC LIMIT 12`, uid),
      rows(`SELECT s.slug, s.title, s.artist_name FROM songs s WHERE s.uploader_id=$1 AND s.status='active' AND ${notHidden('song', 's.id')} ORDER BY s.published_at DESC NULLS LAST LIMIT 12`, uid),
    ]);

    let links = [];
    try {
      const parsed = JSON.parse(user.links || '[]');
      links = (Array.isArray(parsed) ? parsed : []).map(l => (typeof l === 'string' ? l : (l && (l.url || l.href)) || '')).filter(l => /^https?:\/\//i.test(l)).slice(0, 10);
    } catch {}

    const bio = plain(user.bio, 300);
    const parts = [];
    if (forums.length) parts.push('konular'); if (poems.length) parts.push('şiirler'); if (books.length) parts.push('kitaplar');
    if (photos.length) parts.push('fotoğraflar'); if (videos.length) parts.push('videolar'); if (songs.length) parts.push('müzikler');
    const description = plain(`${bio ? `${bio} · ` : ''}${username} CigCig profili: ${counts.followers || 0} takipçi${parts.length ? `, ${parts.join(', ')}` : ''}.`, 160);

    const list = (title, items, href, label, sub) => (items.length ? `<section class="seo-profile-section"><h2>${escapeHtml(title)}</h2><ul>${items.map(it => `<li><a href="${escapeHtml(href(it))}">${escapeHtml(label(it))}</a>${sub ? `<span>${escapeHtml(sub(it))}</span>` : ''}</li>`).join('')}</ul></section>` : '');
    const photosHtml = photos.length ? `<section class="seo-profile-section"><h2>Fotoğraflar</h2><div class="seo-profile-photos">${photos.map(p => `<a href="/foto/${escapeHtml(p.id)}">${serverImage(p.url, p.title || plain(p.caption, 120) || `${username} fotoğrafı`, 'seo-profile-photo')}</a>`).join('')}</div></section>` : '';
    const body = serverPageBody('CİGCİG PROFİL', `${username} (@${username})`, bio, `<div class="seo-profile-card">
        ${avatar ? serverImage(avatar, `${username} profil fotoğrafı`, 'seo-profile-avatar') : ''}
        <p>${counts.followers || 0} takipçi · ${counts.following || 0} takip${user.created_at ? ` · ${escapeHtml(trDate(user.created_at))} tarihinden beri üye` : ''}</p>
        ${links.length ? `<p>${links.map(l => `<a href="${escapeHtml(l)}" rel="nofollow ugc noopener" target="_blank">${escapeHtml(l.replace(/^https?:\/\//, ''))}</a>`).join(' · ')}</p>` : ''}
      </div>
      ${list('Konular', forums, f => `/forum/${f.slug}`, f => f.title, f => plain(f.content, 140))}
      ${list('Şiirler', poems, p => `/siir/${p.slug}`, p => p.title, p => plain(p.content, 120))}
      ${list('Kitaplar', books, b => `/kitap/${b.slug}`, b => b.title, b => plain(b.preface, 120))}
      ${photosHtml}
      ${list('Videolar ve Reals', videos, v => (Number(v.is_reals) === 1 ? `/reals/${v.id}` : `/video/${v.slug || v.id}`), v => v.title || 'Video')}
      ${list('Müzikler', songs, s => `/muzik/${s.slug}`, s => `${s.title} – ${s.artist_name}`)}`);

    const postCount = forums.length + poems.length + books.length + photos.length + videos.length + songs.length;
    const ld = {
      '@context': 'https://schema.org',
      '@type': 'ProfilePage',
      url,
      ...(iso(user.created_at) ? { dateCreated: iso(user.created_at) } : {}),
      mainEntity: {
        '@type': 'Person',
        name: username,
        alternateName: `@${username}`,
        identifier: String(user.id),
        url,
        ...(bio ? { description: bio } : {}),
        ...(avatarAbs ? { image: avatarAbs } : {}),
        ...(links.length ? { sameAs: links } : {}),
        interactionStatistic: [counter('FollowAction', counts.followers)],
        agentInteractionStatistic: [counter('WriteAction', postCount), counter('FollowAction', counts.following)],
      },
      hasPart: [
        ...forums.slice(0, 10).map(f => ({ '@type': 'DiscussionForumPosting', headline: f.title, url: abs(`/forum/${f.slug}`), datePublished: iso(f.created_at) || undefined })),
        ...poems.slice(0, 10).map(p => ({ '@type': 'CreativeWork', name: p.title, url: abs(`/siir/${p.slug}`) })),
        ...photos.slice(0, 10).map(p => ({ '@type': 'ImageObject', contentUrl: abs(p.url), url: abs(`/foto/${p.id}`), name: p.title || plain(p.caption, 90) || undefined })),
      ],
    };
    res.send(injectMeta(`${username} (@${username}) – CigCig`, description, url, avatarAbs, `<script type="application/ld+json">${safeJsonLd(ld)}</script>`, body));
  }

  async function renderSearch(req, res) {
    const q = String(req.query.q || '').trim().slice(0, 100);
    const url = `${SITE_URL}/arama${q ? `?q=${encodeURIComponent(q)}` : ''}`;
    if (!q) {
      return res.send(injectMeta('Arama – CigCig', 'CigCig içinde konu, şiir, kitap, müzik, video ve kişi ara.', url, '', NOINDEX_META,
        serverPageBody('CİGCİG ARAMA', 'Ara', 'Konu, şiir, kitap, müzik, video ve kişi ara.', '')));
    }
    const like = `%${q.replace(/[%_\\]/g, m => `\\${m}`)}%`;
    const [forums, poems, books, songs, videos, users] = await Promise.all([
      rows(`SELECT f.slug, f.title, f.content FROM forums f LEFT JOIN users u ON u.id=f.user_id WHERE ${userOk('u')} AND ${notHidden('forum', 'f.id')}
        AND (f.title ILIKE $1 OR f.content ILIKE $1 OR COALESCE(f.custom_tags,'') ILIKE $1) ORDER BY (f.title ILIKE $1) DESC, f.created_at DESC LIMIT 15`, [like]),
      rows(`SELECT p.slug, p.title, p.content FROM poems p JOIN users u ON u.id=p.user_id WHERE COALESCE(p.is_hidden,0)=0 AND ${userOk('u')} AND ${notHidden('poem', 'p.id')}
        AND (p.title ILIKE $1 OR p.content ILIKE $1) ORDER BY (p.title ILIKE $1) DESC, p.created_at DESC LIMIT 10`, [like]),
      rows(`SELECT b.slug, b.title, b.preface FROM books b LEFT JOIN users u ON u.id=b.user_id WHERE b.is_hidden=0 AND COALESCE(b.is_unnamed,0)=0 AND COALESCE(b.password_hash,'')='' AND ${userOk('u')}
        AND (b.title ILIKE $1 OR b.author_name ILIKE $1 OR b.preface ILIKE $1) LIMIT 10`, [like]),
      rows(`SELECT s.slug, s.title, s.artist_name FROM songs s LEFT JOIN users u ON u.id=s.uploader_id WHERE s.status='active' AND ${userOk('u')}
        AND (s.title ILIKE $1 OR s.artist_name ILIKE $1 OR s.lyrics ILIKE $1) LIMIT 10`, [like]),
      rows(`SELECT v.id, v.slug, v.title, v.is_reals FROM videos v JOIN users u ON u.id=v.user_id WHERE COALESCE(v.is_nsfw,0)=0 AND ${userOk('u')}
        AND (v.title ILIKE $1 OR v.description ILIKE $1) ORDER BY v.created_at DESC LIMIT 10`, [like]),
      rows(`SELECT u.username, u.bio FROM users u WHERE ${userOk('u')} AND (u.username ILIKE $1 OR u.bio ILIKE $1) LIMIT 10`, [like]),
    ]);
    const list = (title, items, href, label, sub) => (items.length ? `<section class="seo-profile-section"><h2>${escapeHtml(title)}</h2><ul>${items.map(it => `<li><a href="${escapeHtml(href(it))}">${escapeHtml(label(it))}</a>${sub ? `<span>${escapeHtml(sub(it))}</span>` : ''}</li>`).join('')}</ul></section>` : '');
    const html = [
      list('Konular', forums, f => `/forum/${f.slug}`, f => f.title, f => plain(f.content, 140)),
      list('Şiirler', poems, p => `/siir/${p.slug}`, p => p.title, p => plain(p.content, 120)),
      list('Kitaplar', books, b => `/kitap/${b.slug}`, b => b.title, b => plain(b.preface, 120)),
      list('Müzikler', songs, s => `/muzik/${s.slug}`, s => `${s.title} – ${s.artist_name}`),
      list('Videolar', videos, v => (Number(v.is_reals) === 1 ? `/reals/${v.id}` : `/video/${v.slug || v.id}`), v => v.title || 'Video'),
      list('Kişiler', users, u => `/profil/${profileRouteKey(u.username)}`, u => `@${u.username}`, u => plain(u.bio, 100)),
    ].join('') || '<p class="seo-empty">Sonuç bulunamadı.</p>';
    res.send(injectMeta(`"${q}" araması – CigCig`, `CigCig'de "${q}" için konu, şiir, kitap, müzik, video ve kişi sonuçları.`, url, '', NOINDEX_META,
      serverPageBody('CİGCİG ARAMA', `"${q}" için sonuçlar`, '', html)));
  }

  function registerPages(app) {
    app.get(['/', '/index.html'], async (req, res) => {
      try { await renderHome(req, res); } catch (error) {
        console.warn('[SEO] ana sayfa SSR atlandı:', error.message);
        sendUncachedAppHtml(res);
      }
    });

    app.get('/profil/:username', async (req, res) => {
      try { await renderProfile(req, res); } catch (error) {
        console.warn('[SEO] profil SSR atlandı:', error.message);
        sendUncachedAppHtml(res);
      }
    });

    app.get('/arama', async (req, res) => {
      try { await renderSearch(req, res); } catch (error) {
        console.warn('[SEO] arama SSR atlandı:', error.message);
        sendUncachedAppHtml(res);
      }
    });

    app.get('/medyakesfet', (req, res) => res.send(injectMeta('Keşfet – CigCig', 'CigCig keşfet: topluluğun herkese açık fotoğrafları, videoları ve Reals kısa videoları.', `${SITE_URL}/medyakesfet`, '', '',
      serverPageBody('CİGCİG KEŞFET', 'Keşfet', 'Fotoğraf, video ve Reals keşfet akışı.', `<section class="seo-profile-section"><ul>
        <li><a href="/fotograflar">Fotoğraflar</a><span>Herkese açık fotoğraflar</span></li>
        <li><a href="/video">Videolar</a><span>Topluluğun videoları</span></li>
        <li><a href="/reals">Reals</a><span>Kısa dikey videolar</span></li></ul></section>`))));

    app.get('/magaza', (req, res) => res.send(injectMeta('Mağaza – CigCig', 'CigCig mağazası: Plus, VIP üyelik ve diğer ürünler.', `${SITE_URL}/magaza`, '')));

    for (const [p, title] of PRIVATE_PAGES) {
      app.get(p, (req, res) => res.send(injectMeta(title, 'CigCig kişisel sayfa.', `${SITE_URL}${p}`, '', NOINDEX_META)));
    }
    app.get(['/mesajlar/:username', '/hikaye/:id', '/ortak-dinleyis/:id'], (req, res) =>
      res.send(injectMeta('CigCig', 'CigCig kişisel sayfa.', `${SITE_URL}${req.path}`, '', NOINDEX_META)));
  }

  // =====================================================================
  // IndexNow (Bing, Yandex, Seznam, Naver). Google bunu kullanmaz; Google
  // site haritalarını Search Console üzerinden okur.
  // =====================================================================
  function startIndexNow() {
    const key = String(process.env.INDEXNOW_KEY || '').trim();
    if (!/^[a-zA-Z0-9-]{8,128}$/.test(key) || typeof fetch !== 'function') return null;
    let since = new Date(Date.now() - 60 * 60 * 1000);
    const host = new URL(SITE_URL).host;
    const run = async () => {
      const from = since; since = new Date();
      const recent = await Promise.all([
        rows(`SELECT '/forum/' || f.slug AS p FROM forums f LEFT JOIN users u ON u.id=f.user_id WHERE ${userOk('u')} AND f.created_at >= $1 LIMIT 2000`, [from]),
        rows(`SELECT '/siir/' || p.slug AS p FROM poems p JOIN users u ON u.id=p.user_id WHERE COALESCE(p.is_hidden,0)=0 AND ${userOk('u')} AND p.created_at >= $1 LIMIT 2000`, [from]),
        rows(`SELECT '/kitap/' || b.slug AS p FROM books b LEFT JOIN users u ON u.id=b.user_id WHERE b.is_hidden=0 AND COALESCE(b.password_hash,'')='' AND ${userOk('u')} AND b.created_at >= $1 LIMIT 2000`, [from]),
        rows(`SELECT '/muzik/' || s.slug AS p FROM songs s LEFT JOIN users u ON u.id=s.uploader_id WHERE s.status='active' AND ${userOk('u')} AND s.published_at >= $1 LIMIT 2000`, [from]),
        rows(`SELECT '/foto/' || p.id AS p FROM photos p LEFT JOIN users u ON u.id=p.user_id WHERE ${userOk('u')} AND COALESCE(p.close_friends_only,0)=0 AND COALESCE(p.is_nsfw,0)=0 AND p.created_at >= $1 LIMIT 2000`, [from]),
        rows(`SELECT CASE WHEN v.is_reals=1 THEN '/reals/' || v.id ELSE '/video/' || COALESCE(v.slug, v.id::text) END AS p FROM videos v JOIN users u ON u.id=v.user_id WHERE COALESCE(v.is_nsfw,0)=0 AND ${userOk('u')} AND v.created_at >= $1 LIMIT 2000`, [from]),
      ]);
      const urlList = recent.flat().map(r => abs(r.p)).slice(0, 10000);
      if (!urlList.length) return;
      try {
        const resp = await fetch('https://api.indexnow.org/indexnow', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify({ host, key, keyLocation: `${SITE_URL}/${key}.txt`, urlList }),
        });
        console.log(`[SEO] IndexNow: ${urlList.length} adres gönderildi (HTTP ${resp.status})`);
      } catch (error) {
        console.warn('[SEO] IndexNow gönderilemedi:', error.message);
      }
    };
    const timer = setInterval(() => { run().catch(() => {}); }, 30 * 60 * 1000);
    if (timer.unref) timer.unref();
    return timer;
  }

  return {
    registerCrawlerRoutes,
    registerPages,
    startIndexNow,
    breadcrumbScript,
    ogTypeFor,
    commentsHtml,
    commentsLd,
    counter,
    personLd,
    plain,
    isoDuration,
    rows,
    NOINDEX_META,
    // test için
    _internal: { breadcrumbItems, robotsTxt, sitemapIndexXml, typeSitemapXml, urlXml, SITEMAP_TYPES },
  };
}

module.exports = { createSeo };
