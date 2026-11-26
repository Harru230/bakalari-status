const PBKDF2_ITERATIONS = 210_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function deriveAesKey(passphrase, salt, iterations, usages) {
  const encoded = new TextEncoder().encode(passphrase);
  const keyMaterial = await globalThis.crypto.subtle.importKey(
    'raw',
    encoded,
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return globalThis.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    usages,
  );
}

/**
 * Encrypts a JSON-serializable object using PBKDF2-SHA256 and AES-256-GCM.
 * @param {unknown} data
 * @param {string} passphrase
 * @returns {Promise<{ v: number, alg: string, kdf: string, iter: number, salt: string, iv: string, ct: string }>}
 */
export async function encryptJson(data, passphrase) {
  if (typeof passphrase !== 'string' || passphrase.length === 0) {
    throw new Error('Passphrase must be a non-empty string');
  }
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveAesKey(passphrase, salt, PBKDF2_ITERATIONS, ['encrypt']);
  const plaintext = new TextEncoder().encode(JSON.stringify(data));
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintext,
  );

  return {
    v: 1,
    alg: 'AES-256-GCM',
    kdf: 'PBKDF2-SHA256',
    iter: PBKDF2_ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ct: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

/**
 * Decrypts an AES-256-GCM envelope produced by encryptJson.
 * @param {{ v: number, alg: string, kdf: string, iter: number, salt: string, iv: string, ct: string }} envelope
 * @param {string} passphrase
 * @returns {Promise<any>}
 */
export async function decryptJson(envelope, passphrase) {
  if (
    !envelope ||
    typeof envelope !== 'object' ||
    envelope.v !== 1 ||
    envelope.alg !== 'AES-256-GCM' ||
    envelope.kdf !== 'PBKDF2-SHA256' ||
    !Number.isInteger(envelope.iter) ||
    envelope.iter < 10_000 ||
    typeof envelope.salt !== 'string' ||
    typeof envelope.iv !== 'string' ||
    typeof envelope.ct !== 'string'
  ) {
    throw new Error('Invalid passphrase');
  }
  if (typeof passphrase !== 'string' || passphrase.length === 0) {
    throw new Error('Invalid passphrase');
  }

  try {
    const salt = base64ToBytes(envelope.salt);
    const iv = base64ToBytes(envelope.iv);
    const ct = base64ToBytes(envelope.ct);
    const key = await deriveAesKey(passphrase, salt, envelope.iter, ['decrypt']);
    const plaintext = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ct,
    );
    return JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    throw new Error('Invalid passphrase');
  }
}
