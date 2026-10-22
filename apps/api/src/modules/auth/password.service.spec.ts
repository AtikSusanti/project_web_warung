import { scrypt as scryptCallback } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { PasswordService } from './password.service.js';

function derive(
  password: string,
  salt: Buffer,
  keylen: number,
  options?: { N: number; r: number; p: number; maxmem?: number },
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const callback = (err: Error | null, key: Buffer): void => {
      if (err) reject(err);
      else resolve(key);
    };
    if (options) scryptCallback(password, salt, keylen, options, callback);
    else scryptCallback(password, salt, keylen, callback);
  });
}

describe('PasswordService', () => {
  const service = new PasswordService();

  it('verifies legacy scrypt hash mislabeled as N=32768 but hashed with default N=16384', async () => {
    const password = 'Admin123!';
    const salt = Buffer.from('0123456789abcdef');
    const derived = await derive(password, salt, 32);
    const stored = ['scrypt', 32768, 8, 1, salt.toString('base64'), derived.toString('base64')].join('$');

    await expect(service.verify(stored, password)).resolves.toBe(true);
    await expect(service.verify(stored, 'salah')).resolves.toBe(false);
  });

  it('verifies scrypt hash with matching label N=32768', async () => {
    const password = 'S3cret!';
    const salt = Buffer.from('abcdef0123456789');
    const derived = await derive(password, salt, 32, {
      N: 32768,
      r: 8,
      p: 1,
      maxmem: 128 * 1024 * 1024,
    });
    const stored = ['scrypt', 32768, 8, 1, salt.toString('base64'), derived.toString('base64')].join('$');

    await expect(service.verify(stored, password)).resolves.toBe(true);
    await expect(service.verify(stored, 'salah')).resolves.toBe(false);
  });

  it('verifies argon2id hashes produced by hash()', async () => {
    const password = 'Argon2Pass!';
    const hash = await service.hash(password);

    expect(hash.startsWith('$argon2id$')).toBe(true);
    await expect(service.verify(hash, password)).resolves.toBe(true);
    await expect(service.verify(hash, 'salah')).resolves.toBe(false);
  });

  it('rejects malformed scrypt strings', async () => {
    await expect(service.verify('scrypt$rusak', 'x')).resolves.toBe(false);
  });
});
