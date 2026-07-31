import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { decryptJson, encryptJson, isEncryptedPayload } from '../src/crypto.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

test('encrypted backups round-trip without storing plaintext', async () => {
  const input = { diagnosis: { priority: 4 }, familyPlan: { place: 'test' } };
  const encrypted = await encryptJson(input, 'abcdefgh1234');
  assert.equal(isEncryptedPayload(encrypted), true);
  assert.equal(JSON.stringify(encrypted).includes('familyPlan'), false);
  const restored = await decryptJson(encrypted, 'abcdefgh1234');
  assert.deepEqual(restored, input);
});

test('wrong passphrase cannot decrypt', async () => {
  const encrypted = await encryptJson({ value: 1 }, 'correct-passphrase');
  await assert.rejects(() => decryptJson(encrypted, 'wrong-passphrase'), /パスフレーズ/);
});
