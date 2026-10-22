import { describe, expect, it } from 'vitest';
import {
  formatDocumentNumber,
  MAX_SEQUENCE_PER_PERIOD,
  parseDocumentNumber,
  periodOf,
} from './id.js';

describe('formatDocumentNumber', () => {
  it('memformat INV/2026/10/00042', () => {
    expect(formatDocumentNumber({ prefix: 'INVOICE', year: 2026, month: 10, sequence: 42 })).toBe(
      'INV/2026/10/00042',
    );
  });

  it('melolopkan bulan dan urutan', () => {
    expect(formatDocumentNumber({ prefix: 'ORDER', year: 2026, month: 1, sequence: 7 })).toBe(
      'ORD/2026/01/00007',
    );
    expect(formatDocumentNumber({ prefix: 'SHIFT', year: 2025, month: 12, sequence: 12345 })).toBe(
      'SHF/2025/12/12345',
    );
  });

  it.each([
    { prefix: 'INVOICE' as const, year: 1999, month: 1, sequence: 1 },
    { prefix: 'INVOICE' as const, year: 2026, month: 0, sequence: 1 },
    { prefix: 'INVOICE' as const, year: 2026, month: 13, sequence: 1 },
    { prefix: 'INVOICE' as const, year: 2026, month: 1, sequence: 0 },
  ])('menolak input tidak valid %o', (parts) => {
    expect(() => formatDocumentNumber(parts)).toThrow(RangeError);
  });

  it('menolak urutan yang melebihi kapasitas kolom', () => {
    expect(() =>
      formatDocumentNumber({
        prefix: 'INVOICE',
        year: 2026,
        month: 1,
        sequence: MAX_SEQUENCE_PER_PERIOD + 1,
      }),
    ).toThrow(RangeError);
  });
});

describe('parseDocumentNumber', () => {
  it('membalik format dengan round-trip', () => {
    const formatted = formatDocumentNumber({
      prefix: 'INVOICE',
      year: 2026,
      month: 10,
      sequence: 42,
    });
    // `prefix` dikembalikan sebagai NAMA jenis dokumen supaya hasilnya bisa
    // langsung dipakai lagi oleh formatDocumentNumber, dan `code` menyimpan
    // kode tercetak untuk query ke document_sequences.
    expect(parseDocumentNumber(formatted)).toEqual({
      prefix: 'INVOICE',
      code: 'INV',
      year: 2026,
      month: 10,
      sequence: 42,
      period: '2026-10',
    });
  });

  it('round-trip benar-benar kembali ke input yang sama', () => {
    for (const prefix of ['INVOICE', 'ORDER', 'SHIFT'] as const) {
      const parts = { prefix, year: 2026, month: 7, sequence: 1234 };
      const formatted = formatDocumentNumber(parts);
      const parsed = parseDocumentNumber(formatted);
      // Inilah yang rusak sebelumnya: `prefix` pernah dikembalikan sebagai
      // kode ('INV'), lalu diteruskan lagi ke formatDocumentNumber yang
      // mengindeks DOC_PREFIXES dengan nama, hasilnya `undefined/...`.
      expect(parsed).not.toBeNull();
      expect(formatDocumentNumber(parsed as never)).toBe(formatted);
    }
  });

  it('memisahkan kode tercetak dari nama jenis dokumen', () => {
    expect(parseDocumentNumber('INV/2026/01/00001')?.code).toBe('INV');
    expect(parseDocumentNumber('ORD/2026/01/00001')?.code).toBe('ORD');
    expect(parseDocumentNumber('SHF/2026/01/00001')?.code).toBe('SHF');

    expect(parseDocumentNumber('INV/2026/01/00001')?.prefix).toBe('INVOICE');
    expect(parseDocumentNumber('ORD/2026/01/00001')?.prefix).toBe('ORDER');
    expect(parseDocumentNumber('SHF/2026/01/00001')?.prefix).toBe('SHIFT');
  });

  it.each([
    'INV/2026/13/00042',
    'INV/2026/00/00042',
    'INV/2026/10/00000',
    'XXX/2026/10/00042',
    'INV-2026-10-00042',
    'INV/26/10/00042',
    'INV/2026/10/42',
    'inv/2026/10/00042',
    '',
  ])('menolak %j', (input) => {
    expect(parseDocumentNumber(input)).toBeNull();
  });

  it('menolak kode prefix yang dikenal bentuknya tapi tidak terdaftar', () => {
    // 'ABC' tiga huruf uppercase, tapi bukan kode dokumen yang sah.
    expect(parseDocumentNumber('ABC/2026/10/00042')).toBeNull();
  });
});

describe('periodOf', () => {
  it('menggunakan zona waktu Indonesia, bukan UTC', () => {
    // 2026-09-30T17:30Z = 2026-10-01 00:30 WIB. Kalau memakai UTC, periode
    // akan terhitung September dan nomor dokumen meleset satu bulan.
    expect(periodOf(new Date('2026-09-30T17:30:00Z'), 'Asia/Jakarta')).toBe('2026-10');
    expect(periodOf(new Date('2026-09-30T17:30:00Z'), 'UTC')).toBe('2026-09');
  });

  it('menghasilkan format YYYY-MM', () => {
    expect(periodOf(new Date('2026-01-05T03:00:00Z'), 'Asia/Jakarta')).toBe('2026-01');
    expect(periodOf(new Date('2026-12-31T03:00:00Z'), 'Asia/Jakarta')).toBe('2026-12');
  });
});
