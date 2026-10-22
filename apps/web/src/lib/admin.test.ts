import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ADMIN_SESSION_KEY,
  AdminApiError,
  adminPageRequest,
  type AdminProduct,
  type AdminSession,
  categoryFormToPayload,
  createEmptyCategoryForm,
  createEmptyProductForm,
  isAdminAuthError,
  loadAdminSession,
  loginAdmin,
  productFormToPayload,
  productToForm,
  RECEIVABLE_ROLES,
  validateCategoryForm,
  validateProductForm,
} from './admin';

describe('validateProductForm', () => {
  it('requires name and both selling prices', () => {
    const errors = validateProductForm(createEmptyProductForm());
    expect(errors.name).toBeTruthy();
    expect(errors.priceBuy).toBeTruthy();
    expect(errors.priceSell).toBeTruthy();
  });

  it('rejects invalid money and negative stock values', () => {
    const errors = validateProductForm({
      ...createEmptyProductForm(),
      name: 'Kopi',
      priceBuy: 'abc',
      priceSell: '-1',
      stock: '-2',
      minStock: '1,5',
    });
    expect(errors.priceBuy).toBeTruthy();
    expect(errors.priceSell).toBeTruthy();
    expect(errors.stock).toBeTruthy();
    expect(errors.minStock).toBeTruthy();
  });

  it('accepts a valid product form', () => {
    const errors = validateProductForm({
      ...createEmptyProductForm(),
      name: 'Kopi Bubuk',
      priceBuy: '10.000',
      priceSell: '12.500',
      stock: '8',
      minStock: '2',
    });
    expect(errors).toEqual({});
  });
});

describe('productFormToPayload', () => {
  it('converts rupiah input to sen and keeps booleans', () => {
    const payload = productFormToPayload({
      ...createEmptyProductForm(),
      name: '  Kopi Bubuk  ',
      sku: 'KOPI-01',
      priceBuy: '10.000',
      priceSell: '12.500',
      stock: '8',
      minStock: '2',
      unit: 'PACK',
      isFeatured: true,
    });

    expect(payload.name).toBe('Kopi Bubuk');
    expect(payload.sku).toBe('KOPI-01');
    expect(payload.priceBuy).toBe(1_000_000);
    expect(payload.priceSell).toBe(1_250_000);
    expect(payload.stock).toBe(8);
    expect(payload.minStock).toBe(2);
    expect(payload.unit).toBe('PACK');
    expect(payload.isFeatured).toBe(true);
  });

  it('omits blank optional fields that cannot be sent as null', () => {
    const payload = productFormToPayload({
      ...createEmptyProductForm(),
      name: 'Gula',
      priceBuy: '14000',
      priceSell: '16000',
      priceWholesale: '',
      wholesaleMinQty: '',
    });

    expect(payload.sku).toBeUndefined();
    expect(payload.priceWholesale).toBeUndefined();
    expect(payload.wholesaleMinQty).toBeNull();
  });

  it('converts optional wholesale values when present', () => {
    const payload = productFormToPayload({
      ...createEmptyProductForm(),
      name: 'Beras',
      priceBuy: '60.000',
      priceSell: '65.000',
      priceWholesale: '62.000',
      wholesaleMinQty: '5',
    });

    expect(payload.priceWholesale).toBe(6_200_000);
    expect(payload.wholesaleMinQty).toBe(5);
  });
});

describe('productToForm', () => {
  it('formats sen values back to editable rupiah input', () => {
    const product: AdminProduct = {
      id: 'p1',
      sku: 'KOPI-01',
      barcode: '899123',
      name: 'Kopi',
      slug: 'kopi',
      description: 'Kopi bubuk',
      categoryId: 'c1',
      priceBuy: 1_000_000,
      priceSell: 1_250_000,
      priceWholesale: 1_100_000,
      stockQty: 8,
      minStock: 2,
      unit: 'PACK',
      imageUrl: null,
      wholesaleMinQty: 5,
      isActive: true,
      isFeatured: false,
      isPublic: true,
      version: 1,
      category: null,
    };

    const form = productToForm(product);
    expect(form.name).toBe('Kopi');
    expect(productFormToPayload(form).priceBuy).toBe(1_000_000);
    expect(productFormToPayload(form).priceSell).toBe(1_250_000);
    expect(form.stock).toBe('8');
    expect(form.wholesaleMinQty).toBe('5');
    expect(form.categoryId).toBe('c1');
  });
});

describe('category helpers', () => {
  it('builds a trimmed category payload with an integer sort order', () => {
    const payload = categoryFormToPayload({
      ...createEmptyCategoryForm(),
      name: '  Minuman  ',
      description: '  Dingin dan segar  ',
      color: 'BLUE',
      sortOrder: '3',
      isActive: false,
    });

    expect(payload).toEqual({
      name: 'Minuman',
      description: 'Dingin dan segar',
      color: 'BLUE',
      sortOrder: 3,
      isActive: false,
    });
  });

  it('validates category name and sort order', () => {
    const errors = validateCategoryForm({
      ...createEmptyCategoryForm(),
      name: '',
      sortOrder: '1.5',
    });
    expect(errors.name).toBeTruthy();
    expect(errors.sortOrder).toBeTruthy();
  });
});

describe('isAdminAuthError', () => {
  it('detects 401 and 403 API errors only', () => {
    expect(isAdminAuthError(new AdminApiError('expired', 401))).toBe(true);
    expect(isAdminAuthError(new AdminApiError('forbidden', 403))).toBe(true);
    expect(isAdminAuthError(new AdminApiError('bad request', 400))).toBe(false);
    expect(isAdminAuthError(new Error('expired'))).toBe(false);
  });
});

describe('admin session roles', () => {
  function tokenFor(role: 'ADMIN' | 'CASHIER'): string {
    const payload = btoa(
      JSON.stringify({
        role,
        username: role.toLowerCase(),
        exp: Math.floor(Date.now() / 1000) + 300,
      }),
    );
    return `header.${payload}.signature`;
  }

  function saveSession(role: 'ADMIN' | 'CASHIER'): void {
    window.localStorage.setItem(
      ADMIN_SESSION_KEY,
      JSON.stringify({
        accessToken: tokenFor(role),
        refreshToken: 'refresh-token',
        role,
        username: role.toLowerCase(),
      }),
    );
  }

  function loginResponse(role: 'ADMIN' | 'CASHIER') {
    return {
      status: 200,
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          data: {
            accessToken: tokenFor(role),
            refreshToken: 'refresh-token',
          },
          error: null,
        }),
    };
  }

  afterEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('only loads CASHIER sessions when the page allows cashier', () => {
    saveSession('ADMIN');
    expect(loadAdminSession()).toMatchObject({ role: 'ADMIN' });

    window.localStorage.clear();
    saveSession('CASHIER');
    expect(loadAdminSession()).toBeNull();
    expect(loadAdminSession(RECEIVABLE_ROLES)).toMatchObject({ role: 'CASHIER' });
  });

  it('rejects cashier login on admin-only pages without saving a session', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(loginResponse('CASHIER')));

    await expect(loginAdmin('kasir', 'rahasia')).rejects.toMatchObject({
      status: 403,
    });
    expect(window.localStorage.getItem(ADMIN_SESSION_KEY)).toBeNull();
  });

  it('accepts cashier login on pages that allow cashier', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(loginResponse('CASHIER')));

    const session = await loginAdmin('kasir', 'rahasia', RECEIVABLE_ROLES);

    expect(session.role).toBe('CASHIER');
    expect(loadAdminSession(RECEIVABLE_ROLES)).toMatchObject({ role: 'CASHIER' });
  });
});

describe('adminPageRequest', () => {
  const session: AdminSession = {
    accessToken: 'token',
    refreshToken: 'refresh',
    role: 'ADMIN',
    username: 'admin',
  };
  const meta = {
    page: 1,
    pageSize: 20,
    total: 1,
    totalPages: 1,
    hasNext: false,
    hasPrev: false,
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns data and pagination metadata', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            success: true,
            data: [{ customerId: 'customer-1' }],
            meta,
            error: null,
          }),
        ),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await adminPageRequest<Array<{ customerId: string }>>(
      session,
      '/debts/customers?page=1',
    );

    expect(result).toEqual({ data: [{ customerId: 'customer-1' }], meta });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://localhost:3000/api/v1/debts/customers?page=1',
    );
  });

  it('rejects a successful response without pagination metadata', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ success: true, data: [], error: null })),
      }),
    );

    await expect(adminPageRequest(session, '/debts/customers')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
});
