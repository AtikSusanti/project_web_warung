'use client';

import { useCallback, useEffect, useState } from 'react';
import AdminNav from '@/components/admin/AdminNav';
import Header from '@/components/Header';

const API_BASE = 'http://localhost:3000/api/v1';
const SESSION_KEY = 'warung_admin_session';

type Session = {
  accessToken: string;
  refreshToken: string;
  role: string;
  username: string;
};

type PaymentMethodTotal = { method: string; total: number; count: number };

type TopSellingProduct = { productId: string; name: string; qtySold: number; total: number };

type RecentTransaction = {
  id: string;
  invoiceNo: string;
  status: string;
  paymentStatus: string;
  grandTotal: string | number;
  roundedTotal: string | number;
  paidTotal: string | number;
  outstandingAmount: string | number;
  paymentMethod: string;
  cashierName: string;
  customerName: string;
  createdAt: string;
  itemCount: number;
  productNames: string | string[];
};

type Dashboard = {
  period: { from: string; to: string };
  sales: {
    todayTotal: number;
    todayCount: number;
    monthTotal: number;
    monthCount: number;
    averageBasket: number;
    vsPreviousBps: number | null;
    byMethod: PaymentMethodTotal[];
  };
  receivables: {
    total: number;
    customerCount: number;
    overdue: number;
    overdueCustomerCount: number;
    byAgingBucket: { key: string; label: string; amount: number }[];
  };
  inventory: {
    productCount: number;
    totalStockValue: number;
    lowStockCount: number;
    outOfStockCount: number;
    topSelling: TopSellingProduct[];
  };
  recentTransactions: RecentTransaction[];
};

type LoginResponse = {
  success: boolean;
  data: { accessToken: string; refreshToken: string; expiresIn: number; refreshExpiresAt: string } | null;
  error: { message: string } | null;
};

type DashboardResponse = {
  success: boolean;
  data: Dashboard;
  error: { message: string } | null;
};

const PAYMENT_STATUS_LABEL: Record<string, string> = {
  PAID: 'Lunas',
  UNPAID: 'Belum Bayar',
  PARTIAL: 'Sebagian',
  WRITTEN_OFF: 'Dihapus',
};

function decodeJwt(token: string): { role?: string; username?: string; exp?: number } | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const decoded = decodeURIComponent(
      atob(padded)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join(''),
    );
    return JSON.parse(decoded) as { role?: string; username?: string; exp?: number };
  } catch {
    return null;
  }
}

function loadSession(): Session | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session;
    if (!parsed.accessToken) return null;
    const payload = decodeJwt(parsed.accessToken);
    if (!payload || payload.role !== 'ADMIN') return null;
    if (typeof payload.exp === 'number' && payload.exp * 1000 <= Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveSession(session: Session): void {
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function clearSession(): void {
  window.localStorage.removeItem(SESSION_KEY);
}

function formatSen(value: string | number | null | undefined): string {
  const n = Number(value ?? 0) / 100;
  if (!Number.isFinite(n)) return 'Rp —';
  return 'Rp ' + n.toLocaleString('id-ID');
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-[#e6ddc8] bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-[#8a8f7d]">{label}</p>
      <p className="mt-2 text-2xl font-bold tracking-tight text-[#26332a]">{value}</p>
      {hint && <p className="mt-1 text-xs text-[#8a8f7d]">{hint}</p>}
    </div>
  );
}

export default function AdminPage() {
  const [hydrated, setHydrated] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setSession(loadSession());
    setHydrated(true);
  }, []);

  const fetchDashboard = useCallback(async (token: string) => {
    const res = await fetch(`${API_BASE}/reports/dashboard`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401 || res.status === 403) {
      throw new Error('SESSION_EXPIRED');
    }
    const json = (await res.json()) as DashboardResponse;
    if (!res.ok || !json.success) {
      throw new Error(json.error?.message ?? `Gagal memuat dashboard (HTTP ${res.status})`);
    }
    return json.data;
  }, []);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchDashboard(session.accessToken)
      .then((data) => {
        if (!cancelled) setDashboard(data);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof Error && err.message === 'SESSION_EXPIRED') {
          clearSession();
          setSession(null);
          setDashboard(null);
          setAuthError('Sesi berakhir atau akses ditolak. Silakan login lagi.');
        } else {
          setError(err instanceof Error ? err.message : 'Gagal memuat dashboard');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session, fetchDashboard]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const json = (await res.json()) as LoginResponse;
      if (!res.ok || !json.success || !json.data) {
        throw new Error(json.error?.message ?? 'Login gagal');
      }
      const payload = decodeJwt(json.data.accessToken);
      if (!payload || payload.role !== 'ADMIN') {
        throw new Error('Akun ini tidak memiliki akses admin');
      }
      const next: Session = {
        accessToken: json.data.accessToken,
        refreshToken: json.data.refreshToken,
        role: payload.role,
        username: payload.username ?? username.trim(),
      };
      saveSession(next);
      setSession(next);
      setPassword('');
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Terjadi kesalahan saat login');
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogout = () => {
    clearSession();
    setSession(null);
    setDashboard(null);
    setError(null);
    setAuthError(null);
    setUsername('');
    setPassword('');
  };

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
            <h1 className="text-2xl font-bold tracking-tight">Masuk Admin</h1>
            <p className="mt-1 text-sm text-[#8a8f7d]">Halaman ini hanya untuk pengguna dengan peran admin.</p>

            <form onSubmit={handleLogin} className="mt-6 space-y-4">
              <div>
                <label htmlFor="username" className="mb-1 block text-sm font-medium text-[#8a8f7d]">
                  Username
                </label>
                <input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
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
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  className="w-full rounded-xl border border-[#e6ddc8] bg-[#faf6ee] px-4 py-3 text-[#26332a] placeholder-[#8a8f7d] focus:border-[#5c7a5f] focus:outline-none"
                  required
                />
              </div>

              {authError && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{authError}</div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-xl bg-[#5c7a5f] py-3 font-semibold text-white transition hover:bg-[#4c6b4f] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? 'Memproses…' : 'Masuk'}
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
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-10 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white">Dashboard Admin</h1>
            <p className="mt-2 text-white/90">
              {dashboard ? `Periode ${formatDateTime(dashboard.period.from)} — ${formatDateTime(dashboard.period.to)}` : 'Ringkasan penjualan dan stok'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <AdminNav />
            <span className="rounded-full bg-white/15 px-3 py-1 text-sm text-white">Masuk sebagai {session.username}</span>
            <button
              onClick={handleLogout}
              className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-[#3f5d43] shadow-sm transition hover:bg-[#eef4ea]"
            >
              Keluar
            </button>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-6">
        {loading && (
          <div className="rounded-2xl border border-[#e6ddc8] bg-white p-8 text-center text-[#8a8f7d]">
            Memuat data dashboard…
          </div>
        )}

        {!loading && error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center text-red-700">
            Error: {error}
          </div>
        )}

        {!loading && !error && dashboard && (
          <div className="space-y-8">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <StatCard
                label="Penjualan Hari Ini"
                value={formatSen(dashboard.sales.todayTotal)}
                hint={`${dashboard.sales.todayCount} transaksi`}
              />
              <StatCard
                label="Penjualan Bulan Ini"
                value={formatSen(dashboard.sales.monthTotal)}
                hint={`${dashboard.sales.monthCount} transaksi`}
              />
              <StatCard label="Rata-rata Transaksi" value={formatSen(dashboard.sales.averageBasket)} hint="per transaksi" />
              <StatCard
                label="Piutang"
                value={formatSen(dashboard.receivables.total)}
                hint={`${dashboard.receivables.customerCount} pelanggan`}
              />
              <StatCard label="Jumlah Produk" value={dashboard.inventory.productCount.toLocaleString('id-ID')} hint="produk aktif" />
              <StatCard
                label="Stok Menipis / Habis"
                value={`${dashboard.inventory.lowStockCount} / ${dashboard.inventory.outOfStockCount}`}
                hint="menipis / habis"
              />
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <div className="rounded-2xl border border-[#e6ddc8] bg-white p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-[#26332a]">Produk Terlaris</h2>
                {dashboard.inventory.topSelling.length === 0 ? (
                  <p className="mt-4 text-sm text-[#8a8f7d]">Belum ada penjualan.</p>
                ) : (
                  <ul className="mt-4 divide-y divide-[#e6ddc8]">
                    {dashboard.inventory.topSelling.map((p) => (
                      <li key={p.productId} className="flex items-center justify-between py-3 text-sm">
                        <span className="pr-4 text-[#26332a]">{p.name}</span>
                        <span className="whitespace-nowrap text-[#8a8f7d]">
                          {p.qtySold.toLocaleString('id-ID')} terjual · {formatSen(p.total)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="rounded-2xl border border-[#e6ddc8] bg-white p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-[#26332a]">Piutang</h2>
                {dashboard.receivables.total === 0 && dashboard.receivables.customerCount === 0 ? (
                  <p className="mt-4 text-sm text-[#8a8f7d]">Tidak ada piutang.</p>
                ) : (
                  <div className="mt-4 space-y-3 text-sm">
                    <div className="flex justify-between">
                      <span className="text-[#8a8f7d]">Total piutang</span>
                      <span className="font-semibold text-[#26332a]">{formatSen(dashboard.receivables.total)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#8a8f7d]">Jumlah pelanggan</span>
                      <span className="font-semibold text-[#26332a]">
                        {dashboard.receivables.customerCount.toLocaleString('id-ID')}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#8a8f7d]">Jatuh tempo</span>
                      <span className="font-semibold text-[#c0392b]">
                        {formatSen(dashboard.receivables.overdue)} · {dashboard.receivables.overdueCustomerCount} pelanggan
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-[#e6ddc8] bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-[#26332a]">Transaksi Terbaru</h2>
              {dashboard.recentTransactions.length === 0 ? (
                <p className="mt-4 text-sm text-[#8a8f7d]">Belum ada transaksi.</p>
              ) : (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-[#e6ddc8] text-xs uppercase tracking-wide text-[#8a8f7d]">
                        <th className="py-2 pr-4 font-medium">No. Invoice</th>
                        <th className="py-2 pr-4 font-medium">Pelanggan</th>
                        <th className="py-2 pr-4 font-medium">Total</th>
                        <th className="py-2 pr-4 font-medium">Status</th>
                        <th className="py-2 pr-4 font-medium">Petugas</th>
                        <th className="py-2 font-medium">Waktu</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#e6ddc8]">
                      {dashboard.recentTransactions.map((t) => (
                        <tr key={t.id}>
                          <td className="py-3 pr-4 font-medium text-[#26332a]">{t.invoiceNo}</td>
                          <td className="py-3 pr-4 text-[#26332a]">{t.customerName || 'Umum'}</td>
                          <td className="py-3 pr-4 text-[#26332a]">{formatSen(t.roundedTotal ?? t.grandTotal)}</td>
                          <td className="py-3 pr-4">
                            <span className="rounded-full bg-[#eef4ea] px-2.5 py-0.5 text-[11px] font-semibold text-[#5c7a5f]">
                              {PAYMENT_STATUS_LABEL[t.paymentStatus] ?? t.paymentStatus}
                            </span>
                          </td>
                          <td className="py-3 pr-4 text-[#8a8f7d]">{t.cashierName}</td>
                          <td className="py-3 text-[#8a8f7d]">{formatDateTime(t.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
