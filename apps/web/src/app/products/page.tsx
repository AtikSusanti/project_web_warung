'use client';

import { useEffect, useMemo, useState } from 'react';

import Header from '@/components/Header';
import ProductCard, { type ProductCardProps } from '@/components/ProductCard';

type Product = ProductCardProps & { isActive: boolean; isPublic: boolean; category: { name: string } | null; stockQty: number };

type ProductsResponse = {
  success: boolean;
  data: Product[];
  error: unknown;
};

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [sort, setSort] = useState<'name' | 'price-asc' | 'price-desc'>('name');

  useEffect(() => {
    let cancelled = false;

    fetch('http://localhost:3000/api/v1/products')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<ProductsResponse>;
      })
      .then((json) => {
        if (cancelled) return;
        if (!json.success) throw new Error('Gagal memuat produk dari server');
        const items: Product[] = (json.data ?? []).map((p: any) => ({
          ...p,
          price: p.priceSell,
          stock: p.stockQty,
        }));
        setProducts(items);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Terjadi kesalahan yang tidak diketahui');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const categories = useMemo(() => Array.from(new Set(products.map((p) => p.category?.name).filter(Boolean))), [products]);

  const visible = useMemo(() => {
    let list = products;
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q));
    }
    if (category !== 'all') list = list.filter((p) => p.category?.name === category);
    if (sort === 'price-asc') list = [...list].sort((a, b) => Number(a.price) - Number(b.price));
    else if (sort === 'price-desc') list = [...list].sort((a, b) => Number(b.price) - Number(a.price));
    else list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [products, query, category, sort]);

  return (
    <main className="min-h-screen bg-[#faf6ee] text-[#26332a]">
      <Header />
      <section className="bg-gradient-to-r from-[#7fa083] to-[#5c7a5f]">
        <div className="mx-auto max-w-6xl px-4 py-10">
          <h1 className="text-3xl font-bold tracking-tight text-white">Katalog Produk</h1>
          <p className="mt-2 text-white/90">{products.length} produk tersedia</p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-6">
        <div className="grid gap-3 rounded-2xl border border-[#e6ddc8] bg-white p-4 shadow-sm sm:grid-cols-[1fr_auto_auto]">
          <div className="relative">
            <svg
              className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#8a8f7d]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <input
              type="search"
              placeholder="Cari produk…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full rounded-xl border border-[#e6ddc8] bg-[#faf6ee] py-2 pl-10 pr-4 text-sm text-[#26332a] placeholder:text-[#8a8f7d] focus:border-[#7fa083] focus:outline-none focus:ring-2 focus:ring-[#7fa083]/30"
            />
          </div>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded-xl border border-[#e6ddc8] bg-white px-4 py-2 text-sm text-[#26332a] focus:border-[#7fa083] focus:outline-none focus:ring-2 focus:ring-[#7fa083]/30"
          >
            <option value="all">Semua Kategori</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as 'name' | 'price-asc' | 'price-desc')}
            className="rounded-xl border border-[#e6ddc8] bg-white px-4 py-2 text-sm text-[#26332a] focus:border-[#7fa083] focus:outline-none focus:ring-2 focus:ring-[#7fa083]/30"
          >
            <option value="name">Urutkan: Nama A-Z</option>
            <option value="price-asc">Harga: Termurah</option>
            <option value="price-desc">Harga: Termahal</option>
          </select>
        </div>

        <p className="mt-4 text-sm text-[#8a8f7d]">
          Menampilkan <span className="font-medium">{visible.length}</span> dari <span className="font-medium">{products.length}</span> produk
        </p>

        {loading && (
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="animate-pulse rounded-2xl border border-[#e6ddc8] bg-white overflow-hidden">
                <div className="h-40 bg-gradient-to-br from-[#eef4ea] to-[#e6ddc8]" />
                <div className="p-4 space-y-3">
                  <div className="h-2 w-1/3 bg-[#e6ddc8] rounded" />
                  <div className="h-4 w-3/4 bg-[#e6ddc8] rounded" />
                  <div className="h-2 w-1/2 bg-[#e6ddc8] rounded" />
                  <div className="h-6 w-1/3 bg-[#e6ddc8] rounded" />
                </div>
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-6 text-center text-red-700">
            Error: {error}
          </div>
        )}

        {!loading && !error && products.length === 0 && (
          <div className="mt-8 rounded-xl border border-[#e6ddc8] bg-white p-8 text-center text-[#8a8f7d]">
            Belum ada produk.
          </div>
        )}

        {!loading && !error && products.length > 0 && visible.length === 0 && (
          <div className="mt-8 rounded-xl border border-[#e6ddc8] bg-white p-8 text-center text-[#8a8f7d]">
            Tidak ada produk yang cocok dengan pencarian/filter.
          </div>
        )}

        {!loading && !error && visible.length > 0 && (
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {visible.map((p) => (
              <ProductCard
                key={p.id}
                id={p.id}
                name={p.name}
                price={p.price}
                stock={p.stock}
                unit={p.unit}
                category={p.category?.name ?? 'Tanpa Kategori'}
                imageUrl={p.imageUrl}
                sku={p.sku}
              />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}