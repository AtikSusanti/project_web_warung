'use client';

import { useCart } from '@/lib/cartStore';
import CartItem from '@/components/CartItem';
import Header from '@/components/Header';
import Link from 'next/link';
import React from 'react';

function formatRupiah(value: string | number): string {
  const n = Number(value) / 100;
  if (!Number.isFinite(n)) return 'Rp \u2014';
  return 'Rp ' + n.toLocaleString('id-ID');
}

export default function CartPage() {
  const { items, subtotal, itemCount, clearCart } = useCart();

  return (
    <main className="min-h-screen bg-[#faf6ee] text-[#26332a]">
      <Header />
      <section className="mx-auto max-w-4xl px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold tracking-tight">Keranjang Belanja</h1>
          {itemCount > 0 && (
            <button
              onClick={clearCart}
              className="text-sm text-[#c0392b] hover:underline"
            >
              Kosongkan keranjang
            </button>
          )}
        </div>

{items.length === 0 ? (
          <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
            <svg
              className="mx-auto h-24 w-24 text-[#e6ddc8]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
              <line x1="3" y1="6" x2="21" y2="6" />
              <path d="M16 10a4 4 0 0 1 0 8" />
            </svg>
            <h2 className="mt-6 text-xl font-semibold text-[#26332a]">Keranjang Kosong</h2>
            <p className="mt-2 text-[#8a8f7d]">Belum ada produk di keranjang.</p>
            <Link
              href="/products"
              className="mt-6 inline-block rounded-xl bg-[#5c7a5f] px-6 py-3 text-white font-medium transition hover:bg-[#4c6b4f]"
            >
              Mulai Belanja
            </Link>
          </div>
        ) : (
          <React.Fragment>
            <div className="space-y-3">
              {items.map((item) => (
                <CartItem key={item.id} item={item} />
              ))}
            </div>

            <div className="mt-6 rounded-2xl border border-[#e6ddc8] bg-white p-6">
              <div className="flex justify-between text-base mb-4">
                <span className="text-[#8a8f7d]">Subtotal</span>
                <span className="text-xl font-bold text-[#26332a]">{formatRupiah(subtotal)}</span>
              </div>
              <p className="text-sm text-[#8a8f7d] mb-4">
                {itemCount} item \u00b7 Harga sudah termasuk PPN
              </p>
              <Link
                href="/checkout"
                className="w-full rounded-xl bg-[#5c7a5f] text-white py-3 font-semibold text-base transition hover:bg-[#4c6b4f]"
              >
                Lanjut ke Checkout
              </Link>
            </div>
          </React.Fragment>
        )}
      </section>
    </main>
  );
}