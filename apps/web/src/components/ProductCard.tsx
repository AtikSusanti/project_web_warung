'use client';

import Link from 'next/link';
import { useCart } from '@/lib/cartStore';
import ProductImage from './ProductImage';

export type ProductCardProps = {
  id: string;
  name: string;
  price: number;
  stock: number;
  unit: string;
  category: string;
  imageUrl: string | null;
  sku: string;
};

function formatRupiah(value: string | number): string {
  const n = Number(value) / 100;
  if (!Number.isFinite(n)) return 'Rp —';
  return `Rp ${n.toLocaleString('id-ID')}`;
}

export default function ProductCard({ id, name, price, stock, unit, category, imageUrl, sku }: ProductCardProps) {
  const { addItem } = useCart();

  const isLow = stock <= 10 && stock > 0;
  const isOut = stock <= 0;
  const stockLabel = isOut ? 'Stok habis' : isLow ? 'Stok menipis' : 'Stok ready';
  const stockTone = isOut
    ? 'bg-red-100 text-red-700'
    : isLow
      ? 'bg-amber-100 text-amber-800'
      : 'bg-[#e8efe6] text-[#4c6b4f]';

  const handleAddToCart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    addItem({ id, name, price, stock, unit, category, imageUrl, sku, qty: 1 });
  };

  return (
    <Link
      href={`/products/${id}`}
      className="group flex flex-col overflow-hidden rounded-2xl border border-[#e6ddc8] bg-white shadow-sm transition duration-200 hover:-translate-y-1 hover:shadow-lg"
    >
      <ProductImage src={imageUrl} alt={name} className="h-40 w-full" category={category} sku={sku} />
      <div className="flex flex-1 flex-col gap-2 p-4">
        <span className="w-fit rounded-full bg-[#eef4ea] px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-[#5c7a5f]">
          {category}
        </span>
        <h3 className="line-clamp-2 text-sm font-semibold text-[#26332a] group-hover:text-[#4c6b4f]">
          {name}
        </h3>
        <div className="mt-auto flex items-end justify-between">
          <p className="text-lg font-bold text-[#3f5d43]">{formatRupiah(price)}</p>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${stockTone}`}>
            {stockLabel}
          </span>
        </div>
        <p className="text-xs text-[#8a8f7d]">
          Stok: {stock.toLocaleString('id-ID')} {unit}
        </p>
        <button
          type="button"
          onClick={handleAddToCart}
          disabled={stock <= 0}
          className="mt-3 w-full rounded-xl bg-[#5c7a5f] text-white py-2 font-medium text-sm transition hover:bg-[#4c6b4f] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {stock <= 0 ? 'Stok Habis' : 'Tambah ke Keranjang'}
        </button>
      </div>
    </Link>
  );
}