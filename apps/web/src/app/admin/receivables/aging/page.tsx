'use client';

import type { AgingReport, PaginationMeta } from '@warung/shared';
import Link from 'next/link';
import { type FormEvent, useCallback, useEffect, useState } from 'react';

import AdminGate from '@/components/admin/AdminGate';
import { adminPageRequest, type AdminSession, isAdminAuthError } from '@/lib/admin';
import { formatRupiah } from '@/lib/pos';
import {
  AGING_BUCKET_LABELS,
  formatPaginationLabel,
  formatReceivableDate,
  RECEIVABLE_PAGE_SIZE,
  todayInputValue,
} from '@/lib/receivables';

type AgingContentProps = {
  session: AdminSession;
  expireSession: (message?: string) => void;
};

function AgingContent({ session, expireSession }: AgingContentProps) {
  const [report, setReport] = useState<AgingReport | null>(null);
  const [meta, setMeta] = useState<PaginationMeta | null>(null);
  const [page, setPage] = useState(1);
  const [asOfInput, setAsOfInput] = useState(todayInputValue);
  const [asOf, setAsOf] = useState(asOfInput);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const handleError = useCallback(
    (err: unknown) => {
      if (isAdminAuthError(err)) {
        expireSession();
        return;
      }
      setError(err instanceof Error ? err.message : 'Gagal memuat laporan umur piutang');
    },
    [expireSession],
  );

  const load = useCallback(
    async (nextPage: number, nextAsOf: string) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          page: String(nextPage),
          pageSize: String(RECEIVABLE_PAGE_SIZE),
        });
        if (nextAsOf) {
          const asOfDate = new Date(`${nextAsOf}T23:59:59.999`);
          if (!Number.isNaN(asOfDate.getTime())) params.set('asOf', asOfDate.toISOString());
        }
        const result = await adminPageRequest<AgingReport>(
          session,
          `/debts/aging?${params.toString()}`,
        );
        setReport(result.data);
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
    void load(page, asOf);
  }, [asOf, load, page]);

  const handleFilter = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPage(1);
    setAsOf(asOfInput || todayInputValue());
  };

  const maxBucketAmount = report
    ? Math.max(...report.buckets.map((bucket) => bucket.amount), 1)
    : 1;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link
            href="/admin/receivables"
            className="text-sm font-medium text-[#5c7a5f] hover:underline"
          >
            Kembali ke daftar piutang
          </Link>
          <p className="mt-3 text-sm text-[#8a8f7d]">
            Sebaran sisa tagihan pelanggan berdasarkan umur jatuh tempo.
          </p>
        </div>
        <form onSubmit={handleFilter} className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor="aging-as-of" className="mb-1 block text-xs font-medium text-[#5c6b58]">
              Per tanggal
            </label>
            <input
              id="aging-as-of"
              type="date"
              value={asOfInput}
              onChange={(event) => setAsOfInput(event.target.value)}
              className="rounded-xl border border-[#e6ddc8] bg-white px-3 py-2 text-sm text-[#26332a] focus:border-[#5c7a5f] focus:outline-none focus:ring-2 focus:ring-[#7fa083]/30"
              required
            />
          </div>
          <button
            type="submit"
            className="rounded-xl bg-[#5c7a5f] px-5 py-2 text-sm font-semibold text-white transition hover:bg-[#4c6b4f]"
          >
            Tampilkan
          </button>
        </form>
      </div>

      <div className="rounded-xl border border-[#d8e3d2] bg-[#eef4ea] px-4 py-3 text-sm text-[#3f5d43]">
        Laporan dihitung dari sisa tagihan saat ini pada tanggal acuan, bukan rekonstruksi saldo
        historis. Pelunasan yang terjadi setelah tanggal acuan tetap terlihat pada data sekarang.
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="rounded-2xl border border-[#e6ddc8] bg-white p-8 text-center text-sm text-[#8a8f7d]">
          Memuat laporan umur piutang...
        </div>
      ) : report ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <div className="rounded-2xl border border-[#e6ddc8] bg-white p-5 shadow-sm sm:col-span-2 xl:col-span-1">
              <p className="text-sm font-medium text-[#8a8f7d]">Total piutang</p>
              <p className="mt-2 text-3xl font-bold tracking-tight text-[#26332a]">
                {formatRupiah(report.total)}
              </p>
              <p className="mt-1 text-xs text-[#8a8f7d]">Per {formatReceivableDate(report.asOf)}</p>
            </div>
            {report.buckets.map((bucket) => (
              <div
                key={bucket.key}
                className="rounded-2xl border border-[#e6ddc8] bg-white p-5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-[#8a8f7d]">
                    {AGING_BUCKET_LABELS[bucket.key] ?? bucket.label}
                  </p>
                  <p className="text-xs text-[#8a8f7d]">{bucket.invoiceCount} invoice</p>
                </div>
                <p className="mt-2 text-xl font-bold tracking-tight text-[#26332a]">
                  {formatRupiah(bucket.amount)}
                </p>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#faf6ee]">
                  <div
                    className="h-full rounded-full bg-[#7fa083]"
                    style={{ width: `${Math.round((bucket.amount / maxBucketAmount) * 100)}%` }}
                  />
                </div>
                <p className="mt-2 text-xs text-[#8a8f7d]">
                  {bucket.customerCount} pelanggan pada bucket ini
                </p>
              </div>
            ))}
          </div>

          <section className="rounded-2xl border border-[#e6ddc8] bg-white shadow-sm">
            <div className="flex flex-col gap-1 border-b border-[#e6ddc8] px-4 py-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h3 className="text-lg font-bold text-[#26332a]">Pelanggan Terbesar</h3>
                <p className="text-sm text-[#8a8f7d]">
                  Diurutkan berdasarkan sisa tagihan pada tanggal acuan.
                </p>
              </div>
              <p className="text-xs text-[#8a8f7d]">{meta ? formatPaginationLabel(meta) : ''}</p>
            </div>

            {report.topDebtors.length === 0 ? (
              <div className="p-8 text-center text-sm text-[#8a8f7d]">
                Tidak ada piutang pada tanggal ini.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-[#e6ddc8] text-xs uppercase tracking-wide text-[#8a8f7d]">
                      <th className="px-4 py-3 font-medium">Pelanggan</th>
                      <th className="px-4 py-3 font-medium">Sisa Tagihan</th>
                      <th className="px-4 py-3 font-medium">Umur Tertua</th>
                      <th className="px-4 py-3 text-right font-medium">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#eee6d5]">
                    {report.topDebtors.map((debtor) => (
                      <tr key={debtor.customerId} className="align-top">
                        <td className="px-4 py-3">
                          <p className="font-semibold text-[#26332a]">{debtor.customerName}</p>
                          <p className="mt-0.5 text-xs text-[#8a8f7d]">{debtor.customerPhone}</p>
                        </td>
                        <td className="px-4 py-3 font-semibold text-[#26332a]">
                          {formatRupiah(debtor.balanceDue)}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={
                              debtor.oldestDays > 0 ? 'font-medium text-red-600' : 'text-[#5c6b58]'
                            }
                          >
                            {debtor.oldestDays > 0
                              ? `${debtor.oldestDays} hari`
                              : 'Belum jatuh tempo'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end">
                            <Link
                              href={`/admin/receivables/${debtor.customerId}`}
                              className="rounded-lg border border-[#e6ddc8] px-3 py-1.5 text-xs font-medium text-[#5c7a5f] transition hover:bg-[#faf6ee]"
                            >
                              Lihat Detail
                            </Link>
                          </div>
                        </td>
                      </tr>
                    ))}
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
          </section>
        </>
      ) : null}
    </div>
  );
}

export default function AgingPage() {
  return (
    <AdminGate
      title="Umur Piutang"
      description="Lihat sebaran piutang berdasarkan jatuh tempo dan pelanggan terbesar."
    >
      {({ session, expireSession }) => (
        <AgingContent session={session} expireSession={expireSession} />
      )}
    </AdminGate>
  );
}
