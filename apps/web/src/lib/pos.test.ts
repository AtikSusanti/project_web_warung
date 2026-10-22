import { describe, expect, it } from 'vitest';

import {
  calculatePosCart,
  createIdempotencyKey,
  decodeJwt,
  DEFAULT_POS_SETTINGS,
  formatRupiah,
  getDetailNumber,
  getDetailText,
  normalizeSettings,
  parseCashInput,
  planPosPayments,
} from './pos';

describe('parseCashInput', () => {
  it('parses rupiah with dots as thousands separators', () => {
    expect(parseCashInput('50.000')).toBe(5_000_000);
  });

  it('parses rupiah with a currency prefix and decimal cents', () => {
    expect(parseCashInput('Rp 12.500,50')).toBe(1_250_050);
  });

  it('returns zero for an empty input', () => {
    expect(parseCashInput('  ')).toBe(0);
  });

  it('rejects invalid and negative values', () => {
    expect(parseCashInput('abc')).toBeNull();
    expect(parseCashInput('-1')).toBeNull();
  });
});

describe('planPosPayments', () => {
  it('mencatat kekurangan tunai sebagai pembayaran DEBT', () => {
    expect(planPosPayments(10_000_000, 6_000_000, true)).toEqual({
      payments: [
        { method: 'CASH', amount: 6_000_000 },
        { method: 'DEBT', amount: 4_000_000 },
      ],
      debtAmount: 4_000_000,
      paidTotal: 6_000_000,
      change: 0,
      shortfall: 4_000_000,
      isSettled: true,
    });
  });

  it('mendukung pembayaran penuh dengan utang tanpa uang tunai', () => {
    expect(planPosPayments(10_000_000, 0, true)).toMatchObject({
      payments: [{ method: 'DEBT', amount: 10_000_000 }],
      debtAmount: 10_000_000,
      paidTotal: 0,
      isSettled: true,
    });
  });

  it('tidak mencatat utang bila tunai menutup total', () => {
    expect(planPosPayments(10_000_000, 12_000_000, true)).toEqual({
      payments: [{ method: 'CASH', amount: 12_000_000 }],
      debtAmount: 0,
      paidTotal: 12_000_000,
      change: 2_000_000,
      shortfall: 0,
      isSettled: true,
    });
  });

  it('tetap menolak kekurangan tunai bila utang tidak diaktifkan', () => {
    expect(planPosPayments(10_000_000, 6_000_000, false)).toMatchObject({
      payments: [{ method: 'CASH', amount: 6_000_000 }],
      debtAmount: 0,
      shortfall: 4_000_000,
      isSettled: false,
    });
  });
});

describe('formatRupiah', () => {
  it('formats sen as Indonesian rupiah', () => {
    expect(formatRupiah(5_000_000)).toBe('Rp 50.000');
  });

  it('returns a placeholder for invalid values', () => {
    expect(formatRupiah(Number.NaN)).toBe('Rp —');
  });
});

describe('error detail helpers', () => {
  const details = {
    roundedTotal: ['125000'],
    message: 'changed',
    empty: [],
  };

  it('extracts the first array detail', () => {
    expect(getDetailText(details, 'roundedTotal')).toBe('125000');
    expect(getDetailNumber(details, 'roundedTotal')).toBe(125000);
  });

  it('returns null for missing or empty details', () => {
    expect(getDetailText(details, 'missing')).toBeNull();
    expect(getDetailText(details, 'empty')).toBeNull();
    expect(getDetailNumber(details, 'missing')).toBeNull();
  });
});

describe('calculatePosCart', () => {
  const line = {
    productId: 'product-1',
    sku: 'sku-1',
    name: 'Produk',
    unitPrice: 5_000_000,
    qty: 1,
    stockQty: 10,
    unit: 'PCS',
    category: 'Umum',
  };

  it('keeps the total equal to gross when prices include tax', () => {
    const result = calculatePosCart([line], DEFAULT_POS_SETTINGS);
    expect(result.roundedTotal).toBe(5_000_000);
    expect(result.taxTotal).toBeGreaterThan(0);
  });

  it('adds tax when prices exclude tax', () => {
    const result = calculatePosCart([line], {
      ...DEFAULT_POS_SETTINGS,
      taxInclusive: false,
    });
    expect(result.roundedTotal).toBe(5_550_000);
  });
});

describe('normalizeSettings', () => {
  it('uses backend defaults for missing settings', () => {
    expect(normalizeSettings(null)).toEqual({
      taxBps: 1100,
      taxInclusive: true,
      enableCashRounding: false,
      cashRoundingStepSen: 10000,
    });
  });

  it('keeps valid stored settings', () => {
    expect(
      normalizeSettings({
        taxBps: 0,
        taxInclusive: false,
        enableCashRounding: true,
        cashRoundingStepSen: 5000,
      }),
    ).toEqual({
      taxBps: 0,
      taxInclusive: false,
      enableCashRounding: true,
      cashRoundingStepSen: 5000,
    });
  });
});

describe('decodeJwt', () => {
  it('reads role and username from a token payload', () => {
    const payload = btoa(JSON.stringify({ role: 'CASHIER', username: 'kasir', exp: 9999999999 }));
    expect(decodeJwt(`header.${payload}.signature`)).toMatchObject({
      role: 'CASHIER',
      username: 'kasir',
    });
  });

  it('returns null for malformed tokens', () => {
    expect(decodeJwt('not-a-token')).toBeNull();
  });
});

describe('createIdempotencyKey', () => {
  it('creates a unique key within the API length constraints', () => {
    const first = createIdempotencyKey();
    const second = createIdempotencyKey();
    expect(first.startsWith('pos-')).toBe(true);
    expect(first.length).toBeGreaterThanOrEqual(8);
    expect(first.length).toBeLessThanOrEqual(120);
    expect(first).not.toBe(second);
  });
});
