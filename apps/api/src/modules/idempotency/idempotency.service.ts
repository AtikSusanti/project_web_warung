import { createHash } from 'node:crypto';

import { ConflictException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export interface IdempotencyReplay {
  status: number;
  body: Prisma.JsonValue;
}

export interface IdempotencyBeginResult {
  requestHash: string;
  replay: IdempotencyReplay | null;
}

@Injectable()
export class IdempotencyService {
  async begin(
    tx: Prisma.TransactionClient,
    input: { scope: string; key: string; payload: unknown },
  ): Promise<IdempotencyBeginResult> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.scope}:${input.key}`}))`;

    const requestHash = hashPayload(input.payload);
    const existing = await tx.idempotencyKey.findUnique({
      where: { scope_key: { scope: input.scope, key: input.key } },
      select: {
        requestHash: true,
        responseStatus: true,
        responseBody: true,
        expiresAt: true,
      },
    });

    if (!existing || existing.expiresAt.getTime() <= Date.now()) {
      return { requestHash, replay: null };
    }

    if (existing.requestHash !== requestHash) {
      throw new ConflictException({
        code: 'IDEMPOTENCY_MISMATCH',
        message: 'Idempotency key sudah dipakai dengan payload berbeda',
      });
    }

    return {
      requestHash,
      replay: {
        status: existing.responseStatus,
        body: existing.responseBody,
      },
    };
  }

  async save(
    tx: Prisma.TransactionClient,
    input: {
      scope: string;
      key: string;
      requestHash: string;
      responseStatus: number;
      responseBody: Prisma.InputJsonValue;
      userId?: string;
      ttlMs?: number;
    },
  ): Promise<void> {
    const expiresAt = new Date(Date.now() + (input.ttlMs ?? IDEMPOTENCY_TTL_MS));

    await tx.idempotencyKey.upsert({
      where: { scope_key: { scope: input.scope, key: input.key } },
      create: {
        scope: input.scope,
        key: input.key,
        requestHash: input.requestHash,
        responseStatus: input.responseStatus,
        responseBody: input.responseBody,
        userId: input.userId ?? null,
        expiresAt,
      },
      update: {
        requestHash: input.requestHash,
        responseStatus: input.responseStatus,
        responseBody: input.responseBody,
        userId: input.userId ?? null,
        expiresAt,
      },
    });
  }
}

export function hashPayload(payload: unknown): string {
  return createHash('sha256').update(stableStringify(payload)).digest('hex');
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}
