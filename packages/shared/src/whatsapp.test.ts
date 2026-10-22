import { describe, expect, it } from 'vitest';
import { sen } from './money.js';
import {
  buildReceiptMessage,
  buildWhatsAppMessage,
  buildWhatsAppShareUrl,
  buildWhatsAppUrl,
  type WhatsAppOrderPayload,
} from './whatsapp.js';

const basePayload: WhatsAppOrderPayload = {
  customerName: 'Budi',
  customerPhone: '6281234567890',
  storeName: 'Warung Bu Tuti',
  orderReference: 'ORD/2026/10/00007',
  dateLabel: '01-10-2026 14:32',
  lines: [
    { index: 1, name: 'Indomie Goreng', qty: 5, unitPrice: sen(300_000), total: sen(1_500_000) },
    { index: 2, name: 'Telur 1kg', qty: 1, unitPrice: sen(2_800_000), total: sen(2_800_000) },
  ],
  subtotal: sen(4_300_000),
  discountTotal: sen(0),
  total: sen(4_300_000),
  note: 'Tolong dibungkus rapi',
};

describe('buildWhatsAppMessage', () => {
  it('mengikuti format blueprint 5.3', () => {
    const msg = buildWhatsAppMessage(basePayload);
    expect(msg).toContain('*PESANAN BARU*');
    expect(msg).toContain('Nama: Budi');
    expect(msg).toContain('HP: 6281234567890');
    expect(msg).toContain('1. Indomie Goreng x5 = Rp 15.000');
    expect(msg).toContain('2. Telur 1kg x1 = Rp 28.000');
    expect(msg).toContain('------------------------');
    expect(msg).toContain('*TOTAL: Rp 43.000*');
    expect(msg).toContain('Catatan: Tolong dibungkus rapi');
  });

  it('menyertakan nomor pesanan untuk rekonsiliasi', () => {
    expect(buildWhatsAppMessage(basePayload)).toContain('No. Pesanan: ORD/2026/10/00007');
  });

  it('tidak mencantumkan nomor HP pembeli bila tidak diberikan', () => {
    const msg = buildWhatsAppMessage({ ...basePayload, customerPhone: undefined });
    expect(msg).toContain('Nama: Budi');
    expect(msg).not.toContain('HP:');
  });

  it('menampilkan rincian diskon hanya bila ada diskon', () => {
    const withDiscount = buildWhatsAppMessage({ ...basePayload, discountTotal: sen(300_000) });
    expect(withDiscount).toContain('Subtotal: Rp 43.000');
    expect(withDiscount).toContain('Diskon: -Rp 3.000');
    expect(buildWhatsAppMessage(basePayload)).not.toContain('Diskon:');
  });

  it('mengabaikan catatan kosong', () => {
    expect(buildWhatsAppMessage({ ...basePayload, note: '   ' })).not.toContain('Catatan:');
    expect(buildWhatsAppMessage({ ...basePayload, note: null })).not.toContain('Catatan:');
  });

  it('memotong pesan panjang pada batas baris, bukan di tengah nilai uang', () => {
    const lines = Array.from({ length: 300 }, (_, i) => ({
      index: i + 1,
      name: `Barang nomor ${i + 1}`,
      qty: 1,
      unitPrice: sen(100_000),
      total: sen(100_000),
    }));
    const msg = buildWhatsAppMessage({
      ...basePayload,
      lines,
      subtotal: sen(30_000_000),
      total: sen(30_000_000),
      note: null,
    });
    expect(msg.length).toBeLessThanOrEqual(4096);
    expect(msg).toContain('dipotong');
    // Tidak boleh ada baris yang terpotong di tengah.
    expect(msg.split('\n').every((l) => l.length < 200)).toBe(true);
  });
});

describe('buildWhatsAppUrl', () => {
  it('membangun URL wa.me dari format 08xx, +62xx, dan 62xx', () => {
    const expected = 'https://wa.me/6281234567890?text=';
    expect(buildWhatsAppUrl('081234567890', 'Halo')).toBe(`${expected}${encodeURIComponent('Halo')}`);
    expect(buildWhatsAppUrl('+62 812-3456-7890', 'Halo')).toBe(`${expected}${encodeURIComponent('Halo')}`);
    expect(buildWhatsAppUrl('62 812 3456 7890', 'Halo')).toBe(`${expected}${encodeURIComponent('Halo')}`);
  });

  it('meng-encode karakter khusus WhatsApp', () => {
    const url = buildWhatsAppUrl('0812 3456 7890', 'Halo *dunia*\nBaru & 50%');
    // Spasi, newline, '&' dan '%' wajib ter-encode: kalau '&' lolos, parameter
    // `text` akan terpotong dan pesan kedua jadi query param liar.
    expect(url).toContain('%0A');
    expect(url).toContain('%26');
    expect(url).toContain('%25');
    expect(url).toContain('%20');

    // `*` tidak ter-encode: encodeURIComponent memang tidak mengubahnya,
    // dan `*` adalah syntax bold WhatsApp yang harus tetap terbaca.
    const parsed = new URL(url as string);
    expect(parsed.searchParams.get('text')).toBe('Halo *dunia*\nBaru & 50%');
    // Nomor telepon ada di PATH (`wa.me/628...`), bukan query param.
    expect(parsed.pathname).toBe('/6281234567890');
    expect(parsed.hostname).toBe('wa.me');
  });

  it('menghapus spasi dan tanda hubung dari nomor telepon', () => {
    const a = buildWhatsAppUrl('0812-3456-7890', 'x');
    const b = buildWhatsAppUrl('0812 3456 7890', 'x');
    const c = buildWhatsAppUrl('+6281234567890', 'x');
    expect(a).toBe(b);
    expect(a).toBe(c);
    expect(a).toContain('6281234567890');
  });

  it('mengembalikan null untuk nomor tidak valid, bukan URL rusak', () => {
    expect(buildWhatsAppUrl('', 'Halo')).toBeNull();
    expect(buildWhatsAppUrl('12345', 'Halo')).toBeNull();
    expect(buildWhatsAppUrl('abc', 'Halo')).toBeNull();
    expect(buildWhatsAppUrl('0812', 'Halo')).toBeNull();
  });

  it('membangun URL berbagi tanpa nomor tujuan', () => {
    expect(buildWhatsAppShareUrl('Halo')).toBe(
      `https://wa.me/?text=${encodeURIComponent('Halo')}`,
    );
  });
});

describe('buildReceiptMessage', () => {
  const receipt = buildReceiptMessage({
    invoiceNo: 'INV/2026/10/00042',
    storeName: 'Warung Bu Tuti',
    cashierName: 'Siti',
    dateLabel: '01-10-2026 14:35',
    lines: [
      { index: 1, name: 'Indomie Goreng', qty: 5, unitPrice: sen(300_000), total: sen(1_500_000) },
    ],
    subtotal: sen(1_500_000),
    discountTotal: sen(0),
    taxTotal: sen(0),
    total: sen(1_500_000),
    paymentLabel: 'Tunai',
    change: sen(200_000),
  });

  it('menampilkan total, nominal bayar, dan kembalian', () => {
    expect(receipt).toContain('*STRUK INV/2026/10/00042*');
    expect(receipt).toContain('Kasir: Siti');
    expect(receipt).toContain('*TOTAL: Rp 15.000*');
    // Dibayar 17.000 untuk total 15.000 -> kembalian 2.000
    expect(receipt).toContain('Bayar (Tunai): Rp 17.000');
    expect(receipt).toContain('Kembali: Rp 2.000');
  });

  it('menyembunyikan baris kembalian bila tidak ada kembalian', () => {
    const exact = buildReceiptMessage({
      invoiceNo: 'INV/2026/10/00043',
      storeName: 'Warung Bu Tuti',
      cashierName: 'Siti',
      dateLabel: '01-10-2026 14:36',
      lines: [
        { index: 1, name: 'Indomie Goreng', qty: 5, unitPrice: sen(300_000), total: sen(1_500_000) },
      ],
      subtotal: sen(1_500_000),
      discountTotal: sen(0),
      taxTotal: sen(0),
      total: sen(1_500_000),
      paymentLabel: 'QRIS',
      change: sen(0),
    });
    expect(exact).not.toContain('Kembali:');
    expect(exact).toContain('Bayar (QRIS): Rp 15.000');
  });
});
