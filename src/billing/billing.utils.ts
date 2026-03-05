import { BillingPlan } from '@prisma/client';

export function addOneMonth(from: Date): Date {
  const d = new Date(from);
  d.setMonth(d.getMonth() + 1);
  return d;
}

export function nextSep1(from: Date): Date {
  const y = from.getFullYear();
  const sep1ThisYear = new Date(y, 8, 1, 0, 0, 0, 0);
  return from < sep1ThisYear ? sep1ThisYear : new Date(y + 1, 8, 1, 0, 0, 0, 0);
}

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