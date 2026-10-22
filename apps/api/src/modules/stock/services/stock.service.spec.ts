import type { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../prisma/prisma.service.js';
import { StockService } from './stock.service.js';

function makeTx(stockQty: number) {
  const findUnique = vi.fn().mockResolvedValue({ id: 'product-1', stockQty });
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const create = vi.fn().mockResolvedValue({});
  const findUniqueOrThrow = vi.fn().mockResolvedValue({ stockQty: stockQty - 2 });
  const tx = {
    product: { findUnique, updateMany, findUniqueOrThrow },
    stockMovement: { create },
  } as unknown as Prisma.TransactionClient;
  return { tx, findUnique, updateMany, create, findUniqueOrThrow };
}

describe('StockService.applyDeltaInTransaction', () => {
  const service = new StockService({} as PrismaService);

  it('mengurangi stok dan mencatat movement di transaction client yang sama', async () => {
    const { tx, create } = makeTx(10);

    const nextStock = await service.applyDeltaInTransaction(tx, {
      productId: 'product-1',
      qtyDelta: -2,
      type: 'SALE',
      refType: 'TRANSACTION',
      refId: 'transaction-1',
      createdById: 'user-1',
    });

    expect(nextStock).toBe(8);
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        productId: 'product-1',
        type: 'SALE',
        qty: -2,
        stockBefore: 10,
        stockAfter: 8,
        refType: 'TRANSACTION',
        refId: 'transaction-1',
        createdById: 'user-1',
      }),
    });
  });

  it('menolak stok tidak cukup tanpa menulis movement', async () => {
    const { tx, create, updateMany } = makeTx(1);

    await expect(
      service.applyDeltaInTransaction(tx, {
        productId: 'product-1',
        qtyDelta: -2,
        type: 'SALE',
      }),
    ).rejects.toThrow('Stok tidak cukup');

    expect(updateMany).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('menolak konflik stok saat update bersyarat gagal', async () => {
    const { tx, updateMany, create } = makeTx(10);
    updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.applyDeltaInTransaction(tx, {
        productId: 'product-1',
        qtyDelta: -2,
        type: 'SALE',
      }),
    ).rejects.toThrow('Konflik stok, coba ulangi');

    expect(create).not.toHaveBeenCalled();
  });
});
