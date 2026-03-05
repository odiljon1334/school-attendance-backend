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
  const may25 = new Date(y, 4, 25, 0, 0, 0, 0); // 4 = May (0-indexed)
  return from < may25 ? may25 : new Date(y + 1, 4, 25, 0, 0, 0, 0);
}

// Period oxiri (periodKey uchun):
//   YEARLY  → keyingi 25-May (9 oylik maktab yili)
//   MONTHLY → +1 oy
export function computePeriodEnd(plan: BillingPlan, start: Date): Date {
  return plan === BillingPlan.YEARLY ? nextMay25(start) : addOneMonth(start);
}

// billingPaidUntil yangilash (to'lov qilingandan keyin):
//   YEARLY  → keyingi 1-Sentябр (yangi o'quv yili = keyingi billing davri)
//   MONTHLY → +1 oy
export function computeNextPaidUntil(plan: BillingPlan, start: Date): Date {
  return plan === BillingPlan.YEARLY ? nextSep1(start) : addOneMonth(start);
}

export function makePeriodKey(start: Date, end: Date): string {
  const s = start.toISOString().slice(0, 10);
  const e = end.toISOString().slice(0, 10);
  return `${s}..${e}`;
}

export function toIntAmount(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n));
}
