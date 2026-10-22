import { formatIDR, sen, type Sen } from './money.js';
import { normalizeIndonesianPhone, WA_MESSAGE_MAX_LENGTH, WA_PHONE_PATTERN } from './constants.js';

/**
 * Pembuat pesan WhatsApp.
 *
 * Dua jalur, sesuai blueprint §3.3:
 * - `wa.me` deep link (gratis, tanpa API key). Pelanggan yang menekan tombol
 *   akan membuka WhatsApp dengan pesan sudah terisi, lalu menekan Send.
 * - WhatsApp Business Cloud API (berbayar, opsional). Dipakai untuk mengirim
 *   reminder utang otomatis dari sisi server.
 *
 * Karena jalur pertama memindahkan pindah ke aplikasi WhatsApp, kita TIDAK bisa
 * tahu pesan benar-benar terkirim. Aplikasi hanya bisa mencatat `PENDING_WA`
 * lalu `WA_SENT` setelah redirect terjadi, dan itu pun perkiraan kasir/pelanggan
 * yang mengonfirmasi. Jangan pernah menandai CONFIRMED secara otomatis —
 * pemesanan bisa saja tidak jadi dikirim.
 */

export interface WhatsAppOrderLine {
  /** Nomor urut baris, mulai 1. */
  index: number;
  name: string;
  qty: number;
  unitPrice: Sen;
  /** Total baris SETELAH diskon. */
  total: Sen;
}

export interface WhatsAppOrderPayload {
  customerName: string;
  /** Opsional. Nomor pelanggan tidak lagi dicantumkan pada pesanan checkout. */
  customerPhone?: string;
  storeName: string;
  lines: readonly WhatsAppOrderLine[];
  subtotal: Sen;
  discountTotal: Sen;
  total: Sen;
  note?: string | null;
  /** Nomor pesanan dari server, dipakai owner untuk mencocokkan. */
  orderReference?: string | null;
  /** Tanggal transaksi/bBCA lokal, mis. "01-10-2026 14:32". */
  dateLabel?: string | null;
}

const HEADING = 'PESANAN BARU';
const SEPARATOR = '------------------------';

/**
 * Menyusun isi pesan. Mengikuti format blueprint §5.3 dengan beberapa
 * perbaikan: label tanggal, nomor pesanan untuk rekonsiliasi, dan
 * glycemic nomor WhatsApp tujuan yang sudah dinormalisasi ke 62xxx.
 */
export function buildWhatsAppMessage(payload: WhatsAppOrderPayload): string {
  const parts: string[] = [];

  parts.push(`*${HEADING}*`);
  if (payload.orderReference) parts.push(`No. Pesanan: ${payload.orderReference}`);
  if (payload.dateLabel) parts.push(`Tanggal: ${payload.dateLabel}`);
  parts.push(`Toko: ${payload.storeName}`);
  parts.push(`Nama: ${payload.customerName}`);
  if (payload.customerPhone?.trim()) parts.push(`HP: ${payload.customerPhone}`);
  parts.push('');

  for (const line of payload.lines) {
    parts.push(`${line.index}. ${line.name} x${line.qty} = ${formatIDR(line.total)}`);
  }

  parts.push(SEPARATOR);
  if (payload.discountTotal > 0) {
    parts.push(`Subtotal: ${formatIDR(payload.subtotal)}`);
    parts.push(`Diskon: -${formatIDR(payload.discountTotal)}`);
  }
  parts.push(`*TOTAL: ${formatIDR(payload.total)}*`);

  if (payload.note && payload.note.trim() !== '') {
    parts.push('');
    parts.push(`Catatan: ${payload.note.trim()}`);
  }

  const message = parts.join('\n');
  return truncateSafely(message);
}

/**
 * Memotong pesan agar tidak melebihi batas WhatsApp tanpa memotong di tengah
 * nilai uang. Memotong setelah baris terakhir yang muat, lalu menambah penanda.
 */
function truncateSafely(message: string): string {
  if (message.length <= WA_MESSAGE_MAX_LENGTH) return message;
  const marker = '\n\n(Pesan dipotong karena melebihi batas WhatsApp)';
  const budget = WA_MESSAGE_MAX_LENGTH - marker.length;
  const head = message.slice(0, budget);
  const lastNewline = head.lastIndexOf('\n');
  const trimmed = lastNewline > budget * 0.5 ? head.slice(0, lastNewline) : head;
  return `${trimmed}${marker}`;
}

/**
 * Membangun URL `wa.me` yang akan dibuka aplikasi.
 *
 * Nomor tujuan harus sudah format 62xxx (lihat `normalizeIndonesianPhone`).
 * `wa.me` menolak nomor non-WhatsApp, jadi kalau owner salah memasukkan nomor
 * HP biasa, pelanggan melihat halaman error alih-alih WhatsApp. Validasi di
 * Validasi di sini menunjuk ke koreksi, bukan ke halaman error WhatsApp.
 */
export function buildWhatsAppUrl(phone: string, message: string): string | null {
  const normalized = normalizeIndonesianPhone(phone);
  if (!normalized || !WA_PHONE_PATTERN.test(normalized)) return null;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}

/** Link tanpa nomor tujuan, untuk tombol "Kirim via WhatsApp saya sendiri". */
export function buildWhatsAppShareUrl(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

/** Format pesan invoice/transaksi POS, dipakai untuk struk digital. */
export function buildReceiptMessage(payload: {
  invoiceNo: string;
  storeName: string;
  cashierName: string;
  dateLabel: string;
  lines: readonly WhatsAppOrderLine[];
  subtotal: Sen;
  discountTotal: Sen;
  taxTotal: Sen;
  total: Sen;
  paymentLabel: string;
  change: Sen;
  customerName?: string | null;
}): string {
  const parts: string[] = [];
  parts.push(`*STRUK ${payload.invoiceNo}*`);
  parts.push(payload.storeName);
  parts.push(`Kasir: ${payload.cashierName}`);
  parts.push(`Waktu: ${payload.dateLabel}`);
  if (payload.customerName) parts.push(`Pelanggan: ${payload.customerName}`);
  parts.push('');
  for (const line of payload.lines) {
    parts.push(`${line.index}. ${line.name} x${line.qty} = ${formatIDR(line.total)}`);
  }
  parts.push(SEPARATOR);
  if (payload.discountTotal > 0) {
    parts.push(`Subtotal: ${formatIDR(payload.subtotal)}`);
    parts.push(`Diskon: -${formatIDR(payload.discountTotal)}`);
  }
  if (payload.taxTotal > 0) parts.push(`PPN: ${formatIDR(payload.taxTotal)}`);
  parts.push(`*TOTAL: ${formatIDR(payload.total)}*`);
  parts.push(`Bayar (${payload.paymentLabel}): ${formatIDR(sen(payload.total + payload.change))}`);
  if (payload.change > 0) parts.push(`Kembali: ${formatIDR(payload.change)}`);
  parts.push('');
  parts.push('Terima kasih sudah berbelanja!');
  return truncateSafely(parts.join('\n'));
}
