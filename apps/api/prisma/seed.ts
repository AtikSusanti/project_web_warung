/**
 * Seed idempotent untuk database pengembangan.
 *
 * Aman dijalankan berulang: semuanya upsert berdasarkan kunci yang stabil,
 * sehingga `prisma migrate reset` lalu `prisma db seed` menghasilkan data
 * yang sama setiap kali.
 *
 * Password memakai scrypt dari `node:crypto`, bukan argon2/bcrypt. Alasannya
 * praktis: argon2 dan bcrypt adalah native module yang butuh toolchain build,
 * dan ituabstractmethod yang harus dipasang di image Docker slim. scrypt
 * sudah jadi bagian dari runtime Node, jadi tidak ada yang bisa gagal build.
 *
 * Kalau nanti kamu memang butuh argon2 (memory-hard, lebih tahan GPU attack),
 * artifact untuk linux-x64/arm64 sudah tersedia sebagai binary, jadi
 * `argon2` pure-JS bukan langkah yang rumit. Ganti `hashPassword`/
 * `verifyPassword` di `apps/api/src/modules/auth/password.ts` dengan satu
 * implementasi dan seluruh aplikasi ikut berganti.
 */
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

import { PrismaClient } from '@prisma/client';

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

/**
 * Parameter scrypt: N = 2^15, r = 8, p = 1.
 *
 * N=32768 memberi resistensi memory-hard yang setara dengan bcrypt cost 11,
 * dan tetap responsif untuk login interaktif (~80-100ms). Jangan turunkan N
 * tanpa alasan: turunnya menaikkan kecepatan brute force.
 */
const SCRYPT_N = 32_768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 32;

/**
 * Format: `scrypt$N$r$p$<salt base64>$<hash base64>`
 * Menyimpan parameter di dalam string berarti N bisa dinaikkan di kemudian
 * hari tanpa migration: password lama tetap bisa diverifikasi dengan N-nya
 * sendiri, dan hanya ter-rehash saat user login.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEY_LENGTH);
  return [
    'scrypt',
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, nRaw, rRaw, pRaw, saltRaw, hashRaw] = parts;
  const n = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) return false;
  if (saltRaw === undefined || hashRaw === undefined) return false;

  const salt = Buffer.from(saltRaw, 'base64');
  const expected = Buffer.from(hashRaw, 'base64');
  const actual = await derive(password, salt, expected.length, n, r, p);

  // timingSafeEqual melempar error kalau panjang kedua buffer beda, dan
  // perbedaan panjang itu sendiri adalah informasi yang tidak boleh bocor lewat timing.
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/** scrypt yang menerima parameter non-default, dipakai saat verifikasi. */
async function derive(
  password: string,
  salt: Buffer,
  keylen: number,
  n: number,
  r: number,
  p: number,
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    scryptCallback(password, salt, keylen, { N: n, r, p }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

/** Ubah slug sembarang menjadi slug URL yang aman dan stabil. */
function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160);
}

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  const cashierPassword = process.env.SEED_CASHIER_PASSWORD;
  if (
    !adminPassword ||
    !cashierPassword ||
    !adminPassword.trim() ||
    !cashierPassword.trim()
  ) {
    throw new Error(
      'SEED_ADMIN_PASSWORD dan SEED_CASHIER_PASSWORD wajib diisi sebelum menjalankan seed',
    );
  }

  // ── Settings ───────────────────────────────────────────────────────────────
  // Baris tunggal, dikunci CHECK (id = 1) di migration 0002.
  await prisma.setting.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      storeName: 'Warung Saya',
      storeTagline: 'Sembako & kebutuhan harian',
      waPhoneNumber: '6281234567890',
      address: 'Jl. Contoh No. 1',
      // PPN 11%, harga sudah termasuk PPN. Ini asumsi yang harus bisa diubah
      // dari UI Pengaturan, tapi default-nya mengikuti kebiasaan warung kecil.
      taxBps: 1100,
      taxInclusive: true,
      taxLabel: 'PPN',
      enableCashRounding: false,
      cashRoundingStepSen: 10_000,
      receiptFooter: 'Terima kasih sudah berbelanja!',
      showWholesaleInCatalog: false,
      maxTransactionDiscountBps: 3000,
      invoicePrefix: 'INV',
      currency: 'IDR',
    },
  });

  // ── Users ──────────────────────────────────────────────────────────────────
  await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      fullName: 'Administrator',
      phone: '6281234567890',
      role: 'ADMIN',
      isActive: true,
      passwordHash: await hashPassword(adminPassword),
    },
  });

  await prisma.user.upsert({
    where: { username: 'kasir' },
    update: {},
    create: {
      username: 'kasir',
      fullName: 'Kasir Toko',
      phone: '6281234567890',
      role: 'CASHIER',
      isActive: true,
      passwordHash: await hashPassword(cashierPassword),
    },
  });

  // ── Kategori ───────────────────────────────────────────────────────────────
  const categorySeeds: Array<{ name: string; color: 'DEFAULT' | 'RED' | 'GREEN' | 'BLUE' }> = [
    { name: 'Sembako', color: 'GREEN' },
    { name: 'Minuman', color: 'BLUE' },
    { name: 'Snack', color: 'RED' },
    { name: 'Rumah Tangga', color: 'DEFAULT' },
    { name: 'Obat & Alkes', color: 'DEFAULT' },
  ];

  const categoryIds = new Map<string, string>();
  for (const seed of categorySeeds) {
    const slug = slugify(seed.name);
    const row = await prisma.category.upsert({
      where: { slug },
      update: { name: seed.name, color: seed.color },
      create: { name: seed.name, slug, color: seed.color, sortOrder: 0, isActive: true },
    });
    categoryIds.set(seed.name, row.id);
  }

  // ── Produk contoh ──────────────────────────────────────────────────────────
  // Harga dikirim sebagai string desimal, bukan number: 15.5 sebagai float
  // binary tidak sama dengan 15.5 sebagai DECIMAL(14,2) di Postgres.
  interface ProductSeed {
    sku: string;
    barcode?: string;
    name: string;
    category: string;
    priceBuy: string;
    priceSell: string;
    priceWholesale?: string;
    stockQty: number;
    minStock: number;
    wholesaleMinQty?: number;
    unit?: 'PCS' | 'PACK' | 'KG' | 'LITER' | 'ML' | 'BOX' | 'DOSE';
  }

  const productSeeds: ProductSeed[] = [
    { sku: 'SBK-001', barcode: '8991002101017', name: 'Beras Pandan Wangi 5kg', category: 'Sembako', priceBuy: '58000', priceSell: '65000', stockQty: 40, minStock: 10, unit: 'PACK' },
    { sku: 'SBK-002', barcode: '8991002101024', name: 'Minyak Goreng 1L', category: 'Sembako', priceBuy: '14500', priceSell: '17500', stockQty: 60, minStock: 12, unit: 'LITER' },
    { sku: 'SBK-003', barcode: '8991002101031', name: 'Gula Pasir 1kg', category: 'Sembako', priceBuy: '13000', priceSell: '15500', stockQty: 80, minStock: 15, unit: 'PACK' },
    { sku: 'SBK-004', barcode: '8992761123451', name: 'Tepung Terigu 1kg', category: 'Sembako', priceBuy: '9000', priceSell: '11500', priceWholesale: '10500', wholesaleMinQty: 10, stockQty: 50, minStock: 10, unit: 'PACK' },
    { sku: 'SBK-005', barcode: '8991002101055', name: 'Garam Halus 250g', category: 'Sembako', priceBuy: '1500', priceSell: '2500', stockQty: 120, minStock: 20, unit: 'PACK' },
    { sku: 'MIN-001', barcode: '8992775001019', name: 'Air Mineral 600ml', category: 'Minuman', priceBuy: '2000', priceSell: '3500', stockQty: 200, minStock: 48, unit: 'PCS' },
    { sku: 'MIN-002', barcode: '8992775001026', name: 'Teh Botol Sosro 450ml', category: 'Minuman', priceBuy: '3500', priceSell: '5000', stockQty: 96, minStock: 24, unit: 'PCS' },
    { sku: 'MIN-003', barcode: '8991001102019', name: 'Kopi Kapal Api Sachet', category: 'Minuman', priceBuy: '1200', priceSell: '2000', stockQty: 300, minStock: 50, unit: 'PACK' },
    { sku: 'SNK-001', barcode: '8998934419415', name: 'Indomie Goreng', category: 'Snack', priceBuy: '2800', priceSell: '3500', stockQty: 240, minStock: 50, unit: 'PACK' },
    { sku: 'SNK-002', barcode: '8998866202401', name: 'Chitato 68g', category: 'Snack', priceBuy: '8500', priceSell: '10500', stockQty: 72, minStock: 24, unit: 'PACK' },
    { sku: 'SNK-003', barcode: '8992760223014', name: 'Oreo Sandwich', category: 'Snack', priceBuy: '6500', priceSell: '8500', stockQty: 90, minStock: 24, unit: 'PACK' },
    { sku: 'RT-001', name: 'Sabun Mandi Cair 450ml', category: 'Rumah Tangga', priceBuy: '16000', priceSell: '21000', stockQty: 36, minStock: 8, unit: 'PCS' },
    { sku: 'RT-002', name: 'Deterjen Bubuk 800g', category: 'Rumah Tangga', priceBuy: '14500', priceSell: '18500', stockQty: 30, minStock: 6, unit: 'PACK' },
    { sku: 'RT-003', name: 'Tisu Basah Saku', category: 'Rumah Tangga', priceBuy: '900', priceSell: '1500', stockQty: 500, minStock: 100, unit: 'PACK' },
    { sku: 'ALK-001', name: 'Obat Nyamuk Cair', category: 'Obat & Alkes', priceBuy: '8500', priceSell: '11500', stockQty: 25, minStock: 6, unit: 'PCS' },
  ];

  for (const seed of productSeeds) {
    const categoryId = categoryIds.get(seed.category);
    if (!categoryId) {
      throw new Error(`Kategori "${seed.category}" tidak ditemukan untuk SKU ${seed.sku}`);
    }

    const data = {
      name: seed.name,
      slug: slugify(`${seed.sku}-${seed.name}`),
      description: null,
      categoryId,
      // Prisma menerima string untuk Decimal dan mengirimnya apa adanya,
      // jadi tidak pernah melewati representasi float IEEE-754.
      priceBuy: seed.priceBuy,
      priceSell: seed.priceSell,
      priceWholesale: seed.priceWholesale ?? null,
      stockQty: seed.stockQty,
      minStock: seed.minStock,
      wholesaleMinQty: seed.wholesaleMinQty ?? null,
      unit: seed.unit ?? ('PCS' as const),
      barcode: seed.barcode ?? null,
      isActive: true,
      isPublic: true,
      isFeatured: false,
    };

    await prisma.product.upsert({
      where: { sku: seed.sku },
      update: data,
      create: { ...data, sku: seed.sku },
    });
  }

  const products = await prisma.product.count();
  const categories = await prisma.category.count();
  const users = await prisma.user.count();

  console.log('Seed selesai:');
  console.log(`  users      : ${users}`);
  console.log(`  categories : ${categories}`);
  console.log(`  products   : ${products}`);
  console.log(`  settings   : 1 baris (id=1)`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exitCode = 1;
  });