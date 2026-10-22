import type { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';

import { getJwtSecret } from './jwt-secret.js';

function configWith(value: string | undefined): ConfigService {
  return { get: () => value } as unknown as ConfigService;
}

describe('getJwtSecret', () => {
  it('returns the configured secret', () => {
    expect(getJwtSecret(configWith('  secret-dari-env  '))).toBe('secret-dari-env');
  });

  it('throws a clear error when JWT_SECRET is missing', () => {
    expect(() => getJwtSecret(configWith(undefined))).toThrow(/JWT_SECRET wajib diisi/);
  });

  it('throws a clear error when JWT_SECRET is blank', () => {
    expect(() => getJwtSecret(configWith('   '))).toThrow(/JWT_SECRET wajib diisi/);
  });
});
