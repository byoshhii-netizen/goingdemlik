const crypto = require('crypto');

const SCRYPT_N = 131072;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_MAXMEM = 256 * 1024 * 1024;

function deriveScrypt(password, salt) {
  return crypto.scryptSync(String(password), salt, SCRYPT_KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM
  });
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = deriveScrypt(password, salt).toString('hex');
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt}$${hash}`;
}

function safeEqualHex(actual, expected) {
  const actualBuffer = Buffer.from(actual, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function verifyPassword(password, stored) {
  const value = String(stored || '');
  const parts = value.split('$');
  if (parts[0] === 'scrypt' && parts.length === 6) {
    const [, n, r, p, salt, expected] = parts;
    const parameters = { N: Number(n), r: Number(r), p: Number(p) };
    if (!Number.isSafeInteger(parameters.N) || !Number.isSafeInteger(parameters.r) || !Number.isSafeInteger(parameters.p) || !salt || !expected) return false;
    if (parameters.N !== SCRYPT_N || parameters.r !== SCRYPT_R || parameters.p !== SCRYPT_P) return false;
    return safeEqualHex(deriveScrypt(password, salt), expected);
  }

  // Legacy records are upgraded to the current format after a successful login.
  if (/^[a-f0-9]{64}$/i.test(value)) {
    const legacyHash = crypto.createHash('sha256').update(String(password)).digest('hex');
    return safeEqualHex(legacyHash, value);
  }
  return false;
}

function needsRehash(stored) {
  return !String(stored || '').startsWith(`scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$`);
}

module.exports = { hashPassword, verifyPassword, needsRehash };