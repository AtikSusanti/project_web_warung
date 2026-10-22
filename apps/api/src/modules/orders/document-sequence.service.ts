import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { DocPrefixKey } from '@warung/shared';
import { formatDocumentNumber, periodOf } from '@warung/shared';

import { PrismaService } from '../../prisma/prisma.service.js';

@Injectable()
export class DocumentSequenceService {
  constructor(private readonly prisma: PrismaService) {}

  async nextNumber(
    prefix: DocPrefixKey,
    date: Date = new Date(),
    tx?: Prisma.TransactionClient,
  ): Promise<string> {
    const code = prefix === 'INVOICE' ? 'INV' : prefix === 'ORDER' ? 'ORD' : 'SHF';
    const period = periodOf(date);
    const client: Pick<Prisma.TransactionClient, '$queryRaw'> = tx ?? this.prisma;
    const result = await client.$queryRaw<{ value: bigint }[]>`
      SELECT next_document_value(${code}::char(3), ${period}::char(7), 1) as value
    `;
    if (!result[0]) throw new Error('Gagal generate nomor dokumen');
    const sequence = Number(result[0].value);
    return formatDocumentNumber({
      prefix,
      year: Number(period.slice(0, 4)),
      month: Number(period.slice(5, 7)),
      sequence,
    });
  }
}
