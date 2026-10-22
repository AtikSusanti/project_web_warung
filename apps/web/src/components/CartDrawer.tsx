'use client';

import { usePathname, useRouter } from 'next/navigation';

import { useCart } from '@/lib/cartStore';
import CartItem from './CartItem';


export default function CartDrawer({ onClose }: { onClose?: () => void }) {
  const { items, subtotal, itemCount, clearCart } = useCart();
  const router = useRouter();
  const pathname = usePathname();

  const handleClose = () => {
    if (onClose) {
      onClose();
      return;
    }
    if (pathname === '/cart') {
      router.push('/products');
      return;
    }
    window.dispatchEvent(new Event('cart-close'));
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white lg:w-80">
      <div className="flex items-center justify-between p-4 border-b border-[#e6ddc8]">
        <h2 className="text-lg font-semibold text-[#26332a]">Keranjang</h2>
        <button
          onClick={handleClose}
          className="p-2 text-gray-400 hover:text-gray-600"
          aria-label="Tutup keranjang"
        >
          <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-[#8a8f7d]">
            <svg className="h-16 w-16 text-[#e6ddc8]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
              <line x1="3" y1="6" x2="21" y2="6" />
              <path d="M16 10a4 4 0 0 1 0 8" />
            </svg>
            <p className="mt-4 text-[#8a8f7d]">Keranjang kosong</p>
            <p className="text-sm text-[#c4c4b5]">Tambah produk dari katalog</p>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              {items.map((item) => (
                <CartItem key={item.id} item={item} />
              ))}
            </div>
            <div className="pt-4 border-t border-[#e6ddc8]">
              <div className="flex justify-between text-sm text-[#8a8f7d] mb-2">
                <span>Subtotal</span>
                <span className="font-medium text-[#26332a]">{formatRupiah(String(subtotal))}</span>
              </div>
              <div className="text-xs text-[#8a8f7d] text-center">
                {itemCount} item · Klik untuk lanjut ke checkout
              </div>
            </div>
          </>
        )}
      </div>

      <div className="p-4 border-t border-[#e6ddc8] bg-white">
        <button
          onClick={() => window.location.href = '/checkout'}
          className="w-full rounded-xl bg-[#5c7a5f] text-white py-3 font-semibold text-sm transition hover:bg-[#4c6b4f]"
        >
          Lanjut ke Checkout
        </button>
        <button
          onClick={() => clearCart()}
          className="mt-2 w-full rounded-xl border border-[#e6ddc8] bg-white py-2 text-sm font-medium text-[#5c7a5f] transition hover:bg-[#faf6ee]"
        >
          Kosongkan Keranjang
        </button>
      </div>
    </div>
  );
}

function formatRupiah(value: string | number): string {
  const n = Number(value) / 100;
  if (!Number.isFinite(n)) return 'Rp —';
  return `Rp ${n.toLocaleString('id-ID')}`;
}