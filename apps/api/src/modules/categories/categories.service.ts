import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service.js';
import type { CreateCategoryDto } from './dto/create-category.dto.js';
import type { UpdateCategoryDto } from './dto/update-category.dto.js';

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160);
}

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateCategoryDto) {
    const slug = slugify(dto.name);
    return this.prisma.category.create({
      data: {
        name: dto.name,
        slug,
        description: dto.description ?? null,
        color: (dto.color as any) ?? 'DEFAULT',
        sortOrder: dto.sortOrder ?? 0,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async findAll() {
    return this.prisma.category.findMany({
      where: { deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async findOne(id: string) {
    const cat = await this.prisma.category.findFirst({ where: { id, deletedAt: null } });
    if (!cat) throw new NotFoundException('Kategori tidak ditemukan');
    return cat;
  }

  async update(id: string, dto: UpdateCategoryDto) {
    const data: any = { ...dto };
    if (dto.name) data.slug = slugify(dto.name);
    return this.prisma.category.update({ where: { id }, data });
  }

  async remove(id: string) {
    await this.prisma.category.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
  }
}