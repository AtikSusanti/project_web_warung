'use client';

import { type ReactNode, useCallback, useEffect, useState } from 'react';

import AdminGate from '@/components/admin/AdminGate';
import {
  type AdminCategory,
  type AdminSession,
  adminRequest,
  CATEGORY_COLOR_OPTIONS,
  type CategoryFormState,
  categoryFormToPayload,
  categoryToForm,
  createEmptyCategoryForm,
  isAdminAuthError,
  validateCategoryForm,
} from '@/lib/admin';

type CategoriesContentProps = {
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

function colorOption(value: string) {
  return CATEGORY_COLOR_OPTIONS.find((option) => option.value === value) ?? CATEGORY_COLOR_OPTIONS[0];
}

function CategoriesContent({ session, expireSession }: CategoriesContentProps) {
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<AdminCategory | null>(null);
  const [form, setForm] = useState<CategoryFormState>(createEmptyCategoryForm);
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
      const nextCategories = await adminRequest<AdminCategory[]>(session, '/categories');
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

  const openCreate = () => {
    setEditing(null);
    setForm(createEmptyCategoryForm());
    setFormErrors({});
    setEditorOpen(true);
  };

  const openEdit = (category: AdminCategory) => {
    setEditing(category);
    setForm(categoryToForm(category));
    setFormErrors({});
    setEditorOpen(true);
  };

  const closeEditor = () => {
    if (saving) return;
    setEditorOpen(false);
    setEditing(null);
    setFormErrors({});
  };

  const updateField = <K extends keyof CategoryFormState>(key: K, value: CategoryFormState[K]) => {
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
    const errors = validateCategoryForm(form);
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const payload = categoryFormToPayload(form);
      await adminRequest<AdminCategory>(
        session,
        editing ? `/categories/${editing.id}` : '/categories',
        {
          method: editing ? 'PATCH' : 'POST',
          body: JSON.stringify(payload),
        },
      );
      setEditorOpen(false);
      setEditing(null);
      setNotice(editing ? 'Kategori berhasil diperbarui.' : 'Kategori berhasil ditambahkan.');
      await load();
    } catch (err) {
      if (isAdminAuthError(err)) {
        expireSession();
      } else {
        setFormErrors({ form: err instanceof Error ? err.message : 'Gagal menyimpan kategori' });
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (category: AdminCategory) => {
    if (!window.confirm(`Hapus kategori "${category.name}"? Produk terkait tidak ikut dihapus.`)) {
      return;
    }
    setDeletingId(category.id);
    setNotice(null);
    setError(null);
    try {
      await adminRequest<null>(session, `/categories/${category.id}`, { method: 'DELETE' });
      setNotice('Kategori berhasil dihapus.');
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
        <p className="text-sm text-[#8a8f7d]">{categories.length} kategori terdaftar.</p>
        <button
          onClick={openCreate}
          className="rounded-xl bg-[#5c7a5f] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#4c6b4f]"
        >
          + Tambah Kategori
        </button>
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
          <div className="p-8 text-center text-sm text-[#8a8f7d]">Memuat kategori...</div>
        ) : categories.length === 0 ? (
          <div className="p-8 text-center text-sm text-[#8a8f7d]">
            Belum ada kategori. Tambahkan kategori pertama.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b border-[#e6ddc8] text-xs uppercase tracking-wide text-[#8a8f7d]">
                  <th className="px-4 py-3 font-medium">Kategori</th>
                  <th className="px-4 py-3 font-medium">Warna</th>
                  <th className="px-4 py-3 font-medium">Urutan</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#eee6d5]">
                {categories.map((category) => {
                  const color = colorOption(category.color);
                  return (
                    <tr key={category.id} className="align-top">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-[#26332a]">{category.name}</p>
                        <p className="mt-0.5 max-w-xl text-xs text-[#8a8f7d]">
                          {category.description || `Slug: ${category.slug}`}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${color.badge}`}>
                          {color.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[#26332a]">{category.sortOrder}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            category.isActive ? 'bg-green-100 text-green-700' : 'bg-stone-100 text-stone-600'
                          }`}
                        >
                          {category.isActive ? 'Aktif' : 'Nonaktif'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => openEdit(category)}
                            className="rounded-lg border border-[#e6ddc8] px-3 py-1.5 text-xs font-medium text-[#5c7a5f] transition hover:bg-[#faf6ee]"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => void handleDelete(category)}
                            disabled={deletingId === category.id}
                            className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50"
                          >
                            {deletingId === category.id ? 'Menghapus...' : 'Hapus'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
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
          aria-labelledby="category-editor-title"
        >
          <div className="my-4 w-full max-w-xl rounded-2xl border border-[#e6ddc8] bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-[#e6ddc8] px-5 py-4">
              <div>
                <h2 id="category-editor-title" className="text-xl font-bold text-[#26332a]">
                  {editing ? 'Edit Kategori' : 'Tambah Kategori'}
                </h2>
                <p className="mt-1 text-sm text-[#8a8f7d]">
                  Kategori dipakai untuk mengelompokkan produk di katalog dan POS.
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
              <Field label="Nama kategori" htmlFor="category-name" error={formErrors.name}>
                <input
                  id="category-name"
                  value={form.name}
                  onChange={(event) => updateField('name', event.target.value)}
                  className={inputClass}
                  maxLength={120}
                  required
                />
              </Field>

              <Field label="Deskripsi" htmlFor="category-description" error={formErrors.description}>
                <textarea
                  id="category-description"
                  value={form.description}
                  onChange={(event) => updateField('description', event.target.value)}
                  className={inputClass}
                  maxLength={500}
                  rows={3}
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Warna" htmlFor="category-color" error={formErrors.color}>
                  <select
                    id="category-color"
                    value={form.color}
                    onChange={(event) => updateField('color', event.target.value)}
                    className={inputClass}
                  >
                    {CATEGORY_COLOR_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Urutan tampil" htmlFor="category-sort-order" error={formErrors.sortOrder}>
                  <input
                    id="category-sort-order"
                    value={form.sortOrder}
                    onChange={(event) => updateField('sortOrder', event.target.value)}
                    className={inputClass}
                    inputMode="numeric"
                    required
                  />
                </Field>
              </div>

              <label className="flex items-center gap-2 rounded-xl border border-[#e6ddc8] bg-[#faf6ee] p-4 text-sm text-[#26332a]">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(event) => updateField('isActive', event.target.checked)}
                  className="h-4 w-4 rounded border-[#c9bfa8] accent-[#5c7a5f]"
                />
                Kategori aktif
              </label>

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
                  {saving ? 'Menyimpan...' : editing ? 'Simpan Perubahan' : 'Tambah Kategori'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminCategoriesPage() {
  return (
    <AdminGate title="Kelola Kategori" description="Atur pengelompokan produk untuk katalog dan POS.">
      {({ session, expireSession }) => (
        <CategoriesContent session={session} expireSession={expireSession} />
      )}
    </AdminGate>
  );
}
