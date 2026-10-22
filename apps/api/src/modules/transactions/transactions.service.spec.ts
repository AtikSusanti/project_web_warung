import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { transactionQuerySchema } from '@warung/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../prisma/prisma.service.js';
import type { DocumentSequenceService } from '../orders/document-sequence.service.js';
import type { StockService } from '../stock/services/stock.service.js';
import type { CreateTransactionDto } from './dto/create-transaction.dto.js';
import { TransactionsService } from './transactions.service.js';

const now = new Date('2026-10-21T08:00:00.000Z');

const products = [
  {
    id: 'product-1',
    sku: 'SNK-001',
    name: 'Indomie',
    unit: 'PACK',
    priceBuy: '2800',
    priceSell: '3500',
    stockQty: 10,
  },
  {
    id: 'product-2',
    sku: 'MIN-002',
    name: 'Teh',
    unit: 'PCS',
    priceBuy: '3500',
    priceSell: '5000',
    stockQty: 5,
  },
];

const settings = {
  id: 1,
  taxBps: 0,
  taxInclusive: true,
  enableCashRounding: false,
  cashRoundingStepSen: 10000,
  maxTransactionDiscountBps: 3000,
};

const transactionRow = {
  id: 'tx-1',
  invoiceNo: 'INV/2026/10/00001',
  status: 'COMPLETED',
  paymentStatus: 'PAID',
  cashierId: 'user-1',
  customerId: null,
  shiftId: null,
  subtotal: '1200000',
  lineDiscountTotal: '0',
  transactionDiscountAmount: '0',
  discountTotal: '0',
  taxableBase: '1200000',
  taxTotal: '0',
  grandTotal: '1200000',
  roundedTotal: '1200000',
  roundingAdjustment: '0',
  paidTotal: '2000000',
  changeAmount: '800000',
  outstandingAmount: '0',
  transactionDiscountBps: 0,
  taxBps: 0,
  taxInclusive: true,
  dueDate: null,
  note: 'Tes',
  transactionDate: now,
  voidedAt: null,
  voidedById: null,
  voidReason: null,
  createdAt: now,
  updatedAt: now,
  items: [
    {
      id: 'item-1',
      transactionId: 'tx-1',
      productId: 'product-1',
      productName: 'Indomie',
      sku: 'SNK-001',
      unit: 'PACK',
      qty: 2,
      unitPrice: '350000',
      grossAmount: '700000',
      lineDiscountAmount: '0',
      transactionDiscountAmount: '0',
      discountAmount: '0',
      netAmount: '700000',
      taxAmount: '0',
      totalAmount: '700000',
      lineDiscountBps: 0,
      costPriceSnapshot: '280000',
    },
    {
      id: 'item-2',
      transactionId: 'tx-1',
      productId: 'product-2',
      productName: 'Teh',
      sku: 'MIN-002',
      unit: 'PCS',
      qty: 1,
      unitPrice: '500000',
      grossAmount: '500000',
      lineDiscountAmount: '0',
      transactionDiscountAmount: '0',
      discountAmount: '0',
      netAmount: '500000',
      taxAmount: '0',
      totalAmount: '500000',
      lineDiscountBps: 0,
      costPriceSnapshot: '350000',
    },
  ],
  payments: [
    {
      id: 'payment-1',
      transactionId: 'tx-1',
      method: 'CASH',
      amount: '2000000',
      reference: null,
      paidAt: now,
    },
  ],
  cashier: { fullName: 'Kasir Satu' },
  customer: null,
};

const customerId = '11111111-1111-4111-8111-111111111111';
const dueDate = '2026-11-21T00:00:00.000Z';

function debtTransactionRow(overrides: Record<string, unknown> = {}) {
  return {
    ...transactionRow,
    paymentStatus: 'PARTIAL',
    customerId,
    dueDate: new Date(dueDate),
    paidTotal: '200000',
    changeAmount: '0',
    outstandingAmount: '1000000',
    payments: [
      {
        id: 'payment-1',
        transactionId: 'tx-1',
        method: 'CASH',
        amount: '200000',
        reference: null,
        paidAt: now,
      },
      {
        id: 'payment-2',
        transactionId: 'tx-1',
        method: 'DEBT',
        amount: '1000000',
        reference: 'CREDIT',
        paidAt: now,
      },
    ],
    customer: { name: 'Budi', phone: '6281234567890' },
    ...overrides,
  };
}

const dto: CreateTransactionDto = {
  lines: [
    { productId: 'product-1', qty: 2 },
    { productId: 'product-2', qty: 1 },
  ],
  payments: [{ method: 'CASH', amount: 2_000_000 }],
  note: 'Tes',
  idempotencyKey: 'pos-key-12345678',
  expectedTotal: 1_200_000,
};

function setup() {
  const tx = {
    product: { findMany: vi.fn().mockResolvedValue(products) },
    setting: { findUnique: vi.fn().mockResolvedValue(settings) },
    customer: { findFirst: vi.fn().mockResolvedValue(null) },
    transaction: {
      create: vi.fn().mockResolvedValue(transactionRow),
      aggregate: vi.fn().mockResolvedValue({ _sum: { outstandingAmount: null } }),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    $queryRaw: vi.fn().mockResolvedValue([{ id: customerId }]),
  };

  const prisma = {
    $transaction: vi.fn(async (arg: unknown) => {
      if (typeof arg === 'function') {
        return (arg as (client: typeof tx) => unknown)(tx);
      }
      return Promise.all(arg as Promise<unknown>[]);
    }),
    transaction: {
      count: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
  };

  const idempotency = { begin: vi.fn(), save: vi.fn() };
  idempotency.begin.mockResolvedValue({ requestHash: 'hash-1', replay: null });
  idempotency.save.mockResolvedValue(undefined);

  const docSeq = {
    nextNumber: vi.fn().mockResolvedValue('INV/2026/10/00001'),
  };

  const stock = {
    applyBatchInTransaction: vi.fn().mockResolvedValue(undefined),
  };

  const service = new TransactionsService(
    prisma as unknown as PrismaService,
    idempotency,
    docSeq as unknown as DocumentSequenceService,
    stock as unknown as StockService,
  );

  return { service, tx, prisma, idempotency, docSeq, stock };
}

describe('TransactionsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('membuat transaksi tunai dengan harga dari database dan pembayaran kembali', async () => {
    const { service, tx, idempotency, docSeq, stock } = setup();

    const result = await service.create(dto, 'user-1');

    expect(result).toEqual(
      expect.objectContaining({
        id: 'tx-1',
        invoiceNo: 'INV/2026/10/00001',
        status: 'COMPLETED',
        paymentStatus: 'PAID',
        subtotal: 1_200_000,
        roundedTotal: 1_200_000,
        paidTotal: 2_000_000,
        changeAmount: 800_000,
        cashierName: 'Kasir Satu',
        clientTotalMismatch: false,
      }),
    );
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0]).toEqual(
      expect.objectContaining({ productId: 'product-1', unitPrice: 350_000 }),
    );
    expect(result.payments[0]).toEqual(
      expect.objectContaining({ method: 'CASH', amount: 2_000_000 }),
    );

    expect(tx.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          invoiceNo: 'INV/2026/10/00001',
          subtotal: '1200000',
          paidTotal: '2000000',
          changeAmount: '800000',
          items: {
            create: expect.arrayContaining([
              expect.objectContaining({ productId: 'product-1', unitPrice: '350000' }),
              expect.objectContaining({ productId: 'product-2', unitPrice: '500000' }),
            ]),
          },
          payments: {
            create: [expect.objectContaining({ method: 'CASH', amount: '2000000' })],
          },
        }),
      }),
    );
    expect(stock.applyBatchInTransaction).toHaveBeenCalledWith(
      tx,
      expect.arrayContaining([
        expect.objectContaining({
          productId: 'product-1',
          qtyDelta: -2,
          type: 'SALE',
          refType: 'TRANSACTION',
          refId: 'tx-1',
        }),
        expect.objectContaining({
          productId: 'product-2',
          qtyDelta: -1,
          type: 'SALE',
          refType: 'TRANSACTION',
          refId: 'tx-1',
        }),
      ]),
    );
    expect(docSeq.nextNumber).toHaveBeenCalledWith('INVOICE', expect.any(Date), tx);
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'CREATE',
        entity: 'TRANSACTION',
        entityId: 'tx-1',
      }),
    });
    expect(idempotency.save).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        scope: 'POS_TRANSACTION',
        key: 'pos-key-12345678',
        responseStatus: 201,
      }),
    );
  });

  it('menolak transaksi jika stok produk tidak cukup', async () => {
    const { service, tx, idempotency, stock } = setup();
    tx.product.findMany.mockResolvedValue([{ ...products[0], stockQty: 1 }, products[1]]);

    const error = await service.create(dto, 'user-1').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toMatchObject({
      code: 'INSUFFICIENT_STOCK',
    });
    expect(tx.transaction.create).not.toHaveBeenCalled();
    expect(stock.applyBatchInTransaction).not.toHaveBeenCalled();
    expect(idempotency.save).not.toHaveBeenCalled();
  });

  it('menolak pembayaran tunai yang kurang dari total transaksi', async () => {
    const { service, tx, idempotency, stock } = setup();

    const error = await service
      .create({ ...dto, payments: [{ method: 'CASH', amount: 1_000_000 }] }, 'user-1')
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toMatchObject({
      code: 'PAYMENT_SHORTFALL',
    });
    expect(tx.transaction.create).not.toHaveBeenCalled();
    expect(stock.applyBatchInTransaction).not.toHaveBeenCalled();
    expect(idempotency.save).not.toHaveBeenCalled();
  });

  it('menolak shortfall walau pelanggan tersedia jika DEBT tidak eksplisit', async () => {
    const { service, tx, idempotency, stock } = setup();
    tx.customer.findFirst.mockResolvedValue({
      status: 'ACTIVE',
      creditLimit: '5000000',
    });

    const error = await service
      .create(
        {
          ...dto,
          customerId,
          payments: [{ method: 'CASH', amount: 1_000_000 }],
        },
        'user-1',
      )
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toMatchObject({
      code: 'PAYMENT_SHORTFALL',
    });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.customer.findFirst).not.toHaveBeenCalled();
    expect(tx.transaction.create).not.toHaveBeenCalled();
    expect(stock.applyBatchInTransaction).not.toHaveBeenCalled();
    expect(idempotency.save).not.toHaveBeenCalled();
  });

  it('menolak nominal DEBT yang tidak sama dengan shortfall', async () => {
    const { service, tx, idempotency, stock } = setup();
    tx.customer.findFirst.mockResolvedValue({
      status: 'ACTIVE',
      creditLimit: '5000000',
    });

    const error = await service
      .create(
        {
          ...dto,
          customerId,
          payments: [
            { method: 'CASH', amount: 200_000 },
            { method: 'DEBT', amount: 900_000 },
          ],
        },
        'user-1',
      )
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toMatchObject({
      code: 'DEBT_AMOUNT_MISMATCH',
      details: {
        declaredDebt: ['900000'],
        outstandingAmount: ['1000000'],
      },
    });
    expect(tx.transaction.create).not.toHaveBeenCalled();
    expect(stock.applyBatchInTransaction).not.toHaveBeenCalled();
    expect(idempotency.save).not.toHaveBeenCalled();
  });

  it('membuat transaksi DP dengan sisa utang dan mengecek limit pelanggan', async () => {
    const { service, tx, idempotency, docSeq, stock } = setup();
    tx.customer.findFirst.mockResolvedValue({
      status: 'ACTIVE',
      creditLimit: '5000000',
    });
    tx.transaction.aggregate.mockResolvedValue({
      _sum: { outstandingAmount: '500000' },
    });
    tx.transaction.create.mockResolvedValueOnce(debtTransactionRow());

    const result = await service.create(
      {
        ...dto,
        customerId,
        dueDate,
        payments: [
          { method: 'CASH', amount: 200_000 },
          { method: 'DEBT', amount: 1_000_000 },
        ],
      },
      'user-1',
    );

    expect(result).toEqual(
      expect.objectContaining({
        paymentStatus: 'PARTIAL',
        paidTotal: 200_000,
        outstandingAmount: 1_000_000,
        customerId,
        customerName: 'Budi',
        dueDate: new Date(dueDate).toISOString(),
      }),
    );
    expect(result.paidTotal + result.outstandingAmount).toBe(result.roundedTotal);
    expect(stock.applyBatchInTransaction).toHaveBeenCalledTimes(1);
    expect(tx.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          paymentStatus: 'PARTIAL',
          customerId,
          dueDate: new Date(dueDate),
          paidTotal: '200000',
          changeAmount: '0',
          outstandingAmount: '1000000',
          payments: {
            create: [
              expect.objectContaining({ method: 'CASH', amount: '200000' }),
              expect.objectContaining({
                method: 'DEBT',
                amount: '1000000',
                reference: 'CREDIT',
              }),
            ],
          },
        }),
      }),
    );
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.transaction.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          customerId,
          status: 'COMPLETED',
          paymentStatus: { in: ['UNPAID', 'PARTIAL'] },
        },
      }),
    );
    expect(idempotency.begin.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        payload: expect.objectContaining({ customerId, dueDate }),
      }),
    );
    expect(docSeq.nextNumber).toHaveBeenCalled();
    expect(stock.applyBatchInTransaction).toHaveBeenCalled();
    expect(idempotency.save).toHaveBeenCalled();
  });

  it('membuat transaksi utang murni dengan status UNPAID', async () => {
    const { service, tx } = setup();
    tx.customer.findFirst.mockResolvedValue({
      status: 'ACTIVE',
      creditLimit: '0',
    });
    tx.transaction.create.mockResolvedValueOnce(
      debtTransactionRow({
        paymentStatus: 'UNPAID',
        paidTotal: '0',
        outstandingAmount: '1200000',
        payments: [
          {
            id: 'payment-1',
            transactionId: 'tx-1',
            method: 'DEBT',
            amount: '1200000',
            reference: 'CREDIT',
            paidAt: now,
          },
        ],
      }),
    );

    const result = await service.create(
      {
        ...dto,
        customerId,
        dueDate,
        payments: [{ method: 'DEBT', amount: 1_200_000 }],
      },
      'user-1',
    );

    expect(result).toEqual(
      expect.objectContaining({
        paymentStatus: 'UNPAID',
        paidTotal: 0,
        outstandingAmount: 1_200_000,
      }),
    );
    expect(tx.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          paymentStatus: 'UNPAID',
          customerId,
          paidTotal: '0',
          outstandingAmount: '1200000',
          payments: {
            create: [
              expect.objectContaining({
                method: 'DEBT',
                amount: '1200000',
                reference: 'CREDIT',
              }),
            ],
          },
        }),
      }),
    );
  });

  it('menolak transaksi utang yang melebihi limit kredit pelanggan', async () => {
    const { service, tx, idempotency, docSeq, stock } = setup();
    tx.customer.findFirst.mockResolvedValue({
      status: 'ACTIVE',
      creditLimit: '1500000',
    });
    tx.transaction.aggregate.mockResolvedValue({
      _sum: { outstandingAmount: '1000000' },
    });

    const error = await service
      .create(
        {
          ...dto,
          customerId,
          dueDate,
          payments: [
            { method: 'CASH', amount: 200_000 },
            { method: 'DEBT', amount: 1_000_000 },
          ],
        },
        'user-1',
      )
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toMatchObject({
      code: 'CREDIT_LIMIT_EXCEEDED',
      details: {
        creditLimit: ['1500000'],
        currentDebt: ['1000000'],
        newDebt: ['1000000'],
        availableCredit: ['500000'],
      },
    });
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.transaction.create).not.toHaveBeenCalled();
    expect(docSeq.nextNumber).not.toHaveBeenCalled();
    expect(stock.applyBatchInTransaction).not.toHaveBeenCalled();
    expect(idempotency.save).not.toHaveBeenCalled();
  });

  it('menolak pembayaran utang tanpa pelanggan sebelum memulai idempotensi', async () => {
    const { service, tx, idempotency } = setup();

    const error = await service
      .create(
        {
          ...dto,
          payments: [{ method: 'DEBT', amount: 1_200_000 }],
        },
        'user-1',
      )
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toMatchObject({
      code: 'CUSTOMER_REQUIRED',
    });
    expect(idempotency.begin).not.toHaveBeenCalled();
    expect(tx.transaction.create).not.toHaveBeenCalled();
  });

  it('menolak total yang berbeda tanpa mengambil nomor invoice atau menulis data', async () => {
    const { service, tx, idempotency, docSeq, stock } = setup();

    const error = await service
      .create({ ...dto, expectedTotal: 1_100_000 }, 'user-1')
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getStatus()).toBe(409);
    expect((error as ConflictException).getResponse()).toMatchObject({
      code: 'TOTAL_MISMATCH',
      details: {
        expectedTotal: ['1100000'],
        subtotal: ['1200000'],
        discountTotal: ['0'],
        taxTotal: ['0'],
        grandTotal: ['1200000'],
        roundedTotal: ['1200000'],
      },
    });
    expect(docSeq.nextNumber).not.toHaveBeenCalled();
    expect(tx.transaction.create).not.toHaveBeenCalled();
    expect(stock.applyBatchInTransaction).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(idempotency.save).not.toHaveBeenCalled();
  });

  it('mengizinkan retry dengan idempotency key yang sama setelah total diperbarui', async () => {
    const { service, idempotency } = setup();

    await expect(
      service.create({ ...dto, expectedTotal: 1_100_000 }, 'user-1'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(idempotency.save).not.toHaveBeenCalled();

    const result = await service.create({ ...dto, expectedTotal: 1_200_000 }, 'user-1');

    expect(result).toEqual(expect.objectContaining({ id: 'tx-1', roundedTotal: 1_200_000 }));
    expect(idempotency.begin).toHaveBeenCalledTimes(2);
    expect(idempotency.save).toHaveBeenCalledTimes(1);
  });

  it('meneruskan IDEMPOTENCY_MISMATCH tanpa membaca produk atau menulis data', async () => {
    const { service, tx, idempotency, docSeq, stock } = setup();
    idempotency.begin.mockRejectedValueOnce(
      new ConflictException({
        code: 'IDEMPOTENCY_MISMATCH',
        message: 'Idempotency key sudah dipakai dengan payload berbeda',
      }),
    );

    const error = await service.create(dto, 'user-1').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getStatus()).toBe(409);
    expect((error as ConflictException).getResponse()).toMatchObject({
      code: 'IDEMPOTENCY_MISMATCH',
    });
    expect(tx.product.findMany).not.toHaveBeenCalled();
    expect(docSeq.nextNumber).not.toHaveBeenCalled();
    expect(tx.transaction.create).not.toHaveBeenCalled();
    expect(stock.applyBatchInTransaction).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(idempotency.save).not.toHaveBeenCalled();
  });

  it('mengembalikan respons tersimpan saat idempotency key diulang tanpa menulis ulang data', async () => {
    const { service, tx, idempotency, stock } = setup();
    const replayBody = {
      id: 'tx-replay',
      invoiceNo: 'INV/2026/10/00001',
      status: 'COMPLETED',
      paymentStatus: 'PAID',
    };
    idempotency.begin.mockResolvedValueOnce({
      requestHash: 'hash-1',
      replay: { body: replayBody },
    });

    const result = await service.create(dto, 'user-1');

    expect(result).toEqual(replayBody);
    expect(tx.product.findMany).not.toHaveBeenCalled();
    expect(tx.transaction.create).not.toHaveBeenCalled();
    expect(stock.applyBatchInTransaction).not.toHaveBeenCalled();
    expect(idempotency.save).not.toHaveBeenCalled();
  });

  it('tidak menyimpan idempotency ketika penulisan transaksi gagal', async () => {
    const { service, tx, idempotency, stock } = setup();
    stock.applyBatchInTransaction.mockRejectedValueOnce(new Error('gagal update stok'));

    await expect(service.create(dto, 'user-1')).rejects.toThrow('gagal update stok');

    expect(tx.transaction.create).toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(idempotency.save).not.toHaveBeenCalled();
  });

  it('mengembalikan daftar transaksi dengan envelope sukses dan pagination', async () => {
    const { service, prisma } = setup();
    prisma.transaction.count.mockResolvedValue(1);
    prisma.transaction.findMany.mockResolvedValue([transactionRow]);

    const result = await service.findAll(transactionQuerySchema.parse({}));

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toEqual(
      expect.objectContaining({
        id: 'tx-1',
        itemCount: 2,
        productNames: ['Indomie', 'Teh'],
      }),
    );
    expect(result.data[0]).not.toHaveProperty('lines');
    expect(result.data[0]).not.toHaveProperty('payments');
    expect(result.meta).toEqual({
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1,
      hasNext: false,
      hasPrev: false,
    });
    expect(prisma.transaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'COMPLETED' },
        skip: 0,
        take: 20,
      }),
    );
  });

  it('mengembalikan detail transaksi dan error 404 jika tidak ditemukan', async () => {
    const { service, prisma } = setup();
    prisma.transaction.findUnique.mockResolvedValueOnce(transactionRow);

    const result = await service.findOne('tx-1');
    expect(result).toEqual(expect.objectContaining({ id: 'tx-1', subtotal: 1_200_000 }));

    prisma.transaction.findUnique.mockResolvedValueOnce(null);
    await expect(service.findOne('tx-missing')).rejects.toThrow(NotFoundException);
  });
});
