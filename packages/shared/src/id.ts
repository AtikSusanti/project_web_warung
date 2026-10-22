import {
  DOC_PREFIXES,
  docPrefixKeyOf,
  isDocPrefixCode,
  type DocPrefixCode,
  type DocPrefixKey,
} from './enums.js';

/**
 * Pembuatan nomor dokumen.
 *
 * Fungsi-fungsi di sini MURNI: hanya formatting. Kebenaran nomor urut saat
 * dua kasir menekan simpan pada milidetik yang sama bukan urusan fungsi ini —
 * itu urusan database (lihat `DocumentSequenceService` di apps/api):
 *   - tabel `document_sequences` dengan PK (prefix, period)
 *   - fungsi SQL `next_document_value(prefix, period)` yang memakai
 *     `INSERT ... ON CONFLICT DO UPDATE`, sehingga alokasi nomor atomik
 *   - kolom `document_sequences.prefix` bertipe CHAR(3), jadi kode 'INV'
 *
 * Format: `INV/2026/10/00042`
 * - prefix   : kode tiga huruf jenis dokumen
 * - tahun    : 4 digit
 * - bulan    : 2 digit
 * - urut     : 5 digit, nol di depan, direset setiap bulan
 *
 * Padding 5 digit memberi ruang 99.999 transaksi per bulan. Warung yang
 * terlampaui akan mendapat error eksplisit dari DB, bukan nomor yang diam-diam
 * meluber jadi 6 digit dan merusak parsing.
 */
export interface DocumentNumberParts {
  /** Nama jenis dokumen, bukan kode tercetak: `'INVOICE' | 'ORDER' | 'SHIFT'`. */
  prefix: DocPrefixKey;
  year: number;
  month: number;
  sequence: number;
}

/** Hasil parsing: seluruh `parts` plus kode tercetak dan periode sequence. */
export interface ParsedDocumentNumber extends DocumentNumberParts {
  /** Kode yang tercetak di nomor: `'INV' | 'ORD' | 'SHF'`. */
  readonly code: DocPrefixCode;
  readonly period: string;
}

export const SEQUENCE_PAD = 5;
export const MAX_SEQUENCE_PER_PERIOD = 10 ** SEQUENCE_PAD - 1;

/** Lebar kolom `prefix`/`period` di `document_sequences`. */
export const PREFIX_LENGTH = 3;
export const PERIOD_LENGTH = 7;

export function formatDocumentNumber(parts: DocumentNumberParts): string {
  const code = DOC_PREFIXES[parts.prefix];
  if (code === undefined) {
    throw new RangeError(`Jenis dokumen tidak dikenal: ${String(parts.prefix)}`);
  }
  if (!Number.isInteger(parts.year) || parts.year < 2000 || parts.year > 2999) {
    throw new RangeError(`Tahun tidak valid: ${parts.year}`);
  }
  if (!Number.isInteger(parts.month) || parts.month < 1 || parts.month > 12) {
    throw new RangeError(`Bulan tidak valid: ${parts.month}`);
  }
  if (!Number.isInteger(parts.sequence) || parts.sequence < 1) {
    throw new RangeError(`Nomor urut tidak valid: ${parts.sequence}`);
  }
  if (parts.sequence > MAX_SEQUENCE_PER_PERIOD) {
    throw new RangeError(
      `Nomor urut ${parts.sequence} melebihi batas ${MAX_SEQUENCE_PER_PERIOD} per bulan. ` +
        'Gunakan panjang kolom atau format nomor yang lebih besar.',
    );
  }
  return [
    code,
    String(parts.year),
    String(parts.month).padStart(2, '0'),
    String(parts.sequence).padStart(SEQUENCE_PAD, '0'),
  ].join('/');
}

export function parseDocumentNumber(value: string): ParsedDocumentNumber | null {
  const m = /^([A-Z]{3})\/(\d{4})\/(\d{2})\/(\d{5})$/.exec(value.trim());
  if (!m) return null;
  const [, code, year, month, seq] = m;
  if (!code || !year || !month || !seq) return null;
  if (!isDocPrefixCode(code)) return null;

  const y = Number(year);
  const mo = Number(month);
  const s = Number(seq);
  if (y < 2000 || y > 2999 || mo < 1 || mo > 12 || s < 1) return null;

  return {
    prefix: docPrefixKeyOf(code),
    code,
    year: y,
    month: mo,
    sequence: s,
    period: `${y}-${String(mo).padStart(2, '0')}`,
  };
}

/** Periode `YYYY-MM` untuk pengelompokan sequence. */
export function periodOf(date: Date, timeZone = 'Asia/Jakarta'): string {
  return `${yearInTimeZone(date, timeZone)}-${String(monthInTimeZone(date, timeZone)).padStart(2, '0')}`;
}

function partsInTimeZone(date: Date, timeZone: string): { year: number; month: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
  });
  const parts = fmt.formatToParts(date);
  const year = Number(parts.find((p) => p.type === 'year')?.value);
  const month = Number(parts.find((p) => p.type === 'month')?.value);
  if (!Number.isInteger(year) || !Number.isInteger(month)) {
    throw new RangeError(`Zona waktu tidak valid: ${timeZone}`);
  }
  return { year, month };
}

function yearInTimeZone(date: Date, timeZone: string): number {
  return partsInTimeZone(date, timeZone).year;
}

function monthInTimeZone(date: Date, timeZone: string): number {
  return partsInTimeZone(date, timeZone).month;
}
