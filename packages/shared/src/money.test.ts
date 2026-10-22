import { describe, expect, it } from 'vitest';
import {
  allocate,
  MAX_SEN,
  DEFAULT_CASH_ROUNDING_STEP,
  decimalToSen,
  formatIDR,
  formatIDRCompact,
  isSen,
  marginBasisPoints,
  parseIDR,
  percentOf,
  roundCash,
  sen,
  senToDecimalString,
  splitEvenly,
  sum,
  taxExclusiveBase,
  taxPortionInclusive,
  ZERO,
} from './money.js';

describe('sen', () => {
  it('menolak nilai non-integer', () => {
    expect(() => sen(1.5)).toThrow(RangeError);
    expect(() => sen(Number.NaN)).toThrow(RangeError);
    expect(() => sen(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('menerima integer yang aman', () => {
    expect(sen(-100)).toBe(-100);
    expect(sen(0)).toBe(0);
  });
});

describe('parseIDR', () => {
  it.each([
    ['0', 0],
    ['15000', 1_500_000],
    ['15000.50', 1_500_050],
    ['15.000', 1_500_000],
    ['15.000,50', 1_500_050],
    ['15,000.50', 1_500_050],
    ['Rp 15.000', 1_500_000],
    ['Rp1.500.000', 150_000_000],
    ['  25.000  ', 2_500_000],
    ['-15.000', -1_500_000],
    ['15.000,5', 1_500_050],
    ['.50', 50],
    [',50', 50],
  ])('parse %s menjadi %d sen', (input, expected) => {
    expect(parseIDR(input as string)).toBe(expected);
  });

  it('menganggap number sebagai rupiah penuh, bukan sen', () => {
    expect(parseIDR(15000)).toBe(1_500_000);
  });

  it('membulatkan bagian pecahan lebih dari 2 digit', () => {
    expect(parseIDR('15.000,567')).toBe(1_500_057);
  });

  it.each(['', '   ', 'abc', '-'])('menolak input tidak valid: %j', (input) => {
    expect(() => parseIDR(input as string)).toThrow();
  });

  it('menolak nilai yang melebihi batas aman', () => {
    expect(() => parseIDR('9'.repeat(20))).toThrow(RangeError);
  });
});

describe('senToDecimalString', () => {
  it.each([
    [0, '0.00'],
    [1, '0.01'],
    [100, '1.00'],
    [1_500_050, '15000.50'],
    [-1_500_050, '-15000.50'],
    // 10 triliun sen = 100 miliar rupiah. Dulu diekspektasikan '100000000.00'
    // yang salah hitung 1000x; yang benar 100 miliar.
    [10_000_000_000_000, '100000000000.00'],
    // Tepat di batas DECIMAL(14,2): 999.999.999.999,99 rupiah.
    [99_999_999_999_999, '999999999999.99'],
  ])('%d -> %s', (input, expected) => {
    expect(senToDecimalString(sen(input))).toBe(expected);
  });

  it('menolak nilai yang tidak muat di DECIMAL(14,2)', () => {
    expect(() => sen(MAX_SEN + 1)).toThrow(RangeError);
    expect(() => sen(-(MAX_SEN + 1))).toThrow(RangeError);
  });

  it('round-trip dengan parseIDR tanpa kehilangan presisi', () => {
    for (const v of [1, 99, 100, 12_345_678, 999_999_999_999]) {
      expect(parseIDR(senToDecimalString(sen(v)))).toBe(v);
    }
  });
});

describe('decimalToSen', () => {
  it('menerima objek Decimal ala Prisma', () => {
    expect(decimalToSen({ toString: () => '1234.56' })).toBe(123_456);
  });

  it('menerima string dan number', () => {
    expect(decimalToSen('1234.56')).toBe(123_456);
    expect(decimalToSen(1234.56)).toBe(123_456);
  });
});

describe('formatIDR', () => {
  it('menghilangkan pecahan nol secara default', () => {
    expect(formatIDR(sen(1_500_000))).toBe('Rp 15.000');
  });

  it('menampilkan pecahan bila ada', () => {
    expect(formatIDR(sen(1_500_050))).toBe('Rp 15.000,50');
  });

  it('memaksa pecahan saat diminta', () => {
    expect(formatIDR(sen(1_500_000), { forceFraction: true })).toBe('Rp 15.000,00');
  });

  it('menangani nilai negatif', () => {
    expect(formatIDR(sen(-500_00))).toBe('-Rp 500');
  });

  it('bisa tanpa simbol mata uang', () => {
    expect(formatIDR(sen(1_500_000), { withSymbol: false })).toBe('15.000');
  });
});

describe('formatIDRCompact', () => {
  it.each([
    [50_000, 'Rp 500'],
    [1_500_000, 'Rp 15.000'],
    [100_000_000, 'Rp 1 jt'],
    [150_000_000, 'Rp 1,5 jt'],
    [1_250_000_000, 'Rp 12,5 jt'],
    [100_000_000_000, 'Rp 1 M'],
  ])('%d -> %s', (input, expected) => {
    expect(formatIDRCompact(sen(input))).toBe(expected);
  });
});

describe('percentOf', () => {
  it.each([
    [1_000_000, 1100, 110_000],
    [1_000_000, 0, 0],
    [333_333, 1100, 36_667],
    [1, 5000, 1],
    [3, 5000, 2],
  ])('%d * %d bp -> %d', (value, bps, expected) => {
    expect(percentOf(sen(value), bps)).toBe(expected);
  });

  it('menolak basis point pecahan', () => {
    expect(() => percentOf(sen(1000), 10.5)).toThrow(TypeError);
  });
});

describe('allocate', () => {
  it('mengalokasikan tanpa kehilangan sen', () => {
    const parts = allocate(sen(1000), [1, 1, 1]);
    expect(parts).toEqual([334, 333, 333]);
    expect(sum(...parts)).toBe(1000);
  });

  it('mengalokasikan sesuai bobot', () => {
    const parts = allocate(sen(10_000), [70, 30]);
    expect(parts).toEqual([7000, 3000]);
  });

  it('membagi sisa ke sisa pecahan terbesar', () => {
    // 100 * 0.5 = 50 tepat, tidak ada sisa
    expect(allocate(sen(100), [1, 1])).toEqual([50, 50]);
    // 10 * (1/3) = 3.33 -> floor 3, sisa 1 ke yang punya sisa terbesar (baris 1 & 2 tie, ambil index 0)
    expect(allocate(sen(10), [1, 1, 1])).toEqual([4, 3, 3]);
  });

  it('mempertahankan invariant jumlah untuk 10.000 random case', () => {
    for (let i = 0; i < 10_000; i += 1) {
      const total = Math.floor(Math.random() * 5_000_000);
      const n = 1 + Math.floor(Math.random() * 12);
      const weights = Array.from({ length: n }, () => Math.floor(Math.random() * 100_000));
      const parts = allocate(sen(total), weights);
      expect(parts.length).toBe(n);
      expect(parts.every(Number.isSafeInteger)).toBe(true);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
      if (weights.some((w) => w > 0)) {
        // Setiap bagian tidak boleh melebihi total.
        expect(parts.every((p) => p <= total)).toBe(true);
      }
    }
  });

  it('menangani seluruh bobot nol', () => {
    expect(allocate(sen(5000), [0, 0])).toEqual([5000, 0]);
  });

  it('menolak bobot negatif', () => {
    expect(() => allocate(sen(100), [1, -1])).toThrow(RangeError);
  });

  it('menolak jumlah non-nol ke nol bagian', () => {
    expect(() => allocate(sen(100), [])).toThrow(RangeError);
    expect(allocate(ZERO, [])).toEqual([]);
  });

  it('mengalokasikan nol dengan benar', () => {
    expect(allocate(ZERO, [1, 2, 3])).toEqual([0, 0, 0]);
  });
});

describe('roundCash', () => {
  // Default step = 10.000 sen = Rp 100.
  it('membulatkan ke bawah ke pecahan Rp 100', () => {
    expect(roundCash(sen(4_325_000))).toBe(4_320_000);
    expect(roundCash(sen(4_324_900))).toBe(4_320_000);
  });

  it('tidak mengubah total yang sudah pas', () => {
    expect(roundCash(sen(4_320_000))).toBe(4_320_000);
  });

  it('membulatkan ke atas', () => {
    expect(roundCash(sen(4_324_900), 10_000, 'up')).toBe(4_330_000);
  });

  it('membulatkan ke terdekat', () => {
    expect(roundCash(sen(4_324_400), 10_000, 'nearest')).toBe(4_320_000);
    expect(roundCash(sen(4_325_400), 10_000, 'nearest')).toBe(4_330_000);
  });

  it('menghormati step custom', () => {
    expect(roundCash(sen(4_325_000), 50_000)).toBe(4_300_000);
    expect(roundCash(sen(4_325_000), 10_000)).toBe(4_320_000);
  });

  it('menolak step tidak valid', () => {
    expect(() => roundCash(sen(100), 0)).toThrow(RangeError);
    expect(() => roundCash(sen(100), -100)).toThrow(RangeError);
  });

  it('DEFAULT_CASH_ROUNDING_STEP benar-benar Rp 100, bukan Rp 1', () => {
    // Rp 43.250 -> harus menjadi Rp 43.200. Kalau step-nya salah satuan
    // (100 sen = Rp 1), hasilnya Rp 43.250 dan pembulatan tidak terjadi.
    expect(DEFAULT_CASH_ROUNDING_STEP).toBe(10_000);
    expect(roundCash(sen(4_325_000))).toBe(4_320_000);
    expect(roundCash(sen(4_325_050))).toBe(4_320_000);
  });
});

describe('marginBasisPoints', () => {
  it.each([
    [10_000, 15_000, 5000],
    [10_000, 10_000, 0],
    [10_000, 5_000, -5000],
    [0, 15_000, 0],
  ])('modal %d jual %d -> %d bp', (cost, price, expected) => {
    expect(marginBasisPoints(sen(cost), sen(price))).toBe(expected);
  });
});

describe('splitEvenly', () => {
  it('membagi rata dan tidak kehilangan sen', () => {
    expect(splitEvenly(sen(1000), 3)).toEqual([334, 333, 333]);
    expect(splitEvenly(sen(1000), 3).reduce((a, b) => a + b, 0)).toBe(1000);
  });

  it('menolak jumlah bagian tidak valid', () => {
    expect(() => splitEvenly(sen(100), 0)).toThrow(RangeError);
    expect(() => splitEvenly(sen(100), 1.5)).toThrow(RangeError);
  });
});

describe('sum', () => {
  it('menjumlahkan tanpa error pembulatan', () => {
    // Bug klasik: 0.1 + 0.2
    expect(sum(sen(10), sen(20))).toBe(30);
    expect(sum()).toBe(0);
    expect(sum(sen(1), sen(2), sen(3), sen(4), sen(5))).toBe(15);
  });
});

describe('taxPortionInclusive / taxExclusiveBase', () => {
  it('menghitung bagian PPN yang sudah melekat pada harga inklusif', () => {
    // Harga Rp 110.000 inklusif PPN 11% -> PPN di dalamnya Rp 10.900,90
    expect(taxPortionInclusive(sen(11_000_000), 1100)).toBe(sen(1_090_090));
    // Cara naif percentOf akan menghasilkan Rp 12.100 - overstated 11%
    expect(percentOf(sen(11_000_000), 1100)).toBe(sen(1_210_000));
    expect(taxPortionInclusive(sen(11_000_000), 1100)).toBeLessThan(
      percentOf(sen(11_000_000), 1100),
    );
  });

  it('nol bila tarif nol', () => {
    expect(taxPortionInclusive(sen(1_000_000), 0)).toBe(0);
    expect(taxExclusiveBase(sen(1_000_000), 0)).toBe(sen(1_000_000));
  });

  it('taxExclusiveBase adalah kebalikan dari taxPortionInclusive', () => {
    const gross = sen(11_000_000);
    const tax = taxPortionInclusive(gross, 1100);
    expect(taxExclusiveBase(gross, 1100) + tax).toBe(gross);
  });

  it('INVARIAN: bagian pajak tidak pernah melebihi harga', () => {
    for (const bps of [0, 500, 1100, 3000]) {
      for (const v of [1, 100, 99_999, 1_000_000, 999_999_999]) {
        const tax = taxPortionInclusive(sen(v), bps);
        expect(tax).toBeGreaterThanOrEqual(0);
        expect(tax).toBeLessThanOrEqual(v);
        expect(taxExclusiveBase(sen(v), bps)).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('menolak tarif tidak valid', () => {
    expect(() => taxPortionInclusive(sen(1000), -1)).toThrow(TypeError);
    expect(() => taxExclusiveBase(sen(1000), 1.5)).toThrow(TypeError);
  });
});

describe('isSen', () => {
  it('menguards nilai dari JSON', () => {
    expect(isSen(100)).toBe(true);
    expect(isSen(1.5)).toBe(false);
    expect(isSen('100')).toBe(false);
    expect(isSen(null)).toBe(false);
    expect(isSen(Number.NaN)).toBe(false);
  });
});
