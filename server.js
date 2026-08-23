require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const slugify = require('slugify');
const rateLimit = require('express-rate-limit');
const cloudinary = require('cloudinary').v2;
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { query, initDb } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// Cloudinary config — Railway'de CLOUDINARY_URL env var olarak ekle
// Format: cloudinary://API_KEY:API_SECRET@CLOUD_NAME
if (process.env.CLOUDINARY_URL) {
  cloudinary.config({ secure: true });
} else if (process.env.CLOUDINARY_CLOUD_NAME) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true
  });
}

const USE_CLOUDINARY = !!(process.env.CLOUDINARY_URL || process.env.CLOUDINARY_CLOUD_NAME);
const USE_R2 = !!(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET_NAME);
const R2_ENDPOINT = process.env.R2_ENDPOINT || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
const r2Client = USE_R2 ? new S3Client({
  region: 'auto',
  endpoint: R2_ENDPOINT,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY }
}) : null;
const R2_CSP_ORIGINS = [R2_ENDPOINT, process.env.R2_PUBLIC_URL]
  .map(value => { try { return new URL(value).origin; } catch { return ''; } })
  .filter(Boolean);
try {
  const endpointUrl = new URL(R2_ENDPOINT);
  if (process.env.R2_BUCKET_NAME) R2_CSP_ORIGINS.push(`${endpointUrl.protocol}//${process.env.R2_BUCKET_NAME}.${endpointUrl.host}`);
} catch {}

// Fallback: local disk (Railway volume veya geliştirme)
const UPLOAD_DIR = process.env.UPLOAD_DIR || '/data/uploads';
if (!USE_CLOUDINARY) {
  try { if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch (e) {}
}

app.use(express.json());
if (!USE_CLOUDINARY) app.use('/uploads', express.static(UPLOAD_DIR));

// Cloudflare proxy arkasındaysa gerçek IP'yi al
app.set('trust proxy', 1);

// ===== GÜVENLİK BAŞLIKLARI =====
app.use((req, res, next) => {
  // ads.txt, robots.txt gibi metin dosyalarına güvenlik header'larını uygulama
  if (req.path === '/ads.txt' || req.path === '/robots.txt' || req.path === '/sitemap.xml') {
    return next();
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://pagead2.googlesyndication.com https://partner.googleadservices.com https://www.googletagmanager.com https://googleads.g.doubleclick.net; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com; " +
    "font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com; " +
    "img-src 'self' data: https: blob:; " +
    "media-src 'self' https: blob:; " +
    "connect-src 'self' https://api.spotify.com https://pagead2.googlesyndication.com " + R2_CSP_ORIGINS.join(' ') + "; " +
    "frame-src https://googleads.g.doubleclick.net https://tpc.googlesyndication.com;"
  );
  // Statik dosyalarda source map'leri engelle
  if (req.path.endsWith('.map')) {
    return res.status(404).end();
  }
  next();
});

// ads.txt explicit route — Google AdSense için zorunlu
app.get('/ads.txt', (req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.sendFile(path.join(__dirname, 'public', 'ads.txt'));
});

const SITE_URL = process.env.SITE_URL || 'https://cigcig.xyz';
if (!process.env.SITE_URL) {
  console.warn('[SEO] ⚠️  SITE_URL env ayarlanmamış! Railway panelinde: SITE_URL=https://cigcig.xyz');
}

// ===== RATE LIMITERS =====

// Genel API: dakikada 80 istek (daha sıkı)
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 80,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Çok fazla istek. Lütfen bekleyin.' },
  skip: (req) => req.path.startsWith('/uploads/'), // statik dosyaları atla
});

// Auth (login/register): 15 dakikada 5 deneme (bruteforce önlemi)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Çok fazla giriş denemesi. 15 dakika bekleyin.' },
});

// Upload: dakikada 5 yükleme
const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Çok fazla yükleme. Lütfen bekleyin.' },
});

// İçerik oluşturma (forum/kitap/mesaj): dakikada 10
const createLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Çok hızlı içerik oluşturuyorsunuz. Yavaşlayın.' },
});

app.use('/api/', generalLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/upload', uploadLimiter);
app.use('/api/group/:slug/upload', uploadLimiter);
app.use('/api/forums', createLimiter);
app.use('/api/books', createLimiter);
app.use('/api/group/:slug/messages', createLimiter);

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function getIp(req) {
  return (req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.ip || '').split(',')[0].trim();
}

function hashPassword(pw) {
  return crypto.createHash('sha256').update(pw).digest('hex');
}

function generateToken(userId) {
  return Buffer.from(JSON.stringify({ id: userId, ts: Date.now(), rand: Math.random() })).toString('base64');
}

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `cigcig_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/`);
}

function getSessionCookie(req) {
  const cookies = String(req.headers.cookie || '').split(';').map(value => value.trim());
  const session = cookies.find(value => value.startsWith('cigcig_session='));
  return session ? decodeURIComponent(session.slice('cigcig_session='.length)) : '';
}

function sanitizeUser(u) {
  if (!u) return null;
  const { password_hash, spotify_token, spotify_refresh, ...rest } = u;
  return rest;
}

function makeSlug(title, id) {
  const base = slugify(title, { lower: true, strict: false, locale: 'tr', replacement: '-' })
    .replace(/[^a-z0-9\-]/g, '').replace(/-+/g, '-').substring(0, 60);
  return base + '-' + id;
}

async function logAction(actor, action, target = '', detail = '', ip = '') {
  await query('INSERT INTO system_logs (actor,action,target,detail,ip) VALUES ($1,$2,$3,$4,$5)',
    [actor, action, target, detail, ip]);
}

async function authMiddleware(req, res, next) {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Giriş gerekli' });
  const { rows } = await query('SELECT user_id FROM sessions WHERE token=$1', [token]);
  if (!rows.length) return res.status(401).json({ error: 'Giriş gerekli' });
  const { rows: users } = await query('SELECT * FROM users WHERE id=$1', [rows[0].user_id]);
  if (!users.length) return res.status(401).json({ error: 'Kullanıcı bulunamadı' });
  if (users[0].banned) return res.status(403).json({ error: 'Hesabınız yasaklandı' });
  req.user = users[0];
  next();
}

async function optionalAuth(req, res, next) {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  if (token) {
    const { rows } = await query('SELECT user_id FROM sessions WHERE token=$1', [token]);
    if (rows.length) {
      const { rows: users } = await query('SELECT * FROM users WHERE id=$1', [rows[0].user_id]);
      if (users.length && !users[0].banned) req.user = users[0];
    }
  }
  next();
}

async function adminMiddleware(req, res, next) {
  // IP kontrolü — ADMIN_IPS set edilmişse API'yi de koru
  const allowed = getAdminIPs();
  if (allowed.length > 0) {
    const clientIP = (req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.ip || '').split(',')[0].trim();
    if (!allowed.includes(clientIP)) return res.status(404).json({ error: 'Not found' });
  }
  const token = req.headers['x-admin-token'];
  if (!token) return res.status(401).json({ error: 'Admin token gerekli' });
  const { rows } = await query("SELECT value FROM settings WHERE key='admin_password'");
  if (!rows.length || token !== rows[0].value) return res.status(403).json({ error: 'Geçersiz admin token' });
  next();
}

async function updateUserLevel(userId) {
  const { rows: users } = await query('SELECT forum_count, book_count, comment_count FROM users WHERE id=$1', [userId]);
  if (!users.length) return;
  const user = users[0];
  const { rows: bpRows } = await query(
    'SELECT COUNT(*) as c FROM book_pages bp INNER JOIN books b ON bp.book_id=b.id WHERE b.user_id=$1', [userId]);
  const bookPageCount = parseInt(bpRows[0].c);
  const { rows: levels } = await query('SELECT * FROM levels ORDER BY order_num ASC');
  let bestLevel = levels[0];
  for (const lv of levels) {
    const minF  = (parseInt(lv.min_forums)     || 0);
    const minB  = (parseInt(lv.min_books)      || 0);
    const minC  = (parseInt(lv.min_comments)   || 0);
    const minBP = (parseInt(lv.min_book_pages) || 0);
    const reqAny = lv.require_any == 1;

    const meetsForums   = minF  === 0 || user.forum_count   >= minF;
    const meetsBooks    = minB  === 0 || user.book_count    >= minB;
    const meetsComments = minC  === 0 || user.comment_count >= minC;
    const meetsBookPages = minBP === 0 || bookPageCount    >= minBP;

    let meets;
    if (reqAny) {
      // require_any=1: koşullardan HERHANGİ BİRİ yeterliyse atlanır
      const checks = [];
      if (minF  > 0) checks.push(meetsForums);
      if (minB  > 0) checks.push(meetsBooks);
      if (minC  > 0) checks.push(meetsComments);
      if (minBP > 0) checks.push(meetsBookPages);
      meets = checks.length === 0 || checks.some(c => c);
    } else {
      // require_any=0: TÜMÜ karşılanmalı
      meets = meetsForums && meetsBooks && meetsComments && meetsBookPages;
    }

    if (meets) bestLevel = lv;
  }
  await query('UPDATE users SET level_id=$1 WHERE id=$2', [bestLevel.id, userId]);
}

function getDailyLimit(user, lv, type) {
  if (!lv) return -1;
  const suffix = user.is_vip == 1 ? '_vip' : (user.is_plus == 1 ? '_plus' : '');
  const col = `daily_${type}${suffix}`;
  const val = lv[col];
  if (val === undefined || val === null) return parseInt(lv[`daily_${type}`] ?? -1);
  return parseInt(val);
}

async function checkDailyLimit(userId, user, type) {
  const { rows: lvRows } = await query('SELECT * FROM levels WHERE id=$1', [user.level_id]);
  const lv = lvRows[0];
  const limit = getDailyLimit(user, lv, type);
  if (limit === -1 || limit >= 9999999) return null;
  const today = new Date().toISOString().slice(0, 10);
  let countRes;
  if (type === 'forums') {
    countRes = await query("SELECT COUNT(*) as c FROM forums WHERE user_id=$1 AND DATE(created_at)=$2", [userId, today]);
  } else if (type === 'books') {
    countRes = await query("SELECT COUNT(*) as c FROM books WHERE user_id=$1 AND DATE(created_at)=$2", [userId, today]);
  } else if (type === 'book_pages') {
    countRes = await query(
      "SELECT COUNT(*) as c FROM book_pages bp INNER JOIN books b ON bp.book_id=b.id WHERE b.user_id=$1 AND DATE(bp.created_at)=$2",
      [userId, today]);
  }
  const count = parseInt(countRes?.rows[0]?.c || 0);
  if (count >= limit) return `Bugün en fazla ${limit} ${type === 'forums' ? 'konu' : type === 'books' ? 'kitap' : 'kitap sayfası'} oluşturabilirsiniz.`;
  return null;
}

// ===== MULTER / UPLOAD =====
// Memory storage — Cloudinary varsa RAM'den upload, yoksa disk'e yaz
const storage = USE_CLOUDINARY
  ? multer.memoryStorage()
  : multer.diskStorage({
      destination: (req, file, cb) => cb(null, UPLOAD_DIR),
      filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, uuidv4() + ext);
      }
    });
const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB (buyuk Reals videolari icin)
  fileFilter: (req, file, cb) => {
    const allowedImages = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif'];
    const allowedVideos = ['video/mp4', 'video/webm', 'video/quicktime', 'video/ogg'];
    const allowedAudio = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/flac', 'audio/aac', 'audio/x-wav', 'audio/wave'];
    if (allowedImages.includes(file.mimetype) || allowedVideos.includes(file.mimetype) || file.mimetype.startsWith('video/') || allowedAudio.includes(file.mimetype) || file.mimetype.startsWith('audio/')) cb(null, true);
    else cb(new Error('Sadece resim, video veya ses dosyaları kabul edilir'));
  }
});

const largeVideoStorage = USE_CLOUDINARY
  ? multer.diskStorage({
      destination: (req, file, cb) => cb(null, UPLOAD_DIR),
      filename: (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname))
    })
  : storage;
const largeVideoUpload = multer({
  storage: largeVideoStorage,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, file, cb) => file.mimetype?.startsWith('video/')
    ? cb(null, true)
    : cb(new Error('Sadece video dosyasi yukleyebilirsiniz'))
});

// Yükleme helper'ı — Cloudinary ya da disk
async function handleUpload(file) {
  if (USE_CLOUDINARY) {
    return new Promise((resolve, reject) => {
      if (!file.buffer || file.buffer.length === 0) {
        return reject(new Error('Dosya buffer boş'));
      }
      const ext = path.extname(file.originalname).replace('.', '') || 'jpg';
      const public_id = 'teatube/' + uuidv4();
      const isAudio = file.mimetype && file.mimetype.startsWith('audio/');
      const isVideo = file.mimetype && file.mimetype.startsWith('video/');
      const stream = cloudinary.uploader.upload_stream(
        isAudio || isVideo
          ? { public_id, resource_type: 'video' }
          : { public_id, resource_type: 'image', quality: 'auto', fetch_format: 'auto' },
        (err, result) => {
          if (err) return reject(new Error('Cloudinary yükleme hatası: ' + (err.message || JSON.stringify(err))));
          if (!result?.secure_url) return reject(new Error('Cloudinary URL alınamadı'));
          file.cloudinary_public_id = result.public_id || '';
          resolve(result.secure_url);
        }
      );
      stream.end(file.buffer);
    });
  } else {
    return '/uploads/' + file.filename;
  }
}

async function handleLargeVideoUpload(file) {
  if (USE_R2) {
    const key = `reals/${uuidv4()}${path.extname(file.originalname) || '.mp4'}`;
    try {
      await new Upload({
        client: r2Client,
        params: { Bucket: process.env.R2_BUCKET_NAME, Key: key, Body: fs.createReadStream(file.path), ContentType: file.mimetype || 'video/mp4' },
        partSize: 20 * 1024 * 1024,
        queueSize: 3,
        leavePartsOnError: false
      }).done();
      const publicBase = (process.env.R2_PUBLIC_URL || `${R2_ENDPOINT}/${process.env.R2_BUCKET_NAME}`).replace(/\/$/, '');
      return `${publicBase}/${key}`;
    } finally {
      fs.promises.unlink(file.path).catch(() => {});
    }
  }
  if (!USE_CLOUDINARY) return '/uploads/' + file.filename;
  try {
    const result = await cloudinary.uploader.upload_large(file.path, {
      public_id: 'teatube/' + uuidv4(),
      resource_type: 'video',
      chunk_size: 20 * 1024 * 1024
    });
    if (!result?.secure_url) throw new Error('Cloudinary URL alinamadi');
    return result.secure_url;
  } finally {
    fs.promises.unlink(file.path).catch(() => {});
  }
}

async function handleR2VideoBufferUpload(file) {
  if (!USE_R2) return null;
  const key = `stories/${uuidv4()}${path.extname(file.originalname) || '.mp4'}`;
  await new Upload({
    client: r2Client,
    params: { Bucket: process.env.R2_BUCKET_NAME, Key: key, Body: file.buffer || fs.createReadStream(file.path), ContentType: file.mimetype || 'video/mp4' },
    partSize: 20 * 1024 * 1024,
    queueSize: 3,
    leavePartsOnError: false
  }).done();
  const publicBase = (process.env.R2_PUBLIC_URL || `${R2_ENDPOINT}/${process.env.R2_BUCKET_NAME}`).replace(/\/$/, '');
  if (file.path) fs.promises.unlink(file.path).catch(() => {});
  return `${publicBase}/${key}`;
}

// ===== ROBOTS & SITEMAP =====
app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send([
    'User-agent: *',
    'Allow: /',
    'Disallow: /ayarlar',
    'Disallow: /api/',
    '',
    `Sitemap: ${SITE_URL}/sitemap.xml`,
  ].join('\n'));
});

app.get('/sitemap.xml', async (req, res) => {
  const [forums, books, groups, users, songs] = await Promise.all([
    query('SELECT slug, title, banner_image, updated_at FROM forums ORDER BY updated_at DESC LIMIT 5000').then(r => r.rows),
    query('SELECT slug, updated_at FROM books ORDER BY updated_at DESC LIMIT 2000').then(r => r.rows),
    query('SELECT slug FROM groups LIMIT 2000').then(r => r.rows),
    query('SELECT username FROM users WHERE banned=0 LIMIT 5000').then(r => r.rows),
    query("SELECT slug, title, cover_url, published_at FROM songs WHERE status='active' ORDER BY published_at DESC LIMIT 2000").then(r => r.rows),
  ]);
  const now = new Date().toISOString();
  const staticUrls = [
    { url: '/',          priority: '1.0', changefreq: 'daily'  },
    { url: '/forum',     priority: '0.9', changefreq: 'hourly' },
    { url: '/kitaplar',  priority: '0.8', changefreq: 'daily'  },
    { url: '/gruplar',   priority: '0.7', changefreq: 'daily'  },
    { url: '/muzikler',  priority: '0.7', changefreq: 'daily'  },
  ].map(u => `  <url><loc>${SITE_URL}${u.url}</loc><lastmod>${now}</lastmod><changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`).join('\n');

  const forumUrls = forums.map(f => {
    const imgTag = f.banner_image
      ? `\n    <image:image><image:loc>${escapeHtml(f.banner_image)}</image:loc><image:title>${escapeHtml(f.title)}</image:title></image:image>`
      : '';
    const mod = f.updated_at ? `\n    <lastmod>${new Date(f.updated_at).toISOString()}</lastmod>` : '';
    return `  <url><loc>${SITE_URL}/forum/${escapeHtml(f.slug)}</loc>${mod}\n    <changefreq>weekly</changefreq><priority>0.8</priority>${imgTag}\n  </url>`;
  }).join('\n');

  const bookUrls = books.map(b => {
    const mod = b.updated_at ? `\n    <lastmod>${new Date(b.updated_at).toISOString()}</lastmod>` : '';
    return `  <url><loc>${SITE_URL}/kitap/${escapeHtml(b.slug)}</loc>${mod}\n    <changefreq>weekly</changefreq><priority>0.7</priority>\n  </url>`;
  }).join('\n');

  const groupUrls = groups.map(g =>
    `  <url><loc>${SITE_URL}/grup/${escapeHtml(g.slug)}</loc><changefreq>weekly</changefreq><priority>0.6</priority></url>`
  ).join('\n');

  const profileUrls = users.map(u =>
    `  <url><loc>${SITE_URL}/profil/${escapeHtml(u.username)}</loc><changefreq>weekly</changefreq><priority>0.5</priority></url>`
  ).join('\n');

  const songUrls = songs.map(s => {
    const mod = s.published_at ? `\n    <lastmod>${new Date(s.published_at).toISOString()}</lastmod>` : '';
    const imgTag = s.cover_url
      ? `\n    <image:image><image:loc>${escapeHtml(s.cover_url)}</image:loc><image:title>${escapeHtml(s.title)}</image:title></image:image>`
      : '';
    return `  <url><loc>${SITE_URL}/muzik/${escapeHtml(s.slug)}</loc>${mod}\n    <changefreq>monthly</changefreq><priority>0.6</priority>${imgTag}\n  </url>`;
  }).join('\n');

  res.type('application/xml');
  res.set('Cache-Control', 'public, max-age=3600'); // 1 saat cache — sık değişmiyor
  res.send([
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
    '        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">',
    staticUrls,
    forumUrls,
    bookUrls,
    groupUrls,
    profileUrls,
    songUrls,
    '</urlset>'
  ].join('\n'));
});

// Redirect legacy /konular to /forum (friendly route)
app.get('/konular', (req, res) => { res.redirect(301, '/forum'); });

// Prevent direct access to legacy admin entry paths
app.get(['/admin.html','/panel-giris'], (req, res) => { res.status(404).end(); });

// New admin entry path
app.get('/gubukgak', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'admin.html')); });

app.get('/uyarı', async (req, res, next) => {
  try {
    const { rows } = await query("SELECT key, value FROM settings WHERE key IN ('warning_text','warning_link','warning_link_label','warning_logo')");
    const settings = Object.fromEntries(rows.map(item => [item.key, item.value]));
    const text = settings.warning_text || 'BÖYLE ŞEYLER DENERSEN BAŞINA BÜYÜK İŞ ALACAKSIN. POLİS AMCALARA SELAM VERMEK İSTER MİSİN ?';
    const link = settings.warning_link || 'https://egm.gov.tr';
    const label = settings.warning_link_label || 'egm.gov.tr';
    const logo = settings.warning_logo || '/uyarı.png';
    res.send(`<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Uyarı</title><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#07080d;color:#f7f5ef;font-family:Inter,system-ui,sans-serif}main{width:min(680px,100%);padding:clamp(28px,7vw,72px) clamp(22px,7vw,64px);text-align:center;border:1px solid rgba(220,190,130,.3);border-radius:24px;background:linear-gradient(145deg,#171820,#0d0e14);box-shadow:0 24px 80px #0008,0 0 50px rgba(220,170,80,.1)}img{width:min(150px,42vw);height:min(150px,42vw);object-fit:contain;margin-bottom:26px}h1{margin:0 auto 30px;font-size:clamp(25px,5vw,48px);line-height:1.18;letter-spacing:0;color:#f5e7c7}a{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:0 24px;border-radius:12px;background:#d6b36a;color:#17120a;font-weight:800;text-decoration:none;transition:transform .2s,background .2s}a:hover{background:#f0cf86;transform:translateY(-2px)}@media(max-width:480px){body{padding:14px}main{border-radius:18px}h1{font-size:27px;margin-bottom:24px}a{width:100%}}</style></head><body><main><img src="${escapeHtml(logo)}" alt="Uyarı"><h1>${escapeHtml(text)}</h1><a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a></main></body></html>`);
  } catch (error) { next(error); }
});

app.get('/uyarı.png', (req, res) => {
  const warningLogo = path.join(__dirname, 'uyarı.png');
  res.sendFile(warningLogo, error => {
    if (error && !res.headersSent) res.sendFile(path.join(__dirname, 'cigcig.png'));
  });
});

// VMB tarzı route koruması: admin panelinden tanımlanan hassas yolları gizler.
app.use(async (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path === '/gubukgak' || req.method !== 'GET') return next();
  try {
    const { rows } = await query("SELECT key, value FROM settings WHERE key IN ('route_protection_enabled','protected_routes','route_redirect')");
    const settings = Object.fromEntries(rows.map(item => [item.key, item.value]));
    if (settings.route_protection_enabled !== '1') return next();
    let routes = [];
    try { routes = JSON.parse(settings.protected_routes || '[]'); } catch {}
    const matched = routes.find(route => {
      const normalized = String(route || '').trim().replace(/\/$/, '') || '/';
      return req.path === normalized || req.path.startsWith(`${normalized}/`);
    });
    if (!matched) return next();
    const target = String(settings.route_redirect || '/').trim();
    const externalTarget = target.startsWith('/') ? target : (/^https?:\/\//i.test(target) ? target : `https://${target}`);
    let redirectTarget = target.startsWith('/') ? target : '/';
    try {
      if (!target.startsWith('/')) {
        const parsedTarget = new URL(externalTarget);
        if (parsedTarget.protocol === 'http:' || parsedTarget.protocol === 'https:') redirectTarget = parsedTarget.toString();
      }
    } catch {}
    let actor = 'anonymous';
    try {
      const token = req.headers['authorization']?.replace('Bearer ', '') || getSessionCookie(req);
      if (token) {
        const { rows: users } = await query('SELECT u.username FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=$1', [token]);
        if (users[0]?.username) actor = users[0].username;
      }
    } catch {}
    await logAction(actor, 'restricted_route_attempt', req.path, JSON.stringify({ matchedRoute: matched, redirectTarget }), getIp(req));
    return res.redirect(redirectTarget);
  } catch { return next(); }
});

app.use(express.static(path.join(__dirname, 'public')));

// ===== ADMIN BADGES API =====
app.get('/api/admin/badges', adminMiddleware, async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM badges ORDER BY id DESC');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/badges', adminMiddleware, async (req, res) => {
  try {
    const { name, icon, color } = req.body;
    if (!name) return res.status(400).json({ error: 'İsim gerekli' });
    const { rows } = await query('INSERT INTO badges(name,icon,color,created_at) VALUES($1,$2,$3,NOW()) RETURNING *', [name, icon||'', color||'#6b7280']);
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/badges/:id', adminMiddleware, async (req, res) => {
  try {
    const id = req.params.id;
    await query('DELETE FROM badges WHERE id=$1', [id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Assign badge to user
app.put('/api/admin/user/:id/badge', adminMiddleware, async (req, res) => {
  try {
    const id = req.params.id;
    const { badge_name, badge_icon, badge_color } = req.body;
    await query('UPDATE users SET badge_name=$1, badge_icon=$2, badge_color=$3 WHERE id=$4', [badge_name||null, badge_icon||null, badge_color||null, id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== AUTH =====
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password, kvkk_accepted, birth_date, is_private, tag_permission, homepage_sections, profile_visibility } = req.body;
    if (!username || !email || !password) return res.status(400).json({ error: 'Tüm alanlar zorunlu' });
    if (!kvkk_accepted) return res.status(400).json({ error: 'KVKK onayı zorunlu' });
    if (/\s/.test(username)) return res.status(400).json({ error: 'Kullanıcı adında boşluk oluşamaz' });
    if (username.length < 3 || username.length > 30) return res.status(400).json({ error: 'Kullanıcı adı 3-30 karakter olmalı' });
    if (password.length < 6) return res.status(400).json({ error: 'Şifre en az 6 karakter olmalı' });
    if (!birth_date || !/^\d{4}-\d{2}-\d{2}$/.test(birth_date)) return res.status(400).json({ error: 'Doğum tarihi zorunlu' });
    const birth = new Date(`${birth_date}T00:00:00Z`);
    const today = new Date();
    let age = today.getUTCFullYear() - birth.getUTCFullYear();
    const monthDiff = today.getUTCMonth() - birth.getUTCMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getUTCDate() < birth.getUTCDate())) age--;
    if (!Number.isFinite(age) || age < 15 || birth > today) return res.status(400).json({ error: '15 yaş altı kabul edilmez (¬‿¬) hııhıı' });
    const validTagPermission = ['friends', 'everyone', 'nobody'].includes(tag_permission) ? tag_permission : 'everyone';
    let defaultVisibility = { forums: false, books: false, comments: false, photos: false, music: false, followers: true, following: true, followers_list: true, following_list: true };
    if (profile_visibility && typeof profile_visibility === 'object') {
      Object.keys(defaultVisibility).forEach(key => { defaultVisibility[key] = profile_visibility[key] !== false; });
    } else {
      const { rows: homepageSettings } = await query("SELECT value FROM settings WHERE key='homepage_sections'");
      let sections = [];
      try { sections = JSON.parse(homepageSettings[0]?.value || '[]'); } catch {}
      const sectionMap = { konular: 'forums', kitaplar: 'books', yorumlar: 'comments', fotograflar: 'photos', muzikler: 'music' };
      (Array.isArray(sections) ? sections : []).forEach(section => {
        const key = sectionMap[section] || section;
        if (key in defaultVisibility) defaultVisibility[key] = true;
      });
    }
    const ip = getIp(req);
    const { rows: ipBan } = await query("SELECT id FROM users WHERE banned_ip=$1 AND ban_type='ip'", [ip]);
    if (ipBan.length) return res.status(403).json({ error: 'Bu IP adresi yasaklanmış' });
    const { rows: existing } = await query('SELECT id FROM users WHERE LOWER(username)=LOWER($1) OR LOWER(email)=LOWER($2)', [username, email]);
    if (existing.length) return res.status(400).json({ error: 'Bu kullanıcı adı veya e-posta zaten kullanılıyor' });
    const { rows } = await query(
      'INSERT INTO users (username,email,password_hash,kvkk_accepted,ip,birth_date,is_private,tag_permission,homepage_sections,profile_visibility) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',
      [username, email, hashPassword(password), 1, ip, birth_date, is_private ? 1 : 0, validTagPermission, JSON.stringify(Array.isArray(homepage_sections) ? homepage_sections : []), JSON.stringify(defaultVisibility)]);
    const user = rows[0];
    const token = generateToken(user.id);
    await query('INSERT INTO sessions (token,user_id) VALUES ($1,$2)', [token, user.id]);
    await logAction(username, 'register', '', '', ip);
    setSessionCookie(res, token);
    res.json({ token, user: sanitizeUser(user) });
  } catch (e) { res.status(400).json({ error: 'Kayıt başarısız: ' + e.message }); }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { login, password } = req.body;
    if (!login || !password) return res.status(400).json({ error: 'Bilgiler eksik' });
    const ip = getIp(req);
    // Süresi dolmuş hesapları temizle
    await purgeDeletedAccounts();
    const { rows: ipBan } = await query("SELECT id FROM users WHERE banned_ip=$1 AND ban_type='ip'", [ip]);
    if (ipBan.length) return res.status(403).json({ error: 'Bu IP adresi yasaklanmış' });
    const { rows } = await query('SELECT * FROM users WHERE LOWER(username)=LOWER($1) OR LOWER(email)=LOWER($1) LIMIT 1', [login]);
    const user = rows[0];
    if (!user || user.password_hash !== hashPassword(password)) return res.status(401).json({ error: 'Hatalı bilgiler' });
    if (user.banned) return res.status(403).json({ error: 'Hesabınız yasaklandı' });
    // Silinme talebi verilmiş hesap — kullanıcıya bildir
    if (user.is_deleted) {
      const deleteAt = new Date(user.delete_requested_at);
      deleteAt.setDate(deleteAt.getDate() + 10);
      return res.status(200).json({
        pending_delete: true,
        delete_at: deleteAt.toISOString(),
        user_id: user.id,
        // geçici token (sadece cancel-delete için)
        temp_token: (() => { const t = generateToken(user.id); query('INSERT INTO sessions (token,user_id) VALUES ($1,$2)', [t, user.id]); return t; })()
      });
    }
    await query('UPDATE users SET last_active=NOW(), ip=$1 WHERE id=$2', [ip, user.id]);
    const token = generateToken(user.id);
    await query('INSERT INTO sessions (token,user_id) VALUES ($1,$2)', [token, user.id]);
    await logAction(user.username, 'login', '', '', ip);
    setSessionCookie(res, token);
    res.json({ token, user: sanitizeUser(user) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  const { rows: lvRows } = await query('SELECT * FROM levels WHERE id=$1', [req.user.level_id]);
  res.json({ user: sanitizeUser(req.user), level: lvRows[0] || null });
});

app.post('/api/auth/logout', authMiddleware, async (req, res) => {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  await query('DELETE FROM sessions WHERE token=$1', [token]);
  res.setHeader('Set-Cookie', 'cigcig_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ ok: true });
});

// ===== PURCHASE (demo) =====
app.post('/api/purchase', authMiddleware, async (req, res) => {
  // Backward-compatible purchase endpoint.
  // Membership is only granted when payments are enabled (ENABLE_PAYMENTS=1).
  try {
    const { type } = req.body;
    if (!type || (type !== 'vip' && type !== 'plus')) return res.status(400).json({ error: 'Geçersiz paket' });
    if (process.env.ENABLE_PAYMENTS !== '1') return res.status(502).json({ error: 'Ödeme hizmeti şu an devre dışı. Üyelik aktif edilemedi.' });
    const userId = req.user.id;
    if (type === 'vip') {
      await query('UPDATE users SET is_vip=1 WHERE id=$1', [userId]);
    } else if (type === 'plus') {
      await query('UPDATE users SET is_plus=1 WHERE id=$1', [userId]);
    }
    const { rows } = await query('SELECT * FROM users WHERE id=$1', [userId]);
    res.json(sanitizeUser(rows[0]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Create payment session (frontend calls this to start checkout)
app.post('/api/create-payment-session', authMiddleware, async (req, res) => {
  try {
    const { type } = req.body || {};
    if (!type || (type !== 'vip' && type !== 'plus')) return res.status(400).json({ error: 'Geçersiz paket' });
    // If payments are disabled, return a friendly failure so frontend can show error
    if (process.env.ENABLE_PAYMENTS !== '1') {
      return res.status(502).json({ error: 'Ödeme hizmeti şu an devre dışı (test modunda). Ödeme gerçekleştirilemedi.' });
    }
    // If ENABLE_PAYMENTS=1 and STRIPE_SECRET is set, you can integrate real provider here.
    // Example (commented):
    // const stripe = require('stripe')(process.env.STRIPE_SECRET);
    // const session = await stripe.checkout.sessions.create({ ... });
    // res.json({ url: session.url });
    return res.status(500).json({ error: 'Ödeme sağlayıcı yapılandırılmamış. Lütfen yöneticiyle iletişime geçin.' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== GIFTS =====
function makeCode() {
  return 'GIFT-' + Math.random().toString(36).substring(2,10).toUpperCase();
}

// Create a gift; if recipient username exists, assign immediately
app.post('/api/gift', authMiddleware, async (req, res) => {
  try {
    const { type, to_username } = req.body || {};
    if (!type || (type !== 'vip' && type !== 'plus')) return res.status(400).json({ error: 'Geçersiz paket' });
    const sender = req.user;
    const code = makeCode();
    let recipient = null;
    if (to_username) {
      const { rows } = await query('SELECT * FROM users WHERE username=$1', [to_username]);
      if (rows.length) recipient = rows[0];
    }
    let recipient_id = recipient ? recipient.id : null;
    await query('INSERT INTO gifts(code,sender_id,recipient_id,recipient_username,type,created_at) VALUES($1,$2,$3,$4,$5,NOW())', [code, sender.id, recipient_id, to_username || '', type]);
    // If recipient exists, immediately redeem (assign membership)
    if (recipient) {
      if (type === 'vip') await query('UPDATE users SET is_vip=1 WHERE id=$1', [recipient.id]);
      if (type === 'plus') await query('UPDATE users SET is_plus=1 WHERE id=$1', [recipient.id]);
      await query('UPDATE gifts SET redeemed=1, redeemed_at=NOW() WHERE code=$1', [code]);
      await logAction(sender.username, 'gift_sent', `${type} -> ${recipient.username}`);
      // return recipient sanitized
      const { rows: updated } = await query('SELECT * FROM users WHERE id=$1', [recipient.id]);
      return res.json({ ok: true, code, assigned_to: sanitizeUser(updated[0]) });
    }
    await logAction(sender.username, 'gift_created', `${type} -> ${to_username || 'code'}`);
    res.json({ ok: true, code, message: 'Hediye oluşturuldu. Kodu alıcıya verin veya gönderin.' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Redeem gift by code
app.post('/api/redeem-gift', authMiddleware, async (req, res) => {
  try {
    const { code } = req.body || {};
    if (!code) return res.status(400).json({ error: 'Kod gerekli' });
    const { rows } = await query('SELECT * FROM gifts WHERE code=$1', [code]);
    if (!rows.length) return res.status(404).json({ error: 'Hediye bulunamadı' });
    const gift = rows[0];
    if (gift.redeemed) return res.status(400).json({ error: 'Hediye zaten kullanılmış' });
    const userId = req.user.id;
    if (gift.recipient_id && gift.recipient_id !== userId) return res.status(403).json({ error: 'Bu hediye sizin için değil' });
    if (gift.type === 'vip') await query('UPDATE users SET is_vip=1 WHERE id=$1', [userId]);
    if (gift.type === 'plus') await query('UPDATE users SET is_plus=1 WHERE id=$1', [userId]);
    await query('UPDATE gifts SET redeemed=1, redeemed_at=NOW(), recipient_id=$1, recipient_username=(SELECT username FROM users WHERE id=$1) WHERE code=$2', [userId, code]);
    await logAction(req.user.username, 'gift_redeemed', code);
    const { rows: updated } = await query('SELECT * FROM users WHERE id=$1', [userId]);
    res.json(sanitizeUser(updated[0]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// List gifts sent by current user
app.get('/api/gifts', authMiddleware, async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM gifts WHERE sender_id=$1 ORDER BY created_at DESC', [req.user.id]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== HESAP SİLME =====

// Silme talebi oluştur (şifre doğrulama zorunlu)
app.post('/api/auth/request-delete', authMiddleware, async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Şifre gerekli' });
  if (req.user.password_hash !== hashPassword(password)) return res.status(401).json({ error: 'Şifre hatalı' });
  // İçerikleri hemen gizle (is_deleted=1), kalıcı silme 10 gün sonra
  await query('UPDATE users SET is_deleted=1, delete_requested_at=NOW() WHERE id=$1', [req.user.id]);
  // Tüm sessionları sil
  await query('DELETE FROM sessions WHERE user_id=$1', [req.user.id]);
  await logAction(req.user.username, 'request_account_delete', '');
  res.json({ ok: true });
});

// Silme talebini geri al (giriş yaparken)
app.post('/api/auth/cancel-delete', authMiddleware, async (req, res) => {
  await query('UPDATE users SET is_deleted=0, delete_requested_at=NULL WHERE id=$1', [req.user.id]);
  await logAction(req.user.username, 'cancel_account_delete', '');
  res.json({ ok: true });
});

// 10 gün geçmiş hesapları kalıcı sil (cron-benzeri, her login isteğinde tetiklenir)
async function purgeDeletedAccounts() {
  try {
    const { rows } = await query(
      `SELECT id, username FROM users WHERE is_deleted=1 AND delete_requested_at < NOW() - INTERVAL '10 days'`
    );
    for (const user of rows) {
      await query('DELETE FROM users WHERE id=$1', [user.id]);
      await logAction('system', 'purge_deleted_account', user.username);
    }
  } catch(e) { console.error('purge error:', e.message); }
}


// ===== BİLDİRİM YARDIMCISI =====
async function parseMentionsAndNotify(content, actorUser, type, link, contextTitle = '') {
  const mentions = [...new Set(
    (content.match(/@([a-zA-Z0-9_çğıöşüÇĞİÖŞÜ]+)/g) || []).map(m => m.slice(1).toLowerCase())
  )];
  for (const username of mentions) {
    if (username.toLowerCase() === actorUser.username.toLowerCase()) continue;
    const { rows } = await query('SELECT id, allow_mentions, tag_permission FROM users WHERE LOWER(username)=$1 AND is_deleted=0', [username]);
    if (!rows.length) continue;
    const permission = rows[0].tag_permission || (rows[0].allow_mentions === 0 ? 'nobody' : 'everyone');
    if (permission === 'nobody') continue;
    if (permission === 'friends') {
      const { rows: mutual } = await query("SELECT 1 FROM follows WHERE follower_id=$1 AND following_id=$2 AND status='accepted'", [actorUser.id, rows[0].id]);
      if (!mutual.length) continue;
    }
    const body = type === 'forum_mention'
      ? `@${actorUser.username} sizi "${contextTitle}" başlıklı konuda etiketledi`
      : type === 'comment_mention'
      ? `@${actorUser.username} sizi "${contextTitle}" konusundaki bir yorumda etiketledi`
      : `@${actorUser.username} bir mesajında sizi etiketledi`;
    await query(
      'INSERT INTO notifications (user_id, type, actor_username, actor_avatar, title, body, link) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [rows[0].id, type, actorUser.username, actorUser.avatar || '', contextTitle, body, link]
    );
  }
}

async function notifyFollowersOfContent(actorUser, type, title, body, link) {
  const { rows: followers } = await query("SELECT follower_id FROM follows WHERE following_id=$1 AND status='accepted' AND follower_id<>$1", [actorUser.id]);
  for (const follower of followers) {
    await query('INSERT INTO notifications (user_id,type,actor_username,actor_avatar,title,body,link) VALUES ($1,$2,$3,$4,$5,$6,$7)', [follower.follower_id, type, actorUser.username, actorUser.avatar || '', title, body, link]);
  }
}

// ===== BİLDİRİM ENDPOİNTLERİ =====
app.get('/api/notifications', authMiddleware, async (req, res) => {
  const { rows } = await query(
    'SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50',
    [req.user.id]
  );
  res.json(rows);
});

app.get('/api/notifications/unread-count', authMiddleware, async (req, res) => {
  const { rows } = await query(
    'SELECT COUNT(*) as c FROM notifications WHERE user_id=$1 AND is_read=0',
    [req.user.id]
  );
  res.json({ count: parseInt(rows[0].c) });
});

app.post('/api/notifications/read-all', authMiddleware, async (req, res) => {
  await query('UPDATE notifications SET is_read=1 WHERE user_id=$1', [req.user.id]);
  res.json({ ok: true });
});

app.delete('/api/notifications/:id', authMiddleware, async (req, res) => {
  await query('DELETE FROM notifications WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  res.json({ ok: true });
});

// ===== FORUMS =====
app.get('/api/forums', async (req, res) => {
  const { tag } = req.query;
  let baseQuery = `
    SELECT f.*, u.username, u.avatar, u.name_color, u.is_vip, u.is_plus, u.is_admin,
      u.title as user_title, u.location as user_location,
      (SELECT COUNT(*) FROM forum_likes WHERE forum_id=f.id) as like_count,
      (SELECT COUNT(*) FROM forum_comments WHERE forum_id=f.id) as comment_count,
      COALESCE((
        SELECT json_agg(json_build_object('id',t.id,'name',t.name,'color',t.color))
        FROM tags t INNER JOIN forum_tags ft ON ft.tag_id=t.id WHERE ft.forum_id=f.id
      ), '[]'::json) as system_tags
    FROM forums f LEFT JOIN users u ON f.user_id=u.id`;

  if (tag) {
    // Sistem etiketi, custom tag veya içerik içindeki #tag ile filtrele — hepsi case-insensitive
    baseQuery += ` WHERE (
      EXISTS (SELECT 1 FROM forum_tags ft INNER JOIN tags t ON t.id=ft.tag_id WHERE ft.forum_id=f.id AND LOWER(t.name)=LOWER($1))
      OR f.custom_tags ILIKE $2
      OR f.content ILIKE $3
      OR f.title ILIKE $3
    )`;
    const likeTag = `%#${tag}%`;
    const likeTagPlain = `%${tag}%`;
    const { rows } = await query(baseQuery + ' ORDER BY f.created_at DESC', [tag, likeTagPlain, likeTag]);
    return res.json(rows);
  }

  const { rows } = await query(baseQuery + ' ORDER BY f.created_at DESC');
  res.json(rows);
});

app.get('/api/forum/:slug', optionalAuth, async (req, res) => {
  const { rows } = await query(`
    SELECT f.*, u.username, u.avatar, u.name_color, u.is_vip, u.is_plus, u.level_id, u.is_admin,
      u.title as user_title, u.location as user_location,
      (SELECT COUNT(*) FROM forum_likes WHERE forum_id=f.id) as like_count,
      (SELECT COUNT(*) FROM forum_comments WHERE forum_id=f.id) as comment_count,
      COALESCE((
        SELECT json_agg(json_build_object('id',t.id,'name',t.name,'color',t.color))
        FROM tags t INNER JOIN forum_tags ft ON ft.tag_id=t.id WHERE ft.forum_id=f.id
      ), '[]'::json) as system_tags
    FROM forums f LEFT JOIN users u ON f.user_id=u.id WHERE f.slug=$1`, [req.params.slug]);
  if (!rows.length) return res.status(404).json({ error: 'Konu bulunamadı' });
  res.json(rows[0]);
});

app.post('/api/forum/:slug/view', async (req, res) => {
  const ip = getIp(req);
  const { rows: fRows } = await query('SELECT id FROM forums WHERE slug=$1', [req.params.slug]);
  if (!fRows.length) return res.status(404).json({ error: 'Konu bulunamadı' });
  const fid = fRows[0].id;
  const { rows: vRows } = await query('SELECT * FROM forum_views WHERE forum_id=$1 AND ip=$2', [fid, ip]);
  if (!vRows.length) {
    await query('INSERT INTO forum_views (forum_id,ip,view_count) VALUES ($1,$2,1)', [fid, ip]);
    await query('UPDATE forums SET views=views+1 WHERE id=$1', [fid]);
  } else if (vRows[0].view_count < 3) {
    await query('UPDATE forum_views SET view_count=view_count+1 WHERE id=$1', [vRows[0].id]);
    await query('UPDATE forums SET views=views+1 WHERE id=$1', [fid]);
  }
  res.json({ ok: true });
});

app.post('/api/forums', authMiddleware, async (req, res) => {
  try {
    const { title, content, banner_image, allow_comments, tagIds, customTags, banner_fit, images, thumbnail } = req.body;
    if (!title || !content) return res.status(400).json({ error: 'Başlık ve içerik zorunlu' });
    const limitErr = await checkDailyLimit(req.user.id, req.user, 'forums');
    if (limitErr) return res.status(429).json({ error: limitErr });
    const tempSlug = slugify(title, { lower: true, strict: false, locale: 'tr' }).substring(0, 60) + '-' + uuidv4().substring(0, 8);
    // İçerik içindeki #tag'ları da custom_tags'e merge et
    const contentHashtags = (content.match(/#([a-zA-Z0-9_\u00c7\u00e7\u011e\u011f\u0130\u0131\u00d6\u00f6\u015e\u015f\u00dc\u00fc]+)/g) || []).map(t => t.slice(1).toLowerCase());
    const manualTags = Array.isArray(customTags) ? customTags : (customTags ? customTags.split(',').map(t => t.trim()).filter(Boolean) : []);
    const allCustomTags = [...new Set([...manualTags.map(t => t.toLowerCase()), ...contentHashtags])];
    const customTagsStr = allCustomTags.join(',');
    const { rows } = await query(
      'INSERT INTO forums (user_id,title,content,banner_image,slug,allow_comments,custom_tags,banner_fit,images,thumbnail) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id',
      [req.user.id, title, content, banner_image || '', tempSlug, allow_comments !== false ? 1 : 0, customTagsStr, banner_fit || 'cover', JSON.stringify(images || []), thumbnail || '']);
    const id = rows[0].id;
    const realSlug = makeSlug(title, id);
    await query('UPDATE forums SET slug=$1 WHERE id=$2', [realSlug, id]);
    if (Array.isArray(tagIds) && tagIds.length > 0) {
      for (const tid of tagIds) {
        try { await query('INSERT INTO forum_tags (forum_id,tag_id) VALUES ($1,$2)', [id, tid]); } catch {}
      }
    }
    await query('UPDATE users SET forum_count=forum_count+1 WHERE id=$1', [req.user.id]);
    await updateUserLevel(req.user.id);
    await logAction(req.user.username, 'create_forum', realSlug);
      await notifyFollowersOfContent(req.user, 'new_forum', 'Yeni forum konusu', `@${req.user.username} yeni bir forum konusu paylaştı: ${title}`, '/forum/' + realSlug).catch(() => {});
    // @mention bildirimleri
    await parseMentionsAndNotify(content + ' ' + title, req.user, 'forum_mention', '/forum/' + realSlug, title).catch(() => {});
    const { rows: fRows } = await query('SELECT * FROM forums WHERE id=$1', [id]);
    res.json(fRows[0]);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.put('/api/forum/:slug', authMiddleware, async (req, res) => {
  const { rows: fRows } = await query('SELECT * FROM forums WHERE slug=$1', [req.params.slug]);
  if (!fRows.length) return res.status(404).json({ error: 'Konu bulunamadı' });
  const forum = fRows[0];
  if (forum.user_id != req.user.id) return res.status(403).json({ error: 'Yetki yok' });
  const { title, content, banner_image, allow_comments, tagIds, customTags, banner_fit, images, thumbnail } = req.body;
  // İçerik içindeki #tag'ları da custom_tags'e merge et
  const newContent = content || forum.content;
  const contentHashtags = (newContent.match(/#([a-zA-Z0-9_\u00c7\u00e7\u011e\u011f\u0130\u0131\u00d6\u00f6\u015e\u015f\u00dc\u00fc]+)/g) || []).map(t => t.slice(1).toLowerCase());
  const manualTagsPut = customTags !== undefined ? (Array.isArray(customTags) ? customTags : customTags.split(',').map(t => t.trim()).filter(Boolean)) : (forum.custom_tags ? forum.custom_tags.split(',').map(t => t.trim()).filter(Boolean) : []);
  const allCustomTagsPut = [...new Set([...manualTagsPut.map(t => t.toLowerCase()), ...contentHashtags])];
  const customTagsStr = allCustomTagsPut.join(',');
  await query('UPDATE forums SET title=$1,content=$2,banner_image=$3,allow_comments=$4,custom_tags=$5,banner_fit=$6,images=$7,thumbnail=$8,updated_at=NOW() WHERE id=$9',
    [title||forum.title, content||forum.content, banner_image??forum.banner_image,
     allow_comments!==undefined?(allow_comments?1:0):forum.allow_comments, customTagsStr,
     banner_fit||forum.banner_fit||'cover',
     JSON.stringify(images !== undefined ? images : ((() => { try { return JSON.parse(forum.images||'[]'); } catch{return [];} })())),
     thumbnail !== undefined ? thumbnail : (forum.thumbnail || ''),
     forum.id]);
  if (tagIds !== undefined) {
    await query('DELETE FROM forum_tags WHERE forum_id=$1', [forum.id]);
    if (Array.isArray(tagIds)) for (const tid of tagIds) { try { await query('INSERT INTO forum_tags (forum_id,tag_id) VALUES ($1,$2)',[forum.id,tid]); } catch {} }
  }
  const { rows } = await query('SELECT * FROM forums WHERE id=$1', [forum.id]);
  res.json(rows[0]);
});

app.delete('/api/forum/:slug', authMiddleware, async (req, res) => {
  const { rows: fRows } = await query('SELECT * FROM forums WHERE slug=$1', [req.params.slug]);
  if (!fRows.length) return res.status(404).json({ error: 'Konu bulunamadı' });
  const forum = fRows[0];
  if (forum.user_id != req.user.id) return res.status(403).json({ error: 'Yetki yok' });
  await query('DELETE FROM forum_comments WHERE forum_id=$1', [forum.id]);
  await query('DELETE FROM forum_likes WHERE forum_id=$1', [forum.id]);
  await query('DELETE FROM forum_views WHERE forum_id=$1', [forum.id]);
  await query('DELETE FROM forum_tags WHERE forum_id=$1', [forum.id]);
  await query('DELETE FROM forums WHERE id=$1', [forum.id]);
  await query('UPDATE users SET forum_count=GREATEST(0,forum_count-1) WHERE id=$1', [req.user.id]);
  await updateUserLevel(req.user.id);
  await logAction(req.user.username, 'delete_forum', req.params.slug);
  res.json({ ok: true });
});

app.post('/api/forum/:slug/like', authMiddleware, async (req, res) => {
  const { rows } = await query('SELECT id FROM forums WHERE slug=$1', [req.params.slug]);
  if (!rows.length) return res.status(404).json({ error: 'Konu bulunamadı' });
  const fid = rows[0].id;
  const { rows: ex } = await query('SELECT id FROM forum_likes WHERE forum_id=$1 AND user_id=$2', [fid, req.user.id]);
  if (ex.length) { await query('DELETE FROM forum_likes WHERE id=$1', [ex[0].id]); res.json({ liked: false }); }
  else { await query('INSERT INTO forum_likes (forum_id,user_id) VALUES ($1,$2)', [fid, req.user.id]); res.json({ liked: true }); }
});

app.get('/api/forum/:slug/liked', optionalAuth, async (req, res) => {
  if (!req.user) return res.json({ liked: false });
  const { rows } = await query('SELECT id FROM forums WHERE slug=$1', [req.params.slug]);
  if (!rows.length) return res.json({ liked: false });
  const { rows: lk } = await query('SELECT id FROM forum_likes WHERE forum_id=$1 AND user_id=$2', [rows[0].id, req.user.id]);
  res.json({ liked: !!lk.length });
});

app.get('/api/forum/:slug/comments', async (req, res) => {
  const { rows: fRows } = await query('SELECT id FROM forums WHERE slug=$1', [req.params.slug]);
  if (!fRows.length) return res.status(404).json({ error: 'Konu bulunamadı' });
  const { rows } = await query(`
    SELECT fc.*, u.username, u.avatar, u.name_color, u.is_vip, u.level_id,
      (SELECT COUNT(*) FROM forum_comment_likes WHERE comment_id=fc.id) as like_count
    FROM forum_comments fc LEFT JOIN users u ON fc.user_id=u.id
    WHERE fc.forum_id=$1 ORDER BY fc.created_at ASC`, [fRows[0].id]);
  res.json(rows);
});

app.post('/api/forum/:slug/comments', authMiddleware, async (req, res) => {
  const { rows: fRows } = await query('SELECT * FROM forums WHERE slug=$1', [req.params.slug]);
  if (!fRows.length) return res.status(404).json({ error: 'Konu bulunamadı' });
  const forum = fRows[0];
  if (!forum.allow_comments) return res.status(403).json({ error: 'Yorumlar kapalı' });
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Yorum boş olamaz' });
  const { rows } = await query('INSERT INTO forum_comments (forum_id,user_id,content) VALUES ($1,$2,$3) RETURNING id', [forum.id, req.user.id, content.trim()]);
  await query('UPDATE users SET comment_count=comment_count+1 WHERE id=$1', [req.user.id]);
  if (forum.user_id && forum.user_id !== req.user.id) {
    await query('INSERT INTO notifications (user_id,type,actor_username,actor_avatar,title,body,link) VALUES ($1,$2,$3,$4,$5,$6,$7)', [forum.user_id, 'forum_comment', req.user.username, req.user.avatar || '', 'Konuna yorum geldi', `@${req.user.username} konuna yorum yaptı.`, '/forum/' + req.params.slug]).catch(() => {});
  }
  await updateUserLevel(req.user.id);
  // @mention bildirimleri
  await parseMentionsAndNotify(content, req.user, 'comment_mention', '/forum/' + req.params.slug, forum.title).catch(() => {});
  const { rows: cRows } = await query(`SELECT fc.*, u.username, u.avatar, u.name_color, u.is_vip, u.level_id FROM forum_comments fc LEFT JOIN users u ON fc.user_id=u.id WHERE fc.id=$1`, [rows[0].id]);
  res.json(cRows[0]);
});

app.delete('/api/forum/:slug/comments/:id', authMiddleware, async (req, res) => {
  const { rows } = await query('SELECT * FROM forum_comments WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Yorum bulunamadı' });
  if (rows[0].user_id != req.user.id) return res.status(403).json({ error: 'Yetki yok' });
  await query('DELETE FROM forum_comments WHERE id=$1', [rows[0].id]);
  await query('UPDATE users SET comment_count=GREATEST(0,comment_count-1) WHERE id=$1', [req.user.id]);
  await updateUserLevel(req.user.id);
  res.json({ ok: true });
});

app.post('/api/forum/:slug/comments/:id/like', authMiddleware, async (req, res) => {
  const { rows: fRows } = await query('SELECT id FROM forums WHERE slug=$1', [req.params.slug]);
  if (!fRows.length) return res.status(404).json({ error: 'Konu bulunamadı' });
  const { rows: cRows } = await query('SELECT id FROM forum_comments WHERE id=$1 AND forum_id=$2', [req.params.id, fRows[0].id]);
  if (!cRows.length) return res.status(404).json({ error: 'Yorum bulunamadı' });
  const { rows: ex } = await query('SELECT id FROM forum_comment_likes WHERE comment_id=$1 AND user_id=$2', [cRows[0].id, req.user.id]);
  if (ex.length) { await query('DELETE FROM forum_comment_likes WHERE id=$1', [ex[0].id]); res.json({ liked: false }); }
  else { await query('INSERT INTO forum_comment_likes (comment_id,user_id) VALUES ($1,$2)', [cRows[0].id, req.user.id]); res.json({ liked: true }); }
});

app.get('/api/forum/:slug/comments/:id/liked', optionalAuth, async (req, res) => {
  if (!req.user) return res.json({ liked: false });
  const { rows } = await query('SELECT id FROM forum_comment_likes WHERE comment_id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  res.json({ liked: !!rows.length });
});

// ===== TAGS =====
app.get('/api/tags', async (req, res) => {
  const { rows } = await query('SELECT * FROM tags WHERE is_system=1 ORDER BY name ASC');
  res.json(rows);
});

app.get('/api/forum/:slug/tags', async (req, res) => {
  const { rows: fRows } = await query('SELECT id,custom_tags FROM forums WHERE slug=$1', [req.params.slug]);
  if (!fRows.length) return res.status(404).json({ error: 'Konu bulunamadı' });
  const { rows: sTags } = await query(`SELECT t.* FROM tags t INNER JOIN forum_tags ft ON ft.tag_id=t.id WHERE ft.forum_id=$1`, [fRows[0].id]);
  const customTags = fRows[0].custom_tags ? fRows[0].custom_tags.split(',').map(t => t.trim()).filter(Boolean) : [];
  res.json({ systemTags: sTags, customTags });
});

// ===== BOOKS =====
app.get('/api/books', optionalAuth, async (req, res) => {
  const { rows } = await query(`SELECT b.*, u.username, u.avatar, u.name_color FROM books b LEFT JOIN users u ON b.user_id=u.id ORDER BY b.created_at DESC`);
  const filtered = rows.filter(book => {
    if (!book.is_hidden) return true;
    if (req.user && (req.user.id === book.user_id || req.user.is_admin)) return true;
    return false;
  });
  res.json(filtered);
});

app.get('/api/book/:slug', optionalAuth, async (req, res) => {
  const { rows: bRows } = await query(`SELECT b.*, u.username, u.avatar, u.name_color FROM books b LEFT JOIN users u ON b.user_id=u.id WHERE b.slug=$1`, [req.params.slug]);
  if (!bRows.length) return res.status(404).json({ error: 'Kitap bulunamadı' });
  const book = bRows[0];
  if (book.is_hidden && (!req.user || (req.user.id !== book.user_id && !req.user.is_admin))) {
    return res.status(403).json({ error: 'Bu kitap gizli' });
  }
  const { rows: chapters } = await query('SELECT * FROM book_chapters WHERE book_id=$1 ORDER BY order_num ASC', [book.id]);
  const { rows: pages } = await query('SELECT id,title,page_num,slug,chapter_id FROM book_pages WHERE book_id=$1 ORDER BY page_num ASC', [book.id]);
  res.json({ book, chapters, pages });
});

app.post('/api/books', authMiddleware, async (req, res) => {
  try {
    const { title, preface, karakterler, kadro, cover_image, is_hidden, is_unnamed } = req.body;
    // İsimsiz seçildiyse başlık zorunlu değil, placeholder atanır
    const finalTitle = is_unnamed ? ('İsimsiz Kitap #' + Date.now().toString().slice(-6)) : title;
    if (!is_unnamed && !title) return res.status(400).json({ error: 'Başlık zorunlu' });
    const limitErr = await checkDailyLimit(req.user.id, req.user, 'books');
    if (limitErr) return res.status(429).json({ error: limitErr });
    // İsimsiz kitap her zaman gizli olur
    const finalHidden = is_unnamed ? 1 : (is_hidden ? 1 : 0);
    const tempSlug = slugify(finalTitle, { lower: true, strict: false, locale: 'tr' }).substring(0, 60) + '-' + uuidv4().substring(0, 8);
    const { rows } = await query('INSERT INTO books (user_id,title,preface,karakterler,kadro,cover_image,slug,is_hidden,is_unnamed) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
      [req.user.id, finalTitle, preface||'', karakterler||'', kadro||'', cover_image||'', tempSlug, finalHidden, is_unnamed?1:0]);
    const id = rows[0].id;
    const realSlug = makeSlug(title, id);
    await query('UPDATE books SET slug=$1 WHERE id=$2', [realSlug, id]);
    await query('UPDATE users SET book_count=book_count+1 WHERE id=$1', [req.user.id]);
    await updateUserLevel(req.user.id);
    await logAction(req.user.username, 'create_book', realSlug);
    const { rows: bRows } = await query('SELECT * FROM books WHERE id=$1', [id]);
    res.json(bRows[0]);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.put('/api/book/:slug', authMiddleware, async (req, res) => {
  const { rows: bRows } = await query('SELECT * FROM books WHERE slug=$1', [req.params.slug]);
  if (!bRows.length) return res.status(404).json({ error: 'Kitap bulunamadı' });
  const book = bRows[0];
  if (book.user_id != req.user.id) return res.status(403).json({ error: 'Yetki yok' });
  const { title, preface, karakterler, kadro, cover_image, is_hidden, is_unnamed } = req.body;
  // Başlık güncellendiyse ve is_unnamed sıfırlanmadıysa, is_unnamed'i sıfırla
  const newIsUnnamed = is_unnamed !== undefined ? (is_unnamed ? 1 : 0) : book.is_unnamed;
  await query('UPDATE books SET title=$1,preface=$2,karakterler=$3,kadro=$4,cover_image=$5,is_hidden=$6,is_unnamed=$7,updated_at=NOW() WHERE id=$8',
    [title||book.title, preface??book.preface, karakterler??book.karakterler, kadro??book.kadro, cover_image??book.cover_image, is_hidden!==undefined ? (is_hidden?1:0) : book.is_hidden, newIsUnnamed, book.id]);
  const { rows } = await query('SELECT * FROM books WHERE id=$1', [book.id]);
  res.json(rows[0]);
});

app.delete('/api/book/:slug', authMiddleware, async (req, res) => {
  const { rows: bRows } = await query('SELECT * FROM books WHERE slug=$1', [req.params.slug]);
  if (!bRows.length) return res.status(404).json({ error: 'Kitap bulunamadı' });
  const book = bRows[0];
  if (book.user_id != req.user.id) return res.status(403).json({ error: 'Yetki yok' });
  await query('DELETE FROM book_pages WHERE book_id=$1', [book.id]);
  await query('DELETE FROM book_chapters WHERE book_id=$1', [book.id]);
  await query('DELETE FROM books WHERE id=$1', [book.id]);
  await query('UPDATE users SET book_count=GREATEST(0,book_count-1) WHERE id=$1', [req.user.id]);
  await updateUserLevel(req.user.id);
  await logAction(req.user.username, 'delete_book', req.params.slug);
  res.json({ ok: true });
});

app.post('/api/book/:slug/pages', authMiddleware, async (req, res) => {
  const { rows: bRows } = await query('SELECT * FROM books WHERE slug=$1', [req.params.slug]);
  if (!bRows.length) return res.status(404).json({ error: 'Kitap bulunamadı' });
  const book = bRows[0];
  if (book.user_id != req.user.id) return res.status(403).json({ error: 'Yetki yok' });
  const { title, content, chapter_id, image_url } = req.body;
  if (!title || !content) return res.status(400).json({ error: 'Başlık ve içerik zorunlu' });
  const limitErr = await checkDailyLimit(req.user.id, req.user, 'book_pages');
  if (limitErr) return res.status(429).json({ error: limitErr });
  const { rows: cnt } = await query('SELECT COUNT(*) as c FROM book_pages WHERE book_id=$1', [book.id]);
  const pageNum = parseInt(cnt[0].c) + 1;
  const tempSlug = slugify(title, { lower: true, strict: false, locale: 'tr' }).substring(0, 40) + '-' + Date.now();
  const { rows } = await query('INSERT INTO book_pages (book_id,chapter_id,title,content,page_num,slug,image_url) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
    [book.id, chapter_id||null, title, content, pageNum, tempSlug, image_url||'']);
  const id = rows[0].id;
  const realSlug = makeSlug(title, id);
  await query('UPDATE book_pages SET slug=$1 WHERE id=$2', [realSlug, id]);
  await query('UPDATE books SET page_count=page_count+1, updated_at=NOW() WHERE id=$1', [book.id]);
  const { rows: pRows } = await query('SELECT * FROM book_pages WHERE id=$1', [id]);
  res.json(pRows[0]);
});

app.get('/api/book/:slug/page/:pageSlug', optionalAuth, async (req, res) => {
  const { rows: bRows } = await query('SELECT * FROM books WHERE slug=$1', [req.params.slug]);
  if (!bRows.length) return res.status(404).json({ error: 'Kitap bulunamadı' });
  const book = bRows[0];
  if (book.is_hidden && (!req.user || (req.user.id !== book.user_id && !req.user.is_admin))) {
    return res.status(403).json({ error: 'Bu kitap gizli' });
  }
  const { rows: pRows } = await query('SELECT * FROM book_pages WHERE slug=$1 AND book_id=$2', [req.params.pageSlug, book.id]);
  if (!pRows.length) return res.status(404).json({ error: 'Sayfa bulunamadı' });
  const page = pRows[0];
  const { rows: prev } = await query('SELECT slug,title FROM book_pages WHERE book_id=$1 AND page_num=$2', [book.id, page.page_num-1]);
  const { rows: next } = await query('SELECT slug,title FROM book_pages WHERE book_id=$1 AND page_num=$2', [book.id, page.page_num+1]);
  res.json({ page, book, prev: prev[0]||null, next: next[0]||null });
});

app.put('/api/book/:slug/page/:pageSlug', authMiddleware, async (req, res) => {
  const { rows: bRows } = await query('SELECT * FROM books WHERE slug=$1', [req.params.slug]);
  if (!bRows.length) return res.status(404).json({ error: 'Kitap bulunamadı' });
  const book = bRows[0];
  if (book.user_id != req.user.id) return res.status(403).json({ error: 'Yetki yok' });
  const { rows: pRows } = await query('SELECT * FROM book_pages WHERE slug=$1 AND book_id=$2', [req.params.pageSlug, book.id]);
  if (!pRows.length) return res.status(404).json({ error: 'Sayfa bulunamadı' });
  const page = pRows[0];
  const { title, content, chapter_id } = req.body;
  await query('UPDATE book_pages SET title=$1,content=$2,chapter_id=$3 WHERE id=$4',
    [title||page.title, content||page.content, chapter_id??page.chapter_id, page.id]);
  const { rows } = await query('SELECT * FROM book_pages WHERE id=$1', [page.id]);
  res.json(rows[0]);
});

app.delete('/api/book/:slug/page/:pageSlug', authMiddleware, async (req, res) => {
  const { rows: bRows } = await query('SELECT * FROM books WHERE slug=$1', [req.params.slug]);
  if (!bRows.length) return res.status(404).json({ error: 'Kitap bulunamadı' });
  const book = bRows[0];
  if (book.user_id != req.user.id) return res.status(403).json({ error: 'Yetki yok' });
  const { rows: pRows } = await query('SELECT * FROM book_pages WHERE slug=$1 AND book_id=$2', [req.params.pageSlug, book.id]);
  if (!pRows.length) return res.status(404).json({ error: 'Sayfa bulunamadı' });
  await query('DELETE FROM book_pages WHERE id=$1', [pRows[0].id]);
  await query('UPDATE books SET page_count=GREATEST(0,page_count-1) WHERE id=$1', [book.id]);
  const { rows: remaining } = await query('SELECT id FROM book_pages WHERE book_id=$1 ORDER BY page_num ASC', [book.id]);
  for (let i = 0; i < remaining.length; i++) {
    await query('UPDATE book_pages SET page_num=$1 WHERE id=$2', [i+1, remaining[i].id]);
  }
  res.json({ ok: true });
});

app.post('/api/book/:slug/chapters', authMiddleware, async (req, res) => {
  const { rows: bRows } = await query('SELECT * FROM books WHERE slug=$1', [req.params.slug]);
  if (!bRows.length || bRows[0].user_id != req.user.id) return res.status(403).json({ error: 'Yetki yok' });
  const { title, order_num } = req.body;
  if (!title) return res.status(400).json({ error: 'Başlık zorunlu' });
  const { rows } = await query('INSERT INTO book_chapters (book_id,title,order_num) VALUES ($1,$2,$3) RETURNING *',
    [bRows[0].id, title, order_num||0]);
  res.json(rows[0]);
});

app.put('/api/book/:slug/chapter/:id', authMiddleware, async (req, res) => {
  const { rows: bRows } = await query('SELECT * FROM books WHERE slug=$1', [req.params.slug]);
  if (!bRows.length || bRows[0].user_id != req.user.id) return res.status(403).json({ error: 'Yetki yok' });
  const { rows: chRows } = await query('SELECT * FROM book_chapters WHERE id=$1 AND book_id=$2', [req.params.id, bRows[0].id]);
  if (!chRows.length) return res.status(404).json({ error: 'Bölüm bulunamadı' });
  const ch = chRows[0];
  const { title, order_num } = req.body;
  await query('UPDATE book_chapters SET title=$1,order_num=$2 WHERE id=$3', [title||ch.title, order_num??ch.order_num, ch.id]);
  const { rows } = await query('SELECT * FROM book_chapters WHERE id=$1', [ch.id]);
  res.json(rows[0]);
});

app.delete('/api/book/:slug/chapter/:id', authMiddleware, async (req, res) => {
  const { rows: bRows } = await query('SELECT * FROM books WHERE slug=$1', [req.params.slug]);
  if (!bRows.length || bRows[0].user_id != req.user.id) return res.status(403).json({ error: 'Yetki yok' });
  const { rows: chRows } = await query('SELECT * FROM book_chapters WHERE id=$1 AND book_id=$2', [req.params.id, bRows[0].id]);
  if (!chRows.length) return res.status(404).json({ error: 'Bölüm bulunamadı' });
  await query('UPDATE book_pages SET chapter_id=NULL WHERE chapter_id=$1', [chRows[0].id]);
  await query('DELETE FROM book_chapters WHERE id=$1', [chRows[0].id]);
  res.json({ ok: true });
});

// ===== GROUPS =====
app.get('/api/groups', async (req, res) => {
  const { rows } = await query(`SELECT g.*, u.username as owner_name FROM groups g LEFT JOIN users u ON g.owner_id=u.id ORDER BY g.created_at DESC`);
  res.json(rows);
});

app.get('/api/my-groups', authMiddleware, async (req, res) => {
  const { rows } = await query(`SELECT g.*, gm.role FROM groups g JOIN group_members gm ON gm.group_id=g.id WHERE gm.user_id=$1 ORDER BY g.name ASC`, [req.user.id]);
  res.json(rows);
});

app.get('/api/group/:slug', optionalAuth, async (req, res) => {
  const { rows } = await query(`SELECT g.*, u.username as owner_name FROM groups g LEFT JOIN users u ON g.owner_id=u.id WHERE g.slug=$1`, [req.params.slug]);
  if (!rows.length) return res.status(404).json({ error: 'Grup bulunamadı' });
  const group = rows[0];
  let isMember = false, role = null, joinRequestStatus = null;
  if (req.user) {
    const { rows: m } = await query('SELECT role FROM group_members WHERE group_id=$1 AND user_id=$2', [group.id, req.user.id]);
    if (m.length) { isMember = true; role = m[0].role; }
    // Check if user has pending join request for private group
    if (!isMember && (group.type === 'private' || group.invite_only)) {
      const { rows: jr } = await query('SELECT status, rejection_reason FROM group_join_requests WHERE group_id=$1 AND user_id=$2', [group.id, req.user.id]);
      if (jr.length) joinRequestStatus = { status: jr[0].status, rejectionReason: jr[0].rejection_reason };
    }
  }
  res.json({ group, isMember, role, joinRequestStatus });
});

app.post('/api/groups', authMiddleware, async (req, res) => {
  try {
    const { name, description, cover_image, type, allow_chat, allow_photos, invite_only } = req.body;
    if (!name) return res.status(400).json({ error: 'İsim zorunlu' });
    const tempSlug = slugify(name, { lower: true, strict: false, locale: 'tr' }).substring(0, 60) + '-' + uuidv4().substring(0, 8);
    const { rows } = await query(
      'INSERT INTO groups (name,slug,description,cover_image,owner_id,type,allow_chat,allow_photos,invite_only,member_count) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1) RETURNING id',
      [name, tempSlug, description||'', cover_image||'', req.user.id, type||'public', allow_chat!==false?1:0, allow_photos!==false?1:0, invite_only?1:0]);
    const id = rows[0].id;
    const realSlug = makeSlug(name, id);
    await query('UPDATE groups SET slug=$1 WHERE id=$2', [realSlug, id]);
    await query('INSERT INTO group_members (group_id,user_id,role) VALUES ($1,$2,$3)', [id, req.user.id, 'owner']);
    await logAction(req.user.username, 'create_group', realSlug);
    const { rows: gRows } = await query('SELECT * FROM groups WHERE id=$1', [id]);
    res.json(gRows[0]);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.put('/api/group/:slug', authMiddleware, async (req, res) => {
  const { rows } = await query('SELECT * FROM groups WHERE slug=$1', [req.params.slug]);
  if (!rows.length) return res.status(404).json({ error: 'Grup bulunamadı' });
  const group = rows[0];
  if (group.owner_id != req.user.id) return res.status(403).json({ error: 'Yetki yok' });
  const { name, description, cover_image, type, allow_chat, allow_photos, invite_only } = req.body;
  await query('UPDATE groups SET name=$1,description=$2,cover_image=$3,type=$4,allow_chat=$5,allow_photos=$6,invite_only=$7 WHERE id=$8',
    [name||group.name, description??group.description, cover_image??group.cover_image,
     type||group.type, allow_chat!==undefined?(allow_chat?1:0):group.allow_chat,
     allow_photos!==undefined?(allow_photos?1:0):group.allow_photos,
     invite_only!==undefined?(invite_only?1:0):group.invite_only, group.id]);
  const { rows: gRows } = await query('SELECT * FROM groups WHERE id=$1', [group.id]);
  res.json(gRows[0]);
});

app.delete('/api/group/:slug', authMiddleware, async (req, res) => {
  const { rows } = await query('SELECT * FROM groups WHERE slug=$1', [req.params.slug]);
  if (!rows.length) return res.status(404).json({ error: 'Grup bulunamadı' });
  const group = rows[0];
  if (group.owner_id != req.user.id) return res.status(403).json({ error: 'Yetki yok' });
  await query('DELETE FROM group_messages WHERE group_id=$1', [group.id]);
  await query('DELETE FROM group_members WHERE group_id=$1', [group.id]);
  await query('DELETE FROM group_invites WHERE group_id=$1', [group.id]);
  await query('DELETE FROM moderator_permissions WHERE group_id=$1', [group.id]);
  await query('DELETE FROM groups WHERE id=$1', [group.id]);
  await logAction(req.user.username, 'delete_group', req.params.slug);
  res.json({ ok: true });
});

app.post('/api/group/:slug/join', authMiddleware, async (req, res) => {
  const { rows } = await query('SELECT * FROM groups WHERE slug=$1', [req.params.slug]);
  if (!rows.length) return res.status(404).json({ error: 'Grup bulunamadı' });
  const group = rows[0];
  if (group.type === 'private' || group.invite_only) return res.status(403).json({ error: 'Bu grup sadece davet ile katılabilir' });
  const { rows: ex } = await query('SELECT id FROM group_members WHERE group_id=$1 AND user_id=$2', [group.id, req.user.id]);
  if (ex.length) return res.status(400).json({ error: 'Zaten üyesiniz' });
  await query('INSERT INTO group_members (group_id,user_id,role) VALUES ($1,$2,$3)', [group.id, req.user.id, 'member']);
  await query('UPDATE groups SET member_count=member_count+1 WHERE id=$1', [group.id]);
  res.json({ ok: true });
});

app.post('/api/group/:slug/leave', authMiddleware, async (req, res) => {
  const { rows } = await query('SELECT * FROM groups WHERE slug=$1', [req.params.slug]);
  if (!rows.length) return res.status(404).json({ error: 'Grup bulunamadı' });
  const group = rows[0];
  if (group.owner_id == req.user.id) return res.status(400).json({ error: 'Grup sahibi ayrılamaz' });
  const { rows: ex } = await query('SELECT id FROM group_members WHERE group_id=$1 AND user_id=$2', [group.id, req.user.id]);
  if (!ex.length) return res.status(400).json({ error: 'Üye değilsiniz' });
  await query('DELETE FROM group_members WHERE group_id=$1 AND user_id=$2', [group.id, req.user.id]);
  await query('UPDATE groups SET member_count=GREATEST(0,member_count-1) WHERE id=$1', [group.id]);
  res.json({ ok: true });
});

app.post('/api/group/:slug/invite', authMiddleware, async (req, res) => {
  const { rows } = await query('SELECT * FROM groups WHERE slug=$1', [req.params.slug]);
  if (!rows.length) return res.status(404).json({ error: 'Grup bulunamadı' });
  const group = rows[0];
  const { rows: m } = await query('SELECT role FROM group_members WHERE group_id=$1 AND user_id=$2', [group.id, req.user.id]);
  if (!m.length || (m[0].role !== 'owner' && m[0].role !== 'moderator')) return res.status(403).json({ error: 'Yetki yok' });
  const code = uuidv4().substring(0, 8).toUpperCase();
  await query('INSERT INTO group_invites (group_id,invite_code,created_by) VALUES ($1,$2,$3)', [group.id, code, req.user.id]);
  res.json({ invite_code: code });
});

app.post('/api/group/join-invite', authMiddleware, async (req, res) => {
  const { invite_code } = req.body;
  if (!invite_code) return res.status(400).json({ error: 'Kod zorunlu' });
  const { rows } = await query('SELECT * FROM group_invites WHERE invite_code=$1', [invite_code.toUpperCase()]);
  if (!rows.length) return res.status(404).json({ error: 'Geçersiz davet kodu' });
  const invite = rows[0];
  const { rows: ex } = await query('SELECT id FROM group_members WHERE group_id=$1 AND user_id=$2', [invite.group_id, req.user.id]);
  if (ex.length) return res.status(400).json({ error: 'Zaten üyesiniz' });
  await query('INSERT INTO group_members (group_id,user_id,role) VALUES ($1,$2,$3)', [invite.group_id, req.user.id, 'member']);
  await query('UPDATE groups SET member_count=member_count+1 WHERE id=$1', [invite.group_id]);
  res.json({ ok: true });
});

// Gizli grup join request endpoints
app.post('/api/group/:slug/join-request', authMiddleware, async (req, res) => {
  const { rows } = await query('SELECT * FROM groups WHERE slug=$1', [req.params.slug]);
  if (!rows.length) return res.status(404).json({ error: 'Grup bulunamadı' });
  const group = rows[0];
  if (group.type !== 'private' && !group.invite_only) return res.status(400).json({ error: 'Bu grup için istek gerekli değil' });
  const { rows: ex } = await query('SELECT id FROM group_members WHERE group_id=$1 AND user_id=$2', [group.id, req.user.id]);
  if (ex.length) return res.status(400).json({ error: 'Zaten üyesiniz' });
  const { rows: existing } = await query('SELECT id FROM group_join_requests WHERE group_id=$1 AND user_id=$2 AND status=$3', [group.id, req.user.id, 'pending']);
  if (existing.length) return res.status(400).json({ error: 'Zaten istek gönderilmiş' });
  await query('INSERT INTO group_join_requests (group_id, user_id, status) VALUES ($1, $2, $3)', [group.id, req.user.id, 'pending']);
  res.json({ ok: true });
});

app.get('/api/group/:slug/join-requests', authMiddleware, async (req, res) => {
  const { rows } = await query('SELECT * FROM groups WHERE slug=$1', [req.params.slug]);
  if (!rows.length) return res.status(404).json({ error: 'Grup bulunamadı' });
  const group = rows[0];
  if (group.owner_id !== req.user.id) return res.status(403).json({ error: 'Yetki yok' });
  const { rows: requests } = await query(`
    SELECT jr.*, u.username, u.avatar FROM group_join_requests jr
    LEFT JOIN users u ON jr.user_id=u.id
    WHERE jr.group_id=$1 AND jr.status='pending'
    ORDER BY jr.created_at ASC
  `, [group.id]);
  res.json(requests);
});

app.post('/api/group/:slug/join-request/:requestId/respond', authMiddleware, async (req, res) => {
  const { action, rejectionReason } = req.body;
  const { rows: groupRows } = await query('SELECT * FROM groups WHERE slug=$1', [req.params.slug]);
  if (!groupRows.length) return res.status(404).json({ error: 'Grup bulunamadı' });
  const group = groupRows[0];
  if (group.owner_id !== req.user.id) return res.status(403).json({ error: 'Yetki yok' });
  const { rows: requests } = await query('SELECT * FROM group_join_requests WHERE id=$1 AND group_id=$2', [req.params.requestId, group.id]);
  if (!requests.length) return res.status(404).json({ error: 'İstek bulunamadı' });
  const request = requests[0];
  if (action === 'approve') {
    await query('UPDATE group_join_requests SET status=$1, reviewed_at=NOW(), reviewed_by=$2 WHERE id=$3', ['approved', req.user.id, request.id]);
    await query('INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, $3)', [group.id, request.user_id, 'member']);
    await query('UPDATE groups SET member_count=member_count+1 WHERE id=$1', [group.id]);
  } else if (action === 'reject') {
    await query('UPDATE group_join_requests SET status=$1, rejection_reason=$2, reviewed_at=NOW(), reviewed_by=$3 WHERE id=$4', 
      ['rejected', rejectionReason || '', req.user.id, request.id]);
  }
  res.json({ ok: true });
});

app.get('/api/group/:slug/members', async (req, res) => {
  const { rows: gRows } = await query('SELECT id FROM groups WHERE slug=$1', [req.params.slug]);
  if (!gRows.length) return res.status(404).json({ error: 'Grup bulunamadı' });
  const { rows } = await query(`SELECT gm.*, u.username, u.avatar, u.avatar_removed, u.name_color, u.is_vip, u.level_id FROM group_members gm LEFT JOIN users u ON gm.user_id=u.id WHERE gm.group_id=$1 ORDER BY gm.joined_at ASC`, [gRows[0].id]);
  res.json(rows);
});

app.get('/api/group/:slug/messages', optionalAuth, async (req, res) => {
  const { rows: gRows } = await query('SELECT * FROM groups WHERE slug=$1', [req.params.slug]);
  if (!gRows.length) return res.status(404).json({ error: 'Grup bulunamadı' });
  const group = gRows[0];
  if (group.type === 'private') {
    if (!req.user) return res.status(401).json({ error: 'Giriş gerekli' });
    const { rows: m } = await query('SELECT id FROM group_members WHERE group_id=$1 AND user_id=$2', [group.id, req.user.id]);
    if (!m.length) return res.status(403).json({ error: 'Üye değilsiniz' });
  }
  const before_id = req.query.before_id ? parseInt(req.query.before_id) : null;
  const limit = 60;
  let sql, params;
  if (before_id) {
    sql = `SELECT gm.*, u.username, u.avatar, u.avatar_removed, u.name_color, u.is_vip, u.badge_name, u.badge_icon, u.badge_color FROM group_messages gm LEFT JOIN users u ON gm.user_id=u.id WHERE gm.group_id=$1 AND gm.id < $2 ORDER BY gm.created_at DESC LIMIT $3`;
    params = [group.id, before_id, limit];
  } else {
    sql = `SELECT gm.*, u.username, u.avatar, u.avatar_removed, u.name_color, u.is_vip, u.badge_name, u.badge_icon, u.badge_color FROM group_messages gm LEFT JOIN users u ON gm.user_id=u.id WHERE gm.group_id=$1 ORDER BY gm.created_at DESC LIMIT $2`;
    params = [group.id, limit];
  }
  const { rows } = await query(sql, params);
  res.json(rows.reverse()); // en eskiden yeniye
});

app.post('/api/group/:slug/messages', authMiddleware, async (req, res) => {
  const { rows: gRows } = await query('SELECT * FROM groups WHERE slug=$1', [req.params.slug]);
  if (!gRows.length) return res.status(404).json({ error: 'Grup bulunamadı' });
  const group = gRows[0];
  if (!group.allow_chat) return res.status(403).json({ error: 'Sohbet kapalı' });
  const { rows: m } = await query('SELECT id FROM group_members WHERE group_id=$1 AND user_id=$2', [group.id, req.user.id]);
  if (!m.length) return res.status(403).json({ error: 'Üye değilsiniz' });
  const { content, image_url } = req.body;
  if (!content?.trim() && !image_url) return res.status(400).json({ error: 'Mesaj boş olamaz' });
  const { rows } = await query('INSERT INTO group_messages (group_id,user_id,content,image_url) VALUES ($1,$2,$3,$4) RETURNING id',
    [group.id, req.user.id, content||'', image_url||'']);
  const { rows: msg } = await query(`SELECT gm.*, u.username, u.avatar, u.avatar_removed, u.name_color, u.is_vip, u.badge_name, u.badge_icon, u.badge_color FROM group_messages gm LEFT JOIN users u ON gm.user_id=u.id WHERE gm.id=$1`, [rows[0].id]);
  res.json(msg[0]);
});

app.delete('/api/group/:slug/messages/:id', authMiddleware, async (req, res) => {
  const { rows: gRows } = await query('SELECT * FROM groups WHERE slug=$1', [req.params.slug]);
  if (!gRows.length) return res.status(404).json({ error: 'Grup bulunamadı' });
  const group = gRows[0];
  const { rows: msgRows } = await query('SELECT * FROM group_messages WHERE id=$1 AND group_id=$2', [req.params.id, group.id]);
  if (!msgRows.length) return res.status(404).json({ error: 'Mesaj bulunamadı' });
  const msg = msgRows[0];
  const { rows: member } = await query('SELECT role FROM group_members WHERE group_id=$1 AND user_id=$2', [group.id, req.user.id]);
  const { rows: perm } = await query('SELECT * FROM moderator_permissions WHERE group_id=$1 AND user_id=$2', [group.id, req.user.id]);
  const isMod = member[0]?.role === 'moderator' || member[0]?.role === 'owner';
  // Kendi mesajı, grup sahibi veya moderatör (yetki kaydı yoksa da moderatöre izin ver)
  const canDelete = msg.user_id == req.user.id
    || group.owner_id == req.user.id
    || isMod;
  if (!canDelete) return res.status(403).json({ error: 'Yetki yok' });
  await query('DELETE FROM group_messages WHERE id=$1', [msg.id]);
  res.json({ ok: true });
});

app.post('/api/group/:slug/moderator/:userId', authMiddleware, async (req, res) => {
  const { rows: gRows } = await query('SELECT * FROM groups WHERE slug=$1', [req.params.slug]);
  if (!gRows.length || gRows[0].owner_id != req.user.id) return res.status(403).json({ error: 'Yetki yok' });
  const group = gRows[0];
  const userId = parseInt(req.params.userId);
  const { rows: m } = await query('SELECT * FROM group_members WHERE group_id=$1 AND user_id=$2', [group.id, userId]);
  if (!m.length) return res.status(404).json({ error: 'Üye bulunamadı' });
  await query('UPDATE group_members SET role=$1 WHERE group_id=$2 AND user_id=$3', ['moderator', group.id, userId]);
  await query('INSERT INTO moderator_permissions (group_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [group.id, userId]);
  res.json({ ok: true });
});

app.delete('/api/group/:slug/moderator/:userId', authMiddleware, async (req, res) => {
  const { rows: gRows } = await query('SELECT * FROM groups WHERE slug=$1', [req.params.slug]);
  if (!gRows.length || gRows[0].owner_id != req.user.id) return res.status(403).json({ error: 'Yetki yok' });
  const userId = parseInt(req.params.userId);
  await query('UPDATE group_members SET role=$1 WHERE group_id=$2 AND user_id=$3', ['member', gRows[0].id, userId]);
  await query('DELETE FROM moderator_permissions WHERE group_id=$1 AND user_id=$2', [gRows[0].id, userId]);
  res.json({ ok: true });
});

app.put('/api/group/:slug/moderator/:userId/permissions', authMiddleware, async (req, res) => {
  const { rows: gRows } = await query('SELECT * FROM groups WHERE slug=$1', [req.params.slug]);
  if (!gRows.length || gRows[0].owner_id != req.user.id) return res.status(403).json({ error: 'Yetki yok' });
  const userId = parseInt(req.params.userId);
  const { can_delete_messages, can_ban_members, can_edit_group, can_manage_invites } = req.body;
  await query(`INSERT INTO moderator_permissions (group_id,user_id,can_delete_messages,can_ban_members,can_edit_group,can_manage_invites)
    VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (group_id,user_id) DO UPDATE SET can_delete_messages=EXCLUDED.can_delete_messages,
    can_ban_members=EXCLUDED.can_ban_members, can_edit_group=EXCLUDED.can_edit_group, can_manage_invites=EXCLUDED.can_manage_invites`,
    [gRows[0].id, userId, can_delete_messages?1:0, can_ban_members?1:0, can_edit_group?1:0, can_manage_invites?1:0]);
  res.json({ ok: true });
});

app.post('/api/group/:slug/ban/:userId', authMiddleware, async (req, res) => {
  const { rows: gRows } = await query('SELECT * FROM groups WHERE slug=$1', [req.params.slug]);
  if (!gRows.length) return res.status(404).json({ error: 'Grup bulunamadı' });
  const group = gRows[0];
  const { rows: member } = await query('SELECT role FROM group_members WHERE group_id=$1 AND user_id=$2', [group.id, req.user.id]);
  const { rows: perm } = await query('SELECT * FROM moderator_permissions WHERE group_id=$1 AND user_id=$2', [group.id, req.user.id]);
  const canBan = group.owner_id==req.user.id || (member[0]?.role==='moderator' && perm[0]?.can_ban_members);
  if (!canBan) return res.status(403).json({ error: 'Yetki yok' });
  const userId = parseInt(req.params.userId);
  await query('DELETE FROM group_members WHERE group_id=$1 AND user_id=$2', [group.id, userId]);
  await query('UPDATE groups SET member_count=GREATEST(0,member_count-1) WHERE id=$1', [group.id]);
  res.json({ ok: true });
});

app.post('/api/group/:slug/upload', authMiddleware, upload.single('image'), async (req, res) => {
  const { rows } = await query('SELECT allow_photos FROM groups WHERE slug=$1', [req.params.slug]);
  if (!rows.length || !rows[0].allow_photos) return res.status(403).json({ error: 'Fotoğraf yükleme kapalı' });
  if (!req.file) return res.status(400).json({ error: 'Dosya bulunamadı' });
  try {
    const url = await handleUpload(req.file);
    res.json({ url });
  } catch (e) {
    res.status(500).json({ error: 'Yükleme hatası: ' + e.message });
  }
});

// ===== TAKIP =====
app.get('/api/users/:username/follow-status', optionalAuth, async (req, res) => {
  const { rows: target } = await query('SELECT id, is_private FROM users WHERE username=$1', [req.params.username]);
  if (!target.length) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  if (!req.user || req.user.id === target[0].id) return res.json({ following: false, pending: false, is_private: !!target[0].is_private });
  const { rows } = await query('SELECT status FROM follows WHERE follower_id=$1 AND following_id=$2', [req.user.id, target[0].id]);
  res.json({ following: rows[0]?.status === 'accepted', pending: rows[0]?.status === 'pending', is_private: !!target[0].is_private });
});

app.post('/api/users/:username/follow', authMiddleware, async (req, res) => {
  const { rows: target } = await query('SELECT id, is_private FROM users WHERE username=$1', [req.params.username]);
  if (!target.length) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  if (target[0].id === req.user.id) return res.status(400).json({ error: 'Kendinizi takip edemezsiniz' });
  const status = target[0].is_private ? 'pending' : 'accepted';
  await query(`INSERT INTO follows (follower_id, following_id, status) VALUES ($1,$2,$3)
    ON CONFLICT (follower_id, following_id) DO UPDATE SET status=EXCLUDED.status`, [req.user.id, target[0].id, status]);
  await query(`INSERT INTO notifications (user_id,type,actor_username,actor_avatar,title,body,link)
    VALUES ($1,$2,$3,$4,$5,$6,$7)`, [target[0].id, status === 'pending' ? 'follow_request' : 'follow', req.user.username, req.user.avatar || '', status === 'pending' ? 'Yeni takip isteği' : 'Yeni takipçi', '@' + req.user.username + (status === 'pending' ? ' seni takip etmek istiyor.' : ' seni takip etti.'), '/profil/' + req.user.username]);
  res.json({ following: status === 'accepted', pending: status === 'pending' });
});

app.delete('/api/users/:username/follow', authMiddleware, async (req, res) => {
  const { rows: target } = await query('SELECT id FROM users WHERE username=$1', [req.params.username]);
  if (!target.length) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  await query('DELETE FROM follows WHERE follower_id=$1 AND following_id=$2', [req.user.id, target[0].id]);
  res.json({ following: false, pending: false });
});

async function canViewFollowList(username, viewer, listType) {
  const { rows: target } = await query('SELECT id,is_private,profile_visibility FROM users WHERE username=$1', [username]);
  if (!target.length) return null;
  let visibility = { followers: true, following: true };
  try { visibility = { ...visibility, ...(target[0].profile_visibility ? JSON.parse(target[0].profile_visibility) : {}) }; } catch {}
  if (visibility[listType] === false) return false;
  if (!target[0].is_private || (viewer && viewer.id === target[0].id)) return target[0].id;
  if (!viewer) return false;
  const { rows } = await query("SELECT 1 FROM follows WHERE follower_id=$1 AND following_id=$2 AND status='accepted'", [viewer.id, target[0].id]);
  return rows.length ? target[0].id : false;
}

app.get('/api/users/:username/followers', optionalAuth, async (req, res) => {
  const userId = await canViewFollowList(req.params.username, req.user, 'followers');
  if (userId === null) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  if (userId === false) return res.status(403).json({ error: 'Bu hesap gizli' });
  const { rows } = await query("SELECT u.id,u.username,u.avatar,u.title FROM follows f JOIN users u ON u.id=f.follower_id WHERE f.following_id=$1 AND f.status='accepted' ORDER BY f.created_at DESC", [userId]);
  res.json(rows);
});

app.get('/api/users/:username/following', optionalAuth, async (req, res) => {
  const userId = await canViewFollowList(req.params.username, req.user, 'following');
  if (userId === null) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  if (userId === false) return res.status(403).json({ error: 'Bu hesap gizli' });
  const { rows } = await query("SELECT u.id,u.username,u.avatar,u.title FROM follows f JOIN users u ON u.id=f.following_id WHERE f.follower_id=$1 AND f.status='accepted' ORDER BY f.created_at DESC", [userId]);
  res.json(rows);
});

app.get('/api/follow-requests', authMiddleware, async (req, res) => {
  const { rows } = await query(`SELECT f.id,f.created_at,u.id AS user_id,u.username,u.avatar,u.title
    FROM follows f JOIN users u ON u.id=f.follower_id
    WHERE f.following_id=$1 AND f.status='pending' ORDER BY f.created_at DESC`, [req.user.id]);
  res.json(rows);
});

app.post('/api/follow-requests/:id/respond', authMiddleware, async (req, res) => {
  const { rows } = await query(`SELECT f.* FROM follows f WHERE f.id=$1 AND f.following_id=$2 AND f.status='pending'`, [req.params.id, req.user.id]);
  if (!rows.length) return res.status(404).json({ error: 'Takip isteği bulunamadı' });
  if (req.body.action === 'accept') {
    await query("UPDATE follows SET status='accepted' WHERE id=$1", [rows[0].id]);
    await query(`INSERT INTO notifications (user_id,type,actor_username,actor_avatar,title,body,link)
      VALUES ($1,'follow_accepted',$2,$3,'Takip isteği kabul edildi','Takip isteğin kabul edildi.',$4)`, [rows[0].follower_id, req.user.username, req.user.avatar || '', '/profil/' + req.user.username]);
  } else await query('DELETE FROM follows WHERE id=$1', [rows[0].id]);
  res.json({ ok: true });
});

// ===== PROFILE =====
app.get('/api/profile/:username', optionalAuth, async (req, res) => {
  const { rows: users } = await query('SELECT * FROM users WHERE username=$1', [req.params.username]);
  if (!users.length) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  const user = users[0];
  const isOwner = req.user && req.user.id === user.id;
  const isFollower = req.user && (await query("SELECT 1 FROM follows WHERE follower_id=$1 AND following_id=$2 AND status='accepted'", [req.user.id, user.id])).rows.length > 0;
  const { rows: followCounts } = await query(`SELECT
    (SELECT COUNT(*) FROM follows WHERE following_id=$1 AND status='accepted') AS followers_count,
    (SELECT COUNT(*) FROM follows WHERE follower_id=$1 AND status='accepted') AS following_count`, [user.id]);
  if (user.is_private && !isOwner && !isFollower) {
    return res.json({ user: sanitizeUser(user), forums: [], books: [], groups: [], videos: [], songs: [], level: null, levels: [], book_page_count: 0, private_profile: true, followers_count: Number(followCounts[0].followers_count), following_count: Number(followCounts[0].following_count), following: false });
  }
  const [forums, books, groups, level, levels, bpCount, photos] = await Promise.all([
    query('SELECT * FROM forums WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20', [user.id]).then(r => r.rows),
    query('SELECT * FROM books WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20', [user.id]).then(r => r.rows),
    query(`SELECT g.* FROM groups g INNER JOIN group_members gm ON g.id=gm.group_id WHERE gm.user_id=$1 LIMIT 20`, [user.id]).then(r => r.rows),
    query('SELECT * FROM levels WHERE id=$1', [user.level_id]).then(r => r.rows[0] || null),
    query('SELECT * FROM levels ORDER BY order_num ASC').then(r => r.rows),
    query('SELECT COUNT(*) as c FROM book_pages bp INNER JOIN books b ON bp.book_id=b.id WHERE b.user_id=$1', [user.id]).then(r => parseInt(r.rows[0].c)),
    query('SELECT p.id,p.url,p.title,p.caption,p.location,p.created_at,p.song_id,s.title AS song_title,s.artist_name AS song_artist FROM photos p LEFT JOIN songs s ON s.id=p.song_id WHERE p.user_id=$1 ORDER BY p.created_at DESC LIMIT 50', [user.id]).then(r => r.rows),
  ]);
  res.json({ user: sanitizeUser(user), forums, books, groups, photos, level, levels, book_page_count: bpCount, private_profile: false, followers_count: Number(followCounts[0].followers_count), following_count: Number(followCounts[0].following_count), following: !!(req.user && (await query("SELECT 1 FROM follows WHERE follower_id=$1 AND following_id=$2 AND status='accepted'", [req.user.id, user.id])).rows.length) });
});

app.get('/api/user/:username/saved-videos', authMiddleware, async (req, res) => {
  if (req.user.username.toLowerCase() !== String(req.params.username).toLowerCase()) return res.status(403).json({ error: 'Kaydedilenler yalnızca size görünür.' });
  const { rows } = await query(`SELECT v.*, u.username, u.avatar, u.avatar_removed,
    (SELECT COUNT(*) FROM video_likes vl WHERE vl.video_id=v.id) AS like_count,
    (SELECT COUNT(*) FROM video_comments vc WHERE vc.video_id=v.id) AS comment_count
    FROM video_saves s JOIN videos v ON v.id=s.video_id LEFT JOIN users u ON u.id=v.user_id
    WHERE s.user_id=$1 ORDER BY v.created_at DESC`, [req.user.id]);
  res.json(rows);
});

app.get('/api/me/profile-visibility', authMiddleware, async (req, res) => {
  const { rows } = await query('SELECT profile_visibility FROM users WHERE id=$1', [req.user.id]);
  let visibility = {};
  try { visibility = rows[0]?.profile_visibility ? JSON.parse(rows[0].profile_visibility) : {}; } catch {}
  if (!Object.keys(visibility).length) {
    const { rows: settings } = await query("SELECT value FROM settings WHERE key='homepage_sections'");
    let sections = [];
    try { sections = JSON.parse(settings[0]?.value || '[]'); } catch {}
    const map = { konular: 'forums', kitaplar: 'books', yorumlar: 'comments', fotograflar: 'photos', muzikler: 'music' };
    visibility = { forums: false, books: false, comments: false, photos: false, music: false };
    (Array.isArray(sections) ? sections : []).forEach(section => { const key = map[section] || section; if (key in visibility) visibility[key] = true; });
  }
  res.json({ visibility });
});

app.put('/api/me/profile-visibility', authMiddleware, async (req, res) => {
  const allowed = ['forums', 'books', 'comments', 'photos', 'music', 'followers', 'following', 'followers_list', 'following_list'];
  const visibility = {};
  allowed.forEach(key => { visibility[key] = req.body.visibility?.[key] !== false; });
  await query('UPDATE users SET profile_visibility=$1 WHERE id=$2', [JSON.stringify(visibility), req.user.id]);
  const { rows } = await query('SELECT * FROM users WHERE id=$1', [req.user.id]);
  res.json({ visibility, user: sanitizeUser(rows[0]) });
});

app.put('/api/profile', authMiddleware, upload.single('avatar'), async (req, res) => {
  const { bio, links, name_color, name_color_mode, name_gradient, show_level_badge, show_level_color, title, location, allow_mentions, tag_permission, badge_name, badge_icon, badge_color, badge_display, is_private, avatar_removed } = req.body;
  const canSetBadge = req.user.is_vip || req.user.is_plus;
  const canSetCustomColor = req.user.is_vip || req.user.is_plus;
  let resolvedColorMode = name_color_mode ?? req.user.name_color_mode ?? 'solid';
  let resolvedGradient = name_gradient !== undefined ? name_gradient : (req.user.name_gradient || '');
  if (resolvedColorMode === 'gradient') {
    if (!req.user.is_plus) {
      return res.status(403).json({ error: 'Gradyan isim rengi yalnızca Plus üyeler için kullanılabilir.' });
    }
    try {
      const parsed = typeof resolvedGradient === 'string' ? JSON.parse(resolvedGradient || '{}') : resolvedGradient;
      if (!parsed?.colors?.filter(Boolean)?.length) {
        return res.status(400).json({ error: 'Gradyan için en az bir renk seçmelisiniz.' });
      }
      resolvedGradient = JSON.stringify({
        type: ['linear', 'radial', 'conic'].includes(parsed.type) ? parsed.type : 'linear',
        angle: Number.isFinite(+parsed.angle) ? +parsed.angle : 135,
        colors: parsed.colors.filter(Boolean).slice(0, 5),
      });
    } catch {
      return res.status(400).json({ error: 'Gradyan ayarları geçersiz.' });
    }
  } else {
    resolvedColorMode = 'solid';
    if (!canSetCustomColor) resolvedGradient = req.user.name_gradient || '';
  }
  function parseBool(value) {
    if (typeof value === 'string') return value === 'true' || value === '1';
    return !!value;
  }
  let newAvatar = req.user.avatar;
  if (req.file) {
    try {
      newAvatar = await handleUpload(req.file);
    } catch (e) {
      return res.status(500).json({ error: 'Avatar yükleme hatası: ' + e.message });
    }
  }
  const avatarRemoved = req.file ? 0 : (avatar_removed !== undefined ? (parseBool(avatar_removed) ? 1 : 0) : (req.user.avatar_removed || 0));
  const newLinks = links ? (typeof links === 'string' ? links : JSON.stringify(links)) : req.user.links;
  const selectedBadgeDisplay = badge_display || req.user.badge_display || 'level';
  const allowedBadgeDisplay = ['level','none'].includes(selectedBadgeDisplay)
    ? selectedBadgeDisplay
    : (canSetBadge && ['vip','plus','custom'].includes(selectedBadgeDisplay) ? selectedBadgeDisplay : req.user.badge_display || 'level');
  const resolvedTagPermission = ['friends', 'everyone', 'nobody'].includes(tag_permission) ? tag_permission : (req.user.tag_permission || 'everyone');
  await query('UPDATE users SET bio=$1,links=$2,name_color=$3,name_color_mode=$4,name_gradient=$5,show_level_badge=$6,show_level_color=$7,avatar=$8,avatar_removed=$9,title=$10,location=$11,allow_mentions=$12,tag_permission=$13,badge_name=$14,badge_icon=$15,badge_color=$16,badge_display=$17,is_private=$18 WHERE id=$19',
    [bio??req.user.bio, newLinks,
     canSetCustomColor ? (name_color??req.user.name_color) : req.user.name_color,
     canSetCustomColor ? resolvedColorMode : (req.user.name_color_mode || 'solid'),
     canSetCustomColor ? resolvedGradient : (req.user.name_gradient || ''),
     show_level_badge!==undefined?(parseBool(show_level_badge)?1:0):req.user.show_level_badge,
     show_level_color!==undefined?(parseBool(show_level_color)?1:0):req.user.show_level_color,
    newAvatar, avatarRemoved, title??req.user.title??'', location??req.user.location??'',
    allow_mentions!==undefined?(parseBool(allow_mentions)?1:0):(req.user.allow_mentions??1),
    resolvedTagPermission,
    canSetBadge ? (badge_name??req.user.badge_name) : req.user.badge_name,
    canSetBadge ? (badge_icon??req.user.badge_icon) : req.user.badge_icon,
    canSetBadge ? (badge_color??req.user.badge_color) : req.user.badge_color,
    allowedBadgeDisplay,
    is_private!==undefined?(parseBool(is_private)?1:0):(req.user.is_private??0),
    req.user.id]);
  const { rows } = await query('SELECT * FROM users WHERE id=$1', [req.user.id]);
  res.json(sanitizeUser(rows[0]));
});

app.put('/api/profile/username', authMiddleware, async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: 'Kullanıcı adı zorunlu' });
    if (/\s/.test(username)) return res.status(400).json({ error: 'Kullanıcı adında boşluk oluşamaz' });
    if (username.length < 3 || username.length > 30) return res.status(400).json({ error: 'Kullanıcı adı 3-30 karakter olmalı' });
    if (!/^[a-zA-ZğüşıöçĞÜŞİÖÇ0-9_]+$/.test(username)) return res.status(400).json({ error: 'Kullanıcı adı yalnızca harf, rakam ve alt çizgi içerebilir' });
    if (username.toLowerCase() === req.user.username.toLowerCase()) return res.status(400).json({ error: 'Bu zaten mevcut kullanıcı adınız' });

    const now = new Date();
    let changes = req.user.username_changes || 0;
    let resetAt = req.user.username_change_reset_at ? new Date(req.user.username_change_reset_at) : null;

    // Süre dolmuşsa sıfırla
    if (resetAt && resetAt <= now) {
      changes = 0;
      resetAt = null;
      await query('UPDATE users SET username_changes=0, username_change_reset_at=NULL WHERE id=$1', [req.user.id]);
    }

    if (changes >= 2) {
      const resetDateStr = resetAt ? resetAt.toLocaleDateString('tr-TR') : '?';
      return res.status(429).json({ error: `Kullanıcı adını 2 kez değiştirdiniz. ${resetDateStr} tarihinde tekrar değiştirebilirsiniz.` });
    }

    const { rows: existing } = await query('SELECT id FROM users WHERE LOWER(username)=LOWER($1) AND id!=$2', [username, req.user.id]);
    if (existing.length) return res.status(400).json({ error: 'Bu kullanıcı adı zaten kullanımda' });

    const newChanges = changes + 1;
    // 2. değişimde 7 günlük bekleme başlar; 1. değişimde de 7 günlük pencere başlat
    const newResetAt = newChanges === 1
      ? new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
      : (resetAt || new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000));

    await query('UPDATE users SET username=$1, username_changes=$2, username_change_reset_at=$3 WHERE id=$4',
      [username, newChanges, newResetAt, req.user.id]);
    await logAction(req.user.username, 'change_username', username);
    const { rows } = await query('SELECT * FROM users WHERE id=$1', [req.user.id]);
    res.json(sanitizeUser(rows[0]));
  } catch (e) { res.status(500).json({ error: 'Güncelleme hatası: ' + e.message }); }
});

app.put('/api/profile/password', authMiddleware, async (req, res) => {
  const { old_password, new_password } = req.body;
  if (!old_password || !new_password) return res.status(400).json({ error: 'Eski ve yeni şifre zorunlu' });
  if (req.user.password_hash !== hashPassword(old_password)) return res.status(401).json({ error: 'Eski şifre yanlış' });
  if (new_password.length < 6) return res.status(400).json({ error: 'Yeni şifre en az 6 karakter' });
  await query('UPDATE users SET password_hash=$1 WHERE id=$2', [hashPassword(new_password), req.user.id]);
  res.json({ ok: true });
});

app.post('/api/upload', authMiddleware, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Dosya bulunamadı' });
  try {
    const url = await handleUpload(req.file);
    res.json({ url });
  } catch (e) {
    res.status(500).json({ error: 'Yükleme hatası: ' + e.message });
  }
});

app.post('/api/upload-video', authMiddleware, (req, res, next) => {
  largeVideoUpload.single('file')(req, res, error => {
    if (error) return res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'Video boyutu 500 MB sınırını geçemez.' : error.message });
    next();
  });
}, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Video dosyası gerekli' });
  try {
    const url = await handleLargeVideoUpload(req.file);
    res.json({ url });
  } catch (error) {
    res.status(500).json({ error: 'Video yüklenemedi: ' + error.message });
  }
});

app.post('/api/reals/upload-url', authMiddleware, async (req, res) => {
  if (!USE_R2) return res.status(503).json({ error: 'Reals R2 depolama ayarlanmamış.' });
  const contentType = String(req.body?.content_type || 'video/mp4');
  if (!contentType.startsWith('video/')) return res.status(400).json({ error: 'Geçersiz video türü.' });
  const extension = path.extname(String(req.body?.filename || '')).toLowerCase() || '.mp4';
  const key = `reals/${uuidv4()}${extension}`;
  try {
    const command = new PutObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key, ContentType: contentType });
    const uploadUrl = await getSignedUrl(r2Client, command, { expiresIn: 900 });
    const publicBase = (process.env.R2_PUBLIC_URL || `${R2_ENDPOINT}/${process.env.R2_BUCKET_NAME}`).replace(/\/$/, '');
    res.json({ upload_url: uploadUrl, public_url: `${publicBase}/${key}` });
  } catch (error) {
    res.status(500).json({ error: 'Reals yükleme bağlantısı oluşturulamadı: ' + error.message });
  }
});

app.get('/api/photos', optionalAuth, async (req, res) => {
  const { username } = req.query;
  const userId = req.user ? req.user.id : 0;
  const base = `SELECT p.id, p.url, p.title, p.caption, p.location, p.song_id, p.song_start_seconds, s.title AS song_title, s.artist_name AS song_artist, s.audio_url AS song_audio_url, s.cover_url AS song_cover_url, p.created_at, p.user_id, u.username, u.avatar, COALESCE(p.show_likes,1) AS show_likes, COALESCE(p.allow_comments,1) AS allow_comments, COALESCE(p.allow_shares,1) AS allow_shares,
    (SELECT COUNT(*) FROM photo_likes pl WHERE pl.photo_id = p.id) AS like_count,
    (SELECT COUNT(*) FROM photo_comments pc WHERE pc.photo_id = p.id) AS comment_count,
    (CASE WHEN $1::bigint = 0 THEN 0 ELSE (SELECT COUNT(*) FROM photo_likes pl2 WHERE pl2.photo_id=p.id AND pl2.user_id=$1) END) > 0 AS liked
    FROM photos p LEFT JOIN users u ON u.id=p.user_id LEFT JOIN songs s ON s.id=p.song_id`;
  const visibility = `(COALESCE(u.is_private,0)=0 OR p.user_id=$1 OR EXISTS (SELECT 1 FROM follows f WHERE f.follower_id=$1 AND f.following_id=p.user_id AND f.status='accepted'))`;
  const queryText = username
    ? `${base} WHERE u.username = $2 AND ${visibility} ORDER BY p.created_at DESC LIMIT 100`
    : `${base} WHERE ${visibility} ORDER BY p.created_at DESC LIMIT 100`;
  const { rows } = username ? await query(queryText, [userId, username]) : await query(queryText, [userId]);
  res.json(rows);
});

app.get('/api/photos/:id', optionalAuth, async (req, res) => {
  const userId = req.user ? req.user.id : 0;
  const { rows } = await query(
    `SELECT p.id, p.url, p.title, p.caption, p.location, p.song_id, p.song_start_seconds,
      s.title AS song_title, s.artist_name AS song_artist, s.audio_url AS song_audio_url, s.cover_url AS song_cover_url,
      p.created_at, p.user_id, u.username, u.avatar, COALESCE(p.show_likes,1) AS show_likes, COALESCE(p.allow_comments,1) AS allow_comments, COALESCE(p.allow_shares,1) AS allow_shares,
      (SELECT COUNT(*) FROM photo_likes pl WHERE pl.photo_id = p.id) AS like_count,
      (SELECT COUNT(*) FROM photo_comments pc WHERE pc.photo_id = p.id) AS comment_count,
      (CASE WHEN $2::bigint = 0 THEN 0 ELSE (SELECT COUNT(*) FROM photo_likes pl2 WHERE pl2.photo_id=p.id AND pl2.user_id=$2) END) > 0 AS liked
    FROM photos p LEFT JOIN users u ON u.id=p.user_id LEFT JOIN songs s ON s.id=p.song_id
    WHERE p.id=$1 AND (COALESCE(u.is_private,0)=0 OR p.user_id=$2 OR EXISTS (SELECT 1 FROM follows f WHERE f.follower_id=$2 AND f.following_id=p.user_id AND f.status='accepted'))`,
    [req.params.id, userId]
  );
  if (!rows.length) return res.status(404).json({ error: 'Fotoğraf bulunamadı' });
  res.json(rows[0]);
});

app.post('/api/photos', authMiddleware, upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Fotoğraf seçin' });
  try {
    const url = await handleUpload(req.file);
    const b = req.body;
    const songStart = Math.max(0, parseInt(b.song_start_seconds, 10) || 0);
    const { rows } = await query(`INSERT INTO photos (user_id,url,public_id,title,caption,location,song_id,song_start_seconds,show_likes,allow_comments,allow_shares)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [
      req.user.id, url, req.file.cloudinary_public_id || '', (b.title || '').trim(), (b.caption || '').trim(), (b.location || '').trim(), b.song_id || null,
      songStart, b.show_likes === 'false' ? 0 : 1, b.allow_comments === 'false' ? 0 : 1, b.allow_shares === 'false' ? 0 : 1
    ]);
    await notifyFollowersOfContent(req.user, 'new_photo', 'Yeni fotoğraf', `@${req.user.username} yeni bir fotoğraf paylaştı.`, '/foto/' + rows[0].id).catch(() => {});
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/photos/:id', authMiddleware, async (req, res) => {
  const { url, title, caption, location, song_id, song_start_seconds, show_likes, allow_comments, allow_shares } = req.body;
  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'Fotoğraf URL gerekli' });
  const { rows } = await query('SELECT user_id FROM photos WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Fotoğraf bulunamadı' });
  if (rows[0].user_id !== req.user.id) return res.status(403).json({ error: 'Bu fotoğrafı düzenleme yetkiniz yok' });
  const songStart = Math.max(0, parseInt(song_start_seconds, 10) || 0);
  await query('UPDATE photos SET url=$1, title=COALESCE($2, title), caption=$3, location=COALESCE($4, location), song_id=$5, song_start_seconds=$6, show_likes=COALESCE($7, show_likes), allow_comments=COALESCE($8, allow_comments), allow_shares=COALESCE($9, allow_shares) WHERE id=$10',
    [url, title !== undefined ? String(title).trim() : null, caption||'', location !== undefined ? String(location).trim() : null, song_id || null, songStart, show_likes !== undefined ? (show_likes?1:0) : null, allow_comments !== undefined ? (allow_comments?1:0) : null, allow_shares !== undefined ? (allow_shares?1:0) : null, req.params.id]);
  const { rows: updated } = await query(
    'SELECT p.id, p.url, p.title, p.caption, p.location, p.song_id, p.song_start_seconds, s.title AS song_title, s.artist_name AS song_artist, s.audio_url AS song_audio_url, s.cover_url AS song_cover_url, p.created_at, p.show_likes, p.allow_comments, p.allow_shares, u.username, u.avatar FROM photos p LEFT JOIN users u ON u.id=p.user_id LEFT JOIN songs s ON s.id=p.song_id WHERE p.id=$1',
    [req.params.id]
  );
  res.json(updated[0]);
});

app.delete('/api/photos/:id', authMiddleware, async (req, res) => {
  const { rows } = await query('SELECT user_id, public_id FROM photos WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Fotoğraf bulunamadı' });
  if (rows[0].user_id !== req.user.id) return res.status(403).json({ error: 'Bu fotoğrafı silme yetkiniz yok' });
  const publicId = rows[0].public_id;
  if (USE_CLOUDINARY && publicId) {
    try {
      await cloudinary.uploader.destroy(publicId, { resource_type: 'image', invalidate: true });
    } catch (err) {
      console.warn('Cloudinary photo destroy failed:', err.message || err);
    }
  }
  await query('DELETE FROM photos WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// ===== HIKAYELER =====
function randomStoryPublicId() {
  return 'h' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 5);
}

app.get('/api/stories', optionalAuth, async (req, res) => {
  const viewerId = req.user?.id || 0;
  const { rows } = await query(`SELECT s.id,s.public_id,s.user_id,s.media_url,s.media_type,s.caption,s.song_id,s.song_start_seconds,s.duration_hours,s.is_suspended,s.created_at,s.expires_at,
      u.username,u.avatar,u.avatar_removed,u.is_private,song.title AS song_title,song.artist_name AS song_artist,song.audio_url AS song_audio_url,song.cover_url AS song_cover_url,
      EXISTS(SELECT 1 FROM story_views sv WHERE sv.story_id=s.id AND sv.viewer_id=$1) AS viewed,
      EXISTS(SELECT 1 FROM story_likes sl WHERE sl.story_id=s.id AND sl.user_id=$1) AS liked,
      (SELECT COUNT(*) FROM story_likes slc WHERE slc.story_id=s.id) AS like_count,
      (SELECT COUNT(*) FROM story_replies src WHERE src.story_id=s.id) AS reply_count,
      (SELECT COALESCE(SUM(sv.view_count),0) FROM story_views sv WHERE sv.story_id=s.id) AS total_views,
      CASE WHEN s.user_id=$1 THEN 1 ELSE 0 END AS is_owner
    FROM stories s JOIN users u ON u.id=s.user_id LEFT JOIN songs song ON song.id=s.song_id
    WHERE s.expires_at > NOW() AND (s.is_suspended=0 OR s.user_id=$1) AND (s.user_id=$1 OR COALESCE(u.is_private,0)=0 OR EXISTS(
      SELECT 1 FROM follows f WHERE f.follower_id=$1 AND f.following_id=s.user_id AND f.status='accepted'))
    ORDER BY (CASE WHEN s.user_id=$1 THEN 0 WHEN EXISTS(
      SELECT 1 FROM follows f2 WHERE f2.follower_id=$1 AND f2.following_id=s.user_id AND f2.status='accepted') THEN 1 ELSE 2 END), s.created_at DESC`, [viewerId]);
  res.json(rows);
});

app.get('/api/stories/:id', optionalAuth, async (req, res) => {
  const viewerId = req.user?.id || 0;
  const { rows } = await query(`SELECT s.id,s.public_id,s.user_id,s.media_url,s.media_type,s.caption,s.song_id,s.song_start_seconds,s.duration_hours,s.is_suspended,s.created_at,s.expires_at,
  u.username,u.avatar,u.avatar_removed,u.is_private,song.title AS song_title,song.artist_name AS song_artist,song.audio_url AS song_audio_url,song.cover_url AS song_cover_url,
      EXISTS(SELECT 1 FROM story_likes sl WHERE sl.story_id=s.id AND sl.user_id=$2) AS liked,
      (SELECT COUNT(*) FROM story_likes slc WHERE slc.story_id=s.id) AS like_count,
      (SELECT COALESCE(SUM(sv.view_count),0) FROM story_views sv WHERE sv.story_id=s.id) AS total_views,
      CASE WHEN s.user_id=$2 THEN 1 ELSE 0 END AS is_owner
    FROM stories s JOIN users u ON u.id=s.user_id LEFT JOIN songs song ON song.id=s.song_id
    WHERE (s.public_id=$1 OR s.id::text=$1) AND (s.user_id=$2 OR s.is_suspended=0)`, [req.params.id, viewerId]);
  if (!rows.length) return res.status(404).json({ error: 'Hikaye bulunamadı' });
  const story = rows[0];
  if (story.user_id !== viewerId && story.is_private && !(await query("SELECT 1 FROM follows WHERE follower_id=$1 AND following_id=$2 AND status='accepted'", [viewerId, story.user_id])).rows.length) {
    return res.status(403).json({ error: 'Bu hikaye yalnızca takipçilere açık.' });
  }
  res.json(story);
});

app.post('/api/stories', authMiddleware, (req, res, next) => {
  upload.single('media')(req, res, error => {
    if (error) return res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'Dosya boyutu 500 MB sınırını geçemez.' : error.message });
    next();
  });
}, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Hikaye medyası seçin' });
  try {
    const mediaType = req.file.mimetype?.startsWith('video/') ? 'video' : 'image';
    const mediaUrl = mediaType === 'video' && USE_R2 ? await handleR2VideoBufferUpload(req.file) : await handleUpload(req.file);
    const songId = req.body.song_id ? Number(req.body.song_id) : null;
    const songStart = Math.max(0, parseInt(req.body.song_start_seconds, 10) || 0);
    const durationHours = [5, 10, 24].includes(Number(req.body.duration_hours)) ? Number(req.body.duration_hours) : 24;
    const { rows } = await query(`INSERT INTO stories (user_id,public_id,media_url,media_type,caption,song_id,song_start_seconds,duration_hours,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::integer,NOW() + ($8::integer * INTERVAL '1 hour')) RETURNING *`, [req.user.id, randomStoryPublicId(), mediaUrl, mediaType, (req.body.caption || '').trim(), songId, songStart, durationHours]);
    res.json(rows[0]);
    notifyFollowersOfContent(req.user, 'new_story', 'Yeni hikaye', `@${req.user.username} yeni bir hikaye paylaştı.`, '/hikaye/' + rows[0].public_id).catch(error => {
      console.warn('Story follower notifications failed:', error.message || error);
    });
  } catch (e) {
    console.error('Story upload failed:', e);
    res.status(500).json({ error: 'Hikaye yüklenemedi: ' + e.message });
  }
});

app.post('/api/stories/upload-url', authMiddleware, async (req, res) => {
  if (!USE_R2) return res.status(503).json({ error: 'Hikaye video depolaması ayarlanmamış.' });
  const contentType = String(req.body?.content_type || 'video/mp4');
  if (!contentType.startsWith('video/')) return res.status(400).json({ error: 'Geçersiz video türü.' });
  const extension = path.extname(String(req.body?.filename || '')).toLowerCase() || '.mp4';
  const key = `stories/${uuidv4()}${extension}`;
  try {
    const uploadUrl = await getSignedUrl(r2Client, new PutObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key, ContentType: contentType }), { expiresIn: 900 });
    const publicBase = (process.env.R2_PUBLIC_URL || `${R2_ENDPOINT}/${process.env.R2_BUCKET_NAME}`).replace(/\/$/, '');
    res.json({ upload_url: uploadUrl, public_url: `${publicBase}/${key}` });
  } catch (error) { res.status(500).json({ error: 'Hikaye video bağlantısı oluşturulamadı: ' + error.message }); }
});

app.post('/api/stories/from-url', authMiddleware, async (req, res) => {
  const { media_url, caption, song_id, song_start_seconds, duration_hours } = req.body;
  if (!media_url) return res.status(400).json({ error: 'Hikaye videosu gerekli' });
  const songId = song_id ? Number(song_id) : null;
  const songStart = Math.max(0, parseInt(song_start_seconds, 10) || 0);
  const durationHours = [5, 10, 24].includes(Number(duration_hours)) ? Number(duration_hours) : 24;
  try {
    const { rows } = await query(`INSERT INTO stories (user_id,public_id,media_url,media_type,caption,song_id,song_start_seconds,duration_hours,expires_at) VALUES ($1,$2,$3,'video',$4,$5,$6,$7::integer,NOW() + ($7::integer * INTERVAL '1 hour')) RETURNING *`, [req.user.id, randomStoryPublicId(), media_url, String(caption || '').trim(), songId, songStart, durationHours]);
    res.json(rows[0]);
    notifyFollowersOfContent(req.user, 'new_story', 'Yeni hikaye', `@${req.user.username} yeni bir hikaye paylaştı.`, '/hikaye/' + rows[0].public_id).catch(() => {});
  } catch (error) { res.status(500).json({ error: 'Hikaye kaydedilemedi: ' + error.message }); }
});

app.post('/api/stories/:id/view', authMiddleware, async (req, res) => {
  const { rows: story } = await query(`SELECT s.id FROM stories s JOIN users u ON u.id=s.user_id WHERE (s.public_id=$1 OR s.id::text=$1) AND s.expires_at>NOW() AND s.is_suspended=0 AND (s.user_id=$2 OR COALESCE(u.is_private,0)=0 OR EXISTS(SELECT 1 FROM follows f WHERE f.follower_id=$2 AND f.following_id=s.user_id AND f.status='accepted'))`, [req.params.id, req.user.id]);
  if (!story.length) return res.status(404).json({ error: 'Hikaye bulunamadı' });
  await query('INSERT INTO story_views (story_id,viewer_id) VALUES ($1,$2) ON CONFLICT (story_id,viewer_id) DO UPDATE SET viewed_at=NOW(),view_count=story_views.view_count+1', [story[0].id, req.user.id]);
  res.json({ ok: true });
});

app.put('/api/stories/:id', authMiddleware, async (req, res) => {
  const { rows } = await query('SELECT * FROM stories WHERE public_id=$1 OR id::text=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Hikaye bulunamadı' });
  if (rows[0].user_id !== req.user.id) return res.status(403).json({ error: 'Bu hikayeyi düzenleme yetkiniz yok' });
  const caption = String(req.body.caption ?? rows[0].caption).trim().slice(0, 180);
  const songId = req.body.song_id === '' || req.body.song_id === null ? null : (req.body.song_id ?? rows[0].song_id);
  const songStart = Math.max(0, parseInt(req.body.song_start_seconds ?? rows[0].song_start_seconds, 10) || 0);
  const durationHours = [5, 10, 24].includes(Number(req.body.duration_hours)) ? Number(req.body.duration_hours) : rows[0].duration_hours;
  const { rows: updated } = await query('UPDATE stories SET caption=$1,song_id=$2,song_start_seconds=$3,duration_hours=$4,expires_at=created_at + ($4 * INTERVAL \'1 hour\') WHERE id=$5 RETURNING *', [caption, songId, songStart, durationHours, rows[0].id]);
  res.json(updated[0]);
});

app.delete('/api/stories/:id', authMiddleware, async (req, res) => {
  const { rows } = await query('SELECT id,user_id,public_id FROM stories WHERE public_id=$1 OR id::text=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Hikaye bulunamadı' });
  if (rows[0].user_id !== req.user.id) return res.status(403).json({ error: 'Bu hikayeyi silme yetkiniz yok' });
  await query('DELETE FROM stories WHERE id=$1', [rows[0].id]);
  res.json({ ok: true });
});

app.get('/api/stories/:id/viewers', authMiddleware, async (req, res) => {
  const { rows: owner } = await query('SELECT id,user_id FROM stories WHERE public_id=$1 OR id::text=$1', [req.params.id]);
  if (!owner.length) return res.status(404).json({ error: 'Hikaye bulunamadı' });
  if (owner[0].user_id !== req.user.id) return res.status(403).json({ error: 'Görüntüleyenleri görme yetkiniz yok' });
  const { rows } = await query(`SELECT sv.viewer_id,sv.view_count,sv.viewed_at,u.username,u.avatar FROM story_views sv JOIN users u ON u.id=sv.viewer_id WHERE sv.story_id=$1 ORDER BY sv.viewed_at DESC`, [owner[0].id]);
  res.json(rows);
});

app.get('/api/admin/stories', adminMiddleware, async (req, res) => {
  const { rows } = await query(`SELECT s.*,u.username,u.avatar,
    (SELECT COUNT(*) FROM story_views sv WHERE sv.story_id=s.id)::int AS unique_viewers,
    (SELECT COALESCE(SUM(sv.view_count),0) FROM story_views sv WHERE sv.story_id=s.id)::int AS total_views,
    (SELECT COUNT(*) FROM story_likes sl WHERE sl.story_id=s.id)::int AS like_count
    FROM stories s JOIN users u ON u.id=s.user_id ORDER BY s.created_at DESC`);
  res.json(rows);
});

app.get('/api/admin/videos', adminMiddleware, async (req, res) => {
  try {
    const { rows } = await query('SELECT id,title,is_reals,status,created_at FROM videos ORDER BY created_at DESC');
    res.json(rows);
  } catch (error) {
    console.error('Admin video stats failed:', error.message);
    res.status(500).json({ error: 'Video istatistikleri alınamadı' });
  }
});

app.get('/api/admin/stories/:id/viewers', adminMiddleware, async (req, res) => {
  const { rows: story } = await query('SELECT id FROM stories WHERE public_id=$1 OR id::text=$1', [req.params.id]);
  if (!story.length) return res.status(404).json({ error: 'Hikaye bulunamadı' });
  const { rows } = await query(`SELECT sv.view_count,sv.viewed_at,u.username,u.avatar FROM story_views sv JOIN users u ON u.id=sv.viewer_id WHERE sv.story_id=$1 ORDER BY sv.viewed_at DESC`, [story[0].id]);
  res.json(rows);
});

app.put('/api/admin/stories/:id', adminMiddleware, async (req, res) => {
  const { rows } = await query('SELECT * FROM stories WHERE public_id=$1 OR id::text=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Hikaye bulunamadı' });
  const old = rows[0];
  const caption = String(req.body.caption ?? old.caption).trim().slice(0, 180);
  const durationHours = [5, 10, 24].includes(Number(req.body.duration_hours)) ? Number(req.body.duration_hours) : old.duration_hours;
  const suspended = req.body.is_suspended === undefined ? old.is_suspended : (req.body.is_suspended ? 1 : 0);
  const { rows: updated } = await query('UPDATE stories SET caption=$1,duration_hours=$2,is_suspended=$3,expires_at=created_at + ($2 * INTERVAL \'1 hour\') WHERE id=$4 RETURNING *', [caption, durationHours, suspended, old.id]);
  res.json(updated[0]);
});

app.delete('/api/admin/stories/:id', adminMiddleware, async (req, res) => {
  const { rows } = await query('SELECT id FROM stories WHERE public_id=$1 OR id::text=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Hikaye bulunamadı' });
  await query('DELETE FROM stories WHERE id=$1', [rows[0].id]);
  res.json({ ok: true });
});

app.post('/api/stories/:id/like', authMiddleware, async (req, res) => {
  const { rows: stories } = await query('SELECT s.id,s.user_id,u.username AS owner_username,u.avatar AS owner_avatar FROM stories s JOIN users u ON u.id=s.user_id WHERE (s.public_id=$1 OR s.id::text=$1) AND s.expires_at>NOW() AND s.is_suspended=0', [req.params.id]);
  if (!stories.length) return res.status(404).json({ error: 'Hikaye bulunamadı' });
  const story = stories[0];
  const { rows: existing } = await query('SELECT id FROM story_likes WHERE story_id=$1 AND user_id=$2', [story.id, req.user.id]);
  const liked = !existing.length;
  if (liked) {
    await query('INSERT INTO story_likes (story_id,user_id) VALUES ($1,$2)', [story.id, req.user.id]);
  } else {
    await query('DELETE FROM story_likes WHERE id=$1', [existing[0].id]);
  }
  if (story.user_id !== req.user.id) {
    await query('INSERT INTO notifications (user_id,type,actor_username,actor_avatar,title,body,link) VALUES ($1,$2,$3,$4,$5,$6,$7)', [
      story.user_id, liked ? 'story_like' : 'story_unlike', req.user.username, req.user.avatar || '',
      liked ? 'Hikayeniz beğenildi' : 'Hikaye beğenisi geri alındı',
      `${req.user.username} hikayenizi ${liked ? 'beğendi' : 'beğenisini geri aldı'}.`, '/fotograflar'
    ]);
  }
  const { rows: count } = await query('SELECT COUNT(*)::int AS count FROM story_likes WHERE story_id=$1', [story.id]);
  res.json({ liked, like_count: count[0].count });
});

app.post('/api/stories/:id/replies', authMiddleware, async (req, res) => {
  const content = String(req.body.content || '').trim();
  if (!content) return res.status(400).json({ error: 'Yanıt boş olamaz' });
  const { rows: stories } = await query('SELECT s.id,s.user_id FROM stories s WHERE (s.public_id=$1 OR s.id::text=$1) AND s.expires_at>NOW() AND s.is_suspended=0', [req.params.id]);
  if (!stories.length) return res.status(404).json({ error: 'Hikaye bulunamadı' });
  const { rows } = await query('INSERT INTO story_replies (story_id,user_id,content) VALUES ($1,$2,$3) RETURNING id,story_id,content,created_at', [stories[0].id, req.user.id, content]);
  if (stories[0].user_id !== req.user.id) {
    const user1 = Math.min(req.user.id, stories[0].user_id);
    const user2 = Math.max(req.user.id, stories[0].user_id);
    let { rows: conversations } = await query('SELECT id FROM dm_conversations WHERE user1_id=$1 AND user2_id=$2', [user1, user2]);
    if (!conversations.length) ({ rows: conversations } = await query('INSERT INTO dm_conversations (user1_id,user2_id) VALUES ($1,$2) RETURNING id', [user1, user2]));
    await query('INSERT INTO dm_messages (conversation_id,sender_id,content,shared_story_id) VALUES ($1,$2,$3,$4)', [conversations[0].id, req.user.id, content, stories[0].id]);
    await query('UPDATE dm_conversations SET last_message_at=NOW() WHERE id=$1', [conversations[0].id]);
    await query('INSERT INTO notifications (user_id,type,actor_username,actor_avatar,title,body,link) VALUES ($1,$2,$3,$4,$5,$6,$7)', [
      stories[0].user_id, 'story_reply', req.user.username, req.user.avatar || '', 'Hikayenize yanıt geldi', `${req.user.username} hikayenize yanıt verdi: ${content}`, '/fotograflar'
    ]);
  }
  res.json(rows[0]);
});

// Like toggle
app.post('/api/photos/:id/like', authMiddleware, async (req, res) => {
  const photoId = req.params.id;
  const userId = req.user.id;
  const { rows } = await query(`SELECT p.id, COALESCE(p.show_likes,1) AS show_likes FROM photos p LEFT JOIN users u ON u.id=p.user_id
    WHERE p.id=$1 AND (COALESCE(u.is_private,0)=0 OR p.user_id=$2 OR EXISTS (SELECT 1 FROM follows f WHERE f.follower_id=$2 AND f.following_id=p.user_id AND f.status='accepted'))`, [photoId, userId]);
  if (!rows.length) return res.status(404).json({ error: 'Fotoğraf bulunamadı' });
  if (Number(rows[0].show_likes) !== 1) return res.status(403).json({ error: 'Bu fotoğrafta beğeni kapalı.' });
  const { rows: exists } = await query('SELECT id FROM photo_likes WHERE photo_id=$1 AND user_id=$2', [photoId, userId]);
  if (exists.length) {
    await query('DELETE FROM photo_likes WHERE id=$1', [exists[0].id]);
    return res.json({ liked: false });
  } else {
    await query('INSERT INTO photo_likes (photo_id,user_id) VALUES ($1,$2)', [photoId, userId]);
    const { rows: owner } = await query('SELECT user_id FROM photos WHERE id=$1', [photoId]);
    if (owner[0] && owner[0].user_id !== userId) {
        await query('INSERT INTO notifications (user_id,type,actor_username,actor_avatar,title,body,link) VALUES ($1,$2,$3,$4,$5,$6,$7)', [owner[0].user_id, 'photo_like', req.user.username, req.user.avatar || '', 'Fotoğrafın beğenildi', `@${req.user.username} fotoğrafını beğendi.`, '/foto/' + photoId]).catch(() => {});
    }
    return res.json({ liked: true });
  }
});

// Photo comments
app.get('/api/photos/:id/comments', optionalAuth, async (req, res) => {
  const photoId = req.params.id;
  const userId = req.user ? req.user.id : 0;
  const { rows: visible } = await query(`SELECT p.id FROM photos p LEFT JOIN users u ON u.id=p.user_id WHERE p.id=$1 AND (COALESCE(u.is_private,0)=0 OR p.user_id=$2 OR EXISTS (SELECT 1 FROM follows f WHERE f.follower_id=$2 AND f.following_id=p.user_id AND f.status='accepted'))`, [photoId, userId]);
  if (!visible.length) return res.status(404).json({ error: 'Fotoğraf bulunamadı' });
  const { rows } = await query(`SELECT pc.id, pc.content, pc.created_at, pc.user_id, u.username, u.avatar,
    (SELECT COUNT(*) FROM photo_comment_likes pcl WHERE pcl.comment_id=pc.id) AS like_count,
    EXISTS(SELECT 1 FROM photo_comment_likes pcl2 WHERE pcl2.comment_id=pc.id AND pcl2.user_id=$2) AS liked
    FROM photo_comments pc LEFT JOIN users u ON u.id=pc.user_id WHERE pc.photo_id=$1 ORDER BY pc.created_at ASC`, [photoId, userId]);
  res.json(rows);
});

app.post('/api/photos/:id/comments', authMiddleware, async (req, res) => {
  const photoId = req.params.id;
  const { content } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: 'Yorum boş olamaz' });
  const { rows } = await query(`SELECT p.allow_comments FROM photos p LEFT JOIN users u ON u.id=p.user_id WHERE p.id=$1 AND (COALESCE(u.is_private,0)=0 OR p.user_id=$2 OR EXISTS (SELECT 1 FROM follows f WHERE f.follower_id=$2 AND f.following_id=p.user_id AND f.status='accepted'))`, [photoId, req.user.id]);
  if (!rows.length) return res.status(404).json({ error: 'Fotoğraf bulunamadı' });
  if (Number(rows[0].allow_comments ?? 1) !== 1) return res.status(403).json({ error: 'Yorumlara izin verilmemiş' });
  await query('INSERT INTO photo_comments (photo_id,user_id,content) VALUES ($1,$2,$3)', [photoId, req.user.id, content.trim()]);
  const { rows: photoOwner } = await query('SELECT p.user_id,p.title FROM photos p WHERE p.id=$1', [photoId]);
  if (photoOwner[0] && photoOwner[0].user_id !== req.user.id) {
    await query('INSERT INTO notifications (user_id,type,actor_username,actor_avatar,title,body,link) VALUES ($1,$2,$3,$4,$5,$6,$7)', [photoOwner[0].user_id, 'photo_comment', req.user.username, req.user.avatar || '', 'Fotoğrafına yorum geldi', `@${req.user.username} fotoğrafına yorum yaptı.`, '/foto/' + photoId]).catch(() => {});
  }
  const c = await query('SELECT pc.id, pc.content, pc.created_at, pc.user_id, u.username, u.avatar FROM photo_comments pc LEFT JOIN users u ON u.id=pc.user_id WHERE pc.photo_id=$1 ORDER BY pc.created_at ASC', [photoId]);
  res.json(c.rows[c.rows.length-1]);
});

app.delete('/api/photos/comments/:id', authMiddleware, async (req, res) => {
  const commentId = req.params.id;
  const { rows } = await query('SELECT photo_id, user_id FROM photo_comments WHERE id=$1', [commentId]);
  if (!rows.length) return res.status(404).json({ error: 'Yorum bulunamadı' });
  const comment = rows[0];
  const { rows: photoRows } = await query('SELECT user_id FROM photos WHERE id=$1', [comment.photo_id]);
  const photoOwner = photoRows.length ? photoRows[0].user_id : null;
  if (comment.user_id !== req.user.id && photoOwner !== req.user.id && !req.user.is_admin) return res.status(403).json({ error: 'Yorum silme yetkiniz yok' });
  await query('DELETE FROM photo_comments WHERE id=$1', [commentId]);
  res.json({ ok: true });
});

app.post('/api/photos/comments/:id/like', authMiddleware, async (req, res) => {
  const commentId = req.params.id;
  const { rows: existing } = await query('SELECT id FROM photo_comment_likes WHERE comment_id=$1 AND user_id=$2', [commentId, req.user.id]);
  if (existing.length) {
    await query('DELETE FROM photo_comment_likes WHERE id=$1', [existing[0].id]);
    return res.json({ liked: false });
  }
  const { rows: comment } = await query('SELECT id FROM photo_comments WHERE id=$1', [commentId]);
  if (!comment.length) return res.status(404).json({ error: 'Yorum bulunamadı' });
  await query('INSERT INTO photo_comment_likes (comment_id,user_id) VALUES ($1,$2)', [commentId, req.user.id]);
  res.json({ liked: true });
});

// Admin: manage photos
app.get('/api/admin/photos', adminMiddleware, async (req, res) => {
  const { rows } = await query('SELECT p.id, p.url, p.caption, p.user_id, u.username, p.created_at, p.show_likes, p.allow_comments, p.allow_shares, p.like_count, p.comment_count, p.share_count FROM photos p LEFT JOIN users u ON u.id=p.user_id ORDER BY p.created_at DESC');
  res.json(rows);
});

app.put('/api/admin/photos/:id', adminMiddleware, async (req, res) => {
  const { url, caption, show_likes, allow_comments, allow_shares, like_count, comment_count, share_count } = req.body;
  const { rows } = await query('SELECT * FROM photos WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Fotoğraf bulunamadı' });
  await query('UPDATE photos SET url=COALESCE($1, url), caption=COALESCE($2, caption), show_likes=COALESCE($3, show_likes), allow_comments=COALESCE($4, allow_comments), allow_shares=COALESCE($5, allow_shares), like_count=COALESCE($6, like_count), comment_count=COALESCE($7, comment_count), share_count=COALESCE($8, share_count) WHERE id=$9',
    [url, caption, show_likes !== undefined ? (show_likes?1:0) : null, allow_comments !== undefined ? (allow_comments?1:0) : null, allow_shares !== undefined ? (allow_shares?1:0) : null,
     like_count !== undefined ? parseInt(like_count) : null, comment_count !== undefined ? parseInt(comment_count) : null, share_count !== undefined ? parseInt(share_count) : null, req.params.id]);
  const { rows: updated } = await query('SELECT * FROM photos WHERE id=$1', [req.params.id]);
  res.json(updated[0]);
});

app.delete('/api/admin/photos/:id', adminMiddleware, async (req, res) => {
  const { rows } = await query('SELECT public_id FROM photos WHERE id=$1', [req.params.id]);
  const publicId = rows.length ? rows[0].public_id : null;
  if (USE_CLOUDINARY && publicId) {
    try {
      await cloudinary.uploader.destroy(publicId, { resource_type: 'image', invalidate: true });
    } catch (err) {
      console.warn('Cloudinary admin photo destroy failed:', err.message || err);
    }
  }
  await query('DELETE FROM photos WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// ===== PHOTO ADVERTISING =====
function normalizedExternalUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try { return new URL(candidate).href; } catch { return ''; }
}
function newAdPortalCode() { return String(Math.floor(100000 + Math.random() * 900000)); }
async function uniqueAdPortalCode(table) { let code = newAdPortalCode(); while ((await query(`SELECT id FROM ${table} WHERE portal_code=$1`, [code])).rows.length) code = newAdPortalCode(); return code; }

app.get('/api/photo-ads/random', async (req,res) => res.json((await query('SELECT * FROM photo_ads WHERE active=1 ORDER BY priority DESC,created_at ASC LIMIT 1')).rows[0] || null));
app.post('/api/photo-ads/:id/click', async (req,res) => { await query('UPDATE photo_ads SET click_count=click_count+1 WHERE id=$1 AND active=1',[req.params.id]); res.json({ok:true}); });
app.get('/api/admin/photo-ads', adminMiddleware, async (req,res) => res.json((await query('SELECT * FROM photo_ads ORDER BY priority DESC,created_at DESC')).rows));
app.put('/api/admin/photo-ads/:id', adminMiddleware, async (req,res) => {
  const old=(await query('SELECT * FROM photo_ads WHERE id=$1',[req.params.id])).rows[0]; if(!old) return res.status(404).json({error:'Reklam bulunamadı'});
  const b=req.body,site=normalizedExternalUrl(b.site_url??old.site_url); if(!site)return res.status(400).json({error:'Geçerli site adresi girin'});
  const {rows}=await query('UPDATE photo_ads SET title=$1,description=$2,site_url=$3,show_likes=$4,allow_comments=$5,allow_shares=$6,active=$7,priority=$8,updated_at=NOW() WHERE id=$9 RETURNING *',[b.title||old.title,b.description??old.description,site,b.show_likes===undefined?old.show_likes:(b.show_likes?1:0),b.allow_comments===undefined?old.allow_comments:(b.allow_comments?1:0),b.allow_shares===undefined?old.allow_shares:(b.allow_shares?1:0),b.active===undefined?old.active:(b.active?1:0),b.priority??old.priority,old.id]);res.json(rows[0]);
});
app.delete('/api/admin/photo-ads/:id', adminMiddleware, async (req,res) => { await query('DELETE FROM photo_ads WHERE id=$1',[req.params.id]);res.json({ok:true}); });
app.post('/api/ad-submissions', authMiddleware, upload.fields([{name:'media',maxCount:1},{name:'cover',maxCount:1}]), async (req,res) => {
  try { const b=req.body;if(!['music','photo'].includes(b.type)||!b.title?.trim()||!req.files?.media?.[0])return res.status(400).json({error:'Reklam türü, başlık ve dosya zorunlu.'});const site=normalizedExternalUrl(b.site_url);if(!site)return res.status(400).json({error:'Geçerli site adresi girin.'});const media=await handleUpload(req.files.media[0]),cover=req.files?.cover?.[0]?await handleUpload(req.files.cover[0]):'',code=await uniqueAdPortalCode('ad_submissions');const {rows}=await query(`INSERT INTO ad_submissions (user_id,type,title,description,site_url,media_url,cover_url,show_likes,allow_comments,allow_shares,portal_code) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,[req.user.id,b.type,b.title.trim(),b.description||'',site,media,cover,b.show_likes==='false'?0:1,b.allow_comments==='false'?0:1,b.allow_shares==='false'?0:1,code]);res.json(rows[0]); } catch(e){res.status(500).json({error:e.message});}
});
app.get('/api/admin/ad-submissions', adminMiddleware, async (req,res) => res.json((await query('SELECT a.*,u.username FROM ad_submissions a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC')).rows));
app.post('/api/admin/ad-submissions/:id/approve', adminMiddleware, async (req,res) => { const ad=(await query("SELECT * FROM ad_submissions WHERE id=$1 AND status='pending'",[req.params.id])).rows[0];if(!ad)return res.status(404).json({error:'Bekleyen reklam bulunamadı'});if(ad.type==='photo')await query('INSERT INTO photo_ads (portal_code,title,description,site_url,image_url,show_likes,allow_comments,allow_shares) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',[ad.portal_code,ad.title,ad.description,ad.site_url,ad.media_url,ad.show_likes,ad.allow_comments,ad.allow_shares]);else await query('INSERT INTO music_ads (portal_code,title,site_url,audio_url,cover_url,active) VALUES ($1,$2,$3,$4,$5,1)',[ad.portal_code,ad.title,ad.site_url,ad.media_url,ad.cover_url]);await query("UPDATE ad_submissions SET status='approved' WHERE id=$1",[ad.id]);res.json({ok:true}); });
app.post('/api/admin/ad-submissions/:id/reject', adminMiddleware, async (req,res) => {await query("UPDATE ad_submissions SET status='rejected' WHERE id=$1",[req.params.id]);res.json({ok:true});});

// ===== ADMIN =====
app.get('/api/admin/users', adminMiddleware, async (req, res) => {
  const { rows } = await query('SELECT * FROM users ORDER BY created_at DESC');
  res.json(rows.map(u => sanitizeUser(u)));
});

app.get('/api/admin/user/:id', adminMiddleware, async (req, res) => {
  const { rows } = await query('SELECT * FROM users WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  res.json(sanitizeUser(rows[0]));
});

app.put('/api/admin/user/:id', adminMiddleware, async (req, res) => {
  const { rows } = await query('SELECT * FROM users WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  const user = rows[0];
  const { username, email, password, is_vip, is_plus, name_color, level_id, title, badge_name, badge_icon, badge_color } = req.body;
  const newPwHash = password ? hashPassword(password) : user.password_hash;
  await query('UPDATE users SET username=$1,email=$2,password_hash=$3,is_vip=$4,is_plus=$5,name_color=$6,level_id=$7,title=$8,badge_name=$9,badge_icon=$10,badge_color=$11 WHERE id=$12',
    [username||user.username, email||user.email, newPwHash,
     is_vip!==undefined?(is_vip?1:0):user.is_vip, is_plus!==undefined?(is_plus?1:0):user.is_plus,
     name_color??user.name_color, level_id||user.level_id, title??user.title,
     badge_name??user.badge_name, badge_icon??user.badge_icon, badge_color??user.badge_color, user.id]);
  await logAction('admin', 'edit_user', user.username);
  const { rows: updated } = await query('SELECT * FROM users WHERE id=$1', [user.id]);
  res.json(sanitizeUser(updated[0]));
});

app.post('/api/admin/user/:id/ban', adminMiddleware, async (req, res) => {
  const { rows } = await query('SELECT * FROM users WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  const user = rows[0];
  const { ban_type } = req.body;
  await query('UPDATE users SET banned=1,ban_type=$1,banned_ip=$2 WHERE id=$3',
    [ban_type||'soft', ban_type==='ip' ? user.ip : '', user.id]);
  await logAction('admin', 'ban_user', user.username, ban_type||'soft');
  res.json({ ok: true });
});

app.post('/api/admin/user/:id/unban', adminMiddleware, async (req, res) => {
  const { rows } = await query('SELECT * FROM users WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  await query("UPDATE users SET banned=0,ban_type='',banned_ip='' WHERE id=$1", [req.params.id]);
  await logAction('admin', 'unban_user', rows[0].username);
  res.json({ ok: true });
});

app.delete('/api/admin/user/:id', adminMiddleware, async (req, res) => {
  const { rows } = await query('SELECT * FROM users WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  await query('DELETE FROM users WHERE id=$1', [req.params.id]);
  await logAction('admin', 'delete_user', rows[0].username);
  res.json({ ok: true });
});

app.get('/api/admin/forums', adminMiddleware, async (req, res) => {
  const { rows } = await query(`SELECT f.*, u.username FROM forums f LEFT JOIN users u ON f.user_id=u.id ORDER BY f.created_at DESC`);
  res.json(rows);
});

app.put('/api/admin/forum/:id', adminMiddleware, async (req, res) => {
  const { rows } = await query('SELECT * FROM forums WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Konu bulunamadı' });
  const forum = rows[0];
  const { title, content, allow_comments, views } = req.body;
  await query('UPDATE forums SET title=$1,content=$2,allow_comments=$3,views=$4 WHERE id=$5',
    [title||forum.title, content||forum.content,
     allow_comments!==undefined?(allow_comments?1:0):forum.allow_comments,
     views !== undefined ? Math.max(0, parseInt(views)||0) : (forum.views||0),
     forum.id]);
  const { rows: updated } = await query('SELECT * FROM forums WHERE id=$1', [forum.id]);
  res.json(updated[0]);
});

app.delete('/api/admin/forum/:id', adminMiddleware, async (req, res) => {
  const { rows } = await query('SELECT * FROM forums WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Konu bulunamadı' });
  const forum = rows[0];
  await query('DELETE FROM forum_comments WHERE forum_id=$1', [forum.id]);
  await query('DELETE FROM forum_likes WHERE forum_id=$1', [forum.id]);
  await query('DELETE FROM forum_views WHERE forum_id=$1', [forum.id]);
  await query('DELETE FROM forum_tags WHERE forum_id=$1', [forum.id]);
  await query('DELETE FROM forums WHERE id=$1', [forum.id]);
  if (forum.user_id) await query('UPDATE users SET forum_count=GREATEST(0,forum_count-1) WHERE id=$1', [forum.user_id]);
  await logAction('admin', 'delete_forum', forum.slug);
  res.json({ ok: true });
});

app.get('/api/admin/books', adminMiddleware, async (req, res) => {
  const { rows } = await query(`SELECT b.*, u.username FROM books b LEFT JOIN users u ON b.user_id=u.id ORDER BY b.created_at DESC`);
  res.json(rows);
});

app.put('/api/admin/book/:id', adminMiddleware, async (req, res) => {
  const { rows } = await query('SELECT * FROM books WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Kitap bulunamadı' });
  const book = rows[0];
  const { title, cover_image, is_hidden, allow_download, allow_pdf } = req.body;
  await query(
    'UPDATE books SET title=$1, cover_image=$2, is_hidden=$3, allow_download=$4, allow_pdf=$5, updated_at=NOW() WHERE id=$6',
    [
      title !== undefined ? title : book.title,
      cover_image !== undefined ? cover_image : book.cover_image,
      is_hidden !== undefined ? (is_hidden ? 1 : 0) : book.is_hidden,
      allow_download !== undefined ? (allow_download ? 1 : 0) : (book.allow_download !== undefined ? book.allow_download : 1),
      allow_pdf !== undefined ? (allow_pdf ? 1 : 0) : (book.allow_pdf !== undefined ? book.allow_pdf : 1),
      book.id
    ]
  );
  await logAction('admin', 'edit_book', book.slug);
  const { rows: updated } = await query('SELECT * FROM books WHERE id=$1', [book.id]);
  res.json(updated[0]);
});

app.delete('/api/admin/book/:id', adminMiddleware, async (req, res) => {
  const { rows } = await query('SELECT * FROM books WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Kitap bulunamadı' });
  const book = rows[0];
  await query('DELETE FROM book_pages WHERE book_id=$1', [book.id]);
  await query('DELETE FROM book_chapters WHERE book_id=$1', [book.id]);
  await query('DELETE FROM books WHERE id=$1', [book.id]);
  if (book.user_id) await query('UPDATE users SET book_count=GREATEST(0,book_count-1) WHERE id=$1', [book.user_id]);
  await logAction('admin', 'delete_book', book.slug);
  res.json({ ok: true });
});

app.get('/api/admin/groups', adminMiddleware, async (req, res) => {
  const { rows } = await query(`SELECT g.*, u.username as owner_name FROM groups g LEFT JOIN users u ON g.owner_id=u.id ORDER BY g.created_at DESC`);
  res.json(rows);
});

app.delete('/api/admin/group/:id', adminMiddleware, async (req, res) => {
  const { rows } = await query('SELECT * FROM groups WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Grup bulunamadı' });
  const group = rows[0];
  await query('DELETE FROM group_messages WHERE group_id=$1', [group.id]);
  await query('DELETE FROM group_members WHERE group_id=$1', [group.id]);
  await query('DELETE FROM group_invites WHERE group_id=$1', [group.id]);
  await query('DELETE FROM moderator_permissions WHERE group_id=$1', [group.id]);
  await query('DELETE FROM groups WHERE id=$1', [group.id]);
  await logAction('admin', 'delete_group', group.slug);
  res.json({ ok: true });
});

app.get('/api/admin/levels', adminMiddleware, async (req, res) => {
  const { rows } = await query('SELECT * FROM levels ORDER BY order_num ASC');
  res.json(rows);
});

app.post('/api/admin/levels', adminMiddleware, async (req, res) => {
  const { name, icon, color, min_forums, min_books, min_book_pages, min_comments, require_any, order_num,
    daily_forums, daily_books, daily_book_pages, daily_forums_vip, daily_books_vip, daily_book_pages_vip,
    daily_forums_plus, daily_books_plus, daily_book_pages_plus } = req.body;
  if (!name) return res.status(400).json({ error: 'İsim zorunlu' });
  const { rows } = await query(`INSERT INTO levels (name,icon,color,min_forums,min_books,min_book_pages,min_comments,require_any,order_num,
    daily_forums,daily_books,daily_book_pages,daily_forums_vip,daily_books_vip,daily_book_pages_vip,
    daily_forums_plus,daily_books_plus,daily_book_pages_plus) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
    [name, icon||'fas fa-star', color||'#dc2626', min_forums||0, min_books||0, min_book_pages||0,
     min_comments||0, require_any?1:0, order_num||0, daily_forums??-1, daily_books??-1, daily_book_pages??-1,
     daily_forums_vip??-1, daily_books_vip??-1, daily_book_pages_vip??-1,
     daily_forums_plus??-1, daily_books_plus??-1, daily_book_pages_plus??-1]);
  res.json(rows[0]);
});

app.put('/api/admin/level/:id', adminMiddleware, async (req, res) => {
  const { rows: lvRows } = await query('SELECT * FROM levels WHERE id=$1', [req.params.id]);
  if (!lvRows.length) return res.status(404).json({ error: 'Seviye bulunamadı' });
  const lv = lvRows[0];
  const { name, icon, color, min_forums, min_books, min_book_pages, min_comments, require_any, order_num,
    daily_forums, daily_books, daily_book_pages, daily_forums_vip, daily_books_vip, daily_book_pages_vip,
    daily_forums_plus, daily_books_plus, daily_book_pages_plus } = req.body;
  await query(`UPDATE levels SET name=$1,icon=$2,color=$3,min_forums=$4,min_books=$5,min_book_pages=$6,min_comments=$7,
    require_any=$8,order_num=$9,daily_forums=$10,daily_books=$11,daily_book_pages=$12,
    daily_forums_vip=$13,daily_books_vip=$14,daily_book_pages_vip=$15,
    daily_forums_plus=$16,daily_books_plus=$17,daily_book_pages_plus=$18 WHERE id=$19`,
    [name||lv.name, icon||lv.icon, color||lv.color,
     min_forums??lv.min_forums, min_books??lv.min_books, min_book_pages??(lv.min_book_pages||0), min_comments??lv.min_comments,
     require_any!==undefined?(require_any?1:0):(lv.require_any||0), order_num??lv.order_num,
     daily_forums??(lv.daily_forums??-1), daily_books??(lv.daily_books??-1), daily_book_pages??(lv.daily_book_pages??-1),
     daily_forums_vip??(lv.daily_forums_vip??-1), daily_books_vip??(lv.daily_books_vip??-1), daily_book_pages_vip??(lv.daily_book_pages_vip??-1),
     daily_forums_plus??(lv.daily_forums_plus??-1), daily_books_plus??(lv.daily_books_plus??-1), daily_book_pages_plus??(lv.daily_book_pages_plus??-1),
     lv.id]);
  const { rows } = await query('SELECT * FROM levels WHERE id=$1', [lv.id]);
  res.json(rows[0]);
});

app.delete('/api/admin/level/:id', adminMiddleware, async (req, res) => {
  await query('DELETE FROM levels WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

app.get('/api/admin/tags', adminMiddleware, async (req, res) => {
  const { rows } = await query('SELECT * FROM tags ORDER BY is_system DESC, name ASC');
  res.json(rows);
});

app.post('/api/admin/tags', adminMiddleware, async (req, res) => {
  const { name, color } = req.body;
  if (!name) return res.status(400).json({ error: 'İsim zorunlu' });
  try {
    const { rows } = await query('INSERT INTO tags (name,color,is_system) VALUES ($1,$2,1) RETURNING *', [name.trim(), color||'#dc2626']);
    await logAction('admin', 'create_tag', name);
    res.json(rows[0]);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.put('/api/admin/tag/:id', adminMiddleware, async (req, res) => {
  const { rows } = await query('SELECT * FROM tags WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Tag bulunamadı' });
  const { name, color } = req.body;
  await query('UPDATE tags SET name=$1,color=$2 WHERE id=$3', [name||rows[0].name, color||rows[0].color, rows[0].id]);
  await logAction('admin', 'update_tag', rows[0].name);
  const { rows: updated } = await query('SELECT * FROM tags WHERE id=$1', [rows[0].id]);
  res.json(updated[0]);
});

app.delete('/api/admin/tag/:id', adminMiddleware, async (req, res) => {
  const { rows } = await query('SELECT * FROM tags WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Tag bulunamadı' });
  await query('DELETE FROM forum_tags WHERE tag_id=$1', [rows[0].id]);
  await query('DELETE FROM tags WHERE id=$1', [rows[0].id]);
  await logAction('admin', 'delete_tag', rows[0].name);
  res.json({ ok: true });
});

app.get('/api/admin/logs', adminMiddleware, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 200, 500);
  const { rows } = await query('SELECT * FROM system_logs ORDER BY created_at DESC LIMIT $1', [limit]);
  res.json(rows);
});

app.get('/api/admin/route-logs', adminMiddleware, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 500, 1000);
  const { rows } = await query("SELECT id, actor, target, detail, ip, created_at FROM system_logs WHERE action='restricted_route_attempt' ORDER BY created_at DESC LIMIT $1", [limit]);
  res.json(rows);
});

app.get('/api/admin/settings', adminMiddleware, async (req, res) => {
  const { rows } = await query('SELECT * FROM settings');
  res.json(Object.fromEntries(rows.map(s => [s.key, s.value])));
});

app.post('/api/admin/settings', adminMiddleware, async (req, res) => {
  const { key, value } = req.body;
  if (!key) return res.status(400).json({ error: 'Key zorunlu' });
  // admin_password için hash işlemi client tarafında yapılıyor, server direkt kaydeder
  await query('INSERT INTO settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', [key, value]);
  res.json({ ok: true });
});

// Logo dosya yükleme (cihazdan)
app.post('/api/admin/upload-logo', adminMiddleware, upload.single('logo'), async (req, res) => {
  res.status(410).json({ error: 'Logo değiştirilemez; site logosu /cigcig.png dosyasından alınır.' });
});

app.get('/api/kvkk', async (req, res) => {
  const { rows } = await query("SELECT value FROM settings WHERE key='kvkk_text'");
  res.json({ text: rows[0]?.value || '' });
});

app.get('/api/public-settings', async (req, res) => {
  const keys = ['site_name', 'footer_created_visible', 'footer_copyright_text', 'primary_color', 'book_bg_color', 'first_visit_auth'];
  const result = {};
  for (const k of keys) {
    const { rows } = await query('SELECT value FROM settings WHERE key=$1', [k]);
    result[k] = rows[0]?.value || null;
  }
  res.json(result);
});

// ===== ADMİN YETKİLİ YÖNETİMİ =====
app.post('/api/admin/user/:id/set-admin', adminMiddleware, async (req, res) => {
  const { is_admin } = req.body;
  const { rows } = await query('SELECT * FROM users WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  const adminSince = is_admin ? 'NOW()' : 'NULL';
  await query(`UPDATE users SET is_admin=$1, admin_since=${adminSince} WHERE id=$2`, [is_admin ? 1 : 0, req.params.id]);
  await logAction('admin', is_admin ? 'grant_admin' : 'revoke_admin', rows[0].username);
  res.json({ ok: true });
});

// ===== MÜZİK SİSTEMİ =====
function makeSongSlug(title, id) {
  const base = slugify(title, { lower: true, strict: false, locale: 'tr', replacement: '-' })
    .replace(/[^a-z0-9\-]/g, '').replace(/-+/g, '-').substring(0, 60);
  return base + '-' + id;
}

// Artist başvurusu
app.post('/api/artist/apply', authMiddleware, upload.single('sample_file'), async (req, res) => {
  const { genre, sample_song_url, note } = req.body;
  if (!genre) return res.status(400).json({ error: 'Tür gerekli' });
  if (!sample_song_url && !req.file) return res.status(400).json({ error: 'Örnek şarkı gerekli' });
  const { rows: existing } = await query('SELECT id, status FROM artist_applications WHERE user_id=$1 ORDER BY id DESC LIMIT 1', [req.user.id]);
  if (existing.length && existing[0].status === 'pending') return res.status(400).json({ error: 'Zaten bekleyen bir başvurunuz var' });
  let sampleFile = '';
  if (req.file) { try { sampleFile = await handleUpload(req.file); } catch {} }
  const { rows } = await query(
    'INSERT INTO artist_applications (user_id, genre, sample_song_url, sample_song_file, note) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [req.user.id, genre, sample_song_url || '', sampleFile, note || '']
  );
  res.json(rows[0]);
});

app.get('/api/artist/my-application', authMiddleware, async (req, res) => {
  const { rows } = await query('SELECT * FROM artist_applications WHERE user_id=$1 ORDER BY id DESC LIMIT 1', [req.user.id]);
  res.json(rows[0] || null);
});

// Şarkı yükleme (sadece artist)
app.post('/api/songs', authMiddleware, upload.fields([
  { name: 'audio', maxCount: 1 },
  { name: 'cover', maxCount: 1 }
]), async (req, res) => {
  const { song_type, title, artist_name, distributor, genre, lyrics, share_reason, rules_accepted } = req.body;
  // Kendi şarkısı için artist rozeti zorunlu, başkasının şarkısı için değil
  if ((song_type === 'own' || !song_type) && !req.user.is_artist) {
    return res.status(403).json({ error: 'Kendi şarkını yüklemek için artist rozeti gerekli' });
  }
  if (!rules_accepted) return res.status(400).json({ error: 'Kuralları kabul etmelisiniz' });
  if (!title || !artist_name) return res.status(400).json({ error: 'Başlık ve sanatçı adı gerekli' });
  if (!req.files?.audio?.[0]) return res.status(400).json({ error: 'Ses dosyası gerekli' });
  let audio_url = '', cover_url = '';
  try { audio_url = await handleUpload(req.files.audio[0]); } catch (e) { return res.status(500).json({ error: 'Ses yüklenemedi: ' + e.message }); }
  if (req.files?.cover?.[0]) { try { cover_url = await handleUpload(req.files.cover[0]); } catch {} }
  const { rows } = await query(
    `INSERT INTO songs (uploader_id, song_type, title, artist_name, distributor, genre, lyrics, cover_url, audio_url, share_reason, slug)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'tmp') RETURNING id`,
    [req.user.id, song_type || 'own', title, artist_name, distributor || '', genre || '', lyrics || '', cover_url, audio_url, share_reason || '']
  );
  const id = rows[0].id;
  const slug = makeSongSlug(title, id);
  await query('UPDATE songs SET slug=$1 WHERE id=$2', [slug, id]);
  await logAction(req.user.username, 'upload_song', slug);
  await notifyFollowersOfContent(req.user, 'new_song', 'Yeni şarkı', `@${req.user.username} yeni bir şarkı paylaştı: ${title}`, '/muzik/' + slug).catch(() => {});
  res.json({ ok: true, slug });
});

// Tüm şarkılar (liste)
app.get('/api/songs', async (req, res) => {
  // Süresi dolan banları otomatik aktife al
  await query(`UPDATE songs SET status='active', ban_reason='', ban_until=NULL WHERE status='suspended' AND ban_until IS NOT NULL AND ban_until < NOW()`);
  const { q, genre, artist, distributor } = req.query;
  let where = "WHERE s.status='active'";
  const params = [];
  if (q) {
    params.push(`%${q}%`);
    where += ` AND (s.title ILIKE $${params.length} OR s.artist_name ILIKE $${params.length} OR s.lyrics ILIKE $${params.length} OR s.distributor ILIKE $${params.length})`;
  }
  if (genre && !q) { params.push(`%${genre}%`); where += ` AND s.genre ILIKE $${params.length}`; }
  if (artist && !q) { params.push(`%${artist}%`); where += ` AND s.artist_name ILIKE $${params.length}`; }
  if (distributor && !q) { params.push(`%${distributor}%`); where += ` AND s.distributor ILIKE $${params.length}`; }
  const { rows } = await query(
    `SELECT s.id, s.title, s.artist_name, s.distributor, s.genre, s.cover_url, s.audio_url,
            s.play_count, s.slug, s.song_type, s.published_at, s.share_reason,
            u.username as uploader, u.avatar as uploader_avatar
     FROM songs s LEFT JOIN users u ON s.uploader_id=u.id
     ${where} ORDER BY s.published_at DESC LIMIT 100`,
    params
  );
  res.json(rows);
});

// Tek şarkı
app.get('/api/songs/:slug', async (req, res) => {
  const { rows } = await query(
    `SELECT s.*, u.username as uploader, u.avatar as uploader_avatar, u.is_artist
     FROM songs s LEFT JOIN users u ON s.uploader_id=u.id
     WHERE s.slug=$1`,
    [req.params.slug]
  );
  if (!rows.length) return res.status(404).json({ error: 'Şarkı bulunamadı' });
  res.json(rows[0]);
});

// Dinlenme sayısı artır
app.post('/api/songs/:slug/play', async (req, res) => {
  await query('UPDATE songs SET play_count=play_count+1 WHERE slug=$1', [req.params.slug]);
  res.json({ ok: true });
});

// Yarı dinleme sayacı — şarkının %50'sine ulaşınca çağrılır
app.post('/api/songs/:slug/play-half', async (req, res) => {
  await query('UPDATE songs SET play_count=play_count+1 WHERE slug=$1', [req.params.slug]);
  res.json({ ok: true });
});

// Admin: tüm şarkılar
app.get('/api/admin/songs', adminMiddleware, async (req, res) => {
  const { rows } = await query(
    `SELECT s.*, u.username as uploader FROM songs s LEFT JOIN users u ON s.uploader_id=u.id ORDER BY s.created_at DESC`
  );
  res.json(rows);
});

// Kullanıcı: kendi şarkısını güncelle
app.put('/api/songs/:id', authMiddleware, upload.fields([
  { name: 'audio', maxCount: 1 },
  { name: 'cover', maxCount: 1 }
]), async (req, res) => {
  const { rows } = await query('SELECT * FROM songs WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Şarkı bulunamadı' });
  const song = rows[0];
  if (song.uploader_id !== req.user.id) return res.status(403).json({ error: 'Bu şarkıyı düzenleme yetkiniz yok' });
  const { title, artist_name, genre, lyrics, share_reason, distributor } = req.body;
  let audio_url = song.audio_url, cover_url = song.cover_url;
  if (req.files?.audio?.[0]) { try { audio_url = await handleUpload(req.files.audio[0]); } catch {} }
  if (req.files?.cover?.[0]) { try { cover_url = await handleUpload(req.files.cover[0]); } catch {} }
  await query(
    `UPDATE songs SET title=$1, artist_name=$2, genre=$3, lyrics=$4, share_reason=$5,
     distributor=$6, audio_url=$7, cover_url=$8 WHERE id=$9`,
    [title || song.title, artist_name || song.artist_name, genre ?? song.genre,
     lyrics ?? song.lyrics, share_reason ?? song.share_reason,
     distributor ?? song.distributor, audio_url, cover_url, song.id]
  );
  await logAction(req.user.username, 'edit_song', song.slug);
  res.json({ ok: true, slug: song.slug });
});

// Admin: şarkı güncelle
app.put('/api/admin/songs/:id', adminMiddleware, upload.fields([
  { name: 'audio', maxCount: 1 },
  { name: 'cover', maxCount: 1 }
]), async (req, res) => {
  const { title, artist_name, distributor, genre, lyrics, play_count, status } = req.body;
  const song = (await query('SELECT * FROM songs WHERE id=$1', [req.params.id])).rows[0];
  if (!song) return res.status(404).json({ error: 'Şarkı bulunamadı' });
  let audio_url = song.audio_url, cover_url = song.cover_url;
  if (req.files?.audio?.[0]) { try { audio_url = await handleUpload(req.files.audio[0]); } catch {} }
  if (req.files?.cover?.[0]) { try { cover_url = await handleUpload(req.files.cover[0]); } catch {} }
  await query(
    `UPDATE songs SET title=$1, artist_name=$2, distributor=$3, genre=$4, lyrics=$5,
     play_count=$6, status=$7, audio_url=$8, cover_url=$9 WHERE id=$10`,
    [title || song.title, artist_name || song.artist_name, distributor ?? song.distributor,
     genre ?? song.genre, lyrics ?? song.lyrics, parseInt(play_count) || song.play_count,
     status || song.status, audio_url, cover_url, req.params.id]
  );
  res.json({ ok: true });
});

// Kullanıcı: kendi şarkısını sil
app.delete('/api/songs/:id', authMiddleware, async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM songs WHERE id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Şarkı bulunamadı' });
    const song = rows[0];
    if (song.uploader_id !== req.user.id && !req.user.is_admin) return res.status(403).json({ error: 'Bu şarkıyı silme yetkiniz yok' });
    await query('DELETE FROM songs WHERE id=$1', [req.params.id]);
    await logAction(req.user.username, 'delete_song', song.slug);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Silme hatası: ' + e.message }); }
});

// Admin: şarkı sil
app.delete('/api/admin/songs/:id', adminMiddleware, async (req, res) => {
  await query('DELETE FROM songs WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// Admin: artist başvuruları
app.get('/api/admin/artist-applications', adminMiddleware, async (req, res) => {
  const { rows } = await query(
    `SELECT a.*, u.username, u.avatar FROM artist_applications a
     LEFT JOIN users u ON a.user_id=u.id ORDER BY a.created_at DESC`
  );
  res.json(rows);
});

// Admin: başvuru onayla/reddet
app.post('/api/admin/artist-applications/:id/review', adminMiddleware, async (req, res) => {
  const { status } = req.body; // accepted | rejected
  if (!['accepted', 'rejected'].includes(status)) return res.status(400).json({ error: 'Geçersiz durum' });
  const { rows } = await query('SELECT * FROM artist_applications WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Başvuru bulunamadı' });
  await query('UPDATE artist_applications SET status=$1, reviewed_at=NOW() WHERE id=$2', [status, req.params.id]);
  if (status === 'accepted') {
    await query('UPDATE users SET is_artist=1, artist_since=NOW() WHERE id=$1', [rows[0].user_id]);
  }
  res.json({ ok: true });
});

// ===== ADMIN: ARTİSTLER =====

// Tüm artistler listesi
app.get('/api/admin/artists', adminMiddleware, async (req, res) => {
  const { rows } = await query(`
    SELECT u.id, u.username, u.email, u.avatar, u.is_artist, u.artist_since,
           u.artist_display_name, u.artist_bio, u.artist_genre, u.artist_website,
           u.banned,
           COUNT(s.id) AS song_count,
           SUM(s.play_count) AS total_plays
    FROM users u
    LEFT JOIN songs s ON s.uploader_id = u.id AND s.status != 'deleted'
    WHERE u.is_artist = 1
    GROUP BY u.id
    ORDER BY u.artist_since DESC
  `);
  res.json(rows);
});

// Artist bilgilerini düzenle
app.put('/api/admin/artists/:id', adminMiddleware, async (req, res) => {
  const { artist_display_name, artist_bio, artist_genre, artist_website, is_artist } = req.body;
  const { rows } = await query('SELECT id FROM users WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  await query(`
    UPDATE users SET
      artist_display_name = COALESCE($1, artist_display_name),
      artist_bio          = COALESCE($2, artist_bio),
      artist_genre        = COALESCE($3, artist_genre),
      artist_website      = COALESCE($4, artist_website),
      is_artist           = $5
    WHERE id = $6
  `, [
    artist_display_name ?? null,
    artist_bio ?? null,
    artist_genre ?? null,
    artist_website ?? null,
    is_artist !== undefined ? (is_artist ? 1 : 0) : 1,
    req.params.id
  ]);
  await logAction('admin', 'edit_artist', req.params.id);
  res.json({ ok: true });
});

// Artist'in şarkıları
app.get('/api/admin/artists/:id/songs', adminMiddleware, async (req, res) => {
  const { rows } = await query(`
    SELECT s.id, s.title, s.artist_name, s.genre, s.cover_url, s.audio_url,
           s.play_count, s.slug, s.status, s.song_type, s.distributor,
           s.ban_reason, s.ban_until, s.created_at
    FROM songs s
    WHERE s.uploader_id = $1
    ORDER BY s.created_at DESC
  `, [req.params.id]);
  res.json(rows);
});

// Şarkıya ban uygula (süreli veya kalıcı)
app.post('/api/admin/songs/:id/ban', adminMiddleware, async (req, res) => {
  const { reason, duration_days } = req.body;
  // duration_days: sayı ise süreli, 0 veya yoksa kalıcı (null)
  const banUntil = duration_days && parseInt(duration_days) > 0
    ? new Date(Date.now() + parseInt(duration_days) * 86400000).toISOString()
    : null;
  const { rows } = await query('SELECT id, slug FROM songs WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Şarkı bulunamadı' });
  await query(
    'UPDATE songs SET status=$1, ban_reason=$2, ban_until=$3 WHERE id=$4',
    ['suspended', reason || '', banUntil, req.params.id]
  );
  await logAction('admin', 'ban_song', rows[0].slug + (banUntil ? ` (${duration_days}g)` : ' (kalıcı)'));
  res.json({ ok: true, ban_until: banUntil });
});

// Şarkı banını kaldır
app.post('/api/admin/songs/:id/unban', adminMiddleware, async (req, res) => {
  const { rows } = await query('SELECT id, slug FROM songs WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Şarkı bulunamadı' });
  await query(
    'UPDATE songs SET status=$1, ban_reason=$2, ban_until=$3 WHERE id=$4',
    ['active', '', null, req.params.id]
  );
  await logAction('admin', 'unban_song', rows[0].slug);
  res.json({ ok: true });
});


// Şarkı yükleme kuralları
app.get('/api/music-rules', async (req, res) => {
  const { rows: own } = await query("SELECT value FROM settings WHERE key='music_own_rules'");
  const { rows: other } = await query("SELECT value FROM settings WHERE key='music_other_rules'");
  res.json({
    own_rules: own[0]?.value || 'Kendi şarkılarınızı yüklerken telif hakkına sahip olmanız gerekmektedir.',
    other_rules: other[0]?.value || 'Başkasının şarkısını paylaşırken kaynak belirtmek zorunludur.'
  });
});

// SEO route'ları müzik için
app.get('/muzikler', (req, res) => res.send(injectMeta('Müzikler – CigCig Müzik', 'CigCig müzik platformu. Türkçe şarkılar, artist müzikleri.', `${SITE_URL}/muzikler`, '')));
app.get('/muzik/:slug', async (req, res) => {
  const { rows } = await query('SELECT * FROM songs WHERE slug=$1', [req.params.slug]);
  if (!rows.length) return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  const s = rows[0];
  const musicKw = `${s.title}, ${s.artist_name}, müzik, cigcig müzik, cig forum müzik, teatube müzik, türkçe müzik`;
  const musicLd = JSON.stringify({
    '@context':'https://schema.org','@type':'MusicRecording',
    'name': s.title,
    'byArtist':{'@type':'MusicGroup','name':s.artist_name},
    'url': `${SITE_URL}/muzik/${s.slug}`,
    'image': s.cover_url||undefined,
    'datePublished': s.published_at||undefined,
    'publisher':{'@type':'Organization','name':'CigCig','url':SITE_URL}
  });
  res.send(injectMeta(
    `${s.title} – ${s.artist_name} | CigCig Müzik`,
    `${s.artist_name} - ${s.title} | CigCig müzik platformunda dinle ve keşfet.`,
    `${SITE_URL}/muzik/${s.slug}`,
    s.cover_url,
    `<meta name="keywords" content="${musicKw}" />\n    <script type="application/ld+json">${musicLd}</script>`
  ));
});
app.get('/artist-basvuru', (req, res) => res.send(injectMeta('Artist Başvurusu – CigCig Müzik', 'CigCig Müzik platformu artist rozetine başvur', `${SITE_URL}/artist-basvuru`, '')));
app.get('/artist-panel', (req, res) => res.send(injectMeta('Artist Panel – CigCig Müzik', 'CigCig Müzik artist panelinde şarkı yükle ve yönet', `${SITE_URL}/artist-panel`, '')));
app.get('/sarki-yukle', (req, res) => res.send(injectMeta('Şarkı Paylaş – CigCig Müzik', 'CigCig topluluğuyla müzik paylaş', `${SITE_URL}/sarki-yukle`, '')));
app.get('/playlistlerim', (req, res) => res.send(injectMeta('Playlistlerim – CigCig Müzik', 'Kendi müzik playlistlerini oluştur ve yönet', `${SITE_URL}/playlistlerim`, '')));
app.get('/playlist/:id', (req, res) => res.send(injectMeta('Playlist – CigCig Müzik', 'CigCig Müzik playlist', `${SITE_URL}/playlist/${req.params.id}`, '')));

// ===== PLAYLIST API =====
app.get('/api/playlists', authMiddleware, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT p.*, CAST(COUNT(ps.id) AS INTEGER) as song_count
       FROM playlists p
       LEFT JOIN playlist_songs ps ON ps.playlist_id = p.id
       WHERE p.user_id = $1
       GROUP BY p.id
       ORDER BY p.created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/playlists', authMiddleware, async (req, res) => {
  try {
    const { name, description, emoji, cover_url, is_public } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Playlist adı gerekli' });
    const { rows } = await query(
      'INSERT INTO playlists (user_id, public_id, name, description, emoji, cover_url, is_public) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [req.user.id, 'pl_' + crypto.randomBytes(9).toString('base64url').toLowerCase(), name.trim(), description?.trim() || '', (emoji || '🎵').slice(0, 8), cover_url || '', is_public === false ? 0 : 1]
    );
    res.json(rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/playlists/:id', optionalAuth, async (req, res) => {
  try {
    const { rows: pl } = await query('SELECT * FROM playlists WHERE public_id=$1 OR id::text=$1', [req.params.id]);
    if (!pl.length) return res.status(404).json({ error: 'Playlist bulunamadı' });
    if (!pl[0].is_public && (!req.user || pl[0].user_id !== req.user.id)) return res.status(404).json({ error: 'Playlist bulunamadı' });
    const { rows: songs } = await query(
      `SELECT ps.id as ps_id, ps.position, s.id, s.slug, s.title, s.artist_name, s.cover_url, s.audio_url, s.play_count
       FROM playlist_songs ps
       JOIN songs s ON s.id = ps.song_id
       WHERE ps.playlist_id = $1 AND s.status = 'active'
       ORDER BY ps.position ASC, ps.added_at ASC`,
      [pl[0].id]
    );
    res.json({ ...pl[0], songs, is_owner: !!req.user && pl[0].user_id === req.user.id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/playlists/:id', authMiddleware, async (req, res) => {
  try {
    const { name, description, emoji, cover_url, is_public } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Playlist adı gerekli' });
    const { rows } = await query(
      'UPDATE playlists SET name=$1, description=$2,emoji=$3,cover_url=$4,is_public=$5 WHERE (public_id=$6 OR id::text=$6) AND user_id=$7 RETURNING *',
      [name.trim(), description?.trim() || '', (emoji || '🎵').slice(0,8), cover_url || '', is_public === false ? 0 : 1, req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Playlist bulunamadı' });
    res.json(rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/playlists/:id/save', authMiddleware, async (req, res) => {
  try {
    const { rows: source } = await query('SELECT * FROM playlists WHERE public_id=$1 OR id::text=$1', [req.params.id]);
    if (!source.length || !source[0].is_public) return res.status(404).json({ error: 'Playlist bulunamadı' });
    const p = source[0];
    const { rows: created } = await query(`INSERT INTO playlists (user_id,public_id,name,description,emoji,cover_url,is_public)
      VALUES ($1,$2,$3,$4,$5,$6,1) RETURNING *`, [req.user.id, 'pl_' + crypto.randomBytes(9).toString('base64url').toLowerCase(), p.name, p.description, p.emoji || '🎵', p.cover_url || '']);
    await query(`INSERT INTO playlist_songs (playlist_id,song_id,position)
      SELECT $1,song_id,position FROM playlist_songs WHERE playlist_id=$2 ORDER BY position`, [created[0].id, p.id]);
    res.json(created[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/playlists/:id', authMiddleware, async (req, res) => {
  try {
    const { rows } = await query('DELETE FROM playlists WHERE (public_id=$1 OR id::text=$1) AND user_id=$2 RETURNING id', [req.params.id, req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'Playlist bulunamadı' });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/playlists/:id/songs', authMiddleware, async (req, res) => {
  try {
    const { song_id } = req.body;
    const { rows: pl } = await query('SELECT id FROM playlists WHERE (public_id=$1 OR id::text=$1) AND user_id=$2', [req.params.id, req.user.id]);
    if (!pl.length) return res.status(404).json({ error: 'Playlist bulunamadı' });
    const { rows: song } = await query("SELECT id FROM songs WHERE id=$1 AND status='active'", [song_id]);
    if (!song.length) return res.status(404).json({ error: 'Şarkı bulunamadı' });
    const { rows: maxPos } = await query('SELECT COALESCE(MAX(position), -1) as mp FROM playlist_songs WHERE playlist_id=$1', [pl[0].id]);
    const pos = parseInt(maxPos[0].mp) + 1;
    try {
      await query('INSERT INTO playlist_songs (playlist_id, song_id, position) VALUES ($1, $2, $3)', [pl[0].id, song_id, pos]);
    } catch(e2) {
      if (e2.code === '23505') return res.status(400).json({ error: 'Bu şarkı zaten playlistte' });
      throw e2;
    }
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/playlists/:id/songs/:songId', authMiddleware, async (req, res) => {
  try {
    const { rows: pl } = await query('SELECT id FROM playlists WHERE (public_id=$1 OR id::text=$1) AND user_id=$2', [req.params.id, req.user.id]);
    if (!pl.length) return res.status(404).json({ error: 'Playlist bulunamadı' });
    await query('DELETE FROM playlist_songs WHERE playlist_id=$1 AND song_id=$2', [pl[0].id, req.params.songId]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/playlists/:id/reorder', authMiddleware, async (req, res) => {
  try {
    const { order } = req.body;
    if (!Array.isArray(order)) return res.status(400).json({ error: 'order array gerekli' });
    const { rows: pl } = await query('SELECT id FROM playlists WHERE (public_id=$1 OR id::text=$1) AND user_id=$2', [req.params.id, req.user.id]);
    if (!pl.length) return res.status(404).json({ error: 'Playlist bulunamadı' });
    for (let i = 0; i < order.length; i++) {
      await query('UPDATE playlist_songs SET position=$1 WHERE playlist_id=$2 AND song_id=$3', [i, pl[0].id, order[i]]);
    }
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ===== ADMIN YETKİ SİSTEMİ =====
app.get('/api/admin/permissions/:userId', adminMiddleware, async (req, res) => {
  const { rows } = await query('SELECT * FROM admin_permissions WHERE user_id=$1', [req.params.userId]);
  res.json(rows[0] || null);
});

app.post('/api/admin/permissions/:userId', adminMiddleware, async (req, res) => {
  const uid = req.params.userId;
  const {
    can_ban_users, can_delete_content, can_edit_content,
    can_manage_levels, can_manage_tags, can_manage_announcements,
    can_view_logs, can_manage_settings, can_manage_admins, can_view_users
  } = req.body;
  // Kullanıcıyı admin yap (is_admin=1 yoksa set et)
  await query('UPDATE users SET is_admin=1 WHERE id=$1', [uid]);
  const { rows: existing } = await query('SELECT id FROM admin_permissions WHERE user_id=$1', [uid]);
  if (existing.length) {
    await query(`UPDATE admin_permissions SET
      can_ban_users=$1, can_delete_content=$2, can_edit_content=$3,
      can_manage_levels=$4, can_manage_tags=$5, can_manage_announcements=$6,
      can_view_logs=$7, can_manage_settings=$8, can_manage_admins=$9, can_view_users=$10
      WHERE user_id=$11`,
      [can_ban_users?1:0, can_delete_content?1:0, can_edit_content?1:0,
       can_manage_levels?1:0, can_manage_tags?1:0, can_manage_announcements?1:0,
       can_view_logs?1:0, can_manage_settings?1:0, can_manage_admins?1:0, can_view_users?1:0, uid]);
  } else {
    await query(`INSERT INTO admin_permissions
      (user_id, can_ban_users, can_delete_content, can_edit_content, can_manage_levels,
       can_manage_tags, can_manage_announcements, can_view_logs, can_manage_settings, can_manage_admins, can_view_users)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [uid, can_ban_users?1:0, can_delete_content?1:0, can_edit_content?1:0,
       can_manage_levels?1:0, can_manage_tags?1:0, can_manage_announcements?1:0,
       can_view_logs?1:0, can_manage_settings?1:0, can_manage_admins?1:0, can_view_users?1:0]);
  }
  await logAction('admin', 'set_permissions', uid);
  res.json({ ok: true });
});

// ===== DUYURU SİSTEMİ =====
app.get('/api/announcements', async (req, res) => {
  const { rows } = await query(`SELECT * FROM announcements WHERE active=1 AND (expires_at IS NULL OR expires_at > NOW()) ORDER BY created_at DESC`);
  res.json(rows);
});

app.get('/api/admin/announcements', adminMiddleware, async (req, res) => {
  const { rows } = await query('SELECT * FROM announcements ORDER BY created_at DESC');
  res.json(rows);
});

app.post('/api/admin/announcements', adminMiddleware, async (req, res) => {
  const { title, content, bg_color, text_color, border_color, position, size, duration_type, duration_value } = req.body;
  if (!title || !content) return res.status(400).json({ error: 'Başlık ve içerik gerekli' });
  let expires_at = null;
  if (duration_value && parseInt(duration_value) > 0) {
    const ms = {
      seconds: 1000, minutes: 60000, hours: 3600000, days: 86400000
    }[duration_type] || 86400000;
    expires_at = new Date(Date.now() + parseInt(duration_value) * ms);
  }
  const { rows } = await query(
    `INSERT INTO announcements (title, content, bg_color, text_color, border_color, position, size, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [title, content, bg_color||'#dc2626', text_color||'#ffffff', border_color||'#991b1b',
     position||'top', size||'normal', expires_at]
  );
  res.json(rows[0]);
});

app.put('/api/admin/announcements/:id', adminMiddleware, async (req, res) => {
  const { title, content, bg_color, text_color, border_color, position, size, active, duration_type, duration_value } = req.body;
  let expires_at_sql = '';
  const params = [title, content, bg_color, text_color, border_color, position, size, active?1:0];
  if (duration_value && parseInt(duration_value) > 0) {
    const ms = { seconds: 1000, minutes: 60000, hours: 3600000, days: 86400000 }[duration_type] || 86400000;
    params.push(new Date(Date.now() + parseInt(duration_value) * ms));
    expires_at_sql = `, expires_at=$${params.length}`;
  }
  params.push(req.params.id);
  await query(
    `UPDATE announcements SET title=$1,content=$2,bg_color=$3,text_color=$4,border_color=$5,position=$6,size=$7,active=$8${expires_at_sql} WHERE id=$${params.length}`,
    params
  );
  const { rows } = await query('SELECT * FROM announcements WHERE id=$1', [req.params.id]);
  res.json(rows[0]);
});

app.delete('/api/admin/announcements/:id', adminMiddleware, async (req, res) => {
  await query('DELETE FROM announcements WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// ===== ADMİN: KULLANICI PROFİL ERİŞİM KONTROLÜ =====
app.get('/api/admin/my-perms', authMiddleware, async (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ error: 'Yetkisiz' });
  const { rows } = await query('SELECT * FROM admin_permissions WHERE user_id=$1', [req.user.id]);
  // tam admin ise tüm yetkiler var
  const isSuperAdmin = !rows.length;
  res.json({
    is_super_admin: isSuperAdmin,
    permissions: rows[0] || {
      can_ban_users:1, can_delete_content:1, can_edit_content:1,
      can_manage_levels:1, can_manage_tags:1, can_manage_announcements:1,
      can_view_logs:1, can_manage_settings:1, can_manage_admins:1, can_view_users:1
    }
  });
});

// ===== SITE AYARLARI (logo vb.) =====
app.get('/api/settings/public', async (req, res) => {
  const { rows } = await query("SELECT key, value FROM settings WHERE key IN ('site_name','site_description','primary_color','background_color','homepage_sections','profile_tabs','footer_created_visible','footer_copyright_text','first_visit_auth')");
  const obj = {};
  rows.forEach(r => { obj[r.key] = r.value; });
  if (!obj.site_name || obj.site_name.toLowerCase() === 'demlik') obj.site_name = 'CigCig';
  res.json(obj);
});

// ===== SPOTİFY OAuth =====
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || '';
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || '';
const SPOTIFY_REDIRECT = SITE_URL + '/api/spotify/callback';

app.get('/api/spotify/connect', authMiddleware, (req, res) => {
  const scopes = 'user-read-currently-playing user-read-playback-state';
  const url = `https://accounts.spotify.com/authorize?response_type=code&client_id=${SPOTIFY_CLIENT_ID}&scope=${encodeURIComponent(scopes)}&redirect_uri=${encodeURIComponent(SPOTIFY_REDIRECT)}&state=${req.user.id}`;
  res.redirect(url);
});

// Token'sız erişim için: token query param ile
app.get('/api/spotify/connect-redirect', async (req, res) => {
  const token = req.query.token;
  if (!token) return res.redirect('/ayarlar?spotify=error');
  const { rows } = await query('SELECT user_id FROM sessions WHERE token=$1', [token]);
  if (!rows.length) return res.redirect('/ayarlar?spotify=error');
  const scopes = 'user-read-currently-playing user-read-playback-state';
  const url = `https://accounts.spotify.com/authorize?response_type=code&client_id=${SPOTIFY_CLIENT_ID}&scope=${encodeURIComponent(scopes)}&redirect_uri=${encodeURIComponent(SPOTIFY_REDIRECT)}&state=${rows[0].user_id}`;
  res.redirect(url);
});

app.get('/api/spotify/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.redirect('/ayarlar?spotify=error');
  const userId = parseInt(state);
  if (!userId) return res.redirect('/ayarlar?spotify=error');
  try {
    const tokenRes = await new Promise((resolve, reject) => {
      const body = `grant_type=authorization_code&code=${encodeURIComponent(code)}&redirect_uri=${encodeURIComponent(SPOTIFY_REDIRECT)}`;
      const auth = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64');
      const options = {
        hostname: 'accounts.spotify.com', path: '/api/token', method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': `Basic ${auth}`, 'Content-Length': Buffer.byteLength(body) }
      };
      const req2 = require('https').request(options, r => {
        let d = ''; r.on('data', c => d += c);
        r.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
      });
      req2.on('error', reject); req2.write(body); req2.end();
    });
    if (!tokenRes.access_token) return res.redirect('/ayarlar?spotify=error');
    const expires = Date.now() + (tokenRes.expires_in * 1000);
    await query('UPDATE users SET spotify_token=$1, spotify_refresh=$2, spotify_expires=$3, spotify_show=1 WHERE id=$4',
      [tokenRes.access_token, tokenRes.refresh_token || '', expires, userId]);
    res.redirect('/ayarlar?spotify=ok');
  } catch (e) {
    res.redirect('/ayarlar?spotify=error');
  }
});

app.post('/api/spotify/disconnect', authMiddleware, async (req, res) => {
  await query("UPDATE users SET spotify_token='', spotify_refresh='', spotify_expires=0 WHERE id=$1", [req.user.id]);
  res.json({ ok: true });
});

app.put('/api/spotify/visibility', authMiddleware, async (req, res) => {
  const { show } = req.body;
  await query('UPDATE users SET spotify_show=$1 WHERE id=$2', [show ? 1 : 0, req.user.id]);
  res.json({ ok: true });
});

async function refreshSpotifyToken(userId, refreshToken) {
  return new Promise((resolve, reject) => {
    const body = `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`;
    const auth = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64');
    const options = {
      hostname: 'accounts.spotify.com', path: '/api/token', method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': `Basic ${auth}`, 'Content-Length': Buffer.byteLength(body) }
    };
    const req2 = require('https').request(options, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', async () => {
        try {
          const data = JSON.parse(d);
          if (data.access_token) {
            const expires = Date.now() + (data.expires_in * 1000);
            await query('UPDATE users SET spotify_token=$1, spotify_expires=$2 WHERE id=$3', [data.access_token, expires, userId]);
            resolve(data.access_token);
          } else { reject(new Error('refresh failed')); }
        } catch (e) { reject(e); }
      });
    });
    req2.on('error', reject); req2.write(body); req2.end();
  });
}

app.get('/api/spotify/now-playing/:username', async (req, res) => {
  const { rows } = await query('SELECT spotify_token, spotify_refresh, spotify_expires, spotify_show FROM users WHERE username=$1', [req.params.username]);
  if (!rows.length || !rows[0].spotify_token || !rows[0].spotify_show) return res.json({ playing: false });
  let token = rows[0].spotify_token;
  const uid_rows = await query('SELECT id FROM users WHERE username=$1', [req.params.username]);
  const uid = uid_rows.rows[0]?.id;
  // Token süresi dolmuşsa yenile
  if (Date.now() > parseInt(rows[0].spotify_expires) - 60000) {
    try { token = await refreshSpotifyToken(uid, rows[0].spotify_refresh); } catch { return res.json({ playing: false }); }
  }
  // Spotify API'den şu an çalınanı al
  const result = await new Promise(resolve => {
    const options = {
      hostname: 'api.spotify.com', path: '/v1/me/player/currently-playing',
      headers: { 'Authorization': `Bearer ${token}` }
    };
    const req2 = require('https').request(options, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => {
        if (r.statusCode === 204 || !d) return resolve({ playing: false });
        try {
          const data = JSON.parse(d);
          if (!data.item || !data.is_playing) return resolve({ playing: false });
          resolve({
            playing: true,
            title: data.item.name,
            artist: data.item.artists.map(a => a.name).join(', '),
            album_art: data.item.album?.images?.[0]?.url || '',
            url: data.item.external_urls?.spotify || '',
            progress_ms: data.progress_ms || 0,
            duration_ms: data.item.duration_ms || 0
          });
        } catch { resolve({ playing: false }); }
      });
    });
    req2.on('error', () => resolve({ playing: false })); req2.end();
  });
  res.json(result);
});

// ===== SEO META INJECT =====
// ===== ADMIN IP WHITELIST =====
function getAdminIPs() {
  const env = process.env.ADMIN_IPS || '';
  if (!env.trim()) return [];
  return env.split(',').map(ip => ip.trim()).filter(Boolean);
}

function adminIPCheck(req, res, next) {
  const allowed = getAdminIPs();
  if (allowed.length === 0) return next(); // env set edilmemişse geliştirme modunda aç
  const clientIP = (req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.ip || '').split(',')[0].trim();
  if (allowed.includes(clientIP)) return next();
  return res.status(404).sendFile(path.join(__dirname, 'public', 'index.html'));
}

app.get('/panel-giris', (req, res) => res.status(404).end());
app.get('/panel', (req, res) => res.status(404).end());

function injectMeta(title, desc, url, imageUrl, extraMeta) {
  let html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
  const img = imageUrl || `${SITE_URL}/cigcig.png`;
  const extra = extraMeta || '';
  const meta = `<title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(desc)}" />
    <link rel="canonical" href="${escapeHtml(url)}" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(desc)}" />
    <meta property="og:url" content="${escapeHtml(url)}" />
    <meta property="og:site_name" content="CigCig" />
    <meta property="og:image" content="${escapeHtml(img)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(desc)}" />
    <meta name="twitter:image" content="${escapeHtml(img)}" />
    ${extra}`;
  // SEO_START/SEO_END arasını değiştir — index.html başlığından bağımsız
  const injected = html.replace(/<!-- SEO_START -->[\s\S]*?<!-- SEO_END -->/m,
    `<!-- SEO_START -->\n  ${meta}\n  <!-- SEO_END -->`);
  if (injected !== html) return injected;
  // Yedek: regex ile herhangi bir title tag'ını değiştir
  return html.replace(/<title>[^<]*<\/title>/, meta);
}

app.get('/giris', (req, res) => res.send(injectMeta('Giriş – CigCig', 'CigCig hesabına giriş yap.', `${SITE_URL}/giris`, '')));
app.get('/kayit', (req, res) => res.send(injectMeta('Kayıt Ol – CigCig', 'CigCig\'e ücretsiz kaydol.', `${SITE_URL}/kayit`, '')));
app.get('/forum', (req, res) => {
  const tag = req.query.tag || '';
  res.send(injectMeta(tag ? `${tag} Konuları – CigCig Forum` : 'Konular – CigCig Forum',
    tag ? `CigCig Forum'da ${tag} etiketli konular.` : 'CigCig Forum – konular, tartışmalar ve haberler.',
    `${SITE_URL}/forum${tag ? '?tag='+encodeURIComponent(tag) : ''}`, ''));
});
app.get('/kitaplar', (req, res) => res.send(injectMeta('E-Kitaplar – CigCig', 'CigCig e-kitaplarını ücretsiz oku. Kitap adını aratarak bul.', `${SITE_URL}/kitaplar`, '')));
app.get('/gruplar', (req, res) => res.send(injectMeta('Gruplar – CigCig', 'CigCig topluluğundaki gruplara katıl.', `${SITE_URL}/gruplar`, '')));
app.get('/ayarlar', (req, res) => res.send(injectMeta('Ayarlar – CigCig', 'Hesap ayarlarını düzenle.', `${SITE_URL}/ayarlar`, '')));
app.get('/mesajlar', (req, res) => res.send(injectMeta('Mesajlar – CigCig', 'Özel mesajlarınız.', `${SITE_URL}/mesajlar`, '')));
app.get('/mesajlar/:username', (req, res) => res.send(injectMeta('Mesajlar – CigCig', 'Özel mesajlarınız.', `${SITE_URL}/mesajlar/${req.params.username}`, '')));
app.get('/arkadaslar', (req, res) => res.send(injectMeta('Arkadaşlar – CigCig', 'Arkadaş listesi.', `${SITE_URL}/arkadaslar`, '')));

app.get('/forum/:slug', async (req, res) => {
  const { rows } = await query('SELECT * FROM forums WHERE slug=$1', [req.params.slug]);
  if (!rows.length) return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  const forum = rows[0];
  let html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
  const desc = escapeHtml((forum.content || '').substring(0, 160).replace(/\n/g, ' '));
  const imgTag = forum.banner_image
    ? `<meta property="og:image" content="${escapeHtml(forum.banner_image)}" /><meta name="twitter:image" content="${escapeHtml(forum.banner_image)}" /><meta name="twitter:card" content="summary_large_image" />`
    : `<meta property="og:image" content="${SITE_URL}/teatube.png" />`;
  const forumKw = `${escapeHtml(forum.title)}, cig forum, cigcig, cigcig forum, cig, forum konusu`;
  const forumLd = JSON.stringify({
    '@context':'https://schema.org','@type':'DiscussionForumPosting',
    'headline': forum.title,
    'url': `${SITE_URL}/forum/${forum.slug}`,
    'datePublished': forum.created_at,
    'dateModified': forum.updated_at || forum.created_at,
    'description': (forum.content||'').substring(0,200),
    'author':{'@type':'Person','name':forum.username||'Anonim'},
    'publisher':{'@type':'Organization','name':'CigCig','url':SITE_URL,'logo':{'@type':'ImageObject','url':`${SITE_URL}/cigcig.png`}}
  });
  const meta = `<title>${escapeHtml(forum.title)} – CigCig Forum</title>
    <meta name="description" content="${desc}" />
    <meta name="keywords" content="${forumKw}" />
    <link rel="canonical" href="${SITE_URL}/forum/${escapeHtml(forum.slug)}" />
    <meta property="og:title" content="${escapeHtml(forum.title)} – CigCig Forum" />
    <meta property="og:description" content="${desc}" />
    <meta property="og:type" content="article" />
    <meta property="og:url" content="${SITE_URL}/forum/${escapeHtml(forum.slug)}" />
    <meta property="og:site_name" content="CigCig" />
    ${imgTag}
    <script type="application/ld+json">${forumLd}</script>`;
  const r1 = html.replace(/<!-- SEO_START -->[\s\S]*?<!-- SEO_END -->/m,`<!-- SEO_START -->\n  ${meta}\n  <!-- SEO_END -->`);
  res.send(r1!==html?r1:html.replace(/<title>[^<]*<\/title>/,meta));
});

app.get('/kitap/:slug', async (req, res) => {
  const { rows } = await query('SELECT * FROM books WHERE slug=$1', [req.params.slug]);
  if (!rows.length) return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  const book = rows[0];
  let html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
  const desc = escapeHtml((book.preface || book.title + ' – CigCig Kitap').substring(0, 160));
  const imgTag = book.cover_image
    ? `<meta property="og:image" content="${escapeHtml(book.cover_image)}" /><meta name="twitter:image" content="${escapeHtml(book.cover_image)}" />`
    : `<meta property="og:image" content="${SITE_URL}/teatube.png" />`;
  const bookKw = `${escapeHtml(book.title)}${book.author?', '+escapeHtml(book.author):''}, e-kitap, cigcig kitap, cig forum kitap, ücretsiz kitap oku`;
  const bookLd = JSON.stringify({
    '@context':'https://schema.org','@type':'Book',
    'name': book.title,
    'url': `${SITE_URL}/kitap/${book.slug}`,
    'description': (book.preface||book.title).substring(0,200),
    'author': book.author?{'@type':'Person','name':book.author}:undefined,
    'publisher':{'@type':'Organization','name':'CigCig','url':SITE_URL},
    'image': book.cover_image||undefined,
    'inLanguage':'tr'
  });
  const meta = `<title>${escapeHtml(book.title)} – CigCig Kitap</title>
    <meta name="description" content="${desc}" />
    <meta name="keywords" content="${bookKw}" />
    <link rel="canonical" href="${SITE_URL}/kitap/${escapeHtml(book.slug)}" />
    <meta property="og:title" content="${escapeHtml(book.title)} – CigCig Kitap" />
    <meta property="og:description" content="${desc}" />
    <meta property="og:type" content="book" />
    <meta property="og:url" content="${SITE_URL}/kitap/${escapeHtml(book.slug)}" />
    <meta property="og:site_name" content="CigCig" />
    ${imgTag}
    <script type="application/ld+json">${bookLd}</script>`;
  const r2 = html.replace(/<!-- SEO_START -->[\s\S]*?<!-- SEO_END -->/m,`<!-- SEO_START -->\n  ${meta}\n  <!-- SEO_END -->`);
  res.send(r2!==html?r2:html.replace(/<title>[^<]*<\/title>/,meta));
});

app.get('/grup/:slug', async (req, res) => {
  const { rows } = await query('SELECT * FROM groups WHERE slug=$1', [req.params.slug]);
  if (!rows.length) return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  const group = rows[0];
  let html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
  const desc = escapeHtml((group.description || group.name + ' – CigCig topluluğu grubu.').substring(0, 160));
  const imgTag = group.cover_image
    ? `<meta property="og:image" content="${escapeHtml(group.cover_image)}" />`
    : `<meta property="og:image" content="${SITE_URL}/teatube.png" />`;
  const meta = `<title>${escapeHtml(group.name)} – CigCig Grup</title>
    <meta name="description" content="${desc}" />
    <link rel="canonical" href="${SITE_URL}/grup/${escapeHtml(group.slug)}" />
    <meta property="og:title" content="${escapeHtml(group.name)} – CigCig Grup" />
    <meta property="og:description" content="${desc}" />
    <meta property="og:url" content="${SITE_URL}/grup/${escapeHtml(group.slug)}" />
    <meta property="og:site_name" content="CigCig" />
    ${imgTag}`;
  const r3 = html.replace(/<!-- SEO_START -->[\s\S]*?<!-- SEO_END -->/m,`<!-- SEO_START -->\n  ${meta}\n  <!-- SEO_END -->`);
  res.send(r3!==html?r3:html.replace(/<title>[^<]*<\/title>/,meta));
});

app.get('/profil/:username', async (req, res) => {
  const { rows } = await query('SELECT * FROM users WHERE username=$1', [req.params.username]);
  if (!rows.length) return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  const user = rows[0];
  let html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
  const desc = escapeHtml((user.bio || `${user.username} adlı kullanıcının CigCig profili.`).substring(0, 160));
  const imgTag = user.avatar
    ? `<meta property="og:image" content="${escapeHtml(user.avatar)}" />`
    : `<meta property="og:image" content="${SITE_URL}/teatube.png" />`;
  const meta = `<title>${escapeHtml(user.username)} – CigCig</title>
    <meta name="description" content="${desc}" />
    <link rel="canonical" href="${SITE_URL}/profil/${escapeHtml(user.username)}" />
    <meta property="og:title" content="${escapeHtml(user.username)} – CigCig" />
    <meta property="og:description" content="${desc}" />
    <meta property="og:url" content="${SITE_URL}/profil/${escapeHtml(user.username)}" />
    <meta property="og:site_name" content="CigCig" />
    ${imgTag}`;
  const r4 = html.replace(/<!-- SEO_START -->[\s\S]*?<!-- SEO_END -->/m,`<!-- SEO_START -->\n  ${meta}\n  <!-- SEO_END -->`);
  res.send(r4!==html?r4:html.replace(/<title>[^<]*<\/title>/,meta));
});


// ===== KULLANICI ARAMA =====
app.get('/api/search/users', async (req, res) => {
  const q = req.query.q;
  if (!q || q.length < 2) return res.json([]);
  const { rows } = await query(`SELECT id, username, avatar, name_color FROM users WHERE username ILIKE $1 AND banned=0 LIMIT 20`, [`%${q}%`]);
  res.json(rows);
});

// Consolidated search across forums, photos and users
app.get('/api/search', async (req, res) => {
  try {
    let q = (req.query.q || '').trim();
    if (!q || q.length < 1) return res.json([]);
    // normalize legacy brand mentions
    q = q.replace(/teatube/ig, 'teatube');
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const term = `%${q}%`;

    const forumsP = query(`SELECT id, title, slug, content, username, created_at FROM forums WHERE (title ILIKE $1 OR content ILIKE $1) AND hidden=0 LIMIT $2`, [term, limit]);
    const photosP = query(`SELECT id, url, caption, username, created_at FROM photos WHERE caption ILIKE $1 LIMIT $2`, [term, limit]);
    const usersP = query(`SELECT id, username, avatar FROM users WHERE username ILIKE $1 AND banned=0 LIMIT $2`, [term, limit]);

    const [forumsR, photosR, usersR] = await Promise.all([forumsP, photosP, usersP]);

    const results = [];
    forumsR.rows.forEach(r => results.push({ type: 'forum', id: r.id, title: r.title, slug: r.slug, excerpt: (r.content || '').substring(0, 240), username: r.username, created_at: r.created_at }));
    photosR.rows.forEach(r => results.push({ type: 'photo', id: r.id, url: r.url, caption: r.caption, username: r.username, created_at: r.created_at }));
    usersR.rows.forEach(r => results.push({ type: 'user', id: r.id, username: r.username, avatar: r.avatar }));

    // return up to `limit` items, preserving type order
    res.json(results.slice(0, limit));
  } catch (err) {
    console.error('Search error', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

// ===== ARKADAŞLIK =====
app.get('/api/friends', authMiddleware, async (req, res) => {
  const uid = req.user.id;
  const { rows } = await query(`
    SELECT f.id, f.created_at, 'accepted' AS status,
      f.following_id AS other_id, u.username AS other_username, u.avatar AS other_avatar,
      u.name_color AS other_name_color, COALESCE(u.is_deleted,0) AS other_is_deleted
    FROM follows f
    JOIN users u ON u.id=f.following_id
    WHERE f.follower_id=$1 AND f.status='accepted'
      AND EXISTS (SELECT 1 FROM follows mutual WHERE mutual.follower_id=f.following_id
        AND mutual.following_id=$1 AND mutual.status='accepted')
  `, [uid]);
  res.json(rows);
});

app.post('/api/friends/request/:username', authMiddleware, async (req, res) => {
  const { rows: target } = await query('SELECT id FROM users WHERE username=$1', [req.params.username]);
  if (!target.length) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  const targetId = target[0].id;
  if (targetId == req.user.id) return res.status(400).json({ error: 'Kendinize istek gönderemezsiniz' });
  // Engel kontrolü
  const { rows: blk } = await query('SELECT id FROM blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1)', [req.user.id, targetId]);
  if (blk.length) return res.status(403).json({ error: 'Bu kullanıcıyla işlem yapılamaz' });
  const { rows: ex } = await query('SELECT * FROM friendships WHERE (requester_id=$1 AND addressee_id=$2) OR (requester_id=$2 AND addressee_id=$1)', [req.user.id, targetId]);
  if (ex.length) return res.status(400).json({ error: 'Zaten istek gönderilmiş veya arkadaşsınız' });
  await query('INSERT INTO friendships (requester_id, addressee_id, status) VALUES ($1,$2,$3)', [req.user.id, targetId, 'pending']);
  await query(`INSERT INTO notifications (user_id,type,actor_username,actor_avatar,title,body,link) VALUES ($1,'friend_request',$2,$3,'Yeni arkadaşlık isteği','@' || $2 || ' sana arkadaşlık isteği gönderdi.',$4)`, [targetId, req.user.username, req.user.avatar || '', '/arkadaslar']);
  res.json({ ok: true });
});

app.post('/api/friends/respond/:id', authMiddleware, async (req, res) => {
  const { action } = req.body; // accept | reject
  const { rows } = await query('SELECT * FROM friendships WHERE id=$1 AND addressee_id=$2', [req.params.id, req.user.id]);
  if (!rows.length) return res.status(404).json({ error: 'İstek bulunamadı' });
  if (action === 'accept') {
    await query("UPDATE friendships SET status='accepted', updated_at=NOW() WHERE id=$1", [rows[0].id]);
  } else {
    await query('DELETE FROM friendships WHERE id=$1', [rows[0].id]);
  }
  res.json({ ok: true });
});

app.delete('/api/friends/:id', authMiddleware, async (req, res) => {
  await query('DELETE FROM friendships WHERE id=$1 AND (requester_id=$2 OR addressee_id=$2)', [req.params.id, req.user.id]);
  res.json({ ok: true });
});

app.get('/api/profile/:username/friends', async (req, res) => {
  const { rows: users } = await query('SELECT id FROM users WHERE username=$1', [req.params.username]);
  if (!users.length) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  const uid = users[0].id;
  const { rows } = await query(`
    SELECT u.id, u.username, u.avatar, u.title
    FROM friendships f
    JOIN users u ON (u.id = CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END)
    WHERE (f.requester_id = $1 OR f.addressee_id = $1) AND f.status = 'accepted'
  `, [uid]);
  res.json(rows);
});

// ===== ENGELLEME =====
app.post('/api/block/:username', authMiddleware, async (req, res) => {
  const { rows: target } = await query('SELECT id FROM users WHERE username=$1', [req.params.username]);
  if (!target.length) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  const targetId = target[0].id;
  if (targetId == req.user.id) return res.status(400).json({ error: 'Kendinizi engelleyemezsiniz' });
  // Arkadaşlığı sil
  await query('DELETE FROM friendships WHERE (requester_id=$1 AND addressee_id=$2) OR (requester_id=$2 AND addressee_id=$1)', [req.user.id, targetId]);
  await query('INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.user.id, targetId]);
  res.json({ ok: true });
});

app.delete('/api/block/:username', authMiddleware, async (req, res) => {
  const { rows: target } = await query('SELECT id FROM users WHERE username=$1', [req.params.username]);
  if (!target.length) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  await query('DELETE FROM blocks WHERE blocker_id=$1 AND blocked_id=$2', [req.user.id, target[0].id]);
  res.json({ ok: true });
});

app.get('/api/blocks', authMiddleware, async (req, res) => {
  const { rows } = await query(`
    SELECT b.*, u.username, u.avatar, COALESCE(u.is_deleted,0) as is_deleted FROM blocks b
    JOIN users u ON b.blocked_id=u.id
    WHERE b.blocker_id=$1 ORDER BY b.created_at DESC
  `, [req.user.id]);
  res.json(rows);
});

// ===== MESAJLAR (DM) =====
app.get('/api/conversations', authMiddleware, async (req, res) => {
  const uid = req.user.id;
  const { rows } = await query(`
    SELECT c.*,
      CASE WHEN c.user1_id=$1 THEN u2.username ELSE u1.username END as other_username,
      CASE WHEN c.user1_id=$1 THEN u2.avatar ELSE u1.avatar END as other_avatar,
      CASE WHEN c.user1_id=$1 THEN u2.avatar_removed ELSE u1.avatar_removed END as other_avatar_removed,
      CASE WHEN c.user1_id=$1 THEN u2.id ELSE u1.id END as other_id,
      CASE WHEN c.user1_id=$1 THEN u2.name_color ELSE u1.name_color END as other_name_color,
      (SELECT content FROM dm_messages WHERE conversation_id=c.id AND deleted_for_all=0 ORDER BY created_at DESC LIMIT 1) as last_message,
      (SELECT COUNT(*) FROM dm_messages WHERE conversation_id=c.id AND sender_id!=$1 AND 
        CASE WHEN c.user1_id=$1 THEN deleted_by_receiver=0 ELSE deleted_by_sender=0 END
        AND deleted_for_all=0
        AND id > CASE WHEN c.user1_id=$1 THEN COALESCE(c.read_until_user1,0) ELSE COALESCE(c.read_until_user2,0) END
      ) as unread_count
    FROM dm_conversations c
    JOIN users u1 ON c.user1_id=u1.id
    JOIN users u2 ON c.user2_id=u2.id
    WHERE (c.user1_id=$1 AND c.hidden_by_user1=0) OR (c.user2_id=$1 AND c.hidden_by_user2=0)
    ORDER BY c.last_message_at DESC
  `, [uid]);
  res.json(rows);
});

app.get('/api/conversations/hidden', authMiddleware, async (req, res) => {
  const uid = req.user.id;
  const { rows } = await query(`
    SELECT c.*,
      CASE WHEN c.user1_id=$1 THEN u2.username ELSE u1.username END as other_username,
      CASE WHEN c.user1_id=$1 THEN u2.avatar ELSE u1.avatar END as other_avatar,
      CASE WHEN c.user1_id=$1 THEN u2.avatar_removed ELSE u1.avatar_removed END as other_avatar_removed,
      CASE WHEN c.user1_id=$1 THEN u2.id ELSE u1.id END as other_id,
      CASE WHEN c.user1_id=$1 THEN u2.name_color ELSE u1.name_color END as other_name_color,
      (SELECT content FROM dm_messages WHERE conversation_id=c.id AND deleted_for_all=0 ORDER BY created_at DESC LIMIT 1) as last_message
    FROM dm_conversations c
    JOIN users u1 ON c.user1_id=u1.id
    JOIN users u2 ON c.user2_id=u2.id
    WHERE (c.user1_id=$1 AND c.hidden_by_user1=1) OR (c.user2_id=$1 AND c.hidden_by_user2=1)
    ORDER BY c.last_message_at DESC
  `, [uid]);
  res.json(rows);
});

app.post('/api/conversations/unlock', authMiddleware, async (req, res) => {
  const crypto = require('crypto');
  const password = String(req.body?.password || '');
  const inputHash = crypto.createHash('sha256').update(password).digest('hex');
  const { rows } = await query(`
    SELECT c.*, CASE WHEN c.user1_id=$1 THEN u2.username ELSE u1.username END as other_username,
      CASE WHEN c.user1_id=$1 THEN u2.avatar ELSE u1.avatar END as other_avatar,
      CASE WHEN c.user1_id=$1 THEN u2.avatar_removed ELSE u1.avatar_removed END as other_avatar_removed,
      CASE WHEN c.user1_id=$1 THEN u2.id ELSE u1.id END as other_id,
      CASE WHEN c.user1_id=$1 THEN u2.name_color ELSE u1.name_color END as other_name_color,
      (SELECT content FROM dm_messages WHERE conversation_id=c.id AND deleted_for_all=0 ORDER BY created_at DESC LIMIT 1) as last_message
    FROM dm_conversations c JOIN users u1 ON c.user1_id=u1.id JOIN users u2 ON c.user2_id=u2.id
    WHERE ((c.user1_id=$1 AND c.hidden_by_user1=1) OR (c.user2_id=$1 AND c.hidden_by_user2=1))
      AND (CASE WHEN c.user1_id=$1 THEN c.hidden_pass_user1 ELSE c.hidden_pass_user2 END) = $2
    ORDER BY c.last_message_at DESC
  `, [req.user.id, inputHash]);
  if (!rows.length) return res.status(403).json({ error: 'Şifre yanlış veya kilitli sohbet bulunamadı' });
  res.json(rows);
});

app.get('/api/conversations/unread-count', authMiddleware, async (req, res) => {
  const uid = req.user.id;
  const { rows } = await query(`
    SELECT COUNT(*) as c FROM dm_messages m
    JOIN dm_conversations c ON c.id=m.conversation_id
    WHERE ((c.user1_id=$1 AND c.hidden_by_user1=0) OR (c.user2_id=$1 AND c.hidden_by_user2=0))
    AND m.sender_id!=$1
    AND CASE WHEN c.user1_id=$1 THEN m.deleted_by_receiver=0 ELSE m.deleted_by_sender=0 END
    AND m.deleted_for_all=0
    AND m.id > CASE WHEN c.user1_id=$1 THEN COALESCE(c.read_until_user1,0) ELSE COALESCE(c.read_until_user2,0) END
  `, [uid]);
  res.json({ count: parseInt(rows[0].c) });
});

app.get('/api/conversation/:username', authMiddleware, async (req, res) => {
  const { rows: target } = await query('SELECT id,username,avatar,avatar_removed,name_color,is_private FROM users WHERE username=$1', [req.params.username]);  if (!target.length) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  const other = target[0];
  const uid = req.user.id;
  if (other.is_private && other.id !== uid) {
    const { rows: friendship } = await query("SELECT id FROM friendships WHERE ((requester_id=$1 AND addressee_id=$2) OR (requester_id=$2 AND addressee_id=$1)) AND status='accepted'", [uid, other.id]);
    if (!friendship.length) return res.status(403).json({ error: 'Gizli hesaplara yalnızca arkadaşlar mesaj gönderebilir' });
  }
  const u1 = Math.min(uid, other.id), u2 = Math.max(uid, other.id);
  let { rows: convRows } = await query('SELECT * FROM dm_conversations WHERE user1_id=$1 AND user2_id=$2', [u1, u2]);
  if (!convRows.length) {
    const { rows: newConv } = await query('INSERT INTO dm_conversations (user1_id, user2_id) VALUES ($1,$2) RETURNING *', [u1, u2]);
    convRows = newConv;
  }
  const conv = convRows[0];
  const isUser1 = conv.user1_id == uid;
  const isHidden = isUser1 ? conv.hidden_by_user1 : conv.hidden_by_user2;
  const hiddenPass = isUser1 ? conv.hidden_pass_user1 : conv.hidden_pass_user2;
  if (isHidden) return res.json({ conv, other, messages: [], isHidden: true, hasPassword: !!hiddenPass });
  const { rows: msgs } = await query(`
    SELECT m.id, m.conversation_id, m.sender_id, m.content, m.image_url, m.shared_forum_id, m.shared_video_id, m.shared_photo_id, m.shared_story_id,
      m.reply_to_id, m.deleted_by_sender, m.deleted_by_receiver, m.deleted_for_all, m.created_at, m.read_at,
      u.username as sender_username, u.avatar as sender_avatar, u.avatar_removed as sender_avatar_removed, u.name_color as sender_name_color,
      f.title as forum_title, f.slug as forum_slug, f.banner_image as forum_banner,
      v.title as video_title, v.slug as video_slug, v.thumbnail_url as video_banner,
      p.url as photo_url, p.title as photo_title, p.caption as photo_caption,
      st.media_url as story_media_url, st.caption as story_caption, su.username as story_username,
      r.content as reply_content, ru.username as reply_username
    FROM dm_messages m
    JOIN users u ON m.sender_id=u.id
    LEFT JOIN forums f ON m.shared_forum_id=f.id
    LEFT JOIN videos v ON m.shared_video_id=v.id
    LEFT JOIN photos p ON m.shared_photo_id=p.id
    LEFT JOIN stories st ON m.shared_story_id=st.id
    LEFT JOIN users su ON st.user_id=su.id
    LEFT JOIN dm_messages r ON m.reply_to_id=r.id
    LEFT JOIN users ru ON r.sender_id=ru.id
    WHERE m.conversation_id=$1
      AND ($2=1 OR m.deleted_by_sender=0 OR m.sender_id!=$3)
      AND ($2=1 OR m.deleted_by_receiver=0 OR m.sender_id=$3)
    ORDER BY m.created_at ASC
  `, [conv.id, 0, uid]);

  // Konuşma açılınca read_until güncelle (son mesaj ID'si)
  if (msgs.length) {
    const lastId = msgs[msgs.length - 1].id;
    if (isUser1) {
      await query('UPDATE dm_conversations SET read_until_user1=$1 WHERE id=$2 AND read_until_user1 < $1', [lastId, conv.id]);
    } else {
      await query('UPDATE dm_conversations SET read_until_user2=$1 WHERE id=$2 AND read_until_user2 < $1', [lastId, conv.id]);
    }
  }

  res.json({ conv, other, messages: msgs, isHidden, hasPassword: !!hiddenPass });
});

// Mesajları okundu işaretle
app.post('/api/conversation/:username/mark-read', authMiddleware, async (req, res) => {
  const { rows: target } = await query('SELECT id FROM users WHERE username=$1', [req.params.username]);
  if (!target.length) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  const other = target[0];
  const uid = req.user.id;
  const u1 = Math.min(uid, other.id), u2 = Math.max(uid, other.id);
  const { rows: convRows } = await query('SELECT id,user1_id,hidden_by_user1,hidden_by_user2 FROM dm_conversations WHERE user1_id=$1 AND user2_id=$2', [u1, u2]);
  if (!convRows.length) return res.json({ ok: true });
  const isUser1 = convRows[0].user1_id == uid;
  if (isUser1 ? convRows[0].hidden_by_user1 : convRows[0].hidden_by_user2) return res.json({ ok: true });
  // Karşı tarafın mesajlarını okundu yap
  await query('UPDATE dm_messages SET read_at=NOW() WHERE conversation_id=$1 AND sender_id=$2 AND read_at IS NULL',
    [convRows[0].id, other.id]);
  res.json({ ok: true });
});

app.post('/api/conversation/:username/messages', authMiddleware, upload.single('image'), async (req, res) => {  const { rows: target } = await query('SELECT id,is_private FROM users WHERE username=$1', [req.params.username]);
  if (!target.length) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  const other = target[0];
  const uid = req.user.id;
  // Engel kontrolü
  const { rows: blk } = await query('SELECT id FROM blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1)', [uid, other.id]);
  if (blk.length) return res.status(403).json({ error: 'Bu kullanıcıyla mesajlaşamazsınız' });
  if (other.is_private && other.id !== uid) {
    const { rows: friendship } = await query("SELECT id FROM friendships WHERE ((requester_id=$1 AND addressee_id=$2) OR (requester_id=$2 AND addressee_id=$1)) AND status='accepted'", [uid, other.id]);
    if (!friendship.length) return res.status(403).json({ error: 'Gizli hesaplara yalnızca arkadaşlar mesaj gönderebilir' });
  }
  const u1 = Math.min(uid, other.id), u2 = Math.max(uid, other.id);
  let { rows: convRows } = await query('SELECT * FROM dm_conversations WHERE user1_id=$1 AND user2_id=$2', [u1, u2]);
  if (!convRows.length) {
    const { rows: nc } = await query('INSERT INTO dm_conversations (user1_id, user2_id) VALUES ($1,$2) RETURNING *', [u1, u2]);
    convRows = nc;
  }
  const conv = convRows[0];
  // Gizliliği aç (karşı taraftan mesaj geldi)
  if (conv.user1_id == other.id && conv.hidden_by_user1) {
    await query('UPDATE dm_conversations SET hidden_by_user1=0 WHERE id=$1', [conv.id]);
  } else if (conv.user2_id == other.id && conv.hidden_by_user2) {
    await query('UPDATE dm_conversations SET hidden_by_user2=0 WHERE id=$1', [conv.id]);
  }
  let { content, shared_forum_id, shared_video_id, shared_photo_id, shared_story_id, reply_to_id } = req.body;
  let image_url = '';
  if (req.file) {
    try { image_url = await handleUpload(req.file); } catch (e) {}
  }
  if (shared_photo_id && !content) content = ' ';
  if (!content?.trim() && !image_url && !shared_forum_id && !shared_video_id && !shared_photo_id && !shared_story_id) return res.status(400).json({ error: 'Mesaj boş olamaz' });
  const { rows: msgRows } = await query(
    'INSERT INTO dm_messages (conversation_id, sender_id, content, image_url, shared_forum_id, shared_video_id, shared_photo_id, shared_story_id, reply_to_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
    [conv.id, uid, content||'', image_url, shared_forum_id||null, shared_video_id||null, shared_photo_id||null, shared_story_id||null, reply_to_id||null]
  );
  await query('UPDATE dm_conversations SET last_message_at=NOW() WHERE id=$1', [conv.id]);
  // Forum paylaşım sayısını artır
  if (shared_forum_id) {
    await query('UPDATE forums SET share_count=COALESCE(share_count,0)+1 WHERE id=$1', [shared_forum_id]);
  }
  // DM @mention bildirimleri
  if (content?.trim()) {
    await parseMentionsAndNotify(content, req.user, 'dm_mention', '/mesajlar/' + req.params.username).catch(() => {});
  }
  const { rows: full } = await query(`
    SELECT m.id, m.conversation_id, m.sender_id, m.content, m.image_url, m.shared_forum_id, m.shared_video_id, m.shared_photo_id, m.shared_story_id,
      m.reply_to_id, m.deleted_by_sender, m.deleted_by_receiver, m.deleted_for_all, m.created_at, m.read_at,
      u.username as sender_username, u.avatar as sender_avatar, u.avatar_removed as sender_avatar_removed, u.name_color as sender_name_color,
      f.title as forum_title, f.slug as forum_slug, f.banner_image as forum_banner,
      v.title as video_title, v.slug as video_slug, v.thumbnail_url as video_banner,
      p.url as photo_url, p.title as photo_title, p.caption as photo_caption,
      st.media_url as story_media_url, st.caption as story_caption, su.username as story_username,
      r.content as reply_content, ru.username as reply_username
    FROM dm_messages m JOIN users u ON m.sender_id=u.id
    LEFT JOIN forums f ON m.shared_forum_id=f.id
    LEFT JOIN videos v ON m.shared_video_id=v.id
    LEFT JOIN photos p ON m.shared_photo_id=p.id
    LEFT JOIN stories st ON m.shared_story_id=st.id
    LEFT JOIN users su ON st.user_id=su.id
    LEFT JOIN dm_messages r ON m.reply_to_id=r.id
    LEFT JOIN users ru ON r.sender_id=ru.id
    WHERE m.id=$1
  `, [msgRows[0].id]);
  res.json(full[0]);
});

app.post('/api/conversation/:username/hide', authMiddleware, async (req, res) => {
  const { password } = req.body;
  const { rows: target } = await query('SELECT id FROM users WHERE username=$1', [req.params.username]);
  if (!target.length) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  const other = target[0];
  const uid = req.user.id;
  const u1 = Math.min(uid, other.id), u2 = Math.max(uid, other.id);
  const { rows: convRows } = await query('SELECT * FROM dm_conversations WHERE user1_id=$1 AND user2_id=$2', [u1, u2]);
  if (!convRows.length) return res.status(404).json({ error: 'Konuşma bulunamadı' });
  const conv = convRows[0];
  const isUser1 = conv.user1_id == uid;
  const passHash = password ? require('crypto').createHash('sha256').update(password).digest('hex') : '';
  if (isUser1) {
    await query('UPDATE dm_conversations SET hidden_by_user1=1, hidden_pass_user1=$1 WHERE id=$2', [passHash, conv.id]);
  } else {
    await query('UPDATE dm_conversations SET hidden_by_user2=1, hidden_pass_user2=$1 WHERE id=$2', [passHash, conv.id]);
  }
  res.json({ ok: true });
});

app.post('/api/conversation/:username/unhide', authMiddleware, async (req, res) => {
  const { password } = req.body;
  const { rows: target } = await query('SELECT id FROM users WHERE username=$1', [req.params.username]);
  if (!target.length) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  const other = target[0];
  const uid = req.user.id;
  const u1 = Math.min(uid, other.id), u2 = Math.max(uid, other.id);
  const { rows: convRows } = await query('SELECT * FROM dm_conversations WHERE user1_id=$1 AND user2_id=$2', [u1, u2]);
  if (!convRows.length) return res.status(404).json({ error: 'Konuşma bulunamadı' });
  const conv = convRows[0];
  const isUser1 = conv.user1_id == uid;
  const storedHash = isUser1 ? conv.hidden_pass_user1 : conv.hidden_pass_user2;
  if (storedHash) {
    const inputHash = require('crypto').createHash('sha256').update(password||'').digest('hex');
    if (inputHash !== storedHash) return res.status(403).json({ error: 'Yanlış şifre' });
  }
  if (isUser1) {
    await query('UPDATE dm_conversations SET hidden_by_user1=0 WHERE id=$1', [conv.id]);
  } else {
    await query('UPDATE dm_conversations SET hidden_by_user2=0 WHERE id=$1', [conv.id]);
  }
  res.json({ ok: true });
});

app.post('/api/conversation/:username/set-password', authMiddleware, async (req, res) => {
  const { password } = req.body;
  const { rows: target } = await query('SELECT id FROM users WHERE username=$1', [req.params.username]);
  if (!target.length) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  const other = target[0];
  const uid = req.user.id;
  const u1 = Math.min(uid, other.id), u2 = Math.max(uid, other.id);
  const { rows: convRows } = await query('SELECT * FROM dm_conversations WHERE user1_id=$1 AND user2_id=$2', [u1, u2]);
  if (!convRows.length) return res.status(404).json({ error: 'Konuşma bulunamadı' });
  const conv = convRows[0];
  const isUser1 = conv.user1_id == uid;
  const passHash = password ? require('crypto').createHash('sha256').update(password).digest('hex') : '';
  if (isUser1) {
    await query('UPDATE dm_conversations SET hidden_pass_user1=$1 WHERE id=$2', [passHash, conv.id]);
  } else {
    await query('UPDATE dm_conversations SET hidden_pass_user2=$1 WHERE id=$2', [passHash, conv.id]);
  }
  res.json({ ok: true });
});

app.delete('/api/messages/:id', authMiddleware, async (req, res) => {
  const { mode } = req.body; // 'me' | 'all'
  const { rows } = await query('SELECT * FROM dm_messages WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Mesaj bulunamadı' });
  const msg = rows[0];
  const { rows: convRows } = await query('SELECT * FROM dm_conversations WHERE id=$1', [msg.conversation_id]);
  if (!convRows.length) return res.status(404).json({ error: 'Konuşma bulunamadı' });
  const conv = convRows[0];
  const isOwn = msg.sender_id == req.user.id;
  if (mode === 'all' && !isOwn) return res.status(403).json({ error: 'Sadece kendi mesajınızı herkesten silebilirsiniz' });
  if (mode === 'all') {
    await query('UPDATE dm_messages SET deleted_for_all=1 WHERE id=$1', [msg.id]);
  } else {
    if (msg.sender_id == req.user.id) {
      await query('UPDATE dm_messages SET deleted_by_sender=1 WHERE id=$1', [msg.id]);
    } else {
      await query('UPDATE dm_messages SET deleted_by_receiver=1 WHERE id=$1', [msg.id]);
    }
  }
  res.json({ ok: true });
});

app.post('/api/messages/delete-bulk', authMiddleware, async (req, res) => {
  const { ids, mode } = req.body; // ids: array, mode: 'me'|'all'
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ID listesi gerekli' });
  if (mode === 'all') {
    for (const id of ids) {
      const { rows } = await query('SELECT sender_id FROM dm_messages WHERE id=$1', [id]);
      if (rows.length && rows[0].sender_id != req.user.id) return res.status(403).json({ error: 'Sadece kendi mesajınızı herkesten silebilirsiniz' });
    }
  }
  for (const id of ids) {
    const { rows } = await query('SELECT * FROM dm_messages WHERE id=$1', [id]);
    if (!rows.length) continue;
    const msg = rows[0];
    const isOwn = msg.sender_id == req.user.id;
    if (mode === 'all' && !isOwn) continue; // sadece kendi mesajlarını herkesten sil
    if (mode === 'all') {
      await query('UPDATE dm_messages SET deleted_for_all=1 WHERE id=$1', [id]);
    } else {
      if (isOwn) await query('UPDATE dm_messages SET deleted_by_sender=1 WHERE id=$1', [id]);
      else await query('UPDATE dm_messages SET deleted_by_receiver=1 WHERE id=$1', [id]);
    }
  }
  res.json({ ok: true });
});

app.delete('/api/conversation/:username', authMiddleware, async (req, res) => {
  const { rows: target } = await query('SELECT id FROM users WHERE username=$1', [req.params.username]);
  if (!target.length) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  const other = target[0];
  const uid = req.user.id;
  const u1 = Math.min(uid, other.id), u2 = Math.max(uid, other.id);
  const { rows: convRows } = await query('SELECT * FROM dm_conversations WHERE user1_id=$1 AND user2_id=$2', [u1, u2]);
  if (!convRows.length) return res.status(404).json({ error: 'Konuşma bulunamadı' });
  const conv = convRows[0];
  const isUser1 = conv.user1_id == uid;
  // Sadece kendi tarafından gizle (soft delete)
  if (isUser1) await query('UPDATE dm_conversations SET hidden_by_user1=2 WHERE id=$1', [conv.id]);
  else await query('UPDATE dm_conversations SET hidden_by_user2=2 WHERE id=$1', [conv.id]);
  res.json({ ok: true });
});

// ===== ADMIN: MESAJLARI OKU =====
app.get('/api/admin/conversations', adminMiddleware, async (req, res) => {
  const { rows } = await query(`
    SELECT c.id, u1.username as user1, u2.username as user2, c.last_message_at,
      (SELECT COUNT(*) FROM dm_messages WHERE conversation_id=c.id) as message_count
    FROM dm_conversations c
    JOIN users u1 ON c.user1_id=u1.id
    JOIN users u2 ON c.user2_id=u2.id
    ORDER BY c.last_message_at DESC LIMIT 200
  `);
  res.json(rows);
});

app.get('/api/admin/conversations/:id/messages', adminMiddleware, async (req, res) => {
  const { rows } = await query(`
    SELECT m.*, u.username as sender_username
    FROM dm_messages m JOIN users u ON m.sender_id=u.id
    WHERE m.conversation_id=$1 ORDER BY m.created_at ASC
  `, [req.params.id]);
  res.json(rows);
});

app.use((err, req, res, next) => {
  if (req.path.startsWith('/api/')) {
    const status = err.status || 500;
    const message = err.message || 'Sunucu hatası';
    return res.status(status).json({ error: message });
  }
  next(err);
});

// ===================================================================
// MAĞAZA (STORE) API ROUTES - server.js'ye eklenecek
// adminMiddleware, authMiddleware ve query zaten tanımlı
// ===================================================================

// ---- YARDIMCI: Shopier imzası oluştur ----
function shopierSign(randomNr, amount, currency, orderId, apiSecret) {
  const crypto = require('crypto');
  const msg = String(randomNr) + String(amount) + String(currency) + String(orderId);
  return crypto.createHmac('sha256', apiSecret).update(msg).digest('base64');
}

// ---- Üyelik verme / alma ----
async function grantMembership(userId, type) {
  if (type === 'vip') await query('UPDATE users SET is_vip=1 WHERE id=$1', [userId]);
  else if (type === 'plus') await query('UPDATE users SET is_plus=1 WHERE id=$1', [userId]);
  else if (type === 'admin') await query('UPDATE users SET is_admin=1, admin_since=NOW() WHERE id=$1', [userId]);
}

async function revokeMembership(userId, type) {
  if (type === 'vip') await query('UPDATE users SET is_vip=0 WHERE id=$1', [userId]);
  else if (type === 'plus') await query('UPDATE users SET is_plus=0 WHERE id=$1', [userId]);
  else if (type === 'admin') await query('UPDATE users SET is_admin=0, admin_since=NULL WHERE id=$1', [userId]);
}

// ---- Süresi geçmiş abonelikleri kontrol et ve iptal et ----
async function expireSubscriptions() {
  try {
    const { rows } = await query(
      `SELECT s.*, u.id as uid FROM subscriptions s
       JOIN users u ON s.user_id = u.id
       WHERE s.is_active=1 AND s.expires_at < NOW()`
    );
    for (const sub of rows) {
      // Bu tipteki başka aktif abonelik var mı?
      const { rows: others } = await query(
        `SELECT id FROM subscriptions WHERE user_id=$1 AND type=$2 AND is_active=1 AND id!=$3 AND expires_at >= NOW()`,
        [sub.user_id, sub.type, sub.id]
      );
      await query('UPDATE subscriptions SET is_active=0 WHERE id=$1', [sub.id]);
      if (!others.length) await revokeMembership(sub.user_id, sub.type);
    }
  } catch(e) { console.error('expireSubscriptions error:', e.message); }
}

// Her dakika abonelik kontrolü
setInterval(expireSubscriptions, 60 * 1000);

// ===== PUBLIC: Ürünleri listele =====
app.get('/api/shop/products', async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT * FROM store_products WHERE visible=1 ORDER BY sort_order ASC, id ASC'
    );
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ===== AUTH: Aboneliklerimi getir =====
app.get('/api/shop/my-subscriptions', authMiddleware, async (req, res) => {
  try {
    await expireSubscriptions();
    const { rows } = await query(
      `SELECT s.*, p.name as product_name, p.description, p.features, p.badge_color, p.badge_icon
       FROM subscriptions s
       LEFT JOIN store_products p ON s.product_id = p.id
       WHERE s.user_id=$1 AND s.is_active=1 AND s.expires_at >= NOW()
       ORDER BY s.expires_at ASC`,
      [req.user.id]
    );
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ===== AUTH: Ödeme başlat (Shopier) =====
app.post('/api/shop/checkout', authMiddleware, async (req, res) => {
  try {
    const { product_id, music_ad_code } = req.body || {};
    if (!product_id) return res.status(400).json({ error: 'Ürün ID gerekli' });

    const { rows: prods } = await query('SELECT * FROM store_products WHERE id=$1 AND visible=1', [product_id]);
    if (!prods.length) return res.status(404).json({ error: 'Ürün bulunamadı' });
    const product = prods[0];
    if (product.type === 'ad_boost') {
      if (!/^\d{6}$/.test(String(music_ad_code || ''))) return res.status(400).json({ error: 'Boost için 6 haneli reklam kodu gerekli.' });
      const { rows: ads } = await query('SELECT id FROM music_ads WHERE portal_code=$1 AND active=1', [String(music_ad_code)]);
      if (!ads.length) return res.status(404).json({ error: 'Aktif reklam bulunamadı.' });
    }

    // Shopier ayarlarını al
    const { rows: settRows } = await query(
      "SELECT key, value FROM settings WHERE key IN ('shopier_api_key','shopier_api_secret','shopier_website_index','shopier_enabled')"
    );
    const setts = Object.fromEntries(settRows.map(r => [r.key, r.value]));

    if (setts.shopier_enabled !== '1') {
      return res.status(502).json({ error: 'Ödeme sistemi şu an aktif değil. Lütfen site yöneticisiyle iletişime geçin.' });
    }
    if (!setts.shopier_api_key || !setts.shopier_api_secret) {
      return res.status(502).json({ error: 'Ödeme sistemi yapılandırılmamış.' });
    }

    // Sipariş oluştur
    const platformOrderId = 'ORD-' + Date.now() + '-' + req.user.id;
    await query(
      `INSERT INTO store_orders (user_id, product_id, product_name, product_type, amount, currency, status, platform_order_id, payment_data)
       VALUES ($1,$2,$3,$4,$5,'TRY','pending',$6,$7)`,
      [req.user.id, product.id, product.name, product.type, product.price, platformOrderId, JSON.stringify({ music_ad_code: music_ad_code || '' })]
    );

    const randomNr = Math.floor(Math.random() * 999999) + 100000;
    const amount = Number(product.price).toFixed(2);
    const signature = shopierSign(randomNr, amount, 'TRY', platformOrderId, setts.shopier_api_secret);

    const siteUrl = process.env.SITE_URL || ('https://' + (req.headers.host || 'localhost'));
    const callbackUrl = siteUrl + '/api/shop/webhook';
    const returnUrl = siteUrl + '/magaza?durum=basarili';
    const failUrl = siteUrl + '/magaza?durum=basarisiz';

    // Shopier'a POST isteği gönder, ödeme linki al
    const https = require('https');
    const querystring = require('querystring');
    const postData = querystring.stringify({
      API_key: setts.shopier_api_key,
      website_index: setts.shopier_website_index || '1',
      platform_order_id: platformOrderId,
      product_name: product.name,
      product_type: '0',
      buyer_name: req.user.username,
      buyer_email: req.user.email,
      buyer_account_age: '1',
      buyer_id_nr: String(req.user.id),
      product_count: '1',
      total_order_value: amount,
      currency: 'TRY',
      platform: '0',
      is_in_frame: '0',
      current_language: '0',
      callback_url: callbackUrl,
      return_url: returnUrl,
      cancel_url: failUrl,
      random_nr: String(randomNr),
      signature: signature
    });

    const shopierRes = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'www.shopier.com',
        path: '/ShowProduct/api_pay4.php',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData)
        }
      };
      const reqShopier = https.request(options, r => {
        let data = '';
        r.on('data', chunk => data += chunk);
        r.on('end', () => resolve({ status: r.statusCode, body: data }));
      });
      reqShopier.on('error', reject);
      reqShopier.write(postData);
      reqShopier.end();
    });

    if (shopierRes.status !== 200) {
      return res.status(502).json({ error: 'Shopier bağlantı hatası: ' + shopierRes.body });
    }

    // Shopier cevabı: ödeme URL'si
    const shopierData = shopierRes.body.trim();
    // Shopier API bazen direkt URL, bazen JSON döner
    let paymentUrl = '';
    try {
      const parsed = JSON.parse(shopierData);
      paymentUrl = parsed.url || parsed.payment_url || '';
    } catch {
      // Direkt URL olabilir
      if (shopierData.startsWith('http')) paymentUrl = shopierData;
    }

    if (!paymentUrl) {
      return res.status(502).json({ error: 'Ödeme linki alınamadı: ' + shopierData });
    }

    await logAction(req.user.username, 'shop_checkout_start', product.type, platformOrderId, getIp(req));
    res.json({ payment_url: paymentUrl, order_id: platformOrderId });
  } catch(e) {
    console.error('checkout error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ===== WEBHOOK: Shopier ödeme callback =====
app.post('/api/shop/webhook', express.urlencoded({ extended: true }), async (req, res) => {
  try {
    const { platform_order_id, status, signature, random_nr, total_order_value, currency, shopier_order_id } = req.body;

    if (!platform_order_id) return res.status(400).send('missing order id');

    // İmza doğrula
    const { rows: settRows } = await query(
      "SELECT key, value FROM settings WHERE key IN ('shopier_api_secret','shopier_enabled')"
    );
    const setts = Object.fromEntries(settRows.map(r => [r.key, r.value]));

    if (setts.shopier_enabled !== '1') return res.status(200).send('disabled');

    // Shopier imza doğrulama: HMAC-SHA256(random_nr + total_order_value + currency + platform_order_id)
    const expectedSig = shopierSign(random_nr, total_order_value, currency, platform_order_id, setts.shopier_api_secret);
    if (signature !== expectedSig) {
      console.warn('[SHOPIER] Invalid signature for order:', platform_order_id);
      return res.status(400).send('invalid signature');
    }

    const { rows: orders } = await query('SELECT * FROM store_orders WHERE platform_order_id=$1', [platform_order_id]);
    if (!orders.length) return res.status(404).send('order not found');
    const order = orders[0];

    // Zaten işlendi mi?
    if (order.status === 'completed') return res.status(200).send('already completed');

    if (status === '1' || status === 1) {
      // Ödeme başarılı
      await query(
        `UPDATE store_orders SET status='completed', shopier_order_id=$1, updated_at=NOW(), payment_data=$2 WHERE id=$3`,
        [shopier_order_id || '', JSON.stringify(req.body), order.id]
      );

      // Kullanıcıya üyelik ver
      const { rows: prods } = await query('SELECT * FROM store_products WHERE id=$1', [order.product_id]);
      const durDays = prods.length ? prods[0].duration_days : 30;
      const expiresAt = new Date(Date.now() + durDays * 24 * 3600 * 1000);

      const orderMeta = (() => { try { return JSON.parse(order.payment_data || '{}'); } catch { return {}; } })();
      if (order.product_type === 'ad_boost' && orderMeta.music_ad_code) {
        await query('UPDATE music_ads SET boost_points=boost_points+$1, updated_at=NOW() WHERE portal_code=$2', [Math.max(1, durDays || 30), orderMeta.music_ad_code]);
        await logAction('system', 'music_ad_boost_complete', orderMeta.music_ad_code, 'user:' + order.user_id, '');
        return res.status(200).send('OK');
      }

      const { rows: newSub } = await query(
        `INSERT INTO subscriptions (user_id, product_id, type, expires_at, is_active, order_id)
         VALUES ($1,$2,$3,$4,1,$5) RETURNING id`,
        [order.user_id, order.product_id, order.product_type, expiresAt, order.id]
      );
      await grantMembership(order.user_id, order.product_type);

      // Kullanıcıya bildirim gönder
      await query(
        `INSERT INTO notifications (user_id, type, content, link) VALUES ($1,'purchase',$2,'/profil')`,
        [order.user_id, `${order.product_name} üyeliğiniz aktif edildi! ${durDays} gün boyunca geçerlidir.`]
      );

      await logAction('system', 'shop_purchase_complete', order.product_type, 'user:' + order.user_id, '');
      res.status(200).send('OK');
    } else {
      // Ödeme başarısız
      await query(`UPDATE store_orders SET status='failed', updated_at=NOW() WHERE id=$1`, [order.id]);
      await logAction('system', 'shop_purchase_failed', order.product_type, 'user:' + order.user_id, '');
      res.status(200).send('OK');
    }
  } catch(e) {
    console.error('[SHOPIER WEBHOOK ERROR]', e);
    res.status(500).send('server error');
  }
});

// ===== ADMIN: Mağaza ürünlerini listele =====
app.get('/api/admin/shop/products', adminMiddleware, async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM store_products ORDER BY sort_order ASC, id ASC');
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ===== ADMIN: Ürün oluştur =====
app.post('/api/admin/shop/products', adminMiddleware, async (req, res) => {
  try {
    const { name, description, features, type, price, original_price, duration_days, visible, badge_color, badge_icon, sort_order } = req.body;
    if (!name || !type || price === undefined) return res.status(400).json({ error: 'İsim, tür ve fiyat zorunlu' });
    if (!['vip','plus','admin'].includes(type)) return res.status(400).json({ error: 'Geçersiz tür' });
    const { rows } = await query(
      `INSERT INTO store_products (name, description, features, type, price, original_price, duration_days, visible, badge_color, badge_icon, sort_order, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW()) RETURNING *`,
      [name, description||'', JSON.stringify(Array.isArray(features)?features:[]),
       type, Number(price), original_price?Number(original_price):null,
       duration_days||30, visible?1:0, badge_color||'#fbbf24', badge_icon||'fas fa-gem', sort_order||0]
    );
    await logAction('admin', 'shop_create_product', type, name, '');
    res.json(rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ===== ADMIN: Ürün güncelle =====
app.put('/api/admin/shop/products/:id', adminMiddleware, async (req, res) => {
  try {
    const { rows: existing } = await query('SELECT * FROM store_products WHERE id=$1', [req.params.id]);
    if (!existing.length) return res.status(404).json({ error: 'Ürün bulunamadı' });
    const p = existing[0];
    const { name, description, features, type, price, original_price, duration_days, visible, badge_color, badge_icon, sort_order } = req.body;
    const { rows } = await query(
      `UPDATE store_products SET
        name=$1, description=$2, features=$3, type=$4, price=$5, original_price=$6,
        duration_days=$7, visible=$8, badge_color=$9, badge_icon=$10, sort_order=$11, updated_at=NOW()
       WHERE id=$12 RETURNING *`,
      [name??p.name, description??p.description,
       features!==undefined?JSON.stringify(Array.isArray(features)?features:[]):p.features,
       type??p.type, price!==undefined?Number(price):p.price,
       original_price!==undefined?(original_price?Number(original_price):null):p.original_price,
       duration_days??p.duration_days, visible!==undefined?(visible?1:0):p.visible,
       badge_color??p.badge_color, badge_icon??p.badge_icon, sort_order??p.sort_order, p.id]
    );
    await logAction('admin', 'shop_update_product', rows[0].type, rows[0].name, '');
    res.json(rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ===== ADMIN: Ürün sil =====
app.delete('/api/admin/shop/products/:id', adminMiddleware, async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM store_products WHERE id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Ürün bulunamadı' });
    await query('DELETE FROM store_products WHERE id=$1', [req.params.id]);
    await logAction('admin', 'shop_delete_product', rows[0].type, rows[0].name, '');
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ===== ADMIN: Siparişleri listele =====
app.get('/api/admin/shop/orders', adminMiddleware, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit)||100, 500);
    const status = req.query.status;
    let q = `SELECT o.*, u.username, u.email FROM store_orders o
             LEFT JOIN users u ON o.user_id = u.id`;
    const params = [];
    if (status) { q += ` WHERE o.status=$1`; params.push(status); }
    q += ' ORDER BY o.created_at DESC LIMIT $' + (params.length + 1);
    params.push(limit);
    const { rows } = await query(q, params);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ===== ADMIN: Sipariş durumu güncelle =====
app.put('/api/admin/shop/orders/:id', adminMiddleware, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['pending','completed','failed','refunded'].includes(status)) return res.status(400).json({ error: 'Geçersiz durum' });
    const { rows: existing } = await query('SELECT * FROM store_orders WHERE id=$1', [req.params.id]);
    if (!existing.length) return res.status(404).json({ error: 'Sipariş bulunamadı' });
    const order = existing[0];
    await query(`UPDATE store_orders SET status=$1, updated_at=NOW() WHERE id=$2`, [status, order.id]);

    // Eğer tamamlandı olarak işaretleniyorsa ve önceden değilse, üyelik ver
    if (status === 'completed' && order.status !== 'completed') {
      const { rows: prods } = await query('SELECT * FROM store_products WHERE id=$1', [order.product_id]);
      const durDays = prods.length ? prods[0].duration_days : 30;
      const expiresAt = new Date(Date.now() + durDays * 24 * 3600 * 1000);
      await query(
        `INSERT INTO subscriptions (user_id, product_id, type, expires_at, is_active, order_id)
         VALUES ($1,$2,$3,$4,1,$5)`,
        [order.user_id, order.product_id, order.product_type, expiresAt, order.id]
      );
      await grantMembership(order.user_id, order.product_type);
    }
    // Eğer iptal edildiyse ve önceden tamamlandıysa, üyelik geri al
    if (status === 'refunded' && order.status === 'completed') {
      await query(`UPDATE subscriptions SET is_active=0 WHERE order_id=$1`, [order.id]);
      const { rows: others } = await query(
        `SELECT id FROM subscriptions WHERE user_id=$1 AND type=$2 AND is_active=1 AND expires_at >= NOW()`,
        [order.user_id, order.product_type]
      );
      if (!others.length) await revokeMembership(order.user_id, order.product_type);
    }

    await logAction('admin', 'shop_update_order_status', status, 'order:' + order.id, '');
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ===== ADMIN: Shopier ayarlarını getir =====
app.get('/api/admin/shop/settings', adminMiddleware, async (req, res) => {
  try {
    const keys = ['shopier_api_key','shopier_api_secret','shopier_website_index','shopier_enabled'];
    const { rows } = await query('SELECT key, value FROM settings WHERE key = ANY($1)', [keys]);
    res.json(Object.fromEntries(rows.map(r => [r.key, r.value])));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ===== ADMIN: Shopier ayarlarını kaydet =====
app.post('/api/admin/shop/settings', adminMiddleware, async (req, res) => {
  try {
    const allowed = ['shopier_api_key','shopier_api_secret','shopier_website_index','shopier_enabled'];
    for (const [key, value] of Object.entries(req.body)) {
      if (!allowed.includes(key)) continue;
      await query('INSERT INTO settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', [key, String(value)]);
    }
    await logAction('admin', 'shop_settings_update', '', '', '');
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ===== ADMIN: Abonelikleri listele =====
app.get('/api/admin/shop/subscriptions', adminMiddleware, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT s.*, u.username, p.name as product_name FROM subscriptions s
       LEFT JOIN users u ON s.user_id = u.id
       LEFT JOIN store_products p ON s.product_id = p.id
       ORDER BY s.created_at DESC LIMIT 200`
    );
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ===== BAŞLAT =====

// ===== KULLANICININ SİPARİŞ GEÇMİŞİ =====
app.get('/api/shop/my-orders', authMiddleware, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT o.*, p.name as product_name, p.badge_icon, p.badge_color
       FROM store_orders o
       LEFT JOIN store_products p ON o.product_id = p.id
       WHERE o.user_id = $1
       ORDER BY o.created_at DESC
       LIMIT 50`,
      [req.user.id]
    );
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ===== SPA FALLBACK — Tüm API dışı route'lar index.html'e yönlendirilir =====
// ===== MÜZİK SES REKLAMLARI =====
function newMusicAdPortalCode() { return String(Math.floor(100000 + Math.random() * 900000)); }
function isAdFreeUser(user) { return !!(user && (user.is_vip || user.is_plus)); }
async function pickMusicAd() {
  const { rows } = await query(`SELECT a.*, (SELECT COUNT(*) FROM music_ads WHERE active=1) AS ad_total
    FROM music_ads a WHERE a.active=1 ORDER BY a.boost_points DESC, a.priority DESC, a.created_at ASC LIMIT 1`);
  return rows[0] || null;
}

app.get('/api/music-ads/pending', authMiddleware, async (req, res) => {
  try {
    if (isAdFreeUser(req.user)) return res.json({ ad: null });
    const { rows } = await query(`SELECT a.*, (SELECT COUNT(*) FROM music_ads WHERE active=1) AS ad_total FROM music_ad_states s JOIN music_ads a ON a.id=s.pending_ad_id
      WHERE s.user_id=$1 AND a.active=1`, [req.user.id]);
    res.json({ ad: rows[0] || null });
  } catch (e) { res.status(500).json({ error:e.message }); }
});
app.post('/api/music-ads/song-finished', authMiddleware, async (req, res) => {
  try {
    if (isAdFreeUser(req.user)) return res.json({ ad:null, songs_until_ad:null });
    const state = (await query('SELECT * FROM music_ad_states WHERE user_id=$1', [req.user.id])).rows[0];
    if (state?.pending_ad_id) {
      const { rows } = await query('SELECT a.*, (SELECT COUNT(*) FROM music_ads WHERE active=1) AS ad_total FROM music_ads a WHERE a.id=$1 AND a.active=1', [state.pending_ad_id]);
      return res.json({ ad:rows[0] || null, songs_until_ad:0 });
    }
    const completed = (state?.completed_song_count || 0) + 1;
    const ad = completed >= 2 ? await pickMusicAd() : null;
    await query(`INSERT INTO music_ad_states (user_id,completed_song_count,pending_ad_id,updated_at) VALUES ($1,$2,$3,NOW())
      ON CONFLICT (user_id) DO UPDATE SET completed_song_count=EXCLUDED.completed_song_count,pending_ad_id=EXCLUDED.pending_ad_id,updated_at=NOW()`,
      [req.user.id, ad ? 0 : completed, ad?.id || null]);
    res.json({ ad, songs_until_ad:ad ? 0 : 2-completed });
  } catch (e) { res.status(500).json({ error:e.message }); }
});
app.post('/api/music-ads/:id/start', authMiddleware, async (req, res) => {
  try {
    if (isAdFreeUser(req.user)) return res.json({ ok:true });
    const { rows } = await query(`UPDATE music_ad_states SET ad_started_at=COALESCE(ad_started_at,NOW()),updated_at=NOW()
      WHERE user_id=$1 AND pending_ad_id=$2 RETURNING ad_started_at`, [req.user.id,req.params.id]);
    if (!rows.length) return res.status(403).json({ error:'Bu reklam oynatma sıranızda değil.' });
    await query('UPDATE music_ads SET play_count=play_count+1 WHERE id=$1', [req.params.id]);
    res.json({ ok:true });
  } catch(e) { res.status(500).json({ error:e.message }); }
});
app.post('/api/music-ads/:id/complete', authMiddleware, async (req, res) => {
  try {
    const { rows } = await query(`UPDATE music_ad_states SET pending_ad_id=NULL,ad_started_at=NULL,completed_song_count=0,updated_at=NOW()
      WHERE user_id=$1 AND pending_ad_id=$2 RETURNING user_id`, [req.user.id,req.params.id]);
    if (!rows.length && !isAdFreeUser(req.user)) return res.status(403).json({ error:'Reklam tamamlanamadı.' });
    res.json({ ok:true });
  } catch(e) { res.status(500).json({ error:e.message }); }
});
app.post('/api/music-ads/:id/click', async (req,res) => {
  try { await query('UPDATE music_ads SET click_count=click_count+1 WHERE id=$1 AND active=1',[req.params.id]); res.json({ok:true}); }
  catch(e) { res.status(500).json({error:e.message}); }
});

// ===== VIDEOS / REALS =====
function makeVideoSlug(title, id) {
  const base = slugify(title || 'reals', { lower: true, strict: false, locale: 'tr', replacement: '-' })
    .replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'reals';
  return `${base}-${id}`;
}

const videoSelect = `SELECT v.*, v.thumbnail_url AS banner_image, u.username, u.avatar, u.avatar_removed,
  (SELECT COUNT(*) FROM video_likes vl WHERE vl.video_id=v.id) AS like_count,
  (SELECT COUNT(*) FROM video_comments vc WHERE vc.video_id=v.id) AS comment_count
  FROM videos v LEFT JOIN users u ON u.id=v.user_id`;

app.get('/api/videos', optionalAuth, async (req, res) => {
  const { rows } = await query(`${videoSelect} ORDER BY v.created_at DESC LIMIT 100`);
  res.json(rows);
});

app.get('/api/reals', optionalAuth, async (req, res) => {
  const { rows } = await query(`${videoSelect} WHERE v.is_reals=1 ORDER BY v.created_at DESC LIMIT 100`);
  res.json(rows);
});

app.get('/api/reals-settings', async (req, res) => {
  res.json({ reminder: 'Evet, reals. Reels olmasını beklerdiniz. Ama reals işte. Gerçekler var burada.' });
});

app.get('/api/video-settings', async (req, res) => {
  res.json({ defaultDescription: '', emptyDescriptionText: 'Bu videoya bir açıklama eklenmemiş.', uploadSuccessText: 'YÜKLENDİ', uploadSuccessDuration: '3' });
});

app.get('/api/video/:slug', optionalAuth, async (req, res) => {
  const { rows } = await query(`${videoSelect} WHERE v.slug=$1`, [req.params.slug]);
  if (!rows.length) return res.status(404).json({ error: 'Video bulunamadı' });
  res.json(rows[0]);
});

app.post('/api/videos', authMiddleware, async (req, res) => {
  const { title, description, video_url, banner_image, location, sound_name, allow_comments, show_likes, is_reals } = req.body;
  if (!title?.trim() || !video_url) return res.status(400).json({ error: 'Başlık ve video gerekli' });
    const provisionalSlug = makeVideoSlug(title, uuidv4().slice(0, 8));
  const { rows } = await query(`INSERT INTO videos (user_id,title,description,video_url,thumbnail_url,location,sound_name,allow_comments,show_likes,is_reals,slug)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`, [req.user.id, title.trim(), description || '', video_url, banner_image || '', location || '', sound_name || '', allow_comments === false ? 0 : 1, show_likes === false ? 0 : 1, is_reals ? 1 : 0, provisionalSlug]);
  const slug = makeVideoSlug(title, rows[0].id);
  await query('UPDATE videos SET slug=$1 WHERE id=$2', [slug, rows[0].id]);
  res.json({ slug, id: rows[0].id });
});

app.put('/api/video/:slug', authMiddleware, async (req, res) => {
  const { rows } = await query('SELECT * FROM videos WHERE slug=$1', [req.params.slug]);
  if (!rows.length) return res.status(404).json({ error: 'Video bulunamadı' });
  if (rows[0].user_id !== req.user.id && !req.user.is_admin) return res.status(403).json({ error: 'Bu videoyu düzenleme yetkiniz yok' });
  const b = req.body;
  await query(`UPDATE videos SET title=$1,description=$2,video_url=$3,thumbnail_url=$4,location=$5,sound_name=$6,allow_comments=$7,show_likes=$8,is_reals=$9 WHERE id=$10`,
    [b.title?.trim() || rows[0].title, b.description ?? rows[0].description, b.video_url || rows[0].video_url, b.banner_image ?? rows[0].thumbnail_url, b.location ?? rows[0].location, b.sound_name ?? rows[0].sound_name, b.allow_comments === undefined ? rows[0].allow_comments : (b.allow_comments ? 1 : 0), b.show_likes === undefined ? rows[0].show_likes : (b.show_likes ? 1 : 0), b.is_reals === undefined ? rows[0].is_reals : (b.is_reals ? 1 : 0), rows[0].id]);
  res.json({ ok: true });
});

app.post('/api/video/:id/view', async (req, res) => {
  await query('UPDATE videos SET views=COALESCE(views,0)+1 WHERE id=$1 OR slug=$1', [req.params.id]);
  res.json({ ok: true });
});

app.post('/api/video/:id/like', authMiddleware, async (req, res) => {
  const { rows: existing } = await query('SELECT id FROM video_likes WHERE video_id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  if (existing.length) await query('DELETE FROM video_likes WHERE id=$1', [existing[0].id]);
  else await query('INSERT INTO video_likes (video_id,user_id) VALUES ($1,$2)', [req.params.id, req.user.id]);
  const { rows } = await query('SELECT COUNT(*)::int AS count FROM video_likes WHERE video_id=$1', [req.params.id]);
  res.json({ liked: !existing.length, like_count: rows[0].count });
});

app.get('/api/video/:slug/liked', authMiddleware, async (req, res) => {
  const { rows } = await query('SELECT 1 FROM video_likes vl JOIN videos v ON v.id=vl.video_id WHERE v.slug=$1 AND vl.user_id=$2', [req.params.slug, req.user.id]);
  res.json({ liked: !!rows.length });
});

app.post('/api/video/:slug/save', authMiddleware, async (req, res) => {
  const { rows: video } = await query('SELECT id FROM videos WHERE slug=$1', [req.params.slug]);
  if (!video.length) return res.status(404).json({ error: 'Video bulunamadı' });
  const { rows: existing } = await query('SELECT id FROM video_saves WHERE video_id=$1 AND user_id=$2', [video[0].id, req.user.id]);
  if (existing.length) await query('DELETE FROM video_saves WHERE id=$1', [existing[0].id]);
  else await query('INSERT INTO video_saves (video_id,user_id) VALUES ($1,$2)', [video[0].id, req.user.id]);
  res.json({ saved: !existing.length });
});

app.get('/api/video/:slug/saved', authMiddleware, async (req, res) => {
  const { rows } = await query('SELECT 1 FROM video_saves s JOIN videos v ON v.id=s.video_id WHERE v.slug=$1 AND s.user_id=$2', [req.params.slug, req.user.id]);
  res.json({ saved: !!rows.length });
});

app.get('/api/video/:slug/comments', async (req, res) => {
  const { rows } = await query(`SELECT c.*,u.username,u.avatar,u.avatar_removed FROM video_comments c JOIN videos v ON v.id=c.video_id JOIN users u ON u.id=c.user_id WHERE v.slug=$1 ORDER BY c.created_at ASC`, [req.params.slug]);
  res.json(rows);
});

app.post('/api/video/:slug/comments', authMiddleware, async (req, res) => {
  const content = String(req.body.content || '').trim();
  const { rows: video } = await query('SELECT id,allow_comments FROM videos WHERE slug=$1', [req.params.slug]);
  if (!video.length) return res.status(404).json({ error: 'Video bulunamadı' });
  if (video[0].allow_comments !== 1) return res.status(403).json({ error: 'Yorumlar kapalı' });
  if (!content) return res.status(400).json({ error: 'Yorum boş olamaz' });
  const { rows } = await query('INSERT INTO video_comments (video_id,user_id,content) VALUES ($1,$2,$3) RETURNING *', [video[0].id, req.user.id, content.slice(0, 1000)]);
  res.json({ ...rows[0], username: req.user.username, avatar: req.user.avatar });
});

app.delete('/api/video/:slug', authMiddleware, async (req, res) => {
  const { rows } = await query('SELECT id,user_id FROM videos WHERE slug=$1', [req.params.slug]);
  if (!rows.length) return res.status(404).json({ error: 'Video bulunamadı' });
  if (rows[0].user_id !== req.user.id && !req.user.is_admin) return res.status(403).json({ error: 'Yetkiniz yok' });
  await query('DELETE FROM videos WHERE id=$1', [rows[0].id]);
  res.json({ ok: true });
});

app.get('/api/admin/music-ads', adminMiddleware, async (req,res) => {
  const { rows } = await query('SELECT * FROM music_ads ORDER BY boost_points DESC,priority DESC,created_at DESC'); res.json(rows);
});
app.post('/api/admin/music-ads', adminMiddleware, upload.fields([{name:'audio',maxCount:1},{name:'cover',maxCount:1}]), async (req,res) => {
  try {
    const b=req.body, audio_url=req.files?.audio?.[0] ? await handleUpload(req.files.audio[0]) : '', cover_url=req.files?.cover?.[0] ? await handleUpload(req.files.cover[0]) : '';
    if (!b.title?.trim() || !audio_url) return res.status(400).json({error:'Başlık ve ses dosyası zorunlu.'});
    let code=newMusicAdPortalCode(); while ((await query('SELECT id FROM music_ads WHERE portal_code=$1',[code])).rows.length) code=newMusicAdPortalCode();
    const {rows}=await query(`INSERT INTO music_ads (portal_code,title,site_url,audio_url,cover_url,priority,boost_points,active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [code,b.title.trim(),b.site_url||'',audio_url,cover_url,parseInt(b.priority)||0,parseInt(b.boost_points)||0,b.active==='false'?0:1]);
    res.json(rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});
app.put('/api/admin/music-ads/:id', adminMiddleware, upload.fields([{name:'audio',maxCount:1},{name:'cover',maxCount:1}]), async (req,res) => {
  try {
    const old=(await query('SELECT * FROM music_ads WHERE id=$1',[req.params.id])).rows[0]; if(!old) return res.status(404).json({error:'Reklam bulunamadı.'});
    const b=req.body, audio=req.files?.audio?.[0] ? await handleUpload(req.files.audio[0]) : old.audio_url, cover=req.files?.cover?.[0] ? await handleUpload(req.files.cover[0]) : old.cover_url;
    const {rows}=await query(`UPDATE music_ads SET title=$1,site_url=$2,audio_url=$3,cover_url=$4,priority=$5,boost_points=$6,active=$7,updated_at=NOW() WHERE id=$8 RETURNING *`,
      [b.title?.trim()||old.title,b.site_url??old.site_url,audio,cover,b.priority??old.priority,b.boost_points??old.boost_points,b.active===undefined?old.active:(b.active==='false'?0:1),old.id]); res.json(rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});
app.delete('/api/admin/music-ads/:id', adminMiddleware, async (req,res) => { await query('DELETE FROM music_ads WHERE id=$1',[req.params.id]); res.json({ok:true}); });

// 6 haneli kod reklamverenin gizli panel anahtarıdır.
app.get('/api/reklampanel/:code', async (req,res) => { const {rows}=await query('SELECT * FROM music_ads WHERE portal_code=$1',[req.params.code]); if(!rows.length)return res.status(404).json({error:'Reklam kodu bulunamadı.'}); res.json(rows[0]); });
app.put('/api/reklampanel/:code', upload.fields([{name:'audio',maxCount:1},{name:'cover',maxCount:1}]), async (req,res) => {
  try { const old=(await query('SELECT * FROM music_ads WHERE portal_code=$1',[req.params.code])).rows[0]; if(!old)return res.status(404).json({error:'Reklam kodu bulunamadı.'}); const b=req.body;
    const audio=req.files?.audio?.[0] ? await handleUpload(req.files.audio[0]) : old.audio_url, cover=req.files?.cover?.[0] ? await handleUpload(req.files.cover[0]) : old.cover_url;
    const {rows}=await query('UPDATE music_ads SET title=$1,site_url=$2,audio_url=$3,cover_url=$4,updated_at=NOW() WHERE id=$5 RETURNING *',[b.title?.trim()||old.title,b.site_url??old.site_url,audio,cover,old.id]); res.json(rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

initDb().then(() => {
  return query(`CREATE TABLE IF NOT EXISTS photo_likes (
    id BIGSERIAL PRIMARY KEY,
    photo_id BIGINT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(photo_id, user_id)
  ); CREATE TABLE IF NOT EXISTS photo_comments (
    id BIGSERIAL PRIMARY KEY,
    photo_id BIGINT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
    user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
  ); CREATE TABLE IF NOT EXISTS photo_comment_likes (
    id BIGSERIAL PRIMARY KEY,
    comment_id BIGINT NOT NULL REFERENCES photo_comments(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(comment_id, user_id)
  )`).then(() => {
    app.listen(PORT, () => console.log(`CigCig çalışıyor: http://localhost:${PORT}`));
  });
}).catch(err => {
  console.error('DB başlatma hatası:', err);
  process.exit(1);
});
