import { NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../prisma/prisma.service.js';
import { CustomersService } from './customers.service.js';
import { CreateCustomerDto, MAX_CUSTOMER_CREDIT_LIMIT_SEN } from './dto/create-customer.dto.js';

const now = new Date('2026-10-21T08:00:00.000Z');

function customerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Budi',
    phone: '6281234567890',
    address: null,
    creditLimit: '5000000',
    status: 'ACTIVE',
    note: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  };
}

function setup() {
  const customer = {
    create: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  };
  const prisma = { customer };
  const service = new CustomersService(prisma as unknown as PrismaService);
  return { service, customer };
}

describe('CustomersService creditLimit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('menyimpan creditLimit sebagai sen dan mengembalikannya sebagai number', async () => {
    const { service, customer } = setup();
    customer.create.mockResolvedValue(customerRow());

    const result = await service.create({
      name: 'Budi',
      phone: '6281234567890',
      creditLimit: 5_000_000,
    });

    expect(customer.create).toHaveBeenCalledWith({
      data: {
        name: 'Budi',
        phone: '6281234567890',
        address: null,
        creditLimit: '5000000',
      },
    });
    expect(result.creditLimit).toBe(5_000_000);
    expect(typeof result.creditLimit).toBe('number');
  });

  it('mengubah creditLimit ke sen dan mengembalikan response yang konsisten', async () => {
    const { service, customer } = setup();
    customer.update.mockResolvedValue(customerRow({ creditLimit: '7500000' }));

    const result = await service.update('customer-1', { creditLimit: 7_500_000 });

    expect(customer.update).toHaveBeenCalledWith({
      where: { id: 'customer-1' },
      data: { creditLimit: '7500000' },
    });
    expect(result.creditLimit).toBe(7_500_000);
  });

  it('mengubah nilai Decimal dari database menjadi number sen pada findAll', async () => {
    const { service, customer } = setup();
    customer.findMany.mockResolvedValue([
      customerRow({ creditLimit: '5000000' }),
      customerRow({
        id: '22222222-2222-4222-8222-222222222222',
        name: 'Sari',
        creditLimit: '0',
      }),
    ]);

    const result = await service.findAll();

    expect(result.map((item) => item.creditLimit)).toEqual([5_000_000, 0]);
    expect(result.every((item) => typeof item.creditLimit === 'number')).toBe(true);
  });

  it('mengembalikan response number sen pada findOne', async () => {
    const { service, customer } = setup();
    customer.findFirst.mockResolvedValue(customerRow({ creditLimit: '1250000' }));

    const result = await service.findOne('customer-1');

    expect(result.creditLimit).toBe(1_250_000);
    expect(typeof result.creditLimit).toBe('number');
  });

  it('tetap melempar NotFoundException saat pelanggan tidak ditemukan', async () => {
    const { service, customer } = setup();
    customer.findFirst.mockResolvedValue(null);

    await expect(service.findOne('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('CreateCustomerDto.creditLimit', () => {
  const base = {
    name: 'Budi',
    phone: '6281234567890',
  };

  async function validateCreditLimit(creditLimit: number) {
    return validate(plainToInstance(CreateCustomerDto, { ...base, creditLimit }));
  }

  it('menerima limit dalam satuan sen berupa integer', async () => {
    const errors = await validateCreditLimit(5_000_000);

    expect(errors).toHaveLength(0);
  });

  it.each([
    ['pecahan', 100.5],
    ['negatif', -1],
    ['melebihi batas penyimpanan', MAX_CUSTOMER_CREDIT_LIMIT_SEN + 1],
  ])('menolak creditLimit %s', async (_label, creditLimit) => {
    const errors = await validateCreditLimit(creditLimit);

    expect(errors.some((error) => error.property === 'creditLimit')).toBe(true);
  });
});
