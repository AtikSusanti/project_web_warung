/**
 * `@warung/shared` — kontrak dan logika domain yang dipakai apps/api dan apps/web.
 *
 * Aturan import:
 * - Modul ini TIDAK boleh meng-import apa pun dari `@prisma/client`,
 *   `@nestjs/*`, atau `next/*`. Kalau iya, shared tidak lagi netral dan
 *   frontend ikut menarik dependensi backend.
 * - Modul ini TIDAK boleh melakukan I/O (fetch, fs, db). Hanya kalkulasi murni.
 */

export * from './money.js';
export * from './cart.js';
export * from './enums.js';
export * from './constants.js';
export * from './id.js';
export * from './whatsapp.js';
export * from './contracts/common.js';
export * from './contracts/product.js';
export * from './contracts/commerce.js';

/** Versi kontrak. DINAJIKAN setiap ada perubahan yang breaking. */
export const CONTRACT_VERSION = '1.0.0';
