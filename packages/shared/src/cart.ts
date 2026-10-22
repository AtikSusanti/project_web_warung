import { MAX_LINE_DISCOUNT_BPS, MAX_TAX_BASIS_POINTS, MAX_TRANSACTION_DISCOUNT_BPS } from './constants.js';
import {
  allocate,
  DEFAULT_CASH_ROUNDING_STEP,
  percentOf,
  roundCash,
  sen,
  sum,
  taxPortionInclusive,
  type Sen,
  ZERO,
} from './money.js';

/**
 * KALKULASI TRANSAKSI — fungsi murni, tanpa I/O, tanpa efek samping.
 *
 * Fungsi ini adalah satu-satunya tempat di codebase yang boleh menghitung
 * subtotal / diskon / pajak / total. Kasir melihat pratinjau dengan fungsi ini
 * di browser, server memverifikasi ulang dengan fungsi yang sama saat menyimpan.
 * Karena identik, tidak mungkin ada selisih antara yang ditampilkan kasir dan
 * yang tercatat di database.
 *
 * Semua uang dalam sen (lihat money.ts). Tidak ada `number` pecahan di mana pun.
 */

export interface CartLineInput {
  productId: string;
  sku: string;
  /** Nama saat transaksi. Disalin dari master agar struk historis tetap terbaca. */
  name: string;
  qty: number;
  /** Harga jual authoritative dari server. Nilai dari client diabaikan. */
  unitPrice: Sen;
  /** Diskon per baris dalam basis point. 10% = 1000. */
  discountBps?: number;
}

export interface CalculateCartOptions {
  /** Diskon tingkat transaksi dalam basis point. 5% = 500. */
  transactionDiscountBps?: number;
  /** PPN dalam basis point. 11% = 1100. */
  taxBps?: number;
  /** Bila true (default), harga jual sudah termasuk PPN dan PPN tidak menambah total. */
  pricesIncludeTax?: boolean;
  /** Pembulatan kas ke pecahan terdekat. */
  cashRounding?: boolean;
  /** Kelipatan pecahan kas dalam sen. Default 10.000 = Rp 100. */
  cashRoundingStep?: number;
}

export interface CalculatedLine {
  productId: string;
  sku: string;
  name: string;
  qty: number;
  unitPrice: Sen;
  /** qty x unitPrice, sebelum diskon apa pun. */
  grossAmount: Sen;
  /** Diskon per baris. */
  lineDiscountAmount: Sen;
  /** Porsi diskon tingkat transaksi yang dialokasikan ke baris ini. */
  transactionDiscountAmount: Sen;
  /** Total diskon baris ini. */
  discountAmount: Sen;
  /** gross - discount. Dasar pengenaan pajak bila harga belum termasuk pajak. */
  netAmount: Sen;
  /** Porsi PPN yang melekat pada baris ini (informasi pelaporan bila inklusif). */
  taxAmount: Sen;
  /** Tagihan akhir baris ini. */
  totalAmount: Sen;
}

export interface CalculatedCart {
  lines: CalculatedLine[];
  /** Σ grossAmount. */
  subtotal: Sen;
  lineDiscountTotal: Sen;
  /** Diskon tingkat transaksi. */
  transactionDiscountAmount: Sen;
  /** lineDiscountTotal + transactionDiscountAmount. */
  discountTotal: Sen;
  /** Σ netAmount. Dasar pajak bila harga belum termasuk pajak. */
  taxableBase: Sen;
  /** Σ taxAmount. */
  taxTotal: Sen;
  /** taxableBase + taxTotal (exclusive) atau taxableBase (inclusive). */
  grandTotal: Sen;
  /** grandTotal setelah pembulatan kas. */
  roundedTotal: Sen;
  /** Selisih akibat pembulatan kas. Tercatat sebagai account "Pembulatan Kas". */
  roundingAdjustment: Sen;
}

export class CartCalculationError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'EMPTY_CART'
      | 'INVALID_QTY'
      | 'INVALID_PRICE'
      | 'INVALID_DISCOUNT'
      | 'INVALID_TAX',
  ) {
    super(message);
    this.name = 'CartCalculationError';
  }
}

function assertValidBps(value: number | undefined, fallback: number, max: number, label: string) {
  const v = value ?? fallback;
  if (!Number.isInteger(v) || v < 0 || v > max) {
    throw new CartCalculationError(`${label} tidak valid: ${v}`, 'INVALID_DISCOUNT');
  }
  return v;
}

/**
 * Menghitung seluruh nilai transaksi secara deterministik.
 *
 * Urutan operasi penting dan tidak boleh diacak:
 * 1. gross per baris = qty x harga
 * 2. diskon per baris
 * 3. diskon tingkat transaksi dialokasikan proporsional terhadap nilai bersih
 *    baris, memakai largest-remainder agar totalnya pas
 * 4. baru setelah itu pajak dihitung
 * 5. pembulatan kas imposed terakhir, hanya pada total
 *
 * Menghitung pajak sebelum alokasi diskon transaksi adalah bug klasik yang
 * membuat nominal PPN reported tidak cocok dengan sistem.
 */
export function calculateCart(
  inputs: readonly CartLineInput[],
  options: CalculateCartOptions = {},
): CalculatedCart {
  if (inputs.length === 0) {
    throw new CartCalculationError('Keranjang tidak boleh kosong', 'EMPTY_CART');
  }

  const transactionDiscountBps = assertValidBps(
    options.transactionDiscountBps,
    0,
    MAX_TRANSACTION_DISCOUNT_BPS,
    'Diskon transaksi',
  );
  const taxBps = options.taxBps ?? 0;
  if (!Number.isInteger(taxBps) || taxBps < 0 || taxBps > MAX_TAX_BASIS_POINTS) {
    throw new CartCalculationError(`Tarif pajak tidak valid: ${taxBps}`, 'INVALID_TAX');
  }
  const pricesIncludeTax = options.pricesIncludeTax ?? true;

  // ── Langkah 1-2: gross dan diskon per baris ───────────────────────────────
  const staged = inputs.map((input, index) => {
    if (!Number.isInteger(input.qty) || input.qty <= 0) {
      throw new CartCalculationError(`Jumlah baris ke-${index + 1} tidak valid: ${input.qty}`, 'INVALID_QTY');
    }
    if (!Number.isSafeInteger(input.unitPrice) || input.unitPrice < 0) {
      throw new CartCalculationError(
        `Harga baris ke-${index + 1} tidak valid: ${input.unitPrice}`,
        'INVALID_PRICE',
      );
    }
    const lineDiscountBps = assertValidBps(
      input.discountBps,
      0,
      MAX_LINE_DISCOUNT_BPS,
      `Diskon baris ke-${index + 1}`,
    );
    const grossAmount = sen(input.unitPrice * input.qty);
    const lineDiscountAmount = percentOf(grossAmount, lineDiscountBps);
    return {
      input,
      grossAmount,
      lineDiscountAmount,
      netAmount: sen(grossAmount - lineDiscountAmount),
    };
  });

  const subtotal = sum(...staged.map((s) => s.grossAmount));
  const lineDiscountTotal = sum(...staged.map((s) => s.lineDiscountAmount));

  // ── Langkah 3: alokasi diskon tingkat transaksi ────────────────────────────
  const discountPool = percentOf(sen(subtotal - lineDiscountTotal), transactionDiscountBps);
  const allocated = allocate(discountPool, staged.map((s) => s.netAmount));

  // ── Langkah 4: pajak per baris ────────────────────────────────────────────
  //
  // Harga INKLUSIF: PPN yang melekat dihitung sebagai bagian dari harga
  // (`nilai x tarif / (1 + tarif)`), bukan `nilai x tarif`. Selisihnya nyata:
  // untuk tarif 11%, cara naif overstated sebesar 11%.
  //
  // Harga EKSKLUSIF: PPN dihitung sekali pada total tingkat transaksi
  // (`percentOf` di bawah). Nilai per baris dibiarkan nol supaya tidak ada
  // dua angka PPN yang berbeda dalam satu transaksi. Phase 3 yang memerlukan
  // PPN per baris untuk jurnal, dengan `taxPortionInclusive` yang sama.
  const lines: CalculatedLine[] = staged.map((s, i) => {
    const transactionDiscount = allocated[i] ?? ZERO;
    const discountAmount = sen(s.lineDiscountAmount + transactionDiscount);
    const netAmount = sen(s.grossAmount - discountAmount);
    const taxAmount = pricesIncludeTax ? taxPortionInclusive(netAmount, taxBps) : ZERO;
    return {
      productId: s.input.productId,
      sku: s.input.sku,
      name: s.input.name,
      qty: s.input.qty,
      unitPrice: s.input.unitPrice,
      grossAmount: s.grossAmount,
      lineDiscountAmount: s.lineDiscountAmount,
      transactionDiscountAmount: transactionDiscount,
      discountAmount,
      netAmount,
      taxAmount,
      totalAmount: netAmount,
    };
  });

  const transactionDiscountAmount = sum(...lines.map((l) => l.transactionDiscountAmount));
  const discountTotal = sum(...lines.map((l) => l.discountAmount));
  const taxableBase = sum(...lines.map((l) => l.netAmount));

  // Harga inklusif: total = taxableBase, PPN hanya dicatat untuk pelaporan.
  // Harga eksklusif: total = taxableBase + PPN dihitung dari taxableBase.
  const taxTotal = pricesIncludeTax
    ? sum(...lines.map((l) => l.taxAmount))
    : percentOf(taxableBase, taxBps);

  const grandTotal = pricesIncludeTax ? taxableBase : sen(taxableBase + taxTotal);

  // ── Langkah 5: pembulatan kas ──────────────────────────────────────────────
  let roundedTotal = grandTotal;
  let roundingAdjustment = ZERO;
  if (options.cashRounding) {
    roundedTotal = roundCash(
      grandTotal,
      options.cashRoundingStep ?? DEFAULT_CASH_ROUNDING_STEP,
      'down',
    );
    roundingAdjustment = sen(roundedTotal - grandTotal);
  }

  return {
    lines,
    subtotal,
    lineDiscountTotal,
    transactionDiscountAmount,
    discountTotal,
    taxableBase,
    taxTotal,
    grandTotal,
    roundedTotal,
    roundingAdjustment,
  };
}

/**
 * Menghitung kembalian dan memvalidasi kecukupan pembayaran.
 *
 * Pembayaran gabungan (tunai + QRIS, atau DP tunai sisanya utang) ditangani di
 * sini: caller cukup menjumlahkan seluruh `payments`.
 */
export function settlePayments(
  total: Sen,
  payments: readonly { method: string; amount: Sen }[],
): {
  paidTotal: Sen;
  change: Sen;
  shortfall: Sen;
  isSettled: boolean;
} {
  for (const p of payments) {
    if (!Number.isSafeInteger(p.amount) || p.amount < 0) {
      throw new CartCalculationError(`Nominal ${p.method} tidak valid: ${p.amount}`, 'INVALID_PRICE');
    }
  }
  const paidTotal = sum(...payments.map((p) => p.amount));
  const delta = paidTotal - total;
  return {
    paidTotal,
    change: delta > 0 ? sen(delta) : ZERO,
    shortfall: delta < 0 ? sen(-delta) : ZERO,
    isSettled: delta >= 0,
  };
}
