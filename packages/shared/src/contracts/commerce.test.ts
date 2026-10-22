import { describe, expect, it } from 'vitest';

import { createTransactionInputSchema } from './commerce.js';

const customerId = '11111111-1111-4111-8111-111111111111';

const base = {
  lines: [{ productId: '22222222-2222-4222-8222-222222222222', qty: 1 }],
  idempotencyKey: 'abcdefgh',
};

describe('createTransactionInputSchema', () => {
  it('menerima transaksi utang murni bila pelanggan dipilih', () => {
    const result = createTransactionInputSchema.safeParse({
      ...base,
      customerId,
      payments: [{ method: 'DEBT', amount: 1_200_000 }],
    });

    expect(result.success).toBe(true);
  });

  it('menolak transaksi utang murni tanpa pelanggan', () => {
    const result = createTransactionInputSchema.safeParse({
      ...base,
      payments: [{ method: 'DEBT', amount: 1_200_000 }],
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.message).toBe(
      'Pembayaran utang wajib memilih pelanggan',
    );
  });

  it('menolak customerId dan customerWalkIn yang dikirim bersamaan', () => {
    const result = createTransactionInputSchema.safeParse({
      ...base,
      customerId,
      customerWalkIn: { name: 'Budi', phone: '6281234567890' },
      payments: [{ method: 'CASH', amount: 1_200_000 }],
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.message).toBe(
      'Isi customerId ATAU customerWalkIn, jangan keduanya',
    );
  });
});
