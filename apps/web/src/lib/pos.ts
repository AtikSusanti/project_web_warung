import {
  calculateCart,
  type CalculatedCart,
  DEFAULT_CASH_ROUNDING_STEP,
  MAX_SEN,
  parseIDR,
  type Sen,
  sen,
  settlePayments,
} from '@warung/shared';

export const API_BASE = 'http://localhost:3000/api/v1';
export const POS_SESSION_KEY = 'warung_admin_session';

export type PosRole = 'ADMIN' | 'CASHIER';

export type PosSession = {
  accessToken: string;
  refreshToken: string;
  role: PosRole;
  username: string;
};

export type PosProduct = {
  id: string;
  sku: string;
  name: string;
  priceSell: number;
  stockQty: number;
  unit: string;
  isActive: boolean;
  imageUrl: string | null;
  category: { name: string } | null;
};

export type PosCartLine = {
  productId: string;
  sku: string;
  name: string;
  unitPrice: number;
  qty: number;
  stockQty: number;
  unit: string;
  category: string;
};

export type PosCustomer = {
  id: string;
  name: string;
  phone: string;
  address: string | null;
  creditLimit: number;
  balanceDue: number;
  availableCredit: number;
  status: 'ACTIVE' | 'BLOCKED';
};

export type PosTransactionPayment = {
  method: 'CASH' | 'TRANSFER' | 'QRIS' | 'DEBT';
  amount: number;
  reference: string | null;
};

export type PosSettings = {
  taxBps: number;
  taxInclusive: boolean;
  enableCashRounding: boolean;
  cashRoundingStepSen: number;
};

export type PosTransaction = {
  id: string;
  invoiceNo: string;
  roundedTotal: number;
  paidTotal: number;
  changeAmount: number;
  outstandingAmount: number;
  customerId: string | null;
  customerName: string | null;
  dueDate: string | null;
  payments: PosTransactionPayment[];
  createdAt: string;
  cashierName: string;
  lines: Array<{
    id: string;
    productName: string;
    qty: number;
    unit: string;
    totalAmount: number;
  }>;
};

export type ApiErrorPayload = {
  code?: string;
  message?: string;
  details?: Record<string, unknown> | null;
};

export type ApiEnvelope<T> = {
  success: boolean;
  data: T | null;
  error: ApiErrorPayload | null;
};

export const DEFAULT_POS_SETTINGS: PosSettings = {
  taxBps: 1100,
  taxInclusive: true,
  enableCashRounding: false,
  cashRoundingStepSen: DEFAULT_CASH_ROUNDING_STEP,
};

export function isPosRole(role: string | undefined | null): role is PosRole {
  return role === 'ADMIN' || role === 'CASHIER';
}

export function decodeJwt(
  token: string,
): { role?: string; username?: string; exp?: number } | null {
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
    const parsed: unknown = JSON.parse(decoded);
    if (!parsed || typeof parsed !== 'object') return null;
    const data = parsed as Record<string, unknown>;
    return {
      role: typeof data.role === 'string' ? data.role : undefined,
      username: typeof data.username === 'string' ? data.username : undefined,
      exp: typeof data.exp === 'number' ? data.exp : undefined,
    };
  } catch {
    return null;
  }
}

export function loadPosSession(): PosSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(POS_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PosSession>;
    if (!parsed.accessToken || !parsed.refreshToken) return null;
    const payload = decodeJwt(parsed.accessToken);
    if (!payload || !isPosRole(payload.role)) return null;
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

export function savePosSession(session: PosSession): void {
  window.localStorage.setItem(POS_SESSION_KEY, JSON.stringify(session));
}

export function clearPosSession(): void {
  window.localStorage.removeItem(POS_SESSION_KEY);
}

export function formatRupiah(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'Rp —';
  return `Rp ${(value / 100).toLocaleString('id-ID', { maximumFractionDigits: 2 })}`;
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('id-ID', { dateStyle: 'medium' });
}

export function parseCashInput(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === '') return 0;
  try {
    const value = parseIDR(trimmed);
    if (value < 0 || value > MAX_SEN) return null;
    return value;
  } catch {
    return null;
  }
}

export type PosPaymentPlan = {
  payments: Array<{ method: 'CASH' | 'DEBT'; amount: number }>;
  debtAmount: number;
  paidTotal: number;
  change: number;
  shortfall: number;
  isSettled: boolean;
};

export function planPosPayments(
  total: number,
  cashAmount: number,
  allowDebt: boolean,
): PosPaymentPlan {
  const settlement = settlePayments(sen(total), [{ method: 'CASH', amount: sen(cashAmount) }]);
  const debtAmount = allowDebt ? settlement.shortfall : 0;
  const payments: Array<{ method: 'CASH' | 'DEBT'; amount: number }> = [];
  if (cashAmount > 0) payments.push({ method: 'CASH', amount: cashAmount });
  if (debtAmount > 0) payments.push({ method: 'DEBT', amount: debtAmount });

  return {
    payments,
    debtAmount,
    paidTotal: settlement.paidTotal,
    change: settlement.change,
    shortfall: settlement.shortfall,
    isSettled: settlement.isSettled || debtAmount > 0,
  };
}

export function getDetailText(
  details: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  if (!details) return null;
  const value = details[key];
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    return String(value[0]);
  }
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return null;
}

export function getDetailNumber(
  details: Record<string, unknown> | null | undefined,
  key: string,
): number | null {
  const text = getDetailText(details, key);
  if (text === null || text.trim() === '') return null;
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : null;
}

export function createIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `pos-${crypto.randomUUID()}`;
  }
  const random = Math.random().toString(36).slice(2, 12);
  return `pos-${Date.now().toString(36)}-${random}`;
}

export function normalizeSettings(raw: unknown): PosSettings {
  const data = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const taxBps = data.taxBps;
  const cashRoundingStepSen = data.cashRoundingStepSen;
  return {
    taxBps:
      typeof taxBps === 'number' && Number.isInteger(taxBps) && taxBps >= 0
        ? taxBps
        : DEFAULT_POS_SETTINGS.taxBps,
    taxInclusive:
      typeof data.taxInclusive === 'boolean'
        ? data.taxInclusive
        : DEFAULT_POS_SETTINGS.taxInclusive,
    enableCashRounding:
      typeof data.enableCashRounding === 'boolean'
        ? data.enableCashRounding
        : DEFAULT_POS_SETTINGS.enableCashRounding,
    cashRoundingStepSen:
      typeof cashRoundingStepSen === 'number' &&
      Number.isInteger(cashRoundingStepSen) &&
      cashRoundingStepSen > 0
        ? cashRoundingStepSen
        : DEFAULT_POS_SETTINGS.cashRoundingStepSen,
  };
}

export function calculatePosCart(
  lines: readonly PosCartLine[],
  settings: PosSettings,
): CalculatedCart {
  return calculateCart(
    lines.map((line) => ({
      productId: line.productId,
      sku: line.sku,
      name: line.name,
      qty: line.qty,
      unitPrice: sen(line.unitPrice),
    })),
    {
      taxBps: settings.taxBps,
      pricesIncludeTax: settings.taxInclusive,
      cashRounding: settings.enableCashRounding,
      cashRoundingStep: settings.cashRoundingStepSen,
    },
  );
}

export function asSen(value: number): Sen {
  return sen(value);
}
