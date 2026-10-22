import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import type { JwtPayload } from '../../../common/jwt-payload.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { getJwtSecret } from '../jwt-secret.js';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: getJwtSecret(config),
    });
  }

  async validate(
    payload: JwtPayload,
  ): Promise<{ sub: string; username: string; role: 'ADMIN' | 'CASHIER' }> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, username: true, role: true, isActive: true, deletedAt: true },
    });

    if (!user || !user.isActive || user.deletedAt) {
      throw new UnauthorizedException('Akun tidak aktif atau tidak ditemukan');
    }

    return {
      sub: user.id,
      username: user.username,
      role: user.role,
    };
  }
}
