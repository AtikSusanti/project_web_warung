/**
 * Konstanta domain & bisnis.
 *
 * Nilai di sini adalah keputusan bisnis yang bisa diubah pemilik warung lewat
 * menu Pengaturan (lihat tabel `settings` di schema). Nilai default di bawah
 * hanya dipakai sebagai fallback dan sebagai nilai awal saat seeding.
 */

/** PPN Indonesia untuk barang konsumsi umum. Konfigurabel per pengaturan. */
export const DEFAULT_TAX_BASIS_POINTS = 1100;

/**
 * Apakah harga jual sudah termasuk PPN.
 *
 * DEFAULT `true` karena mayoritas harga warung Indonesia bersifat
 * "harga termasuk pajak". Konsekuensi kalau `false` (harga belum termasuk):
 * `total = (subtotal - diskon) + pajak`. Kalau `true`:
 * `total = subtotal - diskon` dan pajak hanya relevan untuk pelaporan.
 *
 * Salah memilih nilai ini membuat seluruh laporan keuangan salah, jadi ini
 * WAJIB jadi pengaturan eksplisit, bukan asumsi di kode.
 */
export const DEFAULT_PRICES_INCLUDE_TAX = true;

/** Diskon maksimum yang boleh dimasukan kasir dalam satu transaksi (basis point). 30% = 3000. */
export const MAX_TRANSACTION_DISCOUNT_BPS = 3000;

/** Diskon maksimum per baris. 50% = 5000. */
export const MAX_LINE_DISCOUNT_BPS = 5000;

/** PPN maksimum. 30% = 3000, jauh di atas batas wajar. */
export const MAX_TAX_BASIS_POINTS = 3000;

/** Jumlah item maksimum per transaksi POS. Pagar masuk log dan UX. */
export const MAX_TRANSACTION_LINES = 200;

/** Jumlah hasil pencarian maksimum per halaman. */
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/** Ambang stok menipis: kapan produk masuk daftar "perlu restock". */
export const LOW_STOCK_THRESHOLD_BPS = 100; // 100% dari minStock → berarti stok <= minStock

/** Toleransi untuk komparasi uang pada domain (tidak dipakai untuk aritmetika). */
export const MONEY_EPSILON_SEN = 0;

/** Lama cache katalog publik, detik. Blueprint §5.2: revalidate 60s. */
export const CATALOG_CACHE_TTL_SECONDS = 60;

/** Batas panjang pesan WhatsApp agar tidak terpotong. */
export const WA_MESSAGE_MAX_LENGTH = 4096;

/** Nomor WhatsApp resmi (tanpa "+", tanpa spasi), mis. 6281234567890. */
export const WA_PHONE_PATTERN = /^628[0-9]{8,13}$/;

/** Normalisasi nomor HP Indonesia ke format 62xxx. Accepts 08xx, +62xx, 62xx. */
export function normalizeIndonesianPhone(input: string): string | null {
  let digits = input.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (digits.startsWith('0')) digits = `62${digits.slice(1)}`;
  if (!digits.startsWith('62')) return null;
  const normalized = digits.slice(0, 15);
  return /^[1-9]\d{7,14}$/.test(normalized) ? normalized : null;
}

/** Label Bahasa Indonesia untuk enum, dipakai di UI. */
export const ENUM_LABELS: Readonly<Record<string, string>> = {
  ADMIN: 'Admin / Owner',
  CASHIER: 'Kasir',
  CASH: 'Tunai',
  TRANSFER: 'Transfer Bank',
  QRIS: 'QRIS',
  DEBT: 'Utang / Kasbon',
  PAID: 'Lunas',
  UNPAID: 'Belum Bayar',
  PARTIAL: 'Bayar Sebagian',
  WRITTEN_OFF: 'Dihapus Aset',
  COMPLETED: 'Selesai',
  VOIDED: 'Dibatalkan',
  PENDING_WA: 'Menunggu Kirim',
  WA_SENT: 'Terkirim ke WA',
  CONVERTED: 'Jadi Transaksi',
  CANCELLED: 'Dibatalkan',
  PURCHASE: 'Pembelian',
  SALE: 'Penjualan',
  RETURN: 'Retur',
  ADJUSTMENT_IN: 'Stok Masuk',
  ADJUSTMENT_OUT: 'Stok Keluar',
  OPNAME: 'Stock Opname',
  DAMAGE: 'Rusak',
  EXPIRED: 'Kadaluarsa',
  OPEN: 'Dibuka',
  CLOSED: 'Ditutup',
  ACTIVE: 'Aktif',
  BLOCKED: 'Diblokir',
};

/** Bucket aging piutang sesuai praktik usaha warung. */
export const AGING_BUCKETS = [
  { key: 'current', label: 'Belum jatuh tempo', minDays: 0, maxDays: 0 },
  { key: 'd1_30', label: '1-30 hari', minDays: 1, maxDays: 30 },
  { key: 'd31_60', label: '31-60 hari', minDays: 31, maxDays: 60 },
  { key: 'd61_90', label: '61-90 hari', minDays: 61, maxDays: 90 },
  { key: 'd90_plus', label: '> 90 hari', minDays: 91, maxDays: Number.POSITIVE_INFINITY },
] as const;

export type AgingBucketKey = (typeof AGING_BUCKETS)[number]['key'];

export function agingBucketFor(daysOverdue: number): AgingBucketKey {
  for (const bucket of AGING_BUCKETS) {
    if (daysOverdue >= bucket.minDays && daysOverdue <= bucket.maxDays) return bucket.key;
  }
  return 'd90_plus';
}
