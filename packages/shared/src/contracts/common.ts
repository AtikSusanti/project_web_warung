import { z } from 'zod';

/**
 * Kontrak API bersama.
 *
 * Skema Zod di sini dipakai di dua tempat:
 * 1. Server: `ZodValidationPipe` mem-parse body/query/param sebelum controller.
 * 2. Client: React Hook Form + zodResolver memvalidasi form dengan aturan yang
 *    PERSIS sama, sehingga user tidak pernah mendapat error validasi dari
 *    server yang seharusnya sudah tertangkap di form.
 *
 * Konvensi nama: `xxxInput` untuk payload masuk, `xxxSchema` untuk entitas
 * keluar, `xxxResponse` untuk amplop respons. Semua suffix `Schema` bisa
 * di-`parse` langsung dari JSON.
 */

// ─── Primitif bersama ────────────────────────────────────────────────────────

/** Sen sebagai integer. Dilindungi dari float dan dari presisi berlebihan. */
export const senSchema = z
  .number()
  .int('Nilai uang harus bilangan bulat (sen), bukan pecahan')
  .safe('Nilai uang melebihi batas presisi aman')
  .describe('Uang dalam satuan kecil (sen)');

/** Basis point: 1% = 100. Integer, 0..10000. */
export const basisPointsSchema = z
  .number()
  .int('Persentase harus dalam basis point bilangan bulat')
  .min(0)
  .max(10_000, 'Persentase tidak boleh melebihi 100%');

/** Nomor HP Indonesia, dinormalisasi ke 62xxx. */
export const phoneSchema = z
  .string()
  .trim()
  .transform(normalizePhone)
  .refine((v) => v !== null, { message: 'Nomor HP tidak valid. Contoh: 081234567890' })
  .refine((v) => /^628[0-9]{8,13}$/.test(v ?? ''), {
    message: 'Nomor harus WhatsApp aktif dan diawali 62',
  });

function normalizePhone(input: string): string | null {
  let digits = input.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (digits.startsWith('0')) digits = `62${digits.slice(1)}`;
  if (!digits.startsWith('62')) return null;
  return digits.slice(0, 15);
}

/** UUID v4. Prisma `@default(uuid())` menghasilkan UUID v4. */
export const uuidSchema = z.string().uuid('Format ID tidak valid');

/** Teks yang boleh masuk ke <input> dan kolom database. */
export const shortTextSchema = z.string().trim().min(1, 'Wajib diisi').max(120);
export const longTextSchema = z.string().trim().max(2000);
export const optionalTextSchema = z.string().trim().max(2000).nullish().transform((v) => v ?? null);

/** Nama orang/Toko: boleh huruf, angka, spasi, titik, koma, tanda hubung. */
export const nameSchema = z
  .string()
  .trim()
  .min(1, 'Wajib diisi')
  .max(120)
  .regex(/^[\p{L}\p{N} .,'&()-]+$/u, 'Karakter tidak valid');

/**
 * Normalisasi SKU untuk menyamakan berbagai penulisan dari kasir:
 * lowercase, spasi jadi `-`, spasi berlebih dipadatkan, maksimal 64 char.
 * Contoh: "Indomie Goreng " -> "indomie-goreng".
 */
export const skuSchema = z
  .string()
  .trim()
  .min(1, 'SKU wajib diisi')
  .max(64)
  .transform((v) =>
    v
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9\-._]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, ''),
  )
  .refine((v) => v.length > 0, 'SKU tidak boleh hanya berisi spasi atau simbol');

/** Kode barcode EAN-8/UPC-A/EAN-13. Numeric saja. */
export const barcodeSchema = z
  .string()
  .trim()
  .regex(/^\d{8}$|^\d{12,13}$/, 'Barcode harus 8 digit (EAN-8) atau 12-13 digit (UPC/EAN-13)');

/** Slug URL aman untuk katalog publik. */
export const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .transform((v) =>
    v
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, ''),
  )
  .refine((v) => v.length > 0, 'Slug tidak boleh kosong');

// ─── Pagination & amplop respons ─────────────────────────────────────────────

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(120).optional(),
  sort: z.string().trim().max(40).optional(),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export const paginationMetaSchema = z.object({
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
  hasNext: z.boolean(),
  hasPrev: z.boolean(),
});

export type PaginationMeta = z.infer<typeof paginationMetaSchema>;

export function buildPaginationMeta(total: number, page: number, pageSize: number): PaginationMeta {
  const totalPages = pageSize > 0 ? Math.ceil(total / pageSize) : 0;
  return {
    page,
    pageSize,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
}

/** Amplop daftar berkurasi. */
export function paginated<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    data: z.array(item),
    meta: paginationMetaSchema,
  });
}

/**
 * Amplop respons standar untuk seluruh API.
 *
 * Bentuk `data` nullable dipakai agar error dan sukses tidak mengubah
 * bentuk JSON, sehingga parser di client tidak perlu bercabang.
 */
export const apiResponseSchema = <T extends z.ZodTypeAny>(data: T) =>
  z.object({
    success: z.boolean(),
    data: data.nullable(),
    meta: paginationMetaSchema.optional(),
    error: apiErrorSchema.nullable().optional(),
  });

/** Bentuk error yang konsisten. `details` dipakai form untuk menandai field. */
export const apiErrorSchema = z.object({
  code: z.string().min(1).max(64),
  message: z.string().min(1).max(500),
  statusCode: z.number().int(),
  details: z.record(z.string(), z.array(z.string())).optional(),
  requestId: z.string().optional(),
});

export type ApiErrorShape = z.infer<typeof apiErrorSchema>;

export type ApiResponse<T> = {
  success: true;
  data: T;
  meta?: PaginationMeta;
  error?: never;
} | {
  success: false;
  data: null;
  error: ApiErrorShape;
  meta?: never;
};

/** Kode error domain yang dipetakan ke HTTP status oleh filter exception. */
export const ERROR_CODES = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  DUPLICATE_SKU: 'DUPLICATE_SKU',
  INSUFFICIENT_STOCK: 'INSUFFICIENT_STOCK',
  INSUFFICIENT_CREDIT_LIMIT: 'INSUFFICIENT_CREDIT_LIMIT',
  INVALID_STATE_TRANSITION: 'INVALID_STATE_TRANSITION',
  PAYMENT_SHORTFALL: 'PAYMENT_SHORTFALL',
  TOTAL_MISMATCH: 'TOTAL_MISMATCH',
  IDEMPOTENCY_MISMATCH: 'IDEMPOTENCY_MISMATCH',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

// ─── Auth ────────────────────────────────────────────────────────────────────

export const passwordSchema = z
  .string()
  .min(8, 'Kata sandi minimal 8 karakter')
  .max(128, 'Kata sandi terlalu panjang')
  .refine((v) => /[a-z]/.test(v), 'Kata sandi harus memuat huruf kecil')
  .refine((v) => /[A-Z]/.test(v), 'Kata sandi harus memuat huruf besar')
  .refine((v) => /\d/.test(v), 'Kata sandi harus memuat angka');

export const usernameSchema = z
  .string()
  .trim()
  .min(3, 'Username minimal 3 karakter')
  .max(32)
  .regex(/^[a-z0-9._-]+$/i, 'Username hanya boleh huruf, angka, titik, underscore, dan strip');

export const loginInputSchema = z.object({
  username: usernameSchema,
  password: z.string().min(1, 'Kata sandi wajib diisi').max(128),
});
export type LoginInput = z.infer<typeof loginInputSchema>;

export const refreshTokenInputSchema = z.object({
  refreshToken: z.string().min(20).max(512),
});
export type RefreshTokenInput = z.infer<typeof refreshTokenInputSchema>;

export const changePasswordInputSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: passwordSchema,
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: 'Kata sandi baru harus berbeda dari yang lama',
    path: ['newPassword'],
  });
export type ChangePasswordInput = z.infer<typeof changePasswordInputSchema>;
