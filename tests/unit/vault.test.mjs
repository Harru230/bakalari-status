import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { encryptJson, decryptJson } from '../../src/lib/vault.mjs';

describe('AES-256-GCM crypto vault', () => {
  it('encrypts and decrypts arbitrary JSON round-trip', async () => {
    const payload = {
      schemaVersion: 1,
      teachers: [{ abbrev: 'FAR', name: 'Mag. Test Teacher' }],
      nested: [1, 2, 3],
    };
    const pass = 'unit-pass';
    const env = await encryptJson(payload, pass);

    assert.equal(env.v, 1);
    assert.equal(env.alg, 'AES-256-GCM');
    assert.equal(env.kdf, 'PBKDF2-SHA256');
    assert.ok(!JSON.stringify(env).includes('FAR'));

    const decrypted = await decryptJson(env, pass);
    assert.deepEqual(decrypted, payload);
  });

  it('produces unique random salt and iv on repeated encryptions', async () => {
    const a = await encryptJson({ x: 1 }, 'unit-pass');
    const b = await encryptJson({ x: 1 }, 'unit-pass');
    assert.notEqual(a.salt, b.salt);
    assert.notEqual(a.iv, b.iv);
    assert.notEqual(a.ct, b.ct);
  });

  it('throws Invalid passphrase on wrong passphrase or tampered ciphertext', async () => {
    const env = await encryptJson({ ok: true }, 'correct-pass');
    await assert.rejects(() => decryptJson(env, 'wrong-pass'), /Invalid passphrase/);

    const tampered = { ...env, ct: `A${env.ct.slice(1)}` };
    await assert.rejects(() => decryptJson(tampered, 'correct-pass'), /Invalid passphrase/);
  });
});
