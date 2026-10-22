'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useCart } from '@/lib/cartStore';
import CartDrawer from './CartDrawer';

export default function Header() {
  const { itemCount, isHydrated } = useCart();
  const [isCartOpen, setIsCartOpen] = useState(false);

  return (
    <>
      <header className="sticky top-0 z-10 border-b border-[#e6ddc8] bg-[#faf6ee]/95 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#7fa083] to-[#5c7a5f] text-white shadow-sm">
              <svg
                className="h-5 w-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
                <path d="m3.3 7 8.7 5 8.7-5" />
                <path d="M12 22V12" />
              </svg>
            </span>
            <span className="text-lg font-bold tracking-tight text-[#26332a]">Warung</span>
          </Link>
          <nav className="flex items-center gap-1 text-sm font-medium">
            <Link
              href="/"
              className="rounded-full px-4 py-2 text-[#5c6b58] transition hover:bg-[#eef4ea] hover:text-[#3f5d43]"
            >
              Beranda
            </Link>
            <Link
              href="/products"
              className="rounded-full bg-[#5c7a5f] px-4 py-2 text-white shadow-sm transition hover:bg-[#4c6b4f]"
            >
              Katalog
            </Link>
          </nav>
          <button
            onClick={() => setIsCartOpen(true)}
            className="relative p-2 rounded-full text-[#5c7a5f] hover:bg-[#eef4ea] transition"
            aria-label={"Keranjang (" + itemCount + " item)"}
          >
            <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
              <line x1="3" y1="6" x2="21" y2="6" />
              <path d="M16 10a4 4 0 0 1 0 8" />
            </svg>
            {isHydrated && itemCount > 0 && (
              <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-[#c0392b] text-white text-[10px] font-bold">
                {itemCount > 99 ? '99+' : itemCount}
              </span>
            )}
          </button>
      </div>
    </header>
    {isCartOpen && <CartDrawer onClose={() => setIsCartOpen(false)} />}
  </>
  );
}