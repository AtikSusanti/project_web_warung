'use client';

import { useCart } from '@/lib/cartStore';
import ProductImage from './ProductImage';

export default function CartItem({ item }: { item: any }) {
  const { updateQty, removeItem } = useCart();

  const isLow = item.stock <= 10 && item.stock > 0;
  const isOut = item.stock <= 0;
  const stockLabel = item.stock <= 0 ? 'Stok habis' : item.stock <= 10 ? 'Stok menipis' : 'Stok ready';
  const stockTone = item.stock <= 0
    ? 'bg-red-100 text-red-700'
    : item.stock <= 10
      ? 'bg-amber-100 text-amber-800'
      : 'bg-[#e8efe6] text-[#4c6b4f]';

  const formatRupiah = (value: string | number) => {
    const n = Number(value) / 100;
    if (!Number.isFinite(n)) return 'Rp —';
    return `Rp ${n.toLocaleString('id-ID')}`;
  };

  const handleQtyChange = (delta: number) => {
    const newQty = Math.max(0, Math.min(item.stock, item.qty + delta));
    if (newQty === 0) {
      removeItem(item.sku);
    } else {
      updateQty(item.sku, newQty);
    }
  };

  return (
    <div className="flex gap-4 p-4 rounded-xl border border-[#e6ddc8] bg-white shadow-sm">
      <img
        src={item.imageUrl || `/images/products/${item.sku}.webp`}
        alt={item.name}
        className="h-20 w-20 object-cover rounded-xl"
        onError={(e) => {
          e.currentTarget.style.display = 'none';
        }}
      />
      <div className="flex-1 flex flex-col gap-2 min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-[#5c7a5f]">{item.category}</p>
        <h3 className="text-sm font-semibold text-[#26332a] truncate">{item.name}</h3>
        <p className="text-lg font-bold text-[#3f5d43]">{formatRupiah(item.price)}</p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => updateQty(item.sku, item.qty - 1)}
            className="w-8 h-8 rounded-lg border border-[#e6ddc8] bg-white flex items-center justify-center text-[#5c7a5f] hover:bg-[#faf6ee] transition disabled:opacity-50"
            disabled={item.qty <= 1}
            aria-label="Kurangi"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          <span className="w-10 text-center text-sm font-medium text-[#26332a]">{item.qty}</span>
          <button
            onClick={() => updateQty(item.sku, item.qty + 1)}
            className="w-8 h-8 rounded-lg border border-[#e6ddc8] bg-white flex items-center justify-center text-[#5c7a5f] hover:bg-[#faf6ee] transition disabled:opacity-50"
            disabled={item.qty >= item.stock}
            aria-label="Tambah"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>
        <p className="text-xs text-[#8a8f7d]">Stok: {item.stock.toLocaleString('id-ID')} {item.unit}</p>
      </div>
      <button
        onClick={() => removeItem(item.sku)}
        className="p-2 text-gray-400 hover:text-red-500 transition"
        aria-label="Hapus item"
      >
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
      </button>
    </div>
  );
}
