'use client';

import type { PaginationMeta, ReceivableCustomer } from '@warung/shared';
import Link from 'next/link';
import { type FormEvent, useCallback, useEffect, useState } from 'react';

import AdminGate from '@/components/admin/AdminGate';
import {
  adminPageRequest,
  type AdminSession,
  isAdminAuthError,
  RECEIVABLE_ROLES,
} from '@/lib/admin';
import { formatRupiah } from '@/lib/pos';
import {
  formatOverdueDays,
  formatPaginationLabel,
  formatReceivableDate,
  RECEIVABLE_PAGE_SIZE,
} from '@/lib/receivables';

type ReceivablesContentProps = {
  session: AdminSession;
  expireSession: (message?: string) => void;
};

function StatCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-2xl border border-[#e6ddc8] bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-[#8a8f7d]">{label}</p>
      <p className="mt-2 text-2xl font-bold tracking-tight text-[#26332a]">{value}</p>
      <p className="mt-1 text-xs text-[#8a8f7d]">{hint}</p>
    </div>
  );
}

function ReceivablesContent({ session, expireSession }: ReceivablesContentProps) {
  const [items, setItems] = useState<ReceivableCustomer[]>([]);
  const [meta, setMeta] = useState<PaginationMeta | null>(null);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const handleError = useCallback(
    (err: unknown) => {
      if (isAdminAuthError(err)) {
        expireSession();
        return;
      }
      setError(err instanceof Error ? err.message : 'Terjadi kesalahan saat memuat piutang');
    },
    [expireSession],
  );

  const load = useCallback(
    async (nextPage: number, nextSearch: string) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          page: String(nextPage),
          pageSize: String(RECEIVABLE_PAGE_SIZE),
        });
        if (nextSearch) params.set('search', nextSearch);
        const result = await adminPageRequest<ReceivableCustomer[]>(
          session,
          `/debts/customers?${params.toString()}`,
        );
        setItems(result.data);
        setMeta(result.meta);
      } catch (err) {
        handleError(err);
      } finally {
        setLoading(false);
      }
    },
    [handleError, session],
  );

  useEffect(() => {
    void load(page, search);
  }, [load, page, search]);

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  };

  const pageBalance = items.reduce((total, item) => total + item.balanceDue, 0);
  const pageOverdue = items.reduce((total, item) => total + item.overdueAmount, 0);
  const overdueCustomers = items.filter((item) => (item.overdueDays ?? 0) > 0).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-[#8a8f7d]">
            {meta ? formatPaginationLabel(meta) : 'Memuat data piutang...'}
          </p>
          <p className="mt-1 text-xs text-[#8a8f7d]">
            Ringkasan di bawah hanya menghitung pelanggan pada halaman ini.
          </p>
        </div>
        {session.role === 'ADMIN' && (
          <Link
            href="/admin/receivables/aging"
            className="rounded-xl bg-[#5c7a5f] px-5 py-2.5 text-center text-sm font-semibold text-white transition hover:bg-[#4c6b4f]"
          >
            Laporan Umur Piutang
          </Link>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Pelanggan berpiutang"
          value={(meta?.total ?? 0).toLocaleString('id-ID')}
          hint="Seluruh pelanggan pada hasil pencarian"
        />
        <StatCard
          label="Sisa tagihan halaman ini"
          value={formatRupiah(pageBalance)}
          hint="Total outstanding pelanggan di halaman ini"
        />
        <StatCard
          label="Lewat jatuh tempo"
          value={formatRupiah(pageOverdue)}
          hint={`${overdueCustomers} pelanggan di halaman ini`}
        />
        <StatCard
          label="Tagihan belum lunas"
          value={items
            .reduce((total, item) => total + item.invoiceCount, 0)
            .toLocaleString('id-ID')}
          hint="Jumlah invoice aktif di halaman ini"
        />
      </div>

      <form
        onSubmit={handleSearch}
        className="grid gap-2 rounded-2xl border border-[#e6ddc8] bg-white p-4 shadow-sm sm:grid-cols-[1fr_auto]"
      >
        <input
          type="search"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="Cari nama atau nomor telepon pelanggan..."
          className="w-full rounded-xl border border-[#e6ddc8] bg-[#faf6ee] px-3 py-2 text-sm text-[#26332a] placeholder:text-[#8a8f7d] focus:border-[#5c7a5f] focus:outline-none focus:ring-2 focus:ring-[#7fa083]/30"
        />
        <button
          type="submit"
          className="rounded-xl border border-[#5c7a5f] px-5 py-2 text-sm font-semibold text-[#3f5d43] transition hover:bg-[#eef4ea]"
        >
          Cari
        </button>
      </form>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="rounded-2xl border border-[#e6ddc8] bg-white shadow-sm">
        {loading ? (
          <div className="p-8 text-center text-sm text-[#8a8f7d]">Memuat piutang...</div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center text-sm text-[#8a8f7d]">
            {search
              ? 'Tidak ada pelanggan berpiutang yang cocok dengan pencarian.'
              : 'Belum ada piutang pelanggan.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead>
                <tr className="border-b border-[#e6ddc8] text-xs uppercase tracking-wide text-[#8a8f7d]">
                  <th className="px-4 py-3 font-medium">Pelanggan</th>
                  <th className="px-4 py-3 font-medium">Sisa Tagihan</th>
                  <th className="px-4 py-3 font-medium">Jatuh Tempo</th>
                  <th className="px-4 py-3 font-medium">Limit Kredit</th>
                  <th className="px-4 py-3 font-medium">Invoice</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#eee6d5]">
                {items.map((item) => {
                  const overdue = (item.overdueDays ?? 0) > 0;
                  return (
                    <tr key={item.customerId} className="align-top">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-[#26332a]">{item.customerName}</p>
                        <p className="mt-0.5 text-xs text-[#8a8f7d]">{item.customerPhone}</p>
                        <p className="mt-1 text-[11px] text-[#8a8f7d]">
                          Transaksi terakhir {formatReceivableDate(item.lastTransactionAt)}
                        </p>
                      </td>
                      <td className="px-4 py-3 font-semibold text-[#26332a]">
                        {formatRupiah(item.balanceDue)}
                      </td>
                      <td className="px-4 py-3">
                        <p className={overdue ? 'font-medium text-red-600' : 'text-[#26332a]'}>
                          {item.overdueAmount > 0 ? formatRupiah(item.overdueAmount) : 'Tidak ada'}
                        </p>
                        <p className="mt-0.5 text-xs text-[#8a8f7d]">
                          {formatOverdueDays(item.overdueDays)}
                          {item.oldestDueDate
                            ? ` - ${formatReceivableDate(item.oldestDueDate)}`
                            : ''}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-[#26332a]">
                          {item.creditLimit > 0 ? formatRupiah(item.creditLimit) : 'Tanpa limit'}
                        </p>
                        <p className="mt-0.5 text-xs text-[#8a8f7d]">
                          Sisa {formatRupiah(item.availableCredit)}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-[#26332a]">{item.invoiceCount} aktif</p>
                        <p className="mt-0.5 text-xs text-[#8a8f7d]">
                          {item.unpaidInvoiceCount} belum bayar, {item.partialInvoiceCount} sebagian
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                              item.customerStatus === 'BLOCKED'
                                ? 'bg-red-100 text-red-700'
                                : 'bg-green-100 text-green-700'
                            }`}
                          >
                            {item.customerStatus === 'BLOCKED' ? 'Diblokir' : 'Aktif'}
                          </span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                              item.paymentStatus === 'PARTIAL'
                                ? 'bg-blue-100 text-blue-700'
                                : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            {item.paymentStatus === 'PARTIAL' ? 'Sebagian' : 'Belum bayar'}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end">
                          <Link
                            href={`/admin/receivables/${item.customerId}`}
                            className="rounded-lg border border-[#e6ddc8] px-3 py-1.5 text-xs font-medium text-[#5c7a5f] transition hover:bg-[#faf6ee]"
                          >
                            Lihat Detail
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {meta && meta.total > 0 && (
          <div className="flex flex-col gap-2 border-t border-[#e6ddc8] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-[#8a8f7d]">{formatPaginationLabel(meta)}</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={!meta.hasPrev || loading}
                className="rounded-lg border border-[#e6ddc8] px-3 py-1.5 text-xs font-medium text-[#5c6b58] transition hover:bg-[#faf6ee] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Sebelumnya
              </button>
              <button
                type="button"
                onClick={() => setPage((current) => current + 1)}
                disabled={!meta.hasNext || loading}
                className="rounded-lg border border-[#e6ddc8] px-3 py-1.5 text-xs font-medium text-[#5c6b58] transition hover:bg-[#faf6ee] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Berikutnya
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ReceivablesPage() {
  return (
    <AdminGate
      title="Piutang Pelanggan"
      description="Pantau sisa tagihan, jatuh tempo, dan limit kredit pelanggan."
      allowedRoles={RECEIVABLE_ROLES}
    >
      {({ session, expireSession }) => (
        <ReceivablesContent session={session} expireSession={expireSession} />
      )}
    </AdminGate>
  );
}
