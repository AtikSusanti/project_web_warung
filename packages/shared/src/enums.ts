/**
 * Enum domain — sumber kebenaran tunggal. Nilai string di sini HARUS sama persis
 * dengan nilai enum di `prisma/schema.prisma` dan dengan label enum TypeScript
 * hasil generate Prisma. Ada test kontrak (`src/enums.test.ts`) yang memverifikasi
 * kecocokan tersebut setelah `prisma generate`.
 */

export const USER_ROLES = ['ADMIN', 'CASHIER'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const PAYMENT_METHODS = ['CASH', 'TRANSFER', 'QRIS', 'DEBT'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Metode yang menghasilkan penerimaan kas langsung. */
export const SETTLED_METHODS = ['CASH', 'TRANSFER', 'QRIS'] as const satisfies readonly PaymentMethod[];

/** Metode yang menunda penerimaan (piutang). */
export const CREDIT_METHODS = ['DEBT'] as const satisfies readonly PaymentMethod[];

export const PAYMENT_STATUSES = ['PAID', 'UNPAID', 'PARTIAL', 'WRITTEN_OFF'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const TRANSACTION_STATUSES = ['COMPLETED', 'VOIDED'] as const;
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

export const ORDER_STATUSES = [
  'PENDING_WA',
  'WA_SENT',
  'CONFIRMED',
  'CONVERTED',
  'CANCELLED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const STOCK_MOVEMENT_TYPES = [
  'PURCHASE',
  'SALE',
  'RETURN',
  'ADJUSTMENT_IN',
  'ADJUSTMENT_OUT',
  'OPNAME',
  'DAMAGE',
  'EXPIRED',
] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

/**
 * Arah Gerak Stok — dipisah dari tipe movement supaya agregasi dan guard
 * stok bisa diturunkan secara deterministik, bukan dari `if/else` di mana-mana.
 */
export const DIRECTIONS: Readonly<Record<StockMovementType, 'IN' | 'OUT'>> = {
  PURCHASE: 'IN',
  RETURN: 'IN',
  ADJUSTMENT_IN: 'IN',
  SALE: 'OUT',
  ADJUSTMENT_OUT: 'OUT',
  OPNAME: 'OUT', // Always conservative: an opname corrects toward the counted amount.
  DAMAGE: 'OUT',
  EXPIRED: 'OUT',
};

export const STOCK_MOVEMENT_REASONS: Readonly<Record<StockMovementType, string>> = {
  PURCHASE: 'Pembelian dari pemasok',
  SALE: 'Penjualan',
  RETURN: 'Retur pelanggan',
  ADJUSTMENT_IN: 'Penyesuaian stok masuk',
  ADJUSTMENT_OUT: 'Penyesuaian stok keluar',
  OPNAME: 'Hasil stock opname',
  DAMAGE: 'Barang rusak / kadaluarsa',
  EXPIRED: 'Kadaluarsa',
};

export const CUSTOMER_STATUSES = ['ACTIVE', 'BLOCKED'] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

export const SHIFT_STATUSES = ['OPEN', 'CLOSED'] as const;
export type ShiftStatus = (typeof SHIFT_STATUSES)[number];

export const AUDIT_ACTIONS = [
  'CREATE',
  'UPDATE',
  'DELETE',
  'LOGIN',
  'LOGIN_FAILED',
  'LOGOUT',
  'REFRESH',
  'VOID',
  'STOCK_ADJUST',
  'STOCK_OPNAME',
  'DEBT_PAYMENT',
  'DEBT_WRITEOFF',
  'ORDER_STATUS',
  'EXPORT',
  'BULK_IMPORT',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/**
 * Prefix nomor dokumen: nama konstanta -> kode tiga huruf yang dicetak.
 *
 * Dua bentuk ini sengaja dibedakan tipenya. `DocPrefixKey` adalah yang dipakai
 * saat pemanggil sudah tahu jenis dokumennya (`formatDocumentNumber({ prefix:
 * 'INVOICE' })`), sedangkan `DocPrefixCode` adalah yang muncul di teks nomor
 * dan yang disimpan di kolom `document_sequences.prefix`.
 *
 * Kalau keduanya dicampur jadi satu tipe, `DOC_PREFIXES[parts.prefix]` jadi
 * akses dengan nilai `'INV'` pada object yang di-key `'INVOICE'`, hasilnya
 * `undefined`, dan nomor tercetak jadi `undefined/2026/10/00001`.
 */
export const DOC_PREFIXES = {
  INVOICE: 'INV',
  ORDER: 'ORD',
  SHIFT: 'SHF',
} as const;

/** Nama jenis dokumen: `'INVOICE' | 'ORDER' | 'SHIFT'`. */
export type DocPrefixKey = keyof typeof DOC_PREFIXES;

/** Kode yang dicetak dan disimpan di database: `'INV' | 'ORD' | 'SHF'`. */
export type DocPrefixCode = (typeof DOC_PREFIXES)[DocPrefixKey];

const PREFIX_CODE_TO_KEY: Readonly<Record<DocPrefixCode, DocPrefixKey>> = {
  INV: 'INVOICE',
  ORD: 'ORDER',
  SHF: 'SHIFT',
};

export function isDocPrefixCode(v: unknown): v is DocPrefixCode {
  return typeof v === 'string' && v in PREFIX_CODE_TO_KEY;
}

export function docPrefixKeyOf(code: DocPrefixCode): DocPrefixKey {
  return PREFIX_CODE_TO_KEY[code];
}

export function isUserRole(v: unknown): v is UserRole {
  return typeof v === 'string' && (USER_ROLES as readonly string[]).includes(v);
}

export function isPaymentMethod(v: unknown): v is PaymentMethod {
  return typeof v === 'string' && (PAYMENT_METHODS as readonly string[]).includes(v);
}

export function isPaymentStatus(v: unknown): v is PaymentStatus {
  return typeof v === 'string' && (PAYMENT_STATUSES as readonly string[]).includes(v);
}

export function isOrderStatus(v: unknown): v is OrderStatus {
  return typeof v === 'string' && (ORDER_STATUSES as readonly string[]).includes(v);
}

export function isStockMovementType(v: unknown): v is StockMovementType {
  return typeof v === 'string' && (STOCK_MOVEMENT_TYPES as readonly string[]).includes(v);
}
