import { z } from 'zod';
import {
  basisPointsSchema,
  barcodeSchema,
  nameSchema,
  optionalTextSchema,
  senSchema,
  shortTextSchema,
  slugSchema,
  skuSchema,
  uuidSchema,
} from './common.js';

/**
 * Kontrak Product Management (blueprint §5.1).
 *
 * Catatan desain harga:
 * - `priceBuy` = harga modal (HPP) saat barang masuk. Disimpan agar bisa
 *   menghitung margin kasar di Phase 1.
 * - `priceSell` = harga jual ke pelanggan biasa.
 * - `priceWholesale` opsional: blueprint §5.1 menyebut "harga grosir" dan §5.2
 *   menyebut harga bisa disembunyikan untuk pelanggan grosir. Di sini
 *   dimodelkan sebagai harga tier sederhana (satu level), cukup untuk warung.
 *
 * `costSnapshotEnabled` sengaja tidak ada di Phase 1. HPP historis yang benar
 * membutuhkan `inventory_cost_layers` (lihat ADR-0004). Yang kita lakukan sekarang
 * adalah menyalin `priceBuy` ke `transaction_items.costPriceSnapshot` saat
 * penjualan, sehingga ada jejak untuk rekonsiliasi quandoHPP incomod belum ada.
 */

export const unitOfMeasureSchema = z.enum([
  'PCS',
  'PACK',
  'KG',
  'GRAM',
  'LITER',
  'ML',
  'BOX',
  'DOSE',
  'RID',
]);
export type UnitOfMeasure = z.infer<typeof unitOfMeasureSchema>;

export const UNITS_OF_MEASURE: readonly UnitOfMeasure[] = unitOfMeasureSchema.options;

export const UNIT_LABELS: Readonly<Record<UnitOfMeasure, string>> = {
  PCS: 'pcs',
  PACK: 'kemasan',
  KG: 'kg',
  GRAM: 'gram',
  LITER: 'liter',
  ML: 'ml',
  BOX: 'dos',
  DOSE: 'bungkus',
  RID: 'renteng',
};

/** Satuan yang boleh pecah (bisa 0.5 kg). Satuan lain harus bilangan bulat. */
export const FRACTIONAL_UNITS: readonly UnitOfMeasure[] = ['KG', 'LITER'];

export function allowsFractionalQty(unit: UnitOfMeasure): boolean {
  return FRACTIONAL_UNITS.includes(unit);
}

/**
 * Bentuk dasar, sengaja dipisah dari refine di bawah.
 *
 * Alasannya: `z.object(...).refine(...)` menghasilkan `ZodEffects`, dan
 * `ZodEffects` tidak punya metode `.partial()`. Kalau refine dulu lalu
 * `.partial()`, hasilnya bukan "semua field opsional" dan TypeScript akan
 * menolak operasi itu.
 *
 * Pola yang dipakai di file ini: satu `ZodObject` dasar per entitas, lalu
 * `createX` = basis + refine, dan `updateX` = basis.partial() + refine.
 */
const productShape = {
  sku: skuSchema.optional(),
  barcode: barcodeSchema.nullish(),
  name: nameSchema,
  description: optionalTextSchema,
  categoryId: uuidSchema.nullish(),
  priceBuy: senSchema.nonnegative('Harga modal tidak boleh negatif'),
  priceSell: senSchema.nonnegative('Harga jual tidak boleh negatif'),
  priceWholesale: senSchema.nonnegative('Harga grosir tidak boleh negatif').nullish(),
  stock: z.number().int('Stok harus bilangan bulat').min(0).max(1_000_000).default(0),
  minStock: z.number().int().min(0).max(1_000_000).default(0),
  unit: unitOfMeasureSchema.default('PCS'),
  imageUrl: z.string().url('URL gambar tidak valid').max(500).nullish(),
  /** Batas minimal qty agar harga grosir dipakai. */
  wholesaleMinQty: z.number().int().min(1).max(100_000).nullish(),
  isActive: z.boolean().default(true),
  isFeatured: z.boolean().default(false),
  /** Tampilkan di katalog publik. */
  isPublic: z.boolean().default(true),
};

export const createProductInputSchema = z
  .object(productShape)
  .refine((v) => v.priceSell > 0, {
    message: 'Harga jual harus lebih besar dari nol',
    path: ['priceSell'],
  })
  .refine((v) => v.priceBuy > 0, {
    message: 'Harga modal harus lebih besar dari nol',
    path: ['priceBuy'],
  })
  .refine((v) => v.priceSell >= v.priceBuy, {
    message: 'Harga jual tidak boleh lebih kecil dari harga modal',
    path: ['priceSell'],
  })
  .refine((v) => v.priceWholesale == null || v.priceWholesale <= v.priceSell, {
    message: 'Harga grosir harus lebih kecil atau sama dengan harga jual',
    path: ['priceWholesale'],
  });

export type CreateProductInput = z.infer<typeof createProductInputSchema>;

/**
 * Update tidak memakai `priceConsistencyRefinements`, karena refine itu
 * membandingkan `priceSell >= priceBuy` tanpa syarat keduanya terkirim. Pada
 * PATCH yang hanya mengubah satu harga, `undefined >= 15000` bernilai false
 * dan setiap update sebagian akan ditolak.
 *
 * Yang dicegah di sini hanya kasus yang memang dapat dinilai dari payload:
 * kedua harga ikut terkirim, atau harga grosir ikut terkirim. Aturan
 * "harga jual >= harga modal" untuk kasus hanya-ubah-satu-harga ditangani
 * di service layer, yang sudah membaca nilai lama dari database.
 */
export const updateProductInputSchema = z
  .object(productShape)
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Tidak ada perubahan yang dikirim' })
  .refine(
    (v) => v.priceSell == null || v.priceBuy == null || v.priceSell >= v.priceBuy,
    {
      message: 'Harga jual tidak boleh lebih kecil dari harga modal',
      path: ['priceSell'],
    },
  )
  .refine(
    (v) =>
      v.priceWholesale == null ||
      v.priceSell == null ||
      v.priceWholesale <= v.priceSell,
    {
      message: 'Harga grosir harus lebih kecil atau sama dengan harga jual',
      path: ['priceWholesale'],
    },
  );
export type UpdateProductInput = z.infer<typeof updateProductInputSchema>;

export const productSchema = z.object({
  id: uuidSchema,
  sku: z.string(),
  barcode: z.string().nullable(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  categoryId: z.string().nullable(),
  categoryName: z.string().nullable(),
  priceBuy: senSchema,
  priceSell: senSchema,
  priceWholesale: senSchema.nullable(),
  stock: z.number().int(),
  minStock: z.number().int(),
  unit: unitOfMeasureSchema,
  imageUrl: z.string().nullable(),
  wholesaleMinQty: z.number().int().nullable(),
  isActive: z.boolean(),
  isFeatured: z.boolean(),
  isPublic: z.boolean(),
  /** Turunan, dihitung server. */
  isLowStock: z.boolean(),
  /** Turunan, dihitung server dalam basis point. */
  marginBps: z.number().int(),
  version: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ProductDto = z.infer<typeof productSchema>;

/** Product untuk katalog publik: tanpa harga modal, tanpa barcode internal. */
export const publicProductSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  categoryId: z.string().nullable(),
  categoryName: z.string().nullable(),
  priceSell: senSchema,
  priceWholesale: senSchema.nullable(),
  /** Disclose hanya bila katalog dibuka untuk harga grosir. */
  showWholesalePrice: z.boolean(),
  stock: z.number().int(),
  isAvailable: z.boolean(),
  unit: unitOfMeasureSchema,
  imageUrl: z.string().nullable(),
  isFeatured: z.boolean(),
});
export type PublicProductDto = z.infer<typeof publicProductSchema>;

export const productQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(120).optional(),
  categoryId: uuidSchema.optional(),
  /** Filter berdasar status stok. */
  stockState: z.enum(['all', 'inStock', 'lowStock', 'outOfStock']).default('all'),
  isActive: z.enum(['true', 'false', 'all']).default('all'),
  sort: z
    .enum(['name', '-name', 'createdAt', '-createdAt', 'stock', '-stock', 'priceSell', '-priceSell'])
    .default('name'),
});
export type ProductQuery = z.infer<typeof productQuerySchema>;

// ─── Stock movement ──────────────────────────────────────────────────────────

export const stockAdjustmentInputSchema = z
  .object({
    productId: uuidSchema,
    /** Selalu positif.arah ditentukan oleh `type`. */
    qty: z.number().int('Jumlah harus bilangan bulat').min(1).max(1_000_000),
    type: z.enum([
      'PURCHASE',
      'RETURN',
      'ADJUSTMENT_IN',
      'ADJUSTMENT_OUT',
      'DAMAGE',
      'EXPIRED',
    ]),
    notes: optionalTextSchema,
    /** Harga beli baru bila type=PURCHASE. Memperbarui priceBuy. */
    newCostPrice: senSchema.positive('Harga modal harus lebih besar dari nol').nullish(),
  })
  .refine((v) => v.type !== 'PURCHASE' || v.newCostPrice != null, {
    message: 'Pembelian wajib menyertakan harga modal terbaru',
    path: ['newCostPrice'],
  });
export type StockAdjustmentInput = z.infer<typeof stockAdjustmentInputSchema>;

/**
 * Stock opname: kirim hasil hitung fisik, sistem menghitung selisihnya.
 * Ini satu-satunya operasi stok yang boleh menaikkan DAN menurunkan stok
 * sekaligus dalam satu batch.
 */
export const stockOpnameInputSchema = z.object({
  notes: optionalTextSchema,
  lines: z
    .array(
      z.object({
        productId: uuidSchema,
        /** Hasil hitung fisik. Boleh nol. */
        countedQty: z.number().int().min(0).max(1_000_000),
      }),
    )
    .min(1, 'Minimal satu baris hasil hitung')
    .max(500, 'Maksimal 500 baris per sesi opname'),
});
export type StockOpnameInput = z.infer<typeof stockOpnameInputSchema>;

export const stockOpnameResultSchema = z.object({
  sessionId: uuidSchema,
  countedLines: z.number().int(),
  adjustedLines: z.number().int(),
  unchangedLines: z.number().int(),
  totalIn: senSchema,
  totalOut: senSchema,
  messages: z.array(z.string()),
});
export type StockOpnameResult = z.infer<typeof stockOpnameResultSchema>;

export const stockMovementQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  productId: uuidSchema.optional(),
  type: z
    .enum([
      'PURCHASE',
      'SALE',
      'RETURN',
      'ADJUSTMENT_IN',
      'ADJUSTMENT_OUT',
      'OPNAME',
      'DAMAGE',
      'EXPIRED',
    ])
    .optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type StockMovementQuery = z.infer<typeof stockMovementQuerySchema>;

export const stockMovementSchema = z.object({
  id: uuidSchema,
  productId: uuidSchema,
  productName: z.string(),
  type: z.string(),
  /** Selalu positif. Arah diturunkan dari `type`. */
  qty: z.number().int(),
  direction: z.enum(['IN', 'OUT']),
  stockBefore: z.number().int(),
  stockAfter: z.number().int(),
  refType: z.string().nullable(),
  refId: z.string().nullable(),
  notes: z.string().nullable(),
  unitCost: senSchema.nullable(),
  createdById: z.string().nullable(),
  createdByName: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type StockMovementDto = z.infer<typeof stockMovementSchema>;

/** Laporan kartu stok, perOpeningBarang. */
export const stockCardQuerySchema = z.object({
  productId: uuidSchema,
  from: z.coerce.date(),
  to: z.coerce.date(),
});
export type StockCardQuery = z.infer<typeof stockCardQuerySchema>;

export const stockCardRowSchema = z.object({
  date: z.string().datetime(),
  refNo: z.string().nullable(),
  type: z.string(),
  in: z.number().int(),
  out: z.number().int(),
  balance: z.number().int(),
});
export type StockCardRow = z.infer<typeof stockCardRowSchema>;

// ─── Bulk import ─────────────────────────────────────────────────────────────

export const bulkImportModeSchema = z.enum(['CREATE', 'UPSERT']);

export const bulkImportRowSchema = z.object({
  sku: skuSchema,
  barcode: barcodeSchema.nullish(),
  name: nameSchema,
  categoryName: shortTextSchema.nullish(),
  priceBuy: senSchema.positive('Harga modal wajib diisi dan lebih besar dari nol'),
  priceSell: senSchema.positive('Harga jual wajib diisi dan lebih besar dari nol'),
  stock: z.number().int().min(0).default(0),
  minStock: z.number().int().min(0).default(0),
  unit: unitOfMeasureSchema.default('PCS'),
});

/**
 * Hasil bulk import selalu per-baris, tidak pernah throw seluruh batch.
 * Satu baris salah tidak boleh menghapus 999 baris yang benar — kasir sedang
 * memindahkan data dari Excel dan butuh melihat mana yang perlu diperbaiki.
 */
export const bulkImportResultSchema = z.object({
  total: z.number().int(),
  created: z.number().int(),
  updated: z.number().int(),
  failed: z.number().int(),
  rows: z.array(
    z.object({
      rowNumber: z.number().int(),
      sku: z.string(),
      status: z.enum(['CREATED', 'UPDATED', 'FAILED', 'SKIPPED']),
      productId: z.string().uuid().optional(),
      error: z.string().optional(),
    }),
  ),
});
export type BulkImportResult = z.infer<typeof bulkImportResultSchema>;

export const categoryColorSchema = z.enum([
  'DEFAULT',
  'RED',
  'ORANGE',
  'AMBER',
  'GREEN',
  'TEAL',
  'BLUE',
  'INDIGO',
  'PURPLE',
  'PINK',
]);

export const createCategoryInputSchema = z.object({
  name: shortTextSchema,
  description: optionalTextSchema,
  parentId: uuidSchema.nullish(),
  color: categoryColorSchema.default('DEFAULT'),
  /** Batasi kedalaman hierarki. Warung tidak butuh lebih dari 3 tingkat. */
  maxDepth: z.number().int().min(1).max(3).optional(),
});
export type CreateCategoryInput = z.infer<typeof createCategoryInputSchema>;

export const updateCategoryInputSchema = createCategoryInputSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Tidak ada perubahan yang dikirim' });
export type UpdateCategoryInput = z.infer<typeof updateCategoryInputSchema>;

/** Anotasi eksplisit: skema rekursif via z.lazy tidak bisa disimpulkan TypeScript sendiri. */
export interface CategoryNode {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  parentId: string | null;
  parentName: string | null;
  color: z.infer<typeof categoryColorSchema>;
  imageUrl: string | null;
  sortOrder: number;
  isActive: boolean;
  productCount: number;
  children?: CategoryNode[];
}

export const categorySchema: z.ZodType<CategoryNode> = z.object({
  id: uuidSchema,
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  parentId: z.string().nullable(),
  parentName: z.string().nullable(),
  color: categoryColorSchema,
  imageUrl: z.string().nullable(),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
  /** Turunan: jumlah produk langsung dalam kategori. */
  productCount: z.number().int(),
  children: z.array(z.lazy((): z.ZodType<CategoryNode> => categorySchema)).optional(),
});
export type CategoryDto = z.infer<typeof categorySchema>;

export const reorderCategoriesInputSchema = z.object({
  items: z.array(z.object({ id: uuidSchema, sortOrder: z.number().int().min(0).max(10_000) })).min(1),
});
export type ReorderCategoriesInput = z.infer<typeof reorderCategoriesInputSchema>;

export const settingsSchema = z.object({
  storeName: nameSchema.default('Warung Saya'),
  storeTagline: shortTextSchema.nullish(),
  waPhoneNumber: z.string().trim().min(8).max(20),
  address: optionalTextSchema,
  /** Persentase dalam basis point. */
  taxBps: basisPointsSchema.default(1100),
  taxInclusive: z.boolean().default(true),
  taxLabel: shortTextSchema.default('PPN'),
  enableCashRounding: z.boolean().default(false),
  /** Kelipatan pecahan kas dalam SEN. 10.000 = Rp 100. */
  cashRoundingStepSen: z.number().int().min(100).max(1_000_000).default(10_000),
  receiptFooter: longTextSchemaDefault(),
  showWholesalePriceInCatalog: z.boolean().default(false),
  maxTransactionDiscountBps: basisPointsSchema.default(3000),
  invoicePrefix: shortTextSchema.default('INV'),
  currency: z.literal('IDR').default('IDR'),
});

function longTextSchemaDefault() {
  return optionalTextSchema.default(null);
}

export type SettingsDto = z.infer<typeof settingsSchema>;
