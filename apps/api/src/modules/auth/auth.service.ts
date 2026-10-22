import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomUUID, createHash } from 'node:crypto';
import ms from 'ms';

import { PrismaService } from '../../prisma/prisma.service.js';
import type { JwtPayload } from '../../common/jwt-payload.js';
import { PasswordService } from './password.service.js';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresAt: Date;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly password: PasswordService,
  ) {}

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private msToSeconds(s: string): number {
    const m = ms(s);
    return Math.floor(m / 1000);
  }

  async login(username: string, password: string, ip?: string, userAgent?: string): Promise<TokenPair> {
    const user = await this.prisma.user.findUnique({ where: { username } });
    if (!user || !user.isActive || user.deletedAt) {
      throw new UnauthorizedException('Username atau kata sandi salah');
    }

    const ok = await this.password.verify(user.passwordHash, password);
    if (!ok) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: { increment: 1 } },
      });
      throw new UnauthorizedException('Username atau kata sandi salah');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lastLoginAt: new Date(), lockedUntil: null },
    });

    return this.issueTokens(user.id, user.username, user.role as any, ip, userAgent);
  }

  async issueTokens(userId: string, username: string, role: 'ADMIN' | 'CASHIER', ip?: string, userAgent?: string): Promise<TokenPair> {
    const familyId = randomUUID();
    const jti = randomUUID();
    const refreshExpiresInStr = this.config.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '30d';
    const accessExpiresInStr = this.config.get<string>('JWT_ACCESS_EXPIRES_IN') ?? '15m';
    const refreshExpiresAt = new Date(Date.now() + ms(refreshExpiresInStr));

    const accessToken = await this.jwt.signAsync(
      { sub: userId, username, role } satisfies JwtPayload,
      {
        expiresIn: accessExpiresInStr,
        issuer: this.config.get<string>('JWT_ISSUER') ?? 'warung-api',
        audience: this.config.get<string>('JWT_AUDIENCE') ?? 'warung-client',
        jwtid: jti,
      },
    );

    const refreshToken = await this.jwt.signAsync(
      { sub: userId, username, role } satisfies JwtPayload,
      {
        expiresIn: refreshExpiresInStr,
        issuer: this.config.get<string>('JWT_ISSUER') ?? 'warung-api',
        audience: this.config.get<string>('JWT_AUDIENCE') ?? 'warung-client',
        jwtid: jti,
      },
    );

    await this.prisma.refreshToken.create({
      data: {
        id: randomUUID(),
        userId,
        tokenHash: this.hashToken(refreshToken),
        familyId,
        expiresAt: refreshExpiresAt,
        ipAddress: ip,
        userAgent,
      },
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: this.msToSeconds(accessExpiresInStr),
      refreshExpiresAt,
    };
  }

  async refresh(refreshToken: string, ip?: string, userAgent?: string): Promise<TokenPair> {
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(refreshToken, {
        issuer: this.config.get<string>('JWT_ISSUER') ?? 'warung-api',
        audience: this.config.get<string>('JWT_AUDIENCE') ?? 'warung-client',
      });
    } catch {
      throw new UnauthorizedException('Refresh token tidak valid');
    }

    const tokenHash = this.hashToken(refreshToken);
    const existing = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!existing || existing.revokedAt) {
      if (existing?.familyId) {
        await this.prisma.refreshToken.updateMany({
          where: { familyId: existing.familyId, revokedAt: null },
          data: { revokedAt: new Date(), revokedReason: 'token_reuse' },
        });
      }
      throw new UnauthorizedException('Refresh token telah digunakan atau dicabut');
    }

    if (existing.expiresAt < new Date()) {
      await this.prisma.refreshToken.update({
        where: { id: existing.id },
        data: { revokedAt: new Date(), revokedReason: 'expired' },
      });
      throw new UnauthorizedException('Refresh token kedaluwarsa');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.refreshToken.update({
        where: { id: existing.id },
        data: { usedAt: new Date(), revokedAt: new Date(), revokedReason: 'rotated' },
      });
    });

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, username: true, role: true, isActive: true, deletedAt: true },
    });
    if (!user || !user.isActive || user.deletedAt) {
      throw new UnauthorizedException('Akun tidak aktif');
    }

    const newFamilyId = existing.familyId;
    const jti = randomUUID();
    const refreshExpiresInStr = this.config.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '30d';
    const accessExpiresInStr = this.config.get<string>('JWT_ACCESS_EXPIRES_IN') ?? '15m';
    const refreshExpiresAt = new Date(Date.now() + ms(refreshExpiresInStr));

    const accessToken = await this.jwt.signAsync(
      { sub: user.id, username: user.username, role: user.role as any } satisfies JwtPayload,
      {
        expiresIn: accessExpiresInStr,
        issuer: this.config.get<string>('JWT_ISSUER') ?? 'warung-api',
        audience: this.config.get<string>('JWT_AUDIENCE') ?? 'warung-client',
        jwtid: jti,
      },
    );

    const newRefreshToken = await this.jwt.signAsync(
      { sub: user.id, username: user.username, role: user.role as any } satisfies JwtPayload,
      {
        expiresIn: refreshExpiresInStr,
        issuer: this.config.get<string>('JWT_ISSUER') ?? 'warung-api',
        audience: this.config.get<string>('JWT_AUDIENCE') ?? 'warung-client',
        jwtid: jti,
      },
    );

    await this.prisma.refreshToken.create({
      data: {
        id: randomUUID(),
        userId: user.id,
        tokenHash: this.hashToken(newRefreshToken),
        familyId: newFamilyId,
        expiresAt: refreshExpiresAt,
        ipAddress: ip,
        userAgent,
      },
    });

    return {
      accessToken,
      refreshToken: newRefreshToken,
      expiresIn: this.msToSeconds(accessExpiresInStr),
      refreshExpiresAt,
    };
  }

  async logout(refreshToken: string): Promise<void> {
    if (!refreshToken) return;
    const tokenHash = this.hashToken(refreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'logout' },
    });
  }

  async logoutAll(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'logout_all' },
    });
  }
}