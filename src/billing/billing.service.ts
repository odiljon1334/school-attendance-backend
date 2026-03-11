import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { Prisma, BillingPlan, PaymentStatus, PaymentWaiveReason } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { GenerateBillingDto, GenerateMode, GenerateStrategy } from './dto/generate-billing.dto';
import { computeNextPaidUntil, currentMonthKey, makePeriodKey, toIntAmount } from './billing.utils';

type StudentForBilling = {
  id: string;
  createdAt: Date;
  isLowIncome: boolean;
  billingPlan: BillingPlan;
  billingPaidUntil: Date | null;
  parents: Array<{
    parentId: string;
    isBillingPayer: boolean;
    createdAt: Date;
  }>;
};

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  // --------------------------
  // Config (env-driven)
  // --------------------------
  private getPlanAmount(plan: BillingPlan): number {
    const monthly = toIntAmount(process.env.BILLING_MONTHLY_AMOUNT ?? 12000);
    const yearly = toIntAmount(process.env.BILLING_YEARLY_AMOUNT ?? 80000);

    if (!monthly || !yearly) {
      throw new Error('Invalid BILLING_MONTHLY_AMOUNT / BILLING_YEARLY_AMOUNT');
    }
    return plan === BillingPlan.YEARLY ? yearly : monthly;
  }

  private validateFixedPeriodKey(plan: BillingPlan, periodKey?: string) {
    if (!periodKey) throw new BadRequestException('periodKey is required for FIXED_PERIOD');

    if (plan === BillingPlan.MONTHLY && !/^\d{4}-\d{2}$/.test(periodKey)) {
      throw new BadRequestException('MONTHLY periodKey must be "YYYY-MM"');
    }
    if (plan === BillingPlan.YEARLY && !/^\d{4}-\d{4}$/.test(periodKey)) {
      throw new BadRequestException('YEARLY periodKey must be "YYYY-YYYY" (e.g. "2025-2026")');
    }
  }

  private pickPayerId(s: StudentForBilling): string | null {
    const billing = s.parents.find((p) => p.isBillingPayer);
    if (billing) return billing.parentId;
    return s.parents[0]?.parentId ?? null;
  }

  // --------------------------
  // Main entry
  // --------------------------
  async generate(dto: GenerateBillingDto) {
    const mode = dto.mode ?? GenerateMode.SKIP_EXISTING;
    const sendNotifications = dto.sendNotifications ?? true;
    const strategy = dto.strategy ?? GenerateStrategy.ROLLING_DUE;

    // 1) Load students + parent links
    const students = (await this.prisma.student.findMany({
      where: { schoolId: dto.schoolId },
      select: {
        id: true,
        createdAt: true,
        isLowIncome: true,
        billingPlan: true,
        billingPaidUntil: true,
        parents: {
          select: { parentId: true, isBillingPayer: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'asc' },
    })) as unknown as StudentForBilling[];

    if (!students.length) {
      return { created: 0, updated: 0, skipped: 0, notified: 0, message: 'No students in this school' };
    }

    // 2) Decisions: low income + sibling rule (per payer)
    const decisions = new Map<string, { status: PaymentStatus; waiveReason?: PaymentWaiveReason }>();

    // low income -> waived
    for (const s of students) {
      if (s.isLowIncome) {
        decisions.set(s.id, { status: PaymentStatus.WAIVED, waiveReason: PaymentWaiveReason.LOW_INCOME });
      }
    }

    // payer groups (only non-lowIncome)
    const groups = new Map<string, StudentForBilling[]>();
    for (const s of students) {
      if (s.isLowIncome) continue;
      const payerId = this.pickPayerId(s);
      const key = payerId ?? `NO_PAYER:${s.id}`;
      const arr = groups.get(key) ?? [];
      arr.push(s);
      groups.set(key, arr);
    }

    // sibling: top2 pending, rest waived
    for (const [, list] of groups.entries()) {
      const sorted = [...list].sort((a, b) => {
        const t = a.createdAt.getTime() - b.createdAt.getTime();
        return t !== 0 ? t : a.id.localeCompare(b.id);
      });

      sorted.forEach((s, idx) => {
        if (decisions.has(s.id)) return; // lowIncome already
        if (idx < 2) decisions.set(s.id, { status: PaymentStatus.PENDING });
        else decisions.set(s.id, { status: PaymentStatus.WAIVED, waiveReason: PaymentWaiveReason.SIBLING_DISCOUNT });
      });
    }

    // 3) Dispatch strategy
    if (strategy === GenerateStrategy.FIXED_PERIOD) {
      if (!dto.plan) throw new BadRequestException('plan is required for FIXED_PERIOD strategy');
      const amount = this.getPlanAmount(dto.plan);
      this.validateFixedPeriodKey(dto.plan, dto.periodKey);
      return this.generateFixedPeriod({
        schoolId: dto.schoolId,
        plan: dto.plan,
        periodKey: dto.periodKey!,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : new Date(),
        amount,
        mode,
        decisions,
        sendNotifications,
      });
    }

    // default: rolling — har bir student o'z billingPlan idan foydalanadi
    return this.generateRollingDue({
      schoolId: dto.schoolId,
      mode,
      decisions,
      sendNotifications,
      daysBefore: dto.daysBefore ?? 3,
      students,
    });
  }

  // --------------------------
  // FIXED_PERIOD (admin manual)
  // --------------------------
  private async generateFixedPeriod(params: {
    schoolId: string;
    plan: BillingPlan;
    periodKey: string;
    dueDate: Date;
    amount: number;
    mode: GenerateMode;
    decisions: Map<string, { status: PaymentStatus; waiveReason?: PaymentWaiveReason }>;
    sendNotifications: boolean;
  }) {
    const { schoolId, plan, periodKey, dueDate, amount, mode, decisions, sendNotifications } = params;

    // Faqat o'z billingPlan'iga mos studentlar (MONTHLY plan → MONTHLY studentlar)
    const students = await this.prisma.student.findMany({
      where: { schoolId, billingPlan: plan },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });

    if (!students.length) {
      return { created: 0, updated: 0, skipped: 0, notified: 0, plan, periodKey, dueDate, amount, message: `No ${plan} students in this school` };
    }

    const studentIds = students.map(s => s.id);

    // ── MONTHLY conflict: shu o'quv yilida YEARLY record (PENDING/PAID) bormi? ──
    if (plan === BillingPlan.MONTHLY) {
      const academicYearKey = makePeriodKey(BillingPlan.YEARLY, dueDate);
      const yearlyConflicts = await this.prisma.payment.findMany({
        where: {
          studentId: { in: studentIds },
          plan: BillingPlan.YEARLY,
          periodKey: academicYearKey,
          status: { not: PaymentStatus.WAIVED },
        },
        select: { studentId: true },
      });
      if (yearlyConflicts.length > 0) {
        throw new ConflictException(
          `${yearlyConflicts.length} ta student uchun ${academicYearKey} o'quv yilida faol YEARLY record mavjud. ` +
          `Bu studentlar uchun MONTHLY billing yaratib bo'lmaydi.`,
        );
      }
    }

    // ── YEARLY conflict: shu oyda MONTHLY record (PENDING) bormi? ──────────────
    if (plan === BillingPlan.YEARLY) {
      const monthKey = currentMonthKey(dueDate);
      const monthlyConflicts = await this.prisma.payment.findMany({
        where: {
          studentId: { in: studentIds },
          plan: BillingPlan.MONTHLY,
          periodKey: monthKey,
          status: { not: PaymentStatus.PAID },
        },
        select: { studentId: true },
      });

      if (monthlyConflicts.length > 0) {
        throw new ConflictException(
          `${monthlyConflicts.length} ta student uchun ${monthKey} oyida to'lanmagan MONTHLY record mavjud. ` +
          `Avval ularni o'chirib, keyin YEARLY yarating.`,
        );
      }
    }

    // existing payments for idempotency
    const existing = await this.prisma.payment.findMany({
      where: { studentId: { in: studentIds }, plan, periodKey },
      select: { id: true, studentId: true, status: true },
    });
    const existingByStudent = new Map(existing.map((p) => [p.studentId, p]));

    const toCreate: Prisma.PaymentCreateManyInput[] = [];
    const toUpdate: Array<{ id: string; data: Prisma.PaymentUpdateInput }> = [];
    let skipped = 0;

    for (const s of students) {
      const d = decisions.get(s.id) ?? { status: PaymentStatus.PENDING };
      const ex = existingByStudent.get(s.id);

      const status = d.status;
      const waiveReason = status === PaymentStatus.WAIVED ? (d.waiveReason ?? PaymentWaiveReason.OTHER) : null;

      const base: Prisma.PaymentCreateManyInput = {
        studentId: s.id,
        plan,
        periodKey,
        amount: status === PaymentStatus.WAIVED ? 0 : amount,
        dueDate,
        status,
        waiveReason,
        waivedAt: status === PaymentStatus.WAIVED ? new Date() : null,
        paidDate: null,
      };

      if (!ex) {
        toCreate.push(base);
        continue;
      }

      if (mode === GenerateMode.SKIP_EXISTING) {
        skipped++;
        continue;
      }

      if (ex.status === PaymentStatus.PAID) {
        skipped++;
        continue;
      }

      toUpdate.push({
        id: ex.id,
        data: {
          amount: status === PaymentStatus.WAIVED ? 0 : amount,
          dueDate,
          status,
          waiveReason,
          waivedAt: status === PaymentStatus.WAIVED ? new Date() : null,
          ...(status === PaymentStatus.PENDING ? { waivedAt: null, waiveReason: null } : {}),
        },
      });
    }

    const affectedIds: string[] = [];
    let created = 0;
    let updated = 0;

    await this.prisma.$transaction(async (tx) => {
      if (toCreate.length) {
        const res = await tx.payment.createMany({ data: toCreate, skipDuplicates: true });
        created = res.count;

        // created ids fetch (only those keys)
        const createdRows = await tx.payment.findMany({
          where: { student: { schoolId }, plan, periodKey },
          select: { id: true, status: true },
        });
        affectedIds.push(...createdRows.map((x) => x.id));
      }

      if (toUpdate.length) {
        const chunkSize = 50;
        for (let i = 0; i < toUpdate.length; i += chunkSize) {
          const chunk = toUpdate.slice(i, i + chunkSize);
          await Promise.all(chunk.map((u) => tx.payment.update({ where: { id: u.id }, data: u.data })));
        }
        updated = toUpdate.length;
        affectedIds.push(...toUpdate.map((u) => u.id));
      }
    });

    let notified = 0;
    if (sendNotifications && affectedIds.length) {
      const res = await this.notifications.sendBillingInvoiceNotices(affectedIds, { plan, periodKey });
      notified = res.totalSent;
    }

    this.logger.log(`[FIXED] school=${schoolId} plan=${plan} periodKey=${periodKey} created=${created} updated=${updated} skipped=${skipped}`);

    return { created, updated, skipped, notified, plan, periodKey, dueDate, amount };
  }

  // --------------------------
  // ROLLING_DUE (recommended)
  // - billingPaidUntil yaqin bo'lsa invoice chiqaradi
  // - Har bir student o'z billingPlan (MONTHLY/YEARLY) idan foydalanadi
  // - periodKey = "YYYY-MM-DD..YYYY-MM-DD"
  // --------------------------
  private async generateRollingDue(params: {
    schoolId: string;
    mode: GenerateMode;
    decisions: Map<string, { status: PaymentStatus; waiveReason?: PaymentWaiveReason }>;
    sendNotifications: boolean;
    daysBefore: number;
    students: StudentForBilling[];
  }) {
    const { schoolId, mode, decisions, sendNotifications, daysBefore, students } = params;

    // YEARLY studentlar uchun kamida 14 kun oldin, MONTHLY uchun daysBefore
    const YEARLY_DAYS_BEFORE = Math.max(daysBefore, 14);
    const MONTHLY_DAYS_BEFORE = daysBefore;

    const now = new Date();

    // 1) Barcha studentlar — har biri o'z billingPlan'idan foydalanadi
    let created = 0;
    let updated = 0;
    let skipped = 0;

    const affectedIds: string[] = [];
    const toCreate: Prisma.PaymentCreateManyInput[] = [];
    const toUpdate: Array<{ id: string; data: Prisma.PaymentUpdateInput }> = [];

    // 2) Candidate'larni hisoblash — har student o'z plan va amount'i bilan
    const candidates: Array<{
      studentId: string;
      plan: BillingPlan;
      periodKey: string;
      dueDate: Date;
      status: PaymentStatus;
      waiveReason: PaymentWaiveReason | null;
      waivedAt: Date | null;
      amount: number;
    }> = [];

    const yearlyStudentIds = students
      .filter(s => (s.billingPlan ?? BillingPlan.MONTHLY) === BillingPlan.YEARLY)
      .map(s => s.id);
    const monthlyStudentIds = students
      .filter(s => (s.billingPlan ?? BillingPlan.MONTHLY) === BillingPlan.MONTHLY)
      .map(s => s.id);

    // YEARLY student → joriy oyda MONTHLY record bormi?
    const monthlyConflictIds = new Set<string>();
    if (yearlyStudentIds.length > 0) {
      const monthKey = currentMonthKey(now);
      const conflicts = await this.prisma.payment.findMany({
        where: {
          studentId: { in: yearlyStudentIds },
          plan: BillingPlan.MONTHLY,
          periodKey: monthKey,
          status: { not: PaymentStatus.PAID },
        },
        select: { studentId: true },
      });
      conflicts.forEach(c => monthlyConflictIds.add(c.studentId));
    }

    // MONTHLY student → joriy o'quv yilida faol YEARLY record bormi?
    const yearlyConflictIds = new Set<string>();
    if (monthlyStudentIds.length > 0) {
      const academicYearKey = makePeriodKey(BillingPlan.YEARLY, now);
      const conflicts = await this.prisma.payment.findMany({
        where: {
          studentId: { in: monthlyStudentIds },
          plan: BillingPlan.YEARLY,
          periodKey: academicYearKey,
          status: { not: PaymentStatus.WAIVED },
        },
        select: { studentId: true },
      });
      conflicts.forEach(c => yearlyConflictIds.add(c.studentId));
    }

    for (const s of students) {
      const paidUntil = s.billingPaidUntil;
      const studentPlan = s.billingPlan ?? BillingPlan.MONTHLY;

      // Plan-specific threshold
      const planDaysBefore = studentPlan === BillingPlan.YEARLY ? YEARLY_DAYS_BEFORE : MONTHLY_DAYS_BEFORE;
      const threshold = new Date(now);
      threshold.setDate(threshold.getDate() + planDaysBefore);

      // Hali vaqt bor => invoice kerak emas
      if (paidUntil && paidUntil > threshold) {
        skipped++;
        continue;
      }

      const studentAmount = this.getPlanAmount(studentPlan);

      // YEARLY: joriy oyda to'lanmagan MONTHLY record bor → skip
      if (studentPlan === BillingPlan.YEARLY && monthlyConflictIds.has(s.id)) {
        this.logger.warn(
          `[ROLLING] student=${s.id} YEARLY skip: unpaid MONTHLY exists for ${currentMonthKey(now)}`,
        );
        skipped++;
        continue;
      }

      // MONTHLY: joriy o'quv yilida faol YEARLY record bor → skip
      if (studentPlan === BillingPlan.MONTHLY && yearlyConflictIds.has(s.id)) {
        this.logger.warn(
          `[ROLLING] student=${s.id} MONTHLY skip: active YEARLY exists for ${makePeriodKey(BillingPlan.YEARLY, now)}`,
        );
        skipped++;
        continue;
      }

      const start = paidUntil && paidUntil > now ? paidUntil : now;
      // Normalized periodKey: MONTHLY → "YYYY-MM", YEARLY → "YYYY-YYYY"
      const periodKey = makePeriodKey(studentPlan, start);

      const d = decisions.get(s.id) ?? { status: PaymentStatus.PENDING };
      const status = d.status;
      const waiveReason =
        status === PaymentStatus.WAIVED ? (d.waiveReason ?? PaymentWaiveReason.OTHER) : null;

      candidates.push({
        studentId: s.id,
        plan: studentPlan,
        periodKey,
        dueDate: start,
        status,
        waiveReason,
        waivedAt: status === PaymentStatus.WAIVED ? new Date() : null,
        amount: status === PaymentStatus.WAIVED ? 0 : studentAmount,
      });
    }

    if (!candidates.length) {
      return { created: 0, updated: 0, skipped, notified: 0, plan: 'MIXED', strategy: 'ROLLING_DUE', daysBefore };
    }

    // 3) Bulk query — plan ham key'ga kiradi (MONTHLY vs YEARLY ajratish uchun)
    const studentIds = Array.from(new Set(candidates.map((c) => c.studentId)));
    const periodKeys = Array.from(new Set(candidates.map((c) => c.periodKey)));

    const existingMap = new Map<string, { id: string; status: PaymentStatus }>();

    const chunkSize = 500;
    for (let i = 0; i < periodKeys.length; i += chunkSize) {
      const pkChunk = periodKeys.slice(i, i + chunkSize);

      const rows = await this.prisma.payment.findMany({
        where: {
          studentId: { in: studentIds },
          periodKey: { in: pkChunk },
          // plan filtri yo'q — har student o'z plan'i bilan tekshiriladi
        },
        select: { id: true, studentId: true, periodKey: true, status: true, plan: true },
      });

      for (const r of rows) {
        // Key: studentId + plan + periodKey — noyob kombinatsiya
        existingMap.set(`${r.studentId}|${r.plan}|${r.periodKey}`, { id: r.id, status: r.status });
      }
    }

    // 4) create/update ro'yxatlarini build qilamiz
    for (const c of candidates) {
      const key = `${c.studentId}|${c.plan}|${c.periodKey}`;
      const ex = existingMap.get(key);

      const baseCreate: Prisma.PaymentCreateManyInput = {
        studentId: c.studentId,
        plan: c.plan,        // ← student o'z plan'i
        periodKey: c.periodKey,
        amount: c.amount,
        dueDate: c.dueDate,
        status: c.status,
        waiveReason: c.waiveReason,
        waivedAt: c.waivedAt,
        paidDate: null,
      };

      if (!ex) {
        toCreate.push(baseCreate);
        continue;
      }

      if (mode === GenerateMode.SKIP_EXISTING) {
        skipped++;
        continue;
      }

      if (ex.status === PaymentStatus.PAID) {
        skipped++;
        continue;
      }

      toUpdate.push({
        id: ex.id,
        data: {
          amount: c.amount,
          dueDate: c.dueDate,
          status: c.status,
          waiveReason: c.waiveReason,
          waivedAt: c.waivedAt,
          ...(c.status === PaymentStatus.PENDING ? { waiveReason: null, waivedAt: null } : {}),
        },
      });
    }

    // 5) Transaction: createMany + batch update
    await this.prisma.$transaction(async (tx) => {
      if (toCreate.length) {
        const res = await tx.payment.createMany({ data: toCreate, skipDuplicates: true });
        created = res.count;

        const createdRows = await tx.payment.findMany({
          where: {
            student: { schoolId },
            studentId: { in: studentIds },
            periodKey: { in: periodKeys },
          },
          select: { id: true },
        });
        affectedIds.push(...createdRows.map((x) => x.id));
      }

      if (toUpdate.length) {
        const updChunk = 50;
        for (let i = 0; i < toUpdate.length; i += updChunk) {
          const chunk = toUpdate.slice(i, i + updChunk);
          await Promise.all(chunk.map((u) => tx.payment.update({ where: { id: u.id }, data: u.data })));
        }
        updated = toUpdate.length;
        affectedIds.push(...toUpdate.map((u) => u.id));
      }
    });

    // 6) Notifications
    let notified = 0;
    if (sendNotifications && affectedIds.length) {
      const res = await this.notifications.sendBillingInvoiceNotices(affectedIds, {
        plan: BillingPlan.MONTHLY, // meta fallback — notifications DB dan o'qiydi
        periodKey: 'ROLLING',
      });
      notified = res.totalSent;
    }

    this.logger.log(
      `[ROLLING_DUE] school=${schoolId} plan=MIXED created=${created} updated=${updated} skipped=${skipped} notified=${notified}`,
    );

    return { created, updated, skipped, notified, plan: 'MIXED', strategy: 'ROLLING_DUE', daysBefore };
  }

  // --------------------------
  // When payment is paid (webhook / manual mark-paid)
  // - billingPaidUntil update
  // --------------------------
  async applyPaidUntilFromPayment(paymentId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { student: true },
    });
    if (!payment) throw new BadRequestException('Payment not found');

    if (payment.status !== PaymentStatus.PAID || !payment.paidDate) {
      throw new BadRequestException('Payment must be PAID with paidDate');
    }

    const start = payment.paidDate;
    const nextUntil = computeNextPaidUntil(payment.plan, start);

    await this.prisma.student.update({
      where: { id: payment.studentId },
      data: { billingPaidUntil: nextUntil },
    });

    return { studentId: payment.studentId, billingPaidUntil: nextUntil };
  }
}