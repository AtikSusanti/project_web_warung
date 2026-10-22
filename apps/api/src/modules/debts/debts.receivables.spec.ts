import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../prisma/prisma.service.js';
import { DebtsService } from './debts.service.js';

const asOf = new Date('2026-10-22T10:00:00.000Z');
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const customerA = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Budi',
  phone: '6281234567890',
  status: 'ACTIVE' as const,
  creditLimit: '5000000',
};

const customerB = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Sari',
  phone: '6281234567891',
  status: 'ACTIVE' as const,
  creditLimit: '0',
};

const customerC = {
  id: '33333333-3333-4333-8333-333333333333',
  name: 'Andi',
  phone: '6281234567892',
  status: 'BLOCKED' as const,
  creditLimit: '1000000',
};

function daysAgo(days: number): Date {
  return new Date(asOf.getTime() - days * MS_PER_DAY);
}

function daysAhead(days: number): Date {
  return new Date(asOf.getTime() + days * MS_PER_DAY);
}

function receivableRow(overrides: {
  customer: typeof customerA | typeof customerB | typeof customerC;
  outstandingAmount: string;
  paymentStatus: 'UNPAID' | 'PARTIAL';
  dueDate: Date | null;
  transactionDate: Date;
}) {
  return {
    customerId: overrides.customer.id,
    outstandingAmount: overrides.outstandingAmount,
    paymentStatus: overrides.paymentStatus,
    dueDate: overrides.dueDate,
    transactionDate: overrides.transactionDate,
    customer: overrides.customer,
  };
}

function setup() {
  const transaction = {
    findMany: vi.fn(),
  };
  const prisma = { transaction };
  const service = new DebtsService(prisma as unknown as PrismaService, {} as never);
  return { service, transaction };
}

describe('DebtsService.findReceivables', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(asOf);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('menghitung sisa utang dan status pembayaran dari transaksi aktual', async () => {
    const { service, transaction } = setup();
    transaction.findMany.mockResolvedValue([
      receivableRow({
        customer: customerA,
        outstandingAmount: '300000',
        paymentStatus: 'PARTIAL',
        dueDate: daysAgo(40),
        transactionDate: daysAgo(50),
      }),
      receivableRow({
        customer: customerA,
        outstandingAmount: '200000',
        paymentStatus: 'UNPAID',
        dueDate: daysAhead(5),
        transactionDate: daysAgo(10),
      }),
      receivableRow({
        customer: customerB,
        outstandingAmount: '100000',
        paymentStatus: 'UNPAID',
        dueDate: daysAgo(10),
        transactionDate: daysAgo(15),
      }),
      receivableRow({
        customer: customerC,
        outstandingAmount: '50000',
        paymentStatus: 'UNPAID',
        dueDate: null,
        transactionDate: daysAgo(1),
      }),
    ]);

    const result = await service.findReceivables({ page: 1, pageSize: 20 });

    expect(transaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'COMPLETED',
          paymentStatus: { in: ['UNPAID', 'PARTIAL'] },
          customerId: { not: null },
        }),
      }),
    );
    expect(result.meta).toMatchObject({ total: 3, page: 1, pageSize: 20 });
    expect(result.data).toHaveLength(3);
    expect(result.data[0]).toMatchObject({
      customerId: customerA.id,
      customerName: 'Budi',
      customerStatus: 'ACTIVE',
      creditLimit: 5_000_000,
      balanceDue: 500_000,
      availableCredit: 4_500_000,
      overdueAmount: 300_000,
      overdueDays: 40,
      invoiceCount: 2,
      unpaidInvoiceCount: 1,
      partialInvoiceCount: 1,
      paymentStatus: 'PARTIAL',
    });
    expect(result.data[0]!.oldestDueDate).toBe(daysAgo(40).toISOString());
    expect(result.data[0]!.lastTransactionAt).toBe(daysAgo(10).toISOString());
    expect(result.data[1]).toMatchObject({
      customerId: customerB.id,
      balanceDue: 100_000,
      overdueAmount: 100_000,
      overdueDays: 10,
      paymentStatus: 'UNPAID',
    });
    expect(result.data[2]).toMatchObject({
      customerId: customerC.id,
      balanceDue: 50_000,
      overdueAmount: 0,
      overdueDays: null,
      oldestDueDate: null,
      paymentStatus: 'UNPAID',
    });
  });

  it('memfilter pencarian berdasarkan nama atau telepon pelanggan', async () => {
    const { service, transaction } = setup();
    transaction.findMany.mockResolvedValue([]);

    await service.findReceivables({ page: 1, pageSize: 20, search: 'sari' });

    expect(transaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          customer: {
            is: {
              OR: [
                { name: { contains: 'sari', mode: 'insensitive' } },
                { phone: { contains: 'sari' } },
              ],
            },
          },
        }),
      }),
    );
  });

  it('membagi daftar per pelanggan menggunakan pagination', async () => {
    const { service, transaction } = setup();
    transaction.findMany.mockResolvedValue([
      receivableRow({
        customer: customerA,
        outstandingAmount: '500000',
        paymentStatus: 'UNPAID',
        dueDate: daysAgo(1),
        transactionDate: daysAgo(5),
      }),
      receivableRow({
        customer: customerB,
        outstandingAmount: '100000',
        paymentStatus: 'UNPAID',
        dueDate: daysAgo(1),
        transactionDate: daysAgo(5),
      }),
    ]);

    const result = await service.findReceivables({ page: 2, pageSize: 1 });

    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.customerId).toBe(customerB.id);
    expect(result.meta).toMatchObject({
      page: 2,
      pageSize: 1,
      total: 2,
      totalPages: 2,
      hasNext: false,
      hasPrev: true,
    });
  });
});

describe('DebtsService.agingReport', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(asOf);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('mengelompokkan piutang berdasarkan jatuh tempo dan menghitung totalnya', async () => {
    const { service, transaction } = setup();
    transaction.findMany.mockResolvedValue([
      receivableRow({
        customer: customerA,
        outstandingAmount: '100000',
        paymentStatus: 'UNPAID',
        dueDate: daysAhead(5),
        transactionDate: daysAgo(20),
      }),
      receivableRow({
        customer: customerA,
        outstandingAmount: '200000',
        paymentStatus: 'UNPAID',
        dueDate: daysAgo(10),
        transactionDate: daysAgo(20),
      }),
      receivableRow({
        customer: customerB,
        outstandingAmount: '50000',
        paymentStatus: 'UNPAID',
        dueDate: null,
        transactionDate: daysAgo(20),
      }),
      receivableRow({
        customer: customerB,
        outstandingAmount: '300000',
        paymentStatus: 'UNPAID',
        dueDate: daysAgo(45),
        transactionDate: daysAgo(60),
      }),
      receivableRow({
        customer: customerC,
        outstandingAmount: '400000',
        paymentStatus: 'UNPAID',
        dueDate: daysAgo(75),
        transactionDate: daysAgo(100),
      }),
      receivableRow({
        customer: customerC,
        outstandingAmount: '500000',
        paymentStatus: 'UNPAID',
        dueDate: daysAgo(120),
        transactionDate: daysAgo(150),
      }),
    ]);

    const result = await service.agingReport({
      asOf,
      page: 1,
      pageSize: 10,
    });

    expect(transaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'COMPLETED',
          paymentStatus: { in: ['UNPAID', 'PARTIAL'] },
          transactionDate: { lte: asOf },
        }),
      }),
    );
    expect(result.data.asOf).toBe(asOf.toISOString());
    expect(result.data.total).toBe(1_550_000);
    expect(result.data.buckets).toEqual([
      {
        key: 'current',
        label: 'Belum jatuh tempo',
        amount: 150_000,
        invoiceCount: 2,
        customerCount: 2,
      },
      {
        key: 'd1_30',
        label: '1-30 hari',
        amount: 200_000,
        invoiceCount: 1,
        customerCount: 1,
      },
      {
        key: 'd31_60',
        label: '31-60 hari',
        amount: 300_000,
        invoiceCount: 1,
        customerCount: 1,
      },
      {
        key: 'd61_90',
        label: '61-90 hari',
        amount: 400_000,
        invoiceCount: 1,
        customerCount: 1,
      },
      {
        key: 'd90_plus',
        label: 'Lebih dari 90 hari',
        amount: 500_000,
        invoiceCount: 1,
        customerCount: 1,
      },
    ]);
    expect(result.data.topDebtors).toEqual([
      {
        customerId: customerC.id,
        customerName: 'Andi',
        customerPhone: customerC.phone,
        balanceDue: 900_000,
        oldestDays: 120,
      },
      {
        customerId: customerB.id,
        customerName: 'Sari',
        customerPhone: customerB.phone,
        balanceDue: 350_000,
        oldestDays: 45,
      },
      {
        customerId: customerA.id,
        customerName: 'Budi',
        customerPhone: customerA.phone,
        balanceDue: 300_000,
        oldestDays: 10,
      },
    ]);
    expect(result.meta).toMatchObject({ total: 3, page: 1, pageSize: 10 });
  });

  it('menggunakan batas kategori umur yang tepat', async () => {
    const { service, transaction } = setup();
    const ages = [0, 1, 30, 31, 60, 61, 90, 91];
    transaction.findMany.mockResolvedValue(
      ages.map((days) =>
        receivableRow({
          customer: customerA,
          outstandingAmount: '100000',
          paymentStatus: 'UNPAID',
          dueDate: daysAgo(days),
          transactionDate: daysAgo(200),
        }),
      ),
    );

    const result = await service.agingReport({
      asOf,
      page: 1,
      pageSize: 20,
    });

    expect(result.data.buckets.map((bucket) => [bucket.key, bucket.amount])).toEqual([
      ['current', 100_000],
      ['d1_30', 200_000],
      ['d31_60', 200_000],
      ['d61_90', 200_000],
      ['d90_plus', 100_000],
    ]);
    expect(result.data.total).toBe(800_000);
  });

  it('membagi topDebtors menggunakan pagination', async () => {
    const { service, transaction } = setup();
    transaction.findMany.mockResolvedValue([
      receivableRow({
        customer: customerA,
        outstandingAmount: '500000',
        paymentStatus: 'UNPAID',
        dueDate: daysAgo(5),
        transactionDate: daysAgo(10),
      }),
      receivableRow({
        customer: customerB,
        outstandingAmount: '300000',
        paymentStatus: 'UNPAID',
        dueDate: daysAgo(5),
        transactionDate: daysAgo(10),
      }),
      receivableRow({
        customer: customerC,
        outstandingAmount: '100000',
        paymentStatus: 'UNPAID',
        dueDate: daysAgo(5),
        transactionDate: daysAgo(10),
      }),
    ]);

    const result = await service.agingReport({
      asOf,
      page: 2,
      pageSize: 2,
    });

    expect(result.data.topDebtors).toHaveLength(1);
    expect(result.data.topDebtors[0]!.customerId).toBe(customerC.id);
    expect(result.meta).toMatchObject({
      page: 2,
      pageSize: 2,
      total: 3,
      totalPages: 2,
      hasNext: false,
      hasPrev: true,
    });
  });
});
