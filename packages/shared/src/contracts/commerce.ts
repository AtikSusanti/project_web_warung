import { z } from 'zod';

import {
  basisPointsSchema,
  nameSchema,
  optionalTextSchema,
  paginated,
  paginationMetaSchema,
  phoneSchema,
  senSchema,
  shortTextSchema,
  uuidSchema,
} from './common.js';

/**
 * Kontrak POS, Order, dan Credit (blueprint §5.3, §5.4, §5.5).
 *
 * Prinsip yang dipegang di file ini:
 *
 * 1. Client TIDAK pernah mengirim harga. Client hanya mengirim `productId` + `qty`.
 *    Server selalu mengambil harga dari master produk. Kalau client boleh
 *    menentukan harga, siapa pun yang bisa buka DevTools bisa menjual barang
 *    seharga Rp 1.
 *
 * 2. Client mengirim `expectedTotal` sebagai precondition, bukan sebagai
 *    sumber kebenaran. Server selalu menghitung ulang total dari harga master.
 *    Kalau berbeda, transaksi ditolak dengan 409 `TOTAL_MISMATCH` beserta
 *    total terbaru; transaksi dan stok tidak ditulis. Ini mencegah penjualan
 *    dengan total yang belum dikonfirmasi kasir.
 *
 * 3. `idempotencyKey` wajib untuk POS. Kanal kasir sering kehilangan koneksi
 *    di tengah POST; tanpa idempotency, retry akan mencatat penjualan dua kali.
 *
 * 4. Pembayaran adalah ARRAY, bukan enum tunggal. Warung nyata menerima
 *    "Rp 50.000 tunai, sisanya QRIS" dan "DP Rp 20.000, sisanya utang".
 */

// ─── POS: membuat transaksi ──────────────────────────────────────────────────

export const paymentInputSchema = z
  .object({
    method: z.enum(['CASH', 'TRANSFER', 'QRIS', 'DEBT']),
    /** Nominal yang diterima untuk metode ini, dalam sen. */
    amount: senSchema.nonnegative('Nominal tidak boleh negatif'),
    /** Referensi eksternal: kode QRIS, nomor transfer, id payment gateway. */
    reference: shortTextSchema.nullish(),
    /** Cashier override: jika iya, pembayaran boleh kurang dari total. */
    isCredit: z.boolean().optional(),
  })
  .refine((v) => v.amount > 0, { message: 'Nominal pembayaran harus lebih besar dari nol' });

export type PaymentInput = z.infer<typeof paymentInputSchema>;

export const transactionLineInputSchema = z.object({
  productId: uuidSchema,
  qty: z.number().int('Jumlah harus bilangan bulat').positive('Jumlah harus lebih dari nol'),
  /** Diskon per baris dalam basis point. Totalnya dibatasi UI. */
  discountBps: basisPointsSchema.optional(),
});
export type TransactionLineInput = z.infer<typeof transactionLineInputSchema>;

export const createTransactionInputSchema = z
  .object({
    lines: z
      .array(transactionLineInputSchema)
      .min(1, 'Transaksi harus memiliki minimal satu barang')
      .max(200, 'Maksimal 200 baris per transaksi'),
    /** Diskon tingkat transaksi. Persentase dalam basis point (5% = 500). */
    discountBps: basisPointsSchema.optional(),
    /** Bayar gabungan. Minimal satu metode. */
    payments: z
      .array(paymentInputSchema)
      .min(1, 'Minimal satu metode pembayaran')
      .max(4, 'Maksimal empat metode pembayaran dalam satu transaksi'),
    customerId: uuidSchema.nullish(),
    /** Pelanggan tanpa account, dicatat sebagai piutang berdasarkan nama saja. */
    customerWalkIn: z
      .object({
        name: nameSchema,
        phone: phoneSchema,
      })
      .nullish(),
    /** Tanggal jatuh tempo piutang. Default 30 hari. */
    dueDate: z.coerce.date().nullish(),
    note: optionalTextSchema,
    shiftId: uuidSchema.nullish(),
    /** Kunci idempotensi. Wajib untuk POS online dan untuk sync offline. */
    idempotencyKey: z.string().min(8).max(120),
    /** Precondition client; server menolak dengan 409 jika total berubah. */
    expectedTotal: senSchema.nonnegative().optional(),
    /** Penyesuaian pembulatan kas yang diizinkan untuk kasir, dalam basis point. */
    allowCashRounding: z.boolean().optional(),
    /** Dicetak ke struk setelah berhasil disimpan. */
    printReceipt: z.boolean().optional(),
  })
  .refine((v) => v.customerId == null || v.customerWalkIn == null, {
    message: 'Isi customerId ATAU customerWalkIn, jangan keduanya',
    path: ['customerWalkIn'],
  })
  .refine((v) => !v.payments.some((p) => p.method === 'DEBT') || v.customerId != null, {
    message: 'Pembayaran utang wajib memilih pelanggan',
    path: ['customerId'],
  })
  .superRefine((v, ctx) => {
    // Produk duplikat pada baris berbeda harus ditolak: bila UI gagal merge,
    // kasir bisa tanpa sengaja menjual 2x. Server tidak boleh menebak.
    // Map, bukan Set: butuh indeks baris pertama supaya pesan error bisa
    // menunjuk ke kedua lokasi yang bertabrakan.
    const firstIndexByProduct = new Map<string, number>();
    v.lines.forEach((line, i) => {
      const existing = firstIndexByProduct.get(line.productId);
      if (existing !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['lines', i, 'productId'],
          message: `Produk ini juga muncul di baris ${existing + 1}; kirim satu baris per produk`,
        });
      } else {
        firstIndexByProduct.set(line.productId, i);
      }
    });
  });

export type CreateTransactionInput = z.infer<typeof createTransactionInputSchema>;

// urutan deklarasi itu penting, bukan gaya penulisan.
//
// `z.object({ lines: z.array(transactionLineSchema) })` langsung memanggil
// `transactionLineSchema` saat modul ini dievaluasi. Kalau baris schema-nya
// ditulis lebih dulu, hasilnya ReferenceError "Cannot access before
// initialization" dan seluruh paket shared gagal di-import — bukan hanya
// transaksi yang rusak, tapi API dan web sekalian tidak bisa start.
//
// Karena itu schema anak selalu ditulis sebelum schema induknya yang memakainya.

export const transactionLineSchema = z.object({
  id: uuidSchema,
  productId: uuidSchema,
  sku: z.string(),
  productName: z.string(),
  qty: z.number().int(),
  unit: z.string(),
  unitPrice: senSchema,
  grossAmount: senSchema,
  discountAmount: senSchema,
  netAmount: senSchema,
  taxAmount: senSchema,
  totalAmount: senSchema,
  costPriceSnapshot: senSchema.nullable(),
});

export const transactionPaymentSchema = z.object({
  id: uuidSchema,
  method: z.enum(['CASH', 'TRANSFER', 'QRIS', 'DEBT']),
  amount: senSchema,
  reference: z.string().nullable(),
  paidAt: z.string().datetime(),
});

/** Respons setelah transaksi tersimpan. Seluruh nominal dalam sen. */
export const transactionSchema = z.object({
  id: uuidSchema,
  invoiceNo: z.string(),
  status: z.enum(['COMPLETED', 'VOIDED']),
  paymentStatus: z.enum(['PAID', 'UNPAID', 'PARTIAL', 'WRITTEN_OFF']),
  lines: z.array(transactionLineSchema),
  subtotal: senSchema,
  lineDiscountTotal: senSchema,
  transactionDiscountAmount: senSchema,
  discountTotal: senSchema,
  taxableBase: senSchema,
  taxTotal: senSchema,
  grandTotal: senSchema,
  roundedTotal: senSchema,
  roundingAdjustment: senSchema,
  paidTotal: senSchema,
  changeAmount: senSchema,
  outstandingAmount: senSchema,
  payments: z.array(transactionPaymentSchema),
  customerId: z.string().nullable(),
  customerName: z.string().nullable(),
  customerPhone: z.string().nullable(),
  cashierId: z.string(),
  cashierName: z.string(),
  shiftId: z.string().nullable(),
  dueDate: z.string().datetime().nullable(),
  note: z.string().nullable(),
  /** Selisih total yang nilainya berbeda dari server, kalau ada. */
  clientTotalMismatch: z.boolean().optional(),
  createdAt: z.string().datetime(),
  voidedAt: z.string().datetime().nullable(),
  voidedByName: z.string().nullable(),
  voidReason: z.string().nullable(),
});

export type TransactionDto = z.infer<typeof transactionSchema>;

export const transactionListItemSchema = transactionSchema
  .omit({ lines: true, payments: true })
  .extend({
    itemCount: z.number().int(),
    productNames: z.array(z.string()),
  });
export type TransactionListItemDto = z.infer<typeof transactionListItemSchema>;

export const transactionQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  paymentMethod: z.enum(['CASH', 'TRANSFER', 'QRIS', 'DEBT']).optional(),
  paymentStatus: z.enum(['PAID', 'UNPAID', 'PARTIAL', 'WRITTEN_OFF']).optional(),
  cashierId: uuidSchema.optional(),
  customerId: uuidSchema.optional(),
  search: z.string().trim().max(60).optional(),
  status: z.enum(['COMPLETED', 'VOIDED']).default('COMPLETED'),
});
export type TransactionQuery = z.infer<typeof transactionQuerySchema>;

/** Batalkan transaksi. Penyimpanan stok dikembalikan dan jurnal pembalik dibuat. */
export const voidTransactionInputSchema = z.object({
  reason: shortTextSchema.min(3, 'Alasan pembatalan wajib diisi, minimal 3 karakter'),
  /** Mengembalikan stok. Default true. */
  restoreStock: z.boolean().default(true),
});
export type VoidTransactionInput = z.infer<typeof voidTransactionInputSchema>;

// ─── Shift kasir ─────────────────────────────────────────────────────────────

export const openShiftInputSchema = z.object({
  /** Uang tunai awal di laci. */
  openingFloat: senSchema.nonnegative().default(0),
  note: optionalTextSchema,
});
export type OpenShiftInput = z.infer<typeof openShiftInputSchema>;

export const closeShiftInputSchema = z.object({
  /** Uang tunai yang dihitung fisik. */
  countedCash: senSchema.nonnegative(),
  note: optionalTextSchema,
  /** Minta persetujuan supervisor untuk selisih di atas ambang tertentu. */
  acknowledgeDiscrepancy: z.boolean().optional(),
});
export type CloseShiftInput = z.infer<typeof closeShiftInputSchema>;

export const shiftSchema = z.object({
  id: uuidSchema,
  openedById: z.string(),
  openedByName: z.string(),
  closedById: z.string().nullable(),
  closedByName: z.string().nullable(),
  status: z.enum(['OPEN', 'CLOSED']),
  openingFloat: senSchema,
  countedCash: senSchema.nullable(),
  expectedCash: senSchema.nullable(),
  difference: senSchema.nullable(),
  transactionCount: z.number().int(),
  salesTotal: senSchema,
  note: z.string().nullable(),
  openedAt: z.string().datetime(),
  closedAt: z.string().datetime().nullable(),
});
export type ShiftDto = z.infer<typeof shiftSchema>;

// ─── Order + WhatsApp ────────────────────────────────────────────────────────

export const orderLineInputSchema = z.object({
  productId: uuidSchema,
  qty: z.number().int().positive('Jumlah harus lebih dari nol'),
});
export type OrderLineInput = z.infer<typeof orderLineInputSchema>;

export const createOrderInputSchema = z.object({
  customerName: nameSchema,
  customerPhone: phoneSchema,
  lines: z.array(orderLineInputSchema).min(1, 'Keranjang tidak boleh kosong').max(100),
  note: optionalTextSchema,
  /** Pesan pelanggan diambil alih admin untuk dikirim manual lewat WA. */
  adminNote: optionalTextSchema,
  idempotencyKey: z.string().min(8).max(120).optional(),
});
export type CreateOrderInput = z.infer<typeof createOrderInputSchema>;

// Lihat catatan urutan deklarasi di atas `transactionLineSchema`: baris harus
// ditulis sebelum induknya yang meng-array()-kan.
export const orderLineSchema = z.object({
  id: uuidSchema,
  productId: uuidSchema,
  sku: z.string(),
  productName: z.string(),
  qty: z.number().int(),
  unit: z.string(),
  unitPrice: senSchema,
  total: senSchema,
  /** Stok saat pesanan dibuat, untuk jejak historis. */
  stockAtOrder: z.number().int().nullable(),
});

export const orderSchema = z.object({
  id: uuidSchema,
  orderNo: z.string(),
  customerName: z.string(),
  customerPhone: z.string(),
  lines: z.array(orderLineSchema),
  subtotal: senSchema,
  discountTotal: senSchema,
  total: senSchema,
  status: z.enum(['PENDING_WA', 'WA_SENT', 'CONFIRMED', 'CONVERTED', 'CANCELLED']),
  note: z.string().nullable(),
  /** Pesan yang sudah di-render, disimpan untuk audit. */
  waMessage: z.string().nullable(),
  waUrl: z.string().nullable(),
  /** Diiisi setelah konfirmasi ke pelanggan via WA Business API. */
  waSentAt: z.string().datetime().nullable(),
  confirmedAt: z.string().datetime().nullable(),
  cancelledAt: z.string().datetime().nullable(),
  convertedTransactionId: z.string().nullable(),
  transactionId: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type OrderDto = z.infer<typeof orderSchema>;

export const updateOrderStatusInputSchema = z.object({
  status: z.enum(['WA_SENT', 'CONFIRMED', 'CANCELLED']),
  note: optionalTextSchema,
});
export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusInputSchema>;

export const orderQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z
    .enum(['PENDING_WA', 'WA_SENT', 'CONFIRMED', 'CONVERTED', 'CANCELLED', 'all'])
    .default('all'),
  search: z.string().trim().max(120).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type OrderQuery = z.infer<typeof orderQuerySchema>;

/** Konversi order menjadi transaksi POS setelah pelanggan mengonfirmasi. */
export const convertOrderInputSchema = z.object({
  payments: z.array(paymentInputSchema).min(1),
  customerId: uuidSchema.nullish(),
  discountBps: basisPointsSchema.optional(),
  idempotencyKey: z.string().min(8).max(120),
  /** Jangan potong stok lagi kalau sudah dipotong saat order dibuat. */
  skipStockDeduction: z.boolean().optional(),
});
export type ConvertOrderInput = z.infer<typeof convertOrderInputSchema>;

// ─── Customer & piutang ──────────────────────────────────────────────────────

export const createCustomerInputSchema = z.object({
  name: nameSchema,
  phone: phoneSchema,
  address: optionalTextSchema,
  /** Limit kredit dalam sen. Nol = tanpa limit. */
  creditLimit: senSchema.nonnegative().default(0),
  note: optionalTextSchema,
});
export type CreateCustomerInput = z.infer<typeof createCustomerInputSchema>;

export const updateCustomerInputSchema = createCustomerInputSchema
  .partial()
  .extend({ status: z.enum(['ACTIVE', 'BLOCKED']).optional() })
  .refine((v) => Object.keys(v).length > 0, { message: 'Tidak ada perubahan yang dikirim' });
export type UpdateCustomerInput = z.infer<typeof updateCustomerInputSchema>;

export const customerSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  phone: z.string(),
  address: z.string().nullable(),
  creditLimit: senSchema,
  /** Turunan dari agregasi piutang, bukan kolom yang bisa basi. */
  balanceDue: senSchema,
  availableCredit: senSchema,
  overdueAmount: senSchema,
  overdueDays: z.number().int().nullable(),
  transactionCount: z.number().int(),
  lastTransactionAt: z.string().datetime().nullable(),
  status: z.enum(['ACTIVE', 'BLOCKED']),
  note: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type CustomerDto = z.infer<typeof customerSchema>;

export const customerQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(120).optional(),
  status: z.enum(['ACTIVE', 'BLOCKED', 'all']).default('all'),
  hasDebt: z.enum(['true', 'false', 'all']).default('all'),
  sort: z
    .enum(['name', '-name', 'balanceDue', '-balanceDue', 'createdAt', '-createdAt'])
    .default('name'),
});
export type CustomerQuery = z.infer<typeof customerQuerySchema>;

export const receivableCustomerQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(120).optional(),
});
export type ReceivableCustomerQuery = z.infer<typeof receivableCustomerQuerySchema>;

export const receivableCustomerSchema = z.object({
  customerId: uuidSchema,
  customerName: z.string(),
  customerPhone: z.string(),
  customerStatus: z.enum(['ACTIVE', 'BLOCKED']),
  creditLimit: senSchema,
  balanceDue: senSchema,
  availableCredit: senSchema,
  overdueAmount: senSchema,
  oldestDueDate: z.string().datetime().nullable(),
  overdueDays: z.number().int().nullable(),
  invoiceCount: z.number().int(),
  unpaidInvoiceCount: z.number().int(),
  partialInvoiceCount: z.number().int(),
  paymentStatus: z.enum(['UNPAID', 'PARTIAL']),
  lastTransactionAt: z.string().datetime().nullable(),
});
export type ReceivableCustomer = z.infer<typeof receivableCustomerSchema>;

export const receivableCustomerListSchema = paginated(receivableCustomerSchema);
export type ReceivableCustomerList = z.infer<typeof receivableCustomerListSchema>;

/**
 * Pembayaran utang.
 *
 * Allocation: oldest-invoice-first (FIFO). Bila `transactionIds` diisi secara
 * eksplisit, pembayaran dialokasikan ke invoice yang disebutkan dalam urutan
 * tersebut, dan sistem menolak bila totalnya melebihi sisa tagihan yang dipilih.
 */
export const payDebtInputSchema = z
  .object({
    customerId: uuidSchema,
    amount: senSchema.positive('Nominal pembayaran harus lebih besar dari nol'),
    method: z.enum(['CASH', 'TRANSFER', 'QRIS']),
    receivedById: uuidSchema.nullish(),
    reference: shortTextSchema.nullish(),
    /** Alokasi eksplisit. Kosong = FIFO otomatis. */
    allocations: z
      .array(
        z.object({
          transactionId: uuidSchema,
          amount: senSchema.positive('Alokasi harus lebih besar dari nol'),
        }),
      )
      .max(100)
      .optional(),
    paidAt: z.coerce.date().optional(),
    note: optionalTextSchema,
    idempotencyKey: z.string().min(8).max(120),
  })
  .refine(
    (v) =>
      v.allocations?.length ? v.allocations.reduce((a, x) => a + x.amount, 0) === v.amount : true,
    {
      message: 'Jumlah alokasi harus sama dengan nominal pembayaran',
      path: ['allocations'],
    },
  );
export type PayDebtInput = z.infer<typeof payDebtInputSchema>;

export const debtAllocationSchema = z.object({
  transactionId: uuidSchema,
  invoiceNo: z.string(),
  dueDate: z.string().datetime().nullable(),
  allocatedAmount: senSchema,
  remainingAfter: senSchema,
  statusBefore: z.enum(['UNPAID', 'PARTIAL', 'PAID', 'WRITTEN_OFF']),
  statusAfter: z.enum(['UNPAID', 'PARTIAL', 'PAID', 'WRITTEN_OFF']),
});

export const debtPaymentSchema = z.object({
  id: uuidSchema,
  customerId: uuidSchema,
  customerName: z.string(),
  amount: senSchema,
  method: z.enum(['CASH', 'TRANSFER', 'QRIS']),
  reference: z.string().nullable(),
  receivedById: z.string().nullable(),
  receivedByName: z.string().nullable(),
  allocations: z.array(debtAllocationSchema),
  balanceBefore: senSchema,
  balanceAfter: senSchema,
  note: z.string().nullable(),
  paidAt: z.string().datetime(),
  createdAt: z.string().datetime(),
});
export type DebtPaymentDto = z.infer<typeof debtPaymentSchema>;

export const payDebtResultSchema = z.object({
  payment: debtPaymentSchema,
  customer: customerSchema,
  /** Tagihan yang otomatis dilunasi oleh pembayaran ini. */
  settledInvoiceNos: z.array(z.string()),
});
export type PayDebtResult = z.infer<typeof payDebtResultSchema>;

/** Hapus aset utang (tidak pernah dihapus dari pembukuan, hanya dihapus dari piutang). */
export const writeOffDebtInputSchema = z.object({
  customerId: uuidSchema,
  amount: senSchema.positive('Nominal hapus aset harus lebih besar dari nol'),
  reason: shortTextSchema.min(3, 'Alasan hapus aset wajib diisi'),
  transactionIds: z.array(uuidSchema).max(100).optional(),
  idempotencyKey: z.string().min(8).max(120),
});
export type WriteOffDebtInput = z.infer<typeof writeOffDebtInputSchema>;

export const customerDebtInvoiceSchema = z.object({
  transactionId: uuidSchema,
  invoiceNo: z.string(),
  total: senSchema,
  paidAmount: senSchema,
  outstandingAmount: senSchema,
  transactionDate: z.string().datetime(),
  dueDate: z.string().datetime().nullable(),
  daysOverdue: z.number().int(),
  agingBucket: z.string(),
  status: z.enum(['UNPAID', 'PARTIAL', 'PAID', 'WRITTEN_OFF']),
  items: z.array(
    z.object({
      productName: z.string(),
      qty: z.number().int(),
      unitPrice: senSchema,
      totalAmount: senSchema,
    }),
  ),
});
export type CustomerDebtInvoice = z.infer<typeof customerDebtInvoiceSchema>;

export const customerDebtPaymentHistorySchema = z.object({
  id: uuidSchema,
  amount: senSchema,
  method: z.enum(['CASH', 'TRANSFER', 'QRIS']),
  reference: z.string().nullable(),
  note: z.string().nullable(),
  paidAt: z.string().datetime(),
});
export type CustomerDebtPaymentHistory = z.infer<typeof customerDebtPaymentHistorySchema>;

/** Detail piutang pelanggan. */
export const customerDebtDetailSchema = z.object({
  customer: customerSchema,
  /** Invoice yang masih memiliki sisa tagihan. */
  outstanding: z.array(customerDebtInvoiceSchema),
  /** Seluruh invoice berjalan, termasuk yang sudah lunas. */
  invoices: z.array(customerDebtInvoiceSchema),
  payments: z.array(customerDebtPaymentHistorySchema),
  aging: z.object({
    current: senSchema,
    d1_30: senSchema,
    d31_60: senSchema,
    d61_90: senSchema,
    d90_plus: senSchema,
  }),
});
export type CustomerDebtDetail = z.infer<typeof customerDebtDetailSchema>;

export const customerDebtListSchema = customerDebtDetailSchema.omit({
  invoices: true,
  payments: true,
});
export type CustomerDebtList = z.infer<typeof customerDebtListSchema>;

export const agingQuerySchema = z.object({
  asOf: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type AgingQuery = z.infer<typeof agingQuerySchema>;

export const agingReportSchema = z.object({
  asOf: z.string().datetime(),
  buckets: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      amount: senSchema,
      invoiceCount: z.number().int(),
      customerCount: z.number().int(),
    }),
  ),
  total: senSchema,
  topDebtors: z.array(
    z.object({
      customerId: uuidSchema,
      customerName: z.string(),
      customerPhone: z.string(),
      balanceDue: senSchema,
      oldestDays: z.number().int(),
    }),
  ),
});
export type AgingReport = z.infer<typeof agingReportSchema>;

/** Kirim pengingat utang via WhatsApp. Kanal `wa.me` dipakai bila Cloud API belum aktif. */
export const sendDebtReminderInputSchema = z.object({
  customerId: uuidSchema,
  message: z.string().trim().min(10, 'Pesan terlalu pendek').max(1000),
});
export type SendDebtReminderInput = z.infer<typeof sendDebtReminderInputSchema>;

// ─── Laporan ringkas (Phase 1) ───────────────────────────────────────────────

export const dashboardQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;

export const dashboardSchema = z.object({
  period: z.object({ from: z.string().datetime(), to: z.string().datetime() }),
  sales: z.object({
    todayTotal: senSchema,
    todayCount: z.number().int(),
    monthTotal: senSchema,
    monthCount: z.number().int(),
    /** Rata-rata nilai per transaksi (basket size). */
    averageBasket: senSchema,
    /** Perubahan dibanding periode sebelumnya, basis point. */
    vsPreviousBps: z.number().int().nullable(),
    byMethod: z.array(z.object({ method: z.string(), total: senSchema, count: z.number().int() })),
  }),
  receivables: z.object({
    total: senSchema,
    customerCount: z.number().int(),
    overdue: senSchema,
    overdueCustomerCount: z.number().int(),
    byAgingBucket: z.array(z.object({ key: z.string(), label: z.string(), amount: senSchema })),
  }),
  inventory: z.object({
    productCount: z.number().int(),
    totalStockValue: senSchema,
    lowStockCount: z.number().int(),
    outOfStockCount: z.number().int(),
    topSelling: z.array(
      z.object({
        productId: uuidSchema,
        name: z.string(),
        qtySold: z.number().int(),
        total: senSchema,
      }),
    ),
  }),
  recentTransactions: z.array(transactionListItemSchema),
});
export type DashboardDto = z.infer<typeof dashboardSchema>;

/**
 * Laporan penjualan periode (Phase 1).
 *
 * PENTING: ini BUKAN laporan keuangan SAK EMKM. Ini rekap penjualan dari
 * `transactions`. Neraca, laba rugi, dan arus kas butuh Phase 3 (double-entry).
 * Jangan beri label "laporan keuangan" pada angka di sini — itu menyesatkan
 * untuk keputusan bisnis dan berisiko untuk keperluan pajak.
 */
export const salesReportQuerySchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  groupBy: z.enum(['day', 'week', 'month', 'category', 'product', 'paymentMethod']).default('day'),
});
export type SalesReportQuery = z.infer<typeof salesReportQuerySchema>;

export const salesReportSchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  groupBy: z.string(),
  summary: z.object({
    grossTotal: senSchema,
    discountTotal: senSchema,
    netTotal: senSchema,
    taxTotal: senSchema,
    transactionCount: z.number().int(),
    itemCount: z.number().int(),
    averageBasket: senSchema,
  }),
  rows: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      total: senSchema,
      transactionCount: z.number().int(),
      itemCount: z.number().int(),
    }),
  ),
  meta: paginationMetaSchema.optional(),
});
export type SalesReportDto = z.infer<typeof salesReportSchema>;

export const exportFormatSchema = z.enum(['csv', 'xlsx', 'json']);
