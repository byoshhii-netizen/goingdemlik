/* Client-side E2EE primitives. Private keys never leave this browser. */
(() => {
  const DB_NAME = 'cigcig-e2ee';
  const STORE = 'identity';
  const IDENTITY_KEY = 'identity';

  const openDb = () => new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  const dbGet = async key => {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  };

  const dbPut = async (key, value) => {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE, 'readwrite').objectStore(STORE).put(value, key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  };

  const bytesToB64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
  const b64ToBytes = value => Uint8Array.from(atob(value), char => char.charCodeAt(0));
  const textToBytes = value => new TextEncoder().encode(value);
  const bytesToText = value => new TextDecoder().decode(value);

  async function getIdentity() {
    let identity = await dbGet(IDENTITY_KEY);
    if (!identity) {
      const keys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']);
      identity = {
        privateKey: keys.privateKey,
        publicKey: await crypto.subtle.exportKey('jwk', keys.publicKey),
      };
      await dbPut(IDENTITY_KEY, identity);
    }
    return identity;
  }

  async function registerIdentity() {
    const identity = await getIdentity();
    const response = await fetch('/api/e2ee/identity', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ public_key: identity.publicKey }),
    });
    if (!response.ok) throw new Error('Güvenli cihaz anahtarı kaydedilemedi.');
    return identity;
  }

  const importPublicKey = publicKey => crypto.subtle.importKey(
    'jwk', publicKey, { name: 'ECDH', namedCurve: 'P-256' }, false, []
  );

  async function deriveKey(publicKey, context) {
    const identity = await getIdentity();
    const remote = await importPublicKey(publicKey);
    const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: remote }, identity.privateKey, 256);
    const material = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: textToBytes('cigcig-e2ee-v1'), info: textToBytes(String(context)) },
      material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );
  }

  async function encryptFor(publicKey, plaintext, context) {
    const key = await deriveKey(publicKey, context);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, textToBytes(plaintext));
    return { v: 1, alg: 'ECDH-P256/AES-256-GCM', iv: bytesToB64(iv), ciphertext: bytesToB64(ciphertext) };
  }

  async function decryptFrom(publicKey, envelope, context) {
    if (!envelope || envelope.v !== 1) throw new Error('Desteklenmeyen şifreli mesaj.');
    const key = await deriveKey(publicKey, context);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(envelope.iv) }, key, b64ToBytes(envelope.ciphertext));
    return bytesToText(plaintext);
  }
  async function encryptForMany(recipients, plaintext, context) {
    const entries = await Promise.all(recipients.map(async recipient => [
      String(recipient.id), await encryptFor(recipient.public_key, plaintext, `${context}:${recipient.id}`)
    ]));
    return { v: 1, recipients: Object.fromEntries(entries) };
  }
  async function decryptForMe(senderPublicKey, payload, userId, context) {
    const envelope = payload?.recipients?.[String(userId)];
    if (!envelope) throw new Error('Bu cihaz için şifreli zarf yok.');
    return decryptFrom(senderPublicKey, envelope, `${context}:${userId}`);
  }

  window.CigCigE2EE = { getIdentity, registerIdentity, encryptFor, decryptFrom, encryptForMany, decryptForMe };
})();
