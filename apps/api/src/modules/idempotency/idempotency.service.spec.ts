import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { hashPayload, IdempotencyService } from './idempotency.service.js';

type ExistingKey = {
  requestHash: string;
  responseStatus: number;
  responseBody: Prisma.JsonValue;
  expiresAt: Date;
};

function makeTx(existing: ExistingKey | null) {
  const executeRaw = vi.fn().mockResolvedValue(1);
  const findUnique = vi.fn().mockResolvedValue(existing);
  const upsert = vi.fn().mockResolvedValue({});
  const tx = {
    $executeRaw: executeRaw,
    idempotencyKey: { findUnique, upsert },
  } as unknown as Prisma.TransactionClient;
  return { tx, executeRaw, findUnique, upsert };
}

describe('hashPayload', () => {
  it('menghasilkan hash yang sama tanpa bergantung urutan key', () => {
    const first = hashPayload({ b: 2, a: { d: 4, c: 3 } });
    const second = hashPayload({ a: { c: 3, d: 4 }, b: 2 });

    expect(first).toBe(second);
    expect(first).not.toBe(hashPayload({ b: 2, a: { c: 3, d: 5 } }));
  });
});

describe('IdempotencyService', () => {
  const service = new IdempotencyService();
  const payload = { lines: [{ productId: 'p1', qty: 2 }], payments: [{ method: 'CASH', amount: 10000 }] };

  it('mengembalikan response tersimpan untuk key dan payload yang sama', async () => {
    const { tx, executeRaw } = makeTx({
      requestHash: hashPayload(payload),
      responseStatus: 201,
      responseBody: { id: 'transaction-1' },
      expiresAt: new Date(Date.now() + 60_000),
    });

    const result = await service.begin(tx, {
      scope: 'POS_TRANSACTION',
      key: 'idempotency-key-1',
      payload,
    });

    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(result.replay).toEqual({ status: 201, body: { id: 'transaction-1' } });
  });

  it('menolak key yang sama dengan payload berbeda sebagai IDEMPOTENCY_MISMATCH', async () => {
    const { tx } = makeTx({
      requestHash: hashPayload({ other: true }),
      responseStatus: 201,
      responseBody: { id: 'transaction-1' },
      expiresAt: new Date(Date.now() + 60_000),
    });

    const error = await service
      .begin(tx, {
        scope: 'POS_TRANSACTION',
        key: 'idempotency-key-1',
        payload,
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getStatus()).toBe(409);
    expect((error as ConflictException).getResponse()).toMatchObject({
      code: 'IDEMPOTENCY_MISMATCH',
    });
  });

  it('mengabaikan key yang sudah kedaluwarsa', async () => {
    const { tx } = makeTx({
      requestHash: hashPayload(payload),
      responseStatus: 201,
      responseBody: { id: 'transaction-1' },
      expiresAt: new Date(Date.now() - 60_000),
    });

    const result = await service.begin(tx, {
      scope: 'POS_TRANSACTION',
      key: 'idempotency-key-1',
      payload,
    });

    expect(result.replay).toBeNull();
  });

  it('menyimpan response dengan masa berlaku default', async () => {
    const { tx, upsert } = makeTx(null);
    const before = Date.now();

    await service.save(tx, {
      scope: 'POS_TRANSACTION',
      key: 'idempotency-key-1',
      requestHash: hashPayload(payload),
      responseStatus: 201,
      responseBody: { id: 'transaction-1' },
      userId: 'user-1',
    });

    expect(upsert).toHaveBeenCalledTimes(1);
    const args = upsert.mock.calls[0]?.[0] as {
      where: { scope_key: { scope: string; key: string } };
      create: { expiresAt: Date; userId: string };
    };
    expect(args.where.scope_key).toEqual({ scope: 'POS_TRANSACTION', key: 'idempotency-key-1' });
    expect(args.create.userId).toBe('user-1');
    expect(args.create.expiresAt.getTime()).toBeGreaterThan(before);
  });
});
