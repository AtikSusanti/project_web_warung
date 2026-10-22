import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  buildPaginationMeta,
  calculateCart,
  CartCalculationError,
  type CartLineInput,
  decimalToSen,
  DEFAULT_CASH_ROUNDING_STEP,
  DEFAULT_PRICES_INCLUDE_TAX,
  DEFAULT_TAX_BASIS_POINTS,
  MAX_TRANSACTION_DISCOUNT_BPS,
  sen,
  settlePayments,
  type TransactionDto,
  type TransactionQuery,
} from '@warung/shared';

import { PrismaService } from '../../prisma/prisma.service.js';
import { IdempotencyService } from '../idempotency/idempotency.service.js';
import { DocumentSequenceService } from '../orders/document-sequence.service.js';
import { StockService } from '../stock/services/stock.service.js';
import type { CreateTransactionDto } from './dto/create-transaction.dto.js';

const POS_TRANSACTION_SCOPE = 'POS_TRANSACTION';
const DEFAULT_DEBT_DUE_DAYS = 30;

const transactionInclude = {
  items: true,
  payments: true,
  cashier: { select: { fullName: true } },
  customer: { select: { name: true, phone: true } },
} satisfies Prisma.TransactionInclude;

type TransactionWithRelations = Prisma.TransactionGetPayload<{
  include: typeof transactionInclude;
}>;

@Injectable()
export class TransactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly docSeq: DocumentSequenceService,
    private readonly stock: StockService,
  ) {}

  async create(dto: CreateTransactionDto, userId: string): Promise<TransactionDto> {
    this.validateInput(dto);
    const payload = this.idempotencyPayload(dto);

    return this.prisma.$transaction(async (tx) => {
      const idempotency = await this.idempotency.begin(tx, {
        scope: POS_TRANSACTION_SCOPE,
        key: dto.idempotencyKey,
        payload,
      });

      if (idempotency.replay) {
        return idempotency.replay.body as unknown as TransactionDto;
      }

      const now = new Date();
      const productIds = [...new Set(dto.lines.map((line) => line.productId))];
      const products = await tx.product.findMany({
        where: {
          id: { in: productIds },
          deletedAt: null,
          isActive: true,
        },
        select: {
          id: true,
          sku: true,
          name: true,
          unit: true,
          priceBuy: true,
          priceSell: true,
          stockQty: true,
        },
      });
      const productMap = new Map(products.map((product) => [product.id, product]));

      const missing = productIds.filter((id) => !productMap.has(id));
      if (missing.length > 0) {
        throw new BadRequestException({
          code: 'VALIDATION_FAILED',
          message: `Produk tidak ditemukan atau tidak aktif: ${missing.join(', ')}`,
        });
      }

      for (const line of dto.lines) {
        const product = productMap.get(line.productId);
        if (!product) continue;
        if (line.qty > product.stockQty) {
          throw new BadRequestException({
            code: 'INSUFFICIENT_STOCK',
            message: `Stok ${product.name} tidak cukup (tersedia ${product.stockQty}, diminta ${line.qty})`,
          });
        }
      }

      const settings = await tx.setting.findUnique({ where: { id: 1 } });
      const maxTransactionDiscountBps = Math.max(
        0,
        Math.min(
          settings?.maxTransactionDiscountBps ?? MAX_TRANSACTION_DISCOUNT_BPS,
          MAX_TRANSACTION_DISCOUNT_BPS,
        ),
      );
      if ((dto.discountBps ?? 0) > maxTransactionDiscountBps) {
        throw new BadRequestException({
          code: 'VALIDATION_FAILED',
          message: `Diskon transaksi melebihi batas ${maxTransactionDiscountBps} basis point`,
        });
      }

      const cartLines: CartLineInput[] = dto.lines.map((line) => {
        const product = productMap.get(line.productId)!;
        return {
          productId: product.id,
          sku: product.sku,
          name: product.name,
          qty: line.qty,
          unitPrice: decimalToSen(product.priceSell),
          discountBps: line.discountBps,
        };
      });

      const calculated = this.calculate(cartLines, {
        transactionDiscountBps: dto.discountBps ?? 0,
        taxBps: settings?.taxBps ?? DEFAULT_TAX_BASIS_POINTS,
        pricesIncludeTax: settings?.taxInclusive ?? DEFAULT_PRICES_INCLUDE_TAX,
        cashRounding: settings?.enableCashRounding ?? false,
        cashRoundingStep:
          settings?.cashRoundingStepSen && settings.cashRoundingStepSen > 0
            ? settings.cashRoundingStepSen
            : DEFAULT_CASH_ROUNDING_STEP,
      });

      const clientTotalMismatch =
        dto.expectedTotal !== undefined && dto.expectedTotal !== calculated.roundedTotal;
      if (clientTotalMismatch) {
        throw new ConflictException({
          code: 'TOTAL_MISMATCH',
          message: 'Total transaksi berubah. Konfirmasi ulang total terbaru.',
          details: {
            expectedTotal: [String(dto.expectedTotal)],
            subtotal: [String(calculated.subtotal)],
            lineDiscountTotal: [String(calculated.lineDiscountTotal)],
            transactionDiscountAmount: [String(calculated.transactionDiscountAmount)],
            discountTotal: [String(calculated.discountTotal)],
            taxableBase: [String(calculated.taxableBase)],
            taxTotal: [String(calculated.taxTotal)],
            grandTotal: [String(calculated.grandTotal)],
            roundedTotal: [String(calculated.roundedTotal)],
            roundingAdjustment: [String(calculated.roundingAdjustment)],
          },
        });
      }

      const tenderedPayments = dto.payments.filter((payment) => payment.method !== 'DEBT');
      const settled = this.settle(
        calculated.roundedTotal,
        tenderedPayments.map((payment) => ({
          method: payment.method,
          amount: sen(payment.amount),
        })),
      );
      const declaredDebt = dto.payments
        .filter((payment) => payment.method === 'DEBT')
        .reduce((total, payment) => total + sen(payment.amount), 0);
      const debtAmount = settled.shortfall;

      if (debtAmount > 0 && declaredDebt === 0) {
        throw new BadRequestException({
          code: 'PAYMENT_SHORTFALL',
          message: `Pembayaran kurang ${debtAmount} sen; utang harus dicatat dengan metode DEBT`,
        });
      }
      if (debtAmount > 0 && !dto.customerId) {
        throw new BadRequestException({
          code: 'CUSTOMER_REQUIRED',
          message: 'Transaksi utang wajib memilih pelanggan',
        });
      }
      if (declaredDebt !== debtAmount) {
        throw new BadRequestException({
          code: 'DEBT_AMOUNT_MISMATCH',
          message: 'Nominal pembayaran utang harus sama dengan sisa tagihan',
          details: {
            declaredDebt: [String(declaredDebt)],
            outstandingAmount: [String(debtAmount)],
          },
        });
      }

      let customer: {
        status: string;
        creditLimit: { toString(): string };
      } | null = null;
      if (dto.customerId) {
        if (debtAmount > 0) {
          const locked = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT "id" FROM "customers"
            WHERE "id" = ${dto.customerId}::uuid AND "deletedAt" IS NULL
            FOR UPDATE
          `;
          if (locked.length === 0) {
            throw new BadRequestException({
              code: 'CUSTOMER_NOT_FOUND',
              message: 'Pelanggan tidak ditemukan',
            });
          }
        }

        customer = await tx.customer.findFirst({
          where: { id: dto.customerId, deletedAt: null },
          select: { status: true, creditLimit: true },
        });
        if (!customer) {
          throw new BadRequestException({
            code: 'CUSTOMER_NOT_FOUND',
            message: 'Pelanggan tidak ditemukan',
          });
        }
        if (debtAmount > 0 && customer.status !== 'ACTIVE') {
          throw new BadRequestException({
            code: 'CUSTOMER_BLOCKED',
            message: 'Pelanggan diblokir dan tidak boleh berutang',
          });
        }
      }

      if (debtAmount > 0 && customer) {
        const debtAggregate = await tx.transaction.aggregate({
          _sum: { outstandingAmount: true },
          where: {
            customerId: dto.customerId,
            status: 'COMPLETED',
            paymentStatus: { in: ['UNPAID', 'PARTIAL'] },
          },
        });
        const currentDebt = Math.round(
          Number(debtAggregate._sum.outstandingAmount?.toString() ?? 0),
        );
        const creditLimit = Math.round(Number(customer.creditLimit.toString()));
        const availableCredit = Math.max(0, creditLimit - currentDebt);
        if (creditLimit > 0 && currentDebt + debtAmount > creditLimit) {
          throw new BadRequestException({
            code: 'CREDIT_LIMIT_EXCEEDED',
            message: `Limit kredit pelanggan tidak cukup (tersedia ${availableCredit} sen, dibutuhkan ${debtAmount} sen)`,
            details: {
              creditLimit: [String(creditLimit)],
              currentDebt: [String(currentDebt)],
              newDebt: [String(debtAmount)],
              availableCredit: [String(availableCredit)],
            },
          });
        }
      }

      const dueDate =
        debtAmount > 0
          ? dto.dueDate
            ? new Date(dto.dueDate)
            : new Date(now.getTime() + DEFAULT_DEBT_DUE_DAYS * 24 * 60 * 60 * 1000)
          : null;
      const debtReference =
        dto.payments.find((payment) => payment.method === 'DEBT' && payment.reference)?.reference ??
        'CREDIT';
      const storedPayments = [
        ...tenderedPayments.map((payment) => ({
          method: payment.method,
          amount: sen(payment.amount),
          reference: payment.reference ?? null,
        })),
        ...(debtAmount > 0
          ? [
              {
                method: 'DEBT' as const,
                amount: debtAmount,
                reference: debtReference,
              },
            ]
          : []),
      ];
      const paymentStatus =
        debtAmount === 0 ? 'PAID' : settled.paidTotal === 0 ? 'UNPAID' : 'PARTIAL';

      const invoiceNo = await this.docSeq.nextNumber('INVOICE', now, tx);
      const lineDiscountBps = new Map(
        dto.lines.map((line) => [line.productId, line.discountBps ?? 0]),
      );

      const created = await tx.transaction.create({
        data: {
          invoiceNo,
          status: 'COMPLETED',
          paymentStatus,
          cashierId: userId,
          customerId: dto.customerId ?? null,
          dueDate,
          subtotal: calculated.subtotal.toString(),
          lineDiscountTotal: calculated.lineDiscountTotal.toString(),
          transactionDiscountAmount: calculated.transactionDiscountAmount.toString(),
          discountTotal: calculated.discountTotal.toString(),
          taxableBase: calculated.taxableBase.toString(),
          taxTotal: calculated.taxTotal.toString(),
          grandTotal: calculated.grandTotal.toString(),
          roundedTotal: calculated.roundedTotal.toString(),
          roundingAdjustment: calculated.roundingAdjustment.toString(),
          paidTotal: settled.paidTotal.toString(),
          changeAmount: settled.change.toString(),
          outstandingAmount: debtAmount.toString(),
          transactionDiscountBps: dto.discountBps ?? 0,
          taxBps: settings?.taxBps ?? DEFAULT_TAX_BASIS_POINTS,
          taxInclusive: settings?.taxInclusive ?? DEFAULT_PRICES_INCLUDE_TAX,
          transactionDate: now,
          note: dto.note ?? null,
          items: {
            create: calculated.lines.map((line) => {
              const product = productMap.get(line.productId)!;
              return {
                productId: line.productId,
                productName: line.name,
                sku: line.sku,
                unit: product.unit,
                qty: line.qty,
                unitPrice: line.unitPrice.toString(),
                grossAmount: line.grossAmount.toString(),
                lineDiscountAmount: line.lineDiscountAmount.toString(),
                transactionDiscountAmount: line.transactionDiscountAmount.toString(),
                discountAmount: line.discountAmount.toString(),
                netAmount: line.netAmount.toString(),
                taxAmount: line.taxAmount.toString(),
                totalAmount: line.totalAmount.toString(),
                lineDiscountBps: lineDiscountBps.get(line.productId) ?? 0,
                costPriceSnapshot: decimalToSen(product.priceBuy).toString(),
              };
            }),
          },
          payments: {
            create: storedPayments.map((payment) => ({
              method: payment.method,
              amount: payment.amount.toString(),
              reference: payment.reference,
            })),
          },
        },
        include: transactionInclude,
      });

      await this.stock.applyBatchInTransaction(
        tx,
        calculated.lines.map((line) => ({
          productId: line.productId,
          qtyDelta: -line.qty,
          type: 'SALE',
          refType: 'TRANSACTION',
          refId: created.id,
          notes: `Transaksi ${invoiceNo}`,
          createdById: userId,
        })),
      );

      const response: TransactionDto = {
        ...this.toTransactionDto(created),
        clientTotalMismatch,
      };

      await tx.auditLog.create({
        data: {
          userId,
          action: 'CREATE',
          entity: 'TRANSACTION',
          entityId: created.id,
          newValue: {
            invoiceNo,
            itemCount: calculated.lines.length,
            subtotal: calculated.subtotal,
            discountTotal: calculated.discountTotal,
            taxTotal: calculated.taxTotal,
            roundedTotal: calculated.roundedTotal,
            paidTotal: settled.paidTotal,
            changeAmount: settled.change,
            outstandingAmount: debtAmount,
            paymentStatus,
            customerId: dto.customerId ?? null,
            dueDate: dueDate?.toISOString() ?? null,
            paymentMethods: storedPayments.map((payment) => payment.method),
            clientTotalMismatch,
          },
        },
      });

      await this.idempotency.save(tx, {
        scope: POS_TRANSACTION_SCOPE,
        key: dto.idempotencyKey,
        requestHash: idempotency.requestHash,
        responseStatus: 201,
        responseBody: response,
        userId,
      });

      return response;
    });
  }

  async findAll(query: TransactionQuery) {
    const where: Prisma.TransactionWhereInput = { status: query.status };

    if (query.from || query.to) {
      const createdAt: Prisma.DateTimeFilter = {};
      if (query.from) createdAt.gte = query.from;
      if (query.to) createdAt.lte = query.to;
      where.createdAt = createdAt;
    }
    if (query.paymentStatus) where.paymentStatus = query.paymentStatus;
    if (query.cashierId) where.cashierId = query.cashierId;
    if (query.customerId) where.customerId = query.customerId;
    if (query.paymentMethod) {
      where.payments = { some: { method: query.paymentMethod } };
    }
    if (query.search) {
      where.OR = [
        { invoiceNo: { contains: query.search, mode: 'insensitive' } },
        { customer: { is: { name: { contains: query.search, mode: 'insensitive' } } } },
        { customer: { is: { phone: { contains: query.search } } } },
      ];
    }

    const [total, transactions] = await this.prisma.$transaction([
      this.prisma.transaction.count({ where }),
      this.prisma.transaction.findMany({
        where,
        include: transactionInclude,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return {
      success: true as const,
      data: transactions.map((transaction) => this.toListItem(transaction)),
      meta: buildPaginationMeta(total, query.page, query.pageSize),
    };
  }

  async findOne(id: string): Promise<TransactionDto> {
    const transaction = await this.prisma.transaction.findUnique({
      where: { id },
      include: transactionInclude,
    });
    if (!transaction) throw new NotFoundException('Transaksi tidak ditemukan');
    return this.toTransactionDto(transaction);
  }

  private validateInput(dto: CreateTransactionDto): void {
    if (dto.lines.length === 0) {
      throw new BadRequestException('Transaksi harus memiliki minimal satu barang');
    }

    const seen = new Set<string>();
    for (const line of dto.lines) {
      if (seen.has(line.productId)) {
        throw new BadRequestException({
          code: 'VALIDATION_FAILED',
          message: 'Produk yang sama tidak boleh muncul di lebih dari satu baris',
        });
      }
      seen.add(line.productId);
      if (!Number.isInteger(line.qty) || line.qty <= 0) {
        throw new BadRequestException('Jumlah barang harus bilangan bulat lebih dari nol');
      }
    }

    if (dto.payments.some((payment) => payment.method !== 'CASH' && payment.method !== 'DEBT')) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'Metode pembayaran tidak didukung',
      });
    }

    if (dto.payments.some((payment) => payment.method === 'DEBT') && !dto.customerId) {
      throw new BadRequestException({
        code: 'CUSTOMER_REQUIRED',
        message: 'Transaksi utang wajib memilih pelanggan',
      });
    }
  }

  private idempotencyPayload(dto: CreateTransactionDto) {
    return {
      lines: dto.lines.map((line) => ({
        productId: line.productId,
        qty: line.qty,
        discountBps: line.discountBps ?? 0,
      })),
      transactionDiscountBps: dto.discountBps ?? 0,
      payments: dto.payments.map((payment) => ({
        method: payment.method,
        amount: payment.amount,
        reference: payment.reference ?? null,
      })),
      customerId: dto.customerId ?? null,
      dueDate: dto.dueDate ?? null,
      note: dto.note ?? null,
      expectedTotal: dto.expectedTotal ?? null,
    };
  }

  private calculate(
    lines: CartLineInput[],
    options: Parameters<typeof calculateCart>[1],
  ): ReturnType<typeof calculateCart> {
    try {
      return calculateCart(lines, options);
    } catch (error) {
      if (error instanceof CartCalculationError) {
        throw new BadRequestException({
          code: 'VALIDATION_FAILED',
          message: error.message,
        });
      }
      throw error;
    }
  }

  private settle(
    total: Parameters<typeof settlePayments>[0],
    payments: Parameters<typeof settlePayments>[1],
  ): ReturnType<typeof settlePayments> {
    try {
      return settlePayments(total, payments);
    } catch (error) {
      if (error instanceof CartCalculationError) {
        throw new BadRequestException({
          code: 'VALIDATION_FAILED',
          message: error.message,
        });
      }
      throw error;
    }
  }

  private toTransactionDto(transaction: TransactionWithRelations): TransactionDto {
    return {
      id: transaction.id,
      invoiceNo: transaction.invoiceNo,
      status: transaction.status,
      paymentStatus: transaction.paymentStatus,
      lines: transaction.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        sku: item.sku,
        productName: item.productName,
        qty: item.qty,
        unit: item.unit,
        unitPrice: Number(item.unitPrice.toString()),
        grossAmount: Number(item.grossAmount.toString()),
        discountAmount: Number(item.discountAmount.toString()),
        netAmount: Number(item.netAmount.toString()),
        taxAmount: Number(item.taxAmount.toString()),
        totalAmount: Number(item.totalAmount.toString()),
        costPriceSnapshot:
          item.costPriceSnapshot === null ? null : Number(item.costPriceSnapshot.toString()),
      })),
      subtotal: Number(transaction.subtotal.toString()),
      lineDiscountTotal: Number(transaction.lineDiscountTotal.toString()),
      transactionDiscountAmount: Number(transaction.transactionDiscountAmount.toString()),
      discountTotal: Number(transaction.discountTotal.toString()),
      taxableBase: Number(transaction.taxableBase.toString()),
      taxTotal: Number(transaction.taxTotal.toString()),
      grandTotal: Number(transaction.grandTotal.toString()),
      roundedTotal: Number(transaction.roundedTotal.toString()),
      roundingAdjustment: Number(transaction.roundingAdjustment.toString()),
      paidTotal: Number(transaction.paidTotal.toString()),
      changeAmount: Number(transaction.changeAmount.toString()),
      outstandingAmount: Number(transaction.outstandingAmount.toString()),
      payments: transaction.payments.map((payment) => ({
        id: payment.id,
        method: payment.method,
        amount: Number(payment.amount.toString()),
        reference: payment.reference,
        paidAt: payment.paidAt.toISOString(),
      })),
      customerId: transaction.customerId,
      customerName: transaction.customer?.name ?? null,
      customerPhone: transaction.customer?.phone ?? null,
      cashierId: transaction.cashierId,
      cashierName: transaction.cashier.fullName,
      shiftId: transaction.shiftId,
      dueDate: transaction.dueDate?.toISOString() ?? null,
      note: transaction.note,
      createdAt: transaction.createdAt.toISOString(),
      voidedAt: transaction.voidedAt?.toISOString() ?? null,
      voidedByName: null,
      voidReason: transaction.voidReason,
    };
  }

  private toListItem(transaction: TransactionWithRelations) {
    const item = this.toTransactionDto(transaction);
    const { lines: _lines, payments: _payments, ...rest } = item;
    return {
      ...rest,
      itemCount: transaction.items.length,
      productNames: transaction.items.map((line) => line.productName),
    };
  }
}
