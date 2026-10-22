import { NotFoundException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../prisma/prisma.service.js';
import { DebtsService } from './debts.service.js';

const asOf = new Date('2026-10-22T10:00:00.000Z');
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const customerId = '11111111-1111-4111-8111-111111111111';

function daysAgo(days: number): Date {
  return new Date(asOf.getTime() - days * MS_PER_DAY);
}

function daysAhead(days: number): Date {
  return new Date(asOf.getTime() + days * MS_PER_DAY);
}

const customer = {
  id: customerId,
  name: 'Budi',
  phone: '6281234567890',
  address: 'Jl. Merdeka 1',
  creditLimit: '5000000',
  status: 'ACTIVE' as const,
  note: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-10-01T00:00:00.000Z'),
  deletedAt: null,
};

function transactionRow(overrides: {
  id: string;
  invoiceNo: string;
  paymentStatus: 'UNPAID' | 'PARTIAL' | 'PAID';
  roundedTotal: string;
  paidTotal: string;
  outstandingAmount: string;
  dueDate: Date | null;
  transactionDate: Date;
  items: Array<{
    productName: string;
    qty: number;
    unitPrice: string;
    totalAmount: string;
  }>;
}) {
  return {
    ...overrides,
    customerId,
    status: 'COMPLETED' as const,
    createdAt: overrides.transactionDate,
  };
}

function setup() {
  const prisma = {
    customer: { findFirst: vi.fn() },
    transaction: {
      findMany: vi.fn(),
      aggregate: vi.fn(),
    },
    debtPayment: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
  const service = new DebtsService(prisma as unknown as PrismaService, {} as never);
  return { service, prisma };
}

describe('DebtsService.findCustomerDebts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(asOf);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('menghitung sisa utang, status, dan aging dari transaksi pelanggan', async () => {
    const { service, prisma } = setup();
    prisma.customer.findFirst.mockResolvedValue(customer);
    prisma.transaction.findMany.mockResolvedValue([
      transactionRow({
        id: '33333333-3333-4333-8333-333333333333',
        invoiceNo: 'INV/2026/09/00001',
        paymentStatus: 'PARTIAL',
        roundedTotal: '1000000',
        paidTotal: '700000',
        outstandingAmount: '300000',
        dueDate: daysAgo(40),
        transactionDate: daysAgo(50),
        items: [
          {
            productName: 'Beras Premium',
            qty: 2,
            unitPrice: '500000',
            totalAmount: '1000000',
          },
        ],
      }),
      transactionRow({
        id: '44444444-4444-4444-8444-444444444444',
        invoiceNo: 'INV/2026/10/00002',
        paymentStatus: 'UNPAID',
        roundedTotal: '200000',
        paidTotal: '0',
        outstandingAmount: '200000',
        dueDate: daysAhead(5),
        transactionDate: daysAgo(10),
        items: [
          {
            productName: 'Minyak Goreng',
            qty: 1,
            unitPrice: '200000',
            totalAmount: '200000',
          },
        ],
      }),
      transactionRow({
        id: '66666666-6666-4666-8666-666666666666',
        invoiceNo: 'INV/2026/08/00003',
        paymentStatus: 'PAID',
        roundedTotal: '400000',
        paidTotal: '400000',
        outstandingAmount: '0',
        dueDate: daysAgo(60),
        transactionDate: daysAgo(70),
        items: [
          {
            productName: 'Gula Pasir',
            qty: 2,
            unitPrice: '200000',
            totalAmount: '400000',
          },
        ],
      }),
    ]);
    prisma.transaction.aggregate.mockResolvedValue({
      _count: { _all: 5 },
      _max: { transactionDate: daysAgo(2) },
    });
    prisma.debtPayment.findMany.mockResolvedValue([
      {
        id: '77777777-7777-4777-8777-777777777777',
        amount: '500000',
        method: 'TRANSFER',
        reference: 'TRF-001',
        note: 'Cicilan pertama',
        paidAt: daysAgo(1),
        createdAt: daysAgo(1),
      },
    ]);

    const result = await service.findCustomerDebts(customerId);

    expect(prisma.transaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          customerId,
          status: 'COMPLETED',
          paymentStatus: { in: ['UNPAID', 'PARTIAL', 'PAID'] },
        },
        include: { items: true },
      }),
    );
    expect(prisma.debtPayment.findMany).toHaveBeenCalledWith({
      where: { customerId },
      orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        amount: true,
        method: true,
        reference: true,
        note: true,
        paidAt: true,
      },
    });
    expect(result.customer).toMatchObject({
      id: customerId,
      name: 'Budi',
      creditLimit: 5_000_000,
      balanceDue: 500_000,
      availableCredit: 4_500_000,
      overdueAmount: 300_000,
      overdueDays: 40,
      transactionCount: 5,
      lastTransactionAt: daysAgo(2).toISOString(),
      status: 'ACTIVE',
    });
    expect(result.outstanding).toHaveLength(2);
    expect(result.outstanding[0]).toMatchObject({
      transactionId: '33333333-3333-4333-8333-333333333333',
      invoiceNo: 'INV/2026/09/00001',
      total: 1_000_000,
      paidAmount: 700_000,
      outstandingAmount: 300_000,
      daysOverdue: 40,
      agingBucket: 'd31_60',
      status: 'PARTIAL',
      items: [
        {
          productName: 'Beras Premium',
          qty: 2,
          unitPrice: 500_000,
          totalAmount: 1_000_000,
        },
      ],
    });
    expect(result.outstanding[1]).toMatchObject({
      transactionId: '44444444-4444-4444-8444-444444444444',
      invoiceNo: 'INV/2026/10/00002',
      outstandingAmount: 200_000,
      daysOverdue: 0,
      agingBucket: 'current',
      status: 'UNPAID',
    });
    expect(result.invoices).toHaveLength(3);
    expect(
      result.invoices.find((invoice) => invoice.invoiceNo === 'INV/2026/08/00003'),
    ).toMatchObject({
      transactionId: '66666666-6666-4666-8666-666666666666',
      total: 400_000,
      paidAmount: 400_000,
      outstandingAmount: 0,
      status: 'PAID',
    });
    expect(result.payments).toEqual([
      {
        id: '77777777-7777-4777-8777-777777777777',
        amount: 500_000,
        method: 'TRANSFER',
        reference: 'TRF-001',
        note: 'Cicilan pertama',
        paidAt: daysAgo(1).toISOString(),
      },
    ]);
    expect(result.aging).toEqual({
      current: 200_000,
      d1_30: 0,
      d31_60: 300_000,
      d61_90: 0,
      d90_plus: 0,
    });
  });

  it('mengembalikan 404 saat pelanggan tidak ditemukan', async () => {
    const { service, prisma } = setup();
    prisma.customer.findFirst.mockResolvedValue(null);
    prisma.transaction.findMany.mockResolvedValue([]);
    prisma.transaction.aggregate.mockResolvedValue({
      _count: { _all: 0 },
      _max: { transactionDate: null },
    });

    await expect(service.findCustomerDebts(customerId)).rejects.toBeInstanceOf(NotFoundException);
  });
});
