import { describe, expect, it } from 'vitest';
import { CartCalculationError, calculateCart, settlePayments, type CartLineInput } from './cart.js';
import { sen, sum } from './money.js';

/**
 * Uji emas untuk kalkulasi transaksi.
 *
 * Setiap kasus di sini mewakili uang yang benar-benar diterima atau dicatat
 * salah oleh pemilik warung. Kegagalan test berarti kerugian nyata.
 */

/** Helper: argumen rupiah penuh, hasil fungsi `line` adalah sen. */
function line(name: string, qty: number, priceRp: number, discountBps = 0): CartLineInput {
  return {
    productId: `product-${name.toLowerCase().replace(/\s/g, '-')}`,
    sku: name.toUpperCase().replace(/\s/g, '-'),
    name,
    qty,
    unitPrice: sen(priceRp * 100),
    discountBps,
  };
}

describe('calculateCart - dasar', () => {
  it('menghitung satu baris sederhana', () => {
    const r = calculateCart([line('Indomie Goreng', 5, 3_000)]);
    expect(r.subtotal).toBe(sen(1_500_000));
    expect(r.discountTotal).toBe(0);
    expect(r.grandTotal).toBe(sen(1_500_000));
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]?.grossAmount).toBe(sen(1_500_000));
    expect(r.lines[0]?.netAmount).toBe(sen(1_500_000));
  });

  it('menolak keranjang kosong', () => {
    expect(() => calculateCart([])).toThrow(CartCalculationError);
  });

  it('menolak jumlah tidak valid', () => {
    expect(() => calculateCart([line('A', 0, 1000)])).toThrow(/Jumlah/);
    expect(() => calculateCart([line('A', -1, 1000)])).toThrow(/Jumlah/);
    expect(() => calculateCart([line('A', 1.5, 1000)])).toThrow(/Jumlah/);
  });

  it('menolak harga negatif', () => {
    expect(() => calculateCart([line('A', 1, -1000)])).toThrow(/Harga/);
  });

  it('menolak diskon melebihi batas', () => {
    expect(() => calculateCart([line('A', 1, 1000, 6000)])).toThrow(/Diskon/);
    expect(() => calculateCart([line('A', 1, 1000)], { transactionDiscountBps: 4000 })).toThrow(
      /Diskon/,
    );
  });

  it('menolak tarif pajak di luar 0-30%', () => {
    expect(() => calculateCart([line('A', 1, 1000)], { taxBps: 5000 })).toThrow(/pajak/);
    expect(() => calculateCart([line('A', 1, 1000)], { taxBps: -1 })).toThrow(/pajak/);
  });
});

describe('calculateCart - diskon', () => {
  it('menghitung diskon per baris', () => {
    const r = calculateCart([line('Telur', 1, 28_000, 1000)]);
    expect(r.subtotal).toBe(sen(2_800_000));
    expect(r.lineDiscountTotal).toBe(sen(280_000));
    expect(r.grandTotal).toBe(sen(2_520_000));
  });

  it('menerapkan diskon tingkat transaksi', () => {
    const r = calculateCart([line('A', 2, 10_000)], { transactionDiscountBps: 1000 });
    expect(r.transactionDiscountAmount).toBe(sen(200_000));
    expect(r.grandTotal).toBe(sen(1_800_000));
  });

  it('menerapkan diskon baris lalu diskon transaksi secara berurutan', () => {
    // 2 x 10.000 = 20.000; diskon baris 10% = 2.000; sisa 18.000; diskon transaksi 10% = 1.800
    const r = calculateCart([line('A', 2, 10_000, 1000)], { transactionDiscountBps: 1000 });
    expect(r.lineDiscountTotal).toBe(sen(200_000));
    expect(r.transactionDiscountAmount).toBe(sen(180_000));
    expect(r.discountTotal).toBe(sen(380_000));
    expect(r.grandTotal).toBe(sen(1_620_000));
  });

  it('INVARIAN: alokasi diskon per baris selalu persis sama dengan total diskon', () => {
    // Kasus yang paling sering salah: diskon tingkat transaksi dialokasikan
    // per baris, sehingga pembulatan per baris membuat total meleset.
    const cases = [
      { lines: [line('A', 3, 3333), line('B', 7, 1777)], bps: 777 },
      { lines: [line('A', 1, 1), line('B', 1, 1), line('C', 1, 1)], bps: 333 },
      { lines: [line('A', 13, 999), line('B', 7, 1234), line('C', 3, 55)], bps: 1234 },
      { lines: [line('A', 100, 105), line('B', 1, 7)], bps: 1 },
    ];
    for (const c of cases) {
      const r = calculateCart(c.lines, { transactionDiscountBps: c.bps });
      expect(sum(...r.lines.map((l) => l.transactionDiscountAmount))).toBe(
        r.transactionDiscountAmount,
      );
      expect(sum(...r.lines.map((l) => l.totalAmount))).toBe(r.grandTotal);
      expect(sum(...r.lines.map((l) => l.netAmount))).toBe(r.taxableBase);
      expect(r.subtotal - r.discountTotal).toBe(r.grandTotal);
    }
  });

  it('INVARIAN random: subtotal - diskon = grandTotal untuk 2000 kasus', () => {
    for (let i = 0; i < 2000; i += 1) {
      const n = 1 + Math.floor(Math.random() * 8);
      const lines = Array.from({ length: n }, (_, k) =>
        line(
          `P${k}`,
          1 + Math.floor(Math.random() * 20),
          1 + Math.floor(Math.random() * 50_000),
          Math.floor(Math.random() * 2000),
        ),
      );
      const r = calculateCart(lines, {
        transactionDiscountBps: Math.floor(Math.random() * 3000),
        taxBps: 1100,
        pricesIncludeTax: true,
      });
      expect(r.subtotal - r.discountTotal).toBe(r.grandTotal);
      expect(r.grandTotal).toBe(r.roundedTotal);
      expect(r.roundingAdjustment).toBe(0);
    }
  });
});

describe('calculateCart - pajak', () => {
  it('harga inklusif: total tidak ditambah pajak, PPN hanya untuk pelaporan', () => {
    const r = calculateCart([line('A', 1, 110_000)], { taxBps: 1100, pricesIncludeTax: true });
    expect(r.grandTotal).toBe(sen(11_000_000));
    expect(r.taxableBase).toBe(sen(11_000_000));
    // 110.000 inklusif PPN 11% -> bagian PPN di dalamnya = 110.000 * 11/111
    expect(r.taxTotal).toBe(sen(1_090_090));
  });

  it('harga eksklusif: PPN ditambahkan ke total', () => {
    const r = calculateCart([line('A', 1, 100_000)], { taxBps: 1100, pricesIncludeTax: false });
    expect(r.taxableBase).toBe(sen(10_000_000));
    expect(r.taxTotal).toBe(sen(1_100_000));
    expect(r.grandTotal).toBe(sen(11_100_000));
  });

  it('harga eksklusif: PPN dihitung setelah diskon, bukan sebelum', () => {
    const r = calculateCart([line('A', 1, 100_000, 1000)], {
      taxBps: 1100,
      pricesIncludeTax: false,
    });
    // diskon baris 10.000 -> 90.000 -> PPN 9.900, bukan 11.000
    expect(r.taxableBase).toBe(sen(9_000_000));
    expect(r.taxTotal).toBe(sen(990_000));
    expect(r.grandTotal).toBe(sen(9_990_000));
  });

  it('harga inklusif: jumlah PPN per baris sama dengan total PPN', () => {
    const r = calculateCart([line('A', 1, 33_333), line('B', 2, 17_777)], {
      taxBps: 1100,
      pricesIncludeTax: true,
    });
    expect(sum(...r.lines.map((l) => l.taxAmount))).toBe(r.taxTotal);
  });
});

describe('calculateCart - pembulatan kas', () => {
  // Default step = 10.000 sen = Rp 100.
  it('membulatkan ke bawah ke pecahan Rp 100 dan mencatat selisihnya', () => {
    const r = calculateCart([line('A', 1, 43_250)], { cashRounding: true });
    expect(r.grandTotal).toBe(sen(4_325_000));
    expect(r.roundedTotal).toBe(sen(4_320_000));
    expect(r.roundingAdjustment).toBe(sen(-5_000));
  });

  it('tidak menghasilkan penyesuaian bila total sudah pas', () => {
    const r = calculateCart([line('A', 1, 43_200)], { cashRounding: true });
    expect(r.roundingAdjustment).toBe(0);
    expect(r.roundedTotal).toBe(r.grandTotal);
  });

  it('menghormati step custom', () => {
    const r = calculateCart([line('A', 1, 43_250)], {
      cashRounding: true,
      cashRoundingStep: 50_000,
    });
    expect(r.roundedTotal).toBe(sen(4_300_000));
  });

  it('menangkap kasus pembulatan yang tidak aktif karena step salah satuan', () => {
    // Step 100 sen = Rp 1.00, sehingga pembulatan ke Rp 100 tidak terjadi.
    const wrong = calculateCart([line('A', 1, 43_250)], {
      cashRounding: true,
      cashRoundingStep: 100,
    });
    expect(wrong.roundedTotal).toBe(sen(4_325_000));

    const right = calculateCart([line('A', 1, 43_250)], { cashRounding: true });
    expect(right.roundedTotal).toBe(sen(4_320_000));
  });

  it('pembulatan hanya menyentuh total, bukan subtotal', () => {
    const r = calculateCart([line('A', 1, 43_250)], { cashRounding: true });
    expect(r.subtotal).toBe(sen(4_325_000));
    expect(r.taxableBase).toBe(sen(4_325_000));
  });
});

describe('settlePayments', () => {
  it('menghitung kembalian untuk pembayaran tunai', () => {
    const r = settlePayments(sen(4_000_000), [{ method: 'CASH', amount: sen(5_000_000) }]);
    expect(r.paidTotal).toBe(sen(5_000_000));
    expect(r.change).toBe(sen(1_000_000));
    expect(r.shortfall).toBe(0);
    expect(r.isSettled).toBe(true);
  });

  it('mendeteksi kekurangan pembayaran', () => {
    const r = settlePayments(sen(5_000_000), [{ method: 'CASH', amount: sen(4_000_000) }]);
    expect(r.change).toBe(0);
    expect(r.shortfall).toBe(sen(1_000_000));
    expect(r.isSettled).toBe(false);
  });

  it('menjumlahkan pembayaran gabungan', () => {
    const r = settlePayments(sen(4_500_000), [
      { method: 'CASH', amount: sen(2_000_000) },
      { method: 'QRIS', amount: sen(2_600_000) },
    ]);
    expect(r.paidTotal).toBe(sen(4_600_000));
    expect(r.change).toBe(sen(100_000));
    expect(r.isSettled).toBe(true);
  });

  it('menolak nominal negatif', () => {
    expect(() => settlePayments(sen(1000), [{ method: 'CASH', amount: -1 as never }])).toThrow(
      CartCalculationError,
    );
  });

  it('pembayaran tepat sama berarti tidak ada kembalian', () => {
    const r = settlePayments(sen(1_000_000), [{ method: 'CASH', amount: sen(1_000_000) }]);
    expect(r.change).toBe(0);
    expect(r.shortfall).toBe(0);
    expect(r.isSettled).toBe(true);
  });
});
