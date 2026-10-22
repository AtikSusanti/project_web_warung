import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';

const DEFAULT_SCRYPT_N = 16384;
const DEFAULT_SCRYPT_R = 8;
const DEFAULT_SCRYPT_P = 1;

@Injectable()
export class PasswordService {
  async hash(password: string): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 1,
    });
  }

  async verify(hash: string, password: string): Promise<boolean> {
    if (hash.startsWith('scrypt$')) {
      return this.verifyScrypt(hash, password);
    }
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  private async verifyScrypt(stored: string, password: string): Promise<boolean> {
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

    const [, nRaw, rRaw, pRaw, saltRaw, hashRaw] = parts;
    const n = Number(nRaw);
    const r = Number(rRaw);
    const p = Number(pRaw);
    if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) return false;
    if (saltRaw === undefined || hashRaw === undefined) return false;

    const salt = Buffer.from(saltRaw, 'base64');
    const expected = Buffer.from(hashRaw, 'base64');
    if (expected.length === 0) return false;

    if (await this.matches(password, salt, expected, n, r, p)) return true;

    const isDefault = n === DEFAULT_SCRYPT_N && r === DEFAULT_SCRYPT_R && p === DEFAULT_SCRYPT_P;
    if (!isDefault && (await this.matches(password, salt, expected, DEFAULT_SCRYPT_N, DEFAULT_SCRYPT_R, DEFAULT_SCRYPT_P))) {
      return true;
    }

    return false;
  }

  private async matches(
    password: string,
    salt: Buffer,
    expected: Buffer,
    n: number,
    r: number,
    p: number,
  ): Promise<boolean> {
    try {
      const actual = await this.derive(password, salt, expected.length, n, r, p);
      if (actual.length !== expected.length) return false;
      return timingSafeEqual(actual, expected);
    } catch {
      return false;
    }
  }

  private derive(
    password: string,
    salt: Buffer,
    keylen: number,
    n: number,
    r: number,
    p: number,
  ): Promise<Buffer> {
    const maxmem = 128 * n * r * 2;
    return new Promise<Buffer>((resolve, reject) => {
      scryptCallback(password, salt, keylen, { N: n, r, p, maxmem }, (err, key) => {
        if (err) reject(err);
        else resolve(key);
      });
    });
  }
}
