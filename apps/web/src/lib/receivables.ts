import type { PaginationMeta } from '@warung/shared';

export const RECEIVABLE_PAGE_SIZE = 20;

export const AGING_BUCKET_ORDER = ['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'] as const;

export const AGING_BUCKET_LABELS: Record<string, string> = {
  current: 'Belum jatuh tempo',
  d1_30: '1-30 hari',
  d31_60: '31-60 hari',
  d61_90: '61-90 hari',
  d90_plus: 'Lebih dari 90 hari',
};

export function agingBucketLabel(key: string): string {
  return AGING_BUCKET_LABELS[key] ?? key;
}

export function formatReceivableDate(value: string | null | undefined): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function formatReceivableDateTime(value: string | null | undefined): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatOverdueDays(days: number | null | undefined): string {
  if (days === null || days === undefined) return '-';
  if (days <= 0) return 'Belum jatuh tempo';
  return `${days} hari`;
}

export function formatPaginationLabel(meta: PaginationMeta | null): string {
  if (!meta || meta.total === 0) return '0 data';
  return `${meta.total.toLocaleString('id-ID')} data, halaman ${meta.page} dari ${Math.max(1, meta.totalPages)}`;
}

export function todayInputValue(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
