import type { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../prisma/prisma.service.js';
import { DocumentSequenceService } from './document-sequence.service.js';

function makePrisma(value: bigint = 42n) {
  const queryRaw = vi.fn().mockResolvedValue([{ value }]);
  const prisma = { $queryRaw: queryRaw } as unknown as PrismaService;
  return { prisma, queryRaw };
}

describe('DocumentSequenceService', () => {
  it('membuat nomor dokumen dari sequence Prisma', async () => {
    const { prisma, queryRaw } = makePrisma(42n);
    const service = new DocumentSequenceService(prisma);

    const result = await service.nextNumber('INVOICE', new Date('2026-10-15T03:04:05Z'));

    expect(result).toBe('INV/2026/10/00042');
    expect(queryRaw).toHaveBeenCalledWith(expect.anything(), 'INV', '2026-10');
  });

  it('memakai transaction client yang diberikan', async () => {
    const { prisma, queryRaw: prismaQueryRaw } = makePrisma(1n);
    const txQueryRaw = vi.fn().mockResolvedValue([{ value: 7n }]);
    const tx = { $queryRaw: txQueryRaw } as unknown as Prisma.TransactionClient;
    const service = new DocumentSequenceService(prisma);

    const result = await service.nextNumber('ORDER', new Date('2026-10-15T03:04:05Z'), tx);

    expect(result).toBe('ORD/2026/10/00007');
    expect(txQueryRaw).toHaveBeenCalledWith(expect.anything(), 'ORD', '2026-10');
    expect(prismaQueryRaw).not.toHaveBeenCalled();
  });

  it('melempar error jika sequence tidak mengembalikan nilai', async () => {
    const { prisma, queryRaw } = makePrisma();
    queryRaw.mockResolvedValue([]);
    const service = new DocumentSequenceService(prisma);

    await expect(service.nextNumber('SHIFT')).rejects.toThrow('Gagal generate nomor dokumen');
  });
});
