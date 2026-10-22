import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service.js';
import { PasswordService } from '../auth/password.service.js';
import type { CreateUserDto } from './dto/create-user.dto.js';
import type { UpdateUserDto } from './dto/update-user.dto.js';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly password: PasswordService,
  ) {}

  async create(dto: CreateUserDto) {
    const passwordHash = await this.password.hash(dto.password);
    const user = await this.prisma.user.create({
      data: {
        username: dto.username,
        fullName: dto.fullName,
        passwordHash,
        phone: dto.phone ?? null,
        role: (dto.role ?? 'CASHIER') as 'ADMIN' | 'CASHIER',
      },
      select: {
        id: true,
        username: true,
        fullName: true,
        phone: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return user;
  }

  async findAll() {
    return this.prisma.user.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        username: true,
        fullName: true,
        phone: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
      orderBy: [{ role: 'asc' }, { username: 'asc' }],
    });
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        username: true,
        fullName: true,
        phone: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!user) throw new NotFoundException('Pengguna tidak ditemukan');
    return user;
  }

  async update(id: string, dto: UpdateUserDto) {
    const data: any = { ...dto };
    if (dto.password) {
      data.passwordHash = await this.password.hash(dto.password);
      delete data.password;
    }
    const user = await this.prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        username: true,
        fullName: true,
        phone: true,
        role: true,
        isActive: true,
        updatedAt: true,
      },
    });
    return user;
  }

  async remove(id: string) {
    await this.prisma.user.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
  }
}