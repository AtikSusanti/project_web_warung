import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { StockMovementType } from '@warung/shared';

import { PrismaService } from '../../../prisma/prisma.service.js';

export interface StockDelta {
  productId: string;
  qtyDelta: number;
  type: StockMovementType;
  refType?: 'TRANSACTION' | 'ORDER' | 'OPNAME' | 'MANUAL' | 'PURCHASE';
  refId?: string;
  notes?: string;
  unitCost?: number;
  createdById?: string;
}

@Injectable()
export class StockService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Apply stock delta atomically: UPDATE products.stockQty by delta with guard (>=0),
   * insert StockMovement with stockBefore/stockAfter in same transaction.
   * Returns new stockQty.
   */
  async applyDelta(delta: StockDelta): Promise<number> {
    return this.prisma.$transaction((tx) => this.applyDeltaInTransaction(tx, delta));
  }

  async applyDeltaInTransaction(tx: Prisma.TransactionClient, delta: StockDelta): Promise<number> {
    if (delta.qtyDelta === 0) {
      throw new BadRequestException('qtyDelta tidak boleh 0');
    }

    const product = await tx.product.findUnique({
      where: { id: delta.productId },
      select: { id: true, stockQty: true },
    });
    if (!product) {
      throw new BadRequestException('Produk tidak ditemukan');
    }

    const stockBefore = product.stockQty;
    const stockAfter = stockBefore + delta.qtyDelta;

    if (stockAfter < 0) {
      throw new BadRequestException('Stok tidak cukup');
    }

    const updated = await tx.product.updateMany({
      where: { id: delta.productId, stockQty: stockBefore },
      data: { stockQty: { increment: delta.qtyDelta }, version: { increment: 1 } },
    });
    if (updated.count === 0) {
      throw new BadRequestException('Konflik stok, coba ulangi');
    }

    await tx.stockMovement.create({
      data: {
        productId: delta.productId,
        type: delta.type,
        qty: delta.qtyDelta,
        stockBefore,
        stockAfter,
        refType: delta.refType,
        refId: delta.refId,
        notes: delta.notes,
        unitCost: delta.unitCost ?? null,
        createdById: delta.createdById,
      },
    });

    const current = await tx.product.findUniqueOrThrow({
      where: { id: delta.productId },
      select: { stockQty: true },
    });
    return current.stockQty;
  }

  async applyBatch(deltas: StockDelta[]): Promise<Record<string, number>> {
    if (deltas.length === 0) return {};
    const result = new Map<string, number>();
    for (const d of deltas) {
      const s = await this.applyDelta(d);
      result.set(d.productId, s);
    }
    const out: Record<string, number> = {};
    for (const [k, v] of result) out[k] = v;
    return out;
  }

  async applyBatchInTransaction(
    tx: Prisma.TransactionClient,
    deltas: StockDelta[],
  ): Promise<Record<string, number>> {
    if (deltas.length === 0) return {};
    const sorted = [...deltas].sort((a, b) =>
      a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0,
    );
    const result: Record<string, number> = {};
    for (const delta of sorted) {
      result[delta.productId] = await this.applyDeltaInTransaction(tx, delta);
    }
    return result;
  }
}
