import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  type AgingQuery,
  type AgingReport,
  buildPaginationMeta,
  type CustomerDebtDetail,
  type PayDebtInput,
  type PayDebtResult,
  type PaymentStatus,
  type ReceivableCustomer,
  type ReceivableCustomerQuery,
  sen,
} from '@warung/shared';

import { PrismaService } from '../../prisma/prisma.service.js';
import { IdempotencyService } from '../idempotency/idempotency.service.js';

const DEBT_PAYMENT_SCOPE = 'DEBT_PAYMENT';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const AGING_BUCKETS = [
  { key: 'current', label: 'Belum jatuh tempo' },
  { key: 'd1_30', label: '1-30 hari' },
  { key: 'd31_60', label: '31-60 hari' },
  { key: 'd61_90', label: '61-90 hari' },
  { key: 'd90_plus', label: 'Lebih dari 90 hari' },
] as const;

type AgingBucketKey = (typeof AGING_BUCKETS)[number]['key'];

type MoneyValue = { toString(): string } | string | number;

type OutstandingTransaction = {
  id: string;
  invoiceNo: string;
  dueDate: Date | null;
  outstandingAmount: MoneyValue;
  paymentStatus: PaymentStatus;
  transactionDate: Date;
  createdAt: Date;
};

type PlannedAllocation = {
  transactionId: string;
  invoiceNo: string;
  dueDate: Date | null;
  allocatedAmount: ReturnType<typeof sen>;
  remainingAfter: ReturnType<typeof sen>;
  statusBefore: PaymentStatus;
  statusAfter: 'PAID' | 'PARTIAL';
};

type CustomerStats = {
  _count: { _all: number };
  _max: { transactionDate: Date | null };
};

const customerSelect = {
  id: true,
  name: true,
  phone: true,
  address: true,
  creditLimit: true,
  status: true,
  note: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CustomerSelect;

type LockedCustomer = Prisma.CustomerGetPayload<{ select: typeof customerSelect }>;

const receivableCustomerSelect = {
  id: true,
  name: true,
  phone: true,
  status: true,
  creditLimit: true,
} satisfies Prisma.CustomerSelect;

type ReceivableCustomerRow = Prisma.CustomerGetPayload<{
  select: typeof receivableCustomerSelect;
}>;

type ReceivableAggregate = {
  customer: ReceivableCustomerRow;
  balanceDue: ReturnType<typeof sen>;
  overdueAmount: ReturnType<typeof sen>;
  oldestDueDate: Date | null;
  invoiceCount: number;
  unpaidInvoiceCount: number;
  partialInvoiceCount: number;
  lastTransactionAt: Date | null;
};

const agingCustomerSelect = {
  id: true,
  name: true,
  phone: true,
} satisfies Prisma.CustomerSelect;

type AgingCustomerAggregate = {
  customerId: string;
  customerName: string;
  customerPhone: string;
  balanceDue: ReturnType<typeof sen>;
  oldestDays: number;
};

type BucketAggregate = {
  amount: ReturnType<typeof sen>;
  invoiceCount: number;
  customerIds: Set<string>;
};

function amountOf(value: MoneyValue): ReturnType<typeof sen> {
  return sen(Math.round(Number(value.toString())));
}

@Injectable()
export class DebtsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
  ) {}

  async pay(dto: PayDebtInput, userId: string): Promise<PayDebtResult> {
    if (dto.method !== 'CASH' && !dto.reference) {
      throw new BadRequestException({
        code: 'PAYMENT_REFERENCE_REQUIRED',
        message: 'Referensi pembayaran wajib diisi untuk metode non-tunai',
      });
    }

    if (dto.note && dto.note.length > 500) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'Catatan pembayaran maksimal 500 karakter',
      });
    }

    const amount = sen(dto.amount);
    if (amount <= 0) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'Nominal pembayaran harus lebih besar dari nol',
      });
    }

    const paidAt = dto.paidAt ?? new Date();
    const payload = {
      customerId: dto.customerId,
      amount,
      method: dto.method,
      reference: dto.reference ?? null,
      allocations: dto.allocations ?? null,
      paidAt: paidAt.toISOString(),
      note: dto.note ?? null,
      receivedById: userId,
    };

    return this.prisma.$transaction(async (tx) => {
      const idempotency = await this.idempotency.begin(tx, {
        scope: DEBT_PAYMENT_SCOPE,
        key: dto.idempotencyKey,
        payload,
      });

      if (idempotency.replay) {
        return idempotency.replay.body as unknown as PayDebtResult;
      }

      const customer = await this.lockCustomer(tx, dto.customerId);
      const outstanding = await this.lockOutstandingTransactions(tx, dto.customerId);
      const balanceBefore = outstanding.reduce<ReturnType<typeof sen>>(
        (total, transaction) => sen(total + amountOf(transaction.outstandingAmount)),
        sen(0),
      );

      if (balanceBefore === 0) {
        throw new BadRequestException({
          code: 'NO_OUTSTANDING_DEBT',
          message: 'Pelanggan tidak memiliki utang yang belum dibayar',
        });
      }

      if (amount > balanceBefore) {
        throw new BadRequestException({
          code: 'OVERPAYMENT',
          message: `Nominal pembayaran melebihi sisa utang ${balanceBefore} sen`,
          details: {
            amount: [String(amount)],
            outstandingAmount: [String(balanceBefore)],
          },
        });
      }

      const planned = this.allocate(dto, outstanding, amount);
      const remainingById = new Map(
        outstanding.map((transaction) => [transaction.id, amountOf(transaction.outstandingAmount)]),
      );
      for (const allocation of planned) {
        remainingById.set(allocation.transactionId, allocation.remainingAfter);
      }
      const balanceAfter = sen(
        [...remainingById.values()].reduce((total, value) => total + value, 0),
      );

      const payment = await this.createPayment(tx, dto, userId, paidAt, amount, planned);
      await this.applyAllocations(tx, dto, paidAt, planned);

      const stats = await tx.transaction.aggregate({
        _count: { _all: true },
        _max: { transactionDate: true },
        where: { customerId: dto.customerId, status: 'COMPLETED' },
      });

      const settledInvoiceNos = planned
        .filter((allocation) => allocation.statusAfter === 'PAID')
        .map((allocation) => allocation.invoiceNo);

      const result: PayDebtResult = {
        payment: {
          id: payment.id,
          customerId: dto.customerId,
          customerName: customer.name,
          amount,
          method: dto.method,
          reference: payment.reference,
          receivedById: payment.receivedById,
          receivedByName: payment.receivedBy?.fullName ?? null,
          allocations: planned.map((allocation) => ({
            transactionId: allocation.transactionId,
            invoiceNo: allocation.invoiceNo,
            dueDate: allocation.dueDate?.toISOString() ?? null,
            allocatedAmount: allocation.allocatedAmount,
            remainingAfter: allocation.remainingAfter,
            statusBefore: allocation.statusBefore,
            statusAfter: allocation.statusAfter,
          })),
          balanceBefore,
          balanceAfter,
          note: payment.note,
          paidAt: payment.paidAt.toISOString(),
          createdAt: payment.createdAt.toISOString(),
        },
        customer: this.toCustomerDto(
          customer,
          outstanding,
          planned,
          balanceAfter,
          stats,
          new Date(),
        ),
        settledInvoiceNos,
      };

      await tx.auditLog.create({
        data: {
          userId,
          action: 'DEBT_PAYMENT',
          entity: 'DEBT_PAYMENT',
          entityId: payment.id,
          newValue: {
            customerId: dto.customerId,
            amount,
            method: dto.method,
            balanceBefore,
            balanceAfter,
            settledInvoiceNos,
            allocations: planned.map((allocation) => ({
              transactionId: allocation.transactionId,
              invoiceNo: allocation.invoiceNo,
              amount: allocation.allocatedAmount,
              remainingAfter: allocation.remainingAfter,
            })),
          },
        },
      });

      await this.idempotency.save(tx, {
        scope: DEBT_PAYMENT_SCOPE,
        key: dto.idempotencyKey,
        requestHash: idempotency.requestHash,
        responseStatus: 201,
        responseBody: result,
        userId,
      });

      return result;
    });
  }

  async findReceivables(query: ReceivableCustomerQuery) {
    const where: Prisma.TransactionWhereInput = {
      status: 'COMPLETED',
      paymentStatus: { in: ['UNPAID', 'PARTIAL'] },
      customerId: { not: null },
    };

    if (query.search) {
      where.customer = {
        is: {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { phone: { contains: query.search } },
          ],
        },
      };
    }

    const transactions = await this.prisma.transaction.findMany({
      where,
      select: {
        customerId: true,
        outstandingAmount: true,
        paymentStatus: true,
        dueDate: true,
        transactionDate: true,
        customer: { select: receivableCustomerSelect },
      },
    });

    const now = new Date();
    const byCustomer = new Map<string, ReceivableAggregate>();

    for (const transaction of transactions) {
      if (!transaction.customerId || !transaction.customer) continue;

      let aggregate = byCustomer.get(transaction.customerId);
      if (!aggregate) {
        aggregate = {
          customer: transaction.customer,
          balanceDue: sen(0),
          overdueAmount: sen(0),
          oldestDueDate: null,
          invoiceCount: 0,
          unpaidInvoiceCount: 0,
          partialInvoiceCount: 0,
          lastTransactionAt: null,
        };
        byCustomer.set(transaction.customerId, aggregate);
      }

      const outstandingAmount = amountOf(transaction.outstandingAmount);
      aggregate.balanceDue = sen(aggregate.balanceDue + outstandingAmount);
      aggregate.invoiceCount += 1;
      if (transaction.paymentStatus === 'UNPAID') {
        aggregate.unpaidInvoiceCount += 1;
      } else {
        aggregate.partialInvoiceCount += 1;
      }
      if (transaction.dueDate) {
        if (!aggregate.oldestDueDate || transaction.dueDate < aggregate.oldestDueDate) {
          aggregate.oldestDueDate = transaction.dueDate;
        }
        if (this.daysOverdue(transaction.dueDate, now) > 0) {
          aggregate.overdueAmount = sen(aggregate.overdueAmount + outstandingAmount);
        }
      }
      if (
        !aggregate.lastTransactionAt ||
        transaction.transactionDate > aggregate.lastTransactionAt
      ) {
        aggregate.lastTransactionAt = transaction.transactionDate;
      }
    }

    const data = [...byCustomer.values()]
      .map((aggregate): ReceivableCustomer => {
        const creditLimit = amountOf(aggregate.customer.creditLimit);
        return {
          customerId: aggregate.customer.id,
          customerName: aggregate.customer.name,
          customerPhone: aggregate.customer.phone,
          customerStatus: aggregate.customer.status,
          creditLimit,
          balanceDue: aggregate.balanceDue,
          availableCredit:
            creditLimit > 0 ? sen(Math.max(0, creditLimit - aggregate.balanceDue)) : sen(0),
          overdueAmount: aggregate.overdueAmount,
          oldestDueDate: aggregate.oldestDueDate?.toISOString() ?? null,
          overdueDays: aggregate.oldestDueDate
            ? this.daysOverdue(aggregate.oldestDueDate, now)
            : null,
          invoiceCount: aggregate.invoiceCount,
          unpaidInvoiceCount: aggregate.unpaidInvoiceCount,
          partialInvoiceCount: aggregate.partialInvoiceCount,
          paymentStatus: aggregate.partialInvoiceCount > 0 ? 'PARTIAL' : 'UNPAID',
          lastTransactionAt: aggregate.lastTransactionAt?.toISOString() ?? null,
        };
      })
      .sort((a, b) => b.balanceDue - a.balanceDue || a.customerName.localeCompare(b.customerName));

    const start = (query.page - 1) * query.pageSize;
    return {
      success: true as const,
      data: data.slice(start, start + query.pageSize),
      meta: buildPaginationMeta(data.length, query.page, query.pageSize),
    };
  }

  async findCustomerDebts(customerId: string): Promise<CustomerDebtDetail> {
    const now = new Date();
    const [customer, transactions, stats, payments] = await Promise.all([
      this.prisma.customer.findFirst({
        where: { id: customerId, deletedAt: null },
      }),
      this.prisma.transaction.findMany({
        where: {
          customerId,
          status: 'COMPLETED',
          paymentStatus: { in: ['UNPAID', 'PARTIAL', 'PAID'] },
        },
        include: { items: true },
        orderBy: [{ transactionDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.transaction.aggregate({
        _count: { _all: true },
        _max: { transactionDate: true },
        where: { customerId, status: 'COMPLETED' },
      }),
      this.prisma.debtPayment.findMany({
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
      }),
    ]);

    if (!customer) {
      throw new NotFoundException({
        code: 'CUSTOMER_NOT_FOUND',
        message: 'Pelanggan tidak ditemukan',
      });
    }

    let balanceDue = sen(0);
    let overdueAmount = sen(0);
    let oldestOverdueDate: Date | null = null;
    const aging = {
      current: sen(0),
      d1_30: sen(0),
      d31_60: sen(0),
      d61_90: sen(0),
      d90_plus: sen(0),
    };

    const invoices = transactions.map((transaction) => {
      const outstandingAmount = amountOf(transaction.outstandingAmount);
      const daysOverdue = this.daysOverdue(transaction.dueDate, now);
      const bucket = this.agingBucket(transaction.dueDate, now);

      if (outstandingAmount > 0) {
        balanceDue = sen(balanceDue + outstandingAmount);
        aging[bucket] = sen(aging[bucket] + outstandingAmount);
        if (daysOverdue > 0) {
          overdueAmount = sen(overdueAmount + outstandingAmount);
          if (
            !oldestOverdueDate ||
            (transaction.dueDate && transaction.dueDate < oldestOverdueDate)
          ) {
            oldestOverdueDate = transaction.dueDate;
          }
        }
      }

      return {
        transactionId: transaction.id,
        invoiceNo: transaction.invoiceNo,
        total: amountOf(transaction.roundedTotal),
        paidAmount: amountOf(transaction.paidTotal),
        outstandingAmount,
        transactionDate: transaction.transactionDate.toISOString(),
        dueDate: transaction.dueDate?.toISOString() ?? null,
        daysOverdue,
        agingBucket: bucket,
        status:
          transaction.paymentStatus === 'PAID'
            ? ('PAID' as const)
            : transaction.paymentStatus === 'PARTIAL'
              ? ('PARTIAL' as const)
              : ('UNPAID' as const),
        items: transaction.items.map((item) => ({
          productName: item.productName,
          qty: item.qty,
          unitPrice: amountOf(item.unitPrice),
          totalAmount: amountOf(item.totalAmount),
        })),
      };
    });

    const creditLimit = amountOf(customer.creditLimit);
    return {
      customer: {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        address: customer.address,
        creditLimit,
        balanceDue,
        availableCredit: creditLimit > 0 ? sen(Math.max(0, creditLimit - balanceDue)) : sen(0),
        overdueAmount,
        overdueDays: oldestOverdueDate ? this.daysOverdue(oldestOverdueDate, now) : null,
        transactionCount: stats._count._all,
        lastTransactionAt: stats._max.transactionDate?.toISOString() ?? null,
        status: customer.status,
        note: customer.note,
        createdAt: customer.createdAt.toISOString(),
        updatedAt: customer.updatedAt.toISOString(),
      },
      outstanding: invoices.filter((invoice) => invoice.outstandingAmount > 0),
      invoices,
      payments: payments.map((payment) => ({
        id: payment.id,
        amount: amountOf(payment.amount),
        method: payment.method as 'CASH' | 'TRANSFER' | 'QRIS',
        reference: payment.reference,
        note: payment.note,
        paidAt: payment.paidAt.toISOString(),
      })),
      aging,
    };
  }

  async agingReport(query: AgingQuery) {
    const asOf = query.asOf ?? new Date();
    const transactions = await this.prisma.transaction.findMany({
      where: {
        status: 'COMPLETED',
        paymentStatus: { in: ['UNPAID', 'PARTIAL'] },
        customerId: { not: null },
        transactionDate: { lte: asOf },
      },
      select: {
        customerId: true,
        outstandingAmount: true,
        dueDate: true,
        customer: { select: agingCustomerSelect },
      },
    });

    const buckets = new Map<AgingBucketKey, BucketAggregate>(
      AGING_BUCKETS.map((bucket) => [
        bucket.key,
        { amount: sen(0), invoiceCount: 0, customerIds: new Set<string>() },
      ]),
    );
    const byCustomer = new Map<string, AgingCustomerAggregate>();
    let total = sen(0);

    for (const transaction of transactions) {
      if (!transaction.customerId || !transaction.customer) continue;

      const outstandingAmount = amountOf(transaction.outstandingAmount);
      const bucket = buckets.get(this.agingBucket(transaction.dueDate, asOf));
      if (bucket) {
        bucket.amount = sen(bucket.amount + outstandingAmount);
        bucket.invoiceCount += 1;
        bucket.customerIds.add(transaction.customerId);
      }
      total = sen(total + outstandingAmount);

      let debtor = byCustomer.get(transaction.customerId);
      if (!debtor) {
        debtor = {
          customerId: transaction.customerId,
          customerName: transaction.customer.name,
          customerPhone: transaction.customer.phone,
          balanceDue: sen(0),
          oldestDays: 0,
        };
        byCustomer.set(transaction.customerId, debtor);
      }
      debtor.balanceDue = sen(debtor.balanceDue + outstandingAmount);
      debtor.oldestDays = Math.max(debtor.oldestDays, this.daysOverdue(transaction.dueDate, asOf));
    }

    const topDebtors = [...byCustomer.values()].sort(
      (a, b) => b.balanceDue - a.balanceDue || a.customerName.localeCompare(b.customerName),
    );
    const start = (query.page - 1) * query.pageSize;
    const data: AgingReport = {
      asOf: asOf.toISOString(),
      buckets: AGING_BUCKETS.map(({ key, label }) => {
        const bucket = buckets.get(key)!;
        return {
          key,
          label,
          amount: bucket.amount,
          invoiceCount: bucket.invoiceCount,
          customerCount: bucket.customerIds.size,
        };
      }),
      total,
      topDebtors: topDebtors.slice(start, start + query.pageSize),
    };

    return {
      success: true as const,
      data,
      meta: buildPaginationMeta(topDebtors.length, query.page, query.pageSize),
    };
  }

  private agingBucket(dueDate: Date | null, asOf: Date): AgingBucketKey {
    const days = this.daysOverdue(dueDate, asOf);
    if (days <= 0) return 'current';
    if (days <= 30) return 'd1_30';
    if (days <= 60) return 'd31_60';
    if (days <= 90) return 'd61_90';
    return 'd90_plus';
  }

  private daysOverdue(dueDate: Date | null, asOf: Date): number {
    if (!dueDate) return 0;

    const dueDay = Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate());
    const asOfDay = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate());
    return Math.max(0, Math.floor((asOfDay - dueDay) / MS_PER_DAY));
  }

  private async lockCustomer(
    tx: Prisma.TransactionClient,
    customerId: string,
  ): Promise<LockedCustomer> {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "customers"
      WHERE "id" = ${customerId}::uuid AND "deletedAt" IS NULL
      FOR UPDATE
    `;
    if (locked.length === 0) {
      throw new NotFoundException({
        code: 'CUSTOMER_NOT_FOUND',
        message: 'Pelanggan tidak ditemukan',
      });
    }

    const customer = await tx.customer.findFirst({
      where: { id: customerId, deletedAt: null },
      select: customerSelect,
    });
    if (!customer) {
      throw new NotFoundException({
        code: 'CUSTOMER_NOT_FOUND',
        message: 'Pelanggan tidak ditemukan',
      });
    }
    return customer;
  }

  private async lockOutstandingTransactions(
    tx: Prisma.TransactionClient,
    customerId: string,
  ): Promise<OutstandingTransaction[]> {
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "transactions"
      WHERE "customerId" = ${customerId}::uuid
        AND "status" = 'COMPLETED'
        AND "paymentStatus" IN ('UNPAID', 'PARTIAL')
      ORDER BY "transactionDate" ASC, "createdAt" ASC, "id" ASC
      FOR UPDATE
    `;

    return tx.transaction.findMany({
      where: {
        customerId,
        status: 'COMPLETED',
        paymentStatus: { in: ['UNPAID', 'PARTIAL'] },
      },
      select: {
        id: true,
        invoiceNo: true,
        dueDate: true,
        outstandingAmount: true,
        paymentStatus: true,
        transactionDate: true,
        createdAt: true,
      },
      orderBy: [{ transactionDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  private allocate(
    dto: PayDebtInput,
    outstanding: OutstandingTransaction[],
    amount: ReturnType<typeof sen>,
  ): PlannedAllocation[] {
    const byId = new Map(outstanding.map((transaction) => [transaction.id, transaction]));
    const planned: PlannedAllocation[] = [];

    if (dto.allocations && dto.allocations.length > 0) {
      const seen = new Set<string>();
      let allocatedTotal = 0;

      for (const item of dto.allocations) {
        if (seen.has(item.transactionId)) {
          throw new BadRequestException({
            code: 'DUPLICATE_ALLOCATION',
            message: 'Satu transaksi tidak boleh dialokasikan lebih dari sekali',
            details: { transactionId: [item.transactionId] },
          });
        }
        seen.add(item.transactionId);

        const transaction = byId.get(item.transactionId);
        if (!transaction) {
          throw new BadRequestException({
            code: 'ALLOCATION_NOT_FOUND',
            message: 'Transaksi alokasi bukan utang aktif pelanggan',
            details: { transactionId: [item.transactionId] },
          });
        }

        const allocatedAmount = sen(item.amount);
        if (allocatedAmount <= 0) {
          throw new BadRequestException({
            code: 'VALIDATION_FAILED',
            message: 'Nominal alokasi harus lebih besar dari nol',
          });
        }

        const outstandingAmount = amountOf(transaction.outstandingAmount);
        if (allocatedAmount > outstandingAmount) {
          throw new BadRequestException({
            code: 'ALLOCATION_EXCEEDS_OUTSTANDING',
            message: 'Nominal alokasi melebihi sisa utang transaksi',
            details: {
              transactionId: [item.transactionId],
              allocatedAmount: [String(allocatedAmount)],
              outstandingAmount: [String(outstandingAmount)],
            },
          });
        }

        planned.push(this.plan(transaction, allocatedAmount));
        allocatedTotal += allocatedAmount;
      }

      if (allocatedTotal !== amount) {
        throw new BadRequestException({
          code: 'ALLOCATION_MISMATCH',
          message: 'Jumlah alokasi harus sama dengan nominal pembayaran',
          details: {
            allocatedTotal: [String(allocatedTotal)],
            amount: [String(amount)],
          },
        });
      }

      return planned;
    }

    let remaining = amount;
    for (const transaction of outstanding) {
      if (remaining === 0) break;

      const outstandingAmount = amountOf(transaction.outstandingAmount);
      const allocatedAmount = sen(Math.min(remaining, outstandingAmount));
      if (allocatedAmount > 0) {
        planned.push(this.plan(transaction, allocatedAmount));
        remaining = sen(remaining - allocatedAmount);
      }
    }

    if (remaining > 0) {
      throw new BadRequestException({
        code: 'OVERPAYMENT',
        message: `Nominal pembayaran melebihi sisa utang ${remaining} sen`,
      });
    }

    return planned;
  }

  private plan(
    transaction: OutstandingTransaction,
    allocatedAmount: ReturnType<typeof sen>,
  ): PlannedAllocation {
    const remainingAfter = sen(amountOf(transaction.outstandingAmount) - allocatedAmount);
    return {
      transactionId: transaction.id,
      invoiceNo: transaction.invoiceNo,
      dueDate: transaction.dueDate,
      allocatedAmount,
      remainingAfter,
      statusBefore: transaction.paymentStatus,
      statusAfter: remainingAfter === 0 ? 'PAID' : 'PARTIAL',
    };
  }

  private async createPayment(
    tx: Prisma.TransactionClient,
    dto: PayDebtInput,
    userId: string,
    paidAt: Date,
    amount: ReturnType<typeof sen>,
    planned: PlannedAllocation[],
  ) {
    return tx.debtPayment.create({
      data: {
        customerId: dto.customerId,
        amount: amount.toString(),
        method: dto.method,
        reference: dto.reference ?? null,
        receivedById: userId,
        note: dto.note ?? null,
        paidAt,
        allocations: {
          create: planned.map((allocation) => ({
            transactionId: allocation.transactionId,
            amount: allocation.allocatedAmount.toString(),
          })),
        },
      },
      include: { receivedBy: { select: { fullName: true } } },
    });
  }

  private async applyAllocations(
    tx: Prisma.TransactionClient,
    dto: PayDebtInput,
    paidAt: Date,
    planned: PlannedAllocation[],
  ): Promise<void> {
    for (const allocation of planned) {
      await tx.transaction.update({
        where: { id: allocation.transactionId },
        data: {
          paidTotal: { increment: allocation.allocatedAmount.toString() },
          outstandingAmount: allocation.remainingAfter.toString(),
          paymentStatus: allocation.statusAfter,
        },
      });

      await tx.transactionPayment.create({
        data: {
          transactionId: allocation.transactionId,
          method: dto.method,
          amount: allocation.allocatedAmount.toString(),
          reference: dto.reference ?? null,
          paidAt,
        },
      });
    }
  }

  private toCustomerDto(
    customer: LockedCustomer,
    outstanding: OutstandingTransaction[],
    planned: PlannedAllocation[],
    balanceAfter: ReturnType<typeof sen>,
    stats: CustomerStats,
    now: Date,
  ): PayDebtResult['customer'] {
    const remainingById = new Map(
      outstanding.map((transaction) => [transaction.id, amountOf(transaction.outstandingAmount)]),
    );
    for (const allocation of planned) {
      remainingById.set(allocation.transactionId, allocation.remainingAfter);
    }

    let overdueAmount = sen(0);
    let oldestDueDate: Date | null = null;
    for (const transaction of outstanding) {
      const remaining = remainingById.get(transaction.id) ?? sen(0);
      if (remaining > 0 && this.daysOverdue(transaction.dueDate, now) > 0) {
        overdueAmount = sen(overdueAmount + remaining);
        if (!oldestDueDate || (transaction.dueDate && transaction.dueDate < oldestDueDate)) {
          oldestDueDate = transaction.dueDate;
        }
      }
    }

    const creditLimit = amountOf(customer.creditLimit);
    const overdueDays = oldestDueDate ? this.daysOverdue(oldestDueDate, now) : null;

    return {
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      address: customer.address,
      creditLimit,
      balanceDue: balanceAfter,
      availableCredit: creditLimit > 0 ? sen(Math.max(0, creditLimit - balanceAfter)) : sen(0),
      overdueAmount,
      overdueDays,
      transactionCount: stats._count._all,
      lastTransactionAt: stats._max.transactionDate?.toISOString() ?? null,
      status: customer.status,
      note: customer.note,
      createdAt: customer.createdAt.toISOString(),
      updatedAt: customer.updatedAt.toISOString(),
    };
  }
}
