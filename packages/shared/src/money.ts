/**
 * UANG — representasi kanonik: INTEGER SATUAN KECIL (sen).
 *
 * Kenapa integer sen, bukan float atau Decimal?
 *
 * 1. `0.1 + 0.2 !== 0.3` dalam IEEE-754. Untuk sistem kas dan piutang, selisih
 *    satu sen per transaksi akan mengotori saldo pelanggan dan laporan laba
 *    rugi. Ini bukan masalah teoritis — akumulasi begini selalu terjadi dalam
 *    beberapa bulan pemakaian nyata.
 * 2. Integer dalam JS aman sampai 2^53 - 1, sekitar 9.007e15 sen atau Rp 90
 *    triliun. Jauh melampaui kapasitas satu warung.
 * 3. Postgres `DECIMAL(14,2)` memetakan 1:1 ke integer sen tanpa pembulatan.
 * 4. Matematika desimal (alokasi diskon proporsional) tetap dapat dilakukan
 *    dengan benar lewat pembulatan largest-remainder — lihat `allocate()`.
 *
 * Aturan main:
 * - Semua nilai uang lintas layer aplikasi (frontend, API, kontrak) adalah sen.
 * - Konversi ke/from DECIMAL Postgres HANYA di batas repository (mapper).
 * - Jangan pernah melakukan aritmetika uang pada `number` yang berasal dari
 *   `JSON.parse` tanpa melewati `parseIDR()`.
 */

/**Nomor uang dalam satuan kecil (sen). Nilai dalam rupiah = sen / 100. */
export type Sen = number & { readonly __brand: unique symbol };

/**
 * Batas atas satu nilai uang, dalam sen.
 *
 * Dipakai karena `DECIMAL(14,2)` di Postgres menyimpan maksimum
 * 999.999.999.999,99 — jadi 99.999.999.999.999 sen. Angka di atas itu akan
 * ditolak Postgres dengan pesan error yang tidak menjelaskan asalnya ("numeric
 * field overflow"), jauh dari tempat bugnya. Menangkapnya di konstruktor
 * `sen()` membuat error muncul di baris yang benar dan waktu yang benar.
 *
* Sekitar Rp 999 miliar per nilai. Tidak akan pernah relevan secara wajar,
 * tapi cukup besar untuk membuat overflow total akumulasi terlihat.
 *
 * `DECIMAL(14,2)` simetris: nilai negatif punya batas yang sama besar. Guard
 * harus memakai `Math.abs`, bukan `value > MAX_SEN`, kalau tidak refund atau
 * diskon besar lolos dari konstruktor dan baru meledak saat insert.
 */
export const MAX_SEN = 99_999_999_999_999;

/** Menandai angka sebagai Sen. Hanya untuk nilai yang sudah dipercaya. */
export function sen(value: number): Sen {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`Nilai uang bukan integer yang aman: ${value}`);
  }
  if (Math.abs(value) > MAX_SEN) {
    throw new RangeError(
      `Nilai uang ${value} sen melebihi batas DECIMAL(14,2) (${MAX_SEN} sen). ` +
        'Periksa apakah ada perkalian yang salah satuan, misalnya rupiah yang ' +
        'diperlakukan sebagai sen.',
    );
  }
  return value as Sen;
}

/** Nilai uang nol. */
export const ZERO = sen(0);

/**
 * Kelipatan pecahan kas bawaan, dalam SEN.
 *
 * Sengaja didefinisikan sebagai konstanta bernama, bukan angka literal inline.
 * Angka `100` di sini berarti Rp 1,00 - bukan Rp 100. Kekeliruan satuan ini
 * membulatkan kembalian ke rupiah terdekat, yang sama sekali bukan perilaku
 * kasir warung. Pecahan kas riil adalah Rp 100.
 */
export const DEFAULT_CASH_ROUNDING_STEP = 10_000;

/**
 * Konversi input tidak stabil (string dari Excel, angka dari JSON, hasil
 * pemindaian) menjadi sen, dengan toleransi format Indonesia dan Inggris.
 *
 * Didukung:
 * - `15000`         -> Rp 150,00 (angka dianggap rupiah penuh)
 * - `"15000"`       -> Rp 150,00
 * - `"15000.50"`    -> Rp 15.000,50
 * - `"15.000,50"`   -> Rp 15.000,50
 * - `"15,000.50"`   -> Rp 15.000,50
 * - `"Rp 15.000"`   -> Rp 15.000
 * - `"1.500.000"`   -> Rp 1.500.000,00
 *
 * Untuk nominal yang labelnya sudah pasti rupiah penuh, gunakan
 * `rupiahToSen()` agar maksudnya eksplisit.
 */
export function parseIDR(input: string | number): Sen {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new TypeError(`Input uang tidak valid: ${input}`);
    return sen(Math.round(input * 100));
  }

  let s = input.trim();
  if (s === '') throw new TypeError('Input uang kosong');

  s = s.replace(/[^\d.,-]/g, '');
  if (s === '' || s === '-') throw new TypeError(`Input uang tidak dapat diparse: ${input}`);

  const negative = s.startsWith('-');
  if (negative) s = s.slice(1);

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  let decimalSep: ',' | '.' | null = null;

  if (lastComma !== -1 && lastDot !== -1) {
    decimalSep = lastComma > lastDot ? ',' : '.';
  } else if (lastComma !== -1 || lastDot !== -1) {
    const idx = Math.max(lastComma, lastDot);
    const sep = s[idx] as ',' | '.';
    const fracDigits = s.length - idx - 1;
    const occurrences = s.split(sep).length - 1;
    // "15.000" -> tiga digit setelah pemisah dan muncul sekali: thousands separator.
    // "15000.50" -> dua digit setelah pemisah: decimal separator.
    decimalSep = occurrences > 1 || fracDigits === 3 ? null : sep;
  }

  let intPart: string;
  let fracPart: string;
  if (decimalSep === null) {
    intPart = s.replace(/[.,]/g, '');
    fracPart = '';
  } else {
    const idx = s.lastIndexOf(decimalSep);
    intPart = s.slice(0, idx).replace(/[.,]/g, '');
    fracPart = s.slice(idx + 1).replace(/[.,]/g, '');
  }

  if (intPart === '') intPart = '0';

  // Pecahan dinormalisasi ke tepat 2 digit dengan pembulatan setengah ke atas.
  // Memotong (slice) akan mengikis nilai secara sistematis pada setiap baris
  // import dari Excel, jadi pembulatan jauh lebih aman untuk uang.
  const digits = (fracPart + '00').slice(0, 3);
  let cents = Number(digits.slice(0, 2));
  if ((digits[2] ?? '0') >= '5') cents += 1;

  let intValue = Number(intPart);
  if (cents >= 100) {
    cents -= 100;
    intValue += 1;
  }

  const value = intValue * 100 + cents;
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`Nilai uang melebihi batas aman: ${input}`);
  }
  return sen(negative ? -value : value);
}

/**
 * Konversi eksplisit dari rupiah penuh ke sen. Dipakai untuk harga produk,
 * nominal pembayaran, dan input form yang labelnya sudah jelas "Rp".
 */
export function rupiahToSen(rupiah: number): Sen {
  if (!Number.isFinite(rupiah)) throw new TypeError(`Nilai rupiah tidak valid: ${rupiah}`);
  return sen(Math.round(rupiah * 100));
}

/**
 * Konversi dari object Decimal/Prisma (atau string) menjadi sen.
 * Dipakai di batas repository. Tidak memparse pemisah ribuan.
 */
export function decimalToSen(value: { toString(): string } | string | number): Sen {
  if (typeof value === 'number') return sen(Math.round(value * 100));
  return parseIDR(String(value));
}

/**
 * Serialisasi sen menjadi string DECIMAL yang aman untuk Postgres: tanpa
 * eksponensi dan tanpa pemisah ribuan. Contoh: 1500050 -> "15000.50".
 */
export function senToDecimalString(value: Sen): string {
  const negative = value < 0;
  const abs = Math.abs(value);
  const intPart = Math.floor(abs / 100);
  const fracPart = (abs % 100).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${intPart}.${fracPart}`;
}

/** Serialisasi menjadi BigInt, untuk kebutuhan presisi di masa depan. */
export function senToBigInt(value: Sen): bigint {
  return BigInt(value);
}

/** Format tampilan Indonesia. 1500050 -> "Rp 15.000,50". */
export function formatIDR(
  value: Sen,
  options?: { withSymbol?: boolean; forceFraction?: boolean },
): string {
  const withSymbol = options?.withSymbol ?? true;
  const forceFraction = options?.forceFraction ?? false;
  const negative = value < 0;
  const abs = Math.abs(value);
  const intPart = Math.floor(abs / 100);
  const fracPart = abs % 100;

  const intStr = intPart.toLocaleString('id-ID');
  const body =
    fracPart === 0 && !forceFraction ? intStr : `${intStr},${fracPart.toString().padStart(2, '0')}`;

  const sign = negative ? '-' : '';
  return withSymbol ? `${sign}Rp ${body}` : `${sign}${body}`;
}

/**
 * Format ringkas untuk kartu statistik dan axis chart. 150000000 -> "Rp 1,5 jt".
 *
 * Dua keputusan yang tidak-dditional-default tapi penting:
 *
 * 1. Ambang singkatan dimulai di 'jt', bukan 'rb'. Rp 15.000 lebih mudah
 *    dibaca sekilas sebagai "15.000" daripada "15 rb", dan label statistik
 *    sering dipakai kasir untuk mencocokkan angka di struk. Below satu juta
 *    selalu ditulis penuh dengan pemisah ribuan.
 *
 * 2. Pembulatan selalu ke BAWAH, tidak boleh ke atas. `toFixed` rounds half
 *    away from zero, jadi Rp 1.999.999 akan tampil "Rp 2 jt" — satu rupiah
 *    lebih besar dari kenyataan. Untuk display uang, overstated lebih berbahaya
 *    daripada understated, jadi digit dipotong, tidak dibulatkan.
 */
export function formatIDRCompact(value: Sen): string {
  const abs = Math.abs(value);
  const negative = value < 0;
  const rupiah = abs / 100;

  // [faktor, singkatan], terbesar ke terkecil
  const units: ReadonlyArray<readonly [number, string]> = [
    [1_000_000_000_000, ' T'],
    [1_000_000_000, ' M'],
    [1_000_000, ' jt'],
  ];

  for (const [factor, suffix] of units) {
    if (rupiah >= factor) {
      const n = rupiah / factor;
      const txt = abbreviate(n);
      return `${negative ? '-' : ''}Rp ${txt}${suffix}`;
    }
  }

  // Tidak diubah jadi sen() lagi: `rupiah` sudah dalam RUPIAH. Membungkus
  // ulang dengan sen() akan membagi dua kali dan menghasilkan "Rp 5" untuk
  // input Rp 500.
  return formatIDR(value);
}

/**
 * Angka desimal maksimum 2 digit, dipotong (bukan dibulatkan), pemisah koma
 * gaya Indonesia, nol di ekor dibuang.
 */
function abbreviate(n: number): string {
  const truncated = Math.floor(n * 100) / 100;
  const whole = Math.floor(truncated);
  const frac = Math.round((truncated - whole) * 100);

  if (frac === 0) return whole.toString();
  const fracStr = String(frac).padStart(2, '0').replace(/0+$/, '');
  return `${whole},${fracStr}`;
}

/**
 * Persentase dari sebuah nilai, dibulatkan setengah ke atas.
 * `basisPoints`: 1% = 100 basis point, 11% PPN = 1100.
 */
export function percentOf(value: Sen, basisPoints: number): Sen {
  if (!Number.isInteger(basisPoints)) throw new TypeError('Basis point harus integer');
  return sen(Math.round((value * basisPoints) / 10_000));
}

/** Menambahkan basis point ke sebuah nilai, mis. harga jual = modal + margin %. */
export function addBasisPoints(value: Sen, basisPoints: number): Sen {
  return sen(value + percentOf(value, basisPoints));
}

/**
 * Porsi pajak yang SUDAH TERMASUK di dalam sebuah harga.
 *
 * Ini berbeda dari `percentOf`, dan perbedaan itu Diam-diam salah kalau tidak
 * diperhatikan. Untuk harga yang sudah termasuk PPN, pajak yang melekat
 * bukan `nilai x tarif`, melainkan:
 *
 *     bagian_pajak = nilai x tarif / (100% + tarif)
 *
 * Contoh tarif 11%: harga Rp 110.000 inklusif -> bagian PPN Rp 10.900,90.
 * Kalau dipakai `percentOf`, hasilnya Rp 12.100, overstated 11%.
 *
 * Kebalikan dari ini, nilai yang harus dikembalikan kalau butuh nilai
 * sebelum pajak: `taxExclusiveBase()`.
 */
export function taxPortionInclusive(value: Sen, basisPoints: number): Sen {
  if (!Number.isInteger(basisPoints) || basisPoints < 0) {
    throw new TypeError(`Tarif pajak tidak valid: ${basisPoints}`);
  }
  return sen(Math.round((value * basisPoints) / (10_000 + basisPoints)));
}

/**
 * Nilai DASAR PAJAK dari sebuah harga yang sudah termasuk pajak.
 * Kebalikan dari `taxPortionInclusive`.
 */
export function taxExclusiveBase(value: Sen, basisPoints: number): Sen {
  if (!Number.isInteger(basisPoints) || basisPoints < 0) {
    throw new TypeError(`Tarif pajak tidak valid: ${basisPoints}`);
  }
  return sen(Math.round((value * 10_000) / (10_000 + basisPoints)));
}

/**
 * Membagi jumlah sen ke sejumlah bobot tanpa kehilangan atau menciptakan sen.
 *
 * Memakai metode largest-remainder: flooring semua bagian, lalu
 * mendistribusikan sen tersisa ke bagian dengan sisa pecahan terbesar
 * (tie-break by index).
 *
 * Wajib dipakai untuk alokasi diskon proporsional per baris. Cara naif
 * `Math.round(total * qty / totalQty)` per baris dapat membuat jumlah alokasi
 * tidak sama dengan total diskon, sehingga jurnal tidak balance.
 *
 * @param total   jumlah sen yang harus dialokasikan
 * @param weights bobot relatif, tidak boleh semua nol
 * @returns array sepanjang `weights`, jumlahnya selalu sama dengan `total`
 */
export function allocate(total: Sen, weights: readonly number[]): Sen[] {
  if (weights.length === 0) {
    if (total !== 0) throw new RangeError('Tidak bisa mengalokasikan jumlah non-nol ke 0 bagian');
    return [];
  }
  for (const w of weights) {
    if (!Number.isFinite(w) || w < 0) throw new RangeError(`Bobot tidak valid: ${w}`);
  }

  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (weightSum === 0) {
    // Semua bobot nol: seluruh jumlah masuk ke bagian pertama.
    const out = new Array<number>(weights.length).fill(0);
    out[0] = total;
    return out as Sen[];
  }

  const raw = weights.map((w) => (w / weightSum) * total);
  const floored = raw.map((r) => Math.floor(r));
  let remainder = total - floored.reduce((a, b) => a + b, 0);

  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  const result = [...floored];
  for (const { i } of order) {
    if (remainder <= 0) break;
    result[i] = (result[i] ?? 0) + 1;
    remainder -= 1;
  }
  return result as Sen[];
}

/**
 * Pembulatan kas ke pecahan terdekat — praktik umum di warung Indonesia.
 *
 * Uang tunai dalam denomination 100/500/1000 membuat kembalian terlihat aneh
 * (total Rp 43.250 dibayar 50.000 -> kembalian 6.750; setelah pembulatan
 * ke bawah menjadi 6.500). Harus berupa toggle di UI, bukan perilaku diam-diam.
 *
 * @param step kelipatan pecahan dalam SEN. Default 10.000 = Rp 100.
 * @param mode `nearest` | `down` | `up`
 */
export function roundCash(
  value: Sen,
  step = DEFAULT_CASH_ROUNDING_STEP,
  mode: 'nearest' | 'down' | 'up' = 'down',
): Sen {
  if (!Number.isInteger(step) || step <= 0) throw new RangeError(`Step kas tidak valid: ${step}`);
  const down = Math.floor(value / step) * step;
  const up = down + step;
  switch (mode) {
    case 'down':
      return sen(Math.min(value, down));
    case 'up':
      return sen(Math.max(value, up));
    case 'nearest':
      return sen(value - down < up - value ? down : up);
  }
}

/** Menghitung margin dalam basis point. Pembagi nol menghasilkan 0. */
export function marginBasisPoints(cost: Sen, price: Sen): number {
  if (cost <= 0) return 0;
  return Math.round(((price - cost) / cost) * 10_000);
}

/** Penjumlahan sen. Semua argumen harus integer. */
export function sum(...values: readonly Sen[]): Sen {
  return sen(values.reduce<number>((a, b) => a + b, 0));
}

/** Pembagian sen evenly; sisa dibagi rata ke elemen awal. */
export function splitEvenly(total: Sen, parts: number): Sen[] {
  if (!Number.isInteger(parts) || parts <= 0) {
    throw new RangeError(`Jumlah bagian tidak valid: ${parts}`);
  }
  const base = Math.floor(total / parts);
  let remainder = total - base * parts;
  const out: number[] = [];
  for (let i = 0; i < parts; i += 1) {
    out.push(base + (remainder > 0 ? 1 : 0));
    if (remainder > 0) remainder -= 1;
  }
  return out as Sen[];
}

/** Guard: apakah nilai ini Sen yang sah (berguna untuk data dari JSON tak tertypings). */
export function isSen(value: unknown): value is Sen {
  return typeof value === 'number' && Number.isSafeInteger(value);
}
