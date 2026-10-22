import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { sen, sum } from '@warung/shared';

import { PrismaService } from '../../prisma/prisma.service.js';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async dashboard() {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      todayAgg,
      monthAgg,
      receivablesAgg,
      productsAgg,
      topSelling,
      recentTransactions,
    ] = await this.prisma.$transaction([
      this.prisma.transaction.aggregate({
        _sum: { roundedTotal: true },
        _count: { _all: true },
        _avg: { roundedTotal: true },
        where: {
          status: 'COMPLETED',
          createdAt: { gte: todayStart, lt: tomorrowStart },
        },
      }),
      this.prisma.transaction.aggregate({
        _sum: { roundedTotal: true },
        _count: { _all: true },
        where: {
          status: 'COMPLETED',
          createdAt: { gte: monthStart },
        },
      }),
      this.prisma.transaction.aggregate({
        _sum: { outstandingAmount: true },
        _count: { _all: true },
        where: {
          status: 'COMPLETED',
          paymentStatus: { in: ['UNPAID', 'PARTIAL'] },
        },
      }),
      this.prisma.product.aggregate({
        _count: { _all: true },
        _sum: { stockQty: true },
        where: { deletedAt: null, isActive: true },
      }),
      this.prisma.transactionItem.groupBy({
        by: ['productId'],
        _sum: { qty: true, totalAmount: true },
        orderBy: { _sum: { qty: 'desc' } },
        take: 5,
        where: {
          transaction: { status: 'COMPLETED' },
        },
      }),
      this.prisma.transaction.findMany({
        where: { status: 'COMPLETED' },
        include: {
          items: true,
          cashier: { select: { fullName: true } },
          payments: true,
          customer: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ]);

    const todayTotal = todayAgg._sum.roundedTotal ?? 0;
    const todayCount = todayAgg._count._all ?? 0;
    const monthTotal = monthAgg._sum.roundedTotal ?? 0;
    const monthCount = monthAgg._count._all ?? 0;
    const averageBasket = todayCount > 0 ? sen(Math.round(Number(todayTotal) / todayCount)) : sen(0);

    const byMethod = await this.prisma.transactionPayment.groupBy({
      by: ['method'],
      _sum: { amount: true },
      _count: { _all: true },
    });

    const topSellingProducts = await Promise.all(
      topSelling.map(async (t) => {
        const product = await this.prisma.product.findUnique({
          where: { id: t.productId },
          select: { name: true },
        });
        return {
          productId: t.productId,
          name: product?.name ?? 'Produk Dihapus',
          qtySold: t._sum?.qty ?? 0,
          total: sen(Math.round(Number(t._sum?.totalAmount ?? 0))),
        };
      }),
    );

    const activeProducts = await this.prisma.product.findMany({
      where: { deletedAt: null, isActive: true },
      select: { stockQty: true, minStock: true },
    });
    const lowStockCount = activeProducts.filter((p) => p.stockQty > 0 && p.stockQty <= p.minStock).length;

    const outOfStockCount = await this.prisma.product.count({
      where: {
        deletedAt: null,
        isActive: true,
        stockQty: 0,
      },
    });

    const overdue = await this.prisma.transaction.aggregate({
      _sum: { outstandingAmount: true },
      _count: { _all: true },
      where: {
        status: 'COMPLETED',
        paymentStatus: { in: ['UNPAID', 'PARTIAL'] },
        dueDate: { lt: now },
      },
    });

    const uniqueDebtors = await this.prisma.transaction.findMany({
      where: {
        status: 'COMPLETED',
        paymentStatus: { in: ['UNPAID', 'PARTIAL'] },
      },
      select: { customerId: true },
      distinct: ['customerId'],
    });

    const recentWithItems = recentTransactions.map((t) => ({
      id: t.id,
      invoiceNo: t.invoiceNo,
      status: t.status,
      paymentStatus: t.paymentStatus,
      grandTotal: t.grandTotal.toString(),
      roundedTotal: t.roundedTotal.toString(),
      paidTotal: t.paidTotal.toString(),
      outstandingAmount: t.outstandingAmount.toString(),
      paymentMethod: t.payments[0]?.method ?? 'CASH',
      cashierName: t.cashier.fullName,
      customerName: t.customer?.name ?? 'Walk-in',
      createdAt: t.createdAt.toISOString(),
      itemCount: t.items.length,
      productNames: t.items.map((i) => i.productName).join(', '),
    }));

    return {
      period: {
        from: todayStart.toISOString(),
        to: now.toISOString(),
      },
      sales: {
        todayTotal: sen(Math.round(Number(todayTotal))),
        todayCount,
        monthTotal: sen(Math.round(Number(monthTotal))),
        monthCount,
        averageBasket,
        vsPreviousBps: null,
        byMethod: byMethod.map((m) => ({
          method: m.method,
          total: sen(Math.round(Number(m._sum.amount ?? 0))),
          count: m._count._all ?? 0,
        })),
      },
      receivables: {
        total: sen(Math.round(Number(receivablesAgg._sum.outstandingAmount ?? 0))),
        customerCount: uniqueDebtors.length,
        overdue: sen(Math.round(Number(overdue._sum.outstandingAmount ?? 0))),
        overdueCustomerCount: overdue._count._all ?? 0,
        byAgingBucket: [],
      },
      inventory: {
        productCount: productsAgg._count._all ?? 0,
        totalStockValue: sen(0),
        lowStockCount,
        outOfStockCount,
        topSelling: topSellingProducts,
      },
      recentTransactions: recentWithItems,
    };
  }

  async sales(from: Date, to: Date, groupBy: string = 'day') {
    const transactions = await this.prisma.transaction.findMany({
      where: {
        status: 'COMPLETED',
        createdAt: { gte: from, lte: to },
      },
      include: { items: true },
      orderBy: { createdAt: 'asc' },
    });

    const allItems = transactions.flatMap((t) => t.items);
    const grossTotal = sum(...allItems.map((i) => sen(Number(i.grossAmount))));
    const discountTotal = sum(...allItems.map((i) => sen(Number(i.discountAmount))));
    const netTotal = sum(...allItems.map((i) => sen(Number(i.netAmount))));
    const taxTotal = sum(...allItems.map((i) => sen(Number(i.taxAmount))));
    const averageBasket = transactions.length > 0 ? sen(Math.round(Number(netTotal) / transactions.length)) : sen(0);

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      groupBy,
      summary: {
        grossTotal,
        discountTotal,
        netTotal,
        taxTotal,
        transactionCount: transactions.length,
        itemCount: allItems.length,
        averageBasket,
      },
      rows: [],
    };
  }
}
