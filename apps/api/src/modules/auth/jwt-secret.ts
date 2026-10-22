import type { ConfigService } from '@nestjs/config';

export const JWT_SECRET_ENV_KEY = 'JWT_SECRET';

export function getJwtSecret(config: ConfigService): string {
  const secret = config.get<string>(JWT_SECRET_ENV_KEY)?.trim();

  if (!secret) {
    throw new Error(
      'JWT_SECRET wajib diisi. Set environment variable JWT_SECRET sebelum menjalankan API.',
    );
  }

  return secret;
}
