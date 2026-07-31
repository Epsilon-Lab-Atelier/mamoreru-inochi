const encoder = new TextEncoder();
const decoder = new TextDecoder();
const PBKDF2_ITERATIONS = 250_000;

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  if (typeof btoa === 'function') return btoa(binary);
  return Buffer.from(bytes).toString('base64');
}

function base64ToBytes(base64) {
  const binary = typeof atob === 'function'
    ? atob(base64)
    : Buffer.from(base64, 'base64').toString('binary');
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function deriveKey(passphrase, salt, usage) {
  if (!globalThis.crypto?.subtle) {
    throw new Error('この環境では暗号化機能を利用できません。');
  }
  const material = await globalThis.crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return globalThis.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256'
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    usage
  );
}

export async function encryptJson(data, passphrase) {
  if (!passphrase || passphrase.length < 8) {
    throw new Error('パスフレーズは8文字以上にしてください。');
  }
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, ['encrypt']);
  const plaintext = encoder.encode(JSON.stringify(data));
  const encrypted = await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return {
    format: 'mamoreru-inochi-encrypted-v1',
    algorithm: 'AES-GCM',
    derivation: 'PBKDF2-SHA-256',
    iterations: PBKDF2_ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(encrypted))
  };
}

export async function decryptJson(payload, passphrase) {
  try {
    if (payload?.format !== 'mamoreru-inochi-encrypted-v1') {
      throw new Error('暗号化形式が一致しません。');
    }
    const salt = base64ToBytes(payload.salt);
    const iv = base64ToBytes(payload.iv);
    const ciphertext = base64ToBytes(payload.ciphertext);
    const key = await deriveKey(passphrase, salt, ['decrypt']);
    const decrypted = await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return JSON.parse(decoder.decode(decrypted));
  } catch (error) {
    if (error?.message === '暗号化形式が一致しません。') throw error;
    throw new Error('パスフレーズが違うか、保存データが破損しています。');
  }
}

export function isEncryptedPayload(value) {
  return Boolean(value && value.format === 'mamoreru-inochi-encrypted-v1' && value.ciphertext);
}
