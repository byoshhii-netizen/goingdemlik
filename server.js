require('dotenv').config();
const express = require('express');
const { randomUUID } = require('crypto');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const slugify = require('slugify');
const rateLimit = require('express-rate-limit');
const cloudinary = require('cloudinary').v2;
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { query, initDb } = require('./database');
const { hashPassword, verifyPassword, needsRehash } = require('./password');

function createPlaylistPublicId() {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(8);
  return 'id' + Array.from(bytes, byte => alphabet[byte % alphabet.length]).join('');
}

function profileRouteKey(username) {
  return String(username || '').toLocaleLowerCase('tr-TR')
    .replace(/[çğıöşüÇĞİÖŞÜ]/g, char => ({ ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', Ç: 'c', Ğ: 'g', İ: 'i', Ö: 'o', Ş: 's', Ü: 'u' }[char] || char))
    .replace(/[^a-z0-9]/g, '');
}

const profileRouteSql = "regexp_replace(translate(lower(username), 'çğıöşü', 'cgiosu'), '[^a-z0-9]', '', 'g')";

const app = express();
const PORT = process.env.PORT || 3000;
const VMB_PANEL_USERNAME = String(process.env.VMB_PANEL_USERNAME || 'Cambaz');
const VMB_PANEL_PASSWORD = String(process.env.VMB_PANEL_PASSWORD || '123123');

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
let UPLOAD_DIR = process.env.UPLOAD_DIR || '/data/uploads';
if (!USE_CLOUDINARY) {
  try {
    if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    fs.accessSync(UPLOAD_DIR, fs.constants.W_OK);
  } catch (e) {
    if (!process.env.UPLOAD_DIR) {
      UPLOAD_DIR = path.join(__dirname, 'persistent', 'uploads');
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      console.warn('Varsayılan upload klasörü kullanılamıyor; kalıcı klasöre geçildi:', e.message);
    } else {
      console.warn('Upload klasörü kullanılamıyor:', e.message);
    }
  }
}

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
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
  // Sesli arama geçici olarak kapalı; mikrofon erişimi açılmıyor.
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
const APP_SECRET = process.env.APP_SECRET || '';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const EMAIL_FROM = process.env.EMAIL_FROM || '';
if (!process.env.SITE_URL) {
  console.warn('[SEO] ⚠️  SITE_URL env ayarlanmamış! Railway panelinde: SITE_URL=https://cigcig.xyz');
}

app.use((req, res, next) => {
  const host = String(req.get('host') || '').toLowerCase().split(':')[0];
  const canonicalHost = new URL(SITE_URL).host.toLowerCase();
  if (host.endsWith('.railway.app') && host !== canonicalHost) {
    return res.redirect(301, `${SITE_URL}${req.originalUrl}`);
  }
  next();
});

// ===== RATE LIMITERS =====

function isContentCreationPath(requestPath) {
  return requestPath === '/forums' ||
    requestPath === '/books' ||
    requestPath === '/messages' ||
    /^\/forum\/[^/]+\/comments$/.test(requestPath) ||
    /^\/book\/[^/]+\/pages$/.test(requestPath) ||
    /^\/group\/[^/]+\/messages$/.test(requestPath) ||
    /^\/conversation\/[^/]+\/messages$/.test(requestPath);
}

// Genel API: dakikada 80 istek. İçerik üretim endpoint'leri bu sınıra dahil değildir.
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.API_RATE_LIMIT_MAX || 100000),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Çok fazla istek. Lütfen bekleyin.' },
  skip: (req) => req.path.startsWith('/uploads/') || isContentCreationPath(req.path),
});

// Auth: kullanıcıları gereksiz kilitlemeden brute-force denemelerini sınırla.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.AUTH_RATE_LIMIT_MAX || 100000),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Çok fazla giriş denemesi. 15 dakika bekleyin.' },
});

// Upload: dakikada 5 yükleme
const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.UPLOAD_RATE_LIMIT_MAX || 100000),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Çok fazla yükleme. Lütfen bekleyin.' },
});

const adminAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.ADMIN_AUTH_RATE_LIMIT_MAX || 100000),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Çok fazla admin giriş denemesi. 15 dakika bekleyin.' },
});
const vmbAdminAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.VMB_ADMIN_AUTH_RATE_LIMIT_MAX || 30),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Çok fazla VMB paneli giriş denemesi. Biraz bekleyin.' },
});

app.use('/api', generalLimiter);
app.use('/api/auth', authLimiter);
app.use(['/api/photos', '/api/stories', '/api/upload-video'], uploadLimiter);
app.use(['/api/admin/auth', '/api/reklampanel'], adminAuthLimiter);
app.use('/api/vmb-admin/auth', vmbAdminAuthLimiter);


function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function normalizeMediaFilter(value) {
  const allowed = ['none', 'vivid', 'warm', 'cool', 'mono', 'fade', 'dramatic'];
  return allowed.includes(String(value || 'none')) ? String(value || 'none') : 'none';
}

function getIp(req) {
  return (req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.ip || '').split(',')[0].trim();
}

function getClientInfo(req) {
  const userAgent = String(req.get('user-agent') || '').slice(0, 512);
  let operatingSystem = 'Bilinmiyor';
  if (/Windows/i.test(userAgent)) operatingSystem = 'Windows';
  else if (/Android/i.test(userAgent)) operatingSystem = 'Android';
  else if (/iPhone|iPad|iPod/i.test(userAgent)) operatingSystem = 'iOS';
  else if (/Mac OS X|Macintosh/i.test(userAgent)) operatingSystem = 'macOS';
  else if (/Linux/i.test(userAgent)) operatingSystem = 'Linux';
  let device = /Mobile|Android|iPhone|iPad|iPod/i.test(userAgent) ? 'Mobil' : 'Masaüstü';
  if (/Tablet|iPad/i.test(userAgent)) device = 'Tablet';
  const country = String(req.get('cf-ipcountry') || '').slice(0, 64);
  const city = String(req.get('cf-ipcity') || '').slice(0, 128);
  return { userAgent, device, operatingSystem, country, city };
}

async function recordContentView(contentType, contentId, req) {
  if (!['song', 'photo', 'story', 'reals', 'video'].includes(contentType)) return;
  const id = Number.parseInt(contentId, 10);
  if (!Number.isSafeInteger(id) || id < 1) return;
  await query(
    `INSERT INTO content_view_events(content_type,content_id,user_id,ip,user_agent)
     VALUES($1,$2,$3,$4,$5)`,
    [contentType, id, req.user?.id || null, getIp(req), String(req.get('user-agent') || '').slice(0, 512)]
  );
}

function normalizeSecurityAnswer(value) {
  return String(value || '').trim().toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ');
}

function hashChallengeValue(value) {
  return crypto.createHmac('sha256', APP_SECRET || 'cigcig-challenge-secret-change-me').update(String(value)).digest('hex');
}

function createChallengeToken() {
  return crypto.randomBytes(32).toString('hex');
}

function maskEmail(email) {
  const [local, domain] = String(email || '').split('@');
  if (!local || !domain) return 'gizli e-posta adresinize';
  const visible = local.length > 2 ? `${local[0]}${'*'.repeat(Math.max(1, local.length - 2))}${local.at(-1)}` : `${local[0]}*`;
  return `${visible}@${domain}`;
}

async function sendEmailCode(email, username, code) {
  if (!RESEND_API_KEY || !EMAIL_FROM || !APP_SECRET) throw new Error('E-posta servisi yapılandırılmamış');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: [email],
      subject: 'Doğrulama kodun',
      html: `<p>Merhaba ${escapeHtml(username)},</p><p>Doğrulama kodun:</p><p style="font-size:28px;font-weight:700;letter-spacing:8px">${code}</p><p>Bu kod 10 dakika geçerlidir. Kodu kimseyle paylaşma.</p>`
    })
  });
  if (!response.ok) throw new Error('Doğrulama e-postası gönderilemedi');
}

async function createTwoFactorChallenge(user, purpose = 'login') {
  const challenge = createChallengeToken();
  const method = user.two_factor_method || 'none';
  const code = method === 'email' ? String(crypto.randomInt(100000, 1000000)) : '';
  await query('DELETE FROM auth_challenges WHERE user_id=$1 OR expires_at <= NOW()', [user.id]);
  const verificationHash = method === 'question' ? user.two_factor_answer_hash : (code ? hashChallengeValue(code) : '');
  await query('INSERT INTO auth_challenges (challenge_hash,user_id,purpose,method,code_hash,expires_at) VALUES ($1,$2,$3,$4,$5,NOW()+INTERVAL \'10 minutes\')', [hashChallengeValue(challenge), user.id, purpose, method, verificationHash]);
  if (code) await sendEmailCode(user.email, user.username, code);
  return { challenge, method, question: method === 'question' ? user.two_factor_question : '', maskedEmail: method === 'email' ? maskEmail(user.email) : '' };
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

async function completeTwoFactorChallenge(challenge, value) {
  const { rows } = await query('SELECT * FROM auth_challenges WHERE challenge_hash=$1 AND expires_at > NOW() LIMIT 1', [hashChallengeValue(challenge)]);
  const record = rows[0];
  if (!record || record.attempts >= 5) return null;
  await query('UPDATE auth_challenges SET attempts=attempts+1 WHERE id=$1', [record.id]);
  const valid = record.method === 'email'
    ? hashChallengeValue(String(value || '').trim()) === record.code_hash
    : verifyPassword(normalizeSecurityAnswer(value), record.code_hash);
  if (!valid) return null;
  await query('DELETE FROM auth_challenges WHERE id=$1', [record.id]);
  const token = generateToken(record.user_id);
  await query('INSERT INTO sessions (token,user_id) VALUES ($1,$2)', [token, record.user_id]);
  return token;
}

function hasAdminPermission(permissions, name) {
  const value = permissions?.[name];
  return value === true || value === 1 || value === '1' || value === 'true';
}

function generateToken(userId) {
  return crypto.randomBytes(32).toString('hex');
}

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `cigcig_session=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/`);
}

function getSessionCookie(req) {
  const cookies = String(req.headers.cookie || '').split(';').map(value => value.trim());
  const session = cookies.find(value => value.startsWith('cigcig_session='));
  return session ? decodeURIComponent(session.slice('cigcig_session='.length)) : '';
}

function sanitizeUser(u) {
  if (!u) return null;
  const { password_hash, spotify_token, spotify_refresh, two_factor_answer_hash, email_verification_token_hash, email_verification_expires_at, ...rest } = u;
  return rest;
}

function isReservedVmbBadgeName(value) {
  const badge = String(value || '').trim().toLocaleLowerCase('tr-TR');
  return badge === 'vmb' || badge === 'vmb yönetim';
}

function hasVmbManagementBadge(user) {
  return String(user?.badge_name || '').trim().toLocaleLowerCase('tr-TR') === 'vmb yönetim';
}

function hasVmbBadge(user) {
  const badge = String(user?.badge_name || '').trim().toLocaleLowerCase('tr-TR');
  // Özel rozet eski kayıtlarda is_vmb alanından önce atanmış olabilir.
  // Rozet üyeliğin kendisi olduğu için iki kaynağı da uyumlu kabul et.
  return !!user && (Number(user.is_vmb) === 1 || badge === 'vmb' || badge === 'vmb yönetim');
}

function boolValue(value) {
  return value === true || value === 1 || value === '1' || value === 'true' ? 1 : 0;
}

function profileBadgeKey(type, id = '') {
  return type === 'custom' ? `custom:${id}` : type;
}

async function getUserProfileBadges(user, { includeInactive = false } = {}) {
  if (!user?.id) return [];

  const [customResult, preferenceResult, levelResult] = await Promise.all([
    query(`
      SELECT b.id, b.name, b.icon, b.color, ub.assigned_at
      FROM user_badges ub
      JOIN badges b ON b.id=ub.badge_id
      WHERE ub.user_id=$1 AND COALESCE(b.is_hidden,0)=0
      ORDER BY ub.assigned_at DESC NULLS LAST, ub.id DESC
    `, [user.id]),
    query('SELECT badge_key, is_active FROM user_badge_visibility WHERE user_id=$1', [user.id]),
    query('SELECT id, name, icon, color FROM levels WHERE id=$1', [user.level_id]),
  ]);

  const preferences = new Map(preferenceResult.rows.map(row => [row.badge_key, Number(row.is_active) !== 0]));
  const badges = [];
  const addBadge = (badge) => {
    if (!badge?.key || !badge.name) return;
    const isActive = badge.key === 'admin' ? true : (preferences.has(badge.key)
      ? preferences.get(badge.key)
      : (badge.key === 'level' ? Number(user.show_level_badge) !== 0 : true));
    if (includeInactive || isActive) badges.push({ ...badge, is_active: isActive });
  };

  const customNames = new Set();
  customResult.rows.forEach(row => {
    const normalizedName = String(row.name || '').trim().toLocaleLowerCase('tr-TR');
    customNames.add(normalizedName);
    addBadge({
      key: profileBadgeKey('custom', row.id),
      type: 'custom',
      name: row.name,
      icon: row.icon || '',
      color: row.color || '#6b7280',
      assigned_at: row.assigned_at,
    });
  });

  // Eski tekil rozet alanı, migrasyon çalışmadan önce oluşturulmuş kayıtlar için fallback'tir.
  const legacyName = String(user.badge_name || '').trim();
  const normalizedLegacyName = legacyName.toLocaleLowerCase('tr-TR');
  if (legacyName && !isReservedVmbBadgeName(legacyName) && !customNames.has(normalizedLegacyName)) {
    addBadge({
      key: `legacy:${normalizedLegacyName}`,
      type: 'custom',
      name: legacyName,
      icon: user.badge_icon || '',
      color: user.badge_color || '#6b7280',
    });
  }

  const level = levelResult.rows[0];
  if (level) addBadge({ key: 'level', type: 'level', name: level.name, icon: level.icon || 'fas fa-star', color: level.color || '#dc2626' });
  if (Number(user.is_vip) === 1) addBadge({ key: 'vip', type: 'vip', name: 'VIP', icon: 'fas fa-gem', color: '#fbbf24' });
  if (Number(user.is_plus) === 1) addBadge({ key: 'plus', type: 'plus', name: 'Plus', icon: 'fas fa-plus-circle', color: '#818cf8' });
  if (Number(user.is_admin) === 1) addBadge({ key: 'admin', type: 'admin', name: 'Yetkili', icon: 'fas fa-shield-halved', color: '#5865F2' });
  if (Number(user.is_artist) === 1) addBadge({ key: 'artist', type: 'artist', name: 'Artist', icon: 'fas fa-microphone-alt', color: '#a855f7' });
  if (hasVmbBadge(user)) {
    const isManager = hasVmbManagementBadge(user);
    addBadge({
      key: 'vmb',
      type: 'vmb',
      name: isManager ? 'VMB Yönetim' : 'VMB',
      icon: isManager ? 'fas fa-crown' : 'fas fa-shield-halved',
      color: isManager ? '#fbbf24' : '#facc15',
    });
  }

  return badges;
}

app.get('/api/link-preview', async (req, res) => {
  try {
    const rawUrl = String(req.query.url || '').trim();
    const parsed = new URL(rawUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) return res.status(400).json({ error: 'Geçersiz bağlantı' });
    if (['localhost', '127.0.0.1', '::1'].includes(parsed.hostname) || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(parsed.hostname)) {
      return res.status(400).json({ error: 'Bu bağlantı önizlenemez' });
    }
    const response = await fetch(parsed.href, { headers: { 'user-agent': 'CigCig Link Preview/1.0' }, redirect: 'follow', signal: AbortSignal.timeout(5000) });
    const type = response.headers.get('content-type') || '';
    if (type.startsWith('image/')) return res.json({ url: parsed.href, title: '', description: '', image: parsed.href, site: parsed.hostname, is_image: true });
    if (!type.includes('text/html')) return res.json({ url: parsed.href, title: parsed.hostname, description: '', image: '', site: parsed.hostname, is_image: false });
    const html = (await response.text()).slice(0, 500000);
    const getMeta = (property, name) => {
      const match = html.match(new RegExp(`<meta[^>]+(?:property|name)=["'](?:${property}|${name})["'][^>]+content=["']([^"']*)["']`, 'i'))
        || html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["'](?:${property}|${name})["']`, 'i'));
      return match ? match[1].replace(/&amp;/g, '&').trim() : '';
    };
    const title = getMeta('og:title', 'twitter:title') || (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/<[^>]+>/g, '').trim();
    const description = getMeta('og:description', 'twitter:description') || getMeta('description', 'description');
    const image = getMeta('og:image', 'twitter:image');
    const icon = getMeta('og:site_name', 'application-name') || parsed.hostname.replace(/^www\./, '');
    const absolute = value => { try { return value ? new URL(value, parsed.href).href : ''; } catch { return ''; } };
    res.json({ url: parsed.href, title: title.slice(0, 180), description: description.slice(0, 300), image: absolute(image), site: icon.slice(0, 80) });
  } catch (error) { res.json({ url: String(req.query.url || ''), title: '', description: '', image: '', site: '' }); }
});

function makeSlug(title, id) {
  const base = slugify(title, { lower: true, strict: false, locale: 'tr', replacement: '-' })
    .replace(/[^a-z0-9\-]/g, '').replace(/-+/g, '-').substring(0, 60);
  return base + '-' + id;
}

async function logAction(actor, action, target = '', detail = '', ip = '', clientInfo = {}) {
  await query('INSERT INTO system_logs (actor,action,target,detail,ip,user_agent,device,operating_system,country,city) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [actor, action, target, detail, ip, clientInfo.userAgent || '', clientInfo.device || '', clientInfo.operatingSystem || '', clientInfo.country || '', clientInfo.city || '']);
}

async function authMiddleware(req, res, next) {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Giriş gerekli' });
  const { rows } = await query('SELECT user_id FROM sessions WHERE token=$1 AND expires_at > NOW()', [token]);
  if (!rows.length) return res.status(401).json({ error: 'Giriş gerekli' });
  const { rows: users } = await query('SELECT * FROM users WHERE id=$1', [rows[0].user_id]);
  if (!users.length) return res.status(401).json({ error: 'Kullanıcı bulunamadı' });
  if (users[0].banned) return res.status(403).json({ error: 'Hesabınız yasaklandı' });
  req.user = users[0];
  next();
}

async function requireVmbMiddleware(req, res, next) {
  await authMiddleware(req, res, () => {
    if (!hasVmbBadge(req.user)) return res.status(404).json({ error: 'Sayfa bulunamadı' });
    next();
  });
}

async function requireVmbManagerMiddleware(req, res, next) {
  await authMiddleware(req, res, () => {
    if (!hasVmbBadge(req.user)) return res.status(404).json({ error: 'Sayfa bulunamadı' });
    if (!hasVmbManagementBadge(req.user)) return res.status(403).json({ error: 'Bu işlem için VMB Yönetim rozeti gerekli' });
    next();
  });
}

async function vmbAdminMiddleware(req, res, next) {
  const token = String(req.headers['x-vmb-admin-token'] || '').trim();
  if (!token) return res.status(401).json({ error: 'VMB panel oturumu gerekli' });
  try {
    const { rows } = await query(
      'SELECT username FROM vmb_admin_sessions WHERE token=$1 AND expires_at > NOW()',
      [token]
    );
    if (!rows.length) return res.status(401).json({ error: 'VMB panel oturumu geçersiz veya süresi dolmuş' });
    req.vmbAdmin = { username: rows[0].username };
    next();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function recordVmbActivity(userId, activityType, fileId, folderId, pageId, detail) {
  try {
    await query(
      `INSERT INTO vmb_activity(user_id,activity_type,file_id,folder_id,page_id,detail)
       VALUES($1,$2,$3,$4,$5,$6)`,
      [userId, activityType, fileId || null, folderId || null, pageId || null, String(detail || '').slice(0, 240)]
    );
  } catch (error) {
    console.error('VMB aktivite kaydı başarısız:', error.message);
  }
}

async function optionalAuth(req, res, next) {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  if (token) {
    const { rows } = await query('SELECT user_id FROM sessions WHERE token=$1 AND expires_at > NOW()', [token]);
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
  const token = String(req.headers['x-admin-token'] || '').trim();
  if (!token) return res.status(401).json({ error: 'Admin token gerekli' });
  const { rows: masterRows } = await query(`SELECT s.key, s.value, a.token
    FROM settings s CROSS JOIN admin_sessions a
    WHERE s.key IN ('admin_username') AND a.token=$1 AND a.expires_at > NOW()`, [token]);
  if (masterRows.length) {
    const master = Object.fromEntries(masterRows.map(row => [row.key, row.value]));
    req.adminUser = { id: null, username: master.admin_username || 'Tarator', isSuperAdmin: true };
    return next();
  }
  const { rows: users } = await query('SELECT u.id, u.username, u.is_admin, p.* FROM sessions s JOIN users u ON u.id=s.user_id LEFT JOIN admin_permissions p ON p.user_id=u.id WHERE s.token=$1 AND s.expires_at > NOW() AND u.is_admin=1', [token]);
  if (!users.length) return res.status(403).json({ error: 'Geçersiz admin token' });
  const user = users[0];
  if (!hasAdminPermission(user, 'can_view_users') && !hasAdminPermission(user, 'can_suspend_content') && !hasAdminPermission(user, 'can_restrict_users') && !hasAdminPermission(user, 'can_review_artists') && !hasAdminPermission(user, 'can_assign_badges') && !hasAdminPermission(user, 'can_view_store') && !hasAdminPermission(user, 'can_view_groups') && !hasAdminPermission(user, 'can_view_stories') && !hasAdminPermission(user, 'can_view_reals') && !hasAdminPermission(user, 'can_view_levels')) return res.status(403).json({ error: 'Bu yetkili hesabında kullanılabilir yetki yok' });
  req.adminUser = { id: user.id, username: user.username, isSuperAdmin: false, permissions: user };
  const permissions = user;
  if (req.method === 'GET') {
    const readRules = [
      [/\/(route-logs|authority-logs)/, false], [/\/settings/, false], [/\/messages/, false], [/\/(video-ads|music-ads|shop\/settings|payments)/, false],
      [/\/badges/, hasAdminPermission(permissions, 'can_assign_badges')],
      [/\/user\/\d+\/ad-panels/, hasAdminPermission(permissions, 'can_view_users')],
      [/\/users/, hasAdminPermission(permissions, 'can_view_users')], [/\/stories/, hasAdminPermission(permissions, 'can_view_stories')], [/\/videos/, hasAdminPermission(permissions, 'can_view_reals')], [/\/content-analytics/, hasAdminPermission(permissions, 'can_view_stories') || hasAdminPermission(permissions, 'can_view_reals')], [/\/groups/, hasAdminPermission(permissions, 'can_view_groups')],
      [/\/levels/, hasAdminPermission(permissions, 'can_view_levels')], [/\/shop(\/|$)/, hasAdminPermission(permissions, 'can_view_store')], [/\/logs/, hasAdminPermission(permissions, 'can_view_logs')]
    ];
    const rule = readRules.find(([pattern]) => pattern.test(req.path));
    if (rule && !rule[1]) return res.status(403).json({ error: 'Bu bölümü görüntüleme yetkiniz yok' });
  }
  if (req.method !== 'GET') {
    const allowed = [
      /^\/api\/admin\/user\/\d+\/2fa$/,
      /^\/api\/admin\/user\/\d+\/ad-panels(?:\/\d+)?$/,
      /^\/api\/admin\/account-deletions\/\d+\/cancel$/,
      /^\/api\/admin\/user\/\d+\/restrictions/, /^\/api\/admin\/content\/[^/]+\/\d+\/suspend$/,
      /^\/api\/admin\/artist-applications\/\d+\/review$/,
      /^\/api\/admin\/user\/\d+\/(badge|vmb)$/, /^\/api\/admin\/songs\/\d+\/ban$/,
      /^\/api\/admin\/badges(?:\/\d+(?:\/users(?:\/\d+)?)?)?$/,
      /^\/api\/admin\/group\/\d+\/(status|messages)$/, /^\/api\/admin\/group\/\d+$/,
      /^\/api\/admin\/levels?(?:\/\d+)?$/
    ];
    if (!allowed.some(pattern => pattern.test(req.path))) return res.status(403).json({ error: 'Bu işlem ana admin yetkisi gerektirir' });
    if (/\/restrictions/.test(req.path) && !permissions.can_restrict_users) return res.status(403).json({ error: 'Kullanıcı kısıtlama yetkisi yok' });
    if (/\/user\/\d+\/ad-panels/.test(req.path) && !hasAdminPermission(permissions, 'can_view_users')) return res.status(403).json({ error: 'Üye yönetimi yetkisi yok' });
    if (/\/content\/|\/songs\/\d+\/ban/.test(req.path) && !permissions.can_suspend_content) return res.status(403).json({ error: 'İçerik askıya alma yetkisi yok' });
    if (/artist-applications/.test(req.path) && !permissions.can_review_artists) return res.status(403).json({ error: 'Artist başvurusu yetkisi yok' });
    if (/\/group\//.test(req.path) && !req.adminUser.isSuperAdmin) return res.status(403).json({ error: 'Grup yönetimi yalnızca ana admin yetkisindedir' });
    if (/\/badge(?:s|\/|$)/.test(req.path) && !permissions.can_assign_badges) return res.status(403).json({ error: 'Rozet verme yetkisi yok' });
    if (/\/levels?(?:\/\d+)?$/.test(req.path) && !permissions.can_manage_levels) return res.status(403).json({ error: 'Seviye yönetme yetkisi yok' });
  }
  next();
}

async function getActiveRestriction(userId, restrictionType) {
  const { rows } = await query(`SELECT * FROM user_restrictions WHERE user_id=$1 AND restriction_type=$2 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW()) ORDER BY created_at DESC LIMIT 1`, [userId, restrictionType]);
  return rows[0] || null;
}

async function denyIfRestricted(req, res, restrictionType) {
  const restriction = await getActiveRestriction(req.user.id, restrictionType);
  if (!restriction) return false;
  const duration = restriction.expires_at ? new Date(restriction.expires_at).toLocaleString('tr-TR') : 'süresiz';
  return res.status(403).json({ error: `Bu işlem ${duration} tarihine kadar kısıtlandı. Neden: ${restriction.reason}`, restriction });
}

async function getActiveGroupMemberRestriction(groupId, userId) {
  if (!userId) return null;
  const { rows } = await query(`SELECT * FROM group_member_restrictions
    WHERE group_id=$1 AND user_id=$2 AND revoked_at IS NULL
    ORDER BY created_at DESC LIMIT 1`, [groupId, userId]);
  return rows[0] || null;
}

async function denyIfGroupUnavailable(req, res, group) {
  if (group.moderation_status && group.moderation_status !== 'active') {
    const label = group.moderation_status === 'banned' ? 'yasaklandı' : 'askıya alındı';
    return res.status(403).json({ error: `Bu grup ${label}. Neden: ${group.moderation_reason || 'Yönetim kararı'}`, group_status: group.moderation_status, reason: group.moderation_reason || '' });
  }
  const restriction = await getActiveGroupMemberRestriction(group.id, req.user?.id);
  if (restriction) return res.status(403).json({ error: `Bu gruba erişiminiz yasaklandı. Neden: ${restriction.reason}`, group_status: 'member_banned', reason: restriction.reason });
  return false;
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
        cb(null, randomUUID() + ext);
      }
    });
const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedImages = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/avif', 'image/heic', 'image/heif'];
    const allowedVideos = ['video/mp4', 'video/webm', 'video/quicktime', 'video/ogg'];
    const allowedAudio = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/flac', 'audio/aac', 'audio/x-wav', 'audio/wave'];
    const extension = path.extname(file.originalname || '').toLowerCase();
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.heic', '.heif'];
    const isImage = allowedImages.includes(file.mimetype) || (file.mimetype === 'application/octet-stream' && imageExtensions.includes(extension));
    if (isImage || allowedVideos.includes(file.mimetype) || file.mimetype.startsWith('video/') || allowedAudio.includes(file.mimetype) || file.mimetype.startsWith('audio/')) cb(null, true);
    else {
      const error = new Error('Sadece resim, video veya ses dosyaları kabul edilir');
      error.status = 400;
      cb(error);
    }
  }
});

// VMB arşivi, görsel/video/ses dışında belge ve arşiv dosyalarını da kabul eder.
// Yönetim kontrolü upload route'unda yapılır; bu middleware diğer yüklemeleri etkilemez.
const vmbUpload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }
});

const avatarUpload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedImages = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif'];
    if (allowedImages.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Profil fotoğrafı JPEG, PNG, GIF, WEBP veya AVIF olmalı'));
  }
});

const playlistCoverUpload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedImages = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/avif'];
    if (allowedImages.includes(file.mimetype) || file.mimetype?.startsWith('image/')) cb(null, true);
    else cb(new Error('Playlist kapağı JPEG, PNG, GIF, WEBP veya AVIF olmalı'));
  }
});

const largeVideoStorage = USE_CLOUDINARY
  ? multer.diskStorage({
      destination: (req, file, cb) => cb(null, UPLOAD_DIR),
      filename: (req, file, cb) => cb(null, randomUUID() + path.extname(file.originalname))
    })
  : storage;
const largeVideoUpload = multer({
  storage: largeVideoStorage,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, file, cb) => file.mimetype?.startsWith('video/')
    ? cb(null, true)
    : cb(new Error('Sadece video dosyasi yukleyebilirsiniz'))
});

function parseFormBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return !['false', '0', 'no', 'off'].includes(String(value).trim().toLowerCase());
}

// Yükleme helper'ı — Cloudinary ya da disk
async function handleUpload(file) {
  if (USE_CLOUDINARY) {
    return new Promise((resolve, reject) => {
      if (!file.buffer || file.buffer.length === 0) {
        return reject(new Error('Dosya buffer boş'));
      }
      const ext = path.extname(file.originalname).replace('.', '') || 'jpg';
      const public_id = 'teatube/' + randomUUID();
      const isAudio = file.mimetype && file.mimetype.startsWith('audio/');
      const isVideo = file.mimetype && file.mimetype.startsWith('video/');
      const stream = cloudinary.uploader.upload_stream(
        isAudio || isVideo
          ? { public_id, resource_type: 'video' }
          : { public_id, resource_type: 'image' },
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

async function handleVmbUpload(file) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  const key = `vmb/${randomUUID()}${ext}`;
  if (USE_R2) {
    await new Upload({
      client: r2Client,
      params: {
        Bucket: process.env.R2_BUCKET_NAME,
        Key: key,
        Body: file.buffer || fs.createReadStream(file.path),
        ContentType: file.mimetype || 'application/octet-stream'
      },
      partSize: 20 * 1024 * 1024,
      queueSize: 3,
      leavePartsOnError: false
    }).done();
    if (file.path) fs.promises.unlink(file.path).catch(() => {});
    const publicBase = (process.env.R2_PUBLIC_URL || `${R2_ENDPOINT}/${process.env.R2_BUCKET_NAME}`).replace(/\/$/, '');
    return `${publicBase}/${key}`;
  }
  if (USE_CLOUDINARY) {
    return new Promise((resolve, reject) => {
      if (!file.buffer || file.buffer.length === 0) return reject(new Error('Dosya buffer boş'));
      const stream = cloudinary.uploader.upload_stream(
        { public_id: key.replace(/\.[^.]+$/, ''), resource_type: 'raw' },
        (err, result) => {
          if (err) return reject(new Error('Cloudinary yükleme hatası: ' + (err.message || JSON.stringify(err))));
          if (!result?.secure_url) return reject(new Error('Cloudinary URL alınamadı'));
          resolve(result.secure_url);
        }
      );
      stream.end(file.buffer);
    });
  }
  return '/uploads/' + file.filename;
}

async function handleLargeVideoUpload(file) {
  if (USE_R2) {
    const key = `reals/${randomUUID()}${path.extname(file.originalname) || '.mp4'}`;
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
      public_id: 'teatube/' + randomUUID(),
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
  const key = `stories/${randomUUID()}${path.extname(file.originalname) || '.mp4'}`;
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
  const [forums, books, bookPages, groups, users, songs, photos] = await Promise.all([
    query(`SELECT f.slug, f.title, f.banner_image, f.updated_at FROM forums f LEFT JOIN users u ON u.id=f.user_id
      WHERE COALESCE(u.is_private,0)=0 AND COALESCE(u.is_deleted,0)=0
        AND NOT EXISTS (SELECT 1 FROM content_suspensions cs WHERE cs.content_type='forum' AND cs.content_id=f.id)
      ORDER BY f.updated_at DESC LIMIT 5000`).then(r => r.rows),
    query(`SELECT b.id, b.slug, b.updated_at FROM books b LEFT JOIN users u ON u.id=b.user_id
      WHERE b.is_hidden=0 AND COALESCE(b.is_unnamed,0)=0 AND COALESCE(b.password_hash,'')=''
        AND COALESCE(u.is_private,0)=0 AND COALESCE(u.is_deleted,0)=0
        AND NOT EXISTS (SELECT 1 FROM content_suspensions cs WHERE cs.content_type='book' AND cs.content_id=b.id)
      ORDER BY b.updated_at DESC LIMIT 2000`).then(r => r.rows),
    query(`SELECT bp.slug AS page_slug, b.slug AS book_slug, bp.created_at AS updated_at
      FROM book_pages bp JOIN books b ON b.id=bp.book_id LEFT JOIN users u ON u.id=b.user_id
      WHERE b.is_hidden=0 AND COALESCE(b.is_unnamed,0)=0 AND COALESCE(b.password_hash,'')=''
        AND COALESCE(u.is_private,0)=0 AND COALESCE(u.is_deleted,0)=0
        AND NOT EXISTS (SELECT 1 FROM content_suspensions cs WHERE cs.content_type='book' AND cs.content_id=b.id)
      ORDER BY bp.created_at DESC LIMIT 10000`).then(r => r.rows),
    query("SELECT slug FROM groups WHERE COALESCE(visibility,'public')='public' AND COALESCE(moderation_status,'active')='active' LIMIT 2000").then(r => r.rows),
    query("SELECT username FROM users WHERE banned=0 AND COALESCE(is_private,0)=0 AND COALESCE(is_deleted,0)=0 LIMIT 5000").then(r => r.rows),
    query("SELECT s.slug, s.title, s.cover_url, s.published_at FROM songs s LEFT JOIN users u ON u.id=s.uploader_id WHERE s.status='active' AND COALESCE(u.is_private,0)=0 AND COALESCE(u.is_deleted,0)=0 AND NOT EXISTS (SELECT 1 FROM content_suspensions cs WHERE cs.content_type='song' AND cs.content_id=s.id) ORDER BY s.published_at DESC LIMIT 2000").then(r => r.rows),
    query(`SELECT p.id, p.url, p.title, p.caption, p.created_at FROM photos p
      LEFT JOIN users u ON u.id=p.user_id
      WHERE COALESCE(u.is_private,0)=0 AND NOT EXISTS (SELECT 1 FROM content_suspensions cs WHERE cs.content_type='photo' AND cs.content_id=p.id)
      ORDER BY p.created_at DESC LIMIT 10000`).then(r => r.rows),
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

  const bookPageUrls = bookPages.map(page => {
    const mod = page.updated_at ? `\n    <lastmod>${new Date(page.updated_at).toISOString()}</lastmod>` : '';
    return `  <url><loc>${SITE_URL}/kitap/${escapeHtml(page.book_slug)}/sayfa/${escapeHtml(page.page_slug)}</loc>${mod}\n    <changefreq>monthly</changefreq><priority>0.6</priority>\n  </url>`;
  }).join('\n');

  const groupUrls = groups.map(g =>
    `  <url><loc>${SITE_URL}/grup/${escapeHtml(g.slug)}</loc><changefreq>weekly</changefreq><priority>0.6</priority></url>`
  ).join('\n');

  const profileUrls = users.map(u =>
    `  <url><loc>${SITE_URL}/profil/${profileRouteKey(u.username)}</loc><changefreq>weekly</changefreq><priority>0.5</priority></url>`
  ).join('\n');

  const songUrls = songs.map(s => {
    const mod = s.published_at ? `\n    <lastmod>${new Date(s.published_at).toISOString()}</lastmod>` : '';
    const imgTag = s.cover_url
      ? `\n    <image:image><image:loc>${escapeHtml(s.cover_url)}</image:loc><image:title>${escapeHtml(s.title)}</image:title></image:image>`
      : '';
    return `  <url><loc>${SITE_URL}/muzik/${escapeHtml(s.slug)}</loc>${mod}\n    <changefreq>monthly</changefreq><priority>0.6</priority>${imgTag}\n  </url>`;
  }).join('\n');

  const photoUrls = photos.map(p => {
    const mod = p.created_at ? `\n    <lastmod>${new Date(p.created_at).toISOString()}</lastmod>` : '';
    const imageTitle = p.title || p.caption || 'CigCig fotoğrafı';
    return `  <url><loc>${SITE_URL}/foto/${escapeHtml(p.id)}</loc>${mod}\n    <changefreq>monthly</changefreq><priority>0.5</priority>\n    <image:image><image:loc>${escapeHtml(p.url)}</image:loc><image:title>${escapeHtml(imageTitle)}</image:title></image:image>\n  </url>`;
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
    bookPageUrls,
    groupUrls,
    profileUrls,
    songUrls,
    photoUrls,
    '</urlset>'
  ].join('\n'));
});

// Redirect legacy /konular to /forum (friendly route)
app.get('/konular', (req, res) => { res.redirect(301, '/forum'); });

// Prevent direct access to legacy admin entry paths
app.get(['/admin.html','/panel-giris'], (req, res) => { res.status(404).end(); });

// New admin entry path
app.get('/gubukgak', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'admin.html')); });

// VMB yönetimi, ana admin panelinden ayrı ve yalnızca özel panel hesabıyla açılır.
app.get(['/vmb-panel', '/vmb-panel.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'vmb-panel.html'));
});

app.post('/api/vmb-admin/auth/login', async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  if (username !== VMB_PANEL_USERNAME || password !== VMB_PANEL_PASSWORD) {
    return res.status(401).json({ error: 'VMB panel bilgileri doğrulanamadı' });
  }
  const token = generateToken('vmb-admin');
  await query('INSERT INTO vmb_admin_sessions(token,username) VALUES($1,$2)', [token, VMB_PANEL_USERNAME]);
  await logAction(VMB_PANEL_USERNAME, 'vmb_panel_login', '', 'VMB yönetim paneli girişi', getIp(req), getClientInfo(req));
  res.json({ token, username: VMB_PANEL_USERNAME });
});

app.delete('/api/vmb-admin/auth/logout', vmbAdminMiddleware, async (req, res) => {
  const token = String(req.headers['x-vmb-admin-token'] || '').trim();
  await query('DELETE FROM vmb_admin_sessions WHERE token=$1', [token]);
  res.json({ ok: true });
});

app.post('/api/admin/auth/login', async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  if (!username || !password) return res.status(400).json({ error: 'Kullanıcı adı ve şifre gerekli' });
  const { rows: settings } = await query("SELECT key, value FROM settings WHERE key IN ('admin_username','admin_password')");
  const config = Object.fromEntries(settings.map(row => [row.key, row.value]));
  const storedMasterPassword = String(config.admin_password || '').trim();
  const masterPasswordMatches = verifyPassword(password, storedMasterPassword);
  if (username.toLowerCase() === (config.admin_username || 'Tarator').trim().toLowerCase() && masterPasswordMatches) {
    if (needsRehash(storedMasterPassword)) {
      await query('UPDATE settings SET value=$1 WHERE key=$2', [hashPassword(password), 'admin_password']);
    }
    const token = generateToken('admin');
    await query('INSERT INTO admin_sessions (token) VALUES ($1)', [token]);
    return res.json({ token, is_super_admin: true, username });
  }
  const { rows } = await query('SELECT u.*, p.* FROM users u LEFT JOIN admin_permissions p ON p.user_id=u.id WHERE LOWER(u.username)=LOWER($1) AND u.is_admin=1', [username]);
  const user = rows[0];
  if (!user || !verifyPassword(password, user.password_hash)) return res.status(401).json({ error: 'Yetkili bilgileri doğrulanamadı' });
  if (!hasAdminPermission(user, 'can_view_users') && !hasAdminPermission(user, 'can_suspend_content') && !hasAdminPermission(user, 'can_restrict_users') && !hasAdminPermission(user, 'can_review_artists') && !hasAdminPermission(user, 'can_assign_badges') && !hasAdminPermission(user, 'can_view_store') && !hasAdminPermission(user, 'can_view_groups') && !hasAdminPermission(user, 'can_view_stories') && !hasAdminPermission(user, 'can_view_reals') && !hasAdminPermission(user, 'can_view_levels')) return res.status(403).json({ error: 'Bu hesabın atanmış bir yetkisi yok' });
  const token = generateToken(user.id);
  await query('INSERT INTO sessions (token,user_id) VALUES ($1,$2)', [token, user.id]);
  await logAction(user.username, 'authority_login', '', 'Yetkili paneli girişi', getIp(req));
  res.json({ token, is_super_admin: false, username: user.username, permissions: user });
});

// VMB tarzı route koruması: admin panelinden tanımlanan hassas yolları gizler.
app.use(async (req, res, next) => {
  // API'ler kendi auth middleware'lerini kullanır. Admin/VMB giriş ekranları da
  // site geneli giriş zorunluluğu açıkken erişilebilir kalmalıdır.
  if (
    req.path.startsWith('/api/') ||
    req.path === '/gubukgak' ||
    req.path === '/vmb-panel' ||
    req.path === '/vmb-panel.html' ||
    req.method !== 'GET' ||
    path.extname(req.path)
  ) return next();
  try {
    const { rows } = await query("SELECT key, value FROM settings WHERE key IN ('route_protection_enabled','protected_routes','route_redirect','auth_required')");
    const settings = Object.fromEntries(rows.map(item => [item.key, item.value]));

    const isLoginRoute = req.path === '/giris' ||
      req.path === '/kayit' ||
      /^\/[a-zA-Z0-9]{24}$/.test(req.path);
    if (settings.auth_required === '1' && !isLoginRoute) {
      const token = req.headers['authorization']?.replace('Bearer ', '') || getSessionCookie(req);
      let authenticated = false;
      if (token) {
        const { rows: users } = await query(
          'SELECT u.id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=$1 AND s.expires_at > NOW() AND COALESCE(u.banned,0)=0 LIMIT 1',
          [token]
        );
        authenticated = users.length > 0;
      }
      if (!authenticated) {
        const returnTo = req.originalUrl || req.path;
        return res.redirect('/giris?returnTo=' + encodeURIComponent(returnTo));
      }
    }

    let routes = [];
    try { routes = JSON.parse(settings.protected_routes || '[]'); } catch {}
    const matched = routes.find(route => {
      const normalized = String(route || '').trim().replace(/\/$/, '') || '/';
      return req.path === normalized || req.path.startsWith(`${normalized}/`);
    });
    if (!matched) return next();
    const protectionEnabled = settings.route_protection_enabled === '1';
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
    const loggedTarget = protectionEnabled ? redirectTarget : 'koruma kapalıydı';
    await logAction(actor, 'restricted_route_attempt', req.path, JSON.stringify({ matchedRoute: matched, redirectTarget: loggedTarget }), getIp(req), getClientInfo(req));
    if (!protectionEnabled) return next();
    return res.redirect(redirectTarget);
  } catch { return next(); }
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/admin/me', adminMiddleware, (req, res) => {
  res.json({ username: req.adminUser.username, is_super_admin: req.adminUser.isSuperAdmin, permissions: req.adminUser.permissions || null });
});

// ===== ADMIN MEDYA GÖRÜNTÜLEME ANALİTİĞİ =====
app.get('/api/admin/content-analytics', adminMiddleware, async (req, res) => {
  try {
    const allowedTypes = ['song', 'photo', 'story', 'reals', 'video'];
    const type = allowedTypes.includes(String(req.query.type || '')) ? String(req.query.type) : '';
    const params = [type];
    const { rows } = await query(`
      SELECT cve.content_type, cve.content_id,
        COALESCE(s.title, NULLIF(p.caption,''), NULLIF(st.caption,''), v.title, 'İsimsiz içerik') AS content_title,
        cve.user_id, u.username, cve.ip,
        date_trunc('hour', cve.viewed_at) AS viewed_hour,
        MIN(cve.viewed_at) AS first_viewed_at, MAX(cve.viewed_at) AS last_viewed_at,
        COUNT(*)::int AS view_count
      FROM content_view_events cve
      LEFT JOIN songs s ON cve.content_type='song' AND s.id=cve.content_id
      LEFT JOIN photos p ON cve.content_type='photo' AND p.id=cve.content_id
      LEFT JOIN stories st ON cve.content_type='story' AND st.id=cve.content_id
      LEFT JOIN videos v ON cve.content_type IN ('reals','video') AND v.id=cve.content_id
      LEFT JOIN users u ON u.id=cve.user_id
      WHERE ($1='' OR cve.content_type=$1)
      GROUP BY cve.content_type,cve.content_id,content_title,cve.user_id,u.username,cve.ip,viewed_hour
      ORDER BY viewed_hour DESC
      LIMIT 2000
    `, params);
    res.json({
      rows,
      total_events: rows.reduce((total, row) => total + Number(row.view_count || 0), 0),
      guest_events: rows.filter(row => !row.user_id).reduce((total, row) => total + Number(row.view_count || 0), 0)
    });
  } catch (error) {
    console.error('Content analytics failed:', error.message);
    res.status(500).json({ error: 'İçerik görüntüleme istatistikleri alınamadı' });
  }
});

// ===== ADMIN BADGES API =====
app.get('/api/admin/badges', adminMiddleware, async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT b.*,
             COUNT(ub.id)::int AS assigned_count
      FROM badges b
      LEFT JOIN user_badges ub ON ub.badge_id = b.id
      WHERE COALESCE(b.is_hidden,0)=0
      GROUP BY b.id
      ORDER BY b.id DESC
    `);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/badges', adminMiddleware, async (req, res) => {
  try {
    const { name, icon, color } = req.body;
    if (!name) return res.status(400).json({ error: 'İsim gerekli' });
    if (isReservedVmbBadgeName(name)) return res.status(400).json({ error: 'VMB adı özel sistem rozeti için ayrılmıştır' });
    const { rows } = await query('INSERT INTO badges(name,icon,color,created_at) VALUES($1,$2,$3,NOW()) RETURNING *', [name, icon||'', color||'#6b7280']);
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/badges/:id', adminMiddleware, async (req, res) => {
  try {
    const id = req.params.id;
    const { rows: badgeRows } = await query('SELECT is_system FROM badges WHERE id=$1', [id]);
    if (badgeRows[0]?.is_system) return res.status(403).json({ error: 'Sistem rozeti silinemez' });
    await query('DELETE FROM badges WHERE id=$1', [id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Rozet menüsünde aranabilir kullanıcı listesi.
app.get('/api/admin/badges/:id/users', adminMiddleware, async (req, res) => {
  try {
    const badgeId = Number(req.params.id);
    if (!Number.isInteger(badgeId) || badgeId < 1) return res.status(400).json({ error: 'Geçersiz rozet' });
    const search = String(req.query.q || '').trim();
    const { rows: badgeRows } = await query(
      'SELECT id, name, icon, color FROM badges WHERE id=$1 AND COALESCE(is_hidden,0)=0',
      [badgeId]
    );
    if (!badgeRows.length) return res.status(404).json({ error: 'Rozet bulunamadı' });
    const { rows } = await query(`
      SELECT u.id, u.username, u.avatar,
             ub.assigned_at,
             (ub.id IS NOT NULL) AS assigned
      FROM users u
      LEFT JOIN user_badges ub ON ub.user_id=u.id AND ub.badge_id=$1
      WHERE COALESCE(u.is_deleted,0)=0
        AND ($2 = '' OR u.username ILIKE '%' || $2 || '%')
      ORDER BY (ub.id IS NOT NULL) DESC, LOWER(u.username) ASC
      LIMIT 500
    `, [badgeId, search]);
    res.json({ badge: badgeRows[0], users: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Rozeti kullanıcıya ver.
app.put('/api/admin/badges/:badgeId/users/:userId', adminMiddleware, async (req, res) => {
  try {
    const badgeId = Number(req.params.badgeId);
    const userId = Number(req.params.userId);
    const { rows: badgeRows } = await query('SELECT * FROM badges WHERE id=$1 AND COALESCE(is_hidden,0)=0', [badgeId]);
    const { rows: userRows } = await query('SELECT id, username, badge_name FROM users WHERE id=$1 AND COALESCE(is_deleted,0)=0', [userId]);
    if (!badgeRows.length) return res.status(404).json({ error: 'Rozet bulunamadı' });
    if (!userRows.length) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    if (badgeRows[0].is_system || isReservedVmbBadgeName(badgeRows[0].name)) return res.status(400).json({ error: 'Sistem rozeti bu menüden verilemez' });
    await query(
      `INSERT INTO user_badges (user_id, badge_id, assigned_at, assigned_by)
       VALUES ($1,$2,NOW(),$3)
       ON CONFLICT (user_id, badge_id) DO NOTHING`,
      [userId, badgeId, req.adminUser?.username || 'admin']
    );
    // Eski istemciler için ilk rozet alanlarını da doldur; yeni atamalar birbiri üzerine yazılmaz.
    await query(`
      UPDATE users SET badge_name=$1, badge_icon=$2, badge_color=$3
      WHERE id=$4 AND COALESCE(TRIM(badge_name),'')=''
    `, [badgeRows[0].name, badgeRows[0].icon || '', badgeRows[0].color || '#6b7280', userId]);
    res.json({ ok: true, assigned: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Rozeti kullanıcıdan geri al.
app.delete('/api/admin/badges/:badgeId/users/:userId', adminMiddleware, async (req, res) => {
  try {
    const badgeId = Number(req.params.badgeId);
    const userId = Number(req.params.userId);
    const { rows: badgeRows } = await query('SELECT * FROM badges WHERE id=$1 AND COALESCE(is_hidden,0)=0', [badgeId]);
    const { rows: userRows } = await query('SELECT id, badge_name FROM users WHERE id=$1', [userId]);
    if (!badgeRows.length) return res.status(404).json({ error: 'Rozet bulunamadı' });
    if (!userRows.length) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    await query('DELETE FROM user_badges WHERE user_id=$1 AND badge_id=$2', [userId, badgeId]);
    // Legacy görünüm alanı geri kalan rozetlerden biriyle senkron tutulur.
    if (String(userRows[0].badge_name || '').trim().toLocaleLowerCase('tr-TR') === String(badgeRows[0].name || '').trim().toLocaleLowerCase('tr-TR')) {
      const { rows: nextRows } = await query(`
        SELECT b.name, b.icon, b.color
        FROM user_badges ub JOIN badges b ON b.id=ub.badge_id
        WHERE ub.user_id=$1 AND COALESCE(b.is_hidden,0)=0
        ORDER BY ub.assigned_at DESC, ub.id DESC LIMIT 1
      `, [userId]);
      const next = nextRows[0];
      await query(
        'UPDATE users SET badge_name=$1,badge_icon=$2,badge_color=$3 WHERE id=$4',
        [next?.name || null, next?.icon || null, next?.color || null, userId]
      );
    }
    res.json({ ok: true, assigned: false });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Eski entegrasyonlar için tekil rozet endpointi.
app.put('/api/admin/user/:id/badge', adminMiddleware, async (req, res) => {
  try {
    const id = req.params.id;
    const { badge_name, badge_icon, badge_color } = req.body;
    if (isReservedVmbBadgeName(badge_name)) return res.status(400).json({ error: 'VMB özel rozeti ayrı VMB işlemiyle verilir' });
    await query('UPDATE users SET badge_name=$1, badge_icon=$2, badge_color=$3 WHERE id=$4', [badge_name||null, badge_icon||null, badge_color||null, id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// VMB tanıtım sayfası herkese açık; özel dosya yolları üyelik gerektirir.
app.get('/vmb', (req, res) => {
  return res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Özel dosya yolları doğrudan URL ile açıldığında da üyelik kontrolü yapılır.
app.get(/^\/vmb\/(?:dosyalar|dosyalara)(?:\/.*)?$/, async (req, res) => {
  try {
    const token = getSessionCookie(req);
    if (!token) return res.redirect('/');
    const { rows } = await query(
      "SELECT u.is_vmb, u.badge_name FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=$1 AND s.expires_at > NOW() AND u.banned=0",
      [token]
    );
    if (!hasVmbBadge(rows[0])) return res.redirect('/');
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  } catch {
    return res.redirect('/');
  }
});

// ===== AUTH =====
app.post('/api/auth/register', avatarUpload.single('avatar'), async (req, res) => {
  try {
    const { username, email, password, kvkk_accepted, birth_date, is_private, tag_permission, homepage_sections, profile_visibility, show_level_badge, show_level_progress, two_factor_method, two_factor_question, two_factor_answer } = req.body;
    const emailAddress = String(email || '').trim().toLowerCase();
    let parsedHomepageSections = homepage_sections;
    let parsedProfileVisibility = profile_visibility;
    try { if (typeof parsedHomepageSections === 'string') parsedHomepageSections = JSON.parse(parsedHomepageSections); } catch { parsedHomepageSections = []; }
    try { if (typeof parsedProfileVisibility === 'string') parsedProfileVisibility = JSON.parse(parsedProfileVisibility); } catch { parsedProfileVisibility = null; }
    if (!username || !emailAddress || !password) return res.status(400).json({ error: 'Tüm alanlar zorunlu' });
    if (!isValidEmail(emailAddress)) return res.status(400).json({ error: 'Geçerli bir e-posta adresi girin' });
    if (!kvkk_accepted) return res.status(400).json({ error: 'KVKK onayı zorunlu' });
    if (/\s/.test(username)) return res.status(400).json({ error: 'Kullanıcı adında boşluk oluşamaz' });
    if (username.length < 3 || username.length > 30) return res.status(400).json({ error: 'Kullanıcı adı 3-30 karakter olmalı' });
    if (password.length < 6) return res.status(400).json({ error: 'Şifre en az 6 karakter olmalı' });
    const twoFactorMethod = ['none', 'email', 'question'].includes(two_factor_method) ? two_factor_method : 'none';
    if (twoFactorMethod === 'email' && (!RESEND_API_KEY || !EMAIL_FROM || !APP_SECRET)) return res.status(503).json({ error: 'E-posta doğrulama servisi yapılandırılmamış' });
    if (twoFactorMethod === 'question' && (!two_factor_question || normalizeSecurityAnswer(two_factor_answer).length < 2)) return res.status(400).json({ error: 'Güvenlik sorusu ve cevabı zorunlu' });
    if (!birth_date || !/^\d{4}-\d{2}-\d{2}$/.test(birth_date)) return res.status(400).json({ error: 'Doğum tarihi zorunlu' });
    const birth = new Date(`${birth_date}T00:00:00Z`);
    const today = new Date();
    let age = today.getUTCFullYear() - birth.getUTCFullYear();
    const monthDiff = today.getUTCMonth() - birth.getUTCMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getUTCDate() < birth.getUTCDate())) age--;
    if (!Number.isFinite(age) || age < 15 || birth > today) return res.status(400).json({ error: '15 yaş altı kabul edilmez (¬‿¬) hııhıı' });
    const validTagPermission = ['friends', 'everyone', 'nobody'].includes(tag_permission) ? tag_permission : 'everyone';
    let defaultVisibility = { forums: false, books: false, comments: false, photos: false, music: false, followers: true, following: true, followers_list: true, following_list: true };
    if (parsedProfileVisibility && typeof parsedProfileVisibility === 'object') {
      Object.keys(defaultVisibility).forEach(key => { defaultVisibility[key] = parsedProfileVisibility[key] !== false; });
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
    const { rows: existing } = await query('SELECT id FROM users WHERE LOWER(username)=LOWER($1) OR LOWER(email)=LOWER($2)', [username, emailAddress]);
    if (existing.length) return res.status(400).json({ error: 'Bu kullanıcı adı veya e-posta zaten kullanılıyor' });
    let avatar = '';
    if (req.file) avatar = await handleUpload(req.file);
    const registrationCode = twoFactorMethod === 'email' ? String(crypto.randomInt(100000, 1000000)) : '';
    const emailVerified = twoFactorMethod === 'email' ? 0 : 1;
    const { rows } = await query(
      'INSERT INTO users (username,email,password_hash,two_factor_method,two_factor_question,two_factor_answer_hash,email_verified,kvkk_accepted,ip,birth_date,is_private,tag_permission,homepage_sections,profile_visibility,show_level_badge,show_level_progress,avatar) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *',
      [username, emailAddress, hashPassword(password), twoFactorMethod, twoFactorMethod === 'question' ? two_factor_question : '', twoFactorMethod === 'question' ? hashPassword(normalizeSecurityAnswer(two_factor_answer)) : '', emailVerified, 1, ip, birth_date, is_private ? 1 : 0, validTagPermission, JSON.stringify(Array.isArray(parsedHomepageSections) ? parsedHomepageSections : []), JSON.stringify(defaultVisibility), show_level_badge === 'false' ? 0 : 1, show_level_progress === 'false' ? 0 : 1, avatar]);
    const user = rows[0];
    if (registrationCode) {
      const challenge = createChallengeToken();
      try {
        await query('INSERT INTO auth_challenges (challenge_hash,user_id,purpose,method,code_hash,expires_at) VALUES ($1,$2,$3,$4,$5,NOW()+INTERVAL \'10 minutes\')', [hashChallengeValue(challenge), user.id, 'registration', 'email', hashChallengeValue(registrationCode)]);
        await sendEmailCode(emailAddress, username, registrationCode);
      } catch (error) {
        await query('DELETE FROM auth_challenges WHERE user_id=$1 AND purpose=$2', [user.id, 'registration']);
        await query('DELETE FROM users WHERE id=$1', [user.id]);
        throw error;
      }
      return res.json({ email_verification_required: true, challenge, maskedEmail: maskEmail(email) });
    }
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
    if (!user || !verifyPassword(password, user.password_hash)) return res.status(401).json({ error: 'Hatalı bilgiler' });
    if (needsRehash(user.password_hash)) {
      await query('UPDATE users SET password_hash=$1 WHERE id=$2', [hashPassword(password), user.id]);
    }
    if (user.banned) return res.status(403).json({ error: 'Hesabınız yasaklandı' });
    if (user.password_reset_required) {
      return res.status(403).json({
        error: 'Şifreni değiştirmeden hesabına giremezsin. E-postandaki kodla devam et.',
        password_reset_required: true
      });
    }
    if (user.two_factor_method === 'email' && user.email_verified === 0) return res.status(403).json({ error: 'Önce kayıt sırasında e-posta adresini doğrulamalısın' });
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
    if (user.two_factor_method && user.two_factor_method !== 'none') {
      const challenge = await createTwoFactorChallenge(user);
      return res.json({ two_factor_required: true, ...challenge });
    }
    await query('UPDATE users SET last_active=NOW(), ip=$1 WHERE id=$2', [ip, user.id]);
    const token = generateToken(user.id);
    await query('INSERT INTO sessions (token,user_id) VALUES ($1,$2)', [token, user.id]);
    await logAction(user.username, 'login', '', '', ip);
    setSessionCookie(res, token);
    res.json({ token, user: sanitizeUser(user) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/2fa/verify', async (req, res) => {
  try {
    const challenge = String(req.body.challenge || '');
    const value = String(req.body.value || '');
    if (!/^[a-f0-9]{64}$/i.test(challenge) || !value) return res.status(400).json({ error: 'Doğrulama bilgisi eksik' });
    const token = await completeTwoFactorChallenge(challenge, value);
    if (!token) return res.status(401).json({ error: 'Doğrulama başarısız veya kod geçersiz' });
    const { rows } = await query('SELECT * FROM users WHERE id=(SELECT user_id FROM sessions WHERE token=$1) LIMIT 1', [token]);
    if (!rows.length) return res.status(401).json({ error: 'Oturum oluşturulamadı' });
    await query('UPDATE users SET last_active=NOW() WHERE id=$1', [rows[0].id]);
    setSessionCookie(res, token);
    res.json({ token, user: sanitizeUser(rows[0]) });
  } catch (e) { res.status(500).json({ error: 'Doğrulama işlemi başarısız' }); }
});

app.post('/api/auth/verify-registration-email', async (req, res) => {
  try {
    const challenge = String(req.body.challenge || '');
    const code = String(req.body.code || '').trim();
    if (!/^[a-f0-9]{64}$/i.test(challenge) || !/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Geçerli bir doğrulama kodu girin' });
    const { rows } = await query('SELECT * FROM auth_challenges WHERE challenge_hash=$1 AND purpose=$2 AND method=$3 AND expires_at > NOW() LIMIT 1', [hashChallengeValue(challenge), 'registration', 'email']);
    const record = rows[0];
    if (!record || record.attempts >= 5) return res.status(401).json({ error: 'Kod geçersiz veya süresi dolmuş' });
    await query('UPDATE auth_challenges SET attempts=attempts+1 WHERE id=$1', [record.id]);
    if (hashChallengeValue(code) !== record.code_hash) return res.status(401).json({ error: 'Kod geçersiz veya süresi dolmuş' });
    await query('UPDATE users SET email_verified=1 WHERE id=$1', [record.user_id]);
    await query('DELETE FROM auth_challenges WHERE id=$1', [record.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'E-posta doğrulama işlemi başarısız' }); }
});

app.post('/api/auth/forgot-password/request', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!isValidEmail(email)) return res.status(400).json({ error: 'Geçerli bir e-posta adresi girin' });

    const { rows } = await query('SELECT id,username,email FROM users WHERE LOWER(email)=LOWER($1) AND COALESCE(is_deleted,0)=0 LIMIT 1', [email]);
    const user = rows[0];
    // Hesap varlığını açığa çıkarmadan, sadece kayıtlı hesaplar için akışı başlat.
    if (!user) return res.json({ ok: true, sent: false, message: 'Bu e-posta kayıtlıysa doğrulama kodu gönderildi.' });
    if (!RESEND_API_KEY || !EMAIL_FROM || !APP_SECRET) return res.status(503).json({ error: 'E-posta servisi yapılandırılmamış' });

    const challenge = createChallengeToken();
    const code = String(crypto.randomInt(100000, 1000000));
    await query("DELETE FROM auth_challenges WHERE user_id=$1 AND purpose IN ('password_reset','password_reset_verified')", [user.id]);
    await query('INSERT INTO auth_challenges (challenge_hash,user_id,purpose,method,code_hash,target_value,expires_at) VALUES ($1,$2,$3,$4,$5,$6,NOW()+INTERVAL \'10 minutes\')', [
      hashChallengeValue(challenge), user.id, 'password_reset', 'email', hashChallengeValue(code), email
    ]);
    try {
      await sendEmailCode(email, user.username, code);
    } catch (error) {
      await query("DELETE FROM auth_challenges WHERE user_id=$1 AND purpose='password_reset'", [user.id]);
      throw error;
    }
    res.json({ ok: true, sent: true, challenge, maskedEmail: maskEmail(email) });
  } catch (e) {
    res.status(500).json({ error: 'Doğrulama kodu gönderilemedi' });
  }
});

app.post('/api/auth/forgot-password/verify', async (req, res) => {
  try {
    const challenge = String(req.body?.challenge || '');
    const code = String(req.body?.code || '').trim();
    if (!/^[a-f0-9]{64}$/i.test(challenge) || !/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Geçerli bir doğrulama kodu girin' });
    const { rows } = await query('SELECT * FROM auth_challenges WHERE challenge_hash=$1 AND purpose=$2 AND method=$3 AND expires_at > NOW() LIMIT 1', [
      hashChallengeValue(challenge), 'password_reset', 'email'
    ]);
    const record = rows[0];
    if (!record || record.attempts >= 5) return res.status(401).json({ error: 'Kod geçersiz veya süresi dolmuş' });
    await query('UPDATE auth_challenges SET attempts=attempts+1 WHERE id=$1', [record.id]);
    if (hashChallengeValue(code) !== record.code_hash) return res.status(401).json({ error: 'Kod geçersiz veya süresi dolmuş' });

    const resetToken = createChallengeToken();
    await query('UPDATE auth_challenges SET purpose=$1,code_hash=$2,attempts=0,expires_at=NOW()+INTERVAL \'10 minutes\' WHERE id=$3', [
      'password_reset_verified', hashChallengeValue(resetToken), record.id
    ]);
    await query('UPDATE users SET password_reset_required=1,password_reset_expires_at=NOW()+INTERVAL \'10 minutes\' WHERE id=$1', [record.user_id]);
    await query('DELETE FROM sessions WHERE user_id=$1', [record.user_id]);
    res.json({ ok: true, reset_token: resetToken });
  } catch (e) {
    res.status(500).json({ error: 'Kod doğrulanamadı' });
  }
});

app.post('/api/auth/forgot-password/reset', async (req, res) => {
  try {
    const resetToken = String(req.body?.reset_token || '');
    const password = String(req.body?.password || '');
    const passwordConfirmation = String(req.body?.password_confirmation || '');
    if (!/^[a-f0-9]{64}$/i.test(resetToken)) return res.status(400).json({ error: 'Şifre yenileme oturumu geçersiz' });
    if (password.length < 6) return res.status(400).json({ error: 'Şifre en az 6 karakter olmalı' });
    if (password !== passwordConfirmation) return res.status(400).json({ error: 'Şifreler eşleşmiyor' });

    const { rows } = await query('SELECT * FROM auth_challenges WHERE code_hash=$1 AND purpose=$2 AND expires_at > NOW() LIMIT 1', [
      hashChallengeValue(resetToken), 'password_reset_verified'
    ]);
    const record = rows[0];
    if (!record) return res.status(401).json({ error: 'Şifre yenileme oturumu geçersiz veya süresi dolmuş' });

    await query('UPDATE users SET password_hash=$1,password_reset_required=0,password_reset_expires_at=NULL WHERE id=$2', [
      hashPassword(password), record.user_id
    ]);
    await query('DELETE FROM sessions WHERE user_id=$1', [record.user_id]);
    await query('DELETE FROM auth_challenges WHERE user_id=$1 AND purpose IN (\'password_reset\',\'password_reset_verified\')', [record.user_id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Şifre değiştirilemedi' });
  }
});

app.get('/api/profile/2fa', authMiddleware, async (req, res) => {
  res.json({ method: req.user.two_factor_method || 'none', question: req.user.two_factor_question || '', email: maskEmail(req.user.email) });
});

app.put('/api/profile/2fa', authMiddleware, async (req, res) => {
  const { method, question, answer, password } = req.body || {};
  if (!password || !verifyPassword(password, req.user.password_hash)) return res.status(401).json({ error: 'Hesap şifresi yanlış' });
  if (!['none', 'email', 'question'].includes(method)) return res.status(400).json({ error: 'Geçersiz doğrulama yöntemi' });
  if (method === 'email' && (!RESEND_API_KEY || !EMAIL_FROM || !APP_SECRET)) return res.status(503).json({ error: 'E-posta servisi yapılandırılmamış' });
  if (method === 'question' && (!question || normalizeSecurityAnswer(answer).length < 2)) return res.status(400).json({ error: 'Soru ve cevap zorunlu' });
  await query('UPDATE users SET two_factor_method=$1,two_factor_question=$2,two_factor_answer_hash=$3 WHERE id=$4', [method, method === 'question' ? String(question).trim() : '', method === 'question' ? hashPassword(normalizeSecurityAnswer(answer)) : '', req.user.id]);
  res.json({ ok: true, method, question: method === 'question' ? String(question).trim() : '', email: maskEmail(req.user.email) });
});

app.post('/api/profile/email/request', authMiddleware, async (req, res) => {
  try {
    const { new_email, password } = req.body || {};
    const email = String(new_email || '').trim().toLowerCase();
    if (!password || !verifyPassword(password, req.user.password_hash)) return res.status(401).json({ error: 'Hesap şifresi yanlış' });
    if (!isValidEmail(email)) return res.status(400).json({ error: 'Geçerli bir e-posta adresi girin' });
    if (email === String(req.user.email).toLowerCase()) return res.status(400).json({ error: 'Yeni e-posta mevcut e-posta ile aynı' });
    const { rows: existing } = await query('SELECT id FROM users WHERE LOWER(email)=LOWER($1)', [email]);
    if (existing.length) return res.status(400).json({ error: 'Bu e-posta zaten kullanılıyor' });
    if (!RESEND_API_KEY || !EMAIL_FROM || !APP_SECRET) return res.status(503).json({ error: 'E-posta servisi yapılandırılmamış' });
    const challenge = createChallengeToken();
    const code = String(crypto.randomInt(100000, 1000000));
    await query('DELETE FROM auth_challenges WHERE user_id=$1 AND purpose=$2', [req.user.id, 'email_change']);
    await query('INSERT INTO auth_challenges (challenge_hash,user_id,purpose,method,code_hash,target_value,expires_at) VALUES ($1,$2,$3,$4,$5,$6,NOW()+INTERVAL \'10 minutes\')', [hashChallengeValue(challenge), req.user.id, 'email_change', 'email', hashChallengeValue(code), email]);
    await sendEmailCode(email, req.user.username, code);
    res.json({ challenge, maskedEmail: maskEmail(email) });
  } catch (e) { res.status(500).json({ error: 'Doğrulama kodu gönderilemedi' }); }
});

app.post('/api/profile/email/confirm', authMiddleware, async (req, res) => {
  const { challenge, code } = req.body || {};
  if (!/^[a-f0-9]{64}$/i.test(String(challenge || '')) || !/^\d{6}$/.test(String(code || ''))) return res.status(400).json({ error: 'Geçersiz doğrulama bilgisi' });
  const { rows } = await query('SELECT * FROM auth_challenges WHERE challenge_hash=$1 AND user_id=$2 AND purpose=$3 AND expires_at > NOW() LIMIT 1', [hashChallengeValue(challenge), req.user.id, 'email_change']);
  const record = rows[0];
  if (!record || record.attempts >= 5) return res.status(401).json({ error: 'Kod geçersiz veya süresi dolmuş' });
  await query('UPDATE auth_challenges SET attempts=attempts+1 WHERE id=$1', [record.id]);
  if (hashChallengeValue(code) !== record.code_hash) return res.status(401).json({ error: 'Kod geçersiz veya süresi dolmuş' });
  const { rows: existing } = await query('SELECT id FROM users WHERE LOWER(email)=LOWER($1) AND id<>$2', [record.target_value, req.user.id]);
  if (existing.length) return res.status(409).json({ error: 'Bu e-posta artık kullanılıyor' });
  await query('UPDATE users SET email=$1 WHERE id=$2', [record.target_value, req.user.id]);
  await query('DELETE FROM auth_challenges WHERE id=$1', [record.id]);
  res.json({ ok: true, email: record.target_value });
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  const { rows: lvRows } = await query('SELECT * FROM levels WHERE id=$1', [req.user.level_id]);
  res.json({ user: sanitizeUser(req.user), level: lvRows[0] || null });
});

app.post('/api/auth/logout', authMiddleware, async (req, res) => {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  await query('DELETE FROM sessions WHERE token=$1', [token]);
  res.setHeader('Set-Cookie', 'cigcig_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0');
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
  if (!verifyPassword(password, req.user.password_hash)) return res.status(401).json({ error: 'Şifre hatalı' });
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
      : type === 'group_mention'
      ? `@${actorUser.username} seni "${contextTitle}" grubunda etiketledi`
      : `@${actorUser.username} bir mesajında sizi etiketledi`;
    await query(
      'INSERT INTO notifications (user_id, type, actor_username, actor_avatar, title, body, link) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [rows[0].id, type, actorUser.username, actorUser.avatar || '', contextTitle || 'Etiketlendin', body, link]
    );
  }
}

async function notifyGroupMentions(group, actorUser, content) {
  const mentions = [...new Set(
    (content.match(/@([a-zA-Z0-9_çğıöşüÇĞİÖŞÜ]+)/g) || []).map(m => m.slice(1).toLowerCase())
  )];
  for (const username of mentions) {
    if (username === actorUser.username.toLowerCase()) continue;
    const { rows: targetRows } = await query('SELECT id, allow_mentions, tag_permission FROM users WHERE LOWER(username)=$1 AND is_deleted=0', [username]);
    if (!targetRows.length) continue;
    const targetUser = targetRows[0];
    const permission = targetUser.tag_permission || (targetUser.allow_mentions === 0 ? 'nobody' : 'everyone');
    if (permission === 'nobody') continue;
    if (permission === 'friends') {
      const { rows: friendship } = await query("SELECT 1 FROM follows WHERE follower_id=$1 AND following_id=$2 AND status='accepted'", [actorUser.id, targetUser.id]);
      if (!friendship.length) continue;
    }
    const { rows: memberRows } = await query('SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2', [group.id, targetUser.id]);
    if (!memberRows.length) continue;
    await query(
      'INSERT INTO notifications (user_id, type, actor_username, actor_avatar, title, body, link) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [targetUser.id, 'group_mention', actorUser.username, actorUser.avatar || '', group.name || 'Grup', `@${actorUser.username} seni "${group.name}" grubunda etiketledi`, `/grup/${group.slug}`]
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

// ===== VMB ÖZEL ALANI =====
app.get('/api/vmb/public', async (req, res) => {
  try {
    const { rows } = await query(
      "SELECT key,value FROM settings WHERE key IN ('vmb_group_url','vmb_intro','vmb_founder','vmb_image_url')"
    );
    const settings = Object.fromEntries(rows.map(row => [row.key, row.value]));
    res.json({ ...settings, members: [], files: [] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/vmb', requireVmbMiddleware, async (req, res) => {
  try {
    const includeHidden = hasVmbManagementBadge(req.user);
    const { rows: settingRows } = await query(
      "SELECT key,value FROM settings WHERE key IN ('vmb_group_url','vmb_intro','vmb_founder','vmb_image_url','vmb_files')"
    );
    const settings = Object.fromEntries(settingRows.map(row => [row.key, row.value]));
    let files = [];
    try {
      const parsed = JSON.parse(settings.vmb_files || '[]');
      if (Array.isArray(parsed)) files = parsed;
    } catch {}
    const { rows: libraryFiles } = await query(`
      SELECT vf.id, vf.title AS name, vf.description,
        vf.slug, vf.created_at, COUNT(DISTINCT vf2.id)::int AS folder_count,
        COUNT(DISTINCT vp.id)::int AS page_count
      FROM vmb_files vf
      LEFT JOIN vmb_folders vf2 ON vf2.file_id=vf.id AND (vf2.is_hidden=0 OR $1)
      LEFT JOIN vmb_pages vp ON vp.folder_id=vf2.id AND (vp.is_hidden=0 OR $1)
      WHERE vf.is_hidden=0 OR $1
      GROUP BY vf.id
      ORDER BY vf.updated_at DESC, vf.created_at DESC
    `, [includeHidden]);
    files = [...libraryFiles, ...files];
    const { rows: members } = await query(
      `SELECT id,username,avatar,avatar_removed,bio,created_at
       FROM users WHERE is_vmb=1 AND banned=0
         AND LOWER(COALESCE(badge_name,'')) IN ('vmb','vmb yönetim')
       ORDER BY username ASC`
    );
    res.json({
      badge: { name: 'VMB', icon: 'fas fa-shield', color: '#facc15' },
      image_url: settings.vmb_image_url || '',
      intro: settings.vmb_intro || 'Vecd ile Müdafaa Birliği: özel üyeler alanı.',
      founder: settings.vmb_founder || 'VMB Kurucusu',
      group_url: settings.vmb_group_url || '/grup/vmb',
      files,
      can_manage: hasVmbManagementBadge(req.user),
      members
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/vmb/files', requireVmbMiddleware, async (req, res) => {
  const includeHidden = hasVmbManagementBadge(req.user);
  const { rows: files } = await query(`
    SELECT vf.id, vf.title, vf.description, vf.slug, vf.created_at, vf.updated_at,
      COUNT(DISTINCT f.id)::int AS folder_count, COUNT(DISTINCT p.id)::int AS page_count
    FROM vmb_files vf
    LEFT JOIN vmb_folders f ON f.file_id=vf.id
    LEFT JOIN vmb_pages p ON p.folder_id=f.id
    WHERE vf.is_hidden=0 OR $1
    GROUP BY vf.id
    ORDER BY vf.updated_at DESC, vf.created_at DESC
  `, [includeHidden]);
  const { rows: legacyRows } = await query("SELECT value FROM settings WHERE key='vmb_files'");
  let legacyFiles = [];
  try {
    const parsed = JSON.parse(legacyRows[0]?.value || '[]');
    if (Array.isArray(parsed)) legacyFiles = parsed;
  } catch {}
  res.json({ files, legacy_files: legacyFiles, can_manage: hasVmbManagementBadge(req.user) });
});

app.get('/api/vmb/files/:slug', requireVmbMiddleware, async (req, res) => {
  const includeHidden = hasVmbManagementBadge(req.user);
  const { rows: fileRows } = await query('SELECT * FROM vmb_files WHERE slug=$1 AND (is_hidden=0 OR $2)', [req.params.slug, includeHidden]);
  if (!fileRows.length) return res.status(404).json({ error: 'VMB dosyası bulunamadı' });
  const file = fileRows[0];
  const { rows: folders } = await query(`
    SELECT f.*, COUNT(DISTINCT p.id)::int AS page_count, COUNT(DISTINCT a.id)::int AS asset_count
    FROM vmb_folders f
    LEFT JOIN vmb_pages p ON p.folder_id=f.id AND (p.is_hidden=0 OR $2)
    LEFT JOIN vmb_assets a ON a.folder_id=f.id AND (a.is_hidden=0 OR $2)
    WHERE f.file_id=$1 AND f.parent_id IS NULL AND (f.is_hidden=0 OR $2)
    GROUP BY f.id ORDER BY f.order_num ASC, f.name ASC
  `, [file.id, includeHidden]);
  await recordVmbActivity(req.user.id, 'file', file.id, null, null, file.title);
  res.json({ file, folders, assets: [], can_manage: hasVmbManagementBadge(req.user) });
});

app.get('/api/vmb/folder/:id', requireVmbMiddleware, async (req, res) => {
  const includeHidden = hasVmbManagementBadge(req.user);
  const { rows: folderRows } = await query(`
    SELECT f.*, vf.title AS file_title, vf.slug AS file_slug
    FROM vmb_folders f INNER JOIN vmb_files vf ON vf.id=f.file_id
    WHERE f.id=$1 AND (f.is_hidden=0 OR $2) AND (vf.is_hidden=0 OR $2)
  `, [req.params.id, includeHidden]);
  if (!folderRows.length) return res.status(404).json({ error: 'Klasör bulunamadı' });
  const folder = folderRows[0];
  const [childResult, pageResult, assetResult] = await Promise.all([
    query(`SELECT f.*, COUNT(DISTINCT p.id)::int AS page_count, COUNT(DISTINCT a.id)::int AS asset_count
      FROM vmb_folders f LEFT JOIN vmb_pages p ON p.folder_id=f.id AND (p.is_hidden=0 OR $3)
      LEFT JOIN vmb_assets a ON a.folder_id=f.id AND (a.is_hidden=0 OR $3)
      WHERE f.file_id=$1 AND f.parent_id=$2 AND (f.is_hidden=0 OR $3)
      GROUP BY f.id ORDER BY f.order_num ASC, f.name ASC`, [folder.file_id, folder.id, includeHidden]),
    query('SELECT id,title,page_num,slug,image_url,is_hidden,created_at,updated_at FROM vmb_pages WHERE folder_id=$1 AND (is_hidden=0 OR $2) ORDER BY page_num ASC', [folder.id, includeHidden]),
    query('SELECT * FROM vmb_assets WHERE folder_id=$1 AND (is_hidden=0 OR $2) ORDER BY created_at DESC', [folder.id, includeHidden])
  ]);
  await recordVmbActivity(req.user.id, 'folder', folder.file_id, folder.id, null, folder.name);
  res.json({ folder, folders: childResult.rows, pages: pageResult.rows, assets: assetResult.rows, can_manage: hasVmbManagementBadge(req.user) });
});

app.get('/api/vmb/folder/:id/page/:pageSlug', requireVmbMiddleware, async (req, res) => {
  const includeHidden = hasVmbManagementBadge(req.user);
  const { rows } = await query(`
    SELECT p.*, f.name AS folder_name, f.file_id, vf.title AS file_title, vf.slug AS file_slug
    FROM vmb_pages p INNER JOIN vmb_folders f ON f.id=p.folder_id
    INNER JOIN vmb_files vf ON vf.id=f.file_id
    WHERE p.folder_id=$1 AND p.slug=$2 AND (p.is_hidden=0 OR $3)
      AND (f.is_hidden=0 OR $3) AND (vf.is_hidden=0 OR $3)
  `, [req.params.id, req.params.pageSlug, includeHidden]);
  if (!rows.length) return res.status(404).json({ error: 'Sayfa bulunamadı' });
  const page = rows[0];
  const { rows: prev } = await query('SELECT slug,title FROM vmb_pages WHERE folder_id=$1 AND page_num=$2 AND (is_hidden=0 OR $3)', [page.folder_id, page.page_num - 1, includeHidden]);
  const { rows: next } = await query('SELECT slug,title FROM vmb_pages WHERE folder_id=$1 AND page_num=$2 AND (is_hidden=0 OR $3)', [page.folder_id, page.page_num + 1, includeHidden]);
  await recordVmbActivity(req.user.id, 'page', page.file_id, page.folder_id, page.id, page.title);
  res.json({ page, prev: prev[0] || null, next: next[0] || null });
});

app.post('/api/vmb/files', requireVmbManagerMiddleware, async (req, res) => {
  const title = String(req.body.title || '').trim();
  const description = String(req.body.description || '').trim();
  if (!title || title.length > 120) return res.status(400).json({ error: 'Dosya adı 1-120 karakter olmalı' });
  const { rows } = await query('INSERT INTO vmb_files(title,description,slug,created_by) VALUES($1,$2,$3,$4) RETURNING *',
    [title, description, `vmb-${randomUUID().slice(0, 8)}`, req.user.id]);
  res.json(rows[0]);
});

app.put('/api/vmb/files/:slug', requireVmbManagerMiddleware, async (req, res) => {
  const { rows } = await query('SELECT * FROM vmb_files WHERE slug=$1', [req.params.slug]);
  if (!rows.length) return res.status(404).json({ error: 'VMB dosyası bulunamadı' });
  const title = String(req.body.title ?? rows[0].title).trim();
  const description = String(req.body.description ?? rows[0].description).trim();
  if (!title || title.length > 120) return res.status(400).json({ error: 'Dosya adı 1-120 karakter olmalı' });
  const { rows: updated } = await query('UPDATE vmb_files SET title=$1,description=$2,updated_at=NOW() WHERE id=$3 RETURNING *',
    [title, description, rows[0].id]);
  res.json(updated[0]);
});

app.delete('/api/vmb/files/:slug', requireVmbManagerMiddleware, async (req, res) => {
  const result = await query('DELETE FROM vmb_files WHERE slug=$1 RETURNING id', [req.params.slug]);
  if (!result.rows.length) return res.status(404).json({ error: 'VMB dosyası bulunamadı' });
  res.json({ ok: true });
});

app.post('/api/vmb/folders', requireVmbManagerMiddleware, async (req, res) => {
  const fileId = Number(req.body.file_id);
  const parentId = req.body.parent_id ? Number(req.body.parent_id) : null;
  const name = String(req.body.name || '').trim();
  if (!Number.isSafeInteger(fileId) || !name || name.length > 120) return res.status(400).json({ error: 'Geçerli bir klasör adı gerekli' });
  const { rows: fileRows } = await query('SELECT id FROM vmb_files WHERE id=$1', [fileId]);
  if (!fileRows.length) return res.status(404).json({ error: 'VMB dosyası bulunamadı' });
  if (parentId) {
    const { rows: parentRows } = await query('SELECT id FROM vmb_folders WHERE id=$1 AND file_id=$2', [parentId, fileId]);
    if (!parentRows.length) return res.status(400).json({ error: 'Üst klasör geçersiz' });
  }
  const { rows } = await query('INSERT INTO vmb_folders(file_id,parent_id,name,description,created_by) VALUES($1,$2,$3,$4,$5) RETURNING *',
    [fileId, parentId, name, String(req.body.description || '').trim(), req.user.id]);
  await query('UPDATE vmb_files SET updated_at=NOW() WHERE id=$1', [fileId]);
  res.json(rows[0]);
});

app.put('/api/vmb/folders/:id', requireVmbManagerMiddleware, async (req, res) => {
  const { rows } = await query('SELECT * FROM vmb_folders WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Klasör bulunamadı' });
  const name = String(req.body.name ?? rows[0].name).trim();
  if (!name || name.length > 120) return res.status(400).json({ error: 'Geçerli bir klasör adı gerekli' });
  const { rows: updated } = await query('UPDATE vmb_folders SET name=$1,description=$2,updated_at=NOW() WHERE id=$3 RETURNING *',
    [name, String(req.body.description ?? rows[0].description).trim(), rows[0].id]);
  await query('UPDATE vmb_files SET updated_at=NOW() WHERE id=$1', [rows[0].file_id]);
  res.json(updated[0]);
});

app.delete('/api/vmb/folders/:id', requireVmbManagerMiddleware, async (req, res) => {
  const result = await query('DELETE FROM vmb_folders WHERE id=$1 RETURNING file_id', [req.params.id]);
  if (!result.rows.length) return res.status(404).json({ error: 'Klasör bulunamadı' });
  await query('UPDATE vmb_files SET updated_at=NOW() WHERE id=$1', [result.rows[0].file_id]);
  res.json({ ok: true });
});

app.post('/api/vmb/folders/:id/pages', requireVmbManagerMiddleware, async (req, res) => {
  const { rows: folderRows } = await query('SELECT * FROM vmb_folders WHERE id=$1', [req.params.id]);
  if (!folderRows.length) return res.status(404).json({ error: 'Klasör bulunamadı' });
  const title = String(req.body.title || '').trim();
  const content = String(req.body.content || '').trim();
  if (!title || !content) return res.status(400).json({ error: 'Sayfa adı ve içerik zorunlu' });
  const { rows: countRows } = await query('SELECT COUNT(*)::int AS count FROM vmb_pages WHERE folder_id=$1', [req.params.id]);
  const { rows } = await query(`INSERT INTO vmb_pages(folder_id,title,content,page_num,slug,image_url,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [req.params.id, title, content, countRows[0].count + 1, `vmb-page-${randomUUID().slice(0, 8)}`, String(req.body.image_url || ''), req.user.id]);
  await query('UPDATE vmb_folders SET updated_at=NOW() WHERE id=$1', [req.params.id]);
  res.json(rows[0]);
});

app.put('/api/vmb/folder/:id/page/:pageSlug', requireVmbManagerMiddleware, async (req, res) => {
  const { rows } = await query('SELECT * FROM vmb_pages WHERE folder_id=$1 AND slug=$2', [req.params.id, req.params.pageSlug]);
  if (!rows.length) return res.status(404).json({ error: 'Sayfa bulunamadı' });
  const title = String(req.body.title ?? rows[0].title).trim();
  const content = String(req.body.content ?? rows[0].content).trim();
  if (!title || !content) return res.status(400).json({ error: 'Sayfa adı ve içerik zorunlu' });
  const { rows: updated } = await query('UPDATE vmb_pages SET title=$1,content=$2,image_url=$3,updated_at=NOW() WHERE id=$4 RETURNING *',
    [title, content, String(req.body.image_url ?? rows[0].image_url).trim(), rows[0].id]);
  res.json(updated[0]);
});

app.delete('/api/vmb/folder/:id/page/:pageSlug', requireVmbManagerMiddleware, async (req, res) => {
  const result = await query('DELETE FROM vmb_pages WHERE folder_id=$1 AND slug=$2 RETURNING id,folder_id', [req.params.id, req.params.pageSlug]);
  if (!result.rows.length) return res.status(404).json({ error: 'Sayfa bulunamadı' });
  await query(`WITH ordered AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY page_num ASC, id ASC)::int AS next_num
    FROM vmb_pages WHERE folder_id=$1
  ) UPDATE vmb_pages p SET page_num=ordered.next_num FROM ordered WHERE p.id=ordered.id`, [req.params.id]);
  res.json({ ok: true });
});

app.post('/api/vmb/folders/:id/assets', requireVmbManagerMiddleware, (req, res, next) => {
  vmbUpload.single('file')(req, res, error => {
    if (error) return res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'Dosya boyutu 50 MB sınırını geçemez.' : error.message });
    next();
  });
}, async (req, res) => {
  const { rows: folderRows } = await query('SELECT id FROM vmb_folders WHERE id=$1', [req.params.id]);
  if (!folderRows.length) return res.status(404).json({ error: 'Klasör bulunamadı' });
  if (!req.file) return res.status(400).json({ error: 'Dosya seçin' });
  try {
    const url = await handleVmbUpload(req.file);
    const name = String(req.body.name || req.file.originalname || 'Dosya').trim().slice(0, 180);
    const { rows } = await query(`INSERT INTO vmb_assets(folder_id,name,url,mime_type,size_bytes,created_by)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.params.id, name || 'Dosya', url, req.file.mimetype || 'application/octet-stream', req.file.size || 0, req.user.id]);
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: 'Dosya yüklenemedi: ' + e.message });
  }
});

app.delete('/api/vmb/assets/:id', requireVmbManagerMiddleware, async (req, res) => {
  const result = await query('DELETE FROM vmb_assets WHERE id=$1 RETURNING id', [req.params.id]);
  if (!result.rows.length) return res.status(404).json({ error: 'Dosya bulunamadı' });
  res.json({ ok: true });
});

// ===== VMB YÖNETİM PANELİ API =====
app.get('/api/vmb-admin/me', vmbAdminMiddleware, (req, res) => {
  res.json({ username: req.vmbAdmin.username, sections: ['members', 'badges', 'files'] });
});

app.get('/api/vmb-admin/overview', vmbAdminMiddleware, async (req, res) => {
  const [memberCount, managerCount, fileCount, hiddenCount, activityCount] = await Promise.all([
    query('SELECT COUNT(*)::int AS count FROM users WHERE is_vmb=1 AND LOWER(COALESCE(badge_name,\'\')) IN (\'vmb\',\'vmb yönetim\')'),
    query("SELECT COUNT(*)::int AS count FROM users WHERE is_vmb=1 AND LOWER(COALESCE(badge_name,''))='vmb yönetim'"),
    query('SELECT COUNT(*)::int AS count FROM vmb_files'),
    query('SELECT COUNT(*)::int AS count FROM vmb_files WHERE is_hidden=1'),
    query('SELECT COUNT(*)::int AS count FROM vmb_activity')
  ]);
  res.json({
    members: memberCount.rows[0].count,
    managers: managerCount.rows[0].count,
    files: fileCount.rows[0].count,
    hidden_files: hiddenCount.rows[0].count,
    activity: activityCount.rows[0].count
  });
});

app.get('/api/vmb-admin/members', vmbAdminMiddleware, async (req, res) => {
  const { rows } = await query(`
    SELECT u.id,u.username,u.email,u.avatar,u.avatar_removed,u.bio,u.created_at,u.last_active,u.is_vmb,u.badge_name,
      u.badge_icon,u.badge_color,u.vmb_granted_at,
      (SELECT json_build_object(
        'type',a.activity_type,'detail',a.detail,'viewed_at',a.viewed_at,
        'file_id',a.file_id,'folder_id',a.folder_id,'page_id',a.page_id
       ) FROM vmb_activity a WHERE a.user_id=u.id ORDER BY a.viewed_at DESC LIMIT 1) AS last_activity,
      (SELECT COUNT(*)::int FROM vmb_activity a WHERE a.user_id=u.id) AS activity_count
    FROM users u
    WHERE u.is_vmb=1 AND LOWER(COALESCE(u.badge_name,'')) IN ('vmb','vmb yönetim')
    ORDER BY COALESCE(u.vmb_granted_at,u.created_at) DESC, u.username ASC
  `);
  res.json(rows);
});

app.get('/api/vmb-admin/members/:id', vmbAdminMiddleware, async (req, res) => {
  const { rows: memberRows } = await query(
    `SELECT id,username,email,avatar,avatar_removed,bio,created_at,last_active,is_vmb,badge_name,badge_icon,badge_color,vmb_granted_at
     FROM users WHERE id=$1 AND is_vmb=1 AND LOWER(COALESCE(badge_name,'')) IN ('vmb','vmb yönetim')`,
    [req.params.id]
  );
  if (!memberRows.length) return res.status(404).json({ error: 'VMB üyesi bulunamadı' });
  const [activity, reads] = await Promise.all([
    query(`SELECT a.*,vf.title AS file_title,f.name AS folder_name,p.title AS page_title
      FROM vmb_activity a
      LEFT JOIN vmb_files vf ON vf.id=a.file_id
      LEFT JOIN vmb_folders f ON f.id=a.folder_id
      LEFT JOIN vmb_pages p ON p.id=a.page_id
      WHERE a.user_id=$1 ORDER BY a.viewed_at DESC LIMIT 100`, [req.params.id]),
    query(`SELECT vf.id,vf.title,vf.is_hidden,MAX(a.viewed_at) AS last_viewed,COUNT(*)::int AS visits
      FROM vmb_activity a INNER JOIN vmb_files vf ON vf.id=a.file_id
      WHERE a.user_id=$1 GROUP BY vf.id ORDER BY last_viewed DESC`, [req.params.id])
  ]);
  res.json({ member: memberRows[0], activity: activity.rows, reads: reads.rows });
});

app.get('/api/vmb-admin/users', vmbAdminMiddleware, async (req, res) => {
  const search = String(req.query.search || '').trim();
  const { rows } = await query(
    `SELECT id,username,email,avatar,is_vmb,badge_name,badge_icon,badge_color
     FROM users
     WHERE ($1='' OR username ILIKE $2 OR email ILIKE $2)
     ORDER BY username ASC LIMIT 100`,
    [search, `%${search}%`]
  );
  res.json(rows);
});

app.get('/api/vmb-admin/badges', vmbAdminMiddleware, async (req, res) => {
  const { rows } = await query(`
    SELECT badge_name AS name,
      CASE WHEN LOWER(badge_name)='vmb yönetim' THEN 'fas fa-crown' ELSE 'fas fa-shield-halved' END AS icon,
      CASE WHEN LOWER(badge_name)='vmb yönetim' THEN '#fbbf24' ELSE '#facc15' END AS color,
      COUNT(*)::int AS member_count
    FROM users
    WHERE is_vmb=1 AND LOWER(COALESCE(badge_name,'')) IN ('vmb','vmb yönetim')
    GROUP BY badge_name ORDER BY CASE WHEN LOWER(badge_name)='vmb yönetim' THEN 1 ELSE 0 END
  `);
  res.json([
    { name: 'VMB', icon: 'fas fa-shield-halved', color: '#facc15', description: 'VMB özel alanını görüntüleme rozeti.', member_count: Number(rows.find(row => row.name === 'VMB')?.member_count || 0) },
    { name: 'VMB Yönetim', icon: 'fas fa-crown', color: '#fbbf24', description: 'VMB arşivinde ekleme, düzenleme, gizleme ve silme yetkisi.', member_count: Number(rows.find(row => row.name === 'VMB Yönetim')?.member_count || 0) }
  ]);
});

app.put('/api/vmb-admin/users/:id/badge', vmbAdminMiddleware, async (req, res) => {
  const requested = String(req.body.badge || '').trim();
  const badge = requested === 'VMB Yönetim' ? 'VMB Yönetim' : requested === 'VMB' ? 'VMB' : '';
  const { rows } = await query('SELECT id,username,is_vmb,badge_name FROM users WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  const current = rows[0];
  if (!badge) {
    await query(`UPDATE users SET is_vmb=0,badge_name=CASE WHEN LOWER(COALESCE(badge_name,'')) IN ('vmb','vmb yönetim') THEN '' ELSE badge_name END,
      badge_icon=CASE WHEN LOWER(COALESCE(badge_name,'')) IN ('vmb','vmb yönetim') THEN '' ELSE badge_icon END,
      badge_color=CASE WHEN LOWER(COALESCE(badge_name,'')) IN ('vmb','vmb yönetim') THEN '#6b7280' ELSE badge_color END,
      vmb_granted_at=NULL WHERE id=$1`, [req.params.id]);
  } else {
    await query(`UPDATE users SET is_vmb=1,badge_name=$1,badge_icon=$2,badge_color=$3,vmb_granted_at=COALESCE(vmb_granted_at,NOW()) WHERE id=$4`,
      [badge, badge === 'VMB Yönetim' ? 'fas fa-crown' : 'fas fa-shield-halved', badge === 'VMB Yönetim' ? '#fbbf24' : '#facc15', req.params.id]);
    if (!current.is_vmb || String(current.badge_name || '').toLowerCase() !== badge.toLowerCase()) {
      await query(`INSERT INTO notifications(user_id,type,actor_username,title,body,link)
        VALUES($1,'vmb_granted','VMB Paneli','VMB erişimi güncellendi',$2,'/vmb')`,
        [req.params.id, `${badge} rozeti hesabınıza tanımlandı.`]);
    }
  }
  await logAction(req.vmbAdmin.username, badge ? 'vmb_badge_granted' : 'vmb_badge_revoked', rows[0].username, badge);
  const { rows: updated } = await query('SELECT id,username,is_vmb,badge_name,badge_icon,badge_color,vmb_granted_at FROM users WHERE id=$1', [req.params.id]);
  res.json(updated[0]);
});

app.put('/api/vmb-admin/users/:id/membership', vmbAdminMiddleware, async (req, res) => {
  const active = boolValue(req.body.active);
  const { rows } = await query('SELECT id,username,badge_name FROM users WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  const existingBadge = String(rows[0].badge_name || '').toLocaleLowerCase('tr-TR');
  const badge = existingBadge === 'vmb yönetim' ? 'VMB Yönetim' : 'VMB';
  await query(`UPDATE users SET is_vmb=$1,
    badge_name=CASE WHEN $1=1 THEN $2 ELSE CASE WHEN LOWER(COALESCE(badge_name,'')) IN ('vmb','vmb yönetim') THEN '' ELSE badge_name END END,
    badge_icon=CASE WHEN $1=1 THEN CASE WHEN $2='VMB Yönetim' THEN 'fas fa-crown' ELSE 'fas fa-shield-halved' END ELSE CASE WHEN LOWER(COALESCE(badge_name,'')) IN ('vmb','vmb yönetim') THEN '' ELSE badge_icon END END,
    badge_color=CASE WHEN $1=1 THEN CASE WHEN $2='VMB Yönetim' THEN '#fbbf24' ELSE '#facc15' END ELSE CASE WHEN LOWER(COALESCE(badge_name,'')) IN ('vmb','vmb yönetim') THEN '#6b7280' ELSE badge_color END END,
    vmb_granted_at=CASE WHEN $1=1 THEN COALESCE(vmb_granted_at,NOW()) ELSE NULL END WHERE id=$3`,
    [active, badge, req.params.id]);
  await logAction(req.vmbAdmin.username, active ? 'vmb_membership_activated' : 'vmb_membership_cancelled', rows[0].username);
  res.json({ ok: true, active: !!active });
});

app.get('/api/vmb-admin/files', vmbAdminMiddleware, async (req, res) => {
  const { rows } = await query(`
    SELECT vf.*,u.username AS created_by_username,
      COUNT(DISTINCT f.id)::int AS folder_count,COUNT(DISTINCT p.id)::int AS page_count,
      COUNT(DISTINCT a.user_id)::int AS reader_count,MAX(a.viewed_at) AS last_read_at
    FROM vmb_files vf LEFT JOIN users u ON u.id=vf.created_by
      LEFT JOIN vmb_folders f ON f.file_id=vf.id LEFT JOIN vmb_pages p ON p.folder_id=f.id
      LEFT JOIN vmb_activity a ON a.file_id=vf.id
    GROUP BY vf.id,u.username ORDER BY vf.updated_at DESC,vf.created_at DESC
  `);
  res.json(rows);
});

app.get('/api/vmb-admin/files/:id', vmbAdminMiddleware, async (req, res) => {
  const { rows: files } = await query('SELECT vf.*,u.username AS created_by_username FROM vmb_files vf LEFT JOIN users u ON u.id=vf.created_by WHERE vf.id=$1', [req.params.id]);
  if (!files.length) return res.status(404).json({ error: 'VMB dosyası bulunamadı' });
  const [folders, pages, assets, readers] = await Promise.all([
    query(`SELECT f.*,u.username AS created_by_username FROM vmb_folders f LEFT JOIN users u ON u.id=f.created_by WHERE f.file_id=$1 ORDER BY f.parent_id NULLS FIRST,f.order_num,f.name`, [req.params.id]),
    query(`SELECT p.*,f.name AS folder_name,u.username AS created_by_username FROM vmb_pages p INNER JOIN vmb_folders f ON f.id=p.folder_id LEFT JOIN users u ON u.id=p.created_by WHERE f.file_id=$1 ORDER BY f.name,p.page_num,p.id`, [req.params.id]),
    query(`SELECT a.*,f.name AS folder_name,u.username AS created_by_username FROM vmb_assets a INNER JOIN vmb_folders f ON f.id=a.folder_id LEFT JOIN users u ON u.id=a.created_by WHERE f.file_id=$1 ORDER BY a.created_at DESC`, [req.params.id]),
    query(`SELECT u.id,u.username,u.avatar,MAX(a.viewed_at) AS last_viewed,COUNT(*)::int AS visits,
      STRING_AGG(DISTINCT a.activity_type,', ' ORDER BY a.activity_type) AS opened_types
      FROM vmb_activity a INNER JOIN users u ON u.id=a.user_id WHERE a.file_id=$1 GROUP BY u.id ORDER BY last_viewed DESC`, [req.params.id])
  ]);
  res.json({ file: files[0], folders: folders.rows, pages: pages.rows, assets: assets.rows, readers: readers.rows });
});

app.post('/api/vmb-admin/files', vmbAdminMiddleware, async (req, res) => {
  const title = String(req.body.title || '').trim();
  if (!title || title.length > 120) return res.status(400).json({ error: 'Dosya adı 1-120 karakter olmalı' });
  const { rows } = await query('INSERT INTO vmb_files(title,description,slug,is_hidden) VALUES($1,$2,$3,$4) RETURNING *',
    [title, String(req.body.description || '').trim(), `vmb-${randomUUID().slice(0, 8)}`, boolValue(req.body.is_hidden)]);
  await logAction(req.vmbAdmin.username, 'vmb_file_created', title);
  res.json(rows[0]);
});

app.put('/api/vmb-admin/files/:id', vmbAdminMiddleware, async (req, res) => {
  const title = String(req.body.title || '').trim();
  if (!title || title.length > 120) return res.status(400).json({ error: 'Dosya adı 1-120 karakter olmalı' });
  const { rows } = await query('UPDATE vmb_files SET title=$1,description=$2,is_hidden=$3,updated_at=NOW() WHERE id=$4 RETURNING *',
    [title, String(req.body.description || '').trim(), boolValue(req.body.is_hidden), req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'VMB dosyası bulunamadı' });
  res.json(rows[0]);
});

app.delete('/api/vmb-admin/files/:id', vmbAdminMiddleware, async (req, res) => {
  const { rows } = await query('DELETE FROM vmb_files WHERE id=$1 RETURNING title', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'VMB dosyası bulunamadı' });
  await logAction(req.vmbAdmin.username, 'vmb_file_deleted', rows[0].title);
  res.json({ ok: true });
});

app.post('/api/vmb-admin/folders', vmbAdminMiddleware, async (req, res) => {
  const fileId = Number(req.body.file_id);
  const parentId = req.body.parent_id ? Number(req.body.parent_id) : null;
  const name = String(req.body.name || '').trim();
  if (!Number.isSafeInteger(fileId) || !name || name.length > 120) return res.status(400).json({ error: 'Geçerli bir klasör adı gerekli' });
  const { rows: fileRows } = await query('SELECT id FROM vmb_files WHERE id=$1', [fileId]);
  if (!fileRows.length) return res.status(404).json({ error: 'VMB dosyası bulunamadı' });
  if (parentId) {
    const { rows: parentRows } = await query('SELECT id FROM vmb_folders WHERE id=$1 AND file_id=$2', [parentId, fileId]);
    if (!parentRows.length) return res.status(400).json({ error: 'Üst klasör geçersiz' });
  }
  const { rows } = await query('INSERT INTO vmb_folders(file_id,parent_id,name,description,is_hidden,created_by) VALUES($1,$2,$3,$4,$5,NULL) RETURNING *',
    [fileId, parentId, name, String(req.body.description || '').trim(), boolValue(req.body.is_hidden)]);
  await query('UPDATE vmb_files SET updated_at=NOW() WHERE id=$1', [fileId]);
  res.json(rows[0]);
});

app.put('/api/vmb-admin/folders/:id', vmbAdminMiddleware, async (req, res) => {
  const { rows } = await query('SELECT * FROM vmb_folders WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Klasör bulunamadı' });
  const name = String(req.body.name || '').trim();
  if (!name || name.length > 120) return res.status(400).json({ error: 'Geçerli bir klasör adı gerekli' });
  const { rows: updated } = await query('UPDATE vmb_folders SET name=$1,description=$2,is_hidden=$3,updated_at=NOW() WHERE id=$4 RETURNING *',
    [name, String(req.body.description || '').trim(), boolValue(req.body.is_hidden), req.params.id]);
  await query('UPDATE vmb_files SET updated_at=NOW() WHERE id=$1', [rows[0].file_id]);
  res.json(updated[0]);
});

app.delete('/api/vmb-admin/folders/:id', vmbAdminMiddleware, async (req, res) => {
  const { rows } = await query('DELETE FROM vmb_folders WHERE id=$1 RETURNING file_id', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Klasör bulunamadı' });
  await query('UPDATE vmb_files SET updated_at=NOW() WHERE id=$1', [rows[0].file_id]);
  res.json({ ok: true });
});

app.post('/api/vmb-admin/folders/:id/pages', vmbAdminMiddleware, async (req, res) => {
  const { rows: folders } = await query('SELECT * FROM vmb_folders WHERE id=$1', [req.params.id]);
  if (!folders.length) return res.status(404).json({ error: 'Klasör bulunamadı' });
  const title = String(req.body.title || '').trim();
  const content = String(req.body.content || '').trim();
  if (!title || !content) return res.status(400).json({ error: 'Belge başlığı ve içeriği zorunlu' });
  const { rows: last } = await query('SELECT COALESCE(MAX(page_num),0)::int AS page_num FROM vmb_pages WHERE folder_id=$1', [req.params.id]);
  const { rows } = await query(`INSERT INTO vmb_pages(folder_id,title,content,page_num,slug,image_url,is_hidden,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,NULL) RETURNING *`,
    [req.params.id, title, content, last[0].page_num + 1, `vmb-page-${randomUUID().slice(0, 8)}`, String(req.body.image_url || '').trim(), boolValue(req.body.is_hidden)]);
  await query('UPDATE vmb_folders SET updated_at=NOW() WHERE id=$1', [req.params.id]);
  res.json(rows[0]);
});

app.put('/api/vmb-admin/pages/:id', vmbAdminMiddleware, async (req, res) => {
  const title = String(req.body.title || '').trim();
  const content = String(req.body.content || '').trim();
  if (!title || !content) return res.status(400).json({ error: 'Belge başlığı ve içeriği zorunlu' });
  const { rows } = await query('UPDATE vmb_pages SET title=$1,content=$2,image_url=$3,is_hidden=$4,updated_at=NOW() WHERE id=$5 RETURNING *',
    [title, content, String(req.body.image_url || '').trim(), boolValue(req.body.is_hidden), req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Belge bulunamadı' });
  res.json(rows[0]);
});

app.delete('/api/vmb-admin/pages/:id', vmbAdminMiddleware, async (req, res) => {
  const { rows } = await query('DELETE FROM vmb_pages WHERE id=$1 RETURNING folder_id', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Belge bulunamadı' });
  res.json({ ok: true });
});

app.post('/api/vmb-admin/folders/:id/assets', vmbAdminMiddleware, (req, res, next) => {
  vmbUpload.single('file')(req, res, error => {
    if (error) return res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'Dosya boyutu 50 MB sınırını geçemez.' : error.message });
    next();
  });
}, async (req, res) => {
  const { rows: folders } = await query('SELECT id FROM vmb_folders WHERE id=$1', [req.params.id]);
  if (!folders.length) return res.status(404).json({ error: 'Klasör bulunamadı' });
  if (!req.file) return res.status(400).json({ error: 'Dosya seçin' });
  const url = await handleVmbUpload(req.file);
  const { rows } = await query(`INSERT INTO vmb_assets(folder_id,name,url,mime_type,size_bytes,is_hidden,created_by)
    VALUES($1,$2,$3,$4,$5,$6,NULL) RETURNING *`,
    [req.params.id, String(req.body.name || req.file.originalname || 'Dosya').trim().slice(0, 180), url, req.file.mimetype || 'application/octet-stream', req.file.size || 0, boolValue(req.body.is_hidden)]);
  res.json(rows[0]);
});

app.put('/api/vmb-admin/assets/:id', vmbAdminMiddleware, async (req, res) => {
  const { rows } = await query('UPDATE vmb_assets SET name=$1,is_hidden=$2 WHERE id=$3 RETURNING *',
    [String(req.body.name || '').trim().slice(0, 180), boolValue(req.body.is_hidden), req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Arşiv dosyası bulunamadı' });
  res.json(rows[0]);
});

app.delete('/api/vmb-admin/assets/:id', vmbAdminMiddleware, async (req, res) => {
  const { rows } = await query('DELETE FROM vmb_assets WHERE id=$1 RETURNING id', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Arşiv dosyası bulunamadı' });
  res.json({ ok: true });
});

app.get('/api/vmb-admin/settings', vmbAdminMiddleware, async (req, res) => {
  const { rows } = await query("SELECT key,value FROM settings WHERE key IN ('vmb_group_url','vmb_intro','vmb_founder','vmb_image_url')");
  res.json(Object.fromEntries(rows.map(row => [row.key, row.value])));
});

app.put('/api/vmb-admin/settings', vmbAdminMiddleware, async (req, res) => {
  const allowed = ['vmb_group_url','vmb_intro','vmb_founder','vmb_image_url'];
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      await query('INSERT INTO settings(key,value,updated_at) VALUES($1,$2,NOW()) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()', [key, String(req.body[key] || '').trim()]);
    }
  }
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
    FROM forums f LEFT JOIN users u ON f.user_id=u.id WHERE NOT EXISTS (SELECT 1 FROM content_suspensions cs WHERE cs.content_type='forum' AND cs.content_id=f.id)`;

  if (tag) {
    // Sistem etiketi, custom tag veya içerik içindeki #tag ile filtrele — hepsi case-insensitive
    baseQuery += ` AND (
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
    FROM forums f LEFT JOIN users u ON f.user_id=u.id WHERE f.slug=$1 AND NOT EXISTS (SELECT 1 FROM content_suspensions cs WHERE cs.content_type='forum' AND cs.content_id=f.id)`, [req.params.slug]);
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
  if (await denyIfRestricted(req, res, 'forum')) return;
  try {
    const { title, content, banner_image, allow_comments, tagIds, customTags, banner_fit, images, thumbnail } = req.body;
    if (!title || !content) return res.status(400).json({ error: 'Başlık ve içerik zorunlu' });
    const tempSlug = slugify(title, { lower: true, strict: false, locale: 'tr' }).substring(0, 60) + '-' + randomUUID().substring(0, 8);
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

app.get('/api/forum/:slug/comments', optionalAuth, async (req, res) => {
  const { rows: fRows } = await query('SELECT id FROM forums WHERE slug=$1', [req.params.slug]);
  if (!fRows.length) return res.status(404).json({ error: 'Konu bulunamadı' });
  const { rows } = await query(`
    SELECT fc.*, u.username, u.avatar, u.name_color, u.is_vip, u.is_plus, u.is_admin, u.level_id,
      parent.username AS parent_username,
      (SELECT COUNT(*) FROM forum_comment_likes WHERE comment_id=fc.id) as like_count,
      EXISTS(SELECT 1 FROM forum_comment_likes fcl WHERE fcl.comment_id=fc.id AND fcl.user_id=$2) AS liked
    FROM forum_comments fc
      LEFT JOIN users u ON fc.user_id=u.id
      LEFT JOIN forum_comments parent_comment ON parent_comment.id=fc.parent_comment_id
      LEFT JOIN users parent ON parent.id=parent_comment.user_id
    WHERE fc.forum_id=$1 ORDER BY fc.created_at ASC`, [fRows[0].id, req.user?.id || 0]);
  res.json(rows);
});

app.post('/api/forum/:slug/comments', authMiddleware, async (req, res) => {
  if (await denyIfRestricted(req, res, 'comment')) return;
  const { rows: fRows } = await query('SELECT * FROM forums WHERE slug=$1', [req.params.slug]);
  if (!fRows.length) return res.status(404).json({ error: 'Konu bulunamadı' });
  const forum = fRows[0];
  if (!forum.allow_comments) return res.status(403).json({ error: 'Yorumlar kapalı' });
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Yorum boş olamaz' });
  let parentCommentId = req.body.parent_comment_id ? Number(req.body.parent_comment_id) : null;
  if (parentCommentId !== null && (!Number.isSafeInteger(parentCommentId) || parentCommentId < 1)) {
    return res.status(400).json({ error: 'Geçersiz yanıt hedefi' });
  }
  if (parentCommentId !== null) {
    const { rows: parentRows } = await query('SELECT id FROM forum_comments WHERE id=$1 AND forum_id=$2', [parentCommentId, forum.id]);
    if (!parentRows.length) return res.status(400).json({ error: 'Yanıtlanacak yorum bulunamadı' });
  }
  const { rows } = await query('INSERT INTO forum_comments (forum_id,user_id,parent_comment_id,content) VALUES ($1,$2,$3,$4) RETURNING id', [forum.id, req.user.id, parentCommentId, content.trim()]);
  await query('UPDATE users SET comment_count=comment_count+1 WHERE id=$1', [req.user.id]);
  if (forum.user_id && forum.user_id !== req.user.id) {
    await query('INSERT INTO notifications (user_id,type,actor_username,actor_avatar,title,body,link) VALUES ($1,$2,$3,$4,$5,$6,$7)', [forum.user_id, 'forum_comment', req.user.username, req.user.avatar || '', 'Konuna yorum geldi', `@${req.user.username} konuna yorum yaptı.`, '/forum/' + req.params.slug]).catch(() => {});
  }
  if (parentCommentId !== null) {
    const { rows: parentRows } = await query('SELECT user_id FROM forum_comments WHERE id=$1', [parentCommentId]);
    const parentUserId = parentRows[0]?.user_id;
    if (parentUserId && parentUserId !== req.user.id && parentUserId !== forum.user_id) {
      await query('INSERT INTO notifications (user_id,type,actor_username,actor_avatar,title,body,link) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [parentUserId, 'forum_comment_reply', req.user.username, req.user.avatar || '', 'Yorumuna yanıt geldi', `@${req.user.username} yorumuna yanıt verdi.`, '/forum/' + req.params.slug]).catch(() => {});
    }
  }
  await updateUserLevel(req.user.id);
  // @mention bildirimleri
  await parseMentionsAndNotify(content, req.user, 'comment_mention', '/forum/' + req.params.slug, forum.title).catch(() => {});
  const { rows: cRows } = await query(`SELECT fc.*, u.username, u.avatar, u.name_color, u.is_vip, u.is_plus, u.is_admin, u.level_id,
    parent.username AS parent_username,
    (SELECT COUNT(*) FROM forum_comment_likes WHERE comment_id=fc.id) AS like_count,
    false AS liked
    FROM forum_comments fc
      LEFT JOIN users u ON fc.user_id=u.id
      LEFT JOIN forum_comments parent_comment ON parent_comment.id=fc.parent_comment_id
      LEFT JOIN users parent ON parent.id=parent_comment.user_id
    WHERE fc.id=$1`, [rows[0].id]);
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
function sanitizeBook(book) {
  if (!book) return null;
  const { password_hash, ...safeBook } = book;
  safeBook.has_password = Boolean(password_hash);
  return safeBook;
}

async function canAccessBook(book, userId) {
  if (!userId) return false;
  if (book.user_id == userId) return true;
  const { rows } = await query('SELECT 1 FROM book_access WHERE book_id=$1 AND user_id=$2', [book.id, userId]);
  return rows.length > 0;
}

app.get('/api/books', optionalAuth, async (req, res) => {
  const userId = Number(req.user?.id || 0);
  const { rows } = await query(`SELECT b.*, u.username, u.avatar, u.name_color,
    (b.user_id=${userId} OR EXISTS (SELECT 1 FROM book_access ba WHERE ba.book_id=b.id AND ba.user_id=${userId})) AS has_book_access
    FROM books b LEFT JOIN users u ON b.user_id=u.id
    WHERE NOT EXISTS (SELECT 1 FROM content_suspensions cs WHERE cs.content_type='book' AND cs.content_id=b.id)
      AND (
        b.is_hidden = 0
        OR b.user_id = ${userId}
        OR EXISTS (SELECT 1 FROM book_access ba WHERE ba.book_id=b.id AND ba.user_id=${userId})
      )
    ORDER BY b.created_at DESC`);
  res.json(rows.map(sanitizeBook));
});

app.get('/api/book/:slug', optionalAuth, async (req, res) => {
  const { rows: bRows } = await query(`SELECT b.*, u.username, u.avatar, u.name_color FROM books b LEFT JOIN users u ON b.user_id=u.id WHERE b.slug=$1 AND NOT EXISTS (SELECT 1 FROM content_suspensions cs WHERE cs.content_type='book' AND cs.content_id=b.id)`, [req.params.slug]);
  if (!bRows.length) return res.status(404).json({ error: 'Kitap bulunamadı' });
  const book = bRows[0];
  const isOwner = req.user?.id == book.user_id;
  const hasPasswordAccess = await canAccessBook(book, req.user?.id);
  if (book.password_hash && !hasPasswordAccess) return res.status(403).json({ error: 'Bu kitap şifreli', password_required: true, book: sanitizeBook({ ...book, password_hash: undefined }) });
  if (book.is_hidden && !isOwner && !hasPasswordAccess) return res.status(403).json({ error: 'Bu kitap gizli' });
  const { rows: chapters } = await query('SELECT * FROM book_chapters WHERE book_id=$1 ORDER BY order_num ASC', [book.id]);
  const { rows: pages } = await query('SELECT id,title,page_num,slug,chapter_id FROM book_pages WHERE book_id=$1 ORDER BY page_num ASC', [book.id]);
  res.json({ book: sanitizeBook(book), chapters, pages });
});

app.post('/api/book/:slug/unlock', authMiddleware, async (req, res) => {
  const { rows } = await query('SELECT * FROM books WHERE slug=$1', [req.params.slug]);
  if (!rows.length) return res.status(404).json({ error: 'Kitap bulunamadı' });
  const book = rows[0];
  if (!book.password_hash) return res.status(400).json({ error: 'Bu kitap şifreli değil' });
  if (!verifyPassword(String(req.body.password || ''), book.password_hash)) return res.status(401).json({ error: 'Kitap şifresi yanlış' });
  await query('INSERT INTO book_access (book_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [book.id, req.user.id]);
  res.json({ ok: true });
});

app.post('/api/books', authMiddleware, async (req, res) => {
  try {
    const { title, preface, karakterler, kadro, cover_image, is_hidden, is_unnamed, book_password } = req.body;
    // İsimsiz seçildiyse başlık zorunlu değil, placeholder atanır
    const finalTitle = is_unnamed ? ('İsimsiz Kitap #' + Date.now().toString().slice(-6)) : title;
    if (!is_unnamed && !title) return res.status(400).json({ error: 'Başlık zorunlu' });
    // İsimsiz kitap her zaman gizli olur
    const finalHidden = is_unnamed ? 1 : (is_hidden ? 1 : 0);
    const tempSlug = slugify(finalTitle, { lower: true, strict: false, locale: 'tr' }).substring(0, 60) + '-' + randomUUID().substring(0, 8);
    if (book_password && String(book_password).length < 6) return res.status(400).json({ error: 'Kitap şifresi en az 6 karakter olmalı' });
    const { rows } = await query('INSERT INTO books (user_id,title,preface,karakterler,kadro,cover_image,slug,is_hidden,is_unnamed,password_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id',
      [req.user.id, finalTitle, preface||'', karakterler||'', kadro||'', cover_image||'', tempSlug, finalHidden, is_unnamed?1:0, book_password ? hashPassword(book_password) : '']);
    const id = rows[0].id;
    const realSlug = makeSlug(title, id);
    await query('UPDATE books SET slug=$1 WHERE id=$2', [realSlug, id]);
    await query('UPDATE users SET book_count=book_count+1 WHERE id=$1', [req.user.id]);
    await updateUserLevel(req.user.id);
    await logAction(req.user.username, 'create_book', realSlug);
    const { rows: bRows } = await query('SELECT * FROM books WHERE id=$1', [id]);
    res.json(sanitizeBook(bRows[0]));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.put('/api/book/:slug', authMiddleware, async (req, res) => {
  const { rows: bRows } = await query('SELECT * FROM books WHERE slug=$1', [req.params.slug]);
  if (!bRows.length) return res.status(404).json({ error: 'Kitap bulunamadı' });
  const book = bRows[0];
  if (book.user_id != req.user.id) return res.status(403).json({ error: 'Yetki yok' });
  const { title, preface, karakterler, kadro, cover_image, is_hidden, is_unnamed, book_password } = req.body;
  // Başlık güncellendiyse ve is_unnamed sıfırlanmadıysa, is_unnamed'i sıfırla
  const newIsUnnamed = is_unnamed !== undefined ? (is_unnamed ? 1 : 0) : book.is_unnamed;
  const newPassword = typeof book_password === 'string' ? book_password.trim() : '';
  if (newPassword && newPassword.length < 6) return res.status(400).json({ error: 'Kitap şifresi en az 6 karakter olmalı' });
  const updateValues = [title||book.title, preface??book.preface, karakterler??book.karakterler, kadro??book.kadro, cover_image??book.cover_image, is_hidden!==undefined ? (is_hidden?1:0) : book.is_hidden, newIsUnnamed, book.id];
  if (newPassword) {
    await query('UPDATE books SET title=$1,preface=$2,karakterler=$3,kadro=$4,cover_image=$5,is_hidden=$6,is_unnamed=$7,password_hash=$8,updated_at=NOW() WHERE id=$9',
      [...updateValues.slice(0, 7), hashPassword(newPassword), updateValues[7]]);
    await query('DELETE FROM book_access WHERE book_id=$1 AND user_id<>$2', [book.id, req.user.id]);
  } else {
    await query('UPDATE books SET title=$1,preface=$2,karakterler=$3,kadro=$4,cover_image=$5,is_hidden=$6,is_unnamed=$7,updated_at=NOW() WHERE id=$8', updateValues);
  }
  const { rows } = await query('SELECT * FROM books WHERE id=$1', [book.id]);
  res.json(sanitizeBook(rows[0]));
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
  const isOwner = req.user?.id == book.user_id;
  const hasPasswordAccess = await canAccessBook(book, req.user?.id);
  if (book.password_hash && !hasPasswordAccess) return res.status(403).json({ error: 'Bu kitap şifreli', password_required: true });
  if (book.is_hidden && !isOwner && !hasPasswordAccess) return res.status(403).json({ error: 'Bu kitap gizli' });
  const { rows: pRows } = await query('SELECT * FROM book_pages WHERE slug=$1 AND book_id=$2', [req.params.pageSlug, book.id]);
  if (!pRows.length) return res.status(404).json({ error: 'Sayfa bulunamadı' });
  const page = pRows[0];
  const { rows: prev } = await query('SELECT slug,title FROM book_pages WHERE book_id=$1 AND page_num=$2', [book.id, page.page_num-1]);
  const { rows: next } = await query('SELECT slug,title FROM book_pages WHERE book_id=$1 AND page_num=$2', [book.id, page.page_num+1]);
  res.json({ page, book: sanitizeBook(book), prev: prev[0]||null, next: next[0]||null });
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
app.get('/api/groups', optionalAuth, async (req, res) => {
  const userId = Number(req.user?.id || 0);
  const { rows } = await query(`SELECT g.*, u.username as owner_name, EXISTS (SELECT 1 FROM group_members gm WHERE gm.group_id=g.id AND gm.user_id=${userId}) AS is_member FROM groups g LEFT JOIN users u ON g.owner_id=u.id WHERE COALESCE(g.visibility, CASE WHEN g.type='private' THEN 'private' WHEN g.invite_only=1 THEN 'invite' ELSE 'public' END) <> 'private' OR g.owner_id=${userId} OR EXISTS (SELECT 1 FROM group_members gm2 WHERE gm2.group_id=g.id AND gm2.user_id=${userId}) ORDER BY g.created_at DESC`);
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
  if (await denyIfGroupUnavailable(req, res, group)) return;
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
  if (await denyIfRestricted(req, res, 'group')) return;
  try {
    const { name, description, cover_image, banner_image, type, visibility, allow_chat, allow_photos, invite_only } = req.body;
    if (!name) return res.status(400).json({ error: 'İsim zorunlu' });
    const groupVisibility = ['public', 'invite', 'private'].includes(visibility) ? visibility : (type === 'private' ? 'private' : invite_only ? 'invite' : 'public');
    const tempSlug = slugify(name, { lower: true, strict: false, locale: 'tr' }).substring(0, 60) + '-' + randomUUID().substring(0, 8);
    const { rows } = await query(
      'INSERT INTO groups (name,slug,description,cover_image,banner_image,owner_id,type,visibility,allow_chat,allow_photos,invite_only,member_count) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,1) RETURNING id',
      [name, tempSlug, description||'', cover_image||'', banner_image||'', req.user.id, groupVisibility === 'private' ? 'private' : 'public', groupVisibility, allow_chat!==false?1:0, allow_photos!==false?1:0, groupVisibility === 'public' ? 0 : 1]);
    const id = rows[0].id;
    const realSlug = makeSlug(name, id);
    await query('UPDATE groups SET slug=$1 WHERE id=$2', [realSlug, id]);
    await query('INSERT INTO group_members (group_id,user_id,role) VALUES ($1,$2,$3)', [id, req.user.id, 'owner']);
    if (groupVisibility !== 'public') {
      await query('INSERT INTO group_invites (group_id,invite_code,created_by) VALUES ($1,$2,$3)', [id, randomUUID().substring(0, 8).toUpperCase(), req.user.id]);
    }
    await logAction(req.user.username, 'create_group', realSlug);
    const { rows: gRows } = await query('SELECT * FROM groups WHERE id=$1', [id]);
    res.json(gRows[0]);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.put('/api/group/:slug', authMiddleware, async (req, res) => {
  const { rows } = await query('SELECT * FROM groups WHERE slug=$1', [req.params.slug]);
  if (!rows.length) return res.status(404).json({ error: 'Grup bulunamadı' });
  const group = rows[0];
  if (await denyIfGroupUnavailable(req, res, group)) return;
  if (group.owner_id != req.user.id) return res.status(403).json({ error: 'Yetki yok' });
  const { name, description, cover_image, banner_image, type, visibility, allow_chat, allow_photos, invite_only } = req.body;
  const groupVisibility = ['public', 'invite', 'private'].includes(visibility) ? visibility : (type === 'private' ? 'private' : invite_only ? 'invite' : 'public');
  const resolvedCover = cover_image !== undefined ? cover_image : (group.cover_image || '');
  const resolvedBanner = banner_image !== undefined ? banner_image : (group.banner_image || '');
  await query('UPDATE groups SET name=$1,description=$2,cover_image=$3,banner_image=$4,type=$5,visibility=$6,allow_chat=$7,allow_photos=$8,invite_only=$9 WHERE id=$10',
    [name||group.name, description??group.description, resolvedCover, resolvedBanner,
     groupVisibility === 'private' ? 'private' : 'public', groupVisibility, allow_chat!==undefined?(allow_chat?1:0):group.allow_chat,
     allow_photos!==undefined?(allow_photos?1:0):group.allow_photos,
     groupVisibility === 'public' ? 0 : 1, group.id]);
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
  if (await denyIfRestricted(req, res, 'group')) return;
  const { rows } = await query('SELECT * FROM groups WHERE slug=$1', [req.params.slug]);
  if (!rows.length) return res.status(404).json({ error: 'Grup bulunamadı' });
  const group = rows[0];
  if (await denyIfGroupUnavailable(req, res, group)) return;
  if ((group.visibility || (group.type === 'private' ? 'private' : group.invite_only ? 'invite' : 'public')) !== 'public') return res.status(403).json({ error: 'Bu grup sadece davet kodu ile katılabilir' });
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
  if (await denyIfGroupUnavailable(req, res, group)) return;
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
  const maxUses = Math.max(0, Math.min(Number.parseInt(req.body.max_uses, 10) || 0, 100000));
  const hours = Math.max(0, Math.min(Number.parseInt(req.body.expires_hours, 10) || 0, 8760));
  const code = randomUUID().substring(0, 8).toUpperCase();
  const expiresAt = hours ? new Date(Date.now() + hours * 3600000) : null;
  await query('INSERT INTO group_invites (group_id,invite_code,created_by,max_uses,use_count,expires_at) VALUES ($1,$2,$3,$4,0,$5)', [group.id, code, req.user.id, maxUses, expiresAt]);
  res.json({ invite_code: code, max_uses: maxUses, expires_at: expiresAt });
});

app.get('/api/group/:slug/invites', authMiddleware, async (req, res) => {
  const { rows: groupRows } = await query('SELECT id, owner_id FROM groups WHERE slug=$1', [req.params.slug]);
  if (!groupRows.length) return res.status(404).json({ error: 'Grup bulunamadı' });
  if (groupRows[0].owner_id != req.user.id) return res.status(403).json({ error: 'Yalnızca kurucu davet geçmişini görebilir' });
  const { rows } = await query(`
    SELECT gi.id, gi.invite_code, gi.max_uses, gi.use_count, gi.expires_at, gi.revoked_at, gi.created_at,
           u.username AS created_by_name,
           CASE
             WHEN gi.revoked_at IS NOT NULL THEN 'revoked'
             WHEN gi.expires_at IS NOT NULL AND gi.expires_at <= NOW() THEN 'expired'
             WHEN gi.max_uses > 0 AND gi.use_count >= gi.max_uses THEN 'exhausted'
             ELSE 'active'
           END AS status
    FROM group_invites gi
    LEFT JOIN users u ON u.id=gi.created_by
    WHERE gi.group_id=$1
    ORDER BY gi.created_at DESC
  `, [groupRows[0].id]);
  res.json(rows);
});

app.patch('/api/group/:slug/invites/:inviteId', authMiddleware, async (req, res) => {
  const { rows: groupRows } = await query('SELECT id, owner_id FROM groups WHERE slug=$1', [req.params.slug]);
  if (!groupRows.length) return res.status(404).json({ error: 'Grup bulunamadı' });
  if (groupRows[0].owner_id != req.user.id) return res.status(403).json({ error: 'Yalnızca kurucu davet kodlarını yönetebilir' });
  const active = req.body.active === true || req.body.active === 'true';
  const { rows } = await query('UPDATE group_invites SET revoked_at=$1 WHERE id=$2 AND group_id=$3 RETURNING id, revoked_at', [active ? null : new Date(), req.params.inviteId, groupRows[0].id]);
  if (!rows.length) return res.status(404).json({ error: 'Davet kodu bulunamadı' });
  res.json({ ok: true, active: !rows[0].revoked_at });
});

app.post('/api/group/join-invite', authMiddleware, async (req, res) => {
  if (await denyIfRestricted(req, res, 'group')) return;
  const { invite_code } = req.body;
  if (!invite_code) return res.status(400).json({ error: 'Kod zorunlu' });
  const { rows } = await query('SELECT * FROM group_invites WHERE invite_code=$1', [invite_code.toUpperCase()]);
  if (!rows.length) return res.status(404).json({ error: 'Geçersiz davet kodu' });
  const invite = rows[0];
  if (invite.revoked_at) return res.status(410).json({ error: 'Davet kodu devre dışı bırakılmış' });
  if (invite.expires_at && new Date(invite.expires_at) <= new Date()) return res.status(410).json({ error: 'Davet kodunun süresi dolmuş' });
  if (invite.max_uses > 0 && invite.use_count >= invite.max_uses) return res.status(410).json({ error: 'Davet kodunun kullanım hakkı dolmuş' });
  const { rows: groupRows } = await query('SELECT id FROM groups WHERE id=$1', [invite.group_id]);
  if (!groupRows.length) return res.status(404).json({ error: 'Grup bulunamadı' });
  const { rows: ex } = await query('SELECT id FROM group_members WHERE group_id=$1 AND user_id=$2', [invite.group_id, req.user.id]);
  if (ex.length) return res.status(400).json({ error: 'Zaten üyesiniz' });
  await query('INSERT INTO group_members (group_id,user_id,role) VALUES ($1,$2,$3)', [invite.group_id, req.user.id, 'member']);
  await query('UPDATE groups SET member_count=member_count+1 WHERE id=$1', [invite.group_id]);
  await query('UPDATE group_invites SET use_count=use_count+1 WHERE id=$1', [invite.id]);
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
  try {
    await query('INSERT INTO group_join_requests (group_id, user_id, status) VALUES ($1, $2, $3)', [group.id, req.user.id, 'pending']);
    res.json({ ok: true });
  } catch (e) {
    if (String(e.message).includes('idx_group_join_requests_pending_unique') || String(e.message).includes('group_join_requests')) {
      return res.status(400).json({ error: 'Zaten istek gönderilmiş' });
    }
    throw e;
  }
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
  if (request.status !== 'pending') return res.json({ ok: true });

  if (action === 'approve') {
    const { rows: existingMemberRows } = await query('SELECT id FROM group_members WHERE group_id=$1 AND user_id=$2', [group.id, request.user_id]);
    if (existingMemberRows.length) {
      await query('UPDATE group_join_requests SET status=$1, reviewed_at=NOW(), reviewed_by=$2 WHERE id=$3', ['approved', req.user.id, request.id]);
      return res.json({ ok: true });
    }

    await query('INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, $3)', [group.id, request.user_id, 'member']);
    await query('UPDATE groups SET member_count=member_count+1 WHERE id=$1', [group.id]);
    await query('UPDATE group_join_requests SET status=$1, reviewed_at=NOW(), reviewed_by=$2 WHERE id=$3', ['approved', req.user.id, request.id]);
  } else if (action === 'reject') {
    await query('UPDATE group_join_requests SET status=$1, rejection_reason=$2, reviewed_at=NOW(), reviewed_by=$3 WHERE id=$4', 
      ['rejected', rejectionReason || '', req.user.id, request.id]);
  }
  res.json({ ok: true });
});

app.get('/api/group/:slug/members', async (req, res) => {
  const { rows: gRows } = await query('SELECT id FROM groups WHERE slug=$1', [req.params.slug]);
  if (!gRows.length) return res.status(404).json({ error: 'Grup bulunamadı' });
  if (await denyIfGroupUnavailable(req, res, gRows[0])) return;
  const { rows } = await query(`SELECT gm.*, u.username, u.avatar, u.avatar_removed, u.name_color, u.is_vip, u.level_id FROM group_members gm LEFT JOIN users u ON gm.user_id=u.id WHERE gm.group_id=$1 ORDER BY gm.joined_at ASC`, [gRows[0].id]);
  res.json(rows);
});

app.get('/api/group/:slug/messages', optionalAuth, async (req, res) => {
  const { rows: gRows } = await query('SELECT * FROM groups WHERE slug=$1', [req.params.slug]);
  if (!gRows.length) return res.status(404).json({ error: 'Grup bulunamadı' });
  const group = gRows[0];
  if (await denyIfGroupUnavailable(req, res, group)) return;
  const groupVisibility = group.visibility || (group.type === 'private' ? 'private' : group.invite_only ? 'invite' : 'public');
  if (groupVisibility !== 'public') {
    if (!req.user) return res.status(401).json({ error: 'Giriş gerekli' });
    const { rows: m } = await query('SELECT id FROM group_members WHERE group_id=$1 AND user_id=$2', [group.id, req.user.id]);
    if (!m.length) return res.status(403).json({ error: 'Üye değilsiniz' });
  }
  const before_id = req.query.before_id ? parseInt(req.query.before_id) : null;
  const limit = 60;
  let sql, params;
  if (before_id) {
    sql = `SELECT gm.*, EXISTS (SELECT 1 FROM group_message_deletions gmd WHERE gmd.message_id=gm.id AND gmd.user_id=${Number(req.user?.id || 0)}) AS deleted_for_me, u.username, u.avatar, u.avatar_removed, u.name_color, u.is_vip, u.badge_name, u.badge_icon, u.badge_color FROM group_messages gm LEFT JOIN users u ON gm.user_id=u.id WHERE gm.group_id=$1 AND gm.id < $2 ORDER BY gm.created_at DESC LIMIT $3`;
    sql = sql.replace(' ORDER BY gm.created_at DESC LIMIT $3', '');
    params = [group.id, before_id];
  } else {
    sql = `SELECT gm.*, EXISTS (SELECT 1 FROM group_message_deletions gmd WHERE gmd.message_id=gm.id AND gmd.user_id=${Number(req.user?.id || 0)}) AS deleted_for_me, u.username, u.avatar, u.avatar_removed, u.name_color, u.is_vip, u.badge_name, u.badge_icon, u.badge_color FROM group_messages gm LEFT JOIN users u ON gm.user_id=u.id WHERE gm.group_id=$1`;
    params = [group.id];
  }
  sql += ` ORDER BY gm.created_at DESC LIMIT $${params.length + 1}`;
  params.push(limit);
  const { rows } = await query(sql, params);
  res.json(rows.reverse()); // en eskiden yeniye
});

app.post('/api/group/:slug/messages', authMiddleware, async (req, res) => {
  const { rows: gRows } = await query('SELECT * FROM groups WHERE slug=$1', [req.params.slug]);
  if (!gRows.length) return res.status(404).json({ error: 'Grup bulunamadı' });
  const group = gRows[0];
  if (await denyIfGroupUnavailable(req, res, group)) return;
  if (!group.allow_chat) return res.status(403).json({ error: 'Sohbet kapalı' });
  const { rows: m } = await query('SELECT id, muted_until FROM group_members WHERE group_id=$1 AND user_id=$2', [group.id, req.user.id]);
  if (!m.length) return res.status(403).json({ error: 'Üye değilsiniz' });
  if (m[0].muted_until && new Date(m[0].muted_until) > new Date()) {
    const remainingMs = new Date(m[0].muted_until) - new Date();
    const remainingMinutes = Math.max(1, Math.ceil(remainingMs / 60000));
    return res.status(403).json({ error: `SUSTURULDUN. Kalan süre: ${remainingMinutes} dakika`, muted: true, remaining_minutes: remainingMinutes });
  }
  const { content, image_url } = req.body;
  if (!content?.trim() && !image_url) return res.status(400).json({ error: 'Mesaj boş olamaz' });
  const { rows } = await query('INSERT INTO group_messages (group_id,user_id,content,image_url) VALUES ($1,$2,$3,$4) RETURNING id',
    [group.id, req.user.id, content||'', image_url||'']);
  await notifyGroupMentions(group, req.user, content || '').catch(() => {});
  const { rows: msg } = await query(`SELECT gm.*, u.username, u.avatar, u.avatar_removed, u.name_color, u.is_vip, u.badge_name, u.badge_icon, u.badge_color FROM group_messages gm LEFT JOIN users u ON gm.user_id=u.id WHERE gm.id=$1`, [rows[0].id]);
  res.json(msg[0]);
});

app.put('/api/group/:slug/messages/:id', authMiddleware, async (req, res) => {
  const { rows: gRows } = await query('SELECT * FROM groups WHERE slug=$1', [req.params.slug]);
  if (!gRows.length) return res.status(404).json({ error: 'Grup bulunamadı' });
  const group = gRows[0];
  if (await denyIfGroupUnavailable(req, res, group)) return;
  const { rows: msgRows } = await query('SELECT * FROM group_messages WHERE id=$1 AND group_id=$2', [req.params.id, group.id]);
  if (!msgRows.length) return res.status(404).json({ error: 'Mesaj bulunamadı' });
  const msg = msgRows[0];
  const { rows: member } = await query('SELECT role FROM group_members WHERE group_id=$1 AND user_id=$2', [group.id, req.user.id]);
  if (!member.length) return res.status(403).json({ error: 'Üye değilsiniz' });
  const canEdit = msg.user_id == req.user.id;
  if (!canEdit) return res.status(403).json({ error: 'Bu mesajı düzenleme yetkiniz yok' });
  const content = String(req.body.content || '').trim();
  if (!content && !msg.image_url) return res.status(400).json({ error: 'Mesaj boş olamaz' });
  const { rows } = await query('UPDATE group_messages SET content=$1,edited_at=NOW() WHERE id=$2 RETURNING *', [content, msg.id]);
  const { rows: full } = await query(`SELECT gm.*, u.username, u.avatar, u.avatar_removed, u.name_color, u.is_vip, u.badge_name, u.badge_icon, u.badge_color FROM group_messages gm LEFT JOIN users u ON gm.user_id=u.id WHERE gm.id=$1`, [msg.id]);
  res.json(full[0] || rows[0]);
});

app.delete('/api/group/:slug/messages/:id', authMiddleware, async (req, res) => {
  const { rows: gRows } = await query('SELECT * FROM groups WHERE slug=$1', [req.params.slug]);
  if (!gRows.length) return res.status(404).json({ error: 'Grup bulunamadı' });
  const group = gRows[0];
  if (await denyIfGroupUnavailable(req, res, group)) return;
  const { rows: msgRows } = await query('SELECT * FROM group_messages WHERE id=$1 AND group_id=$2', [req.params.id, group.id]);
  if (!msgRows.length) return res.status(404).json({ error: 'Mesaj bulunamadı' });
  const msg = msgRows[0];
  const { rows: member } = await query('SELECT role FROM group_members WHERE group_id=$1 AND user_id=$2', [group.id, req.user.id]);
  if (!member.length) return res.status(403).json({ error: 'Üye değilsiniz' });
  const { rows: permissions } = await query('SELECT can_delete_messages FROM moderator_permissions WHERE group_id=$1 AND user_id=$2', [group.id, req.user.id]);
  const canModerate = member[0].role === 'owner' || (member[0].role === 'moderator' && permissions[0]?.can_delete_messages);
  if (msg.user_id == req.user.id || canModerate) {
    await query('DELETE FROM group_messages WHERE id=$1', [msg.id]);
    return res.json({ ok: true, scope: canModerate && msg.user_id != req.user.id ? 'moderated' : 'everyone' });
  }
  await query('INSERT INTO group_message_deletions (message_id,user_id) VALUES ($1,$2) ON CONFLICT (message_id,user_id) DO NOTHING', [msg.id, req.user.id]);
  res.json({ ok: true, scope: 'me' });
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
  if (await denyIfGroupUnavailable(req, res, group)) return;
  const { rows: member } = await query('SELECT role FROM group_members WHERE group_id=$1 AND user_id=$2', [group.id, req.user.id]);
  const { rows: perm } = await query('SELECT * FROM moderator_permissions WHERE group_id=$1 AND user_id=$2', [group.id, req.user.id]);
  const canBan = group.owner_id==req.user.id || (member[0]?.role==='moderator' && perm[0]?.can_ban_members);
  if (!canBan) return res.status(403).json({ error: 'Yetki yok' });
  const userId = parseInt(req.params.userId);
  if (userId === req.user.id) return res.status(400).json({ error: 'Kendinizi yasaklayamazsınız' });
  const reason = String(req.body.reason || '').trim();
  if (!reason) return res.status(400).json({ error: 'Yasaklama nedeni zorunlu' });
  await query(`INSERT INTO group_member_restrictions (group_id,user_id,restriction_type,reason,created_by)
    VALUES ($1,$2,'ban',$3,$4)
    ON CONFLICT (group_id,user_id,restriction_type) DO UPDATE SET reason=EXCLUDED.reason, created_by=EXCLUDED.created_by, created_at=NOW(), revoked_at=NULL`, [group.id, userId, reason, req.user.id]);
  res.json({ ok: true });
});

app.get('/api/group/:slug/bans', authMiddleware, async (req, res) => {
  const { rows: gRows } = await query('SELECT * FROM groups WHERE slug=$1', [req.params.slug]);
  if (!gRows.length) return res.status(404).json({ error: 'Grup bulunamadı' });
  const group = gRows[0];
  if (group.owner_id !== req.user.id) return res.status(403).json({ error: 'Yetki yok' });
  const { rows } = await query(`SELECT gr.*, u.username, u.avatar, u.name_color,
    gm.role, gm.muted_until
    FROM group_member_restrictions gr
    LEFT JOIN users u ON u.id=gr.user_id
    LEFT JOIN group_members gm ON gm.group_id=gr.group_id AND gm.user_id=gr.user_id
    WHERE gr.group_id=$1 AND gr.revoked_at IS NULL
    ORDER BY gr.created_at DESC`, [group.id]);
  res.json(rows);
});

app.post('/api/group/:slug/ban/:userId/revoke', authMiddleware, async (req, res) => {
  const { rows: gRows } = await query('SELECT * FROM groups WHERE slug=$1', [req.params.slug]);
  if (!gRows.length) return res.status(404).json({ error: 'Grup bulunamadı' });
  const group = gRows[0];
  const { rows: member } = await query('SELECT role FROM group_members WHERE group_id=$1 AND user_id=$2', [group.id, req.user.id]);
  const { rows: perm } = await query('SELECT * FROM moderator_permissions WHERE group_id=$1 AND user_id=$2', [group.id, req.user.id]);
  const canUnban = group.owner_id === req.user.id || (member[0]?.role === 'moderator' && perm[0]?.can_ban_members);
  if (!canUnban) return res.status(403).json({ error: 'Yetki yok' });
  const userId = parseInt(req.params.userId);
  const result = await query('UPDATE group_member_restrictions SET revoked_at=NOW() WHERE group_id=$1 AND user_id=$2 AND revoked_at IS NULL RETURNING id', [group.id, userId]);
  if (!result.rowCount) return res.status(404).json({ error: 'Aktif yasak bulunamadı' });
  res.json({ ok: true });
});

app.post('/api/group/:slug/kick/:userId', authMiddleware, async (req, res) => {
  const { rows: gRows } = await query('SELECT * FROM groups WHERE slug=$1', [req.params.slug]);
  if (!gRows.length) return res.status(404).json({ error: 'Grup bulunamadı' });
  const group = gRows[0];
  const { rows: member } = await query('SELECT role FROM group_members WHERE group_id=$1 AND user_id=$2', [group.id, req.user.id]);
  const { rows: perm } = await query('SELECT * FROM moderator_permissions WHERE group_id=$1 AND user_id=$2', [group.id, req.user.id]);
  const canKick = group.owner_id == req.user.id || (member[0]?.role === 'moderator' && perm[0]?.can_ban_members);
  if (!canKick) return res.status(403).json({ error: 'Yetki yok' });
  const userId = parseInt(req.params.userId);
  if (userId === req.user.id || userId === group.owner_id) return res.status(400).json({ error: 'Bu üyeyi gruptan atamazsınız' });
  const result = await query('DELETE FROM group_members WHERE group_id=$1 AND user_id=$2', [group.id, userId]);
  if (!result.rowCount) return res.status(404).json({ error: 'Üye bulunamadı' });
  await query('UPDATE groups SET member_count=GREATEST(0,member_count-1) WHERE id=$1', [group.id]);
  res.json({ ok: true });
});

app.post('/api/group/:slug/mute/:userId', authMiddleware, async (req, res) => {
  const { rows: gRows } = await query('SELECT * FROM groups WHERE slug=$1', [req.params.slug]);
  if (!gRows.length) return res.status(404).json({ error: 'Grup bulunamadı' });
  const group = gRows[0];
  const { rows: owner } = await query('SELECT role FROM group_members WHERE group_id=$1 AND user_id=$2', [group.id, req.user.id]);
  if (group.owner_id != req.user.id && owner[0]?.role !== 'moderator') return res.status(403).json({ error: 'Yetki yok' });
  const userId = parseInt(req.params.userId);
  const minutes = Math.min(10080, Math.max(1, parseInt(req.body.minutes) || 60));
  const { rows: target } = await query('SELECT id FROM group_members WHERE group_id=$1 AND user_id=$2', [group.id, userId]);
  if (!target.length) return res.status(404).json({ error: 'Üye bulunamadı' });
  await query("UPDATE group_members SET muted_until=NOW() + ($1 * INTERVAL '1 minute') WHERE group_id=$2 AND user_id=$3", [minutes, group.id, userId]);
  res.json({ ok: true, minutes });
});

app.post('/api/group/:slug/upload', authMiddleware, upload.single('image'), async (req, res) => {
  const { rows } = await query('SELECT * FROM groups WHERE slug=$1', [req.params.slug]);
  if (rows.length && await denyIfGroupUnavailable(req, res, rows[0])) return;
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
  const { rows: friendship } = await query("SELECT 1 FROM friendships WHERE ((requester_id=$1 AND addressee_id=$2) OR (requester_id=$2 AND addressee_id=$1)) AND status='accepted'", [req.user.id, target[0].id]);
  res.json({ following: rows[0]?.status === 'accepted' || friendship.length > 0, pending: rows[0]?.status === 'pending', is_private: !!target[0].is_private });
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
  const { rows: users } = await query(`SELECT * FROM users WHERE username=$1 OR ${profileRouteSql}=$2 LIMIT 1`, [req.params.username, profileRouteKey(req.params.username)]);
  if (!users.length) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  const user = users[0];
  const badges = await getUserProfileBadges(user);
  const isOwner = req.user && req.user.id === user.id;
  const isFollower = req.user && (await query("SELECT 1 FROM follows WHERE follower_id=$1 AND following_id=$2 AND status='accepted'", [req.user.id, user.id])).rows.length > 0;
  const { rows: followCounts } = await query(`SELECT
    (SELECT COUNT(*) FROM follows WHERE following_id=$1 AND status='accepted') AS followers_count,
    (SELECT COUNT(*) FROM follows WHERE follower_id=$1 AND status='accepted') AS following_count`, [user.id]);
  if (user.is_private && !isOwner && !isFollower) {
    return res.json({ user: sanitizeUser(user), badges, forums: [], books: [], groups: [], videos: [], songs: [], level: null, levels: [], book_page_count: 0, private_profile: true, followers_count: Number(followCounts[0].followers_count), following_count: Number(followCounts[0].following_count), following: false });
  }
  const [forums, books, groups, level, levels, bpCount, photos, videos, reals] = await Promise.all([
    query('SELECT * FROM forums WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20', [user.id]).then(r => r.rows),
    query(`SELECT b.* FROM books b WHERE (b.user_id=$1 OR EXISTS (SELECT 1 FROM book_access ba WHERE ba.book_id=b.id AND ba.user_id=$1)) AND (b.is_hidden=0 OR b.user_id=$2) ORDER BY b.created_at DESC LIMIT 20`, [user.id, req.user?.id || 0]).then(r => r.rows.map(sanitizeBook)),
    query(`SELECT g.* FROM groups g INNER JOIN group_members gm ON g.id=gm.group_id WHERE gm.user_id=$1 LIMIT 20`, [user.id]).then(r => r.rows),
    query('SELECT * FROM levels WHERE id=$1', [user.level_id]).then(r => r.rows[0] || null),
    query('SELECT * FROM levels ORDER BY order_num ASC').then(r => r.rows),
    query('SELECT COUNT(*) as c FROM book_pages bp INNER JOIN books b ON bp.book_id=b.id WHERE b.user_id=$1', [user.id]).then(r => parseInt(r.rows[0].c)),
    query('SELECT p.id,p.url,p.title,p.caption,p.location,p.created_at,p.song_id,s.title AS song_title,s.artist_name AS song_artist FROM photos p LEFT JOIN songs s ON s.id=p.song_id WHERE p.user_id=$1 ORDER BY p.created_at DESC LIMIT 50', [user.id]).then(r => r.rows),
    query(`SELECT v.*, v.thumbnail_url AS banner_image, u.username, u.avatar, u.avatar_removed,
      (SELECT COUNT(*) FROM video_likes vl WHERE vl.video_id=v.id) AS like_count,
      (SELECT COUNT(*) FROM video_comments vc WHERE vc.video_id=v.id) AS comment_count
      FROM videos v LEFT JOIN users u ON u.id=v.user_id WHERE v.user_id=$1 AND v.is_reals=0 ORDER BY v.created_at DESC LIMIT 50`, [user.id]).then(r => r.rows),
    query(`SELECT v.*, v.thumbnail_url AS banner_image, u.username, u.avatar, u.avatar_removed,
      (SELECT COUNT(*) FROM video_likes vl WHERE vl.video_id=v.id) AS like_count,
      (SELECT COUNT(*) FROM video_comments vc WHERE vc.video_id=v.id) AS comment_count
      FROM videos v LEFT JOIN users u ON u.id=v.user_id WHERE v.user_id=$1 AND v.is_reals=1 ORDER BY v.created_at DESC LIMIT 50`, [user.id]).then(r => r.rows),
  ]);
  const ad_panels = isOwner ? await listAdPanelAssignments(user.id) : [];
  res.json({ user: sanitizeUser(user), badges, forums, books, groups, photos, videos, reals, ad_panels, level, levels, book_page_count: bpCount, private_profile: false, followers_count: Number(followCounts[0].followers_count), following_count: Number(followCounts[0].following_count), following: !!(req.user && (await query("SELECT 1 FROM follows WHERE follower_id=$1 AND following_id=$2 AND status='accepted'", [req.user.id, user.id])).rows.length) });
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

// Kullanıcının kazandığı rozetleri ve profil görünürlüğü tercihlerini yönetir.
app.get('/api/me/badges', authMiddleware, async (req, res) => {
  try {
    res.json(await getUserProfileBadges(req.user, { includeInactive: true }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/me/badges/:key', authMiddleware, async (req, res) => {
  try {
    const key = decodeURIComponent(String(req.params.key || ''));
    const isActive = boolValue(req.body?.is_active);
    const allBadges = await getUserProfileBadges(req.user, { includeInactive: true });
    const badge = allBadges.find(item => item.key === key);
    if (!badge) return res.status(404).json({ error: 'Bu rozet hesabınızda bulunmuyor' });
    if (key === 'admin' && !isActive) {
      return res.status(400).json({ error: 'Yetkili rozeti profilden kaldırılamaz.' });
    }

    await query(`
      INSERT INTO user_badge_visibility (user_id, badge_key, is_active, updated_at)
      VALUES ($1,$2,$3,NOW())
      ON CONFLICT (user_id, badge_key)
      DO UPDATE SET is_active=EXCLUDED.is_active, updated_at=NOW()
    `, [req.user.id, key, isActive]);

    // Eski seviye ayarı kullanan istemcilerle de aynı görünürlük korunur.
    if (key === 'level') await query('UPDATE users SET show_level_badge=$1 WHERE id=$2', [isActive, req.user.id]);
    res.json({ ...badge, is_active: !!isActive });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/profile', authMiddleware, upload.single('avatar'), async (req, res) => {
  const { bio, links, name_color, name_color_mode, name_gradient, show_level_badge, show_level_progress, show_level_color, title, location, allow_mentions, tag_permission, badge_name, badge_icon, badge_color, badge_display, is_private, avatar_removed } = req.body;
  const canSetBadge = req.user.is_vip || req.user.is_plus;
  if (canSetBadge && isReservedVmbBadgeName(badge_name)) return res.status(400).json({ error: 'VMB özel rozeti profil ayarlarından verilemez' });
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
  await query('UPDATE users SET bio=$1,links=$2,name_color=$3,name_color_mode=$4,name_gradient=$5,show_level_badge=$6,show_level_progress=$7,show_level_color=$8,avatar=$9,avatar_removed=$10,title=$11,location=$12,allow_mentions=$13,tag_permission=$14,badge_name=$15,badge_icon=$16,badge_color=$17,badge_display=$18,is_private=$19 WHERE id=$20',
    [bio??req.user.bio, newLinks,
     canSetCustomColor ? (name_color??req.user.name_color) : req.user.name_color,
     canSetCustomColor ? resolvedColorMode : (req.user.name_color_mode || 'solid'),
     canSetCustomColor ? resolvedGradient : (req.user.name_gradient || ''),
     show_level_badge!==undefined?(parseBool(show_level_badge)?1:0):req.user.show_level_badge,
    show_level_progress!==undefined?(parseBool(show_level_progress)?1:0):req.user.show_level_progress,
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
  if (show_level_badge !== undefined) {
    await query(`
      INSERT INTO user_badge_visibility (user_id, badge_key, is_active, updated_at)
      VALUES ($1,'level',$2,NOW())
      ON CONFLICT (user_id, badge_key)
      DO UPDATE SET is_active=EXCLUDED.is_active, updated_at=NOW()
    `, [req.user.id, parseBool(show_level_badge) ? 1 : 0]);
  }
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
  if (!verifyPassword(old_password, req.user.password_hash)) return res.status(401).json({ error: 'Eski şifre yanlış' });
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
  if (await denyIfRestricted(req, res, 'reals')) return;
  if (!USE_R2) return res.status(503).json({ error: 'Reals R2 depolama ayarlanmamış.' });
  const contentType = String(req.body?.content_type || 'video/mp4');
  const contentLength = Number(req.body?.content_length);
  if (!contentType.startsWith('video/')) return res.status(400).json({ error: 'Geçersiz video türü.' });
  if (!Number.isSafeInteger(contentLength) || contentLength < 1 || contentLength > 500 * 1024 * 1024) return res.status(400).json({ error: 'Video boyutu 1 byte ile 500 MB arasında olmalı.' });
  const extension = path.extname(String(req.body?.filename || '')).toLowerCase() || '.mp4';
  const key = `reals/${randomUUID()}${extension}`;
  try {
    const command = new PutObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key, ContentType: contentType, ContentLength: contentLength });
    const uploadUrl = await getSignedUrl(r2Client, command, { expiresIn: 900 });
    const publicBase = (process.env.R2_PUBLIC_URL || `${R2_ENDPOINT}/${process.env.R2_BUCKET_NAME}`).replace(/\/$/, '');
    res.json({ upload_url: uploadUrl, public_url: `${publicBase}/${key}` });
  } catch (error) {
    res.status(500).json({ error: 'Reals yükleme bağlantısı oluşturulamadı: ' + error.message });
  }
});

let photoInteractionSchemaPromise;
function ensurePhotoInteractionSchema() {
  if (!photoInteractionSchemaPromise) {
    photoInteractionSchemaPromise = query(`
      CREATE TABLE IF NOT EXISTS photos (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        url TEXT NOT NULL,
        public_id TEXT DEFAULT '',
        caption TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT NOW()
      );
      ALTER TABLE photos ADD COLUMN IF NOT EXISTS show_likes INTEGER DEFAULT 1;
      ALTER TABLE photos ADD COLUMN IF NOT EXISTS allow_comments INTEGER DEFAULT 1;
      ALTER TABLE photos ADD COLUMN IF NOT EXISTS allow_shares INTEGER DEFAULT 1;
      CREATE TABLE IF NOT EXISTS photo_likes (
        id BIGSERIAL PRIMARY KEY,
        photo_id BIGINT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(photo_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS photo_comments (
        id BIGSERIAL PRIMARY KEY,
        photo_id BIGINT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
        user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS photo_comment_likes (
        id BIGSERIAL PRIMARY KEY,
        comment_id BIGINT NOT NULL REFERENCES photo_comments(id) ON DELETE CASCADE,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(comment_id, user_id)
      );
    `).catch(error => {
      photoInteractionSchemaPromise = null;
      throw error;
    });
  }
  return photoInteractionSchemaPromise;
}

app.get('/api/photos', optionalAuth, async (req, res) => {
  await ensurePhotoInteractionSchema();
  const { username } = req.query;
  const userId = req.user ? req.user.id : 0;
  const base = `SELECT p.id, p.url, p.title, p.caption, p.location, p.song_id, p.song_start_seconds, s.slug AS song_slug, s.title AS song_title, s.artist_name AS song_artist, s.audio_url AS song_audio_url, s.cover_url AS song_cover_url, p.created_at, p.user_id, u.username, u.avatar, COALESCE(p.show_likes,1) AS show_likes, COALESCE(p.allow_comments,1) AS allow_comments, COALESCE(p.allow_shares,1) AS allow_shares,
    (SELECT COUNT(*) FROM photo_likes pl WHERE pl.photo_id = p.id) AS like_count,
    (SELECT COUNT(*) FROM photo_comments pc WHERE pc.photo_id = p.id) AS comment_count,
    (CASE WHEN $1::bigint = 0 THEN 0 ELSE (SELECT COUNT(*) FROM photo_likes pl2 WHERE pl2.photo_id=p.id AND pl2.user_id=$1) END) > 0 AS liked
    FROM photos p LEFT JOIN users u ON u.id=p.user_id LEFT JOIN songs s ON s.id=p.song_id WHERE NOT EXISTS (SELECT 1 FROM content_suspensions cs WHERE cs.content_type='photo' AND cs.content_id=p.id)`;
  const visibility = `(COALESCE(u.is_private,0)=0 OR p.user_id=$1 OR EXISTS (SELECT 1 FROM follows f WHERE f.follower_id=$1 AND f.following_id=p.user_id AND f.status='accepted') OR EXISTS (SELECT 1 FROM friendships fr WHERE ((fr.requester_id=$1 AND fr.addressee_id=p.user_id) OR (fr.requester_id=p.user_id AND fr.addressee_id=$1)) AND fr.status='accepted'))`;
  const queryText = username
    ? `${base} AND u.username = $2 AND ${visibility} ORDER BY p.created_at DESC LIMIT 100`
    : `${base} AND ${visibility} ORDER BY p.created_at DESC LIMIT 100`;
  const { rows } = username ? await query(queryText, [userId, username]) : await query(queryText, [userId]);
  res.json(rows);
});

app.get('/api/photos/:id', optionalAuth, async (req, res) => {
  await ensurePhotoInteractionSchema();
  const userId = req.user ? req.user.id : 0;
  const { rows } = await query(
    `SELECT p.id, p.url, p.title, p.caption, p.location, p.song_id, p.song_start_seconds,
    s.slug AS song_slug, s.title AS song_title, s.artist_name AS song_artist, s.audio_url AS song_audio_url, s.cover_url AS song_cover_url,
      p.created_at, p.user_id, u.username, u.avatar, COALESCE(p.show_likes,1) AS show_likes, COALESCE(p.allow_comments,1) AS allow_comments, COALESCE(p.allow_shares,1) AS allow_shares,
      (SELECT COUNT(*) FROM photo_likes pl WHERE pl.photo_id = p.id) AS like_count,
      (SELECT COUNT(*) FROM photo_comments pc WHERE pc.photo_id = p.id) AS comment_count,
      (CASE WHEN $2::bigint = 0 THEN 0 ELSE (SELECT COUNT(*) FROM photo_likes pl2 WHERE pl2.photo_id=p.id AND pl2.user_id=$2) END) > 0 AS liked
    FROM photos p LEFT JOIN users u ON u.id=p.user_id LEFT JOIN songs s ON s.id=p.song_id
    WHERE p.id=$1 AND NOT EXISTS (SELECT 1 FROM content_suspensions cs WHERE cs.content_type='photo' AND cs.content_id=p.id) AND (COALESCE(u.is_private,0)=0 OR p.user_id=$2 OR EXISTS (SELECT 1 FROM follows f WHERE f.follower_id=$2 AND f.following_id=p.user_id AND f.status='accepted') OR EXISTS (SELECT 1 FROM friendships fr WHERE ((fr.requester_id=$2 AND fr.addressee_id=p.user_id) OR (fr.requester_id=p.user_id AND fr.addressee_id=$2)) AND fr.status='accepted'))`,
    [req.params.id, userId]
  );
  if (!rows.length) return res.status(404).json({ error: 'Fotoğraf bulunamadı' });
  res.json(rows[0]);
});

app.post('/api/photos/:id/view', optionalAuth, async (req, res) => {
  const { rows } = await query('SELECT id FROM photos WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Fotoğraf bulunamadı' });
  await recordContentView('photo', rows[0].id, req);
  res.json({ ok: true });
});

app.post('/api/photos', authMiddleware, upload.single('image'), async (req, res) => {
  if (await denyIfRestricted(req, res, 'photo')) return;
  if (!req.file) return res.status(400).json({ error: 'Fotoğraf seçin' });
  try {
    const url = await handleUpload(req.file);
    const b = req.body;
    const songStart = Math.max(0, parseInt(b.song_start_seconds, 10) || 0);
    const { rows } = await query(`INSERT INTO photos (user_id,url,public_id,title,caption,location,song_id,song_start_seconds,show_likes,allow_comments,allow_shares)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [
      req.user.id, url, req.file.cloudinary_public_id || '', (b.title || '').trim(), (b.caption || '').trim(), (b.location || '').trim(), b.song_id || null,
      songStart, parseFormBoolean(b.show_likes, true) ? 1 : 0, parseFormBoolean(b.allow_comments, true) ? 1 : 0, parseFormBoolean(b.allow_shares, true) ? 1 : 0
    ]);
    await notifyFollowersOfContent(req.user, 'new_photo', 'Yeni fotoğraf', `@${req.user.username} yeni bir fotoğraf paylaştı.`, '/foto/' + rows[0].id).catch(() => {});
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/photos/:id', authMiddleware, upload.single('image'), async (req, res) => {
  const { url, title, caption, location, song_id, song_start_seconds, show_likes, allow_comments, allow_shares } = req.body;
  const { rows } = await query('SELECT user_id FROM photos WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Fotoğraf bulunamadı' });
  if (rows[0].user_id !== req.user.id) return res.status(403).json({ error: 'Bu fotoğrafı düzenleme yetkiniz yok' });
  const nextUrl = req.file ? await handleUpload(req.file) : url;
  if (!nextUrl || typeof nextUrl !== 'string') return res.status(400).json({ error: 'Fotoğraf URL gerekli' });
  const songStart = Math.max(0, parseInt(song_start_seconds, 10) || 0);
  await query('UPDATE photos SET url=$1, title=COALESCE($2, title), caption=$3, location=COALESCE($4, location), song_id=$5, song_start_seconds=$6, show_likes=COALESCE($7, show_likes), allow_comments=COALESCE($8, allow_comments), allow_shares=COALESCE($9, allow_shares) WHERE id=$10',
    [nextUrl, title !== undefined ? String(title).trim() : null, caption||'', location !== undefined ? String(location).trim() : null, song_id || null, songStart, show_likes !== undefined ? (parseFormBoolean(show_likes) ? 1 : 0) : null, allow_comments !== undefined ? (parseFormBoolean(allow_comments) ? 1 : 0) : null, allow_shares !== undefined ? (parseFormBoolean(allow_shares) ? 1 : 0) : null, req.params.id]);
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
  const { rows } = await query(`SELECT s.id,s.public_id,s.user_id,s.media_url,s.media_type,s.caption,s.song_id,s.song_start_seconds,s.media_filter,s.duration_hours,s.is_suspended,s.created_at,s.expires_at,
      u.username,u.avatar,u.avatar_removed,u.is_private,song.title AS song_title,song.artist_name AS song_artist,song.audio_url AS song_audio_url,song.cover_url AS song_cover_url,
      EXISTS(SELECT 1 FROM story_views sv WHERE sv.story_id=s.id AND sv.viewer_id=$1) AS viewed,
      EXISTS(SELECT 1 FROM story_likes sl WHERE sl.story_id=s.id AND sl.user_id=$1) AS liked,
      (SELECT COUNT(*) FROM story_likes slc WHERE slc.story_id=s.id) AS like_count,
      (SELECT COUNT(*) FROM story_replies src WHERE src.story_id=s.id) AS reply_count,
      (SELECT COUNT(*) FROM content_view_events cve WHERE cve.content_type='story' AND cve.content_id=s.id) AS total_views,
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
  const { rows } = await query(`SELECT s.id,s.public_id,s.user_id,s.media_url,s.media_type,s.caption,s.song_id,s.song_start_seconds,s.media_filter,s.duration_hours,s.is_suspended,s.created_at,s.expires_at,
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

app.post('/api/stories', authMiddleware, async (req, res, next) => {
  if (await denyIfRestricted(req, res, 'story')) return;
  next();
}, (req, res, next) => {
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
    const { rows } = await query(`INSERT INTO stories (user_id,public_id,media_url,media_type,caption,song_id,song_start_seconds,media_filter,duration_hours,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::integer,NOW() + ($9::integer * INTERVAL '1 hour')) RETURNING *`, [req.user.id, randomStoryPublicId(), mediaUrl, mediaType, (req.body.caption || '').trim(), songId, songStart, normalizeMediaFilter(req.body.media_filter), durationHours]);
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
  if (await denyIfRestricted(req, res, 'story')) return;
  if (!USE_R2) return res.status(503).json({ error: 'Hikaye video depolaması ayarlanmamış.' });
  const contentType = String(req.body?.content_type || 'video/mp4');
  const contentLength = Number(req.body?.content_length);
  if (!contentType.startsWith('video/')) return res.status(400).json({ error: 'Geçersiz video türü.' });
  if (!Number.isSafeInteger(contentLength) || contentLength < 1 || contentLength > 500 * 1024 * 1024) return res.status(400).json({ error: 'Video boyutu 1 byte ile 500 MB arasında olmalı.' });
  const extension = path.extname(String(req.body?.filename || '')).toLowerCase() || '.mp4';
  const key = `stories/${randomUUID()}${extension}`;
  try {
    const uploadUrl = await getSignedUrl(r2Client, new PutObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key, ContentType: contentType, ContentLength: contentLength }), { expiresIn: 900 });
    const publicBase = (process.env.R2_PUBLIC_URL || `${R2_ENDPOINT}/${process.env.R2_BUCKET_NAME}`).replace(/\/$/, '');
    res.json({ upload_url: uploadUrl, public_url: `${publicBase}/${key}` });
  } catch (error) { res.status(500).json({ error: 'Hikaye video bağlantısı oluşturulamadı: ' + error.message }); }
});

app.post('/api/stories/from-url', authMiddleware, async (req, res) => {
  if (await denyIfRestricted(req, res, 'story')) return;
  const { media_url, caption, song_id, song_start_seconds, media_filter, duration_hours } = req.body;
  if (!media_url) return res.status(400).json({ error: 'Hikaye videosu gerekli' });
  const songId = song_id ? Number(song_id) : null;
  const songStart = Math.max(0, parseInt(song_start_seconds, 10) || 0);
  const durationHours = [5, 10, 24].includes(Number(duration_hours)) ? Number(duration_hours) : 24;
  try {
    const { rows } = await query(`INSERT INTO stories (user_id,public_id,media_url,media_type,caption,song_id,song_start_seconds,media_filter,duration_hours,expires_at) VALUES ($1,$2,$3,'video',$4,$5,$6,$7,$8::integer,NOW() + ($8::integer * INTERVAL '1 hour')) RETURNING *`, [req.user.id, randomStoryPublicId(), media_url, String(caption || '').trim(), songId, songStart, normalizeMediaFilter(media_filter), durationHours]);
    res.json(rows[0]);
    notifyFollowersOfContent(req.user, 'new_story', 'Yeni hikaye', `@${req.user.username} yeni bir hikaye paylaştı.`, '/hikaye/' + rows[0].public_id).catch(() => {});
  } catch (error) { res.status(500).json({ error: 'Hikaye kaydedilemedi: ' + error.message }); }
});

app.post('/api/stories/:id/view', optionalAuth, async (req, res) => {
  const viewerId = req.user?.id || 0;
  const { rows: story } = await query(`SELECT s.id FROM stories s JOIN users u ON u.id=s.user_id WHERE (s.public_id=$1 OR s.id::text=$1) AND s.expires_at>NOW() AND s.is_suspended=0 AND (s.user_id=$2 OR COALESCE(u.is_private,0)=0 OR EXISTS(SELECT 1 FROM follows f WHERE f.follower_id=$2 AND f.following_id=s.user_id AND f.status='accepted'))`, [req.params.id, viewerId]);
  if (!story.length) return res.status(404).json({ error: 'Hikaye bulunamadı' });
  await recordContentView('story', story[0].id, req);
  if (req.user?.id) {
    await query(`INSERT INTO story_views (story_id,viewer_id,view_count,viewed_at)
      VALUES ($1,$2,1,NOW())
      ON CONFLICT (story_id,viewer_id)
      DO UPDATE SET view_count=story_views.view_count+1, viewed_at=NOW()`, [story[0].id, req.user.id]);
  }
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
  const { rows: updated } = await query('UPDATE stories SET caption=$1,song_id=$2,song_start_seconds=$3,media_filter=$4,duration_hours=$5,expires_at=created_at + ($5 * INTERVAL \'1 hour\') WHERE id=$6 RETURNING *', [caption, songId, songStart, normalizeMediaFilter(req.body.media_filter ?? rows[0].media_filter), durationHours, rows[0].id]);
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
    (SELECT COUNT(*) FROM (
      SELECT COALESCE(cve.user_id::text, 'guest:' || cve.ip) AS visitor
      FROM content_view_events cve
      WHERE cve.content_type='story' AND cve.content_id=s.id
      GROUP BY visitor
    ) visitors)::int AS unique_viewers,
    (SELECT COUNT(*) FROM content_view_events cve WHERE cve.content_type='story' AND cve.content_id=s.id)::int AS total_views,
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
  const { rows } = await query(`SELECT cve.user_id,cve.ip,u.username,u.avatar,
      COUNT(*)::int AS view_count, MIN(cve.viewed_at) AS first_viewed_at, MAX(cve.viewed_at) AS viewed_at
    FROM content_view_events cve LEFT JOIN users u ON u.id=cve.user_id
    WHERE cve.content_type='story' AND cve.content_id=$1
    GROUP BY cve.user_id,cve.ip,u.username,u.avatar,date_trunc('hour',cve.viewed_at)
    ORDER BY viewed_at DESC`, [story[0].id]);
  res.json(rows);
});

app.put('/api/admin/stories/:id', adminMiddleware, async (req, res) => {
  const { rows } = await query('SELECT * FROM stories WHERE public_id=$1 OR id::text=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Hikaye bulunamadı' });
  const old = rows[0];
  const caption = String(req.body.caption ?? old.caption).trim().slice(0, 180);
  const requestedDuration = Number(req.body.duration_hours);
  const durationHours = Number.isInteger(requestedDuration) && requestedDuration >= 1 && requestedDuration <= 720 ? requestedDuration : old.duration_hours;
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
  const photoId = Number.parseInt(req.params.id, 10);
  const userId = Number(req.user.id);
  if (!Number.isSafeInteger(photoId) || photoId < 1) return res.status(400).json({ error: 'Geçersiz fotoğraf.' });
  try {
  await ensurePhotoInteractionSchema();
  const { rows } = await query(`SELECT p.id, COALESCE(p.show_likes,1) AS show_likes FROM photos p LEFT JOIN users u ON u.id=p.user_id
    WHERE p.id=$1 AND (COALESCE(u.is_private,0)=0 OR p.user_id=$2 OR EXISTS (SELECT 1 FROM follows f WHERE f.follower_id=$2 AND f.following_id=p.user_id AND f.status='accepted') OR EXISTS (SELECT 1 FROM friendships fr WHERE ((fr.requester_id=$2 AND fr.addressee_id=p.user_id) OR (fr.requester_id=p.user_id AND fr.addressee_id=$2)) AND fr.status='accepted'))`, [photoId, userId]);
  if (!rows.length) return res.status(404).json({ error: 'Fotoğraf bulunamadı' });
  if (Number(rows[0].show_likes) !== 1) return res.status(403).json({ error: 'Bu fotoğrafta beğeni kapalı.' });
  const { rows: exists } = await query('SELECT id FROM photo_likes WHERE photo_id=$1 AND user_id=$2', [photoId, userId]);
  if (exists.length) {
    await query('DELETE FROM photo_likes WHERE id=$1', [exists[0].id]);
    const { rows: counts } = await query('SELECT COUNT(*)::int AS like_count FROM photo_likes WHERE photo_id=$1', [photoId]);
    return res.json({ liked: false, like_count: counts[0].like_count });
  } else {
    await query('INSERT INTO photo_likes (photo_id,user_id) VALUES ($1,$2) ON CONFLICT (photo_id,user_id) DO NOTHING', [photoId, userId]);
    const { rows: owner } = await query('SELECT user_id FROM photos WHERE id=$1', [photoId]);
    if (owner[0] && owner[0].user_id !== userId) {
        await query('INSERT INTO notifications (user_id,type,actor_username,actor_avatar,title,body,link) VALUES ($1,$2,$3,$4,$5,$6,$7)', [owner[0].user_id, 'photo_like', req.user.username, req.user.avatar || '', 'Fotoğrafın beğenildi', `@${req.user.username} fotoğrafını beğendi.`, '/foto/' + photoId]).catch(() => {});
    }
    const { rows: counts } = await query('SELECT COUNT(*)::int AS like_count FROM photo_likes WHERE photo_id=$1', [photoId]);
    return res.json({ liked: true, like_count: counts[0].like_count });
  }
  } catch (error) {
    console.error('Photo like failed:', error);
    return res.status(500).json({ error: 'Fotoğraf beğenilemedi. Lütfen tekrar deneyin.' });
  }
});

// Photo comments
app.get('/api/photos/:id/comments', optionalAuth, async (req, res) => {
  try {
    await ensurePhotoInteractionSchema();
    const photoId = req.params.id;
    const userId = req.user ? req.user.id : 0;
    const { rows: visible } = await query(`SELECT p.id FROM photos p LEFT JOIN users u ON u.id=p.user_id WHERE p.id=$1 AND (COALESCE(u.is_private,0)=0 OR p.user_id=$2 OR EXISTS (SELECT 1 FROM follows f WHERE f.follower_id=$2 AND f.following_id=p.user_id AND f.status='accepted') OR EXISTS (SELECT 1 FROM friendships fr WHERE ((fr.requester_id=$2 AND fr.addressee_id=p.user_id) OR (fr.requester_id=p.user_id AND fr.addressee_id=$2)) AND fr.status='accepted'))`, [photoId, userId]);
    if (!visible.length) return res.status(404).json({ error: 'Fotoğraf bulunamadı' });
    const { rows } = await query(`SELECT pc.id, pc.content, pc.created_at, pc.user_id, u.username, u.avatar,
      (SELECT COUNT(*) FROM photo_comment_likes pcl WHERE pcl.comment_id=pc.id) AS like_count,
      EXISTS(SELECT 1 FROM photo_comment_likes pcl2 WHERE pcl2.comment_id=pc.id AND pcl2.user_id=$2) AS liked
      FROM photo_comments pc LEFT JOIN users u ON u.id=pc.user_id WHERE pc.photo_id=$1 ORDER BY pc.created_at ASC`, [photoId, userId]);
    res.json(rows);
  } catch (error) {
    console.error('Photo comments read failed:', error);
    res.status(500).json({ error: 'Yorumlar yüklenemedi. Lütfen tekrar deneyin.' });
  }
});

app.post('/api/photos/:id/comments', authMiddleware, async (req, res) => {
  try {
    await ensurePhotoInteractionSchema();
    if (await denyIfRestricted(req, res, 'comment')) return;
    const photoId = req.params.id;
    const { content } = req.body;
    if (!content || !content.trim()) return res.status(400).json({ error: 'Yorum boş olamaz' });
    const { rows } = await query(`SELECT p.allow_comments FROM photos p LEFT JOIN users u ON u.id=p.user_id WHERE p.id=$1 AND (COALESCE(u.is_private,0)=0 OR p.user_id=$2 OR EXISTS (SELECT 1 FROM follows f WHERE f.follower_id=$2 AND f.following_id=p.user_id AND f.status='accepted') OR EXISTS (SELECT 1 FROM friendships fr WHERE ((fr.requester_id=$2 AND fr.addressee_id=p.user_id) OR (fr.requester_id=p.user_id AND fr.addressee_id=$2)) AND fr.status='accepted'))`, [photoId, req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'Fotoğraf bulunamadı' });
    if (Number(rows[0].allow_comments ?? 1) !== 1) return res.status(403).json({ error: 'Yorumlara izin verilmemiş' });
    await query('INSERT INTO photo_comments (photo_id,user_id,content) VALUES ($1,$2,$3)', [photoId, req.user.id, content.trim()]);
    const { rows: photoOwner } = await query('SELECT p.user_id,p.title FROM photos p WHERE p.id=$1', [photoId]);
    if (photoOwner[0] && photoOwner[0].user_id !== req.user.id) {
      await query('INSERT INTO notifications (user_id,type,actor_username,actor_avatar,title,body,link) VALUES ($1,$2,$3,$4,$5,$6,$7)', [photoOwner[0].user_id, 'photo_comment', req.user.username, req.user.avatar || '', 'Fotoğrafına yorum geldi', `@${req.user.username} fotoğrafına yorum yaptı.`, '/foto/' + photoId]).catch(() => {});
    }
    const c = await query('SELECT pc.id, pc.content, pc.created_at, pc.user_id, u.username, u.avatar FROM photo_comments pc LEFT JOIN users u ON u.id=pc.user_id WHERE pc.photo_id=$1 ORDER BY pc.created_at ASC', [photoId]);
    res.json(c.rows[c.rows.length - 1]);
  } catch (error) {
    console.error('Photo comment failed:', error);
    res.status(500).json({ error: 'Yorum gönderilemedi. Lütfen tekrar deneyin.' });
  }
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
  try {
    await ensurePhotoInteractionSchema();
    const commentId = req.params.id;
    const { rows: existing } = await query('SELECT id FROM photo_comment_likes WHERE comment_id=$1 AND user_id=$2', [commentId, req.user.id]);
    if (existing.length) {
      await query('DELETE FROM photo_comment_likes WHERE id=$1', [existing[0].id]);
      return res.json({ liked: false });
    }
    const { rows: comment } = await query('SELECT id FROM photo_comments WHERE id=$1', [commentId]);
    if (!comment.length) return res.status(404).json({ error: 'Yorum bulunamadı' });
    await query('INSERT INTO photo_comment_likes (comment_id,user_id) VALUES ($1,$2) ON CONFLICT (comment_id,user_id) DO NOTHING', [commentId, req.user.id]);
    res.json({ liked: true });
  } catch (error) {
    console.error('Photo comment like failed:', error);
    res.status(500).json({ error: 'Yorum beğenilemedi. Lütfen tekrar deneyin.' });
  }
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

const AD_PANEL_TYPES = ['music', 'reals'];
const AD_PANEL_TABLES = { music: 'music_ads', reals: 'reals_ads' };

function normalizeAdPanelType(value) {
  const type = String(value || '').trim().toLowerCase();
  return AD_PANEL_TYPES.includes(type) ? type : '';
}

async function resolveAdPanel(identifier, requestedType = '') {
  const raw = String(identifier || '').trim();
  const type = normalizeAdPanelType(requestedType);
  if (!/^\d{1,18}$/.test(raw)) return { error: 'Reklam ID veya 6 haneli panel kodu geçerli değil.' };

  const candidates = [];
  const types = type ? [type] : AD_PANEL_TYPES;
  for (const adType of types) {
    const table = AD_PANEL_TABLES[adType];
    const { rows } = await query(
      `SELECT * FROM ${table}
       WHERE portal_code=$1 OR id::text=$1
       ORDER BY CASE WHEN portal_code=$1 THEN 0 ELSE 1 END
       LIMIT 1`,
      [raw]
    );
    if (rows[0]) candidates.push({ ...rows[0], ad_type: adType });
  }
  if (!candidates.length) return { error: 'Reklam ID veya panel kodu bulunamadı.' };
  const exactPortalMatches = candidates.filter(candidate => String(candidate.portal_code || '').trim() === raw);
  const matches = exactPortalMatches.length ? exactPortalMatches : candidates;
  if (matches.length > 1) return { error: 'Bu ID birden fazla reklamla eşleşiyor. Tür seçerek tekrar deneyin.', ambiguous: true };
  return { ad: matches[0] };
}

function adPanelClientShape(ad) {
  if (!ad) return null;
  const isReals = ad.ad_type === 'reals';
  return {
    id: ad.id,
    ad_type: ad.ad_type,
    portal_code: String(ad.portal_code || '').trim(),
    title: ad.title,
    description: ad.description || '',
    site_url: ad.site_url || '',
    audio_url: isReals ? '' : (ad.audio_url || ''),
    video_url: isReals ? (ad.video_url || '') : '',
    cover_url: ad.cover_url || '',
    active: Number(ad.active) === 1,
    priority: Number(ad.priority || 0),
    play_count: Number(ad.play_count || 0),
    view_count: Number(ad.view_count || 0),
    click_count: Number(ad.click_count || 0),
    like_count: Number(ad.like_count || 0),
    show_likes: Number(ad.show_likes ?? 1) === 1,
    allow_comments: Number(ad.allow_comments ?? 1) === 1,
    frequency_mode: ad.frequency_mode || 'count',
    frequency_value: Number(ad.frequency_value || 3),
    frequency_unit: ad.frequency_unit || 'reals',
    created_at: ad.created_at,
    updated_at: ad.updated_at
  };
}

async function listAdPanelAssignments(userId) {
  const [music, reals] = await Promise.all([
    query(`SELECT a.id AS assignment_id, a.ad_type, a.ad_id, a.portal_code, a.created_at AS assigned_at,
      m.title, m.site_url, m.cover_url, m.active, m.priority, m.play_count, m.click_count
      FROM ad_panel_assignments a JOIN music_ads m ON m.id=a.ad_id
      WHERE a.user_id=$1 AND a.ad_type='music'`, [userId]),
    query(`SELECT a.id AS assignment_id, a.ad_type, a.ad_id, a.portal_code, a.created_at AS assigned_at,
      r.title, r.description, r.site_url, r.video_url, r.cover_url, r.active, r.priority,
      r.view_count, r.click_count, r.show_likes, r.allow_comments, r.frequency_mode,
      r.frequency_value, r.frequency_unit
      FROM ad_panel_assignments a JOIN reals_ads r ON r.id=a.ad_id
      WHERE a.user_id=$1 AND a.ad_type='reals'`, [userId])
  ]);
  return [...music.rows, ...reals.rows]
    .sort((a, b) => new Date(b.assigned_at || 0) - new Date(a.assigned_at || 0))
    .map(row => ({ ...adPanelClientShape({ ...row, id: row.ad_id }), assignment_id: row.assignment_id, ad_id: row.ad_id, assigned_at: row.assigned_at }));
}

async function isAssignedAdPanel(userId, adType, adId) {
  const { rows } = await query(
    'SELECT 1 FROM ad_panel_assignments WHERE user_id=$1 AND ad_type=$2 AND ad_id=$3',
    [userId, adType, adId]
  );
  return rows.length > 0;
}

async function attachAdPanelToUser(userId, identifier, requestedType, assignedByUserId, assignedByAdminUsername) {
  const resolved = await resolveAdPanel(identifier, requestedType);
  if (!resolved.ad) return resolved;
  const ad = resolved.ad;
  const { rows } = await query(
    `INSERT INTO ad_panel_assignments
      (user_id, ad_type, ad_id, portal_code, assigned_by_user_id, assigned_by_admin_username)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (user_id, ad_type, ad_id)
     DO UPDATE SET portal_code=EXCLUDED.portal_code,
       assigned_by_user_id=EXCLUDED.assigned_by_user_id,
       assigned_by_admin_username=EXCLUDED.assigned_by_admin_username
     RETURNING id AS assignment_id, created_at AS assigned_at`,
    [userId, ad.ad_type, ad.id, String(ad.portal_code || '').trim(), assignedByUserId || null, assignedByAdminUsername || '']
  );
  return {
    assignment: {
      ...adPanelClientShape(ad),
      assignment_id: rows[0].assignment_id,
      ad_id: ad.id,
      assigned_at: rows[0].assigned_at
    },
    already_assigned: rows[0].created_at ? false : false
  };
}

app.get('/api/photo-ads/random', async (req,res) => res.json((await query('SELECT * FROM photo_ads WHERE active=1 ORDER BY RANDOM() LIMIT 1')).rows[0] || null));
app.post('/api/photo-ads/:id/click', async (req,res) => { await query('UPDATE photo_ads SET click_count=click_count+1 WHERE id=$1 AND active=1',[req.params.id]); res.json({ok:true}); });

// Kullanıcı profiline atanmış reklam panelleri
app.get('/api/ad-panels', authMiddleware, async (req, res) => {
  try {
    res.json(await listAdPanelAssignments(req.user.id));
  } catch (error) {
    res.status(500).json({ error: 'Reklam panelleri alınamadı.' });
  }
});

app.get('/api/ad-panels/resolve/:identifier', authMiddleware, async (req, res) => {
  try {
    const resolved = await resolveAdPanel(req.params.identifier, req.query.type);
    if (!resolved.ad) return res.status(resolved.ambiguous ? 409 : 404).json({ error: resolved.error });
    const ad = resolved.ad;
    if (!req.user.is_admin && !(await isAssignedAdPanel(req.user.id, ad.ad_type, ad.id))) {
      return res.status(403).json({ error: 'Bu reklam paneli profilinize atanmamış.' });
    }
    res.json(adPanelClientShape(ad));
  } catch (error) {
    res.status(500).json({ error: 'Reklam paneli açılamadı.' });
  }
});

app.post('/api/ad-panels', authMiddleware, async (req, res) => {
  try {
    const result = await attachAdPanelToUser(
      req.user.id,
      req.body?.identifier,
      req.body?.ad_type,
      req.user.id,
      req.user.username
    );
    if (!result.assignment) return res.status(result.ambiguous ? 409 : 404).json({ error: result.error });
    await logAction(req.user.username, 'ad_panel_added', String(result.assignment.ad_id), `${result.assignment.ad_type} · ${result.assignment.portal_code}`, getIp(req), getClientInfo(req));
    res.json(result.assignment);
  } catch (error) {
    res.status(500).json({ error: 'Reklam paneli eklenemedi.' });
  }
});

app.delete('/api/ad-panels/:assignmentId', authMiddleware, async (req, res) => {
  try {
    const { rows } = await query(
      'DELETE FROM ad_panel_assignments WHERE id=$1 AND user_id=$2 RETURNING ad_type,ad_id',
      [req.params.assignmentId, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Reklam paneli bulunamadı.' });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Reklam paneli kaldırılamadı.' });
  }
});

app.get('/api/admin/photo-ads', adminMiddleware, async (req,res) => res.json((await query('SELECT * FROM photo_ads ORDER BY priority DESC,created_at DESC')).rows));
app.put('/api/admin/photo-ads/:id', adminMiddleware, async (req,res) => {
  const old=(await query('SELECT * FROM photo_ads WHERE id=$1',[req.params.id])).rows[0]; if(!old) return res.status(404).json({error:'Reklam bulunamadı'});
  const b=req.body,site=normalizedExternalUrl(b.site_url??old.site_url); if(!site)return res.status(400).json({error:'Geçerli site adresi girin'});
  const {rows}=await query('UPDATE photo_ads SET title=$1,description=$2,site_url=$3,show_likes=$4,allow_comments=$5,allow_shares=$6,active=$7,priority=$8,updated_at=NOW() WHERE id=$9 RETURNING *',[b.title||old.title,b.description??old.description,site,b.show_likes===undefined?old.show_likes:(b.show_likes?1:0),b.allow_comments===undefined?old.allow_comments:(b.allow_comments?1:0),b.allow_shares===undefined?old.allow_shares:(b.allow_shares?1:0),b.active===undefined?old.active:(b.active?1:0),b.priority??old.priority,old.id]);res.json(rows[0]);
});
app.delete('/api/admin/photo-ads/:id', adminMiddleware, async (req,res) => { await query('DELETE FROM photo_ads WHERE id=$1',[req.params.id]);res.json({ok:true}); });
// ===== REALS ADVERTISING =====
function normalizeRealsAdFrequency(body = {}, old = {}) {
  const mode = body.frequency_mode === undefined ? (old.frequency_mode || 'count') : String(body.frequency_mode);
  const frequencyMode = ['count', 'time'].includes(mode) ? mode : (old.frequency_mode || 'count');
  const unit = body.frequency_unit === undefined ? (old.frequency_unit || (frequencyMode === 'count' ? 'reals' : 'minutes')) : String(body.frequency_unit);
  const frequencyUnit = frequencyMode === 'count' ? 'reals' : (['minutes', 'hours'].includes(unit) ? unit : (old.frequency_unit || 'minutes'));
  const parsedValue = body.frequency_value === undefined ? Number(old.frequency_value || (frequencyMode === 'count' ? 3 : 10)) : Number(body.frequency_value);
  return {
    frequency_mode: frequencyMode,
    frequency_unit: frequencyUnit,
    frequency_value: Number.isFinite(parsedValue) ? Math.max(1, Math.min(100000, Math.round(parsedValue))) : Number(old.frequency_value || 3)
  };
}
function realsAdSelect(extra = '') {
  return `SELECT a.*,
    (SELECT COUNT(*)::int FROM reals_ad_likes l WHERE l.ad_id=a.id) AS like_count,
    (SELECT COUNT(*)::int FROM reals_ad_comments c WHERE c.ad_id=a.id) AS comment_count
    ${extra}`;
}

app.get('/api/reals-ads', async (req, res) => {
  const { rows } = await query(`${realsAdSelect('FROM reals_ads a WHERE a.active=1 ORDER BY a.priority DESC,a.created_at ASC')}`);
  res.json(rows);
});
app.post('/api/reals-ads/:id/view', async (req, res) => {
  const { rows } = await query('UPDATE reals_ads SET view_count=COALESCE(view_count,0)+1 WHERE id=$1 AND active=1 RETURNING view_count', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Reals reklamı bulunamadı' });
  res.json({ ok: true, view_count: rows[0].view_count });
});
app.post('/api/reals-ads/:id/click', async (req, res) => {
  const { rows } = await query('UPDATE reals_ads SET click_count=COALESCE(click_count,0)+1 WHERE id=$1 AND active=1 RETURNING click_count', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Reals reklamı bulunamadı' });
  res.json({ ok: true, click_count: rows[0].click_count });
});
app.post('/api/reals-ads/:id/like', authMiddleware, async (req, res) => {
  const { rows: ads } = await query('SELECT id,show_likes FROM reals_ads WHERE id=$1 AND active=1', [req.params.id]);
  if (!ads.length) return res.status(404).json({ error: 'Reals reklamı bulunamadı' });
  if (ads[0].show_likes !== 1) return res.status(403).json({ error: 'Bu reklamda beğeniler kapalı' });
  const { rows: existing } = await query('SELECT id FROM reals_ad_likes WHERE ad_id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  if (existing.length) await query('DELETE FROM reals_ad_likes WHERE id=$1', [existing[0].id]);
  else await query('INSERT INTO reals_ad_likes (ad_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.params.id, req.user.id]);
  const { rows } = await query('SELECT COUNT(*)::int AS count FROM reals_ad_likes WHERE ad_id=$1', [req.params.id]);
  res.json({ liked: !existing.length, like_count: rows[0].count });
});
app.get('/api/reals-ads/:id/comments', optionalAuth, async (req, res) => {
  const { rows } = await query(`SELECT c.id,c.ad_id,c.content,c.created_at,u.username,u.avatar,
    (SELECT COUNT(*)::int FROM reals_ad_comment_likes l WHERE l.comment_id=c.id) AS like_count,
    CASE WHEN $2::bigint=0 THEN false ELSE EXISTS(SELECT 1 FROM reals_ad_comment_likes l2 WHERE l2.comment_id=c.id AND l2.user_id=$2) END AS liked
    FROM reals_ad_comments c JOIN users u ON u.id=c.user_id
    WHERE c.ad_id=$1 ORDER BY c.created_at ASC`, [req.params.id, req.user?.id || 0]);
  res.json(rows);
});
app.post('/api/reals-ads/:id/comments', authMiddleware, async (req, res) => {
  if (await denyIfRestricted(req, res, 'comment')) return;
  const { rows: ads } = await query('SELECT id,allow_comments FROM reals_ads WHERE id=$1 AND active=1', [req.params.id]);
  if (!ads.length) return res.status(404).json({ error: 'Reals reklamı bulunamadı' });
  if (ads[0].allow_comments !== 1) return res.status(403).json({ error: 'Bu reklamda yorumlar kapalı' });
  const content = String(req.body.content || '').trim();
  if (!content) return res.status(400).json({ error: 'Yorum boş olamaz' });
  const { rows } = await query('INSERT INTO reals_ad_comments (ad_id,user_id,content) VALUES ($1,$2,$3) RETURNING id,ad_id,content,created_at', [req.params.id, req.user.id, content.slice(0, 1000)]);
  res.json({ ...rows[0], username: req.user.username, avatar: req.user.avatar, like_count: 0, liked: false });
});
app.post('/api/reals-ads/:id/comments/:commentId/like', authMiddleware, async (req, res) => {
  const { rows: comments } = await query('SELECT id FROM reals_ad_comments WHERE id=$1 AND ad_id=$2', [req.params.commentId, req.params.id]);
  if (!comments.length) return res.status(404).json({ error: 'Yorum bulunamadı' });
  const { rows: existing } = await query('SELECT id FROM reals_ad_comment_likes WHERE comment_id=$1 AND user_id=$2', [req.params.commentId, req.user.id]);
  if (existing.length) await query('DELETE FROM reals_ad_comment_likes WHERE id=$1', [existing[0].id]);
  else await query('INSERT INTO reals_ad_comment_likes (comment_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.params.commentId, req.user.id]);
  const { rows } = await query('SELECT COUNT(*)::int AS count FROM reals_ad_comment_likes WHERE comment_id=$1', [req.params.commentId]);
  res.json({ liked: !existing.length, like_count: rows[0].count });
});
app.delete('/api/reals-ads/:id/comments/:commentId', authMiddleware, async (req, res) => {
  const { rows } = await query('SELECT c.id,c.user_id FROM reals_ad_comments c WHERE c.id=$1 AND c.ad_id=$2', [req.params.commentId, req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Yorum bulunamadı' });
  if (rows[0].user_id !== req.user.id && !req.user.is_admin) return res.status(403).json({ error: 'Bu yorumu silme yetkiniz yok' });
  await query('DELETE FROM reals_ad_comments WHERE id=$1', [rows[0].id]);
  res.json({ ok: true });
});
app.get('/api/admin/reals-ads', adminMiddleware, async (req, res) => {
  const { rows } = await query(`${realsAdSelect('FROM reals_ads a ORDER BY a.priority DESC,a.created_at DESC')}`);
  res.json(rows);
});
app.post('/api/admin/reals-ads', adminMiddleware, upload.fields([{ name: 'video', maxCount: 1 }, { name: 'cover', maxCount: 1 }]), async (req, res) => {
  try {
    const b = req.body || {};
    const video = req.files?.video?.[0] ? await handleUpload(req.files.video[0]) : '';
    const cover = req.files?.cover?.[0] ? await handleUpload(req.files.cover[0]) : '';
    const title = String(b.title || '').trim();
    const site = normalizedExternalUrl(b.site_url);
    if (!title || !video || !site) return res.status(400).json({ error: 'Başlık, video ve geçerli site linki zorunlu.' });
    const frequency = normalizeRealsAdFrequency(b);
    const code = await uniqueAdPortalCode('reals_ads');
    const { rows } = await query(`INSERT INTO reals_ads
      (portal_code,title,description,site_url,video_url,cover_url,show_likes,allow_comments,active,priority,frequency_mode,frequency_value,frequency_unit)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [code, title, String(b.description || '').trim().slice(0, 2000), site, video, cover,
        b.show_likes === 'false' ? 0 : 1, b.allow_comments === 'false' ? 0 : 1, b.active === 'false' ? 0 : 1,
        Number.isFinite(Number(b.priority)) ? Math.round(Number(b.priority)) : 0, frequency.frequency_mode, frequency.frequency_value, frequency.frequency_unit]);
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/admin/reals-ads/:id', adminMiddleware, upload.fields([{ name: 'video', maxCount: 1 }, { name: 'cover', maxCount: 1 }]), async (req, res) => {
  try {
    const old = (await query('SELECT * FROM reals_ads WHERE id=$1', [req.params.id])).rows[0];
    if (!old) return res.status(404).json({ error: 'Reals reklamı bulunamadı.' });
    const b = req.body || {};
    const title = String(b.title ?? old.title).trim();
    const site = normalizedExternalUrl(b.site_url ?? old.site_url);
    if (!title || !site) return res.status(400).json({ error: 'Başlık ve geçerli site linki zorunlu.' });
    const video = req.files?.video?.[0] ? await handleUpload(req.files.video[0]) : old.video_url;
    const cover = req.files?.cover?.[0] ? await handleUpload(req.files.cover[0]) : old.cover_url;
    const frequency = normalizeRealsAdFrequency(b, old);
    const { rows } = await query(`UPDATE reals_ads SET title=$1,description=$2,site_url=$3,video_url=$4,cover_url=$5,
      show_likes=$6,allow_comments=$7,active=$8,priority=$9,frequency_mode=$10,frequency_value=$11,frequency_unit=$12,updated_at=NOW()
      WHERE id=$13 RETURNING *`,
      [title, String(b.description ?? old.description).trim().slice(0, 2000), site, video, cover,
        b.show_likes === undefined ? old.show_likes : (b.show_likes === 'false' ? 0 : 1),
        b.allow_comments === undefined ? old.allow_comments : (b.allow_comments === 'false' ? 0 : 1),
        b.active === undefined ? old.active : (b.active === 'false' ? 0 : 1),
        b.priority === undefined ? old.priority : Math.round(Number(b.priority) || 0),
        frequency.frequency_mode, frequency.frequency_value, frequency.frequency_unit, old.id]);
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/admin/reals-ads/:id', adminMiddleware, async (req, res) => {
  await query('DELETE FROM reals_ads WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});
app.post('/api/ad-submissions', authMiddleware, upload.fields([{name:'media',maxCount:1},{name:'cover',maxCount:1}]), async (req,res) => {
  try { const b=req.body;if(!['music','photo','reals'].includes(b.type)||!b.title?.trim()||!req.files?.media?.[0])return res.status(400).json({error:'Reklam türü, başlık ve dosya zorunlu.'});const site=normalizedExternalUrl(b.site_url);if(!site)return res.status(400).json({error:'Geçerli site adresi girin.'});const media=await handleUpload(req.files.media[0]),cover=req.files?.cover?.[0]?await handleUpload(req.files.cover[0]):'',code=await uniqueAdPortalCode('ad_submissions');const {rows}=await query(`INSERT INTO ad_submissions (user_id,type,title,description,site_url,media_url,cover_url,show_likes,allow_comments,allow_shares,portal_code) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,[req.user.id,b.type,b.title.trim(),b.description||'',site,media,cover,b.show_likes==='false'?0:1,b.allow_comments==='false'?0:1,b.allow_shares==='false'?0:1,code]);res.json(rows[0]); } catch(e){res.status(500).json({error:e.message});}
});
app.get('/api/admin/ad-submissions', adminMiddleware, async (req,res) => res.json((await query('SELECT a.*,u.username FROM ad_submissions a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC')).rows));
app.post('/api/admin/ad-submissions/:id/approve', adminMiddleware, async (req,res) => { const ad=(await query("SELECT * FROM ad_submissions WHERE id=$1 AND status='pending'",[req.params.id])).rows[0];if(!ad)return res.status(404).json({error:'Bekleyen reklam bulunamadı'});if(ad.type==='photo')await query('INSERT INTO photo_ads (portal_code,title,description,site_url,image_url,show_likes,allow_comments,allow_shares) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',[ad.portal_code,ad.title,ad.description,ad.site_url,ad.media_url,ad.show_likes,ad.allow_comments,ad.allow_shares]);else if(ad.type==='reals')await query('INSERT INTO reals_ads (portal_code,title,description,site_url,video_url,cover_url,show_likes,allow_comments,active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1)',[ad.portal_code,ad.title,ad.description,ad.site_url,ad.media_url,ad.cover_url,ad.show_likes,ad.allow_comments]);else await query('INSERT INTO music_ads (portal_code,title,site_url,audio_url,cover_url,active) VALUES ($1,$2,$3,$4,$5,1)',[ad.portal_code,ad.title,ad.site_url,ad.media_url,ad.cover_url]);await query("UPDATE ad_submissions SET status='approved' WHERE id=$1",[ad.id]);res.json({ok:true}); });
app.post('/api/admin/ad-submissions/:id/reject', adminMiddleware, async (req,res) => {await query("UPDATE ad_submissions SET status='rejected' WHERE id=$1",[req.params.id]);res.json({ok:true});});

// ===== ADMIN =====
app.get('/api/admin/user/:id/2fa', adminMiddleware, async (req, res) => {
  if (!req.adminUser.isSuperAdmin) return res.status(403).json({ error: 'Bu işlem yalnızca ana admine açıktır' });
  const { rows } = await query('SELECT id,username,email,two_factor_method,two_factor_question FROM users WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  res.json(rows[0]);
});

app.put('/api/admin/user/:id/2fa', adminMiddleware, async (req, res) => {
  if (!req.adminUser.isSuperAdmin) return res.status(403).json({ error: 'Bu işlem yalnızca ana admine açıktır' });
  const { method, question, answer } = req.body || {};
  if (!['none', 'email', 'question'].includes(method)) return res.status(400).json({ error: 'Geçersiz doğrulama yöntemi' });
  if (method === 'question' && (!question || normalizeSecurityAnswer(answer).length < 2)) return res.status(400).json({ error: 'Soru ve cevap zorunlu' });
  const { rows } = await query('UPDATE users SET two_factor_method=$1,two_factor_question=$2,two_factor_answer_hash=$3 WHERE id=$4 RETURNING id,username,email,two_factor_method,two_factor_question', [method, method === 'question' ? String(question).trim() : '', method === 'question' ? hashPassword(normalizeSecurityAnswer(answer)) : '', req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  res.json(rows[0]);
});

app.get('/api/admin/users', adminMiddleware, async (req, res) => {
  const { rows } = await query(`
    SELECT u.*,
         (SELECT COUNT(*)::int FROM ad_panel_assignments apa WHERE apa.user_id=u.id) AS ad_panel_count,
           COALESCE(
             json_agg(
               json_build_object(
                 'id', b.id, 'name', b.name, 'icon', b.icon, 'color', b.color,
                 'assigned_at', ub.assigned_at
               ) ORDER BY ub.assigned_at DESC
             ) FILTER (WHERE b.id IS NOT NULL),
             '[]'::json
           ) AS badges
    FROM users u
    LEFT JOIN user_badges ub ON ub.user_id=u.id
    LEFT JOIN badges b ON b.id=ub.badge_id AND COALESCE(b.is_hidden,0)=0
    GROUP BY u.id
    ORDER BY u.created_at DESC
  `);
  res.json(rows.map(u => ({ ...sanitizeUser(u), badges: Array.isArray(u.badges) ? u.badges : [] })));
});

app.get('/api/admin/user/:id/ad-panels', adminMiddleware, async (req, res) => {
  try {
    const { rows: users } = await query('SELECT id,username FROM users WHERE id=$1', [req.params.id]);
    if (!users.length) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
    res.json(await listAdPanelAssignments(req.params.id));
  } catch (error) {
    res.status(500).json({ error: 'Kullanıcının reklam panelleri alınamadı.' });
  }
});

app.post('/api/admin/user/:id/ad-panels', adminMiddleware, async (req, res) => {
  try {
    const { rows: users } = await query('SELECT id,username FROM users WHERE id=$1', [req.params.id]);
    if (!users.length) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
    const result = await attachAdPanelToUser(
      users[0].id,
      req.body?.identifier,
      req.body?.ad_type,
      req.adminUser.id,
      req.adminUser.username
    );
    if (!result.assignment) return res.status(result.ambiguous ? 409 : 404).json({ error: result.error });
    await logAction(req.adminUser.username, 'ad_panel_assigned', users[0].username, `${result.assignment.ad_type} · #${result.assignment.ad_id} · ${result.assignment.portal_code}`, getIp(req), getClientInfo(req));
    res.json(result.assignment);
  } catch (error) {
    res.status(500).json({ error: 'Reklam paneli atanamadı.' });
  }
});

app.delete('/api/admin/user/:id/ad-panels/:assignmentId', adminMiddleware, async (req, res) => {
  try {
    const { rows } = await query(
      'DELETE FROM ad_panel_assignments WHERE id=$1 AND user_id=$2 RETURNING ad_type,ad_id',
      [req.params.assignmentId, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Reklam paneli ataması bulunamadı.' });
    await logAction(req.adminUser.username, 'ad_panel_unassigned', req.params.id, `${rows[0].ad_type} · #${rows[0].ad_id}`, getIp(req), getClientInfo(req));
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Reklam paneli ataması kaldırılamadı.' });
  }
});

// Silme talebi veren hesaplar yalnızca ana admin tarafından görülebilir.
app.get('/api/admin/account-deletions', adminMiddleware, async (req, res) => {
  if (!req.adminUser.isSuperAdmin) return res.status(403).json({ error: 'Bu bölüm yalnızca ana admine açıktır' });
  const { rows } = await query(`
    SELECT id, username, email, avatar, delete_requested_at,
           delete_requested_at + INTERVAL '10 days' AS delete_at,
           GREATEST(
             0,
             CEIL(EXTRACT(EPOCH FROM (delete_requested_at + INTERVAL '10 days' - NOW())) / 86400)
           )::int AS days_remaining
    FROM users
    WHERE is_deleted=1 AND delete_requested_at IS NOT NULL
    ORDER BY delete_requested_at ASC
  `);
  res.json(rows);
});

// Silme talebi yalnızca ana admin tarafından iptal edilebilir.
app.post('/api/admin/account-deletions/:id/cancel', adminMiddleware, async (req, res) => {
  if (!req.adminUser.isSuperAdmin) return res.status(403).json({ error: 'Hesap silme iptali yalnızca ana admine açıktır' });
  const { rows } = await query(
    'UPDATE users SET is_deleted=0, delete_requested_at=NULL WHERE id=$1 AND is_deleted=1 RETURNING id, username',
    [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Aktif silme talebi bulunamadı' });
  await logAction(req.adminUser.username || 'admin', 'admin_cancel_account_delete', rows[0].username);
  res.json({ ok: true, user: rows[0] });
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
  if (isReservedVmbBadgeName(badge_name)) return res.status(400).json({ error: 'VMB özel rozeti ayrı VMB işlemiyle verilir' });
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

app.get('/api/admin/group/:id/messages', adminMiddleware, async (req, res) => {
  const { rows: groups } = await query('SELECT id, name, slug FROM groups WHERE id=$1', [req.params.id]);
  if (!groups.length) return res.status(404).json({ error: 'Grup bulunamadı' });
  const { rows } = await query(`SELECT gm.*, u.username, u.avatar, u.avatar_removed
    FROM group_messages gm LEFT JOIN users u ON u.id=gm.user_id
    WHERE gm.group_id=$1 ORDER BY gm.created_at ASC LIMIT 500`, [groups[0].id]);
  res.json({ group: groups[0], messages: rows });
});

app.patch('/api/admin/group/:id/status', adminMiddleware, async (req, res) => {
  const status = String(req.body.status || '').trim();
  const reason = String(req.body.reason || '').trim();
  if (!['active', 'suspended', 'banned'].includes(status)) return res.status(400).json({ error: 'Geçersiz grup durumu' });
  if (status !== 'active' && !reason) return res.status(400).json({ error: 'Askıya alma veya yasaklama nedeni zorunlu' });
  const { rows } = await query("UPDATE groups SET moderation_status=$1, moderation_reason=$2, moderated_at=CASE WHEN $1='active' THEN NULL ELSE NOW() END, moderated_by=$3 WHERE id=$4 RETURNING *", [status, status === 'active' ? '' : reason, req.adminUser.id, req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Grup bulunamadı' });
  await logAction(req.adminUser.username, status === 'active' ? 'restore_group' : `${status}_group`, rows[0].slug);
  res.json(rows[0]);
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
  const { rows } = await query("SELECT id, actor, target, detail, ip, user_agent, device, operating_system, country, city, created_at FROM system_logs WHERE action='restricted_route_attempt' ORDER BY created_at DESC LIMIT $1", [limit]);
  res.json(rows);
});

app.get('/api/admin/authority-logs', adminMiddleware, async (req, res) => {
  if (!req.adminUser.isSuperAdmin) return res.status(403).json({ error: 'Bu loglar yalnızca ana admin içindir' });
  const limit = Math.min(parseInt(req.query.limit) || 500, 1000);
  const { rows } = await query("SELECT id, actor, action, target, detail, ip, created_at FROM system_logs WHERE action IN ('authority_login','apply_restriction','revoke_restriction','suspend_content') OR actor IN (SELECT username FROM users WHERE is_admin=1) ORDER BY created_at DESC LIMIT $1", [limit]);
  res.json(rows);
});

app.get('/api/admin/settings', adminMiddleware, async (req, res) => {
  if (!req.adminUser.isSuperAdmin) return res.status(403).json({ error: 'Site ayarları yalnızca ana admine açıktır' });
  const { rows } = await query('SELECT * FROM settings');
  res.json(Object.fromEntries(rows.map(s => [s.key, s.value])));
});

app.post('/api/admin/settings', adminMiddleware, async (req, res) => {
  if (!req.adminUser.isSuperAdmin) return res.status(403).json({ error: 'Site ayarları yalnızca ana admine açıktır' });
  const { key } = req.body;
  let { value } = req.body;
  if (!key) return res.status(400).json({ error: 'Key zorunlu' });
  if (key === 'admin_password' && String(value || '').length < 12) {
    return res.status(400).json({ error: 'Admin şifresi en az 12 karakter olmalı' });
  }
  if (key === 'photo_song_clip_seconds') {
    const seconds = Number(value);
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 300) {
      return res.status(400).json({ error: 'Fotoğraf müziği süresi 1-300 saniye arasında tam sayı olmalı' });
    }
    value = String(seconds);
  }
  const storedValue = key === 'admin_password' ? hashPassword(String(value || '')) : value;
  await query('INSERT INTO settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', [key, storedValue]);
  res.json({ ok: true });
});

app.post('/api/admin/upload-call-ringtone', adminMiddleware, upload.single('ringtone'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Ses dosyası gerekli' });
  try { res.json({ url: await handleUpload(req.file) }); }
  catch (error) { res.status(400).json({ error: error.message || 'Ses dosyası yüklenemedi' }); }
});

app.post('/api/admin/upload-message-sound', adminMiddleware, upload.single('sound'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Mesaj bildirimi sesi gerekli' });
  try { res.json({ url: await handleUpload(req.file) }); }
  catch (error) { res.status(400).json({ error: error.message || 'Mesaj bildirimi sesi yüklenemedi' }); }
});

app.post('/api/admin/upload-mention-sound', adminMiddleware, upload.single('sound'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Etiket bildirimi sesi gerekli' });
  try { res.json({ url: await handleUpload(req.file) }); }
  catch (error) { res.status(400).json({ error: error.message || 'Etiket bildirimi sesi yüklenemedi' }); }
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
  const keys = ['site_name', 'footer_copyright_text', 'primary_color', 'background_color', 'light_primary_color', 'light_background_color', 'device_theme_enabled', 'theme_picker_enabled', 'book_bg_color', 'first_visit_auth', 'auth_required', 'photo_song_clip_seconds'];
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

function parseRestrictionDuration(value) {
  const input = String(value || '').trim().toLowerCase();
  if (!input || /süresiz|sure[s]?iz|kalıcı|kalici/.test(input)) return null;
  const units = { dakika: 60000, dk: 60000, saat: 3600000, sa: 3600000, gün: 86400000, gun: 86400000, hafta: 604800000 };
  let total = 0;
  const matches = input.matchAll(/(\d+(?:[.,]\d+)?)\s*(dakika|dk|saat|sa|gün|gun|hafta)/g);
  for (const match of matches) total += Number(match[1].replace(',', '.')) * units[match[2]];
  if (!total) return undefined;
  return new Date(Date.now() + total);
}

app.get('/api/admin/user/:id/restrictions', adminMiddleware, async (req, res) => {
  if (!req.adminUser.isSuperAdmin && !req.adminUser.permissions.can_restrict_users) return res.status(403).json({ error: 'Kısıtlama yetkisi yok' });
  const { rows } = await query('SELECT * FROM user_restrictions WHERE user_id=$1 ORDER BY created_at DESC', [req.params.id]);
  res.json(rows);
});

app.post('/api/admin/user/:id/restrictions', adminMiddleware, async (req, res) => {
  if (!req.adminUser.isSuperAdmin && !req.adminUser.permissions.can_restrict_users) return res.status(403).json({ error: 'Kısıtlama yetkisi yok' });
  const types = ['photo','story','reals','music','comment','forum','message','group'];
  const type = String(req.body.restriction_type || '');
  const reason = String(req.body.reason || '').trim();
  if (!types.includes(type)) return res.status(400).json({ error: 'Geçerli bir kısıtlama türü seçin' });
  if (!reason) return res.status(400).json({ error: 'Kısıtlama nedeni zorunludur' });
  const expiresAt = parseRestrictionDuration(req.body.duration);
  if (expiresAt === undefined) return res.status(400).json({ error: 'Süreyi örneğin 2 gün 4 saat veya süresiz yazın' });
  const { rows: target } = await query('SELECT id, username FROM users WHERE id=$1', [req.params.id]);
  if (!target.length) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  await query("UPDATE user_restrictions SET revoked_at=NOW(), revoked_by=$1 WHERE user_id=$2 AND restriction_type=$3 AND revoked_at IS NULL", [req.adminUser.id, req.params.id, type]);
  const { rows } = await query('INSERT INTO user_restrictions (user_id,restriction_type,reason,expires_at,created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *', [req.params.id, type, reason, expiresAt, req.adminUser.id]);
  const labels = { photo:'fotoğraf', story:'hikaye', reals:'Reals', music:'müzik', comment:'yorum', forum:'forum', message:'mesaj', group:'grup' };
  const durationLabel = expiresAt ? expiresAt.toLocaleString('tr-TR') + ' tarihine kadar' : 'süresiz';
  await query('INSERT INTO notifications (user_id,type,actor_username,title,body,link) VALUES ($1,$2,$3,$4,$5,$6)', [req.params.id, 'restriction', 'CigCig Yetkilileri', 'Hesabınıza kısıtlama uygulandı', `CigCig Yetkilileri tarafından ${durationLabel} ${labels[type]} gönderme/oluşturma kısıtlaması aldınız. Neden: ${reason}`, '/bildirimler']);
  await logAction(req.adminUser.username, 'apply_restriction', target[0].username, JSON.stringify({ type, reason, expiresAt }), getIp(req));
  res.json(rows[0]);
});

app.delete('/api/admin/user/:id/restrictions/:restrictionId', adminMiddleware, async (req, res) => {
  if (!req.adminUser.isSuperAdmin && !req.adminUser.permissions.can_restrict_users) return res.status(403).json({ error: 'Kısıtlama yetkisi yok' });
  await query('UPDATE user_restrictions SET revoked_at=NOW(), revoked_by=$1 WHERE id=$2 AND user_id=$3', [req.adminUser.id, req.params.restrictionId, req.params.id]);
  await logAction(req.adminUser.username, 'revoke_restriction', req.params.id, req.params.restrictionId, getIp(req));
  res.json({ ok: true });
});

app.post('/api/admin/content/:type/:id/suspend', adminMiddleware, async (req, res) => {
  if (!req.adminUser.isSuperAdmin && !req.adminUser.permissions.can_suspend_content) return res.status(403).json({ error: 'İçerik askıya alma yetkisi yok' });
  const tables = { forum:'forums', book:'books', photo:'photos', video:'videos', reals:'videos', story:'stories', song:'songs', group:'groups' };
  const ownerColumns = { song:'uploader_id' };
  const type = String(req.params.type || '');
  const table = tables[type];
  const reason = String(req.body.reason || '').trim();
  if (!table || !/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'Geçersiz içerik' });
  if (!reason) return res.status(400).json({ error: 'Askıya alma nedeni zorunludur' });
  const ownerColumn = ownerColumns[type] || 'user_id';
  const { rows: content } = await query(`SELECT id, ${ownerColumn} AS user_id FROM ${table} WHERE id=$1`, [req.params.id]);
  if (!content.length) return res.status(404).json({ error: 'İçerik bulunamadı' });
  await query(`INSERT INTO content_suspensions (content_type,content_id,reason,suspended_by) VALUES ($1,$2,$3,$4) ON CONFLICT (content_type,content_id) DO UPDATE SET reason=EXCLUDED.reason,suspended_by=EXCLUDED.suspended_by,created_at=NOW()`, [type, req.params.id, reason, req.adminUser.id]);
  if (type === 'story') await query('UPDATE stories SET is_suspended=1 WHERE id=$1', [req.params.id]);
  if (type === 'song') await query("UPDATE songs SET status='suspended', ban_reason=$1, ban_until=NULL WHERE id=$2", [reason, req.params.id]);
  const owner = content[0].user_id ? (await query('SELECT username FROM users WHERE id=$1', [content[0].user_id])).rows[0] : null;
  if (owner) await query('INSERT INTO notifications (user_id,type,actor_username,title,body,link) VALUES ($1,$2,$3,$4,$5,$6)', [content[0].user_id, 'content_suspended', 'CigCig Yetkilileri', 'İçeriğiniz askıya alındı', `CigCig Yetkilileri içeriğinizi şu nedenle askıya aldı: ${reason}`, '/bildirimler']);
  await logAction(req.adminUser.username, 'suspend_content', owner?.username || String(req.params.id), JSON.stringify({ type, contentId: req.params.id, reason }), getIp(req));
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
  if (await denyIfRestricted(req, res, 'music')) return;
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
            s.remastered_audio_url, s.play_count, s.slug, s.song_type, s.published_at, s.share_reason,
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
    `SELECT s.*, u.username as uploader, u.avatar as uploader_avatar, u.is_artist,
            COALESCE((SELECT json_agg(json_build_object(
              'id', rs.id, 'title', rs.title, 'artist_name', rs.artist_name,
              'cover_url', rs.cover_url, 'audio_url', rs.audio_url, 'slug', rs.slug,
              'play_count', rs.play_count
            ) ORDER BY sr.position, sr.created_at)
            FROM song_recommendations sr
            JOIN songs rs ON rs.id=sr.recommended_song_id
            WHERE sr.song_id=s.id AND rs.status='active'), '[]'::json) AS recommendations
     FROM songs s LEFT JOIN users u ON s.uploader_id=u.id
     WHERE s.slug=$1`,
    [req.params.slug]
  );
  if (!rows.length) return res.status(404).json({ error: 'Şarkı bulunamadı' });
  res.json(rows[0]);
});

// Dinlenme sayısı artır
app.post('/api/songs/:slug/play', async (req, res) => {
  const { rows } = await query('SELECT id FROM songs WHERE slug=$1 AND status=\'active\'', [req.params.slug]);
  if (!rows.length) return res.status(404).json({ error: 'Şarkı bulunamadı' });
  await query('UPDATE songs SET play_count=play_count+1 WHERE id=$1', [rows[0].id]);
  await recordContentView('song', rows[0].id, req);
  res.json({ ok: true });
});

// Yarı dinleme sayacı — şarkının %50'sine ulaşınca çağrılır
app.post('/api/songs/:slug/play-half', async (req, res) => {
  const { rows } = await query('SELECT id FROM songs WHERE slug=$1 AND status=\'active\'', [req.params.slug]);
  if (!rows.length) return res.status(404).json({ error: 'Şarkı bulunamadı' });
  await query('UPDATE songs SET play_count=play_count+1 WHERE id=$1', [rows[0].id]);
  await recordContentView('song', rows[0].id, req);
  res.json({ ok: true });
});

app.post('/api/songs/:id/remastered', authMiddleware, upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Remastered ses dosyası gerekli.' });
  const { rows: songs } = await query('SELECT id,uploader_id FROM songs WHERE id=$1', [req.params.id]);
  if (!songs.length) return res.status(404).json({ error: 'Şarkı bulunamadı' });
  if (songs[0].uploader_id !== req.user.id && !req.user.is_admin) return res.status(403).json({ error: 'Yalnızca şarkı sahibi ekleyebilir.' });
  try {
    const audioUrl = await handleUpload(req.file);
    const { rows } = await query('UPDATE songs SET remastered_audio_url=$1 WHERE id=$2 RETURNING id,remastered_audio_url', [audioUrl, songs[0].id]);
    res.json({ ok: true, ...rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Remastered ses yüklenemedi: ' + error.message });
  }
});

app.post('/api/songs/:id/recommendations', authMiddleware, async (req, res) => {
  const targetId = Number.parseInt(req.body?.song_id, 10);
  if (!Number.isSafeInteger(targetId) || targetId < 1) return res.status(400).json({ error: 'Geçerli bir öneri şarkısı seçin.' });
  const { rows: owner } = await query('SELECT id,uploader_id FROM songs WHERE id=$1', [req.params.id]);
  const { rows: target } = await query('SELECT id FROM songs WHERE id=$1 AND status=\'active\'', [targetId]);
  if (!owner.length || !target.length) return res.status(404).json({ error: 'Şarkı bulunamadı.' });
  if (owner[0].uploader_id !== req.user.id && !req.user.is_admin) return res.status(403).json({ error: 'Yalnızca şarkı sahibi öneri ekleyebilir.' });
  if (owner[0].id === targetId) return res.status(400).json({ error: 'Şarkı kendisini öneremez.' });
  await query(`INSERT INTO song_recommendations(song_id,recommended_song_id,position)
    VALUES($1,$2,(SELECT COALESCE(MAX(position),-1)+1 FROM song_recommendations WHERE song_id=$1))
    ON CONFLICT (song_id,recommended_song_id) DO NOTHING`, [owner[0].id, targetId]);
  res.json({ ok: true });
});

app.delete('/api/songs/:id/recommendations/:recommendedId', authMiddleware, async (req, res) => {
  const { rows: owner } = await query('SELECT uploader_id FROM songs WHERE id=$1', [req.params.id]);
  if (!owner.length) return res.status(404).json({ error: 'Şarkı bulunamadı.' });
  if (owner[0].uploader_id !== req.user.id && !req.user.is_admin) return res.status(403).json({ error: 'Yalnızca şarkı sahibi düzenleyebilir.' });
  await query('DELETE FROM song_recommendations WHERE song_id=$1 AND recommended_song_id=$2', [req.params.id, req.params.recommendedId]);
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
app.get('/muzikler', async (req, res) => {
  let songs = [];
  try {
    const { rows } = await query(`SELECT s.slug, s.title, s.artist_name, s.genre, s.cover_url,
        s.published_at, s.created_at, u.username
      FROM songs s LEFT JOIN users u ON u.id=s.uploader_id
      WHERE s.status='active' AND COALESCE(u.is_private,0)=0 AND COALESCE(u.is_deleted,0)=0
        AND NOT EXISTS (SELECT 1 FROM content_suspensions cs WHERE cs.content_type='song' AND cs.content_id=s.id)
      ORDER BY COALESCE(s.published_at,s.created_at) DESC LIMIT 100`);
    songs = rows;
  } catch (error) {
    console.warn('[SEO] music list render failed:', error.message);
  }
  const songBody = songs.length
    ? `<div class="seo-content-grid">${songs.map(song => `<article class="seo-content-card seo-song-card">
        ${song.cover_url ? serverImage(song.cover_url, song.title, 'seo-content-image') : '<div class="seo-placeholder-icon">♫</div>'}
        <div class="seo-content-card-body">
          <h2><a href="/muzik/${escapeHtml(song.slug)}">${escapeHtml(song.title)}</a></h2>
          <p>${escapeHtml(song.artist_name || 'CigCig sanatçısı')}${song.genre ? ` · ${escapeHtml(song.genre)}` : ''}</p>
          <div class="seo-content-meta">Yükleyen: ${serverProfileLink(song.username)}</div>
        </div>
      </article>`).join('')}</div>`
    : '<p class="seo-empty">Henüz yayınlanmış müzik bulunmuyor.</p>';
  res.send(injectMeta('Müzikler – CigCig Müzik', 'CigCig müzik platformu. Türkçe şarkılar, artist müzikleri.', `${SITE_URL}/muzikler`, '', '', serverPageBody('CİGCİG MÜZİK', 'Müzikler', 'Topluluktan yeni şarkıları keşfet.', songBody)));
});
app.get('/muzik/:slug', async (req, res) => {
  const { rows } = await query(`SELECT s.*, u.username
    FROM songs s LEFT JOIN users u ON u.id=s.uploader_id
    WHERE s.slug=$1 AND s.status='active' AND COALESCE(u.is_private,0)=0 AND COALESCE(u.is_deleted,0)=0
      AND NOT EXISTS (SELECT 1 FROM content_suspensions cs WHERE cs.content_type='song' AND cs.content_id=s.id)`, [req.params.slug]);
  if (!rows.length) return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  const s = rows[0];
  const musicKw = `${s.title}, ${s.artist_name}, müzik, CigCig müzik, topluluk platformu, türkçe müzik`;
  const musicLd = safeJsonLd({
    '@context':'https://schema.org','@type':'MusicRecording',
    'name': s.title,
    'byArtist':{'@type':'MusicGroup','name':s.artist_name},
    'url': `${SITE_URL}/muzik/${s.slug}`,
     ...(s.cover_url ? { image: s.cover_url } : {}),
     ...(s.published_at ? { datePublished: s.published_at } : {}),
    'publisher':{'@type':'Organization','name':'CigCig','url':SITE_URL}
  });
  res.send(injectMeta(
    `${s.title} – ${s.artist_name} | CigCig Müzik`,
    `${s.artist_name} - ${s.title} | CigCig müzik platformunda dinle ve keşfet.`,
    `${SITE_URL}/muzik/${s.slug}`,
    s.cover_url,
     `<meta name="keywords" content="${escapeHtml(musicKw)}" />\n    <script type="application/ld+json">${musicLd}</script>`,
     serverPageBody('CİGCİG MÜZİK', s.title, `${s.artist_name} tarafından seslendirilen şarkı.`, `<article class="seo-article">
       ${s.cover_url ? serverImage(s.cover_url, s.title, 'seo-hero-image') : ''}
       <h2>${escapeHtml(s.artist_name)}</h2>
       ${s.genre ? `<p class="seo-content-meta">Tür: ${escapeHtml(s.genre)}</p>` : ''}
       ${s.lyrics ? `<div class="seo-lyrics"><h3>Şarkı sözleri</h3><div class="seo-article-text">${escapeHtml(s.lyrics)}</div></div>` : ''}
       <p class="seo-content-meta">Yükleyen: ${serverProfileLink(s.username)}</p>
     </article>`)
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
      `SELECT p.*, owner.username AS owner_username, CAST(COUNT(ps.id) AS INTEGER) as song_count
       FROM playlists p
       LEFT JOIN playlist_songs ps ON ps.playlist_id = p.id
       LEFT JOIN playlists source_playlist ON source_playlist.id = p.source_playlist_id
       LEFT JOIN users owner ON owner.id = COALESCE(source_playlist.user_id, p.user_id)
       WHERE p.user_id = $1
       GROUP BY p.id, owner.username
       ORDER BY p.created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/playlists', authMiddleware, playlistCoverUpload.single('cover'), async (req, res) => {
  try {
    const { name, description, cover_url, is_public } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Playlist adı gerekli' });
    const uploadedCover = req.file ? await handleUpload(req.file) : (cover_url || '');
    const { rows } = await query(
      'INSERT INTO playlists (user_id, public_id, name, description, emoji, cover_url, is_public) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [req.user.id, createPlaylistPublicId(), name.trim(), description?.trim() || '', '', uploadedCover, parseFormBoolean(is_public, true) ? 1 : 0]
    );
    res.json(rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/playlists/:id', optionalAuth, async (req, res) => {
  try {
    const { rows: pl } = await query(`
      SELECT p.*, owner.username AS owner_username
      FROM playlists p
      LEFT JOIN playlists source_playlist ON source_playlist.id = p.source_playlist_id
      LEFT JOIN users owner ON owner.id = COALESCE(source_playlist.user_id, p.user_id)
      WHERE p.public_id=$1 OR p.id::text=$1
    `, [req.params.id]);
    if (!pl.length) return res.status(404).json({ error: 'Playlist bulunamadı' });
    const isOwner = !!req.user && String(pl[0].user_id) === String(req.user.id);
    if (!pl[0].is_public && !isOwner) return res.status(404).json({ error: 'Playlist bulunamadı' });
    const { rows: songs } = await query(
      `SELECT ps.id as ps_id, ps.position, s.id, s.slug, s.title, s.artist_name, s.cover_url, s.audio_url, s.play_count
       FROM playlist_songs ps
       JOIN songs s ON s.id = ps.song_id
       WHERE ps.playlist_id = $1 AND s.status = 'active'
       ORDER BY ps.position ASC, ps.added_at ASC`,
      [pl[0].id]
    );
    res.json({ ...pl[0], songs, is_owner: isOwner });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/playlists/:id', authMiddleware, playlistCoverUpload.single('cover'), async (req, res) => {
  try {
    const { name, description, cover_url, is_public, remove_cover } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Playlist adı gerekli' });
    const nextCover = req.file
      ? await handleUpload(req.file)
      : (parseFormBoolean(remove_cover, false) ? '' : (Object.prototype.hasOwnProperty.call(req.body, 'cover_url') ? (cover_url || '') : null));
    const { rows } = await query(
      'UPDATE playlists SET name=$1, description=$2,emoji=$3,cover_url=COALESCE($4, cover_url),is_public=$5 WHERE (public_id=$6 OR id::text=$6) AND user_id=$7 AND source_playlist_id IS NULL RETURNING *',
      [name.trim(), description?.trim() || '', '', nextCover, parseFormBoolean(is_public, true) ? 1 : 0, req.params.id, req.user.id]
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
    const { rows: created } = await query(`INSERT INTO playlists (user_id,public_id,name,description,emoji,cover_url,is_public,source_playlist_id)
      VALUES ($1,$2,$3,$4,$5,$6,1,$7) RETURNING *`, [req.user.id, createPlaylistPublicId(), p.name, p.description, '', p.cover_url || '', p.source_playlist_id || p.id]);
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
    const { rows: pl } = await query('SELECT id FROM playlists WHERE (public_id=$1 OR id::text=$1) AND user_id=$2 AND source_playlist_id IS NULL', [req.params.id, req.user.id]);
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
    const { rows: pl } = await query('SELECT id FROM playlists WHERE (public_id=$1 OR id::text=$1) AND user_id=$2 AND source_playlist_id IS NULL', [req.params.id, req.user.id]);
    if (!pl.length) return res.status(404).json({ error: 'Playlist bulunamadı' });
    await query('DELETE FROM playlist_songs WHERE playlist_id=$1 AND song_id=$2', [pl[0].id, req.params.songId]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/playlists/:id/reorder', authMiddleware, async (req, res) => {
  try {
    const { order } = req.body;
    if (!Array.isArray(order)) return res.status(400).json({ error: 'order array gerekli' });
    const { rows: pl } = await query('SELECT id FROM playlists WHERE (public_id=$1 OR id::text=$1) AND user_id=$2 AND source_playlist_id IS NULL', [req.params.id, req.user.id]);
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
    can_view_logs, can_manage_settings, can_manage_admins, can_view_users,
    can_suspend_content, can_restrict_users, can_review_artists, can_assign_badges,
    can_view_store, can_view_groups, can_view_stories, can_view_reals, can_view_levels
  } = req.body;
  // Kullanıcıyı admin yap (is_admin=1 yoksa set et)
  await query('UPDATE users SET is_admin=1 WHERE id=$1', [uid]);
  const { rows: existing } = await query('SELECT id FROM admin_permissions WHERE user_id=$1', [uid]);
  if (existing.length) {
    await query(`UPDATE admin_permissions SET
      can_ban_users=$1, can_delete_content=$2, can_edit_content=$3,
      can_manage_levels=$4, can_manage_tags=$5, can_manage_announcements=$6,
      can_view_logs=$7, can_manage_settings=$8, can_manage_admins=$9, can_view_users=$10
      , can_suspend_content=$11, can_restrict_users=$12, can_review_artists=$13, can_assign_badges=$14,
      can_view_store=$15, can_view_groups=$16, can_view_stories=$17, can_view_reals=$18, can_view_levels=$19
      WHERE user_id=$20`,
      [can_ban_users?1:0, can_delete_content?1:0, can_edit_content?1:0,
      can_manage_levels?1:0, can_manage_tags?1:0, can_manage_announcements?1:0,
      can_view_logs?1:0, can_manage_settings?1:0, can_manage_admins?1:0, can_view_users?1:0,
      can_suspend_content?1:0, can_restrict_users?1:0, can_review_artists?1:0, can_assign_badges?1:0,
      can_view_store?1:0, can_view_groups?1:0, can_view_stories?1:0, can_view_reals?1:0, can_view_levels?1:0, uid]);
  } else {
    await query(`INSERT INTO admin_permissions
      (user_id, can_ban_users, can_delete_content, can_edit_content, can_manage_levels,
      can_manage_tags, can_manage_announcements, can_view_logs, can_manage_settings, can_manage_admins, can_view_users,
        can_suspend_content, can_restrict_users, can_review_artists, can_assign_badges, can_view_store, can_view_groups, can_view_stories, can_view_reals, can_view_levels)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
      [uid, can_ban_users?1:0, can_delete_content?1:0, can_edit_content?1:0,
      can_manage_levels?1:0, can_manage_tags?1:0, can_manage_announcements?1:0,
      can_view_logs?1:0, can_manage_settings?1:0, can_manage_admins?1:0, can_view_users?1:0,
      can_suspend_content?1:0, can_restrict_users?1:0, can_review_artists?1:0, can_assign_badges?1:0,
      can_view_store?1:0, can_view_groups?1:0, can_view_stories?1:0, can_view_reals?1:0, can_view_levels?1:0]);
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
      can_view_logs:1, can_manage_settings:1, can_manage_admins:1, can_view_users:1,
      can_suspend_content:1, can_restrict_users:1, can_review_artists:1, can_assign_badges:1,
      can_view_store:1, can_view_groups:1, can_view_stories:1, can_view_reals:1, can_view_levels:1
    }
  });
});

// ===== SITE AYARLARI (logo vb.) =====
app.get('/api/settings/public', async (req, res) => {
  const keys = [
    'site_name','site_description','primary_color','background_color','light_primary_color','light_background_color',
    'device_theme_enabled','theme_picker_enabled','homepage_sections','profile_tabs','footer_copyright_text',
    'first_visit_auth','auth_required','call_ringtone_url','message_notification_sound_url','mention_notification_sound_url',
    'photo_song_clip_seconds'
  ];
  const { rows } = await query('SELECT key, value FROM settings WHERE key = ANY($1)', [keys]);
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

function injectCrawlableBody(html, bodyHtml) {
  if (!bodyHtml) return html;
  return html.replace('<div id="app"></div>', `<div id="app">${bodyHtml}</div>`);
}

function serverPageBody(eyebrow, title, description, content) {
  return `<main class="container page seo-server-content">
    <div class="page-header">
      <div class="page-kicker">${escapeHtml(eyebrow)}</div>
      <h1 class="page-title">${escapeHtml(title)}</h1>
      ${description ? `<p class="page-subtitle">${escapeHtml(description)}</p>` : ''}
    </div>
    ${content}
  </main>`;
}

function serverProfileLink(username) {
  if (!username) return '<span>Anonim</span>';
  return `<a href="/profil/${escapeHtml(profileRouteKey(username))}">${escapeHtml(username)}</a>`;
}

function serverImage(url, alt, className = '') {
  return url ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt || '')}"${className ? ` class="${className}"` : ''} loading="lazy" />` : '';
}

function safeJsonLd(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function injectMeta(title, desc, url, imageUrl, extraMeta, bodyHtml) {
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
  if (injected !== html) return injectCrawlableBody(injected, bodyHtml);
  // Yedek: regex ile herhangi bir title tag'ını değiştir
  return injectCrawlableBody(html.replace(/<title>[^<]*<\/title>/, meta), bodyHtml);
}

app.get('/giris', (req, res) => res.send(injectMeta('Giriş – CigCig', 'CigCig hesabına giriş yap.', `${SITE_URL}/giris`, '')));
app.get('/kayit', (req, res) => res.send(injectMeta('Kayıt Ol – CigCig', 'CigCig\'e ücretsiz kaydol.', `${SITE_URL}/kayit`, '')));
app.get('/forum', async (req, res) => {
  const tag = req.query.tag || '';
  let topics = [];
  try {
    const term = tag ? `%${tag}%` : null;
    const result = await query(`SELECT f.slug, f.title, f.content, f.created_at, f.updated_at,
        f.banner_image, u.username,
        (SELECT COUNT(*) FROM forum_comments fc WHERE fc.forum_id=f.id) AS comment_count
      FROM forums f LEFT JOIN users u ON u.id=f.user_id
      WHERE COALESCE(u.is_private,0)=0 AND COALESCE(u.is_deleted,0)=0
        AND NOT EXISTS (SELECT 1 FROM content_suspensions cs WHERE cs.content_type='forum' AND cs.content_id=f.id)
        AND ($1::text IS NULL OR f.title ILIKE $1 OR f.content ILIKE $1 OR f.custom_tags ILIKE $1
          OR EXISTS (SELECT 1 FROM forum_tags ft JOIN tags t ON t.id=ft.tag_id WHERE ft.forum_id=f.id AND t.name ILIKE $1))
      ORDER BY f.created_at DESC LIMIT 100`, [term]);
    topics = result.rows;
  } catch (error) {
    console.warn('[SEO] forum list render failed:', error.message);
  }
  const topicBody = topics.length
    ? `<div class="seo-content-grid">${topics.map(topic => `<article class="seo-content-card">
        ${topic.banner_image ? serverImage(topic.banner_image, topic.title, 'seo-content-image') : ''}
        <div class="seo-content-card-body">
          <h2><a href="/forum/${escapeHtml(topic.slug)}">${escapeHtml(topic.title)}</a></h2>
          <p>${escapeHtml(String(topic.content || '').replace(/\s+/g, ' ').slice(0, 220))}</p>
          <div class="seo-content-meta"> ${serverProfileLink(topic.username)} · ${escapeHtml(topic.comment_count || 0)} yorum · ${topic.created_at ? escapeHtml(new Date(topic.created_at).toLocaleDateString('tr-TR')) : ''}</div>
        </div>
      </article>`).join('')}</div>`
    : '<p class="seo-empty">Henüz yayınlanmış konu bulunmuyor.</p>';
  res.send(injectMeta(tag ? `${tag} Konuları – CigCig` : 'Konular – CigCig',
    tag ? `CigCig topluluk platformunda ${tag} etiketli konular.` : 'CigCig, her şeyden, her platformdan özelliği barındıran bir topluluk platformu.',
    `${SITE_URL}/forum${tag ? '?tag='+encodeURIComponent(tag) : ''}`, '', '', serverPageBody('CİGCİG TOPLULUĞU', tag ? `${tag} konuları` : 'Topluluk konuları', 'Sorular, fikirler ve topluluktan gerçek konuşmalar.', topicBody)));
});
app.get('/kitaplar', async (req, res) => {
  let books = [];
  try {
    const { rows } = await query(`SELECT b.slug, b.title, b.preface, b.cover_image, b.page_count,
        b.updated_at, u.username
      FROM books b LEFT JOIN users u ON u.id=b.user_id
      WHERE b.is_hidden=0 AND COALESCE(b.is_unnamed,0)=0 AND COALESCE(b.password_hash,'')=''
        AND COALESCE(u.is_private,0)=0 AND COALESCE(u.is_deleted,0)=0
        AND NOT EXISTS (SELECT 1 FROM content_suspensions cs WHERE cs.content_type='book' AND cs.content_id=b.id)
      ORDER BY b.updated_at DESC, b.created_at DESC LIMIT 100`);
    books = rows;
  } catch (error) {
    console.warn('[SEO] book list render failed:', error.message);
  }
  const bookBody = books.length
    ? `<div class="seo-content-grid">${books.map(book => `<article class="seo-content-card seo-book-card">
        ${book.cover_image ? serverImage(book.cover_image, book.title, 'seo-content-image') : '<div class="seo-placeholder-icon">▣</div>'}
        <div class="seo-content-card-body">
          <h2><a href="/kitap/${escapeHtml(book.slug)}">${escapeHtml(book.title)}</a></h2>
          <p>${escapeHtml((book.preface || `${book.title} adlı CigCig kitabı.`).replace(/\s+/g, ' ').slice(0, 220))}</p>
          <div class="seo-content-meta">${escapeHtml(book.username || 'CigCig yazarı')} · ${escapeHtml(book.page_count || 0)} sayfa</div>
        </div>
      </article>`).join('')}</div>`
    : '<p class="seo-empty">Henüz yayınlanmış kitap bulunmuyor.</p>';
  res.send(injectMeta('E-Kitaplar – CigCig', 'CigCig e-kitaplarını ücretsiz oku. Kitap adını aratarak bul.', `${SITE_URL}/kitaplar`, '', '', serverPageBody('CİGCİG KİTAPLIK', 'Kitaplar', 'Topluluğun yazdığı kitapları keşfet ve okumaya başla.', bookBody)));
});
app.get('/gruplar', async (req, res) => {
  let groups = [];
  try {
    const { rows } = await query(`SELECT name,slug,description,cover_image,banner_image,member_count
      FROM groups
      WHERE COALESCE(visibility,'public')='public' AND COALESCE(moderation_status,'active')='active'
      ORDER BY member_count DESC, created_at DESC LIMIT 100`);
    groups = rows;
  } catch (error) {
    console.warn('[SEO] group list render failed:', error.message);
  }
  const groupBody = groups.length
    ? `<div class="seo-content-grid">${groups.map(group => `<article class="seo-content-card">
        ${serverImage(group.cover_image || group.banner_image, group.name, 'seo-content-image')}
        <div class="seo-content-card-body">
          <h2><a href="/grup/${escapeHtml(group.slug)}">${escapeHtml(group.name)}</a></h2>
          <p>${escapeHtml(String(group.description || '').replace(/\s+/g, ' ').slice(0, 220))}</p>
          <div class="seo-content-meta">${escapeHtml(group.member_count || 0)} üye</div>
        </div>
      </article>`).join('')}</div>`
    : '<p class="seo-empty">Henüz herkese açık grup bulunmuyor.</p>';
  res.send(injectMeta('Gruplar – CigCig', 'CigCig topluluğundaki herkese açık gruplara katıl.', `${SITE_URL}/gruplar`, '', '', serverPageBody('CİGCİG GRUPLARI', 'Gruplar', 'İlgi alanlarına göre toplulukları keşfet.', groupBody)));
});
app.get('/ayarlar', (req, res) => res.send(injectMeta('Ayarlar – CigCig', 'Hesap ayarlarını düzenle.', `${SITE_URL}/ayarlar`, '')));
app.get('/mesajlar', (req, res) => res.send(injectMeta('Mesajlar – CigCig', 'Özel mesajlarınız.', `${SITE_URL}/mesajlar`, '')));
app.get('/mesajlar/:username', (req, res) => res.send(injectMeta('Mesajlar – CigCig', 'Özel mesajlarınız.', `${SITE_URL}/mesajlar/${req.params.username}`, '')));
app.get('/arkadaslar', (req, res) => res.send(injectMeta('Arkadaşlar – CigCig', 'Arkadaş listesi.', `${SITE_URL}/arkadaslar`, '')));

app.get('/forum/:slug', async (req, res) => {
  const { rows } = await query(`SELECT f.*, u.username, u.avatar,
    (SELECT COUNT(*) FROM forum_comments fc WHERE fc.forum_id=f.id) AS comment_count,
    (SELECT COUNT(*) FROM forum_likes fl WHERE fl.forum_id=f.id) AS like_count
    FROM forums f LEFT JOIN users u ON u.id=f.user_id
    WHERE f.slug=$1 AND COALESCE(u.is_private,0)=0 AND COALESCE(u.is_deleted,0)=0
      AND NOT EXISTS (SELECT 1 FROM content_suspensions cs WHERE cs.content_type='forum' AND cs.content_id=f.id)`, [req.params.slug]);
  if (!rows.length) return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  const forum = rows[0];
  const { rows: forumComments } = await query(`SELECT fc.id, fc.content, fc.created_at, u.username
    FROM forum_comments fc LEFT JOIN users u ON u.id=fc.user_id
    WHERE fc.forum_id=$1 ORDER BY fc.created_at ASC LIMIT 200`, [forum.id]);
  let html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
  const desc = escapeHtml((forum.content || '').substring(0, 160).replace(/\n/g, ' '));
  const imgTag = forum.banner_image
    ? `<meta property="og:image" content="${escapeHtml(forum.banner_image)}" /><meta name="twitter:image" content="${escapeHtml(forum.banner_image)}" /><meta name="twitter:card" content="summary_large_image" />`
    : `<meta property="og:image" content="${SITE_URL}/teatube.png" />`;
  const forumKw = `${escapeHtml(forum.title)}, CigCig, topluluk platformu, konu`;
  const forumLd = safeJsonLd({
    '@context':'https://schema.org','@type':'DiscussionForumPosting',
    'headline': forum.title,
    'url': `${SITE_URL}/forum/${forum.slug}`,
    'datePublished': forum.created_at,
    'dateModified': forum.updated_at || forum.created_at,
    'description': (forum.content||'').substring(0,200),
    'author':{'@type':'Person','name':forum.username||'Anonim'},
    'publisher':{'@type':'Organization','name':'CigCig','url':SITE_URL,'logo':{'@type':'ImageObject','url':`${SITE_URL}/cigcig.png`}}
  });
  const meta = `<title>${escapeHtml(forum.title)} – CigCig</title>
    <meta name="description" content="${desc}" />
    <meta name="keywords" content="${forumKw}" />
    <link rel="canonical" href="${SITE_URL}/forum/${escapeHtml(forum.slug)}" />
    <meta property="og:title" content="${escapeHtml(forum.title)} – CigCig" />
    <meta property="og:description" content="${desc}" />
    <meta property="og:type" content="article" />
    <meta property="og:url" content="${SITE_URL}/forum/${escapeHtml(forum.slug)}" />
    <meta property="og:site_name" content="CigCig" />
    ${imgTag}
    <script type="application/ld+json">${forumLd}</script>`;
  const commentsBody = forumComments.length
    ? `<section class="seo-comments"><h2>Yorumlar</h2>${forumComments.map(comment => `<article class="seo-comment">
        <div class="seo-comment-author">${serverProfileLink(comment.username)} <time>${escapeHtml(new Date(comment.created_at).toLocaleDateString('tr-TR'))}</time></div>
        <p>${escapeHtml(comment.content)}</p>
      </article>`).join('')}</section>`
    : '';
  const forumBody = serverPageBody('CİGCİG FORUM', forum.title, 'Topluluk konusu ve yorumları.', `<article class="seo-article">
    ${forum.banner_image ? serverImage(forum.banner_image, forum.title, 'seo-hero-image') : ''}
    <div class="seo-content-meta">Konu sahibi: ${serverProfileLink(forum.username)} · ${escapeHtml(forum.comment_count || 0)} yorum</div>
    <div class="seo-article-text">${escapeHtml(forum.content || '')}</div>
  </article>${commentsBody}`);
  const r1 = html.replace(/<!-- SEO_START -->[\s\S]*?<!-- SEO_END -->/m,`<!-- SEO_START -->\n  ${meta}\n  <!-- SEO_END -->`);
  const rendered = injectCrawlableBody(r1 !== html ? r1 : html.replace(/<title>[^<]*<\/title>/,meta), forumBody);
  res.send(rendered);
});

app.get('/kitap/:slug', async (req, res) => {
  const { rows } = await query(`SELECT b.*, u.username AS author FROM books b
    LEFT JOIN users u ON u.id=b.user_id
    WHERE b.slug=$1 AND b.is_hidden=0 AND COALESCE(b.is_unnamed,0)=0 AND COALESCE(b.password_hash,'')=''
      AND COALESCE(u.is_private,0)=0 AND COALESCE(u.is_deleted,0)=0
      AND NOT EXISTS (SELECT 1 FROM content_suspensions cs WHERE cs.content_type='book' AND cs.content_id=b.id)`, [req.params.slug]);
  if (!rows.length) return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  const book = rows[0];
  let html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
  const desc = escapeHtml((book.preface || book.title + ' – CigCig Kitap').substring(0, 160));
  const imgTag = book.cover_image
    ? `<meta property="og:image" content="${escapeHtml(book.cover_image)}" /><meta name="twitter:image" content="${escapeHtml(book.cover_image)}" />`
    : `<meta property="og:image" content="${SITE_URL}/teatube.png" />`;
  const bookKw = `${escapeHtml(book.title)}${book.author?', '+escapeHtml(book.author):''}, e-kitap, CigCig kitap, topluluk platformu, ücretsiz kitap oku`;
  const bookLd = safeJsonLd({
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
  const { rows: bookPages } = await query(`SELECT title, content, page_num, slug
    FROM book_pages WHERE book_id=$1 ORDER BY page_num ASC LIMIT 200`, [book.id]);
  const bookBody = serverPageBody('CİGCİG KİTAP', book.title, book.author ? `Yazar: ${book.author}` : 'CigCig topluluğunda yayınlanan kitap.', `<article class="seo-article">
    ${book.cover_image ? serverImage(book.cover_image, book.title, 'seo-hero-image') : ''}
    ${book.preface ? `<p class="seo-lead">${escapeHtml(book.preface)}</p>` : ''}
    ${bookPages.length ? `<section class="seo-book-pages"><h2>İçindekiler</h2><ol>${bookPages.map(page => `<li><a href="/kitap/${escapeHtml(book.slug)}/sayfa/${escapeHtml(page.slug)}">${escapeHtml(page.title)}</a></li>`).join('')}</ol></section>` : ''}
  </article>`);
  const r2 = html.replace(/<!-- SEO_START -->[\s\S]*?<!-- SEO_END -->/m,`<!-- SEO_START -->\n  ${meta}\n  <!-- SEO_END -->`);
  res.send(injectCrawlableBody(r2!==html?r2:html.replace(/<title>[^<]*<\/title>/,meta), bookBody));
});

app.get('/kitap/:slug/sayfa/:pageSlug', async (req, res) => {
  const { rows: pages } = await query(`SELECT bp.*, b.title AS book_title, b.slug AS book_slug, u.username AS author, b.cover_image
    FROM book_pages bp JOIN books b ON b.id=bp.book_id LEFT JOIN users u ON u.id=b.user_id
    WHERE bp.slug=$1 AND b.slug=$2 AND b.is_hidden=0 AND COALESCE(b.password_hash,'')=''
      AND COALESCE(u.is_private,0)=0 AND COALESCE(u.is_deleted,0)=0
      AND NOT EXISTS (SELECT 1 FROM content_suspensions cs WHERE cs.content_type='book' AND cs.content_id=b.id)`, [req.params.pageSlug, req.params.slug]);
  if (!pages.length) return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  const page = pages[0];
  const pageUrl = `${SITE_URL}/kitap/${page.book_slug}/sayfa/${page.slug}`;
  const body = serverPageBody('CİGCİG KİTAP', `${page.book_title} · ${page.title}`, page.author ? `Yazar: ${page.author}` : '', `<article class="seo-article seo-page-article">
    <p class="seo-breadcrumb"><a href="/kitap/${escapeHtml(page.book_slug)}">${escapeHtml(page.book_title)}</a> / ${escapeHtml(page.title)}</p>
    ${page.image_url ? serverImage(page.image_url, page.title, 'seo-hero-image') : ''}
    <div class="seo-article-text">${escapeHtml(page.content || '')}</div>
  </article>`);
  const html = injectMeta(`${page.title} – ${page.book_title} | CigCig`, String(page.content || '').replace(/\s+/g, ' ').slice(0, 160), pageUrl, page.cover_image || '', `<script type="application/ld+json">${safeJsonLd({
    '@context': 'https://schema.org', '@type': 'Chapter', name: page.title, isPartOf: { '@type': 'Book', name: page.book_title, url: `${SITE_URL}/kitap/${page.book_slug}` }, url: pageUrl, text: String(page.content || '').slice(0, 500), inLanguage: 'tr'
  })}</script>`, body);
  res.send(html);
});

app.get('/fotograflar', async (req, res) => {
  let photos = [];
  try {
    const { rows } = await query(`SELECT p.id, p.url, p.title, p.caption, p.location, p.created_at, u.username
      FROM photos p LEFT JOIN users u ON u.id=p.user_id
      WHERE COALESCE(u.is_private,0)=0
        AND NOT EXISTS (SELECT 1 FROM content_suspensions cs WHERE cs.content_type='photo' AND cs.content_id=p.id)
      ORDER BY p.created_at DESC LIMIT 100`);
    photos = rows;
  } catch (error) {
    console.warn('[SEO] photo list render failed:', error.message);
  }
  const photoBody = photos.length
    ? `<div class="seo-content-grid seo-photo-grid">${photos.map(photo => `<article class="seo-content-card">
        ${serverImage(photo.url, photo.title || photo.caption || 'CigCig fotoğrafı', 'seo-content-image')}
        <div class="seo-content-card-body">
          <h2><a href="/foto/${escapeHtml(photo.id)}">${escapeHtml(photo.title || 'Fotoğraf')}</a></h2>
          ${photo.caption ? `<p>${escapeHtml(photo.caption)}</p>` : ''}
          <div class="seo-content-meta">${serverProfileLink(photo.username)}${photo.location ? ` · ${escapeHtml(photo.location)}` : ''}</div>
        </div>
      </article>`).join('')}</div>`
    : '<p class="seo-empty">Henüz herkese açık fotoğraf bulunmuyor.</p>';
  res.send(injectMeta('Fotoğraflar – CigCig', 'CigCig topluluğundan herkese açık fotoğraflar.', `${SITE_URL}/fotograflar`, '', '', serverPageBody('CİGCİG FOTOĞRAFLAR', 'Fotoğraflar', 'Topluluğun paylaştığı herkese açık fotoğrafları keşfet.', photoBody)));
});

app.get('/foto/:id', async (req, res) => {
  const { rows } = await query(`SELECT p.*, u.username, u.avatar, s.title AS song_title, s.artist_name AS song_artist
    FROM photos p LEFT JOIN users u ON u.id=p.user_id LEFT JOIN songs s ON s.id=p.song_id
    WHERE p.id=$1 AND COALESCE(u.is_private,0)=0
      AND NOT EXISTS (SELECT 1 FROM content_suspensions cs WHERE cs.content_type='photo' AND cs.content_id=p.id)`, [req.params.id]);
  if (!rows.length) return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  const photo = rows[0];
  const { rows: photoComments } = await query(`SELECT pc.content, pc.created_at, u.username
    FROM photo_comments pc LEFT JOIN users u ON u.id=pc.user_id
    WHERE pc.photo_id=$1 ORDER BY pc.created_at ASC LIMIT 200`, [photo.id]);
  const title = photo.title || photo.caption || 'CigCig fotoğrafı';
  const desc = String(photo.caption || title).replace(/\s+/g, ' ').slice(0, 160);
  const url = `${SITE_URL}/foto/${photo.id}`;
  const comments = photoComments.length ? `<section class="seo-comments"><h2>Yorumlar</h2>${photoComments.map(comment => `<article class="seo-comment"><div class="seo-comment-author">${serverProfileLink(comment.username)} <time>${escapeHtml(new Date(comment.created_at).toLocaleDateString('tr-TR'))}</time></div><p>${escapeHtml(comment.content)}</p></article>`).join('')}</section>` : '';
  const body = serverPageBody('CİGCİG FOTOĞRAF', title, desc, `<article class="seo-article">
    ${serverImage(photo.url, title, 'seo-hero-image')}
    ${photo.caption ? `<div class="seo-article-text">${escapeHtml(photo.caption)}</div>` : ''}
    <div class="seo-content-meta">Paylaşan: ${serverProfileLink(photo.username)}${photo.location ? ` · ${escapeHtml(photo.location)}` : ''}</div>
  </article>${comments}`);
  const html = injectMeta(`${title} – CigCig Fotoğraf`, desc, url, photo.url, `<script type="application/ld+json">${safeJsonLd({
    '@context': 'https://schema.org', '@type': 'ImageObject', name: title, contentUrl: photo.url, url, description: desc,
    ...(photo.created_at ? { uploadDate: photo.created_at } : {}),
    author: photo.username ? { '@type': 'Person', name: photo.username, url: `${SITE_URL}/profil/${profileRouteKey(photo.username)}` } : undefined
  })}</script>`, body);
  res.send(html);
});

app.get('/grup/:slug', async (req, res) => {
  const { rows } = await query("SELECT * FROM groups WHERE slug=$1 AND COALESCE(visibility,'public')='public' AND COALESCE(moderation_status,'active')='active'", [req.params.slug]);
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
  const groupBody = serverPageBody('CİGCİG GRUP', group.name, group.description || 'CigCig topluluğundaki grup.', `<article class="seo-article">
    ${group.cover_image ? serverImage(group.cover_image, group.name, 'seo-hero-image') : ''}
    <div class="seo-article-text">${escapeHtml(group.description || '')}</div>
  </article>`);
  const r3 = html.replace(/<!-- SEO_START -->[\s\S]*?<!-- SEO_END -->/m,`<!-- SEO_START -->\n  ${meta}\n  <!-- SEO_END -->`);
  res.send(injectCrawlableBody(r3!==html?r3:html.replace(/<title>[^<]*<\/title>/,meta), groupBody));
});

app.get('/profil/:username', async (req, res) => {
  const { rows } = await query(`SELECT * FROM users WHERE username=$1 OR ${profileRouteSql}=$2 LIMIT 1`, [req.params.username, profileRouteKey(req.params.username)]);
  if (!rows.length) return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  const user = rows[0];
  const isPrivate = !!user.is_private;
  let profileForums = [], profileBooks = [], profilePhotos = [];
  if (!isPrivate) {
    [profileForums, profileBooks, profilePhotos] = await Promise.all([
      query(`SELECT slug,title,content,created_at FROM forums
        WHERE user_id=$1 AND NOT EXISTS (SELECT 1 FROM content_suspensions cs WHERE cs.content_type='forum' AND cs.content_id=forums.id)
        ORDER BY created_at DESC LIMIT 30`, [user.id]).then(result => result.rows),
      query(`SELECT b.slug,b.title,b.preface,b.cover_image,u.username AS author FROM books b
        LEFT JOIN users u ON u.id=b.user_id
        WHERE b.user_id=$1 AND b.is_hidden=0 AND COALESCE(b.is_unnamed,0)=0 AND COALESCE(b.password_hash,'')=''
          AND NOT EXISTS (SELECT 1 FROM content_suspensions cs WHERE cs.content_type='book' AND cs.content_id=b.id)
        ORDER BY b.created_at DESC LIMIT 30`, [user.id]).then(result => result.rows),
      query(`SELECT id,url,title,caption,created_at FROM photos
        WHERE user_id=$1 AND NOT EXISTS (SELECT 1 FROM content_suspensions cs WHERE cs.content_type='photo' AND cs.content_id=photos.id)
        ORDER BY created_at DESC LIMIT 30`, [user.id]).then(result => result.rows)
    ]);
  }
  let html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
  const desc = escapeHtml((user.bio || `${user.username} adlı kullanıcının CigCig profili.`).substring(0, 160));
  const imgTag = user.avatar
    ? `<meta property="og:image" content="${escapeHtml(user.avatar)}" />`
    : `<meta property="og:image" content="${SITE_URL}/teatube.png" />`;
  const meta = `<title>${escapeHtml(user.username)} – CigCig</title>
    <meta name="description" content="${desc}" />
    <link rel="canonical" href="${SITE_URL}/profil/${profileRouteKey(user.username)}" />
    <meta property="og:title" content="${escapeHtml(user.username)} – CigCig" />
    <meta property="og:description" content="${desc}" />
    <meta property="og:url" content="${SITE_URL}/profil/${profileRouteKey(user.username)}" />
    <meta property="og:site_name" content="CigCig" />
    ${imgTag}`;
  const sections = [];
  if (profileForums.length) sections.push(`<section class="seo-profile-section"><h2>Konular</h2><ul>${profileForums.map(item => `<li><a href="/forum/${escapeHtml(item.slug)}">${escapeHtml(item.title)}</a><span>${escapeHtml(String(item.content || '').replace(/\s+/g, ' ').slice(0, 120))}</span></li>`).join('')}</ul></section>`);
  if (profileBooks.length) sections.push(`<section class="seo-profile-section"><h2>Kitaplar</h2><ul>${profileBooks.map(item => `<li><a href="/kitap/${escapeHtml(item.slug)}">${escapeHtml(item.title)}</a><span>${escapeHtml(item.author || String(item.preface || '').replace(/\s+/g, ' ').slice(0, 120))}</span></li>`).join('')}</ul></section>`);
  if (profilePhotos.length) sections.push(`<section class="seo-profile-section"><h2>Fotoğraflar</h2><div class="seo-profile-photos">${profilePhotos.map(item => `<a href="/foto/${escapeHtml(item.id)}">${serverImage(item.url, item.title || item.caption || 'Fotoğraf', 'seo-profile-photo')}</a>`).join('')}</div></section>`);
  const profileBody = serverPageBody('CİGCİG PROFİLİ', user.username, isPrivate ? 'Bu profil gizlidir.' : (user.bio || `${user.username} adlı kullanıcının CigCig profili.`), `<article class="seo-profile-card">
    ${user.avatar ? serverImage(user.avatar, user.username, 'seo-profile-avatar') : ''}
    ${user.bio ? `<p class="seo-lead">${escapeHtml(user.bio)}</p>` : ''}
    ${isPrivate ? '<p class="seo-empty">Bu profil gizli olduğu için içerikleri yalnızca izin verilen kişiler görebilir.</p>' : (sections.join('') || '<p class="seo-empty">Bu profilde henüz herkese açık içerik bulunmuyor.</p>')}
  </article>`);
  const r4 = html.replace(/<!-- SEO_START -->[\s\S]*?<!-- SEO_END -->/m,`<!-- SEO_START -->\n  ${meta}\n  ${isPrivate ? '<meta name="robots" content="noindex, nofollow" />' : ''}\n  <!-- SEO_END -->`);
  res.send(injectCrawlableBody(r4!==html?r4:html.replace(/<title>[^<]*<\/title>/,meta), profileBody));
});


// ===== KULLANICI ARAMA =====
app.get('/api/search/users', async (req, res) => {
  const q = req.query.q;
  if (!q || q.length < 2) return res.json([]);
  const { rows } = await query(`SELECT id, username, avatar, name_color FROM users WHERE username ILIKE $1 AND banned=0 LIMIT 20`, [`%${q}%`]);
  res.json(rows);
});

// Site geneli arama: içerik ve yorumların ait oldukları gerçek route'ları döndürür.
app.get('/api/search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q || q.length < 1) return res.json([]);
    const limit = Math.min(20, Math.max(5, parseInt(req.query.limit, 10) || 12));
    const term = `%${q}%`;

    const results = [];
    const queries = [
      // Konular: hem başlık hem içerik
      query(`SELECT f.id, f.title, f.slug, f.content, f.created_at, u.username AS author
        FROM forums f JOIN users u ON u.id=f.user_id
        WHERE (f.title ILIKE $1 OR f.content ILIKE $1
          OR EXISTS (SELECT 1 FROM forum_tags ft JOIN tags t ON t.id=ft.tag_id
            WHERE ft.forum_id=f.id AND t.name ILIKE $1))
          AND COALESCE(u.is_deleted,0)=0
          AND NOT EXISTS (SELECT 1 FROM content_suspensions cs WHERE cs.content_type='forum' AND cs.content_id=f.id)
        ORDER BY f.created_at DESC LIMIT $2`, [term, limit]),
      // Forum yorumları, sonuç olarak yorumun ait olduğu konuya gider
      query(`SELECT fc.id, fc.content, fc.created_at, f.title, f.slug, cu.username AS author
        FROM forum_comments fc
        JOIN forums f ON f.id=fc.forum_id
        JOIN users cu ON cu.id=fc.user_id
        JOIN users fu ON fu.id=f.user_id
        WHERE fc.content ILIKE $1
          AND COALESCE(cu.is_deleted,0)=0 AND COALESCE(fu.is_deleted,0)=0
          AND NOT EXISTS (SELECT 1 FROM content_suspensions cs WHERE cs.content_type='forum' AND cs.content_id=f.id)
        ORDER BY fc.created_at DESC LIMIT $2`, [term, limit]),
      // Fotoğraf başlığı şemada bulunmadığı için mevcut caption alanı aranır
      query(`SELECT p.id, p.caption, p.created_at, u.username AS author
        FROM photos p JOIN users u ON u.id=p.user_id
        WHERE p.caption ILIKE $1 AND COALESCE(u.is_deleted,0)=0
          AND NOT EXISTS (SELECT 1 FROM content_suspensions cs WHERE cs.content_type='photo' AND cs.content_id=p.id)
        ORDER BY p.created_at DESC LIMIT $2`, [term, limit]),
      query(`SELECT pc.id, pc.content, pc.created_at, p.id AS photo_id, pu.username AS author
        FROM photo_comments pc
        JOIN photos p ON p.id=pc.photo_id
        JOIN users cu ON cu.id=pc.user_id
        JOIN users pu ON pu.id=p.user_id
        WHERE pc.content ILIKE $1
          AND COALESCE(cu.is_deleted,0)=0 AND COALESCE(pu.is_deleted,0)=0
          AND NOT EXISTS (SELECT 1 FROM content_suspensions cs WHERE cs.content_type='photo' AND cs.content_id=p.id)
        ORDER BY pc.created_at DESC LIMIT $2`, [term, limit]),
      // Video ve Reals başlık/açıklama/ses alanları
      query(`SELECT v.id, v.slug, v.title, v.description, v.sound_name, v.is_reals, v.created_at, u.username AS author
        FROM videos v JOIN users u ON u.id=v.user_id
        WHERE (v.title ILIKE $1 OR v.description ILIKE $1 OR v.sound_name ILIKE $1)
          AND COALESCE(u.is_deleted,0)=0 AND COALESCE(u.is_private,0)=0
          AND NOT EXISTS (SELECT 1 FROM content_suspensions cs
            WHERE cs.content_id=v.id AND cs.content_type=CASE WHEN v.is_reals=1 THEN 'reals' ELSE 'video' END)
        ORDER BY v.created_at DESC LIMIT $2`, [term, limit]),
      query(`SELECT vc.id, vc.content, vc.created_at, v.slug, v.title, v.is_reals, vu.username AS author
        FROM video_comments vc
        JOIN videos v ON v.id=vc.video_id
        JOIN users cu ON cu.id=vc.user_id
        JOIN users vu ON vu.id=v.user_id
        WHERE vc.content ILIKE $1
          AND COALESCE(cu.is_deleted,0)=0 AND COALESCE(vu.is_deleted,0)=0 AND COALESCE(vu.is_private,0)=0
          AND NOT EXISTS (SELECT 1 FROM content_suspensions cs
            WHERE cs.content_id=v.id AND cs.content_type=CASE WHEN v.is_reals=1 THEN 'reals' ELSE 'video' END)
        ORDER BY vc.created_at DESC LIMIT $2`, [term, limit]),
      // Müzikler: sözler de dahil olmak üzere şarkının aranabilir tüm metni
      query(`SELECT s.id, s.slug, s.title, s.artist_name, s.genre, s.lyrics, s.created_at, u.username AS author
        FROM songs s JOIN users u ON u.id=s.uploader_id
        WHERE s.status='active'
          AND (s.title ILIKE $1 OR s.artist_name ILIKE $1 OR s.distributor ILIKE $1 OR s.genre ILIKE $1 OR s.lyrics ILIKE $1)
          AND COALESCE(u.is_deleted,0)=0
          AND NOT EXISTS (SELECT 1 FROM content_suspensions cs WHERE cs.content_type='song' AND cs.content_id=s.id)
        ORDER BY s.published_at DESC, s.created_at DESC LIMIT $2`, [term, limit]),
      // Kitap bilgileri
      query(`SELECT b.id, b.slug, b.title, b.preface, b.karakterler, b.kadro, b.created_at, u.username AS author
        FROM books b JOIN users u ON u.id=b.user_id
        WHERE b.is_hidden=0
          AND (b.title ILIKE $1 OR b.preface ILIKE $1 OR b.karakterler ILIKE $1 OR b.kadro ILIKE $1)
          AND COALESCE(u.is_deleted,0)=0
          AND NOT EXISTS (SELECT 1 FROM content_suspensions cs WHERE cs.content_type='book' AND cs.content_id=b.id)
        ORDER BY b.created_at DESC LIMIT $2`, [term, limit]),
      // Kitap sayfaları/bölümleri: doğrudan eşleşen sayfaya götür
      query(`SELECT bp.id, bp.slug AS page_slug, bp.title AS page_title, bp.content, bp.created_at,
          b.slug, b.title, u.username AS author
        FROM book_pages bp
        JOIN books b ON b.id=bp.book_id
        JOIN users u ON u.id=b.user_id
        WHERE b.is_hidden=0 AND (bp.title ILIKE $1 OR bp.content ILIKE $1)
          AND COALESCE(u.is_deleted,0)=0
          AND NOT EXISTS (SELECT 1 FROM content_suspensions cs WHERE cs.content_type='book' AND cs.content_id=b.id)
        ORDER BY bp.created_at DESC LIMIT $2`, [term, limit]),
      // Kullanıcı profili ve görünen profil bilgileri
      query(`SELECT id, username, bio, title, location, avatar, created_at
        FROM users
        WHERE banned=0 AND COALESCE(is_deleted,0)=0
          AND (username ILIKE $1 OR bio ILIKE $1 OR title ILIKE $1 OR location ILIKE $1)
        ORDER BY created_at DESC LIMIT $2`, [term, limit]),
      // Yalnızca keşfedilebilir gruplar indekslenir
      query(`SELECT g.id, g.slug, g.name, g.description, g.created_at, u.username AS author
        FROM groups g LEFT JOIN users u ON u.id=g.owner_id
        WHERE COALESCE(g.moderation_status,'active')='active'
          AND COALESCE(g.visibility, CASE WHEN g.type='private' THEN 'private' WHEN g.invite_only=1 THEN 'invite' ELSE 'public' END)='public'
          AND (g.name ILIKE $1 OR g.description ILIKE $1)
          AND (u.id IS NULL OR COALESCE(u.is_deleted,0)=0)
          AND NOT EXISTS (SELECT 1 FROM content_suspensions cs WHERE cs.content_type='group' AND cs.content_id=g.id)
        ORDER BY g.created_at DESC LIMIT $2`, [term, limit]),
      query(`SELECT g.slug, g.name, gc.name AS channel_name, gc.description, gc.created_at, u.username AS author
        FROM group_channels gc
        JOIN groups g ON g.id=gc.group_id
        LEFT JOIN users u ON u.id=g.owner_id
        WHERE (gc.name ILIKE $1 OR gc.description ILIKE $1)
          AND COALESCE(g.visibility, CASE WHEN g.type='private' THEN 'private' WHEN g.invite_only=1 THEN 'invite' ELSE 'public' END)='public'
          AND COALESCE(g.moderation_status,'active')='active'
          AND (u.id IS NULL OR COALESCE(u.is_deleted,0)=0)
          AND NOT EXISTS (SELECT 1 FROM content_suspensions cs WHERE cs.content_type='group' AND cs.content_id=g.id)
        ORDER BY gc.created_at DESC LIMIT $2`, [term, limit]),
      // Süresi geçmemiş hikâyeler
      query(`SELECT st.id, st.public_id, st.caption, st.created_at, u.username AS author
        FROM stories st JOIN users u ON u.id=st.user_id
        WHERE st.caption ILIKE $1 AND st.expires_at > NOW() AND st.is_suspended=0
          AND COALESCE(u.is_deleted,0)=0 AND COALESCE(u.is_private,0)=0
          AND NOT EXISTS (SELECT 1 FROM content_suspensions cs WHERE cs.content_type='story' AND cs.content_id=st.id)
        ORDER BY st.created_at DESC LIMIT $2`, [term, limit]),
      // Herkese açık playlistler
      query(`SELECT pl.id, pl.public_id, pl.name, pl.description, pl.created_at, u.username AS author
        FROM playlists pl JOIN users u ON u.id=pl.user_id
        WHERE pl.is_public=1 AND (pl.name ILIKE $1 OR pl.description ILIKE $1)
          AND COALESCE(u.is_deleted,0)=0
        ORDER BY pl.created_at DESC LIMIT $2`, [term, limit]),
    ];

    const [
      forums, forumComments, photos, photoComments, videos, videoComments,
      songs, books, bookPages, users, groups, groupChannels, stories, playlists
    ] = await Promise.all(queries);

    forums.rows.forEach(r => results.push({ type: 'forum', title: r.title, excerpt: r.content, route: `/forum/${r.slug}`, author: r.author, created_at: r.created_at }));
    forumComments.rows.forEach(r => results.push({ type: 'forum_comment', title: r.title, excerpt: r.content, route: `/forum/${r.slug}`, author: r.author, created_at: r.created_at }));
    photos.rows.forEach(r => results.push({ type: 'photo', title: 'Fotoğraf', excerpt: r.caption, route: `/foto/${r.id}`, author: r.author, created_at: r.created_at }));
    photoComments.rows.forEach(r => results.push({ type: 'photo_comment', title: 'Fotoğraf yorumu', excerpt: r.content, route: `/foto/${r.photo_id}`, author: r.author, created_at: r.created_at }));
    videos.rows.forEach(r => results.push({ type: r.is_reals ? 'reals' : 'video', title: r.title, excerpt: [r.description, r.sound_name].filter(Boolean).join(' · '), route: `/${r.is_reals ? 'reals' : 'video'}/${r.slug}`, author: r.author, created_at: r.created_at }));
    videoComments.rows.forEach(r => results.push({ type: r.is_reals ? 'reals_comment' : 'video_comment', title: r.title, excerpt: r.content, route: `/${r.is_reals ? 'reals' : 'video'}/${r.slug}`, author: r.author, created_at: r.created_at }));
    songs.rows.forEach(r => results.push({ type: 'song', title: r.title, excerpt: [r.artist_name, r.genre, r.lyrics].filter(Boolean).join(' · '), route: `/muzik/${r.slug}`, author: r.author, created_at: r.created_at }));
    books.rows.forEach(r => results.push({ type: 'book', title: r.title, excerpt: [r.preface, r.karakterler, r.kadro].filter(Boolean).join(' · '), route: `/kitap/${r.slug}`, author: r.author, created_at: r.created_at }));
    bookPages.rows.forEach(r => results.push({ type: 'book_page', title: `${r.title} · ${r.page_title}`, excerpt: r.content, route: `/kitap/${r.slug}/sayfa/${r.page_slug}`, author: r.author, created_at: r.created_at }));
    users.rows.forEach(r => results.push({ type: 'profile', title: `@${r.username}`, excerpt: [r.title, r.bio, r.location].filter(Boolean).join(' · '), route: `/profil/${profileRouteKey(r.username)}`, author: r.username, avatar: r.avatar, created_at: r.created_at }));
    groups.rows.forEach(r => results.push({ type: 'group', title: r.name, excerpt: r.description, route: `/grup/${r.slug}`, author: r.author, created_at: r.created_at }));
    groupChannels.rows.forEach(r => results.push({ type: 'group_channel', title: `${r.name} · #${r.channel_name}`, excerpt: r.description, route: `/grup/${r.slug}`, author: r.author, created_at: r.created_at }));
    stories.rows.forEach(r => results.push({ type: 'story', title: 'Hikâye', excerpt: r.caption, route: `/hikaye/${r.public_id || r.id}`, author: r.author, created_at: r.created_at }));
    playlists.rows.forEach(r => results.push({ type: 'playlist', title: r.name, excerpt: r.description, route: `/playlist/${r.public_id || r.id}`, author: r.author, created_at: r.created_at }));

    res.json(results);
  } catch (err) {
    console.error('Search error', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

// ===== ARKADAŞLIK =====
app.get('/api/friends', authMiddleware, async (req, res) => {
  const uid = req.user.id;
  const { rows } = await query(`
    SELECT f.id, f.created_at, f.status, f.requester_id, f.addressee_id,
      CASE WHEN f.requester_id=$1 THEN f.addressee_id ELSE f.requester_id END AS other_id,
      u.username AS other_username, u.avatar AS other_avatar,
      u.name_color AS other_name_color, COALESCE(u.is_deleted,0) AS other_is_deleted
    FROM friendships f
    JOIN users u ON u.id=CASE WHEN f.requester_id=$1 THEN f.addressee_id ELSE f.requester_id END
    WHERE (f.requester_id=$1 OR f.addressee_id=$1)
      AND (f.status='pending' OR f.status='accepted')
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
    await query(`INSERT INTO follows (follower_id, following_id, status) VALUES
      ($1,$2,'accepted'), ($2,$1,'accepted')
      ON CONFLICT (follower_id, following_id) DO UPDATE SET status='accepted'`, [rows[0].requester_id, rows[0].addressee_id]);
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
async function getCallForUser(callId, userId) {
  const { rows } = await query(`
    SELECT c.*, cu.username AS caller_username, cu.avatar AS caller_avatar,
      cu.avatar_removed AS caller_avatar_removed, cu.name_color AS caller_name_color,
      tu.username AS callee_username, tu.avatar AS callee_avatar,
      tu.avatar_removed AS callee_avatar_removed, tu.name_color AS callee_name_color
    FROM voice_calls c
    JOIN users cu ON cu.id=c.caller_id JOIN users tu ON tu.id=c.callee_id
    WHERE c.id=$1 AND (c.caller_id=$2 OR c.callee_id=$2)
  `, [callId, userId]);
  return rows[0];
}

app.get('/api/voice-calls/incoming', authMiddleware, async (req, res) => {
  const { rows } = await query(`
    SELECT c.id, c.status, c.created_at, u.username, u.avatar, u.avatar_removed, u.name_color
    FROM voice_calls c JOIN users u ON u.id=c.caller_id
    WHERE c.callee_id=$1 AND c.status='ringing' AND c.created_at > NOW() - INTERVAL '2 minutes'
    ORDER BY c.created_at DESC LIMIT 1
  `, [req.user.id]);
  res.json(rows[0] || null);
});

app.post('/api/voice-calls', authMiddleware, async (req, res) => {
  const username = String(req.body?.username || '').trim();
  const { rows: target } = await query('SELECT id,username,avatar,avatar_removed,name_color FROM users WHERE username=$1', [username]);
  if (!target.length) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  if (target[0].id === req.user.id) return res.status(400).json({ error: 'Kendinizi arayamazsınız' });
  const { rows: mutual } = await query(`
    SELECT 1 FROM follows a JOIN follows b ON b.follower_id=a.following_id AND b.following_id=a.follower_id
    WHERE a.follower_id=$1 AND a.following_id=$2 AND a.status='accepted' AND b.status='accepted'
    UNION ALL
    SELECT 1 FROM friendships WHERE ((requester_id=$1 AND addressee_id=$2) OR (requester_id=$2 AND addressee_id=$1)) AND status='accepted'
  `, [req.user.id, target[0].id]);
  if (!mutual.length) return res.status(403).json({ error: 'Arama için birbirinizi takip etmelisiniz' });
  const { rows: active } = await query("SELECT id FROM voice_calls WHERE status IN ('ringing','connected') AND (caller_id=$1 OR callee_id=$1) LIMIT 1", [req.user.id]);
  if (active.length) return res.status(409).json({ error: 'Zaten aktif bir aramanız var' });
  const id = randomUUID();
  await query('INSERT INTO voice_calls (id,caller_id,callee_id) VALUES ($1,$2,$3)', [id, req.user.id, target[0].id]);
  res.json({ id, status: 'ringing', other: target[0] });
});

app.get('/api/voice-calls/:id', authMiddleware, async (req, res) => {
  const call = await getCallForUser(req.params.id, req.user.id);
  if (!call) return res.status(404).json({ error: 'Arama bulunamadı' });
  res.json(call);
});

app.post('/api/voice-calls/:id/action', authMiddleware, async (req, res) => {
  const call = await getCallForUser(req.params.id, req.user.id);
  if (!call) return res.status(404).json({ error: 'Arama bulunamadı' });
  const action = String(req.body?.action || '');
  const isCaller = call.caller_id === req.user.id;
  if (['reject', 'end'].includes(action)) {
    await query("UPDATE voice_calls SET status='ended', ended_at=NOW(), updated_at=NOW() WHERE id=$1", [call.id]);
  } else if (action === 'accept' && !isCaller && call.status === 'ringing') {
    await query("UPDATE voice_calls SET status='accepted', updated_at=NOW() WHERE id=$1", [call.id]);
  } else if (action === 'connect') {
    await query("UPDATE voice_calls SET status='connected', updated_at=NOW() WHERE id=$1", [call.id]);
  } else if (action === 'offer' || action === 'answer') {
    const value = req.body?.value;
    if (!value || typeof value !== 'object') return res.status(400).json({ error: 'Geçersiz sinyal' });
    await query(`UPDATE voice_calls SET ${action}=$1, updated_at=NOW() WHERE id=$2`, [JSON.stringify(value), call.id]);
  } else if (action === 'ice') {
    const value = req.body?.value;
    if (!value || typeof value !== 'object') return res.status(400).json({ error: 'Geçersiz ICE paketi' });
    const column = isCaller ? 'caller_ice' : 'callee_ice';
    await query(`UPDATE voice_calls SET ${column}=COALESCE(${column},'[]'::jsonb) || $1::jsonb, updated_at=NOW() WHERE id=$2`, [JSON.stringify([value]), call.id]);
  } else return res.status(400).json({ error: 'Geçersiz arama işlemi' });
  res.json({ ok: true });
});

app.get('/api/conversations', authMiddleware, async (req, res) => {
  const uid = req.user.id;
  const { rows } = await query(`
    SELECT c.*,
      CASE WHEN c.user1_id=$1 THEN u2.username ELSE u1.username END as other_username,
      CASE WHEN c.user1_id=$1 THEN u2.avatar ELSE u1.avatar END as other_avatar,
      CASE WHEN c.user1_id=$1 THEN u2.avatar_removed ELSE u1.avatar_removed END as other_avatar_removed,
      CASE WHEN c.user1_id=$1 THEN u2.id ELSE u1.id END as other_id,
      CASE WHEN c.user1_id=$1 THEN u2.name_color ELSE u1.name_color END as other_name_color,
      (SELECT content FROM dm_messages m WHERE m.conversation_id=c.id AND m.deleted_for_all=0
        AND CASE WHEN c.user1_id=$1 THEN (m.deleted_by_sender=0 OR m.sender_id!=$1) ELSE (m.deleted_by_receiver=0 OR m.sender_id=$1) END
        ORDER BY m.created_at DESC LIMIT 1) as last_message,
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
      (SELECT content FROM dm_messages m WHERE m.conversation_id=c.id AND m.deleted_for_all=0
        AND CASE WHEN c.user1_id=$1 THEN (m.deleted_by_sender=0 OR m.sender_id!=$1) ELSE (m.deleted_by_receiver=0 OR m.sender_id=$1) END
        ORDER BY m.created_at DESC LIMIT 1) as last_message
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
  const requestedLimit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 100, 1), 100);
  const offset = Math.min(Math.max(Number.parseInt(req.query.offset, 10) || 0, 0), 10000);
  const afterId = Math.max(Number.parseInt(req.query.after_id, 10) || 0, 0);
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
      AND m.id>$6
      AND ($2=1 OR m.deleted_by_sender=0 OR m.sender_id!=$3)
      AND ($2=1 OR m.deleted_by_receiver=0 OR m.sender_id=$3)
    ORDER BY m.created_at ASC
    LIMIT $4 OFFSET $5
  `, [conv.id, 0, uid, requestedLimit, offset, afterId]);

  if (afterId) return res.json(msgs);

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
  if (await denyIfRestricted(req, res, 'message')) return;
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

app.get('/api/admin/users/:id/conversations', adminMiddleware, async (req, res) => {
  const { rows } = await query(`
    SELECT c.id, u1.username AS user1, u2.username AS user2, c.last_message_at,
      (SELECT COUNT(*) FROM dm_messages WHERE conversation_id=c.id) AS message_count
    FROM dm_conversations c JOIN users u1 ON u1.id=c.user1_id JOIN users u2 ON u2.id=c.user2_id
    WHERE c.user1_id=$1 OR c.user2_id=$1 ORDER BY c.last_message_at DESC
  `, [req.params.id]);
  res.json(rows);
});

app.get('/api/admin/messages/search', adminMiddleware, async (req, res) => {
  const search = String(req.query.q || '').trim();
  if (search.length < 2) return res.json([]);
  const { rows } = await query(`
    SELECT m.id, m.conversation_id, m.content, m.created_at, m.deleted_for_all,
      m.deleted_by_sender, m.deleted_by_receiver, sender.username AS sender_username,
      u1.username AS user1, u2.username AS user2
    FROM dm_messages m
    JOIN users sender ON sender.id=m.sender_id
    JOIN dm_conversations c ON c.id=m.conversation_id
    JOIN users u1 ON u1.id=c.user1_id JOIN users u2 ON u2.id=c.user2_id
    WHERE m.content ILIKE $1
    ORDER BY m.created_at DESC LIMIT 100
  `, [`%${search}%`]);
  res.json(rows.map(row => ({ ...row, audit_status: row.deleted_for_all ? 'deleted_for_all' : (row.deleted_by_sender || row.deleted_by_receiver ? 'deleted_for_user' : 'visible') })));
});

app.get('/api/admin/conversations/:id/messages', adminMiddleware, async (req, res) => {
  const { rows: messages } = await query(`
    SELECT m.*, u.username AS sender_username,
      CASE WHEN m.deleted_for_all=1 THEN 'deleted_for_all'
        WHEN m.deleted_by_sender=1 OR m.deleted_by_receiver=1 THEN 'deleted_for_user'
        ELSE 'visible' END AS audit_status
    FROM dm_messages m JOIN users u ON m.sender_id=u.id
    WHERE m.conversation_id=$1 ORDER BY m.created_at ASC
  `, [req.params.id]);
  const { rows: calls } = await query(`
    SELECT c.id, c.caller_id, c.callee_id, c.status, c.created_at, c.updated_at, c.ended_at,
      cu.username AS caller_username, tu.username AS callee_username
    FROM voice_calls c JOIN dm_conversations d ON d.user1_id=LEAST(c.caller_id,c.callee_id) AND d.user2_id=GREATEST(c.caller_id,c.callee_id)
      JOIN users cu ON cu.id=c.caller_id JOIN users tu ON tu.id=c.callee_id
    WHERE d.id=$1 ORDER BY c.created_at ASC
  `, [req.params.id]);
  res.json({ messages, calls });
});

app.use((err, req, res, next) => {
  if (req.path.startsWith('/api/')) {
    const status = err instanceof multer.MulterError
      ? (err.code === 'LIMIT_FILE_SIZE' ? 413 : 400)
      : (err.status || 500);
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? 'Dosya boyutu sınırını aşıyor.'
      : (err.message || 'Sunucu hatası');
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

app.get('/api/music-ads/guest', async (req, res) => {
  try { res.json({ ad: await pickMusicAd() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

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

const videoSelect = `SELECT v.*, v.thumbnail_url AS banner_image, u.username, u.avatar, u.avatar_removed, u.is_private,
  s.title AS song_title, s.artist_name AS song_artist, s.audio_url AS song_audio_url, s.cover_url AS song_cover_url,
  (SELECT COUNT(*) FROM video_likes vl WHERE vl.video_id=v.id) AS like_count,
  (SELECT COUNT(*) FROM video_comments vc WHERE vc.video_id=v.id) AS comment_count,
  (CASE WHEN $1::bigint = 0 THEN false ELSE EXISTS(SELECT 1 FROM video_likes vl2 WHERE vl2.video_id=v.id AND vl2.user_id=$1) END) AS liked
  FROM videos v LEFT JOIN users u ON u.id=v.user_id LEFT JOIN songs s ON s.id=v.song_id
  WHERE NOT EXISTS (SELECT 1 FROM content_suspensions cs WHERE cs.content_type=CASE WHEN v.is_reals=1 THEN 'reals' ELSE 'video' END AND cs.content_id=v.id)`;

app.get('/api/videos', optionalAuth, async (req, res) => {
  const { rows } = await query(`${videoSelect} ORDER BY v.created_at DESC LIMIT 100`, [req.user?.id || 0]);
  res.json(rows);
});

app.get('/api/reals', optionalAuth, async (req, res) => {
  const { rows } = await query(`${videoSelect} AND v.is_reals=1 AND (COALESCE(u.is_private,0)=0 OR v.user_id=$1 OR EXISTS (SELECT 1 FROM follows f WHERE f.follower_id=$1 AND f.following_id=v.user_id AND f.status='accepted')) ORDER BY v.created_at DESC LIMIT 100`, [req.user?.id || 0]);
  res.json(rows);
});

app.get('/api/reals-settings', async (req, res) => {
  res.json({ reminder: 'Evet, reals. Reels olmasını beklerdiniz. Ama reals işte. Gerçekler var burada.' });
});

app.get('/api/video-settings', async (req, res) => {
  res.json({ defaultDescription: '', emptyDescriptionText: 'Bu videoya bir açıklama eklenmemiş.', uploadSuccessText: 'YÜKLENDİ', uploadSuccessDuration: '3' });
});

app.get('/api/video/:slug', optionalAuth, async (req, res) => {
  const { rows } = await query(`${videoSelect} AND (v.slug=$2 OR v.id::text=$2) AND (COALESCE(u.is_private,0)=0 OR v.user_id=$1 OR EXISTS (SELECT 1 FROM follows f WHERE f.follower_id=$1 AND f.following_id=v.user_id AND f.status='accepted'))`, [req.user?.id || 0, req.params.slug]);
  if (!rows.length) return res.status(404).json({ error: 'Video bulunamadı' });
  res.json(rows[0]);
});

app.post('/api/videos', authMiddleware, async (req, res) => {
  const { title, description, video_url, banner_image, location, sound_name, song_id, song_start_seconds, media_filter, allow_comments, show_likes, is_reals } = req.body;
  if (!title?.trim() || !video_url) return res.status(400).json({ error: 'Başlık ve video gerekli' });
    const provisionalSlug = makeVideoSlug(title, randomUUID().slice(0, 8));
  const safeSongId = song_id ? Number(song_id) : null;
  const safeStart = Math.max(0, parseInt(song_start_seconds, 10) || 0);
  const { rows } = await query(`INSERT INTO videos (user_id,title,description,video_url,thumbnail_url,location,sound_name,song_id,song_start_seconds,media_filter,allow_comments,show_likes,is_reals,slug)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`, [req.user.id, title.trim(), description || '', video_url, banner_image || '', location || '', sound_name || '', safeSongId, safeStart, normalizeMediaFilter(media_filter), allow_comments === false ? 0 : 1, show_likes === false ? 0 : 1, is_reals ? 1 : 0, provisionalSlug]);
  const slug = makeVideoSlug(title, rows[0].id);
  await query('UPDATE videos SET slug=$1 WHERE id=$2', [slug, rows[0].id]);
  res.json({ slug, id: rows[0].id });
});

app.put('/api/video/:slug', authMiddleware, async (req, res) => {
  const { rows } = await query('SELECT * FROM videos WHERE slug=$1', [req.params.slug]);
  if (!rows.length) return res.status(404).json({ error: 'Video bulunamadı' });
  if (rows[0].user_id !== req.user.id && !req.user.is_admin) return res.status(403).json({ error: 'Bu videoyu düzenleme yetkiniz yok' });
  const b = req.body;
  await query(`UPDATE videos SET title=$1,description=$2,video_url=$3,thumbnail_url=$4,location=$5,sound_name=$6,song_id=$7,song_start_seconds=$8,media_filter=$9,allow_comments=$10,show_likes=$11,is_reals=$12 WHERE id=$13`,
    [b.title?.trim() || rows[0].title, b.description ?? rows[0].description, b.video_url || rows[0].video_url, b.banner_image ?? rows[0].thumbnail_url, b.location ?? rows[0].location, b.sound_name ?? rows[0].sound_name, b.song_id ? Number(b.song_id) : null, Math.max(0, parseInt(b.song_start_seconds, 10) || 0), normalizeMediaFilter(b.media_filter ?? rows[0].media_filter), b.allow_comments === undefined ? rows[0].allow_comments : (b.allow_comments ? 1 : 0), b.show_likes === undefined ? rows[0].show_likes : (b.show_likes ? 1 : 0), b.is_reals === undefined ? rows[0].is_reals : (b.is_reals ? 1 : 0), rows[0].id]);
  res.json({ ok: true });
});

app.post('/api/video/:id/view', optionalAuth, async (req, res) => {
  const videoKey = String(req.params.id || '');
  const videoLookup = /^\d+$/.test(videoKey) ? 'id=$1' : 'slug=$1';
  const { rows } = await query(`SELECT id,is_reals FROM videos WHERE ${videoLookup} LIMIT 1`, [videoKey]);
  if (!rows.length) return res.status(404).json({ error: 'Video bulunamadı' });
  await query('UPDATE videos SET views=COALESCE(views,0)+1 WHERE id=$1', [rows[0].id]);
  await recordContentView(rows[0].is_reals ? 'reals' : 'video', rows[0].id, req);
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
  const { rows } = await query('SELECT 1 FROM video_likes vl JOIN videos v ON v.id=vl.video_id WHERE (v.slug=$1 OR v.id::text=$1) AND vl.user_id=$2', [req.params.slug, req.user.id]);
  res.json({ liked: !!rows.length });
});

app.post('/api/video/:slug/save', authMiddleware, async (req, res) => {
  const { rows: video } = await query('SELECT id FROM videos WHERE slug=$1 OR id::text=$1', [req.params.slug]);
  if (!video.length) return res.status(404).json({ error: 'Video bulunamadı' });
  const { rows: existing } = await query('SELECT id FROM video_saves WHERE video_id=$1 AND user_id=$2', [video[0].id, req.user.id]);
  if (existing.length) await query('DELETE FROM video_saves WHERE id=$1', [existing[0].id]);
  else await query('INSERT INTO video_saves (video_id,user_id) VALUES ($1,$2)', [video[0].id, req.user.id]);
  res.json({ saved: !existing.length });
});

app.get('/api/video/:slug/saved', authMiddleware, async (req, res) => {
  const { rows } = await query('SELECT 1 FROM video_saves s JOIN videos v ON v.id=s.video_id WHERE (v.slug=$1 OR v.id::text=$1) AND s.user_id=$2', [req.params.slug, req.user.id]);
  res.json({ saved: !!rows.length });
});

app.get('/api/video/:slug/comments', optionalAuth, async (req, res) => {
  const { rows } = await query(`SELECT c.*,u.username,u.avatar,u.avatar_removed,
    (SELECT COUNT(*) FROM video_comment_likes vcl WHERE vcl.comment_id=c.id) AS like_count,
    EXISTS(SELECT 1 FROM video_comment_likes vcl2 WHERE vcl2.comment_id=c.id AND vcl2.user_id=$2) AS liked
    FROM video_comments c JOIN videos v ON v.id=c.video_id JOIN users u ON u.id=c.user_id
    WHERE (v.slug=$1 OR v.id::text=$1) AND (COALESCE((SELECT is_private FROM users WHERE id=v.user_id),0)=0 OR v.user_id=$2 OR EXISTS (SELECT 1 FROM follows f WHERE f.follower_id=$2 AND f.following_id=v.user_id AND f.status='accepted')) ORDER BY c.created_at ASC`, [req.params.slug, req.user?.id || 0]);
  res.json(rows);
});

app.post('/api/video/:slug/comments', authMiddleware, async (req, res) => {
  if (await denyIfRestricted(req, res, 'comment')) return;
  const content = String(req.body.content || '').trim();
  const { rows: video } = await query(`SELECT v.id,v.user_id,v.allow_comments,u.is_private FROM videos v JOIN users u ON u.id=v.user_id WHERE v.slug=$1 OR v.id::text=$1`, [req.params.slug]);
  if (!video.length) return res.status(404).json({ error: 'Video bulunamadı' });
  if (video[0].is_private && video[0].user_id != req.user.id && !(await query("SELECT 1 FROM follows WHERE follower_id=$1 AND following_id=$2 AND status='accepted'", [req.user.id, video[0].user_id])).rows.length) return res.status(403).json({ error: 'Bu hesap gizli.' });
  if (video[0].allow_comments !== 1) return res.status(403).json({ error: 'Yorumlar kapalı' });
  if (!content) return res.status(400).json({ error: 'Yorum boş olamaz' });
  const { rows } = await query('INSERT INTO video_comments (video_id,user_id,content) VALUES ($1,$2,$3) RETURNING *', [video[0].id, req.user.id, content.slice(0, 1000)]);
  res.json({ ...rows[0], username: req.user.username, avatar: req.user.avatar });
});

app.post('/api/video/:slug/comments/:commentId/like', authMiddleware, async (req, res) => {
  const { rows: comments } = await query(`SELECT c.id FROM video_comments c JOIN videos v ON v.id=c.video_id
    WHERE c.id=$1 AND (v.slug=$2 OR v.id::text=$2)`, [req.params.commentId, req.params.slug]);
  if (!comments.length) return res.status(404).json({ error: 'Yorum bulunamadı' });
  const { rows: existing } = await query('SELECT id FROM video_comment_likes WHERE comment_id=$1 AND user_id=$2', [comments[0].id, req.user.id]);
  if (existing.length) {
    await query('DELETE FROM video_comment_likes WHERE id=$1', [existing[0].id]);
    return res.json({ liked: false });
  }
  await query('INSERT INTO video_comment_likes (comment_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [comments[0].id, req.user.id]);
  res.json({ liked: true });
});

app.delete('/api/video/:slug/comments/:commentId', authMiddleware, async (req, res) => {
  const { rows } = await query(`SELECT c.id, c.user_id, v.user_id AS video_owner_id
    FROM video_comments c JOIN videos v ON v.id=c.video_id
    WHERE c.id=$1 AND (v.slug=$2 OR v.id::text=$2)`, [req.params.commentId, req.params.slug]);
  if (!rows.length) return res.status(404).json({ error: 'Yorum bulunamadı' });
  const comment = rows[0];
  if (comment.user_id != req.user.id && comment.video_owner_id != req.user.id && !req.user.is_admin) return res.status(403).json({ error: 'Bu yorumu silme yetkiniz yok' });
  await query('DELETE FROM video_comments WHERE id=$1', [comment.id]);
  res.json({ ok: true });
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
app.get('/api/reklampanel/:code', async (req,res) => {
  const resolved = await resolveAdPanel(req.params.code, req.query.type);
  if (!resolved.ad) return res.status(resolved.ambiguous ? 409 : 404).json({ error: resolved.error });
  res.json(adPanelClientShape(resolved.ad));
});
app.put('/api/reklampanel/:code', authMiddleware, upload.fields([{ name: 'audio', maxCount: 1 }, { name: 'video', maxCount: 1 }, { name: 'cover', maxCount: 1 }]), async (req,res) => {
  try {
    const music = (await query('SELECT * FROM music_ads WHERE portal_code=$1', [req.params.code])).rows[0];
    const reals = music ? null : (await query('SELECT * FROM reals_ads WHERE portal_code=$1', [req.params.code])).rows[0];
    const target = music || reals;
    if (!target) return res.status(404).json({ error: 'Reklam kodu bulunamadı.' });
    const targetType = music ? 'music' : 'reals';
    if (!req.user.is_admin && !(await isAssignedAdPanel(req.user.id, targetType, target.id))) {
      return res.status(403).json({ error: 'Bu reklam panelini düzenleme yetkiniz yok.' });
    }
    const b = req.body || {};
    if (music) {
      const audio = req.files?.audio?.[0] ? await handleUpload(req.files.audio[0]) : music.audio_url;
      const cover = req.files?.cover?.[0] ? await handleUpload(req.files.cover[0]) : music.cover_url;
      const { rows } = await query('UPDATE music_ads SET title=$1,site_url=$2,audio_url=$3,cover_url=$4,updated_at=NOW() WHERE id=$5 RETURNING *',
        [b.title?.trim() || music.title, b.site_url ?? music.site_url, audio, cover, music.id]);
      return res.json({ ...rows[0], ad_type: 'music' });
    }
    const video = req.files?.video?.[0] ? await handleUpload(req.files.video[0]) : reals.video_url;
    const cover = req.files?.cover?.[0] ? await handleUpload(req.files.cover[0]) : reals.cover_url;
    const site = normalizedExternalUrl(b.site_url ?? reals.site_url);
    if (!site) return res.status(400).json({ error: 'Geçerli site adresi girin.' });
    const frequency = normalizeRealsAdFrequency(b, reals);
    const { rows } = await query(`UPDATE reals_ads SET title=$1,description=$2,site_url=$3,video_url=$4,cover_url=$5,
      show_likes=$6,allow_comments=$7,frequency_mode=$8,frequency_value=$9,frequency_unit=$10,updated_at=NOW() WHERE id=$11 RETURNING *`,
      [b.title?.trim() || reals.title, String(b.description ?? reals.description).trim().slice(0, 2000), site, video, cover,
       b.show_likes === undefined ? reals.show_likes : (b.show_likes === 'false' ? 0 : 1),
       b.allow_comments === undefined ? reals.allow_comments : (b.allow_comments === 'false' ? 0 : 1),
       frequency.frequency_mode, frequency.frequency_value, frequency.frequency_unit, reals.id]);
    res.json({ ...rows[0], ad_type: 'reals' });
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
    return query(`CREATE TABLE IF NOT EXISTS video_comment_likes (
      id BIGSERIAL PRIMARY KEY,
      comment_id BIGINT NOT NULL REFERENCES video_comments(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(comment_id, user_id)
    )`);
  }).then(() => {
    // ===== KANAL SİSTEMİ API'LAR =====

    // Gruba kanal listesi getir
    app.get('/api/group/:slug/channels', optionalAuth, async (req, res) => {
      try {
        const { slug } = req.params;
        const result = await query(`
          SELECT gc.id, gc.name, gc.icon, gc.description, gc.is_default, 
                 gc.can_view_history, gc.can_write, gc.visibility, gc.created_by,
                 u.username as created_by_username, 
                 COUNT(gcm.id) as message_count
          FROM group_channels gc
          LEFT JOIN users u ON gc.created_by = u.id
          LEFT JOIN group_channel_messages gcm ON gc.id = gcm.channel_id
          WHERE gc.group_id = (SELECT id FROM groups WHERE slug = $1)
          GROUP BY gc.id, u.id
          ORDER BY gc.is_default DESC, gc.created_at ASC
        `, [slug]);
        res.json(result.rows);
      } catch (e) {
        console.error('Kanal listesi hatası:', e.message);
        res.status(500).json({ error: 'Kanal listesi alınamadı' });
      }
    });

    // Kanal oluştur
    app.post('/api/group/:slug/channels', authMiddleware, async (req, res) => {
      try {
        const { slug } = req.params;
        const { name, icon = 'fas fa-hashtag', description = '' } = req.body;
        if (!name || !name.trim()) return res.status(400).json({ error: 'Kanal adı gerekli' });

        const groupRes = await query('SELECT id, owner_id FROM groups WHERE slug = $1', [slug]);
        if (groupRes.rows.length === 0) return res.status(404).json({ error: 'Grup bulunamadı' });
        const groupId = groupRes.rows[0].id;
        const ownerId = groupRes.rows[0].owner_id;

        // Sadece sahibi ve moderatörler kanal oluşturabilir
        const memberRes = await query(
          'SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2',
          [groupId, req.user.id]
        );
        if (!memberRes.rows.length || (memberRes.rows[0].role !== 'owner' && memberRes.rows[0].role !== 'moderator')) {
          return res.status(403).json({ error: 'Kanal oluşturmak için yetkiniz yok' });
        }

        const result = await query(
          `INSERT INTO group_channels (group_id, name, icon, description, created_by) 
           VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [groupId, name.trim(), icon, description, req.user.id]
        );

        res.json(result.rows[0]);
      } catch (e) {
        console.error('Kanal oluşturma hatası:', e.message);
        res.status(500).json({ error: 'Kanal oluşturulamadı' });
      }
    });

    // Kanal güncelle
    app.put('/api/group/:slug/channel/:channelId', authMiddleware, async (req, res) => {
      try {
        const { slug, channelId } = req.params;
        const { name, icon, description, can_write, can_view_history, visibility } = req.body;

        const channelRes = await query(
          `SELECT gc.* FROM group_channels gc
           JOIN groups g ON gc.group_id = g.id
           WHERE gc.id = $1 AND g.slug = $2`,
          [channelId, slug]
        );
        if (!channelRes.rows.length) return res.status(404).json({ error: 'Kanal bulunamadı' });

        const groupId = channelRes.rows[0].group_id;
        const memberRes = await query(
          'SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2',
          [groupId, req.user.id]
        );
        if (!memberRes.rows.length || (memberRes.rows[0].role !== 'owner' && memberRes.rows[0].role !== 'moderator')) {
          return res.status(403).json({ error: 'Kanal güncellemek için yetkiniz yok' });
        }

        const updates = [];
        const values = [];
        let paramNum = 1;
        if (name) { updates.push(`name = $${paramNum++}`); values.push(name); }
        if (icon) { updates.push(`icon = $${paramNum++}`); values.push(icon); }
        if (description !== undefined) { updates.push(`description = $${paramNum++}`); values.push(description); }
        if (can_write !== undefined) { updates.push(`can_write = $${paramNum++}`); values.push(can_write); }
        if (can_view_history !== undefined) { updates.push(`can_view_history = $${paramNum++}`); values.push(can_view_history); }
        if (visibility) { updates.push(`visibility = $${paramNum++}`); values.push(visibility); }
        
        values.push(channelId);
        const result = await query(
          `UPDATE group_channels SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${paramNum} RETURNING *`,
          values
        );

        res.json(result.rows[0]);
      } catch (e) {
        console.error('Kanal güncelleme hatası:', e.message);
        res.status(500).json({ error: 'Kanal güncellenemedi' });
      }
    });

    // Kanal sil
    app.delete('/api/group/:slug/channel/:channelId', authMiddleware, async (req, res) => {
      try {
        const { slug, channelId } = req.params;
        const channelRes = await query(
          `SELECT gc.* FROM group_channels gc
           JOIN groups g ON gc.group_id = g.id
           WHERE gc.id = $1 AND g.slug = $2`,
          [channelId, slug]
        );
        if (!channelRes.rows.length) return res.status(404).json({ error: 'Kanal bulunamadı' });
        if (channelRes.rows[0].is_default) return res.status(400).json({ error: 'Varsayılan kanal silinemez' });

        const groupId = channelRes.rows[0].group_id;
        const memberRes = await query(
          'SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2',
          [groupId, req.user.id]
        );
        if (!memberRes.rows.length || (memberRes.rows[0].role !== 'owner' && memberRes.rows[0].role !== 'moderator')) {
          return res.status(403).json({ error: 'Kanal silmek için yetkiniz yok' });
        }

        await query('DELETE FROM group_channels WHERE id = $1', [channelId]);
        res.json({ success: true });
      } catch (e) {
        console.error('Kanal silme hatası:', e.message);
        res.status(500).json({ error: 'Kanal silinemedi' });
      }
    });

    // Kanal mesajları getir
    app.get('/api/group/:slug/channel/:channelId/messages', optionalAuth, async (req, res) => {
      try {
        const { slug, channelId } = req.params;
        const { limit = 50, offset = 0 } = req.query;

        const channelRes = await query(
          `SELECT gc.* FROM group_channels gc
           JOIN groups g ON gc.group_id = g.id
           WHERE gc.id = $1 AND g.slug = $2`,
          [channelId, slug]
        );
        if (!channelRes.rows.length) return res.status(404).json({ error: 'Kanal bulunamadı' });

        const result = await query(
          `SELECT gcm.id, gcm.channel_id, gcm.user_id, u.username, u.avatar, 
                  gcm.content, gcm.image_url, gcm.edited_at, gcm.created_at
           FROM group_channel_messages gcm
           LEFT JOIN users u ON gcm.user_id = u.id
           WHERE gcm.channel_id = $1
           ORDER BY gcm.created_at DESC
           LIMIT $2 OFFSET $3`,
          [channelId, limit, offset]
        );

        res.json(result.rows.reverse());
      } catch (e) {
        console.error('Kanal mesajları hatası:', e.message);
        res.status(500).json({ error: 'Mesajlar alınamadı' });
      }
    });

    // Kanal mesajı gönder
    app.post('/api/group/:slug/channel/:channelId/messages', authMiddleware, async (req, res) => {
      try {
        const { slug, channelId } = req.params;
        const { content, image_url = '' } = req.body;
        if (!content && !image_url) return res.status(400).json({ error: 'Mesaj içeriği gerekli' });

        const channelRes = await query(
          `SELECT gc.*, g.id as group_id FROM group_channels gc
           JOIN groups g ON gc.group_id = g.id
           WHERE gc.id = $1 AND g.slug = $2`,
          [channelId, slug]
        );
        if (!channelRes.rows.length) return res.status(404).json({ error: 'Kanal bulunamadı' });
        if (!channelRes.rows[0].can_write) return res.status(403).json({ error: 'Bu kanala yazamıyorsunuz' });

        const groupId = channelRes.rows[0].group_id;
        const memberRes = await query(
          'SELECT * FROM group_members WHERE group_id = $1 AND user_id = $2',
          [groupId, req.user.id]
        );
        if (!memberRes.rows.length) return res.status(403).json({ error: 'Grubun üyesi değilsiniz' });

        const result = await query(
          `INSERT INTO group_channel_messages (channel_id, user_id, content, image_url)
           VALUES ($1, $2, $3, $4) RETURNING *`,
          [channelId, req.user.id, content, image_url]
        );

        res.json(result.rows[0]);
      } catch (e) {
        console.error('Mesaj gönderme hatası:', e.message);
        res.status(500).json({ error: 'Mesaj gönderilemedi' });
      }
    });

    // Onay sistemi: aktif et/deaktif et
    app.post('/api/group/:slug/approval/toggle', authMiddleware, async (req, res) => {
      try {
        const { slug } = req.params;
        const groupRes = await query('SELECT id, owner_id FROM groups WHERE slug = $1', [slug]);
        if (!groupRes.rows.length) return res.status(404).json({ error: 'Grup bulunamadı' });
        const groupId = groupRes.rows[0].id;

        // Sadece sahibi etkinleştirebilir
        if (groupRes.rows[0].owner_id !== req.user.id) {
          return res.status(403).json({ error: 'Onay sistemini değiştirmek için yetkiniz yok' });
        }

        const existing = await query('SELECT * FROM group_approval_systems WHERE group_id = $1', [groupId]);
        let result;
        if (existing.rows.length) {
          result = await query(
            'UPDATE group_approval_systems SET is_enabled = NOT is_enabled WHERE group_id = $1 RETURNING *',
            [groupId]
          );
        } else {
          result = await query(
            'INSERT INTO group_approval_systems (group_id, is_enabled) VALUES ($1, 1) RETURNING *',
            [groupId]
          );
        }

        // Onay sistemi etkinleştiriliyorsa, onay kanalını otomatik oluştur
        if (result.rows[0].is_enabled) {
          const channelCheck = await query(
            'SELECT * FROM group_channels WHERE group_id = $1 AND name = $2',
            [groupId, 'onay']
          );
          if (!channelCheck.rows.length) {
            await query(
              `INSERT INTO group_channels (group_id, name, icon, is_default, can_write, visibility, created_by)
               VALUES ($1, $2, $3, 1, 1, $4, $5)`,
              [groupId, 'onay', 'fas fa-check-circle', 'approval_only', req.user.id]
            );
          }
        }

        res.json(result.rows[0]);
      } catch (e) {
        console.error('Onay sistemi hatası:', e.message);
        res.status(500).json({ error: 'Onay sistemi değiştirilemedi' });
      }
    });

    // Onay talebini oluştur (yeni üye)
    app.post('/api/group/:slug/approval/request', authMiddleware, async (req, res) => {
      try {
        const { slug } = req.params;
        const groupRes = await query('SELECT id FROM groups WHERE slug = $1', [slug]);
        if (!groupRes.rows.length) return res.status(404).json({ error: 'Grup bulunamadı' });
        const groupId = groupRes.rows[0].id;

        const approvalRes = await query('SELECT is_enabled FROM group_approval_systems WHERE group_id = $1', [groupId]);
        if (!approvalRes.rows.length || !approvalRes.rows[0].is_enabled) {
          return res.status(400).json({ error: 'Onay sistemi aktif değil' });
        }

        const result = await query(
          `INSERT INTO group_approval_requests (group_id, user_id, status) 
           VALUES ($1, $2, 'pending') 
           ON CONFLICT (group_id, user_id) DO NOTHING
           RETURNING *`,
          [groupId, req.user.id]
        );

        if (result.rows.length === 0) {
          return res.status(400).json({ error: 'Zaten onay talebiniz var veya onaylanmışsınız' });
        }

        res.json(result.rows[0]);
      } catch (e) {
        console.error('Onay talebi hatası:', e.message);
        res.status(500).json({ error: 'Onay talebi oluşturulamadı' });
      }
    });

    // Onay taleplerini listele
    app.get('/api/group/:slug/approval/requests', authMiddleware, async (req, res) => {
      try {
        const { slug } = req.params;
        const groupRes = await query('SELECT id, owner_id FROM groups WHERE slug = $1', [slug]);
        if (!groupRes.rows.length) return res.status(404).json({ error: 'Grup bulunamadı' });
        const groupId = groupRes.rows[0].id;

        // Sadece sahibi görebilir
        if (groupRes.rows[0].owner_id !== req.user.id) {
          return res.status(403).json({ error: 'Yetkili değilsiniz' });
        }

        const result = await query(
          `SELECT gar.*, u.username, u.avatar, u.bio
           FROM group_approval_requests gar
           LEFT JOIN users u ON gar.user_id = u.id
           WHERE gar.group_id = $1 AND gar.status = 'pending'
           ORDER BY gar.requested_at ASC`,
          [groupId]
        );

        res.json(result.rows);
      } catch (e) {
        console.error('Onay talepleri hatası:', e.message);
        res.status(500).json({ error: 'Onay talepleri alınamadı' });
      }
    });

    // Onay talebini yanıtla
    app.post('/api/group/:slug/approval/respond/:requestId', authMiddleware, async (req, res) => {
      try {
        const { slug, requestId } = req.params;
        const { approved, rejection_reason = '' } = req.body;

        const groupRes = await query('SELECT id, owner_id FROM groups WHERE slug = $1', [slug]);
        if (!groupRes.rows.length) return res.status(404).json({ error: 'Grup bulunamadı' });
        const groupId = groupRes.rows[0].id;

        if (groupRes.rows[0].owner_id !== req.user.id) {
          return res.status(403).json({ error: 'Yetkili değilsiniz' });
        }

        const requestRes = await query('SELECT * FROM group_approval_requests WHERE id = $1 AND group_id = $2', [requestId, groupId]);
        if (!requestRes.rows.length) return res.status(404).json({ error: 'Talep bulunamadı' });

        const userId = requestRes.rows[0].user_id;
        if (approved) {
          // Kullanıcıyı gruba ekle
          await query(
            `INSERT INTO group_members (group_id, user_id, role) 
             VALUES ($1, $2, 'member') 
             ON CONFLICT (group_id, user_id) DO NOTHING`,
            [groupId, userId]
          );
          await query(
            `UPDATE group_approval_requests SET status = 'approved', reviewed_by = $1, reviewed_at = NOW() WHERE id = $2`,
            [req.user.id, requestId]
          );
        } else {
          await query(
            `UPDATE group_approval_requests SET status = 'rejected', rejection_reason = $1, reviewed_by = $2, reviewed_at = NOW() WHERE id = $3`,
            [rejection_reason, req.user.id, requestId]
          );
        }

        res.json({ success: true });
      } catch (e) {
        console.error('Onay yanıtı hatası:', e.message);
        res.status(500).json({ error: 'Onay yanıtı işlenemedi' });
      }
    });

    // ===== KANAL SİSTEMİ API'LAR SONU =====

    app.listen(PORT, () => console.log(`CigCig çalışıyor: http://localhost:${PORT}`));
  });
}).catch(err => {
  console.error('DB başlatma hatası:', err);
  process.exit(1);
});
