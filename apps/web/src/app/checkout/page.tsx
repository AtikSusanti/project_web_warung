'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Header from '@/components/Header';
import { useCart } from '@/lib/cartStore';

interface OrderResponse {
  id: string;
  orderNo: string;
  customerName: string;
  customerPhone: string;
  status: string;
  subtotal: string;
  total: string;
  waMessage: string;
  waUrl: string;
  createdAt: string;
  items: Array<{
    id: string;
    productName: string;
    sku: string;
    qty: number;
    unitPrice: string;
    total: string;
  }>;
}

function formatRupiah(value: string): string {
  const n = Number(value) / 100;
  if (!Number.isFinite(n)) return 'Rp —';
  return 'Rp ' + n.toLocaleString('id-ID');
}

export default function CheckoutPage() {
  const router = useRouter();
  const { items, subtotal, clearCart } = useCart();
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orderResult, setOrderResult] = useState<OrderResponse | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!customerName.trim()) {
      setError('Nama wajib diisi');
      return;
    }
    if (!customerPhone.trim()) {
      setError('Nomor HP wajib diisi');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('http://localhost:3000/api/v1/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: customerName.trim(),
          customerPhone: customerPhone.trim(),
          lines: items.map((item) => ({
            productId: item.id,
            qty: item.qty,
          })),
          note: note.trim() || undefined,
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error?.message || 'Gagal membuat pesanan');
      }

      setOrderResult(result.data);
      clearCart();
    } catch (err: any) {
      setError(err.message || 'Terjadi kesalahan');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenWhatsApp = () => {
    if (orderResult?.waUrl) {
      window.open(orderResult.waUrl, '_blank');
    }
  };

  if (orderResult) {
    return (
      <main className="min-h-screen bg-[#faf6ee] text-[#26332a]">
        <Header />
        <section className="mx-auto max-w-2xl px-4 py-8">
          <div className="rounded-2xl border border-[#e6ddc8] bg-white p-6 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#5c7a5f]/10">
              <svg className="h-8 w-8 text-[#5c7a5f]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Pesanan Berhasil Dibuat!</h1>
            <p className="mt-2 text-[#8a8f7d]">
              No. Pesanan: <span className="font-semibold text-[#26332a]">{orderResult.orderNo}</span>
            </p>

            <div className="mt-6 rounded-xl bg-[#faf6ee] p-4 text-left">
              <h2 className="mb-2 text-sm font-semibold text-[#8a8f7d]">Ringkasan Pesanan</h2>
              <div className="space-y-1">
                {orderResult.items.map((item) => (
                  <div key={item.id} className="flex justify-between text-sm">
                    <span>{item.productName} x{item.qty}</span>
                    <span>{formatRupiah(item.total)}</span>
                  </div>
                ))}
              </div>
              <div className="mt-3 border-t border-[#e6ddc8] pt-3">
                <div className="flex justify-between font-bold">
                  <span>Total</span>
                  <span>{formatRupiah(orderResult.total)}</span>
                </div>
              </div>
            </div>

            {orderResult.waMessage && (
              <div className="mt-4 rounded-xl border border-[#e6ddc8] bg-white p-4 text-left">
                <h2 className="mb-2 text-sm font-semibold text-[#8a8f7d]">Pesan WhatsApp</h2>
                <pre className="whitespace-pre-wrap text-sm text-[#26332a]">{orderResult.waMessage}</pre>
              </div>
            )}

            <button
              onClick={handleOpenWhatsApp}
              className="mt-6 w-full rounded-xl bg-[#25D366] py-3 font-semibold text-white transition hover:bg-[#1da851]"
            >
              Buka WhatsApp & Kirim Pesanan
            </button>

            <Link
              href="/products"
              className="mt-3 block text-sm text-[#5c7a5f] hover:underline"
            >
              Kembali ke Katalog
            </Link>
          </div>
        </section>
      </main>
    );
  }

  if (items.length === 0) {
    return (
      <main className="min-h-screen bg-[#faf6ee] text-[#26332a]">
        <Header />
        <section className="mx-auto max-w-2xl px-4 py-8">
          <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
            <h2 className="text-xl font-semibold">Keranjang Kosong</h2>
            <p className="mt-2 text-[#8a8f7d]">Tambahkan produk terlebih dahulu.</p>
            <Link
              href="/products"
              className="mt-6 inline-block rounded-xl bg-[#5c7a5f] px-6 py-3 text-white font-medium transition hover:bg-[#4c6b4f]"
            >
              Lihat Katalog
            </Link>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#faf6ee] text-[#26332a]">
      <Header />
      <section className="mx-auto max-w-2xl px-4 py-8">
        <h1 className="mb-6 text-2xl font-bold tracking-tight">Checkout</h1>

        <div className="rounded-2xl border border-[#e6ddc8] bg-white p-6">
          <h2 className="mb-4 text-lg font-semibold">Ringkasan Pesanan</h2>
          <div className="space-y-2">
            {items.map((item) => (
              <div key={item.id} className="flex justify-between text-sm">
                <span>{item.name} x{item.qty}</span>
                <span>{formatRupiah(String(Number(item.price) * item.qty))}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 border-t border-[#e6ddc8] pt-4">
            <div className="flex justify-between font-bold">
              <span>Total</span>
              <span>{formatRupiah(String(subtotal))}</span>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 rounded-2xl border border-[#e6ddc8] bg-white p-6">
          <h2 className="mb-4 text-lg font-semibold">Data Pengiriman</h2>

          <div className="space-y-4">
            <div>
              <label htmlFor="customerName" className="mb-1 block text-sm font-medium text-[#8a8f7d]">
                Nama Lengkap
              </label>
              <input
                id="customerName"
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Masukkan nama Anda"
                className="w-full rounded-xl border border-[#e6ddc8] bg-[#faf6ee] px-4 py-3 text-[#26332a] placeholder-[#8a8f7d] focus:border-[#5c7a5f] focus:outline-none"
                required
              />
            </div>

            <div>
              <label htmlFor="customerPhone" className="mb-1 block text-sm font-medium text-[#8a8f7d]">
                Nomor HP / WhatsApp
              </label>
              <input
                id="customerPhone"
                type="tel"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                placeholder="08xxxxxxxxxx"
                className="w-full rounded-xl border border-[#e6ddc8] bg-[#faf6ee] px-4 py-3 text-[#26332a] placeholder-[#8a8f7d] focus:border-[#5c7a5f] focus:outline-none"
                required
              />
            </div>

            <div>
              <label htmlFor="note" className="mb-1 block text-sm font-medium text-[#8a8f7d]">
                Catatan (opsional)
              </label>
              <textarea
                id="note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Contoh: Tolong dibungkus rapi"
                rows={3}
                className="w-full rounded-xl border border-[#e6ddc8] bg-[#faf6ee] px-4 py-3 text-[#26332a] placeholder-[#8a8f7d] focus:border-[#5c7a5f] focus:outline-none"
              />
            </div>
          </div>

          {error && (
            <div className="mt-4 rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-6 w-full rounded-xl bg-[#5c7a5f] py-3 font-semibold text-white transition hover:bg-[#4c6b4f] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Membuat Pesanan...' : 'Buat Pesanan & Kirim via WhatsApp'}
          </button>

          <p className="mt-3 text-center text-xs text-[#8a8f7d]">
            Pesanan akan dibuat dan Anda akan diarahkan ke WhatsApp untuk mengirim pesanan.
          </p>
        </form>
      </section>
    </main>
  );
}
