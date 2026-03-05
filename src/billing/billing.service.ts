import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma, BillingPlan, PaymentStatus, PaymentWaiveReason } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { GenerateBillingDto, GenerateMode, GenerateStrategy } from './dto/generate-billing.dto';
import { computeNextPaidUntil, makePeriodKey, toIntAmount } from './billing.utils';

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
    if (plan === BillingPlan.YEARLY && !/^\d{4}(\-\d{4})?$/.test(periodKey)) {
      throw new BadRequestException('YEARLY periodKey must be "YYYY" or "YYYY-YYYY"');
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

    const amount = this.getPlanAmount(dto.plan);

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

    // default: rolling
    return this.generateRollingDue({
      schoolId: dto.schoolId,
      plan: dto.plan,
      amount,
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

    // existing payments for idempotency
    const existing = await this.prisma.payment.findMany({
      where: { student: { schoolId }, plan, periodKey },
      select: { id: true, studentId: true, status: true },
    });
    const existingByStudent = new Map(existing.map((p) => [p.studentId, p]));

    const toCreate: Prisma.PaymentCreateManyInput[] = [];
    const toUpdate: Array<{ id: string; data: Prisma.PaymentUpdateInput }> = [];
    let skipped = 0;

    const students = await this.prisma.student.findMany({
      where: { schoolId },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });

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
  // - billingPaidUntil yaqin bo‘lsa invoice chiqaradi
  // - periodKey = "YYYY-MM-DD..YYYY-MM-DD"
  // --------------------------
  private async generateRollingDue(params: {
    schoolId: string;
    plan: BillingPlan;
    amount: number;
    mode: GenerateMode;
    decisions: Map<string, { status: PaymentStatus; waiveReason?: PaymentWaiveReason }>;
    sendNotifications: boolean;
    daysBefore: number;
    students: StudentForBilling[];
  }) {
    const { schoolId, plan, amount, mode, decisions, sendNotifications, daysBefore, students } = params;
  
    const now = new Date();
    const threshold = new Date(now);
    threshold.setDate(threshold.getDate() + daysBefore);
  
    // 1) Faqat shu plan dagi studentlar
    const target = students.filter((s) => (s.billingPlan ?? BillingPlan.MONTHLY) === plan);
  
    let created = 0;
    let updated = 0;
    let skipped = 0;
  
    const affectedIds: string[] = [];
    const toCreate: Prisma.PaymentCreateManyInput[] = [];
    const toUpdate: Array<{ id: string; data: Prisma.PaymentUpdateInput }> = [];
  
    // 2) Invoice kerak bo‘ladigan candidate’larni oldindan hisoblab olamiz
    //    (shu bilan periodKey’lar setini olamiz)
    const candidates: Array<{
      studentId: string;
      periodKey: string;
      dueDate: Date; // sizning rolling qoidangizga ko‘ra
      status: PaymentStatus;
      waiveReason: PaymentWaiveReason | null;
      waivedAt: Date | null;
      amount: number;
    }> = [];
  
    for (const s of target) {
      const paidUntil = s.billingPaidUntil;
  
      // Hali vaqt bor => invoice kerak emas
      if (paidUntil && paidUntil > threshold) {
        skipped++;
        continue;
      }
  
      // start: to‘lov sanasidan keyin hisoblash qoidangizga mos
      // paidUntil bo‘lsa va u kelajakda bo‘lsa — shu joydan, aks holda hozir (now) dan
      const start = paidUntil && paidUntil > now ? paidUntil : now;
  
      const end = computeNextPaidUntil(plan, start);
      const periodKey = makePeriodKey(start, end);
  
      const d = decisions.get(s.id) ?? { status: PaymentStatus.PENDING };
      const status = d.status;
  
      const waiveReason =
        status === PaymentStatus.WAIVED
          ? (d.waiveReason ?? PaymentWaiveReason.OTHER)
          : null;
  
      candidates.push({
        studentId: s.id,
        periodKey,
        dueDate: start, // rolling due: "hozir due" (xohlasangiz start + daysBefore qilamiz)
        status,
        waiveReason,
        waivedAt: status === PaymentStatus.WAIVED ? new Date() : null,
        amount: status === PaymentStatus.WAIVED ? 0 : amount,
      });
    }
  
    if (!candidates.length) {
      return { created: 0, updated: 0, skipped, notified: 0, plan, strategy: 'ROLLING_DUE', daysBefore, amount };
    }
  
    // 3) N+1 o‘rniga: bitta bulk query
    const studentIds = Array.from(new Set(candidates.map((c) => c.studentId)));
    const periodKeys = Array.from(new Set(candidates.map((c) => c.periodKey)));
  
    // ⚠️ Juda katta maktab bo‘lsa IN list juda kattalashishi mumkin.
    // Shu uchun chunk qilib olamiz (production safe).
    const existingMap = new Map<string, { id: string; status: PaymentStatus }>();
  
    const chunkSize = 500; // xavfsiz default
    for (let i = 0; i < periodKeys.length; i += chunkSize) {
      const pkChunk = periodKeys.slice(i, i + chunkSize);
  
      const rows = await this.prisma.payment.findMany({
        where: {
          studentId: { in: studentIds },
          plan,
          periodKey: { in: pkChunk },
        },
        select: { id: true, studentId: true, periodKey: true, status: true },
      });
  
      for (const r of rows) {
        existingMap.set(`${r.studentId}|${r.periodKey}`, { id: r.id, status: r.status });
      }
    }
  
    // 4) create/update ro‘yxatlarini build qilamiz
    for (const c of candidates) {
      const key = `${c.studentId}|${c.periodKey}`;
      const ex = existingMap.get(key);
  
      const baseCreate: Prisma.PaymentCreateManyInput = {
        studentId: c.studentId,
        plan,
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
  
        // created ids fetch (safe bulk)
        // IN set bo‘yicha topamiz
        const createdRows = await tx.payment.findMany({
          where: {
            student: { schoolId },
            plan,
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
      // sendBillingInvoiceNotices ichida p.periodKey ishlatiladi — meta fallback xolos
      const res = await this.notifications.sendBillingInvoiceNotices(affectedIds, {
        plan,
        periodKey: 'ROLLING',
      });
      notified = res.totalSent;
    }
  
    this.logger.log(
      `[ROLLING_OPT] school=${schoolId} plan=${plan} created=${created} updated=${updated} skipped=${skipped} notified=${notified}`,
    );
  
    return { created, updated, skipped, notified, plan, strategy: 'ROLLING_DUE', daysBefore, amount };
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