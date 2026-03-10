import { BillingPlan } from '@prisma/client';

export function addOneMonth(from: Date): Date {
  const d = new Date(from);
  d.setMonth(d.getMonth() + 1);
  return d;
}

// Keyingi 1-Sentябр (yangi o'quv yili boshlanishi)
export function nextSep1(from: Date): Date {
  const y = from.getFullYear();
  const sep1ThisYear = new Date(y, 8, 1, 0, 0, 0, 0);
  return from < sep1ThisYear ? sep1ThisYear : new Date(y + 1, 8, 1, 0, 0, 0, 0);
}

// Keyingi 25-May (maktab yili tugashi)
export function nextMay25(from: Date): Date {
  const y = from.getFullYear();
  const may25 = new Date(y, 4, 25, 0, 0, 0, 0);
  return from < may25 ? may25 : new Date(y + 1, 4, 25, 0, 0, 0, 0);
}

// billingPaidUntil yangilash (to'lov qilingandan keyin)
export function computeNextPaidUntil(plan: BillingPlan, start: Date): Date {
  return plan === BillingPlan.YEARLY ? nextSep1(start) : addOneMonth(start);
}

/**
 * Normalized periodKey:
 *   MONTHLY → "YYYY-MM"         masalan: "2026-03"
 *   YEARLY  → "YYYY-YYYY"       masalan: "2025-2026" (o'quv yili)
 *
 * Bir xil format har doim ishlatiladi — ROLLING_DUE va FIXED_PERIOD uchun ham.
 */
export function makePeriodKey(plan: BillingPlan, date: Date): string {
  if (plan === BillingPlan.MONTHLY) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }

  // YEARLY → o'quv yili: Sentябрь-Avgust
  // Sep(8)..Dec(11) → shu yil boshlanadi, masalan: Sep 2025 → "2025-2026"
  // Jan(0)..Aug(7)  → o'tgan yil boshlanadi, masalan: Mar 2026 → "2025-2026"
  const month = date.getMonth();
  const startYear = month >= 8 ? date.getFullYear() : date.getFullYear() - 1;
  return `${startYear}-${startYear + 1}`;
}

/**
 * Joriy oy uchun MONTHLY periodKey qaytaradi.
 * YEARLY conflict tekshirish uchun ishlatiladi.
 */
export function currentMonthKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function toIntAmount(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n));
}
