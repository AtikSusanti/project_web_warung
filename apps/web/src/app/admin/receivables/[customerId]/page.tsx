'use client';

import type { CustomerDebtDetail, PayDebtResult } from '@warung/shared';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import AdminGate from '@/components/admin/AdminGate';
import {
  AdminApiError,
  adminRequest,
  type AdminSession,
  formatMoneyInput,
  isAdminAuthError,
  RECEIVABLE_ROLES,
} from '@/lib/admin';
import { createIdempotencyKey, formatRupiah, parseCashInput } from '@/lib/pos';
import {
  AGING_BUCKET_LABELS,
  AGING_BUCKET_ORDER,
  agingBucketLabel,
  formatOverdueDays,
  formatReceivableDate,
  formatReceivableDateTime,
} from '@/lib/receivables';

type CustomerDebtsContentProps = {
  session: AdminSession;
  expireSession: (message?: string) => void;
  customerId: string;
};

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-[#e6ddc8] bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-[#8a8f7d]">{label}</p>
      <p className="mt-2 text-2xl font-bold tracking-tight text-[#26332a]">{value}</p>
      {hint && <p className="mt-1 text-xs text-[#8a8f7d]">{hint}</p>}
    </div>
  );
}

const PAYMENT_METHOD_LABELS = {
  CASH: 'Tunai',
  TRANSFER: 'Transfer',
  QRIS: 'QRIS',
} as const;

type DebtPaymentDialogProps = {
  session: AdminSession;
  expireSession: (message?: string) => void;
  customerId: string;
  customerName: string;
  balanceDue: number;
  onPaid: (result: PayDebtResult) => void;
  onClose: () => void;
};

function DebtPaymentDialog({
  session,
  expireSession,
  customerId,
  customerName,
  balanceDue,
  onPaid,
  onClose,
}: DebtPaymentDialogProps) {
  const [amountInput, setAmountInput] = useState(() => formatMoneyInput(balanceDue));
  const [method, setMethod] = useState<'CASH' | 'TRANSFER'>('CASH');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(() => createIdempotencyKey());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idempotencyConflict, setIdempotencyConflict] = useState(false);
  const [result, setResult] = useState<PayDebtResult | null>(null);

  const amount = parseCashInput(amountInput);
  const amountError =
    amountInput.trim() === ''
      ? 'Nominal pembayaran wajib diisi.'
      : amount === null
        ? 'Nominal pembayaran tidak valid.'
        : amount <= 0
          ? 'Nominal pembayaran harus lebih besar dari nol.'
          : amount > balanceDue
            ? `Nominal melebihi sisa tagihan ${formatRupiah(balanceDue)}.`
            : null;
  const referenceError =
    method !== 'CASH' && reference.trim().length === 0 ? 'Referensi transfer wajib diisi.' : null;
  const remainingAfter = amount !== null && amount > 0 ? balanceDue - amount : null;
  const canSubmit = !submitting && amountError === null && referenceError === null;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting || result) return;
    if (amount === null || amountError !== null) {
      setError(amountError ?? 'Nominal pembayaran tidak valid.');
      return;
    }
    if (referenceError !== null) {
      setError(referenceError);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        customerId,
        amount,
        method,
        idempotencyKey,
      };
      const trimmedReference = reference.trim();
      const trimmedNote = note.trim();
      if (trimmedReference) payload.reference = trimmedReference;
      if (trimmedNote) payload.note = trimmedNote;

      const payment = await adminRequest<PayDebtResult>(session, '/debts/pay', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setResult(payment);
      onPaid(payment);
    } catch (err) {
      if (isAdminAuthError(err)) {
        expireSession();
        return;
      }
      if (err instanceof AdminApiError && err.code === 'IDEMPOTENCY_MISMATCH') {
        setIdempotencyConflict(true);
        setError(null);
        return;
      }
      setError(err instanceof Error ? err.message : 'Gagal menyimpan pembayaran cicilan');
    } finally {
      setSubmitting(false);
    }
  };

  if (result) {
    return (
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="debt-payment-success-title"
          className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
        >
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
          <h2
            id="debt-payment-success-title"
            className="mt-3 text-center text-xl font-bold text-[#26332a]"
          >
            Pembayaran cicilan tersimpan
          </h2>
          <p className="mt-1 text-center text-sm text-[#8a8f7d]">
            Pembayaran {customerName} telah dialokasikan otomatis ke tagihan paling lama.
          </p>

          <div className="mt-4 space-y-2 rounded-xl bg-[#faf6ee] p-4 text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-[#8a8f7d]">Nominal</span>
              <span className="font-bold text-[#26332a]">
                {formatRupiah(result.payment.amount)}
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-[#8a8f7d]">Metode</span>
              <span className="text-[#26332a]">
                {result.payment.method === 'CASH' ? 'Tunai' : 'Transfer'}
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-[#8a8f7d]">Sisa sebelumnya</span>
              <span className="text-[#26332a]">{formatRupiah(result.payment.balanceBefore)}</span>
            </div>
            <div className="flex justify-between gap-3 border-t border-[#e6ddc8] pt-2">
              <span className="font-medium text-[#26332a]">Sisa setelah bayar</span>
              <span className="font-bold text-[#3f5d43]">
                {formatRupiah(result.payment.balanceAfter)}
              </span>
            </div>
            <p className="text-xs text-[#8a8f7d]">
              Waktu {formatReceivableDateTime(result.payment.paidAt)}
            </p>
            {result.settledInvoiceNos.length > 0 && (
              <p className="rounded-lg bg-green-50 px-2.5 py-2 text-xs text-green-800">
                Invoice lunas: {result.settledInvoiceNos.join(', ')}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="mt-5 w-full rounded-xl bg-[#5c7a5f] py-3 font-semibold text-white transition hover:bg-[#4c6b4f]"
          >
            Selesai
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
      <form
        onSubmit={handleSubmit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="debt-payment-title"
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="debt-payment-title" className="text-xl font-bold tracking-tight text-[#26332a]">
              Bayar Cicilan
            </h2>
            <p className="mt-1 text-sm text-[#8a8f7d]">{customerName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg px-2 py-1 text-sm font-semibold text-[#8a8f7d] hover:bg-[#faf6ee] disabled:opacity-50"
          >
            Tutup
          </button>
        </div>

        <div className="mt-4 flex items-center justify-between rounded-xl bg-[#faf6ee] p-4">
          <span className="text-sm text-[#8a8f7d]">Sisa tagihan</span>
          <span className="text-lg font-bold text-[#26332a]">{formatRupiah(balanceDue)}</span>
        </div>

        <div className="mt-4">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="debt-amount" className="text-sm font-medium text-[#8a8f7d]">
              Nominal pembayaran (Rp)
            </label>
            <button
              type="button"
              onClick={() => {
                setAmountInput(formatMoneyInput(balanceDue));
                setError(null);
              }}
              className="text-xs font-semibold text-[#5c7a5f] hover:underline"
            >
              Bayar penuh
            </button>
          </div>
          <input
            id="debt-amount"
            type="text"
            inputMode="numeric"
            value={amountInput}
            onChange={(event) => {
              setAmountInput(event.target.value);
              setError(null);
            }}
            className="mt-1 w-full rounded-xl border border-[#e6ddc8] bg-[#faf6ee] px-3 py-2.5 text-right font-semibold text-[#26332a] focus:border-[#7fa083] focus:outline-none focus:ring-2 focus:ring-[#7fa083]/30"
          />
          {amountError && <p className="mt-1 text-xs text-red-700">{amountError}</p>}
          {remainingAfter !== null && !amountError && (
            <p className="mt-1 text-xs text-[#8a8f7d]">
              Sisa setelah pembayaran: {formatRupiah(remainingAfter)}
            </p>
          )}
        </div>

        <fieldset className="mt-4">
          <legend className="text-sm font-medium text-[#8a8f7d]">Metode pembayaran</legend>
          <div className="mt-1 grid grid-cols-2 gap-2">
            {(['CASH', 'TRANSFER'] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setMethod(value);
                  setError(null);
                }}
                className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${
                  method === value
                    ? 'border-[#5c7a5f] bg-[#eef4ea] text-[#3f5d43]'
                    : 'border-[#e6ddc8] text-[#5c6b58] hover:bg-[#faf6ee]'
                }`}
              >
                {value === 'CASH' ? 'Tunai' : 'Transfer'}
              </button>
            ))}
          </div>
        </fieldset>

        {method === 'TRANSFER' && (
          <div className="mt-4">
            <label
              htmlFor="debt-reference"
              className="mb-1 block text-sm font-medium text-[#8a8f7d]"
            >
              Referensi transfer
            </label>
            <input
              id="debt-reference"
              type="text"
              value={reference}
              onChange={(event) => {
                setReference(event.target.value.slice(0, 120));
                setError(null);
              }}
              placeholder="Contoh: TRX-BCA-001"
              className="w-full rounded-xl border border-[#e6ddc8] bg-[#faf6ee] px-3 py-2.5 text-sm text-[#26332a] placeholder:text-[#8a8f7d] focus:border-[#7fa083] focus:outline-none"
            />
            {referenceError && <p className="mt-1 text-xs text-red-700">{referenceError}</p>}
          </div>
        )}

        <div className="mt-4">
          <label htmlFor="debt-note" className="mb-1 block text-sm font-medium text-[#8a8f7d]">
            Catatan (opsional)
          </label>
          <textarea
            id="debt-note"
            value={note}
            onChange={(event) => {
              setNote(event.target.value.slice(0, 500));
              setError(null);
            }}
            rows={2}
            placeholder="Contoh: cicilan pertama"
            className="w-full resize-none rounded-xl border border-[#e6ddc8] bg-[#faf6ee] px-3 py-2 text-sm text-[#26332a] placeholder:text-[#8a8f7d] focus:border-[#7fa083] focus:outline-none"
          />
        </div>

        {idempotencyConflict && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <p className="font-semibold">Kunci pembayaran sudah dipakai untuk isi berbeda.</p>
            <p className="mt-1 text-xs">Periksa pembayaran sebelumnya. Jangan ulangi otomatis.</p>
            <button
              type="button"
              onClick={() => {
                setIdempotencyKey(createIdempotencyKey());
                setIdempotencyConflict(false);
                setError(null);
              }}
              className="mt-2 rounded-lg bg-red-700 px-3 py-1.5 text-xs font-semibold text-white"
            >
              Buat Kunci Pembayaran Baru
            </button>
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="flex-1 rounded-xl border border-[#e6ddc8] px-4 py-3 font-semibold text-[#5c6b58] transition hover:bg-[#faf6ee] disabled:opacity-50"
          >
            Batal
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="flex-1 rounded-xl bg-[#5c7a5f] px-4 py-3 font-semibold text-white transition hover:bg-[#4c6b4f] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Menyimpan…' : 'Simpan Pembayaran'}
          </button>
        </div>
        <p className="mt-2 text-center text-xs text-[#8a8f7d]">
          Pembayaran dialokasikan otomatis ke invoice paling lama. Kunci pembayaran dipertahankan
          bila koneksi gagal.
        </p>
      </form>
    </div>
  );
}

function CustomerDebtsContent({ session, expireSession, customerId }: CustomerDebtsContentProps) {
  const [detail, setDetail] = useState<CustomerDebtDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentCompleted, setPaymentCompleted] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await adminRequest<CustomerDebtDetail>(
        session,
        `/customers/${customerId}/debts`,
      );
      setDetail(result);
    } catch (err) {
      if (isAdminAuthError(err)) {
        expireSession();
        return;
      }
      setError(err instanceof Error ? err.message : 'Gagal memuat detail piutang pelanggan');
    } finally {
      setLoading(false);
    }
  }, [customerId, expireSession, session]);

  useEffect(() => {
    void load();
  }, [load]);

  const closePayment = () => {
    setPaymentOpen(false);
    if (paymentCompleted) {
      setPaymentCompleted(false);
      void load();
    }
  };

  if (loading) {
    return (
      <div className="rounded-2xl border border-[#e6ddc8] bg-white p-8 text-center text-sm text-[#8a8f7d]">
        Memuat detail piutang...
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="space-y-4">
        <Link
          href="/admin/receivables"
          className="inline-block text-sm font-medium text-[#5c7a5f] hover:underline"
        >
          Kembali ke daftar piutang
        </Link>
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error ?? 'Data piutang pelanggan tidak ditemukan.'}
        </div>
      </div>
    );
  }

  const { customer, aging, outstanding, invoices, payments } = detail;
  const totalPaid = invoices.reduce((total, invoice) => total + invoice.paidAmount, 0);
  const totalOutstanding = invoices.reduce(
    (total, invoice) => total + invoice.outstandingAmount,
    0,
  );

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
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <h2 className="text-2xl font-bold tracking-tight text-[#26332a]">{customer.name}</h2>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                customer.status === 'BLOCKED'
                  ? 'bg-red-100 text-red-700'
                  : 'bg-green-100 text-green-700'
              }`}
            >
              {customer.status === 'BLOCKED' ? 'Diblokir' : 'Aktif'}
            </span>
          </div>
          <p className="mt-1 text-sm text-[#8a8f7d]">
            {customer.phone}
            {customer.address ? ` - ${customer.address}` : ''}
          </p>
          {customer.note && (
            <p className="mt-2 max-w-2xl rounded-xl bg-white/70 px-3 py-2 text-xs text-[#5c6b58]">
              Catatan: {customer.note}
            </p>
          )}
        </div>
        <div className="text-left sm:text-right">
          <p className="text-xs uppercase tracking-wide text-[#8a8f7d]">Transaksi terakhir</p>
          <p className="mt-1 text-sm font-medium text-[#26332a]">
            {formatReceivableDateTime(customer.lastTransactionAt)}
          </p>
          <p className="mt-1 text-xs text-[#8a8f7d]">
            {customer.transactionCount} transaksi selesai
          </p>
          <button
            type="button"
            onClick={() => {
              setPaymentCompleted(false);
              setPaymentOpen(true);
            }}
            disabled={customer.balanceDue <= 0}
            className="mt-3 rounded-xl bg-[#5c7a5f] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#4c6b4f] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Bayar Cicilan
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Sisa tagihan"
          value={formatRupiah(customer.balanceDue)}
          hint={`${outstanding.length} invoice aktif`}
        />
        <StatCard
          label="Lewat jatuh tempo"
          value={formatRupiah(customer.overdueAmount)}
          hint={formatOverdueDays(customer.overdueDays)}
        />
        <StatCard
          label="Limit kredit"
          value={customer.creditLimit > 0 ? formatRupiah(customer.creditLimit) : 'Tanpa limit'}
          hint={customer.creditLimit > 0 ? 'Batas kredit pelanggan' : 'Tidak dibatasi limit'}
        />
        <StatCard
          label="Sisa limit"
          value={customer.creditLimit > 0 ? formatRupiah(customer.availableCredit) : '-'}
          hint={
            customer.creditLimit > 0 ? 'Limit dikurangi sisa tagihan' : 'Tidak ada limit kredit'
          }
        />
      </div>

      <section className="rounded-2xl border border-[#e6ddc8] bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="text-lg font-bold text-[#26332a]">Umur Piutang</h3>
            <p className="text-sm text-[#8a8f7d]">Sebaran sisa tagihan berdasarkan jatuh tempo.</p>
          </div>
          <p className="text-sm font-semibold text-[#26332a]">
            Total {formatRupiah(customer.balanceDue)}
          </p>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          {AGING_BUCKET_ORDER.map((bucket) => (
            <div key={bucket} className="rounded-xl border border-[#eee6d5] bg-[#faf6ee] p-3">
              <p className="text-xs font-medium text-[#8a8f7d]">{AGING_BUCKET_LABELS[bucket]}</p>
              <p className="mt-1 text-lg font-bold text-[#26332a]">{formatRupiah(aging[bucket])}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="text-lg font-bold text-[#26332a]">Invoice</h3>
            <p className="text-sm text-[#8a8f7d]">
              Diurutkan dari transaksi paling lama, termasuk invoice yang sudah lunas. Total dibayar{' '}
              {formatRupiah(totalPaid)}.
            </p>
          </div>
          <p className="text-sm font-semibold text-[#26332a]">
            Sisa {formatRupiah(totalOutstanding)}
          </p>
        </div>

        {invoices.length === 0 ? (
          <div className="rounded-2xl border border-[#e6ddc8] bg-white p-8 text-center text-sm text-[#8a8f7d]">
            Belum ada invoice untuk pelanggan ini.
          </div>
        ) : (
          <div className="space-y-3">
            {invoices.map((invoice) => (
              <article
                key={invoice.transactionId}
                className="rounded-2xl border border-[#e6ddc8] bg-white p-5 shadow-sm"
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-[#26332a]">{invoice.invoiceNo}</p>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          invoice.status === 'PAID'
                            ? 'bg-green-100 text-green-700'
                            : invoice.status === 'PARTIAL'
                              ? 'bg-blue-100 text-blue-700'
                              : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {invoice.status === 'PAID'
                          ? 'Lunas'
                          : invoice.status === 'PARTIAL'
                            ? 'Sebagian'
                            : 'Belum bayar'}
                      </span>
                      {invoice.status !== 'PAID' && (
                        <span className="rounded-full bg-[#faf6ee] px-2 py-0.5 text-[11px] font-medium text-[#5c6b58]">
                          {agingBucketLabel(invoice.agingBucket)}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-[#8a8f7d]">
                      Transaksi {formatReceivableDate(invoice.transactionDate)} - Jatuh tempo{' '}
                      {formatReceivableDate(invoice.dueDate)}
                    </p>
                  </div>
                  <div className="text-left lg:text-right">
                    <p className="text-xs text-[#8a8f7d]">Sisa tagihan</p>
                    <p className="text-xl font-bold text-[#26332a]">
                      {formatRupiah(invoice.outstandingAmount)}
                    </p>
                    <p className="text-xs text-[#8a8f7d]">
                      {invoice.status === 'PAID'
                        ? 'Lunas'
                        : invoice.daysOverdue > 0
                          ? `Lewat ${formatOverdueDays(invoice.daysOverdue)}`
                          : 'Belum jatuh tempo'}
                    </p>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 rounded-xl bg-[#faf6ee] p-3 text-sm sm:grid-cols-3">
                  <div>
                    <p className="text-xs text-[#8a8f7d]">Total invoice</p>
                    <p className="mt-0.5 font-medium text-[#26332a]">
                      {formatRupiah(invoice.total)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-[#8a8f7d]">Sudah dibayar</p>
                    <p className="mt-0.5 font-medium text-[#26332a]">
                      {formatRupiah(invoice.paidAmount)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-[#8a8f7d]">Sisa tagihan</p>
                    <p className="mt-0.5 font-medium text-[#26332a]">
                      {formatRupiah(invoice.outstandingAmount)}
                    </p>
                  </div>
                </div>

                <details className="mt-3 rounded-xl border border-[#eee6d5]">
                  <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-[#5c7a5f]">
                    Rincian item ({invoice.items.length})
                  </summary>
                  <div className="overflow-x-auto border-t border-[#eee6d5]">
                    <table className="w-full min-w-[520px] text-left text-sm">
                      <thead>
                        <tr className="text-xs uppercase tracking-wide text-[#8a8f7d]">
                          <th className="px-3 py-2 font-medium">Produk</th>
                          <th className="px-3 py-2 font-medium">Qty</th>
                          <th className="px-3 py-2 font-medium">Harga</th>
                          <th className="px-3 py-2 text-right font-medium">Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#eee6d5]">
                        {invoice.items.map((item, index) => (
                          <tr key={`${invoice.transactionId}-${index}`}>
                            <td className="px-3 py-2 text-[#26332a]">{item.productName}</td>
                            <td className="px-3 py-2 text-[#5c6b58]">{item.qty}</td>
                            <td className="px-3 py-2 text-[#5c6b58]">
                              {formatRupiah(item.unitPrice)}
                            </td>
                            <td className="px-3 py-2 text-right font-medium text-[#26332a]">
                              {formatRupiah(item.totalAmount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-[#e6ddc8] bg-white p-5 shadow-sm">
        <div>
          <h3 className="text-lg font-bold text-[#26332a]">Riwayat Cicilan</h3>
          <p className="text-sm text-[#8a8f7d]">
            Pembayaran utang yang tercatat, diurutkan dari yang terbaru.
          </p>
        </div>

        {payments.length === 0 ? (
          <div className="mt-4 rounded-xl bg-[#faf6ee] p-6 text-center text-sm text-[#8a8f7d]">
            Belum ada riwayat cicilan.
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-[#8a8f7d]">
                  <th className="px-3 py-2 font-medium">Tanggal</th>
                  <th className="px-3 py-2 font-medium">Nominal</th>
                  <th className="px-3 py-2 font-medium">Metode</th>
                  <th className="px-3 py-2 font-medium">Referensi / catatan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#eee6d5]">
                {payments.map((payment) => (
                  <tr key={payment.id}>
                    <td className="px-3 py-3 text-[#5c6b58]">
                      {formatReceivableDateTime(payment.paidAt)}
                    </td>
                    <td className="px-3 py-3 font-semibold text-[#26332a]">
                      {formatRupiah(payment.amount)}
                    </td>
                    <td className="px-3 py-3 text-[#5c6b58]">
                      {PAYMENT_METHOD_LABELS[payment.method]}
                    </td>
                    <td className="px-3 py-3 text-[#5c6b58]">
                      {[payment.reference, payment.note].filter(Boolean).join(' - ') || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {paymentOpen && (
        <DebtPaymentDialog
          session={session}
          expireSession={expireSession}
          customerId={customer.id}
          customerName={customer.name}
          balanceDue={customer.balanceDue}
          onPaid={() => setPaymentCompleted(true)}
          onClose={closePayment}
        />
      )}
    </div>
  );
}

export default function CustomerDebtsPage() {
  const params = useParams<{ customerId: string }>();
  const customerId = params.customerId;

  return (
    <AdminGate
      title="Detail Piutang Pelanggan"
      description="Rincian invoice, umur piutang, dan sisa tagihan pelanggan."
      allowedRoles={RECEIVABLE_ROLES}
    >
      {({ session, expireSession }) => (
        <CustomerDebtsContent
          session={session}
          expireSession={expireSession}
          customerId={customerId}
        />
      )}
    </AdminGate>
  );
}
