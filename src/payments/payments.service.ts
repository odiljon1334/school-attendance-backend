import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePaymentDto, UpdatePaymentDto, PaymentReportDto } from './dto/payment.dto';
import { BillingPlan, PaymentStatus, PaymentWaiveReason } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import { NotificationsService } from 'src/notifications/notifications.service';
import { BillingService } from 'src/billing/billing.service';
import { computeNextPaidUntil } from 'src/billing/billing.utils';
import { AuditLogService } from '../audit-log/audit-log.service';

@Injectable()
export class PaymentsService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private billing: BillingService,
    private auditLog: AuditLogService,
  ) {}

  async create(dto: CreatePaymentDto) {
    const student = await this.prisma.student.findUnique({ where: { id: dto.studentId } });
    if (!student) throw new NotFoundException('Student not found');

    // ✅ unique: @@unique([studentId, plan, periodKey])
    const existing = await this.prisma.payment.findFirst({
      where: { studentId: dto.studentId, plan: dto.plan, periodKey: dto.periodKey },
      select: { id: true },
    });
    if (existing) {
      throw new BadRequestException(`Payment already exists for ${dto.plan} ${dto.periodKey}`);
    }

    const payment = await this.prisma.payment.create({
      data: {
        student: { connect: { id: dto.studentId } },

        plan: dto.plan,
        periodKey: dto.periodKey,
        amount: Math.round(Number(dto.amount) || 0),

        status: dto.status ?? PaymentStatus.PENDING,
        paidDate: dto.paidDate ? new Date(dto.paidDate) : null,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : new Date(),

        notes: dto.notes ?? null,
      },
    });

    void this.auditLog.log({
      action: 'PAYMENT_CREATE',
      entity: 'Payment',
      entityId: payment.id,
      schoolId: student.schoolId,
      details: { amount: payment.amount, plan: payment.plan, periodKey: payment.periodKey, status: payment.status },
    });

    return payment;
  }

  async findAll(params: {
    schoolId?: string;
    studentId?: string;
    classId?: string;
    status?: PaymentStatus;
    plan?: BillingPlan;
    periodKey?: string;
  }) {
    const { schoolId, studentId, classId, status, plan, periodKey } = params;

    const where: any = {};

    if (schoolId || classId) {
      where.student = {
      ...(schoolId ? { schoolId } : {}),
      ...(classId ? { classId } : {}),
    };
  }

    if (studentId) where.studentId = studentId;
    if (status) where.status = status;
    if (plan) where.plan = plan;
    if (periodKey) where.periodKey = periodKey;

    return this.prisma.payment.findMany({
      where,
      include: {
        student: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            class: { select: { grade: true, section: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async buildExcelReport(dto: { schoolId: string; startDate?: string; endDate?: string }) {
    const start = dto.startDate ? new Date(dto.startDate) : new Date('1970-01-01');
    const end = dto.endDate ? new Date(dto.endDate) : new Date();
    end.setHours(23, 59, 59, 999);

    const data = await this.prisma.payment.findMany({
      where: {
        student: { schoolId: dto.schoolId },
        createdAt: { gte: start, lte: end },
      },
      include: {
        student: {
          select: {
            firstName: true,
            lastName: true,
            class: { select: { grade: true, section: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Payments');

    ws.columns = [
      { header: 'Ученик', key: 'student', width: 28 },
      { header: 'Класс', key: 'class', width: 10 },
      { header: 'План', key: 'plan', width: 10 },
      { header: 'Период', key: 'periodKey', width: 12 },
      { header: 'Статус', key: 'status', width: 12 },
      { header: 'Сумма', key: 'amount', width: 12 },
      { header: 'Срок', key: 'dueDate', width: 14 },
      { header: 'Оплата', key: 'paidDate', width: 14 },
      { header: 'Льгота', key: 'waiveReason', width: 16 },
      { header: 'Примечание', key: 'notes', width: 30 },
    ];

    ws.getRow(1).font = { bold: true };

    for (const p of data) {
      const fullName = p.student ? `${p.student.firstName} ${p.student.lastName}` : '';
      const klass = p.student?.class ? `${p.student.class.grade}-${p.student.class.section}` : '';

      ws.addRow({
        student: fullName,
        class: klass,
        plan: p.plan,
        periodKey: p.periodKey,
        status: p.status,
        amount: p.amount,
        dueDate: p.dueDate ? new Date(p.dueDate).toLocaleDateString('ru-RU') : '',
        paidDate: p.paidDate ? new Date(p.paidDate).toLocaleDateString('ru-RU') : '',
        waiveReason: p.waiveReason ?? '',
        notes: p.notes || '',
      });
    }

    return wb.xlsx.writeBuffer();
  }

  async markAsPaid(id: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id },
      include: { student: true },
    });
    if (!payment) throw new NotFoundException('Payment record not found');
    if (payment.status === PaymentStatus.PAID) throw new BadRequestException('Already paid');

    const paidAt = new Date();

    // ✅ 1) payment update (atomic)
    const updatedPayment = await this.prisma.payment.update({
      where: { id },
      data: {
        status: PaymentStatus.PAID,
        paidDate: paidAt,
        waiveReason: null,
        waivedAt: null,
      },
      include: { student: true },
    });

    // ✅ 2) subscription state update (billingPaidUntil)
    // billing service o'zi compute qiladi (MONTHLY -> +1 month, YEARLY -> next Sep 1)
    await this.billing.applyPaidUntilFromPayment(updatedPayment.id);

    // ✅ 3) confirmation (best-effort, payment oqimi to'xtamasin)
    try {
      await this.notifications.sendPaymentConfirmation(updatedPayment.id);
    } catch (e: any) {
      // bu yerda throw qilmaymiz — paid muvaffaqiyatli bo'ldi
    }

    return updatedPayment;
  }

  async waive(id: string, dto: { reason: PaymentWaiveReason; notes?: string }) {
    const payment = await this.findOne(id);
    if (payment.status === PaymentStatus.PAID) {
      throw new BadRequestException('Paid payment cannot be waived');
    }

    return this.prisma.payment.update({
      where: { id },
      data: {
        status: PaymentStatus.WAIVED,
        waiveReason: dto.reason,
        waivedAt: new Date(),
        paidDate: null,
        notes: dto.notes ?? payment.notes ?? null,
      },
      include: { student: true },
    });
  }

  async getUnpaidStudents(schoolId: string) {
    return this.prisma.payment.findMany({
      where: {
        student: { schoolId },
        status: { in: [PaymentStatus.PENDING, PaymentStatus.OVERDUE] },
      },
      include: {
        student: { include: { class: true, parents: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async generateReport(dto: PaymentReportDto) {
    const start = dto.startDate ? new Date(dto.startDate) : undefined;
    const end = dto.endDate ? new Date(dto.endDate) : undefined;
    if (end) end.setHours(23, 59, 59, 999);

    const where: any = {
      student: { schoolId: dto.schoolId },
      createdAt: { gte: start, lte: end },
    };

    if (dto.studentId) where.studentId = dto.studentId;
    if (dto.status) where.status = dto.status;
    if (dto.plan) where.plan = dto.plan;
    if (dto.periodKey) where.periodKey = dto.periodKey;
    if (dto.waivedOnly) where.status = PaymentStatus.WAIVED;

    // classId filter student relation orqali
    if (dto.classId) {
      where.student = { ...(where.student || {}), classId: dto.classId };
    }

    return this.prisma.payment.findMany({
      where,
      include: { student: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id },
      include: { student: true },
    });
    if (!payment) throw new NotFoundException('Payment record not found');
    return payment;
  }

  async update(id: string, dto: UpdatePaymentDto) {
    await this.findOne(id);

    // periodKey/plan o'zgarsa unique urilishi mumkin — minimal guard
    if (dto.plan || dto.periodKey) {
      const current = await this.prisma.payment.findUnique({ where: { id }, select: { studentId: true, plan: true, periodKey: true } });
      if (!current) throw new NotFoundException('Payment record not found');

      const newPlan = dto.plan ?? current.plan;
      const newPeriodKey = dto.periodKey ?? current.periodKey;

      const other = await this.prisma.payment.findFirst({
        where: {
          studentId: current.studentId,
          plan: newPlan,
          periodKey: newPeriodKey,
          NOT: { id },
        },
        select: { id: true },
      });

      if (other) throw new BadRequestException('Another payment exists for same period');
    }

    return this.prisma.payment.update({
      where: { id },
      data: {
        plan: dto.plan ?? undefined,
        periodKey: dto.periodKey ?? undefined,
        amount: dto.amount === undefined ? undefined : Math.round(Number(dto.amount) || 0),
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        paidDate: dto.paidDate === null ? null : dto.paidDate ? new Date(dto.paidDate) : undefined,
        status: dto.status ?? undefined,
        waiveReason: dto.waiveReason === undefined ? undefined : dto.waiveReason,
        waivedAt:
          dto.waivedAt === undefined
            ? undefined
            : dto.waivedAt === null
              ? null
              : new Date(dto.waivedAt),
        notes: dto.notes === undefined ? undefined : dto.notes,
      },
      include: { student: true },
    });
  }

  async remove(id: string) {
    const payment = await this.findOne(id);
  
    await this.prisma.payment.delete({ where: { id } });
  
    // ✅ O'chirilgandan keyin oxirgi PAID paymentni topib billingPaidUntil ni qayta hisoblaymiz
    if (payment.status === PaymentStatus.PAID) {
      const lastPaid = await this.prisma.payment.findFirst({
        where: {
          studentId: payment.studentId,
          status: PaymentStatus.PAID,
        },
        orderBy: { paidDate: 'desc' },
      });
  
      await this.prisma.student.update({
        where: { id: payment.studentId },
        data: {
          billingPaidUntil: lastPaid?.paidDate
            ? computeNextPaidUntil(lastPaid.plan, lastPaid.paidDate)
            : null,
        },
      });
    }
  
    return { message: 'Payment deleted successfully' };
  }
}