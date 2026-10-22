import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service.js';

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get() {
    return this.prisma.setting.findUnique({ where: { id: 1 } });
  }

  async update(data: any) {
    return this.prisma.setting.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data });
  }
}