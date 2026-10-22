'use client';

import { useEffect, useState } from 'react';

import Header from '@/components/Header';
import ProductImage from '@/components/ProductImage';

type Product = {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  slug: string;
  description: string | null;
  categoryId: string;
  priceBuy: number;
  priceSell: number;
  priceWholesale: number | null;
  stockQty: number;
  minStock: number;
  wholesaleMinQty: number | null;
  unit: string;
  imageUrl: string | null;
  isActive: boolean;
  isFeatured: boolean;
  isPublic: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  category: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    parentId: string | null;
    color: string;
    imageUrl: string | null;
    sortOrder: number;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
  };
};

type ProductsResponse = {
  success: boolean;
  data: Product | null;
  error: unknown;
};

function formatRupiah(value: string | number): string {
  const n = Number(value) / 100;
  if (!Number.isFinite(n)) return 'Rp —';
  return `Rp ${n.toLocaleString('id-ID')}`;
}

function StockBadge({ stock, minStock }: { stock: number; minStock: number }) {
  if (stock <= 0) return <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-sm font-medium text-red-700">Stok habis</span>;
  if (stock <= minStock) return <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-sm font-medium text-amber-800">Stok menipis</span>;
  return <span className="rounded-full bg-[#e8efe6] px-2.5 py-0.5 text-sm font-medium text-[#4c6b4f]">Stok ready</span>;
}

export default function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    params.then(({ id }) => {
      fetch(`http://localhost:3000/api/v1/products/${id}`)
        .then((res) => {
          if (!res.ok) throw new Error(res.status === 404 ? 'Produk tidak ditemukan' : `HTTP ${res.status}`);
          return res.json() as Promise<ProductsResponse>;
        })
        .then((json) => {
          if (cancelled) return;
          if (!json.success || !json.data) throw new Error(json.data ? 'Produk tidak ditemukan' : 'Gagal memuat produk');
          setProduct(json.data);
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          setError(e instanceof Error ? e.message : 'Terjadi kesalahan yang tidak diketahui');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    });

    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <main className="min-h-screen bg-[#faf6ee] text-[#26332a]">
        <Header />
        <section className="mx-auto max-w-4xl px-4 py-8">
          <div className="animate-pulse space-y-6">
            <div className="h-80 bg-gradient-to-br from-[#eef4ea] to-[#e6ddc8] rounded-2xl" />
            <div className="grid md:grid-cols-2 gap-8">
              <div className="h-6 w-1/4 bg-[#e6ddc8] rounded" />
              <div className="h-8 w-3/4 bg-[#e6ddc8] rounded" />
              <div className="h-4 w-1/2 bg-[#e6ddc8] rounded" />
              <div className="h-4 w-1/2 bg-[#e6ddc8] rounded" />
            </div>
          </div>
        </section>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-[#faf6ee] text-[#26332a]">
        <Header />
        <section className="mx-auto max-w-4xl px-4 py-16 text-center">
          <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-red-700">
            <h2 className="text-xl font-semibold">Error</h2>
            <p className="mt-2">{error}</p>
            <a href="/products" className="mt-4 inline-block rounded-full bg-[#5c7a5f] px-6 py-2 text-white hover:bg-[#4c6b4f]">
              Kembali ke Katalog
            </a>
          </div>
        </section>
      </main>
    );
  }

  if (!product) {
    return (
      <main className="min-h-screen bg-[#faf6ee] text-[#26332a]">
        <Header />
        <section className="mx-auto max-w-4xl px-4 py-16 text-center">
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-8 text-gray-600">
            Produk tidak ditemukan.
            <a href="/products" className="mt-4 inline-block rounded-full bg-[#5c7a5f] px-6 py-2 text-white hover:bg-[#4c6b4f]">
              Kembali ke Katalog
            </a>
          </div>
        </section>
      </main>
    );
  }

  const { name, sku, barcode, description, priceBuy, priceSell, priceWholesale, stockQty, minStock, unit, wholesaleMinQty, isActive, imageUrl, category } = product;

  return (
    <main className="min-h-screen bg-[#faf6ee] text-[#26332a]">
      <Header />
      <section className="mx-auto max-w-4xl px-4 py-8">
        <nav className="flex items-center gap-2 text-sm text-[#8a8f7d]" aria-label="Breadcrumb">
          <a href="/products" className="hover:text-[#5c7a5f]">Katalog</a>
          <span>/</span>
          <span className="text-[#26332a] font-medium">{name}</span>
        </nav>

        <div className="mt-8 grid md:grid-cols-2 gap-8">
          <div className="relative h-80 md:h-[450px] rounded-2xl overflow-hidden bg-gradient-to-br from-[#b9cdb4] via-[#9dba9e] to-[#7fa083]">
            <ProductImage src={product.imageUrl} alt={name} className="h-full w-full" category={category.name} sku={sku} />
            <div className="absolute top-4 left-4">
              <span className="rounded-full bg-white/90 px-3 py-1 text-sm font-semibold uppercase tracking-wide text-[#5c7a5f]">{category.name}</span>
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-[#eef4ea] px-3 py-1 text-sm font-semibold uppercase tracking-wide text-[#5c7a5f]">{category.name}</span>
              {!product.isActive && <span className="rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-600">Tidak aktif</span>}
            </div>

            <h1 className="text-3xl font-bold tracking-tight text-[#26332a]">{name}</h1>
            <p className="text-sm text-[#8a8f7d]">SKU: {sku} {barcode && `· Barcode: ${barcode}`}</p>

            <div className="flex items-baseline gap-3">
              <p className="text-3xl font-bold text-[#3f5d43]">{formatRupiah(priceSell)}</p>
              {product.priceWholesale && product.wholesaleMinQty && (
                <span className="self-end rounded-full bg-[#eef4ea] px-3 py-1 text-sm font-medium text-[#5c7a5f]">
                  Harga grosir: {formatRupiah(product.priceWholesale)} (min. {product.wholesaleMinQty} {unit})
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <StockBadge stock={stockQty} minStock={minStock} />
              <span className="rounded-full bg-[#eef4ea] px-3 py-1 text-sm font-medium text-[#5c7a5f]">Stok: {stockQty.toLocaleString('id-ID')} {unit}</span>
              <span className="rounded-full bg-[#eef4ea] px-3 py-1 text-sm font-medium text-[#5c7a5f]">Minimal stok: {minStock} {unit}</span>
            </div>

            {description && (
              <div className="pt-2 border-t border-[#e6ddc8]">
                <h3 className="text-sm font-semibold text-[#5c7a5f]">Deskripsi</h3>
                <p className="mt-1 text-gray-700 whitespace-pre-line">{description}</p>
              </div>
            )}

            <dl className="grid grid-cols-2 gap-2 text-sm text-[#8a8f7d] border-t border-[#e6ddc8] pt-4">
              <dt>Harga beli</dt>
              <dd className="text-[#26332a] font-medium">{formatRupiah(priceBuy)}</dd>
              <dt>Satuan</dt>
              <dd className="text-[#26332a] font-medium">{unit}</dd>
              <dt>Batas stok minimal</dt>
              <dd className="text-[#26332a] font-medium">{minStock} {unit}</dd>
              {wholesaleMinQty && (
                <>
                  <dt>Min. pembelian grosir</dt>
                  <dd className="text-[#26332a] font-medium">{wholesaleMinQty} {unit}</dd>
                </>
              )}
            </dl>

            <div className="mt-6 flex gap-3">
              <a
                href="/products"
                className="flex-1 rounded-xl border border-[#e6ddc8] bg-white px-6 py-3 text-center text-sm font-medium text-[#5c7a5f] transition hover:bg-[#faf6ee]"
              >
                ← Kembali ke Katalog
              </a>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}