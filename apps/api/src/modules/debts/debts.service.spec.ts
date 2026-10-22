import { BadRequestException } from '@nestjs/common';
import type { PayDebtInput, PayDebtResult } from '@warung/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../prisma/prisma.service.js';
import { DebtsService } from './debts.service.js';

const customerId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const now = new Date('2026-10-22T10:00:00.000Z');
const paidAt = new Date('2026-10-22T09:00:00.000Z');

const customer = {
  id: customerId,
  name: 'Budi',
  phone: '6281234567890',
  address: null,
  creditLimit: '5000000',
  status: 'ACTIVE' as const,
  note: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-10-01T00:00:00.000Z'),
};

const invoiceA = {
  id: '33333333-3333-4333-8333-333333333333',
  invoiceNo: 'INV/2026/09/00001',
  dueDate: new Date('2020-09-01T00:00:00.000Z'),
  outstandingAmount: '1000000',
  paymentStatus: 'UNPAID' as const,
  transactionDate: new Date('2020-09-01T00:00:00.000Z'),
  createdAt: new Date('2020-09-01T00:00:00.000Z'),
};

const invoiceB = {
  id: '44444444-4444-4444-8444-444444444444',
  invoiceNo: 'INV/2026/09/00002',
  dueDate: new Date('2020-09-15T00:00:00.000Z'),
  outstandingAmount: '500000',
  paymentStatus: 'PARTIAL' as const,
  transactionDate: new Date('2020-09-15T00:00:00.000Z'),
  createdAt: new Date('2020-09-15T00:00:00.000Z'),
};

function paymentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    customerId,
    amount: '1200000',
    method: 'CASH',
    reference: null,
    receivedById: userId,
    note: null,
    paidAt,
    createdAt: now,
    receivedBy: { fullName: 'Kasir Satu' },
    ...overrides,
  };
}

function baseInput(overrides: Partial<PayDebtInput> = {}): PayDebtInput {
  const { note, ...rest } = overrides;
  return {
    customerId,
    amount: 1_200_000,
    method: 'CASH',
    idempotencyKey: 'debt-payment-key-1',
    note: note ?? null,
    ...rest,
  };
}

function setup() {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: customerId }]),
    customer: {
      findFirst: vi.fn().mockResolvedValue(customer),
    },
    transaction: {
      findMany: vi.fn().mockResolvedValue([invoiceA, invoiceB]),
      update: vi.fn().mockResolvedValue({}),
      aggregate: vi.fn().mockResolvedValue({
        _count: { _all: 2 },
        _max: { transactionDate: invoiceB.transactionDate },
      }),
    },
    transactionPayment: {
      create: vi.fn().mockResolvedValue({}),
    },
    debtPayment: {
      create: vi.fn().mockResolvedValue(paymentRow()),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
  };

  const prisma = {
    $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  const idempotency = {
    begin: vi.fn().mockResolvedValue({ requestHash: 'hash-1', replay: null }),
    save: vi.fn().mockResolvedValue(undefined),
  };

  const service = new DebtsService(prisma as unknown as PrismaService, idempotency);

  return { service, tx, prisma, idempotency };
}

describe('DebtsService.pay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('membayar cicilan FIFO dan memperbarui sisa utang serta status secara konsisten', async () => {
    const { service, tx, idempotency } = setup();

    const result = await service.pay(baseInput({ paidAt }), userId);

    expect(result.payment).toMatchObject({
      customerId,
      customerName: 'Budi',
      amount: 1_200_000,
      method: 'CASH',
      balanceBefore: 1_500_000,
      balanceAfter: 300_000,
      receivedById: userId,
      receivedByName: 'Kasir Satu',
      paidAt: paidAt.toISOString(),
    });
    expect(result.payment.allocations).toEqual([
      expect.objectContaining({
        transactionId: invoiceA.id,
        invoiceNo: invoiceA.invoiceNo,
        allocatedAmount: 1_000_000,
        remainingAfter: 0,
        statusBefore: 'UNPAID',
        statusAfter: 'PAID',
      }),
      expect.objectContaining({
        transactionId: invoiceB.id,
        invoiceNo: invoiceB.invoiceNo,
        allocatedAmount: 200_000,
        remainingAfter: 300_000,
        statusBefore: 'PARTIAL',
        statusAfter: 'PARTIAL',
      }),
    ]);
    expect(result.settledInvoiceNos).toEqual([invoiceA.invoiceNo]);
    expect(result.customer.balanceDue).toBe(300_000);
    expect(result.customer.availableCredit).toBe(4_700_000);
    expect(result.customer.overdueAmount).toBe(300_000);

    expect(tx.transaction.update).toHaveBeenNthCalledWith(1, {
      where: { id: invoiceA.id },
      data: {
        paidTotal: { increment: '1000000' },
        outstandingAmount: '0',
        paymentStatus: 'PAID',
      },
    });
    expect(tx.transaction.update).toHaveBeenNthCalledWith(2, {
      where: { id: invoiceB.id },
      data: {
        paidTotal: { increment: '200000' },
        outstandingAmount: '300000',
        paymentStatus: 'PARTIAL',
      },
    });
    expect(tx.transactionPayment.create).toHaveBeenCalledTimes(2);
    expect(tx.debtPayment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          customerId,
          amount: '1200000',
          method: 'CASH',
          receivedById: userId,
          allocations: {
            create: [
              { transactionId: invoiceA.id, amount: '1000000' },
              { transactionId: invoiceB.id, amount: '200000' },
            ],
          },
        }),
      }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'DEBT_PAYMENT',
          entity: 'DEBT_PAYMENT',
          entityId: paymentRow().id,
        }),
      }),
    );
    expect(idempotency.begin).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        scope: 'DEBT_PAYMENT',
        key: 'debt-payment-key-1',
      }),
    );
    expect(idempotency.save).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        scope: 'DEBT_PAYMENT',
        responseStatus: 201,
        responseBody: result,
      }),
    );
  });

  it('menghitung satu hari penuh saat jatuh tempo melewati tengah malam UTC', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-22T00:00:00.000Z'));
    const { service, tx } = setup();
    tx.transaction.findMany.mockResolvedValue([
      {
        ...invoiceA,
        dueDate: new Date('2026-10-21T23:59:59.999Z'),
      },
    ]);
    tx.debtPayment.create.mockResolvedValue(paymentRow({ amount: '100000' }));

    const result = await service.pay(baseInput({ amount: 100_000 }), userId);

    expect(result.customer).toMatchObject({
      overdueAmount: 900_000,
      overdueDays: 1,
    });
  });

  it('tidak menghitung invoice jatuh tempo hari ini sebagai overdue setelah tengah malam', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-22T00:05:00.000Z'));
    const { service, tx } = setup();
    tx.transaction.findMany.mockResolvedValue([
      {
        ...invoiceA,
        dueDate: new Date('2026-10-22T00:00:00.000Z'),
      },
    ]);
    tx.debtPayment.create.mockResolvedValue(paymentRow({ amount: '100000' }));

    const result = await service.pay(baseInput({ amount: 100_000 }), userId);

    expect(result.customer).toMatchObject({
      overdueAmount: 0,
      overdueDays: null,
    });
  });

  it('melunasi satu invoice tepat sebesar sisa utang', async () => {
    const { service, tx } = setup();
    tx.transaction.findMany.mockResolvedValue([invoiceB]);
    tx.debtPayment.create.mockResolvedValue(paymentRow({ amount: '500000' }));

    const result = await service.pay(baseInput({ amount: 500_000 }), userId);

    expect(result.payment.balanceBefore).toBe(500_000);
    expect(result.payment.balanceAfter).toBe(0);
    expect(result.payment.allocations[0]).toMatchObject({
      remainingAfter: 0,
      statusAfter: 'PAID',
    });
    expect(result.settledInvoiceNos).toEqual([invoiceB.invoiceNo]);
    expect(result.customer.balanceDue).toBe(0);
    expect(result.customer.availableCredit).toBe(5_000_000);
    expect(tx.transaction.update).toHaveBeenCalledWith({
      where: { id: invoiceB.id },
      data: {
        paidTotal: { increment: '500000' },
        outstandingAmount: '0',
        paymentStatus: 'PAID',
      },
    });
  });

  it('melunasi seluruh invoice aktif dan mengembalikan limit kredit', async () => {
    const { service, tx } = setup();
    tx.debtPayment.create.mockResolvedValue(paymentRow({ amount: '1500000' }));

    const result = await service.pay(baseInput({ amount: 1_500_000 }), userId);

    expect(result.payment).toMatchObject({
      balanceBefore: 1_500_000,
      balanceAfter: 0,
      allocations: [
        expect.objectContaining({
          transactionId: invoiceA.id,
          allocatedAmount: 1_000_000,
          remainingAfter: 0,
          statusAfter: 'PAID',
        }),
        expect.objectContaining({
          transactionId: invoiceB.id,
          allocatedAmount: 500_000,
          remainingAfter: 0,
          statusAfter: 'PAID',
        }),
      ],
    });
    expect(result.settledInvoiceNos).toEqual([invoiceA.invoiceNo, invoiceB.invoiceNo]);
    expect(result.customer).toMatchObject({
      balanceDue: 0,
      availableCredit: 5_000_000,
      overdueAmount: 0,
    });

    expect(tx.transaction.update).toHaveBeenCalledTimes(2);
    expect(tx.transaction.update).toHaveBeenNthCalledWith(1, {
      where: { id: invoiceA.id },
      data: {
        paidTotal: { increment: '1000000' },
        outstandingAmount: '0',
        paymentStatus: 'PAID',
      },
    });
    expect(tx.transaction.update).toHaveBeenNthCalledWith(2, {
      where: { id: invoiceB.id },
      data: {
        paidTotal: { increment: '500000' },
        outstandingAmount: '0',
        paymentStatus: 'PAID',
      },
    });
    expect(tx.transactionPayment.create).toHaveBeenCalledTimes(2);
    expect(tx.transactionPayment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        transactionId: invoiceA.id,
        method: 'CASH',
        amount: '1000000',
      }),
    });
    expect(tx.transactionPayment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        transactionId: invoiceB.id,
        method: 'CASH',
        amount: '500000',
      }),
    });
  });

  it('menghormati alokasi eksplisit tanpa memakai FIFO', async () => {
    const { service, tx } = setup();

    const result = await service.pay(
      baseInput({
        amount: 200_000,
        allocations: [{ transactionId: invoiceB.id, amount: 200_000 }],
      }),
      userId,
    );

    expect(result.payment.balanceBefore).toBe(1_500_000);
    expect(result.payment.balanceAfter).toBe(1_300_000);
    expect(result.payment.allocations).toEqual([
      expect.objectContaining({
        transactionId: invoiceB.id,
        allocatedAmount: 200_000,
        remainingAfter: 300_000,
        statusAfter: 'PARTIAL',
      }),
    ]);
    expect(result.settledInvoiceNos).toEqual([]);
    expect(tx.transaction.update).toHaveBeenCalledTimes(1);
    expect(tx.transaction.update).toHaveBeenCalledWith({
      where: { id: invoiceB.id },
      data: {
        paidTotal: { increment: '200000' },
        outstandingAmount: '300000',
        paymentStatus: 'PARTIAL',
      },
    });
  });

  it('menolak pembayaran melebihi total utang', async () => {
    const { service, tx } = setup();

    const error = await service
      .pay(baseInput({ amount: 1_500_001 }), userId)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toMatchObject({
      code: 'OVERPAYMENT',
      details: {
        amount: ['1500001'],
        outstandingAmount: ['1500000'],
      },
    });
    expect(tx.transaction.update).not.toHaveBeenCalled();
    expect(tx.transactionPayment.create).not.toHaveBeenCalled();
    expect(tx.debtPayment.create).not.toHaveBeenCalled();
  });

  it('menolak alokasi duplikat sebelum mengubah data', async () => {
    const { service, tx } = setup();

    const error = await service
      .pay(
        baseInput({
          amount: 200_000,
          allocations: [
            { transactionId: invoiceA.id, amount: 100_000 },
            { transactionId: invoiceA.id, amount: 100_000 },
          ],
        }),
        userId,
      )
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toMatchObject({
      code: 'DUPLICATE_ALLOCATION',
    });
    expect(tx.transaction.update).not.toHaveBeenCalled();
    expect(tx.debtPayment.create).not.toHaveBeenCalled();
  });

  it('menolak alokasi ke transaksi yang bukan utang aktif pelanggan', async () => {
    const { service, tx } = setup();

    const error = await service
      .pay(
        baseInput({
          amount: 200_000,
          allocations: [{ transactionId: '99999999-9999-4999-8999-999999999999', amount: 200_000 }],
        }),
        userId,
      )
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toMatchObject({
      code: 'ALLOCATION_NOT_FOUND',
    });
    expect(tx.debtPayment.create).not.toHaveBeenCalled();
  });

  it('menolak alokasi yang melebihi sisa utang invoice', async () => {
    const { service, tx } = setup();

    const error = await service
      .pay(
        baseInput({
          amount: 1_100_000,
          allocations: [{ transactionId: invoiceA.id, amount: 1_100_000 }],
        }),
        userId,
      )
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toMatchObject({
      code: 'ALLOCATION_EXCEEDS_OUTSTANDING',
    });
    expect(tx.transaction.update).not.toHaveBeenCalled();
  });

  it('menolak pembayaran saat tidak ada utang aktif', async () => {
    const { service, tx } = setup();
    tx.transaction.findMany.mockResolvedValue([]);

    const error = await service
      .pay(baseInput({ amount: 100_000 }), userId)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toMatchObject({
      code: 'NO_OUTSTANDING_DEBT',
    });
  });

  it('menolak metode non-tunai tanpa referensi sebelum membuka transaksi', async () => {
    const { service, tx, idempotency } = setup();

    const error = await service
      .pay(baseInput({ method: 'TRANSFER' }), userId)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toMatchObject({
      code: 'PAYMENT_REFERENCE_REQUIRED',
    });
    expect(idempotency.begin).not.toHaveBeenCalled();
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('mengembalikan replay idempotensi tanpa menulis ulang pembayaran', async () => {
    const { service, tx, idempotency } = setup();
    const replay = { payment: { id: 'replay-payment' } } as unknown as PayDebtResult;
    idempotency.begin.mockResolvedValue({
      requestHash: 'hash-1',
      replay: { status: 201, body: replay },
    });

    const result = await service.pay(baseInput(), userId);

    expect(result).toBe(replay);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.debtPayment.create).not.toHaveBeenCalled();
    expect(idempotency.save).not.toHaveBeenCalled();
  });
});
