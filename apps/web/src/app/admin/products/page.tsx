'use client';

import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';

import AdminGate from '@/components/admin/AdminGate';
import {
  type AdminCategory,
  type AdminProduct,
  type AdminSession,
  adminRequest,
  CATEGORY_COLOR_OPTIONS,
  createEmptyProductForm,
  isAdminAuthError,
  PRODUCT_UNITS,
  type ProductFormState,
  productFormToPayload,
  productToForm,
  validateProductForm,
} from '@/lib/admin';
import { formatRupiah } from '@/lib/pos';

type ProductsContentProps = {
  session: AdminSession;
  expireSession: (message?: string) => void;
};

function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium text-[#5c6b58]">
        {label}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-[#8a8f7d]">{hint}</p>}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

const inputClass =
  'w-full rounded-xl border border-[#e6ddc8] bg-[#faf6ee] px-3 py-2 text-sm text-[#26332a] placeholder:text-[#8a8f7d] focus:border-[#5c7a5f] focus:outline-none focus:ring-2 focus:ring-[#7fa083]/30';

function categoryBadge(color: string): string {
  return CATEGORY_COLOR_OPTIONS.find((option) => option.value === color)?.badge ?? 'bg-stone-100 text-stone-700';
}

function ProductsContent({ session, expireSession }: ProductsContentProps) {
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<AdminProduct | null>(null);
  const [form, setForm] = useState<ProductFormState>(createEmptyProductForm);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleError = useCallback(
    (err: unknown) => {
      if (isAdminAuthError(err)) {
        expireSession();
        return;
      }
      setError(err instanceof Error ? err.message : 'Terjadi kesalahan');
    },
    [expireSession],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextProducts, nextCategories] = await Promise.all([
        adminRequest<AdminProduct[]>(session, '/products'),
        adminRequest<AdminCategory[]>(session, '/categories'),
      ]);
      setProducts(nextProducts);
      setCategories(nextCategories);
    } catch (err) {
      handleError(err);
    } finally {
      setLoading(false);
    }
  }, [handleError, session]);

  useEffect(() => {
    void load();
  }, [load]);

  const visibleProducts = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return products.filter((product) => {
      const matchesQuery =
        !needle ||
        product.name.toLowerCase().includes(needle) ||
        product.sku.toLowerCase().includes(needle) ||
        (product.barcode ?? '').toLowerCase().includes(needle);
      const matchesCategory =
        categoryFilter === 'all' || product.categoryId === categoryFilter;
      return matchesQuery && matchesCategory;
    });
  }, [categoryFilter, products, query]);

  const openCreate = () => {
    setEditing(null);
    setForm(createEmptyProductForm());
    setFormErrors({});
    setEditorOpen(true);
  };

  const openEdit = (product: AdminProduct) => {
    setEditing(product);
    setForm(productToForm(product));
    setFormErrors({});
    setEditorOpen(true);
  };

  const closeEditor = () => {
    if (saving) return;
    setEditorOpen(false);
    setEditing(null);
    setFormErrors({});
  };

  const updateField = <K extends keyof ProductFormState>(key: K, value: ProductFormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setFormErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    setNotice(null);
    const errors = validateProductForm(form);
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const payload = productFormToPayload(form);
      await adminRequest<AdminProduct>(
        session,
        editing ? `/products/${editing.id}` : '/products',
        {
          method: editing ? 'PATCH' : 'POST',
          body: JSON.stringify(payload),
        },
      );
      setEditorOpen(false);
      setEditing(null);
      setNotice(editing ? 'Produk berhasil diperbarui.' : 'Produk berhasil ditambahkan.');
      await load();
    } catch (err) {
      if (isAdminAuthError(err)) {
        expireSession();
      } else {
        setFormErrors({ form: err instanceof Error ? err.message : 'Gagal menyimpan produk' });
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (product: AdminProduct) => {
    if (!window.confirm(`Hapus produk "${product.name}"? Produk tidak akan tampil di katalog dan POS.`)) {
      return;
    }
    setDeletingId(product.id);
    setNotice(null);
    setError(null);
    try {
      await adminRequest<null>(session, `/products/${product.id}`, { method: 'DELETE' });
      setNotice('Produk berhasil dihapus.');
      await load();
    } catch (err) {
      handleError(err);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-[#8a8f7d]">
            {products.length} produk terdaftar, {categories.length} kategori tersedia.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="rounded-xl bg-[#5c7a5f] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#4c6b4f]"
        >
          + Tambah Produk
        </button>
      </div>

      <div className="grid gap-3 rounded-2xl border border-[#e6ddc8] bg-white p-4 shadow-sm sm:grid-cols-[1fr_auto]">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Cari nama, SKU, atau barcode..."
          className={inputClass}
        />
        <select
          value={categoryFilter}
          onChange={(event) => setCategoryFilter(event.target.value)}
          className={inputClass}
        >
          <option value="all">Semua Kategori</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </div>

      {notice && (
        <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          {notice}
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="rounded-2xl border border-[#e6ddc8] bg-white shadow-sm">
        {loading ? (
          <div className="p-8 text-center text-sm text-[#8a8f7d]">Memuat produk...</div>
        ) : visibleProducts.length === 0 ? (
          <div className="p-8 text-center text-sm text-[#8a8f7d]">
            {products.length === 0
              ? 'Belum ada produk. Tambahkan produk pertama.'
              : 'Tidak ada produk yang cocok dengan pencarian/filter.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead>
                <tr className="border-b border-[#e6ddc8] text-xs uppercase tracking-wide text-[#8a8f7d]">
                  <th className="px-4 py-3 font-medium">Produk</th>
                  <th className="px-4 py-3 font-medium">Kategori</th>
                  <th className="px-4 py-3 font-medium">Harga Beli</th>
                  <th className="px-4 py-3 font-medium">Harga Jual</th>
                  <th className="px-4 py-3 font-medium">Stok</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#eee6d5]">
                {visibleProducts.map((product) => (
                  <tr key={product.id} className="align-top">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-[#26332a]">{product.name}</p>
                      <p className="mt-0.5 text-xs text-[#8a8f7d]">
                        SKU {product.sku}
                        {product.barcode ? ` · ${product.barcode}` : ''}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      {product.category ? (
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${categoryBadge(product.category.color)}`}
                        >
                          {product.category.name}
                        </span>
                      ) : (
                        <span className="text-xs text-[#8a8f7d]">Tanpa kategori</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[#26332a]">{formatRupiah(product.priceBuy)}</td>
                    <td className="px-4 py-3 font-medium text-[#26332a]">
                      {formatRupiah(product.priceSell)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          product.stockQty <= 0
                            ? 'font-semibold text-red-600'
                            : product.stockQty <= product.minStock
                              ? 'font-semibold text-amber-700'
                              : 'text-[#26332a]'
                        }
                      >
                        {product.stockQty} {product.unit}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            product.isActive ? 'bg-green-100 text-green-700' : 'bg-stone-100 text-stone-600'
                          }`}
                        >
                          {product.isActive ? 'Aktif' : 'Nonaktif'}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            product.isPublic ? 'bg-blue-100 text-blue-700' : 'bg-stone-100 text-stone-600'
                          }`}
                        >
                          {product.isPublic ? 'Publik' : 'Internal'}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => openEdit(product)}
                          className="rounded-lg border border-[#e6ddc8] px-3 py-1.5 text-xs font-medium text-[#5c7a5f] transition hover:bg-[#faf6ee]"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => void handleDelete(product)}
                          disabled={deletingId === product.id}
                          className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50"
                        >
                          {deletingId === product.id ? 'Menghapus...' : 'Hapus'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editorOpen && (
        <div
          className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="product-editor-title"
        >
          <div className="my-4 w-full max-w-3xl rounded-2xl border border-[#e6ddc8] bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-[#e6ddc8] px-5 py-4">
              <div>
                <h2 id="product-editor-title" className="text-xl font-bold text-[#26332a]">
                  {editing ? 'Edit Produk' : 'Tambah Produk'}
                </h2>
                <p className="mt-1 text-sm text-[#8a8f7d]">
                  Harga diisi dalam rupiah. Stok diubah langsung melalui data produk.
                </p>
              </div>
              <button
                type="button"
                onClick={closeEditor}
                className="rounded-lg px-3 py-1 text-2xl leading-none text-[#8a8f7d] hover:bg-[#faf6ee] hover:text-[#26332a]"
                aria-label="Tutup form"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-5 px-5 py-5">
              {formErrors.form && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {formErrors.form}
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Field label="Nama produk" htmlFor="product-name" error={formErrors.name}>
                    <input
                      id="product-name"
                      value={form.name}
                      onChange={(event) => updateField('name', event.target.value)}
                      className={inputClass}
                      maxLength={160}
                      required
                    />
                  </Field>
                </div>
                <Field label="SKU" htmlFor="product-sku" error={formErrors.sku} hint="Kosongkan untuk dibuat otomatis saat menambah produk.">
                  <input
                    id="product-sku"
                    value={form.sku}
                    onChange={(event) => updateField('sku', event.target.value)}
                    className={inputClass}
                    maxLength={64}
                  />
                </Field>
                <Field label="Barcode" htmlFor="product-barcode" error={formErrors.barcode}>
                  <input
                    id="product-barcode"
                    value={form.barcode}
                    onChange={(event) => updateField('barcode', event.target.value)}
                    className={inputClass}
                    maxLength={13}
                  />
                </Field>
                <Field label="Kategori" htmlFor="product-category">
                  <select
                    id="product-category"
                    value={form.categoryId}
                    onChange={(event) => updateField('categoryId', event.target.value)}
                    className={inputClass}
                  >
                    <option value="">Tanpa kategori</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Satuan" htmlFor="product-unit" error={formErrors.unit}>
                  <select
                    id="product-unit"
                    value={form.unit}
                    onChange={(event) => updateField('unit', event.target.value)}
                    className={inputClass}
                  >
                    {PRODUCT_UNITS.map((unit) => (
                      <option key={unit} value={unit}>
                        {unit}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Harga beli (Rp)" htmlFor="product-price-buy" error={formErrors.priceBuy}>
                  <input
                    id="product-price-buy"
                    value={form.priceBuy}
                    onChange={(event) => updateField('priceBuy', event.target.value)}
                    className={inputClass}
                    inputMode="decimal"
                    placeholder="Contoh: 12.500"
                    required
                  />
                </Field>
                <Field label="Harga jual (Rp)" htmlFor="product-price-sell" error={formErrors.priceSell}>
                  <input
                    id="product-price-sell"
                    value={form.priceSell}
                    onChange={(event) => updateField('priceSell', event.target.value)}
                    className={inputClass}
                    inputMode="decimal"
                    placeholder="Contoh: 15.000"
                    required
                  />
                </Field>
                <Field
                  label="Harga grosir (Rp)"
                  htmlFor="product-price-wholesale"
                  error={formErrors.priceWholesale}
                  hint="Opsional. Kosongkan jika tidak ada harga grosir."
                >
                  <input
                    id="product-price-wholesale"
                    value={form.priceWholesale}
                    onChange={(event) => updateField('priceWholesale', event.target.value)}
                    className={inputClass}
                    inputMode="decimal"
                  />
                </Field>
                <Field
                  label="Minimal qty grosir"
                  htmlFor="product-wholesale-min"
                  error={formErrors.wholesaleMinQty}
                >
                  <input
                    id="product-wholesale-min"
                    value={form.wholesaleMinQty}
                    onChange={(event) => updateField('wholesaleMinQty', event.target.value)}
                    className={inputClass}
                    inputMode="numeric"
                    placeholder="Contoh: 10"
                  />
                </Field>
                <Field label="Stok" htmlFor="product-stock" error={formErrors.stock}>
                  <input
                    id="product-stock"
                    value={form.stock}
                    onChange={(event) => updateField('stock', event.target.value)}
                    className={inputClass}
                    inputMode="numeric"
                    required
                  />
                </Field>
                <Field label="Stok minimum" htmlFor="product-min-stock" error={formErrors.minStock}>
                  <input
                    id="product-min-stock"
                    value={form.minStock}
                    onChange={(event) => updateField('minStock', event.target.value)}
                    className={inputClass}
                    inputMode="numeric"
                    required
                  />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="URL gambar" htmlFor="product-image" hint="Tempel URL gambar produk. Upload file belum tersedia di API.">
                    <input
                      id="product-image"
                      value={form.imageUrl}
                      onChange={(event) => updateField('imageUrl', event.target.value)}
                      className={inputClass}
                      placeholder="https://..."
                    />
                  </Field>
                </div>
                <div className="sm:col-span-2">
                  <Field label="Deskripsi" htmlFor="product-description">
                    <textarea
                      id="product-description"
                      value={form.description}
                      onChange={(event) => updateField('description', event.target.value)}
                      className={inputClass}
                      rows={3}
                    />
                  </Field>
                </div>
              </div>

              <div className="grid gap-3 rounded-xl border border-[#e6ddc8] bg-[#faf6ee] p-4 sm:grid-cols-3">
                <label className="flex items-center gap-2 text-sm text-[#26332a]">
                  <input
                    type="checkbox"
                    checked={form.isActive}
                    onChange={(event) => updateField('isActive', event.target.checked)}
                    className="h-4 w-4 rounded border-[#c9bfa8] accent-[#5c7a5f]"
                  />
                  Aktif
                </label>
                <label className="flex items-center gap-2 text-sm text-[#26332a]">
                  <input
                    type="checkbox"
                    checked={form.isPublic}
                    onChange={(event) => updateField('isPublic', event.target.checked)}
                    className="h-4 w-4 rounded border-[#c9bfa8] accent-[#5c7a5f]"
                  />
                  Tampil di katalog publik
                </label>
                <label className="flex items-center gap-2 text-sm text-[#26332a]">
                  <input
                    type="checkbox"
                    checked={form.isFeatured}
                    onChange={(event) => updateField('isFeatured', event.target.checked)}
                    className="h-4 w-4 rounded border-[#c9bfa8] accent-[#5c7a5f]"
                  />
                  Produk unggulan
                </label>
              </div>

              <div className="flex flex-col-reverse gap-2 border-t border-[#e6ddc8] pt-4 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={closeEditor}
                  disabled={saving}
                  className="rounded-xl border border-[#e6ddc8] px-5 py-2.5 text-sm font-medium text-[#5c6b58] transition hover:bg-[#faf6ee] disabled:opacity-50"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-[#5c7a5f] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#4c6b4f] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? 'Menyimpan...' : editing ? 'Simpan Perubahan' : 'Tambah Produk'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminProductsPage() {
  return (
    <AdminGate title="Kelola Produk" description="Tambah, ubah, dan hapus produk warung.">
      {({ session, expireSession }) => (
        <ProductsContent session={session} expireSession={expireSession} />
      )}
    </AdminGate>
  );
}
