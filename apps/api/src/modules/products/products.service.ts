import { Injectable, NotFoundException } from '@nestjs/common';
import { rupiahToSen, sen } from '@warung/shared';

import { PrismaService } from '../../prisma/prisma.service.js';
import type { CreateProductDto } from './dto/create-product.dto.js';
import type { UpdateProductDto } from './dto/update-product.dto.js';

type ProductMoney = {
  priceBuy: { toString(): string } | string | number;
  priceSell: { toString(): string } | string | number;
  priceWholesale: { toString(): string } | string | number | null;
};

function toProductDto<T extends ProductMoney>(product: T) {
  return {
    ...product,
    priceBuy: rupiahToSen(Number(product.priceBuy)),
    priceSell: rupiahToSen(Number(product.priceSell)),
    priceWholesale: product.priceWholesale === null ? null : rupiahToSen(Number(product.priceWholesale)),
  };
}

function senToRupiahDecimal(value: number): string {
  return (sen(value) / 100).toFixed(2);
}

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
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateProductDto) {
    const baseSlug = slugify(dto.name);
    const slug = `${baseSlug}-${Date.now().toString(36)}`.slice(0, 180);
    const created = await this.prisma.product.create({
      data: {
        sku: dto.sku ?? `SKU-${Date.now()}`,
        barcode: dto.barcode ?? null,
        name: dto.name,
        slug,
        description: dto.description ?? null,
        categoryId: dto.categoryId ?? null,
        priceBuy: senToRupiahDecimal(dto.priceBuy),
        priceSell: senToRupiahDecimal(dto.priceSell),
        priceWholesale: dto.priceWholesale === undefined ? null : senToRupiahDecimal(dto.priceWholesale),
        stockQty: dto.stock ?? 0,
        minStock: dto.minStock ?? 0,
        unit: (dto.unit as any) ?? 'PCS',
        imageUrl: dto.imageUrl ?? null,
        wholesaleMinQty: dto.wholesaleMinQty ?? null,
        isActive: dto.isActive ?? true,
        isFeatured: dto.isFeatured ?? false,
        isPublic: dto.isPublic ?? true,
      },
    });
    return toProductDto(created);
  }

  async findAll() {
    const products = await this.prisma.product.findMany({
      where: { deletedAt: null },
      include: { category: true },
      orderBy: { name: 'asc' },
    });
    return products.map(toProductDto);
  }

  async findOne(id: string) {
    const p = await this.prisma.product.findFirst({ where: { id, deletedAt: null }, include: { category: true } });
    if (!p) throw new NotFoundException('Produk tidak ditemukan');
    return toProductDto(p);
  }

  async update(id: string, dto: UpdateProductDto) {
    const data: any = { ...dto };
    delete data.stock;
    delete data.priceBuy;
    delete data.priceSell;
    delete data.priceWholesale;
    if (dto.stock !== undefined) data.stockQty = dto.stock;
    if (dto.priceBuy !== undefined) data.priceBuy = senToRupiahDecimal(dto.priceBuy);
    if (dto.priceSell !== undefined) data.priceSell = senToRupiahDecimal(dto.priceSell);
    if (dto.priceWholesale !== undefined) data.priceWholesale = senToRupiahDecimal(dto.priceWholesale);
    if (dto.name) data.slug = `${slugify(dto.name)}-${Date.now().toString(36)}`.slice(0, 180);
    const updated = await this.prisma.product.update({ where: { id }, data });
    return toProductDto(updated);
  }

  async remove(id: string) {
    await this.prisma.product.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
  }
}