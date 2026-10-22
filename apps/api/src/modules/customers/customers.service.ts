import { Injectable, NotFoundException } from '@nestjs/common';
import { sen } from '@warung/shared';

import { PrismaService } from '../../prisma/prisma.service.js';
import type { CreateCustomerDto } from './dto/create-customer.dto.js';
import type { UpdateCustomerDto } from './dto/update-customer.dto.js';

type CustomerMoney = {
  creditLimit: { toString(): string } | string | number;
};

function toCustomerDto<T extends CustomerMoney>(customer: T) {
  return {
    ...customer,
    creditLimit: sen(Math.round(Number(customer.creditLimit.toString()))),
  };
}

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateCustomerDto) {
    const created = await this.prisma.customer.create({
      data: {
        name: dto.name,
        phone: dto.phone,
        address: dto.address ?? null,
        creditLimit: sen(dto.creditLimit ?? 0).toString(),
      },
    });
    return toCustomerDto(created);
  }

  async findAll() {
    const customers = await this.prisma.customer.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
    });
    return customers.map(toCustomerDto);
  }

  async findOne(id: string) {
    const c = await this.prisma.customer.findFirst({ where: { id, deletedAt: null } });
    if (!c) throw new NotFoundException('Pelanggan tidak ditemukan');
    return toCustomerDto(c);
  }

  async update(id: string, dto: UpdateCustomerDto) {
    const { creditLimit, ...rest } = dto;
    const updated = await this.prisma.customer.update({
      where: { id },
      data: {
        ...rest,
        ...(typeof creditLimit === 'number' ? { creditLimit: sen(creditLimit).toString() } : {}),
      },
    });
    return toCustomerDto(updated);
  }

  async remove(id: string) {
    await this.prisma.customer.update({ where: { id }, data: { deletedAt: new Date() } });
  }
}
