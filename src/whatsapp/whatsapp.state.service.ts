import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

// ─────────────────────────────────────────────────────────
// STATE TYPES
// ─────────────────────────────────────────────────────────
export type WaState =
  | 'START'
  | 'WAITING_PHONE'
  | 'SELECT_CHILD'
  | 'SELECT_PLAN'
  | 'CONFIRM_PAYMENT'
  | 'VERIFIED';

export interface WaChild {
  studentId: string;
  name: string;
  grade: string;
  plan: string;           // MONTHLY | YEARLY
  amount: number;
  billingPaidUntil: string | null;
}

export interface WaSession {
  state: WaState;
  phone?: string;           // verified parent phone (DB da)
  pendingPhone?: string;    // OTP jarayonida tasdiqlash kutilayotgan telefon raqami
  parentId?: string;
  children?: WaChild[];
  selectedStudentId?: string;
  selectedPlan?: 'MONTHLY' | 'YEARLY';
  selectedAmount?: number;
  selectedPeriodKey?: string;
  pendingPaymentId?: string;
  updatedAt: string;
}

const SESSION_PREFIX = 'wa:session:';
const SESSION_TTL = 60 * 60; // 1 soat (seconds)

@Injectable()
export class WhatsappStateService {
  private readonly logger = new Logger(WhatsappStateService.name);

  constructor(private readonly redis: RedisService) {}

  // ─────────────────────────────────────────────────────────
  // GET SESSION
  // ─────────────────────────────────────────────────────────
  async get(phone: string): Promise<WaSession | null> {
    try {
      const raw = await this.redis.getCache(`${SESSION_PREFIX}${phone}`);
      return (raw as WaSession) ?? null;
    } catch (err: any) {
      this.logger.warn(`get session error [${phone}]: ${err?.message}`);
      return null;
    }
  }

  // ─────────────────────────────────────────────────────────
  // UPDATE SESSION (merge)
  // ─────────────────────────────────────────────────────────
  async update(phone: string, partial: Partial<WaSession>): Promise<WaSession> {
    const existing = (await this.get(phone)) ?? ({} as WaSession);
    const updated: WaSession = {
      ...existing,
      ...partial,
      updatedAt: new Date().toISOString(),
    };
    await this.redis.setCache(`${SESSION_PREFIX}${phone}`, updated, SESSION_TTL);
    this.logger.debug(`session [${phone}] → ${updated.state}`);
    return updated;
  }

  // ─────────────────────────────────────────────────────────
  // SET STATE ONLY (shorthand)
  // ─────────────────────────────────────────────────────────
  async setState(phone: string, state: WaState): Promise<void> {
    await this.update(phone, { state });
  }

  // ─────────────────────────────────────────────────────────
  // RESET (logout / /start)
  // ─────────────────────────────────────────────────────────
  async reset(phone: string): Promise<void> {
    try {
      await this.redis.del(`${SESSION_PREFIX}${phone}`);
      this.logger.log(`session reset [${phone}]`);
    } catch (err: any) {
      this.logger.warn(`reset session error [${phone}]: ${err?.message}`);
    }
  }

  // ─────────────────────────────────────────────────────────
  // REFRESH TTL (faol foydalanuvchi uchun)
  // ─────────────────────────────────────────────────────────
  async touch(phone: string): Promise<void> {
    const session = await this.get(phone);
    if (session) {
      await this.redis.setCache(`${SESSION_PREFIX}${phone}`, session, SESSION_TTL);
    }
  }

  // ─────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────
  isVerified(session: WaSession | null): boolean {
    return !!(
      session?.parentId &&
      session.state !== 'WAITING_PHONE' &&
      session.state !== 'START'
    );
  }

  isInPaymentFlow(session: WaSession | null): boolean {
    return ['SELECT_CHILD', 'SELECT_PLAN', 'CONFIRM_PAYMENT'].includes(session?.state ?? '');
  }
}