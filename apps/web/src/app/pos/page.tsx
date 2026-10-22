'use client';

import type { CalculatedCart, CustomerDebtList } from '@warung/shared';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import Header from '@/components/Header';
import {
  API_BASE,
  type ApiEnvelope,
  calculatePosCart,
  clearPosSession,
  createIdempotencyKey,
  decodeJwt,
  formatDate,
  formatDateTime,
  formatRupiah,
  getDetailNumber,
  isPosRole,
  loadPosSession,
  normalizeSettings,
  parseCashInput,
  planPosPayments,
  type PosCartLine,
  type PosCustomer,
  type PosProduct,
  type PosSession,
  type PosSettings,
  type PosTransaction,
  savePosSession,
} from '@/lib/pos';

const SESSION_EXPIRED = 'SESSION_EXPIRED';

type LoginData = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresAt: string;
};

type Mismatch = {
  expectedTotal: number;
  latestTotal: number;
  key: string;
};

type RefreshedCart = {
  cart: PosCartLine[];
  calculation: CalculatedCart;
};

function readJson<T>(response: Response): Promise<ApiEnvelope<T> | null> {
  return response.json().catch(() => null) as Promise<ApiEnvelope<T> | null>;
}

function toCartLine(product: PosProduct): PosCartLine {
  return {
    productId: product.id,
    sku: product.sku,
    name: product.name,
    unitPrice: product.priceSell,
    qty: 1,
    stockQty: product.stockQty,
    unit: product.unit,
    category: product.category?.name ?? 'Tanpa Kategori',
  };
}

function toReceipt(raw: PosTransaction): PosTransaction {
  return {
    id: String(raw.id),
    invoiceNo: String(raw.invoiceNo),
    roundedTotal: Number(raw.roundedTotal),
    paidTotal: Number(raw.paidTotal),
    changeAmount: Number(raw.changeAmount),
    outstandingAmount: Number(raw.outstandingAmount),
    customerId: raw.customerId ? String(raw.customerId) : null,
    customerName: raw.customerName ? String(raw.customerName) : null,
    dueDate: raw.dueDate ? String(raw.dueDate) : null,
    payments: (Array.isArray(raw.payments) ? raw.payments : []).map((payment) => ({
      method: payment.method,
      amount: Number(payment.amount),
      reference: payment.reference ? String(payment.reference) : null,
    })),
    createdAt: String(raw.createdAt),
    cashierName: String(raw.cashierName),
    lines: (Array.isArray(raw.lines) ? raw.lines : []).map((line) => ({
      id: String(line.id),
      productName: String(line.productName),
      qty: Number(line.qty),
      unit: String(line.unit),
      totalAmount: Number(line.totalAmount),
    })),
  };
}

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  CASH: 'Tunai',
  TRANSFER: 'Transfer',
  QRIS: 'QRIS',
  DEBT: 'Utang',
};

function ReceiptDialog({
  receipt,
  canViewReceivables,
  onClose,
}: {
  receipt: PosTransaction;
  canViewReceivables: boolean;
  onClose: () => void;
}) {
  const hasDebt = receipt.outstandingAmount > 0;

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="receipt-title"
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
      >
        <div className="text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#eef4ea]">
            <svg
              className="h-7 w-7 text-[#5c7a5f]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </div>
          <h2 id="receipt-title" className="mt-3 text-2xl font-bold tracking-tight text-[#26332a]">
            Pembayaran Berhasil
          </h2>
          <p className="mt-1 text-sm text-[#8a8f7d]">
            {hasDebt
              ? 'Transaksi tersimpan dan sisa tagihan dicatat sebagai piutang pelanggan.'
              : 'Transaksi tersimpan dan stok sudah diperbarui.'}
          </p>
        </div>

        <div className="mt-5 rounded-xl bg-[#faf6ee] p-4 text-sm">
          <div className="flex justify-between gap-4">
            <span className="text-[#8a8f7d]">No. Invoice</span>
            <span className="font-semibold text-[#26332a]">{receipt.invoiceNo}</span>
          </div>
          <div className="mt-2 flex justify-between gap-4">
            <span className="text-[#8a8f7d]">Kasir</span>
            <span className="text-[#26332a]">{receipt.cashierName}</span>
          </div>
          <div className="mt-2 flex justify-between gap-4">
            <span className="text-[#8a8f7d]">Waktu</span>
            <span className="text-[#26332a]">{formatDateTime(receipt.createdAt)}</span>
          </div>
          {receipt.customerName && (
            <div className="mt-2 flex justify-between gap-4">
              <span className="text-[#8a8f7d]">Pelanggan</span>
              <span className="text-right text-[#26332a]">{receipt.customerName}</span>
            </div>
          )}
          {hasDebt && receipt.dueDate && (
            <div className="mt-2 flex justify-between gap-4">
              <span className="text-[#8a8f7d]">Jatuh tempo</span>
              <span className="text-[#26332a]">{formatDate(receipt.dueDate)}</span>
            </div>
          )}
        </div>

        <div className="mt-4 border-t border-[#e6ddc8] pt-3">
          {receipt.lines.map((line) => (
            <div key={line.id} className="flex justify-between gap-4 py-1.5 text-sm">
              <span className="text-[#26332a]">
                {line.productName} <span className="text-[#8a8f7d]">x{line.qty}</span>
              </span>
              <span className="whitespace-nowrap text-[#26332a]">
                {formatRupiah(line.totalAmount)}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-4 rounded-xl border border-[#e6ddc8] p-3 text-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-[#8a8f7d]">
            Rincian Pembayaran
          </p>
          <div className="mt-2 space-y-1.5">
            {receipt.payments.map((payment, index) => (
              <div key={`${payment.method}-${index}`} className="flex justify-between gap-4">
                <span className="text-[#5c6b58]">
                  {PAYMENT_METHOD_LABEL[payment.method] ?? payment.method}
                  {payment.reference ? ` (${payment.reference})` : ''}
                </span>
                <span className="font-medium text-[#26332a]">{formatRupiah(payment.amount)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4 space-y-2 border-t border-[#e6ddc8] pt-4 text-sm">
          <div className="flex justify-between">
            <span className="text-[#8a8f7d]">Total</span>
            <span className="font-semibold text-[#26332a]">
              {formatRupiah(receipt.roundedTotal)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#8a8f7d]">Dibayar</span>
            <span className="text-[#26332a]">{formatRupiah(receipt.paidTotal)}</span>
          </div>
          {hasDebt && (
            <div className="flex justify-between">
              <span className="font-medium text-amber-800">Sisa utang</span>
              <span className="font-bold text-amber-800">
                {formatRupiah(receipt.outstandingAmount)}
              </span>
            </div>
          )}
          <div className="flex justify-between text-base">
            <span className="font-semibold text-[#26332a]">Kembalian</span>
            <span className="font-bold text-[#3f5d43]">{formatRupiah(receipt.changeAmount)}</span>
          </div>
        </div>

        {hasDebt && receipt.customerId && canViewReceivables && (
          <Link
            href={`/admin/receivables/${receipt.customerId}`}
            className="mt-4 block rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-center text-sm font-semibold text-amber-900 transition hover:bg-amber-100"
          >
            Lihat Detail Piutang Pelanggan
          </Link>
        )}

        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full rounded-xl bg-[#5c7a5f] py-3 font-semibold text-white transition hover:bg-[#4c6b4f]"
        >
          Transaksi Baru
        </button>
      </div>
    </div>
  );
}

function MismatchDialog({
  mismatch,
  cashAmount,
  debtAmount,
  customerName,
  debtError,
  submitting,
  onConfirm,
  onDismiss,
}: {
  mismatch: Mismatch;
  cashAmount: number | null;
  debtAmount: number;
  customerName: string | null;
  debtError: string | null;
  submitting: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  const hasDebt = debtAmount > 0;
  const insufficient =
    debtError !== null || (!hasDebt && (cashAmount === null || cashAmount < mismatch.latestTotal));
  const change = cashAmount === null ? 0 : Math.max(0, cashAmount - mismatch.latestTotal);

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="mismatch-title"
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
      >
        <h2 id="mismatch-title" className="text-xl font-bold tracking-tight text-[#26332a]">
          Total transaksi berubah
        </h2>
        <p className="mt-2 text-sm text-[#8a8f7d]">
          Harga atau total dari server berbeda. Konfirmasi total terbaru sebelum menyimpan
          transaksi.
        </p>

        <div className="mt-5 space-y-3 rounded-xl bg-[#faf6ee] p-4 text-sm">
          <div className="flex justify-between">
            <span className="text-[#8a8f7d]">Total sebelumnya</span>
            <span className="text-[#26332a]">{formatRupiah(mismatch.expectedTotal)}</span>
          </div>
          <div className="flex justify-between">
            <span className="font-medium text-[#26332a]">Total terbaru</span>
            <span className="font-bold text-[#3f5d43]">{formatRupiah(mismatch.latestTotal)}</span>
          </div>
          <div className="flex justify-between border-t border-[#e6ddc8] pt-3">
            <span className="text-[#8a8f7d]">Uang tunai</span>
            <span className="text-[#26332a]">{formatRupiah(cashAmount)}</span>
          </div>
          {hasDebt && (
            <div className="flex justify-between">
              <span className="text-[#8a8f7d]">
                Utang{customerName ? ` (${customerName})` : ''}
              </span>
              <span className="font-semibold text-amber-800">{formatRupiah(debtAmount)}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-[#8a8f7d]">Kembalian</span>
            <span className="font-semibold text-[#3f5d43]">{formatRupiah(change)}</span>
          </div>
        </div>

        {insufficient && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            {debtError ??
              'Uang tunai belum mencukupi total terbaru. Tutup dialog dan tambahkan nominal pembayaran.'}
          </div>
        )}

        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={onDismiss}
            disabled={submitting}
            className="flex-1 rounded-xl border border-[#e6ddc8] px-4 py-3 font-semibold text-[#5c6b58] transition hover:bg-[#faf6ee] disabled:opacity-50"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={submitting || insufficient}
            className="flex-1 rounded-xl bg-[#5c7a5f] px-4 py-3 font-semibold text-white transition hover:bg-[#4c6b4f] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Menyimpan…' : 'Konfirmasi & Bayar'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PosPage() {
  const [hydrated, setHydrated] = useState(false);
  const [session, setSession] = useState<PosSession | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [loginSubmitting, setLoginSubmitting] = useState(false);

  const [products, setProducts] = useState<PosProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [settings, setSettings] = useState<PosSettings | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');

  const [cart, setCart] = useState<PosCartLine[]>([]);
  const [cashInput, setCashInput] = useState('');
  const [note, setNote] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [idempotencyConflict, setIdempotencyConflict] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mismatch, setMismatch] = useState<Mismatch | null>(null);
  const [receipt, setReceipt] = useState<PosTransaction | null>(null);

  const [customers, setCustomers] = useState<PosCustomer[]>([]);
  const [customersLoading, setCustomersLoading] = useState(false);
  const [customersError, setCustomersError] = useState<string | null>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [customerDetail, setCustomerDetail] = useState<CustomerDebtList | null>(null);
  const [customerDetailLoading, setCustomerDetailLoading] = useState(false);
  const [customerDetailError, setCustomerDetailError] = useState<string | null>(null);
  const [customerDetailVersion, setCustomerDetailVersion] = useState(0);
  const [debtEnabled, setDebtEnabled] = useState(false);

  useEffect(() => {
    setSession(loadPosSession());
    setHydrated(true);
  }, []);

  const expireSession = useCallback(
    (message = 'Sesi berakhir atau akses ditolak. Silakan login lagi.') => {
      clearPosSession();
      setSession(null);
      setAuthError(message);
      setProducts([]);
      setProductsError(null);
      setSettings(null);
      setSettingsError(null);
      setCustomers([]);
      setCustomersError(null);
      setSelectedCustomerId('');
      setCustomerDetail(null);
      setCustomerDetailError(null);
      setDebtEnabled(false);
      setMismatch(null);
      setReceipt(null);
      setError(null);
      setNotice(null);
      setPassword('');
    },
    [],
  );

  const fetchProducts = useCallback(async (): Promise<PosProduct[]> => {
    const response = await fetch(`${API_BASE}/products`);
    const json = await readJson<PosProduct[]>(response);
    if (!response.ok || !json?.success) {
      throw new Error(json?.error?.message ?? `Gagal memuat produk (HTTP ${response.status})`);
    }
    const items = Array.isArray(json.data) ? json.data : [];
    return items.map((product) => ({
      ...product,
      priceSell: Number(product.priceSell),
      stockQty: Number(product.stockQty),
    }));
  }, []);

  const fetchCustomers = useCallback(async (token: string): Promise<PosCustomer[]> => {
    const response = await fetch(`${API_BASE}/customers`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.status === 401 || response.status === 403) {
      throw new Error(SESSION_EXPIRED);
    }
    const json = await readJson<PosCustomer[]>(response);
    if (!response.ok || !json?.success) {
      throw new Error(json?.error?.message ?? `Gagal memuat pelanggan (HTTP ${response.status})`);
    }
    const items = Array.isArray(json.data) ? json.data : [];
    return items.map((customer) => ({
      ...customer,
      creditLimit: Number(customer.creditLimit ?? 0),
      balanceDue: Number(customer.balanceDue ?? 0),
      availableCredit: Number(customer.availableCredit ?? 0),
    }));
  }, []);

  const reloadCustomers = useCallback(async () => {
    if (!session) return;
    setCustomersLoading(true);
    setCustomersError(null);
    try {
      setCustomers(await fetchCustomers(session.accessToken));
    } catch (err) {
      if (err instanceof Error && err.message === SESSION_EXPIRED) {
        expireSession();
        return;
      }
      setCustomersError(err instanceof Error ? err.message : 'Gagal memuat pelanggan');
    } finally {
      setCustomersLoading(false);
    }
  }, [expireSession, fetchCustomers, session]);

  const fetchSettings = useCallback(async (token: string): Promise<PosSettings> => {
    const response = await fetch(`${API_BASE}/settings`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.status === 401 || response.status === 403) {
      throw new Error(SESSION_EXPIRED);
    }
    const json = await readJson<Record<string, unknown> | null>(response);
    if (!response.ok || !json?.success) {
      throw new Error(json?.error?.message ?? `Gagal memuat pengaturan (HTTP ${response.status})`);
    }
    return normalizeSettings(json.data);
  }, []);

  const reloadProducts = useCallback(async () => {
    setProductsLoading(true);
    setProductsError(null);
    try {
      const items = await fetchProducts();
      setProducts(items.filter((product) => product.isActive));
    } catch (err) {
      setProductsError(err instanceof Error ? err.message : 'Gagal memuat produk');
    } finally {
      setProductsLoading(false);
    }
  }, [fetchProducts]);

  const reloadSettings = useCallback(async () => {
    if (!session) return;
    setSettingsLoading(true);
    setSettingsError(null);
    try {
      const next = await fetchSettings(session.accessToken);
      setSettings(next);
    } catch (err) {
      if (err instanceof Error && err.message === SESSION_EXPIRED) {
        expireSession();
        return;
      }
      setSettingsError(err instanceof Error ? err.message : 'Gagal memuat pengaturan');
    } finally {
      setSettingsLoading(false);
    }
  }, [session, fetchSettings, expireSession]);

  useEffect(() => {
    if (!session) return;
    void reloadProducts();
    void reloadSettings();
    void reloadCustomers();
  }, [session, reloadProducts, reloadSettings, reloadCustomers]);

  useEffect(() => {
    if (!session || !selectedCustomerId) {
      setCustomerDetail(null);
      setCustomerDetailLoading(false);
      setCustomerDetailError(null);
      return;
    }

    let active = true;
    setCustomerDetail(null);
    setCustomerDetailLoading(true);
    setCustomerDetailError(null);

    void (async () => {
      try {
        const response = await fetch(`${API_BASE}/customers/${selectedCustomerId}/debts`, {
          headers: { Authorization: `Bearer ${session.accessToken}` },
        });
        if (!active) return;
        if (response.status === 401 || response.status === 403) {
          expireSession();
          return;
        }
        const json = await readJson<CustomerDebtList>(response);
        if (!active) return;
        if (!response.ok || !json?.success || !json.data) {
          throw new Error(json?.error?.message ?? `Gagal memuat piutang (HTTP ${response.status})`);
        }
        setCustomerDetail(json.data);
      } catch (err) {
        if (!active) return;
        setCustomerDetailError(err instanceof Error ? err.message : 'Gagal memuat piutang');
      } finally {
        if (active) setCustomerDetailLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [customerDetailVersion, expireSession, selectedCustomerId, session]);

  const categories = useMemo(
    () =>
      Array.from(
        new Set(
          products
            .map((product) => product.category?.name)
            .filter((category): category is string => Boolean(category)),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [products],
  );

  const visibleProducts = useMemo(() => {
    let list = products;
    const search = query.trim().toLowerCase();
    if (search) {
      list = list.filter(
        (product) =>
          product.name.toLowerCase().includes(search) || product.sku.toLowerCase().includes(search),
      );
    }
    if (categoryFilter !== 'all') {
      list = list.filter((product) => product.category?.name === categoryFilter);
    }
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [products, query, categoryFilter]);

  const calculation = useMemo<CalculatedCart | null>(() => {
    if (cart.length === 0 || !settings) return null;
    try {
      return calculatePosCart(cart, settings);
    } catch {
      return null;
    }
  }, [cart, settings]);

  const cashAmount = useMemo(() => parseCashInput(cashInput), [cashInput]);

  const selectedCustomer = useMemo(
    () => customers.find((customer) => customer.id === selectedCustomerId) ?? null,
    [customers, selectedCustomerId],
  );
  const effectiveCustomer =
    customerDetail && customerDetail.customer.id === selectedCustomerId
      ? customerDetail.customer
      : selectedCustomer;

  const settlement = useMemo(() => {
    if (!calculation || cashAmount === null) return null;
    try {
      return planPosPayments(calculation.roundedTotal, cashAmount, debtEnabled);
    } catch {
      return null;
    }
  }, [calculation, cashAmount, debtEnabled]);

  const debtAmount = debtEnabled ? (settlement?.debtAmount ?? null) : 0;

  const validateDebtPayment = useCallback(
    (amount: number): string | null => {
      if (amount <= 0) return null;
      if (!selectedCustomerId) return 'Pilih pelanggan untuk mencatat utang.';
      if (!customerDetail || customerDetail.customer.id !== selectedCustomerId) {
        if (customerDetailLoading) return 'Detail piutang pelanggan masih dimuat.';
        return customerDetailError ?? 'Detail piutang pelanggan belum tersedia.';
      }
      const customer = customerDetail.customer;
      if (customer.status !== 'ACTIVE') {
        return 'Pelanggan diblokir dan tidak boleh bertransaksi utang.';
      }
      if (customer.creditLimit > 0 && amount > customer.availableCredit) {
        return `Limit kredit tidak cukup. Tersedia ${formatRupiah(customer.availableCredit)}.`;
      }
      return null;
    },
    [customerDetail, customerDetailError, customerDetailLoading, selectedCustomerId],
  );

  const debtError = debtAmount !== null && debtAmount > 0 ? validateDebtPayment(debtAmount) : null;
  const debtReady =
    selectedCustomerId.length > 0 &&
    customerDetail !== null &&
    customerDetail.customer.id === selectedCustomerId &&
    !customerDetailLoading &&
    customerDetailError === null;

  const calculationFailed = cart.length > 0 && settings !== null && calculation === null;
  const canCheckout =
    session !== null &&
    settings !== null &&
    !settingsLoading &&
    settingsError === null &&
    calculation !== null &&
    settlement !== null &&
    cashAmount !== null &&
    debtAmount !== null &&
    (cashAmount > 0 || debtAmount > 0) &&
    (settlement.isSettled || debtAmount > 0) &&
    (debtAmount === 0 || debtError === null) &&
    !submitting &&
    !idempotencyConflict;

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setAuthError(null);
    setLoginSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const json = await readJson<LoginData>(response);
      if (!response.ok || !json?.success || !json.data) {
        throw new Error(json?.error?.message ?? 'Login gagal');
      }
      const payload = decodeJwt(json.data.accessToken);
      if (!payload || !isPosRole(payload.role)) {
        throw new Error('Akun ini tidak memiliki akses kasir');
      }
      const next: PosSession = {
        accessToken: json.data.accessToken,
        refreshToken: json.data.refreshToken,
        role: payload.role,
        username: payload.username ?? username.trim(),
      };
      savePosSession(next);
      setSession(next);
      setPassword('');
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Terjadi kesalahan saat login');
    } finally {
      setLoginSubmitting(false);
    }
  };

  const handleLogout = () => {
    clearPosSession();
    setSession(null);
    setProducts([]);
    setSettings(null);
    setCustomers([]);
    setCustomersLoading(false);
    setCustomersError(null);
    setSelectedCustomerId('');
    setCustomerDetail(null);
    setCustomerDetailLoading(false);
    setCustomerDetailError(null);
    setDebtEnabled(false);
    setCart([]);
    setCashInput('');
    setNote('');
    setIdempotencyKey('');
    setIdempotencyConflict(false);
    setMismatch(null);
    setReceipt(null);
    setError(null);
    setNotice(null);
    setAuthError(null);
    setUsername('');
    setPassword('');
  };

  const handleAddProduct = (product: PosProduct) => {
    if (product.stockQty <= 0) return;
    const existing = cart.find((line) => line.productId === product.id);
    if (existing && existing.qty >= product.stockQty) {
      setNotice(`Stok ${product.name} hanya ${product.stockQty} ${product.unit}.`);
      return;
    }
    setError(null);
    setNotice(null);
    setMismatch(null);
    setIdempotencyConflict(false);
    setCart((previous) => {
      const index = previous.findIndex((line) => line.productId === product.id);
      if (index < 0) return [...previous, toCartLine(product)];
      const next = [...previous];
      const line = next[index];
      next[index] = { ...line, qty: Math.min(line.qty + 1, line.stockQty) };
      return next;
    });
  };

  const handleQtyChange = (productId: string, qty: number) => {
    setError(null);
    setNotice(null);
    setMismatch(null);
    setIdempotencyConflict(false);
    setCart((previous) =>
      previous.map((line) => {
        if (line.productId !== productId) return line;
        const value = Number.isFinite(qty) ? Math.trunc(qty) : 1;
        return { ...line, qty: Math.max(1, Math.min(value, line.stockQty)) };
      }),
    );
  };

  const handleRemoveLine = (productId: string) => {
    const next = cart.filter((line) => line.productId !== productId);
    setCart(next);
    setError(null);
    setNotice(null);
    setMismatch(null);
    setIdempotencyConflict(false);
    if (next.length === 0) {
      setIdempotencyKey('');
      setCashInput('');
    }
  };

  const handleClearCart = () => {
    setCart([]);
    setCashInput('');
    setNote('');
    setDebtEnabled(false);
    setIdempotencyKey('');
    setIdempotencyConflict(false);
    setMismatch(null);
    setError(null);
    setNotice(null);
  };

  const handleCustomerChange = (customerId: string) => {
    setSelectedCustomerId(customerId);
    setCustomerDetail(null);
    setCustomerDetailError(null);
    setDebtEnabled(false);
    setMismatch(null);
    setError(null);
    setNotice(null);
  };

  const refreshCartForCheckout = useCallback(async (): Promise<RefreshedCart | null> => {
    if (!settings) throw new Error('Pengaturan toko belum dimuat.');
    const items = await fetchProducts();
    setProducts(items.filter((product) => product.isActive));
    const productMap = new Map(items.map((product) => [product.id, product]));
    const missing: string[] = [];
    const insufficient: string[] = [];
    const updated: PosCartLine[] = [];

    for (const line of cart) {
      const product = productMap.get(line.productId);
      if (!product || !product.isActive) {
        missing.push(line.name);
        continue;
      }
      if (line.qty > product.stockQty) {
        insufficient.push(`${product.name} (stok ${product.stockQty} ${product.unit})`);
        continue;
      }
      updated.push({
        ...line,
        sku: product.sku,
        name: product.name,
        unitPrice: product.priceSell,
        stockQty: product.stockQty,
        unit: product.unit,
        category: product.category?.name ?? 'Tanpa Kategori',
      });
    }

    if (missing.length > 0 || insufficient.length > 0) {
      const details = [
        missing.length > 0 ? `tidak tersedia: ${missing.join(', ')}` : null,
        insufficient.length > 0 ? `stok tidak cukup: ${insufficient.join(', ')}` : null,
      ]
        .filter((part): part is string => Boolean(part))
        .join('; ');
      throw new Error(`Keranjang perlu diperbarui (${details}). Ubah keranjang lalu coba lagi.`);
    }

    const refreshed = calculatePosCart(updated, settings);
    setCart(updated);

    const priceChanged = updated.some((line, index) => line.unitPrice !== cart[index]?.unitPrice);
    if (priceChanged) {
      setNotice(
        `Harga produk diperbarui. Total terbaru ${formatRupiah(refreshed.roundedTotal)}. Periksa lalu tekan Bayar lagi.`,
      );
      return null;
    }

    setNotice(null);
    return { cart: updated, calculation: refreshed };
  }, [cart, fetchProducts, settings]);

  const sendTransaction = useCallback(
    async (
      expectedTotal: number,
      key: string,
      lines: PosCartLine[],
      cash: number,
      debt: number,
      customerId: string,
    ) => {
      if (!session) return;
      const payments: Array<{ method: 'CASH' | 'DEBT'; amount: number }> = [];
      if (cash > 0) payments.push({ method: 'CASH', amount: cash });
      if (debt > 0) payments.push({ method: 'DEBT', amount: debt });

      const payload: {
        lines: Array<{ productId: string; qty: number }>;
        payments: Array<{ method: 'CASH' | 'DEBT'; amount: number }>;
        customerId?: string;
        note?: string;
        idempotencyKey: string;
        expectedTotal: number;
      } = {
        lines: lines.map((line) => ({ productId: line.productId, qty: line.qty })),
        payments,
        idempotencyKey: key,
        expectedTotal,
      };
      if (customerId) payload.customerId = customerId;
      const trimmedNote = note.trim();
      if (trimmedNote) payload.note = trimmedNote.slice(0, 500);

      const response = await fetch(`${API_BASE}/transactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify(payload),
      });
      const json = await readJson<PosTransaction>(response);

      if (response.status === 401 || response.status === 403) {
        expireSession();
        return;
      }

      if (response.status === 409 && json?.error?.code === 'TOTAL_MISMATCH') {
        const latestTotal = getDetailNumber(json.error.details, 'roundedTotal');
        if (latestTotal === null) {
          setError('Total transaksi berubah. Muat ulang keranjang lalu coba lagi.');
          return;
        }
        setNotice(null);
        setMismatch({ expectedTotal, latestTotal, key });
        return;
      }

      if (response.status === 409 && json?.error?.code === 'IDEMPOTENCY_MISMATCH') {
        setError(null);
        setNotice(null);
        setIdempotencyConflict(true);
        return;
      }

      if (!response.ok || !json?.success || !json.data) {
        setError(json?.error?.message ?? `Gagal menyimpan transaksi (HTTP ${response.status})`);
        return;
      }

      setReceipt(toReceipt(json.data));
      setCart([]);
      setCashInput('');
      setNote('');
      setSelectedCustomerId('');
      setCustomerDetail(null);
      setCustomerDetailError(null);
      setDebtEnabled(false);
      setIdempotencyKey('');
      setIdempotencyConflict(false);
      setMismatch(null);
      setError(null);
      setNotice(null);
      void fetchProducts()
        .then((items) => setProducts(items.filter((product) => product.isActive)))
        .catch(() => undefined);
      void reloadCustomers();
    },
    [expireSession, fetchProducts, note, reloadCustomers, session],
  );

  const handleCheckout = async () => {
    if (submitting) return;
    if (!settings) {
      setError('Pengaturan toko belum siap. Muat ulang pengaturan terlebih dahulu.');
      return;
    }
    if (idempotencyConflict) {
      setError('Buat kunci transaksi baru setelah memeriksa transaksi sebelumnya.');
      return;
    }
    if (!calculation || cart.length === 0) {
      setError('Keranjang masih kosong atau total belum dapat dihitung.');
      return;
    }
    if (cashAmount === null) {
      setError('Nominal uang tunai tidak valid.');
      return;
    }
    const debt = debtEnabled && settlement ? settlement.shortfall : 0;
    if (cashAmount <= 0 && debt <= 0) {
      setError('Masukkan nominal uang tunai atau aktifkan pembayaran utang.');
      return;
    }
    if (!debtEnabled && cashAmount < calculation.roundedTotal) {
      setError(`Uang tunai kurang ${formatRupiah(calculation.roundedTotal - cashAmount)}.`);
      return;
    }
    if (debt > 0) {
      const debtMessage = validateDebtPayment(debt);
      if (debtMessage) {
        setError(debtMessage);
        return;
      }
    }

    setSubmitting(true);
    setError(null);
    setNotice(null);
    setMismatch(null);
    let requestStarted = false;
    try {
      const refreshed = await refreshCartForCheckout();
      if (!refreshed) return;
      const refreshedDebt = planPosPayments(
        refreshed.calculation.roundedTotal,
        cashAmount,
        debtEnabled,
      ).debtAmount;
      if (!debtEnabled && cashAmount < refreshed.calculation.roundedTotal) {
        setNotice(
          `Total terbaru ${formatRupiah(refreshed.calculation.roundedTotal)}. Uang tunai belum mencukupi.`,
        );
        return;
      }
      if (refreshedDebt > 0) {
        const debtMessage = validateDebtPayment(refreshedDebt);
        if (debtMessage) {
          setError(debtMessage);
          return;
        }
      }
      const key = idempotencyKey || createIdempotencyKey();
      if (!idempotencyKey) setIdempotencyKey(key);
      requestStarted = true;
      await sendTransaction(
        refreshed.calculation.roundedTotal,
        key,
        refreshed.cart,
        cashAmount,
        refreshedDebt,
        selectedCustomerId,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Gagal menyimpan transaksi.';
      setError(
        requestStarted
          ? `${message} Kunci transaksi dipertahankan; tekan Bayar lagi untuk mencoba ulang.`
          : message,
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmMismatch = async () => {
    if (!mismatch || submitting) return;
    if (cashAmount === null) {
      setError('Nominal uang tunai tidak valid.');
      return;
    }
    const debt = planPosPayments(mismatch.latestTotal, cashAmount, debtEnabled).debtAmount;
    if (!debtEnabled && cashAmount < mismatch.latestTotal) {
      setError(`Uang tunai kurang ${formatRupiah(mismatch.latestTotal - cashAmount)}.`);
      return;
    }
    if (debt > 0) {
      const debtMessage = validateDebtPayment(debt);
      if (debtMessage) {
        setError(debtMessage);
        return;
      }
    }
    setSubmitting(true);
    setError(null);
    setNotice(null);
    setMismatch(null);
    try {
      setIdempotencyKey(mismatch.key);
      await sendTransaction(
        mismatch.latestTotal,
        mismatch.key,
        cart,
        cashAmount,
        debt,
        selectedCustomerId,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Gagal menyimpan transaksi.';
      setError(`${message} Kunci transaksi dipertahankan; tekan Bayar lagi untuk mencoba ulang.`);
    } finally {
      setSubmitting(false);
    }
  };

  const mismatchDebt =
    mismatch && cashAmount !== null
      ? planPosPayments(mismatch.latestTotal, cashAmount, debtEnabled).debtAmount
      : 0;
  const mismatchDebtError = mismatchDebt > 0 ? validateDebtPayment(mismatchDebt) : null;

  if (!hydrated) {
    return (
      <main className="min-h-screen bg-[#faf6ee] text-[#26332a]">
        <Header />
        <section className="mx-auto max-w-6xl px-4 py-10">
          <div className="rounded-2xl border border-[#e6ddc8] bg-white p-8 text-center text-[#8a8f7d]">
            Memuat…
          </div>
        </section>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="min-h-screen bg-[#faf6ee] text-[#26332a]">
        <Header />
        <section className="mx-auto max-w-md px-4 py-12">
          <div className="rounded-2xl border border-[#e6ddc8] bg-white p-6 shadow-sm">
            <h1 className="text-2xl font-bold tracking-tight">Masuk Kasir</h1>
            <p className="mt-1 text-sm text-[#8a8f7d]">
              Halaman ini untuk pengguna dengan peran admin atau kasir.
            </p>

            <form onSubmit={handleLogin} className="mt-6 space-y-4">
              <div>
                <label htmlFor="username" className="mb-1 block text-sm font-medium text-[#8a8f7d]">
                  Username
                </label>
                <input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoComplete="username"
                  className="w-full rounded-xl border border-[#e6ddc8] bg-[#faf6ee] px-4 py-3 text-[#26332a] placeholder-[#8a8f7d] focus:border-[#5c7a5f] focus:outline-none"
                  required
                />
              </div>
              <div>
                <label htmlFor="password" className="mb-1 block text-sm font-medium text-[#8a8f7d]">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  className="w-full rounded-xl border border-[#e6ddc8] bg-[#faf6ee] px-4 py-3 text-[#26332a] placeholder-[#8a8f7d] focus:border-[#5c7a5f] focus:outline-none"
                  required
                />
              </div>

              {authError && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {authError}
                </div>
              )}

              <button
                type="submit"
                disabled={loginSubmitting}
                className="w-full rounded-xl bg-[#5c7a5f] py-3 font-semibold text-white transition hover:bg-[#4c6b4f] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loginSubmitting ? 'Memproses…' : 'Masuk'}
              </button>
            </form>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#faf6ee] text-[#26332a]">
      <Header />
      <section className="bg-gradient-to-r from-[#7fa083] to-[#5c7a5f]">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-8 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white">Kasir</h1>
            <p className="mt-1 text-white/90">
              Pilih produk, masukkan uang tunai, lalu simpan transaksi.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-white/15 px-3 py-1 text-sm text-white">
              {session.username} · {session.role === 'ADMIN' ? 'Admin' : 'Kasir'}
            </span>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-[#3f5d43] shadow-sm transition hover:bg-[#eef4ea]"
            >
              Keluar
            </button>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-6">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_410px]">
          <div className="space-y-4">
            <div className="rounded-2xl border border-[#e6ddc8] bg-white p-4 shadow-sm">
              <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
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
                    placeholder="Cari nama atau SKU produk…"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    className="w-full rounded-xl border border-[#e6ddc8] bg-[#faf6ee] py-2 pl-10 pr-4 text-sm text-[#26332a] placeholder:text-[#8a8f7d] focus:border-[#7fa083] focus:outline-none focus:ring-2 focus:ring-[#7fa083]/30"
                  />
                </div>
                <select
                  value={categoryFilter}
                  onChange={(event) => setCategoryFilter(event.target.value)}
                  className="rounded-xl border border-[#e6ddc8] bg-white px-4 py-2 text-sm text-[#26332a] focus:border-[#7fa083] focus:outline-none focus:ring-2 focus:ring-[#7fa083]/30"
                >
                  <option value="all">Semua Kategori</option>
                  {categories.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </div>
              <p className="mt-3 text-sm text-[#8a8f7d]">
                Menampilkan <span className="font-medium">{visibleProducts.length}</span> dari{' '}
                <span className="font-medium">{products.length}</span> produk aktif
              </p>
            </div>

            {productsLoading && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {Array.from({ length: 6 }, (_, index) => (
                  <div
                    key={index}
                    className="animate-pulse rounded-2xl border border-[#e6ddc8] bg-white p-4"
                  >
                    <div className="h-3 w-1/3 rounded bg-[#e6ddc8]" />
                    <div className="mt-4 h-5 w-3/4 rounded bg-[#e6ddc8]" />
                    <div className="mt-2 h-3 w-1/2 rounded bg-[#e6ddc8]" />
                    <div className="mt-6 h-9 w-full rounded bg-[#e6ddc8]" />
                  </div>
                ))}
              </div>
            )}

            {!productsLoading && productsError && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center text-red-700">
                <p>{productsError}</p>
                <button
                  type="button"
                  onClick={() => void reloadProducts()}
                  className="mt-3 rounded-xl bg-red-700 px-4 py-2 text-sm font-semibold text-white"
                >
                  Coba Lagi
                </button>
              </div>
            )}

            {!productsLoading && !productsError && visibleProducts.length === 0 && (
              <div className="rounded-xl border border-[#e6ddc8] bg-white p-8 text-center text-[#8a8f7d]">
                Tidak ada produk aktif yang cocok dengan pencarian.
              </div>
            )}

            {!productsLoading && !productsError && visibleProducts.length > 0 && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {visibleProducts.map((product) => {
                  const outOfStock = product.stockQty <= 0;
                  const lowStock = product.stockQty > 0 && product.stockQty <= 10;
                  const stockTone = outOfStock
                    ? 'bg-red-100 text-red-700'
                    : lowStock
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-[#e8efe6] text-[#4c6b4f]';
                  return (
                    <article
                      key={product.id}
                      className="flex flex-col rounded-2xl border border-[#e6ddc8] bg-white p-4 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="rounded-full bg-[#eef4ea] px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-[#5c7a5f]">
                          {product.category?.name ?? 'Tanpa Kategori'}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${stockTone}`}
                        >
                          {outOfStock ? 'Stok habis' : lowStock ? 'Stok menipis' : 'Tersedia'}
                        </span>
                      </div>
                      <h2 className="mt-3 line-clamp-2 text-sm font-semibold text-[#26332a]">
                        {product.name}
                      </h2>
                      <p className="mt-1 text-xs text-[#8a8f7d]">{product.sku}</p>
                      <div className="mt-4 flex items-end justify-between gap-3">
                        <p className="text-lg font-bold text-[#3f5d43]">
                          {formatRupiah(product.priceSell)}
                        </p>
                        <p className="text-xs text-[#8a8f7d]">
                          Stok {product.stockQty.toLocaleString('id-ID')} {product.unit}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleAddProduct(product)}
                        disabled={outOfStock}
                        className="mt-4 w-full rounded-xl bg-[#5c7a5f] py-2 text-sm font-semibold text-white transition hover:bg-[#4c6b4f] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {outOfStock ? 'Stok Habis' : 'Tambah'}
                      </button>
                    </article>
                  );
                })}
              </div>
            )}
          </div>

          <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
            {settingsError && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                <p>Gagal memuat pengaturan toko: {settingsError}</p>
                <button
                  type="button"
                  onClick={() => void reloadSettings()}
                  className="mt-2 rounded-lg bg-red-700 px-3 py-1.5 text-xs font-semibold text-white"
                >
                  Muat Ulang
                </button>
              </div>
            )}

            <div className="rounded-2xl border border-[#e6ddc8] bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-[#26332a]">Keranjang</h2>
                <button
                  type="button"
                  onClick={handleClearCart}
                  disabled={cart.length === 0 || submitting}
                  className="text-xs font-semibold text-[#c0392b] disabled:opacity-40"
                >
                  Kosongkan
                </button>
              </div>

              {cart.length === 0 ? (
                <div className="mt-4 rounded-xl bg-[#faf6ee] p-6 text-center text-sm text-[#8a8f7d]">
                  Belum ada produk. Pilih produk di sebelah kiri.
                </div>
              ) : (
                <div className="mt-3 max-h-[38vh] space-y-1 overflow-y-auto pr-1">
                  {cart.map((line) => (
                    <div
                      key={line.productId}
                      className="border-b border-[#e6ddc8] py-3 last:border-b-0"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-[#26332a]">
                            {line.name}
                          </p>
                          <p className="mt-0.5 text-xs text-[#8a8f7d]">
                            {line.sku} · {formatRupiah(line.unitPrice)}
                          </p>
                        </div>
                        <p className="whitespace-nowrap text-sm font-semibold text-[#26332a]">
                          {formatRupiah(line.unitPrice * line.qty)}
                        </p>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            aria-label={`Kurangi ${line.name}`}
                            onClick={() => handleQtyChange(line.productId, line.qty - 1)}
                            disabled={line.qty <= 1}
                            className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#e6ddc8] text-lg leading-none text-[#5c6b58] disabled:opacity-40"
                          >
                            −
                          </button>
                          <input
                            type="number"
                            aria-label={`Jumlah ${line.name}`}
                            min={1}
                            max={line.stockQty}
                            value={line.qty}
                            onChange={(event) =>
                              handleQtyChange(line.productId, Number(event.target.value))
                            }
                            className="h-8 w-14 rounded-lg border border-[#e6ddc8] bg-[#faf6ee] px-1 text-center text-sm text-[#26332a] focus:border-[#7fa083] focus:outline-none"
                          />
                          <button
                            type="button"
                            aria-label={`Tambah ${line.name}`}
                            onClick={() => handleQtyChange(line.productId, line.qty + 1)}
                            disabled={line.qty >= line.stockQty}
                            className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#e6ddc8] text-lg leading-none text-[#5c6b58] disabled:opacity-40"
                          >
                            +
                          </button>
                          <span className="ml-1 text-xs text-[#8a8f7d]">
                            /{line.stockQty} {line.unit}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveLine(line.productId)}
                          className="text-xs font-semibold text-[#c0392b]"
                        >
                          Hapus
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {cart.length > 0 && (
              <div className="rounded-2xl border border-[#e6ddc8] bg-white p-4 shadow-sm">
                {settingsLoading && (
                  <p className="mb-3 text-xs text-[#8a8f7d]">
                    Memuat pengaturan pajak dan pembulatan…
                  </p>
                )}

                {calculationFailed && (
                  <div className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    Total tidak dapat dihitung. Periksa kembali isi keranjang.
                  </div>
                )}

                {calculation && (
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-[#8a8f7d]">Subtotal</span>
                      <span className="text-[#26332a]">{formatRupiah(calculation.subtotal)}</span>
                    </div>
                    {!settings?.taxInclusive && calculation.taxTotal > 0 && (
                      <div className="flex justify-between">
                        <span className="text-[#8a8f7d]">Pajak</span>
                        <span className="text-[#26332a]">{formatRupiah(calculation.taxTotal)}</span>
                      </div>
                    )}
                    {calculation.roundingAdjustment !== 0 && (
                      <div className="flex justify-between">
                        <span className="text-[#8a8f7d]">Pembulatan</span>
                        <span className="text-[#26332a]">
                          {formatRupiah(calculation.roundingAdjustment)}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between border-t border-[#e6ddc8] pt-3 text-base">
                      <span className="font-semibold text-[#26332a]">Total</span>
                      <span className="font-bold text-[#3f5d43]">
                        {formatRupiah(calculation.roundedTotal)}
                      </span>
                    </div>
                    {settings?.taxInclusive && calculation.taxTotal > 0 && (
                      <p className="text-right text-xs text-[#8a8f7d]">
                        Termasuk pajak {formatRupiah(calculation.taxTotal)}
                      </p>
                    )}
                  </div>
                )}

                <div className="mt-4 border-t border-[#e6ddc8] pt-4">
                  <div className="flex items-center justify-between gap-2">
                    <label htmlFor="customer" className="text-sm font-medium text-[#8a8f7d]">
                      Pelanggan
                    </label>
                    <span className="text-xs text-[#8a8f7d]">Wajib untuk utang</span>
                  </div>
                  <select
                    id="customer"
                    value={selectedCustomerId}
                    onChange={(event) => handleCustomerChange(event.target.value)}
                    disabled={customersLoading}
                    className="mt-1 w-full rounded-xl border border-[#e6ddc8] bg-[#faf6ee] px-3 py-2.5 text-sm text-[#26332a] focus:border-[#7fa083] focus:outline-none focus:ring-2 focus:ring-[#7fa083]/30 disabled:opacity-60"
                  >
                    <option value="">
                      {customersLoading ? 'Memuat pelanggan…' : 'Pelanggan umum (tanpa nama)'}
                    </option>
                    {customers.map((customer) => (
                      <option key={customer.id} value={customer.id}>
                        {customer.name} — {customer.phone}
                      </option>
                    ))}
                  </select>

                  {customersError && (
                    <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                      <p>{customersError}</p>
                      <button
                        type="button"
                        onClick={() => void reloadCustomers()}
                        className="mt-1 font-semibold underline"
                      >
                        Muat ulang pelanggan
                      </button>
                    </div>
                  )}

                  {effectiveCustomer && (
                    <div className="mt-2 rounded-xl border border-[#e6ddc8] bg-[#faf6ee] p-3 text-xs text-[#5c6b58]">
                      <p className="font-semibold text-[#26332a]">
                        {effectiveCustomer.name} · {effectiveCustomer.phone}
                      </p>
                      {customerDetailLoading && <p className="mt-1">Memuat data piutang…</p>}
                      {customerDetailError && (
                        <div className="mt-1 text-red-700">
                          <p>{customerDetailError}</p>
                          <button
                            type="button"
                            onClick={() => setCustomerDetailVersion((value) => value + 1)}
                            className="mt-1 font-semibold underline"
                          >
                            Coba lagi
                          </button>
                        </div>
                      )}
                      {customerDetail?.customer.id === selectedCustomerId && (
                        <div className="mt-1.5 space-y-1">
                          <div className="flex justify-between gap-3">
                            <span>Sisa piutang saat ini</span>
                            <span className="font-semibold text-[#26332a]">
                              {formatRupiah(customerDetail.customer.balanceDue)}
                            </span>
                          </div>
                          <div className="flex justify-between gap-3">
                            <span>Limit kredit</span>
                            <span className="text-right font-medium text-[#26332a]">
                              {customerDetail.customer.creditLimit > 0
                                ? formatRupiah(customerDetail.customer.creditLimit)
                                : 'Tanpa limit'}
                            </span>
                          </div>
                          <div className="flex justify-between gap-3">
                            <span>Limit tersedia</span>
                            <span className="font-medium text-[#26332a]">
                              {customerDetail.customer.creditLimit > 0
                                ? formatRupiah(customerDetail.customer.availableCredit)
                                : 'Tidak terbatas'}
                            </span>
                          </div>
                          {customerDetail.customer.status !== 'ACTIVE' && (
                            <p className="font-semibold text-red-700">
                              Pelanggan diblokir dan tidak boleh berutang.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  <label
                    className={`mt-3 flex items-start gap-2 rounded-xl border p-3 text-sm ${
                      debtReady
                        ? 'cursor-pointer border-[#d8cfb8] bg-[#fffdf8]'
                        : 'border-[#eee7d7] bg-[#faf8f2] text-[#8a8f7d]'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={debtEnabled && debtReady}
                      onChange={(event) => {
                        setDebtEnabled(event.target.checked);
                        setError(null);
                      }}
                      disabled={!debtReady}
                      className="mt-0.5 h-4 w-4 accent-[#5c7a5f]"
                    />
                    <span>
                      <span className="block font-medium text-[#26332a]">
                        Catat sisa sebagai utang (DP)
                      </span>
                      <span className="block text-xs">
                        {selectedCustomerId
                          ? 'Kekurangan dari uang tunai dicatat sebagai piutang pelanggan.'
                          : 'Pilih pelanggan terlebih dahulu untuk mengaktifkan utang.'}
                      </span>
                    </span>
                  </label>
                </div>

                <div className="mt-4 border-t border-[#e6ddc8] pt-4">
                  <div className="flex items-center justify-between gap-2">
                    <label htmlFor="cash" className="text-sm font-medium text-[#8a8f7d]">
                      {debtEnabled ? 'DP tunai (Rp)' : 'Uang tunai (Rp)'}
                    </label>
                    {calculation && (
                      <button
                        type="button"
                        onClick={() => setCashInput(String(calculation.roundedTotal / 100))}
                        className="text-xs font-semibold text-[#5c7a5f] hover:underline"
                      >
                        Uang pas
                      </button>
                    )}
                  </div>
                  <div className="relative mt-1">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[#8a8f7d]">
                      Rp
                    </span>
                    <input
                      id="cash"
                      type="text"
                      inputMode="numeric"
                      value={cashInput}
                      onChange={(event) => {
                        setCashInput(event.target.value);
                        setError(null);
                      }}
                      placeholder="0"
                      className="w-full rounded-xl border border-[#e6ddc8] bg-[#faf6ee] py-2.5 pl-10 pr-3 text-right font-semibold text-[#26332a] placeholder:text-[#8a8f7d] focus:border-[#7fa083] focus:outline-none focus:ring-2 focus:ring-[#7fa083]/30"
                    />
                  </div>
                  {cashInput.trim() !== '' && cashAmount === null && (
                    <p className="mt-1 text-xs text-red-700">Nominal uang tunai tidak valid.</p>
                  )}
                  {cashAmount !== null && cashAmount > 0 && calculation && (
                    <div className="mt-2 flex justify-between text-sm">
                      <span className="text-[#8a8f7d]">Perkiraan kembalian</span>
                      <span className="font-semibold text-[#3f5d43]">
                        {formatRupiah(settlement?.change ?? 0)}
                      </span>
                    </div>
                  )}
                  {debtEnabled && debtAmount !== null && debtAmount > 0 && (
                    <div className="mt-2 space-y-1 rounded-lg bg-amber-50 p-2.5 text-sm text-amber-900">
                      <div className="flex justify-between gap-3">
                        <span>DP tunai</span>
                        <span className="font-medium">
                          {formatRupiah(Math.min(cashAmount ?? 0, calculation?.roundedTotal ?? 0))}
                        </span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span className="font-semibold">Sisa menjadi utang</span>
                        <span className="font-bold">{formatRupiah(debtAmount)}</span>
                      </div>
                      <p className="text-xs">Jatuh tempo default 30 hari.</p>
                    </div>
                  )}
                  {settlement && !settlement.isSettled && !debtEnabled && (
                    <p className="mt-1 text-xs text-red-700">
                      Kurang {formatRupiah(settlement.shortfall)} dari total.
                    </p>
                  )}
                  {debtError && <p className="mt-1 text-xs text-red-700">{debtError}</p>}
                </div>

                <div className="mt-4">
                  <label htmlFor="note" className="mb-1 block text-sm font-medium text-[#8a8f7d]">
                    Catatan (opsional)
                  </label>
                  <textarea
                    id="note"
                    value={note}
                    onChange={(event) => setNote(event.target.value.slice(0, 500))}
                    rows={2}
                    placeholder="Contoh: dibungkus terpisah"
                    className="w-full resize-none rounded-xl border border-[#e6ddc8] bg-[#faf6ee] px-3 py-2 text-sm text-[#26332a] placeholder:text-[#8a8f7d] focus:border-[#7fa083] focus:outline-none"
                  />
                </div>

                {idempotencyConflict && (
                  <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    <p className="font-semibold">
                      Kunci transaksi sudah dipakai untuk isi berbeda.
                    </p>
                    <p className="mt-1 text-xs">
                      Periksa transaksi sebelumnya. Jangan ulangi otomatis.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setIdempotencyConflict(false);
                        setIdempotencyKey('');
                        setError(null);
                      }}
                      className="mt-2 rounded-lg bg-red-700 px-3 py-1.5 text-xs font-semibold text-white"
                    >
                      Buat Kunci Transaksi Baru
                    </button>
                  </div>
                )}

                {error && (
                  <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    {error}
                  </div>
                )}

                {notice && (
                  <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    {notice}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => void handleCheckout()}
                  disabled={!canCheckout}
                  className="mt-4 w-full rounded-xl bg-[#5c7a5f] py-3 font-semibold text-white transition hover:bg-[#4c6b4f] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {submitting
                    ? 'Menyimpan…'
                    : debtAmount !== null && debtAmount > 0
                      ? 'Bayar DP & Catat Utang'
                      : 'Bayar Tunai'}
                </button>
                <p className="mt-2 text-center text-xs text-[#8a8f7d]">
                  Jika koneksi gagal, tekan Bayar lagi. Kunci transaksi yang sama akan dipakai.
                </p>
              </div>
            )}
          </aside>
        </div>
      </section>

      {mismatch && (
        <MismatchDialog
          mismatch={mismatch}
          cashAmount={cashAmount}
          debtAmount={mismatchDebt}
          customerName={effectiveCustomer?.name ?? null}
          debtError={mismatchDebtError}
          submitting={submitting}
          onConfirm={() => void handleConfirmMismatch()}
          onDismiss={() => {
            setMismatch(null);
            setNotice('Total terbaru belum dikonfirmasi. Periksa keranjang lalu bayar ulang.');
          }}
        />
      )}

      {receipt && (
        <ReceiptDialog
          receipt={receipt}
          canViewReceivables={session?.role === 'ADMIN'}
          onClose={() => setReceipt(null)}
        />
      )}
    </main>
  );
}
