import { type PaginationMeta, parseIDR } from '@warung/shared';

import { API_BASE, type ApiEnvelope, decodeJwt } from './pos';

export const ADMIN_SESSION_KEY = 'warung_admin_session';

export const PRODUCT_UNITS = [
  'PCS',
  'PACK',
  'KG',
  'GRAM',
  'LITER',
  'ML',
  'BOX',
  'DOSE',
  'RID',
] as const;

export const CATEGORY_COLOR_OPTIONS = [
  { value: 'DEFAULT', label: 'Netral', badge: 'bg-stone-100 text-stone-700' },
  { value: 'RED', label: 'Merah', badge: 'bg-red-100 text-red-700' },
  { value: 'ORANGE', label: 'Oranye', badge: 'bg-orange-100 text-orange-700' },
  { value: 'AMBER', label: 'Kuning', badge: 'bg-amber-100 text-amber-800' },
  { value: 'GREEN', label: 'Hijau', badge: 'bg-green-100 text-green-700' },
  { value: 'TEAL', label: 'Teal', badge: 'bg-teal-100 text-teal-700' },
  { value: 'BLUE', label: 'Biru', badge: 'bg-blue-100 text-blue-700' },
  { value: 'INDIGO', label: 'Indigo', badge: 'bg-indigo-100 text-indigo-700' },
  { value: 'PURPLE', label: 'Ungu', badge: 'bg-purple-100 text-purple-700' },
  { value: 'PINK', label: 'Pink', badge: 'bg-pink-100 text-pink-700' },
] as const;

export type AdminRole = 'ADMIN' | 'CASHIER';

export const DEFAULT_ADMIN_ROLES: readonly AdminRole[] = ['ADMIN'];
export const RECEIVABLE_ROLES: readonly AdminRole[] = ['ADMIN', 'CASHIER'];

export type AdminSession = {
  accessToken: string;
  refreshToken: string;
  role: AdminRole;
  username: string;
};

export function isAdminRole(role: string | undefined | null): role is AdminRole {
  return role === 'ADMIN' || role === 'CASHIER';
}

export type AdminCategory = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  color: string;
  sortOrder: number;
  isActive: boolean;
};

export type AdminProduct = {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  slug: string;
  description: string | null;
  categoryId: string | null;
  priceBuy: number;
  priceSell: number;
  priceWholesale: number | null;
  stockQty: number;
  minStock: number;
  unit: string;
  imageUrl: string | null;
  wholesaleMinQty: number | null;
  isActive: boolean;
  isFeatured: boolean;
  isPublic: boolean;
  version: number;
  category: AdminCategory | null;
};

export type ProductFormState = {
  name: string;
  sku: string;
  barcode: string;
  categoryId: string;
  description: string;
  priceBuy: string;
  priceSell: string;
  priceWholesale: string;
  stock: string;
  minStock: string;
  unit: string;
  imageUrl: string;
  wholesaleMinQty: string;
  isActive: boolean;
  isPublic: boolean;
  isFeatured: boolean;
};

export type ProductPayload = {
  name: string;
  sku?: string;
  barcode: string | null;
  description: string | null;
  categoryId: string | null;
  priceBuy: number;
  priceSell: number;
  priceWholesale?: number;
  stock: number;
  minStock: number;
  unit: string;
  imageUrl: string | null;
  wholesaleMinQty: number | null;
  isActive: boolean;
  isPublic: boolean;
  isFeatured: boolean;
};

export type CategoryFormState = {
  name: string;
  description: string;
  color: string;
  sortOrder: string;
  isActive: boolean;
};

export type CategoryPayload = {
  name: string;
  description: string | null;
  color: string;
  sortOrder: number;
  isActive: boolean;
};

export class AdminApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'AdminApiError';
  }
}

export function isAdminAuthError(error: unknown): boolean {
  return error instanceof AdminApiError && (error.status === 401 || error.status === 403);
}

export function loadAdminSession(
  allowedRoles: readonly AdminRole[] = DEFAULT_ADMIN_ROLES,
): AdminSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(ADMIN_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AdminSession>;
    if (!parsed.accessToken || !parsed.refreshToken) return null;
    const payload = decodeJwt(parsed.accessToken);
    if (!payload || !isAdminRole(payload.role) || !allowedRoles.includes(payload.role)) {
      return null;
    }
    if (typeof payload.exp === 'number' && payload.exp * 1000 <= Date.now()) return null;
    return {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      role: payload.role,
      username: payload.username ?? parsed.username ?? '',
    };
  } catch {
    return null;
  }
}

export function saveAdminSession(session: AdminSession): void {
  window.localStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(session));
}

export function clearAdminSession(): void {
  window.localStorage.removeItem(ADMIN_SESSION_KEY);
}

export async function loginAdmin(
  username: string,
  password: string,
  allowedRoles: readonly AdminRole[] = DEFAULT_ADMIN_ROLES,
): Promise<AdminSession> {
  const response = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: username.trim(), password }),
  });
  const json = (await response.json()) as ApiEnvelope<{
    accessToken: string;
    refreshToken: string;
  }>;
  if (!response.ok || !json.success || !json.data) {
    throw new AdminApiError(
      json.error?.message ?? 'Login gagal',
      response.status,
      json.error?.code,
    );
  }

  const payload = decodeJwt(json.data.accessToken);
  if (!payload || !isAdminRole(payload.role) || !allowedRoles.includes(payload.role)) {
    throw new AdminApiError('Akun ini tidak memiliki akses', 403, 'FORBIDDEN');
  }

  const session: AdminSession = {
    accessToken: json.data.accessToken,
    refreshToken: json.data.refreshToken,
    role: payload.role,
    username: payload.username ?? username.trim(),
  };
  saveAdminSession(session);
  return session;
}

type AdminResponse<T> = ApiEnvelope<T> & { meta?: PaginationMeta };

async function requestAdminEnvelope<T>(
  session: AdminSession,
  path: string,
  init: RequestInit = {},
): Promise<AdminResponse<T>> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  headers.set('Authorization', `Bearer ${session.accessToken}`);

  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  const text = await response.text();
  let json: AdminResponse<T> | null = null;
  if (text) {
    try {
      json = JSON.parse(text) as AdminResponse<T>;
    } catch {
      json = null;
    }
  }

  if (response.status === 401 || response.status === 403) {
    throw new AdminApiError(
      json?.error?.message ?? 'Sesi berakhir atau akses ditolak',
      response.status,
      json?.error?.code ?? 'FORBIDDEN',
    );
  }

  if (!response.ok || !json?.success) {
    throw new AdminApiError(
      json?.error?.message ?? `Permintaan gagal (HTTP ${response.status})`,
      response.status,
      json?.error?.code,
    );
  }

  return json;
}

export async function adminRequest<T>(
  session: AdminSession,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const json = await requestAdminEnvelope<T>(session, path, init);
  return json.data as T;
}

export async function adminPageRequest<T>(
  session: AdminSession,
  path: string,
  init: RequestInit = {},
): Promise<{ data: T; meta: PaginationMeta }> {
  const json = await requestAdminEnvelope<T>(session, path, init);
  if (!json.meta) {
    throw new AdminApiError(
      'Respons daftar tidak menyertakan metadata pagination',
      500,
      'INVALID_RESPONSE',
    );
  }
  return { data: json.data as T, meta: json.meta };
}

export function createEmptyProductForm(): ProductFormState {
  return {
    name: '',
    sku: '',
    barcode: '',
    categoryId: '',
    description: '',
    priceBuy: '',
    priceSell: '',
    priceWholesale: '',
    stock: '0',
    minStock: '0',
    unit: 'PCS',
    imageUrl: '',
    wholesaleMinQty: '',
    isActive: true,
    isPublic: true,
    isFeatured: false,
  };
}

export function formatMoneyInput(valueSen: number | null | undefined): string {
  if (valueSen === null || valueSen === undefined || !Number.isFinite(valueSen)) return '';
  return (valueSen / 100).toLocaleString('id-ID', { maximumFractionDigits: 2 });
}

export function productToForm(product: AdminProduct): ProductFormState {
  return {
    name: product.name,
    sku: product.sku,
    barcode: product.barcode ?? '',
    categoryId: product.categoryId ?? '',
    description: product.description ?? '',
    priceBuy: formatMoneyInput(product.priceBuy),
    priceSell: formatMoneyInput(product.priceSell),
    priceWholesale: formatMoneyInput(product.priceWholesale),
    stock: String(product.stockQty),
    minStock: String(product.minStock),
    unit: product.unit,
    imageUrl: product.imageUrl ?? '',
    wholesaleMinQty: product.wholesaleMinQty === null ? '' : String(product.wholesaleMinQty),
    isActive: product.isActive,
    isPublic: product.isPublic,
    isFeatured: product.isFeatured,
  };
}

function parseNonNegativeInteger(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parseMoney(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  try {
    const parsed = parseIDR(trimmed);
    return parsed >= 0 ? parsed : null;
  } catch {
    return null;
  }
}

export function validateProductForm(form: ProductFormState): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!form.name.trim()) errors.name = 'Nama produk wajib diisi';
  if (form.name.trim().length > 160) errors.name = 'Nama produk maksimal 160 karakter';
  if (form.sku.trim().length > 64) errors.sku = 'SKU maksimal 64 karakter';
  if (form.barcode.trim().length > 13) errors.barcode = 'Barcode maksimal 13 karakter';
  if (form.priceBuy.trim() === '') errors.priceBuy = 'Harga beli wajib diisi';
  else if (parseMoney(form.priceBuy) === null) errors.priceBuy = 'Harga beli tidak valid';
  if (form.priceSell.trim() === '') errors.priceSell = 'Harga jual wajib diisi';
  else if (parseMoney(form.priceSell) === null) errors.priceSell = 'Harga jual tidak valid';
  if (form.priceWholesale.trim() !== '' && parseMoney(form.priceWholesale) === null) {
    errors.priceWholesale = 'Harga grosir tidak valid';
  }
  if (parseNonNegativeInteger(form.stock) === null)
    errors.stock = 'Stok harus bilangan bulat 0 atau lebih';
  if (parseNonNegativeInteger(form.minStock) === null) {
    errors.minStock = 'Stok minimum harus bilangan bulat 0 atau lebih';
  }
  if (
    form.wholesaleMinQty.trim() !== '' &&
    parseNonNegativeInteger(form.wholesaleMinQty) === null
  ) {
    errors.wholesaleMinQty = 'Minimal qty grosir harus bilangan bulat 0 atau lebih';
  }
  if (!PRODUCT_UNITS.includes(form.unit as (typeof PRODUCT_UNITS)[number])) {
    errors.unit = 'Satuan tidak valid';
  }
  return errors;
}

export function productFormToPayload(form: ProductFormState): ProductPayload {
  const payload: ProductPayload = {
    name: form.name.trim(),
    barcode: form.barcode.trim() || null,
    description: form.description.trim() || null,
    categoryId: form.categoryId.trim() || null,
    priceBuy: parseIDR(form.priceBuy),
    priceSell: parseIDR(form.priceSell),
    stock: parseNonNegativeInteger(form.stock) ?? 0,
    minStock: parseNonNegativeInteger(form.minStock) ?? 0,
    unit: form.unit,
    imageUrl: form.imageUrl.trim() || null,
    wholesaleMinQty: form.wholesaleMinQty.trim()
      ? parseNonNegativeInteger(form.wholesaleMinQty)
      : null,
    isActive: form.isActive,
    isPublic: form.isPublic,
    isFeatured: form.isFeatured,
  };

  if (form.sku.trim()) payload.sku = form.sku.trim();
  if (form.priceWholesale.trim()) payload.priceWholesale = parseIDR(form.priceWholesale);

  return payload;
}

export function createEmptyCategoryForm(): CategoryFormState {
  return {
    name: '',
    description: '',
    color: 'DEFAULT',
    sortOrder: '0',
    isActive: true,
  };
}

export function categoryToForm(category: AdminCategory): CategoryFormState {
  return {
    name: category.name,
    description: category.description ?? '',
    color: category.color,
    sortOrder: String(category.sortOrder),
    isActive: category.isActive,
  };
}

export function validateCategoryForm(form: CategoryFormState): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!form.name.trim()) errors.name = 'Nama kategori wajib diisi';
  if (form.name.trim().length > 120) errors.name = 'Nama kategori maksimal 120 karakter';
  if (form.description.trim().length > 500) {
    errors.description = 'Deskripsi maksimal 500 karakter';
  }
  if (!CATEGORY_COLOR_OPTIONS.some((option) => option.value === form.color)) {
    errors.color = 'Warna tidak valid';
  }
  if (parseNonNegativeInteger(form.sortOrder) === null) {
    errors.sortOrder = 'Urutan harus bilangan bulat 0 atau lebih';
  }
  return errors;
}

export function categoryFormToPayload(form: CategoryFormState): CategoryPayload {
  return {
    name: form.name.trim(),
    description: form.description.trim() || null,
    color: form.color,
    sortOrder: parseNonNegativeInteger(form.sortOrder) ?? 0,
    isActive: form.isActive,
  };
}
