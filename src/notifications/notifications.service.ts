import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService } from './telegram.service';
import { SmsService } from './sms.service';
import { WhatsappService } from 'src/whatsapp/whatsapp.service';
import { BillingPlan, PaymentStatus } from '@prisma/client';
import { BroadcastChannel } from './dto/notification.dto';

type Channel = BroadcastChannel | 'ALL';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private prisma: PrismaService,
    private telegramService: TelegramService,
    private smsService: SmsService,
    private whatsappService: WhatsappService,
  ) {}

  // =========================
  // BASIC CRUD
  // =========================
  async findAll(
    recipientId?: string,
    type?: string,
    isSent?: string,
    limit = 10,
    skip = 0,
    includeRead = false,
  ) {
    const where: any = {};
    if (!includeRead) where.isRead = false;
    if (recipientId) where.recipientId = recipientId;
    if (type) where.type = type;
    if (isSent !== undefined) where.isSent = isSent === 'true';

    const [items, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip,
      }),
      this.prisma.notification.count({ where }),
    ]);

    return { items, total };
  }

  async remove(id: string) {
    await this.prisma.notification.delete({ where: { id } });
    return { message: 'Уведомление удалено' };
  }

  async markAsRead(id: string) {
    await this.prisma.notification.update({
      where: { id },
      data: { isRead: true, readAt: new Date() },
    });
    return { message: 'Уведомление прочитано' };
  }

  // Barcha o'qilmagan notificationlarni o'qilgan deb belgilash
  async markAllAsRead() {
    const result = await this.prisma.notification.updateMany({
      where: { isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    return { updated: result.count };
  }

  // Barcha o'qilgan notificationlarni o'chirish
  async deleteAllRead() {
    const result = await this.prisma.notification.deleteMany({
      where: { isRead: true },
    });
    return { deleted: result.count };
  }

  // =========================
  // PHONE NORMALIZE (UNIVERSAL)
  // - Uzbekistan ham, Kyrgyzstan ham, boshqalar ham
  // - Maqsad: +<countrycode><digits> ga yaqinlashtirish
  // - UZ-only qilib "998" ga majburlamaymiz
  // =========================
  private normalizePhone(raw?: string | null): string | null {
    if (!raw) return null;

    const s = String(raw).trim();
    if (!s) return null;

    // Keep only digits and '+'
    const hasPlus = s.startsWith('+');
    const digits = s.replace(/[^\d]/g, '');

    if (!digits) return null;

    // If already had + => return +digits
    if (hasPlus) {
      // E.164 max 15 digits
      if (digits.length < 8 || digits.length > 15) return `+${digits}`; // baribir qaytaramiz
      return `+${digits}`;
    }

    // If user wrote country code without '+', e.g. 998901234567 or 996555...
    // We can safely add '+' if looks like country-coded number (length 10..15).
    if (digits.length >= 10 && digits.length <= 15) {
      return `+${digits}`;
    }

    // If too short, return as-is (gateway balki local formatni qabul qiladi)
    // lekin hech bo'lmasa digits ko'rinishida
    return digits;
  }

  // =========================
  // INTERNAL: Create notification record
  // =========================
  private async createNotification(params: {
    recipientType: 'PARENT' | 'TEACHER';
    recipientId: string;
    type: string;
    title: string;
    message: string;
    sentVia: 'SMS' | 'TELEGRAM';
    isSent: boolean;
    errorText?: string | null;
  }) {
    const { recipientType, recipientId, type, title, message, sentVia, isSent } = params;

    // schema’da error column bo‘lmasa ham, isSent false bo‘lib logda qoladi
    // agar sizda "error" field bo‘lsa, shu yerga qo‘shib qo‘yish mumkin.
    return this.prisma.notification.create({
      data: {
        recipientType,
        recipientId,
        type,
        title,
        message,
        sentVia,
        isSent,
        sentAt: isSent ? new Date() : null,
      },
    });
  }

  private getSmsPolicyByNotifType(notifType: string): { type: string; limitPerMin: number } {
    switch (notifType) {
      case 'TEACHER_ATTENDANCE':
        return { type: 'TEACHER_ATTENDANCE', limitPerMin: 60 };

      case 'ATTENDANCE':
        return { type: 'STUDENT_ATTENDANCE', limitPerMin: 10 };

      case 'BILLING_INVOICE':
        return { type: 'BILLING_INVOICE', limitPerMin: 3 };

      case 'PAYMENT':
        return { type: 'PAYMENT', limitPerMin: 5 };

      case 'BROADCAST':
        return { type: 'BROADCAST', limitPerMin: 8 };

      default:
        return { type: 'GENERIC', limitPerMin: 5 };
    }
  }

  private async sendToRecipient(params: {
    channel: Channel;
    recipientType: 'PARENT' | 'TEACHER';
    recipientId: string;
    phone?: string | null;
    isTelegramActive?: boolean | null;
    telegramChatId?: string | null;
    isWhatsappActive?: boolean | null;
    whatsappPhone?: string | null;
    title: string;
    message: string;
    notifType: string;
    mediaBase64?: string | null;
    preferGif?: boolean;
  }) {
    const {
      channel,
      recipientType,
      recipientId,
      phone,
      isTelegramActive,
      telegramChatId,
      isWhatsappActive,
      whatsappPhone,
      title,
      message,
      notifType,
      mediaBase64,
    } = params;

    const normalizedPhone = this.normalizePhone(phone);
    const canSms = !!normalizedPhone;
    const canTg = !!(isTelegramActive && telegramChatId);
    // WHAPI orqali istalgan raqamga yuborish mumkin — bot bosmaganda ham.
    // whatsappPhone bo'lmasa oddiy phone ni ishlatamiz (fallback).
    const effectiveWaPhone = whatsappPhone || normalizedPhone;
    const canWa = !!effectiveWaPhone;

    const isAll = channel === 'ALL' || (channel as string) === BroadcastChannel.ALL;
    const wantSms = isAll || (channel as string) === BroadcastChannel.SMS;
    const wantTg = isAll || (channel as string) === BroadcastChannel.TELEGRAM;
    const wantWa = isAll || (channel as string) === BroadcastChannel.WHATSAPP;

    const tgPromise =
      wantTg && canTg
        ? (mediaBase64
            ? this.telegramService.sendPhotoFromBase64(
                telegramChatId!,
                mediaBase64,
                `<b>${title}</b>\n\n${message}`,
              )
            : this.telegramService.sendMessage(
                telegramChatId!,
                `<b>${title}</b>\n\n${message}`,
              ))
        : Promise.resolve({ skipped: true });

    const smsPolicy = this.getSmsPolicyByNotifType(notifType);

    const smsPromise =
      wantSms && canSms
        ? this.smsService.sendSms(normalizedPhone!, `${title}\n\n${message}`, {
            type: smsPolicy.type,
            limitPerMin: smsPolicy.limitPerMin,
          })
        : Promise.resolve(false);

    const waPromise =
      wantWa && canWa
        ? (mediaBase64
            ? this.whatsappService.sendPhoto(effectiveWaPhone!, mediaBase64, `*${title}*\n\n${message}`)
                .then(() => true)
                .catch(() => this.whatsappService.sendText(effectiveWaPhone!, `*${title}*\n\n${message}`).then(() => true).catch(() => false))
            : this.whatsappService.sendText(effectiveWaPhone!, `*${title}*\n\n${message}`)
                .then(() => true)
                .catch(() => false))
        : Promise.resolve(false as boolean | false);

    const [tgRes, smsRes, waRes] = await Promise.allSettled([tgPromise, smsPromise, waPromise]);

    // Telegram result
    let tgSent = false;
    let tgSkipped = false;
    let tgErr: string | null = null;

    if (tgRes.status === 'fulfilled') {
      tgSkipped = !!(tgRes.value as any)?.skipped;
      tgSent = !tgSkipped;
    } else {
      tgErr = tgRes.reason?.message ?? String(tgRes.reason);
    }

    // SMS result
    let smsSent = false;
    let smsErr: string | null = null;

    if (smsRes.status === 'fulfilled') {
      smsSent = Boolean(smsRes.value);
    } else {
      smsErr = smsRes.reason?.message ?? String(smsRes.reason);
    }

    // WhatsApp result
    let waSent = false;
    let waErr: string | null = null;

    if (waRes.status === 'fulfilled') {
      waSent = Boolean(waRes.value);
    } else {
      waErr = waRes.reason?.message ?? String(waRes.reason);
    }

    // Logs
    if (wantTg && canTg) {
      await this.createNotification({
        recipientType,
        recipientId,
        type: notifType,
        title,
        message,
        sentVia: 'TELEGRAM',
        isSent: tgSent,
        errorText: tgErr,
      });
    }

    if (wantSms && canSms) {
      await this.createNotification({
        recipientType,
        recipientId,
        type: notifType,
        title,
        message,
        sentVia: 'SMS',
        isSent: smsSent,
        errorText: smsErr,
      });
    }

    if (wantWa && canWa) {
      await this.createNotification({
        recipientType,
        recipientId,
        type: notifType,
        title,
        message,
        sentVia: 'SMS', // DB da WHATSAPP yo'q, SMS sifatida saqlaymiz
        isSent: waSent,
        errorText: waErr,
      });
    }

    return {
      telegram: { attempted: wantTg && canTg, sent: tgSent, skipped: tgSkipped, error: tgErr },
      sms: { attempted: wantSms && canSms, sent: smsSent, error: smsErr },
      whatsapp: { attempted: wantWa && canWa, sent: waSent, error: waErr },
    };
  }

  // =========================
  // DAILY ATTENDANCE -> PARENTS
  // - Agar parentda Telegram active + phone bo‘lsa => BOTH yuboradi
  // - Telegram active bo‘lmasa => faqat SMS (phone bo‘lsa)
  // =========================
  async sendDailyAttendanceToParents(schoolId: string, date: Date) {
    const attendances = await this.prisma.attendance.findMany({
      where: {
        schoolId,
        date,
        studentId: { not: null },
      },
      include: {
        student: {
          include: {
            parents: {
              where: { notifySms: true },
              include: {
                parent: {
                  select: {
                    id: true,
                    phone: true,
                    isTelegramActive: true,
                    telegramChatId: true,
                    isWhatsappActive: true,
                    whatsappPhone: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    const title = 'Ежедневная посещаемость';

    let total = 0;
    let sentTelegram = 0;
    let sentSms = 0;
    let failed = 0;

    // Performance: parallel inside chunk
    const tasks: Array<() => Promise<void>> = [];

    for (const attendance of attendances) {
      if (!attendance.student) continue;

      for (const link of attendance.student.parents) {
        const parent = link.parent;
        if (!parent) continue;

        const message = this.formatAttendanceMessage(
          attendance.student.firstName,
          attendance.student.lastName,
          attendance.status,
          attendance.checkInTime ?? undefined,
        );

        total++;

        tasks.push(async () => {
          try {
            // ✅ Parentda ikkalasi bo'lsa ikkalasi ham ketadi
            const res = await this.sendToRecipient({
              channel: 'ALL',
              recipientType: 'PARENT',
              recipientId: parent.id,
              phone: parent.phone,
              isTelegramActive: parent.isTelegramActive,
              telegramChatId: parent.telegramChatId,
              isWhatsappActive: parent.isWhatsappActive,
              whatsappPhone: parent.whatsappPhone,
              title,
              message,
              notifType: 'ATTENDANCE',
            });

            if (res.telegram.sent) sentTelegram++;
            if (res.sms.sent) sentSms++;
            if (
              (res.telegram.attempted && !res.telegram.sent && !res.telegram.skipped) ||
              (res.sms.attempted && !res.sms.sent)
            ) {
              failed++;
            }
          } catch (e: any) {
            failed++;
            this.logger.error(`Daily attendance send failed for parent=${parent.id}: ${e?.message ?? e}`);
          }
        });
      }
    }

    await this.runWithConcurrency(tasks, 30);

    return {
      total,
      sentTelegram,
      sentSms,
      failed,
    };
  }

  // =========================
  // PAYMENT REMINDERS (3 days before)
  // - Parentda telegram+phone bo‘lsa => BOTH
  // =========================
  async sendPaymentReminders() {
    const threeDaysFromNow = new Date();
    threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);
    threeDaysFromNow.setHours(0, 0, 0, 0);

    const nextDay = new Date(threeDaysFromNow);
    nextDay.setDate(nextDay.getDate() + 1);

    const upcomingPayments = await this.prisma.payment.findMany({
      where: {
        status: 'PENDING',
        dueDate: { gte: threeDaysFromNow, lt: nextDay },
      },
      include: {
        student: {
          include: {
            parents: {
              where: { notifySms: true },
              include: {
                parent: {
                  select: {
                    id: true,
                    phone: true,
                    isTelegramActive: true,
                    telegramChatId: true,
                    isWhatsappActive: true,
                    whatsappPhone: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    const title = 'Напоминание об оплате';

    let total = 0;
    let sentTelegram = 0;
    let sentSms = 0;
    let failed = 0;

    const tasks: Array<() => Promise<void>> = [];

    for (const payment of upcomingPayments) {
      if (!payment.student) continue;

      for (const link of payment.student.parents) {
        const parent = link.parent;
        if (!parent) continue;

        const message = this.formatPaymentReminderMessage(
          payment.student.firstName,
          payment.student.lastName,
          payment.amount,
          payment.dueDate,
        );

        total++;

        tasks.push(async () => {
          try {
            const res = await this.sendToRecipient({
              channel: 'ALL',
              recipientType: 'PARENT',
              recipientId: parent.id,
              phone: parent.phone,
              isTelegramActive: parent.isTelegramActive,
              telegramChatId: parent.telegramChatId,
              isWhatsappActive: parent.isWhatsappActive,
              whatsappPhone: parent.whatsappPhone,
              title,
              message,
              notifType: 'PAYMENT',
            });

            if (res.telegram.sent) sentTelegram++;
            if (res.sms.sent) sentSms++;
            if (
              (res.telegram.attempted && !res.telegram.sent && !res.telegram.skipped) ||
              (res.sms.attempted && !res.sms.sent)
            ) {
              failed++;
            }
          } catch (e: any) {
            failed++;
            this.logger.error(`Payment reminder send failed parent=${parent.id}: ${e?.message ?? e}`);
          }
        });
      }
    }

    await this.runWithConcurrency(tasks, 20);

    return { total, sentTelegram, sentSms, failed };
  }

  // =========================
  // PAYMENT CONFIRMATION
  // - Parentda telegram+phone bo‘lsa => BOTH
  // =========================
  async sendPaymentConfirmation(paymentId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        student: {
          include: {
            parents: {
              where: { notifySms: true },
              include: {
                parent: {
                  select: {
                    id: true,
                    phone: true,
                    isTelegramActive: true,
                    telegramChatId: true,
                    isWhatsappActive: true,
                    whatsappPhone: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!payment || !payment.paidDate || !payment.student) {
      return { sent: false, message: 'Платёж не найден или ещё не оплачен' };
    }

    const title = 'Оплата подтверждена';

    let total = 0;
    let sentTelegram = 0;
    let sentSms = 0;
    let failed = 0;

    const tasks: Array<() => Promise<void>> = [];

    for (const link of payment.student.parents) {
      const parent = link.parent;
      if (!parent) continue;

      const message = this.formatPaymentConfirmationMessage(
        payment.student.firstName,
        payment.student.lastName,
        payment.amount,
        payment.paidDate,
      );

      total++;

      tasks.push(async () => {
        try {
          const res = await this.sendToRecipient({
            channel: 'ALL',
            recipientType: 'PARENT',
            recipientId: parent.id,
            phone: parent.phone,
            isTelegramActive: parent.isTelegramActive,
            telegramChatId: parent.telegramChatId,
            isWhatsappActive: parent.isWhatsappActive,
            whatsappPhone: parent.whatsappPhone,
            title,
            message,
            notifType: 'PAYMENT',
          });

          if (res.telegram.sent) sentTelegram++;
          if (res.sms.sent) sentSms++;
          if (
            (res.telegram.attempted && !res.telegram.sent && !res.telegram.skipped) ||
            (res.sms.attempted && !res.sms.sent)
          ) {
            failed++;
          }
        } catch (e: any) {
          failed++;
          this.logger.error(`Payment confirmation send failed parent=${parent.id}: ${e?.message ?? e}`);
        }
      });
    }

    await this.runWithConcurrency(tasks, 20);

    return { total, sentTelegram, sentSms, failed };
  }

  // =========================
  // BROADCAST (Dashboard)
  // - DIRECTOR faqat o‘z schooliga yuboradi (security)
  // - Telegram inactive bo‘lganlarni telegramda skip
  // - BOTH bo‘lsa parent/teacher uchun ikkala kanal ishlaydi
  // - Bulk concurrency optimize
  // =========================
  async broadcast(
    dto: {
      channel: Channel;
      category: string;
      title: string;
      message: string;
      target:
        | 'PARENTS_ALL'
        | 'TEACHERS_ALL'
        | 'DIRECTORS_ALL'
        | 'SCHOOL_TEACHERS'
        | 'SCHOOL_PARENTS';
      schoolId?: string;
    },
    user: any,
  ) {
    const { channel, title, message, target } = dto;

    let schoolId = dto.schoolId;

  // ✅ DIRECTOR SECURITY (Teacher.userId orqali)
if (user?.role === 'DIRECTOR') {
  const directorTeacher = await this.prisma.teacher.findFirst({
    where: { userId: user.id, type: 'DIRECTOR' },
    select: { schoolId: true },
  });

  if (!directorTeacher?.schoolId) {
    throw new Error('Director school not found');
  }

  schoolId = directorTeacher.schoolId;
}

if (!schoolId && user?.role !== 'SUPER_ADMIN') {
  throw new Error('schoolId required');
}

// ✅ Parents (Parent’da schoolId yo’q, relation orqali filter!)
    const parentsPromise = target.includes('PARENTS')
    ? this.prisma.parent.findMany({
      where: {
        students: {
          some: { student: { schoolId } },
        },
      },
      select: {
        id: true,
        phone: true,
        isTelegramActive: true,
        telegramChatId: true,
        isWhatsappActive: true,
        whatsappPhone: true,
      },
    })
  : Promise.resolve([]);

// ✅ Teachers
    const teachersPromise = target.includes('TEACHERS') || target.includes('DIRECTORS')
    ? this.prisma.teacher.findMany({
      where: {
        schoolId,
        ...(target === 'DIRECTORS_ALL' ? { type: 'DIRECTOR' } : {}),
      },
      select: {
        id: true,
        phone: true,
        isTelegramActive: true,
        telegramChatId: true,
      },
    })
    : Promise.resolve([]);

    const [parents, teachers] = await Promise.all([parentsPromise, teachersPromise]);

    // recipients with tag
    const recipients: Array<{
      recipientType: 'PARENT' | 'TEACHER';
      id: string;
      phone?: string | null;
      isTelegramActive?: boolean | null;
      telegramChatId?: string | null;
      isWhatsappActive?: boolean | null;
      whatsappPhone?: string | null;
    }> = [
      ...parents.map((p) => ({ recipientType: 'PARENT' as const, ...p })),
      ...teachers.map((t) => ({ recipientType: 'TEACHER' as const, ...t, isWhatsappActive: null, whatsappPhone: null })),
    ];
    

    // =========================
    // BULK SEND (concurrency)
    // =========================
    let sentTelegram = 0;
    let sentSms = 0;
    let failed = 0;

    const tasks: Array<() => Promise<void>> = recipients.map((r) => async () => {
      try {
        const res = await this.sendToRecipient({
          channel,
          recipientType: r.recipientType,
          recipientId: r.id,
          phone: r.phone,
          isTelegramActive: r.isTelegramActive,
          telegramChatId: r.telegramChatId,
          isWhatsappActive: r.isWhatsappActive,
          whatsappPhone: r.whatsappPhone,
          title,
          message,
          notifType: 'BROADCAST',
        });

        if (res.telegram.sent) sentTelegram++;
        if (res.sms.sent) sentSms++;

        // fail hisoblash: faqat attempted kanallar bo‘yicha
        const tgFailed = res.telegram.attempted && !res.telegram.sent && !res.telegram.skipped;
        const smsFailed = res.sms.attempted && !res.sms.sent;

        if (tgFailed || smsFailed) failed++;
      } catch (e: any) {
        failed++;
        this.logger.error(`Broadcast failed recipient=${r.id}: ${e?.message ?? e}`);
      }
    });

    await this.runWithConcurrency(tasks, 20);

    return {
      total: recipients.length,
      sentTelegram,
      sentSms,
      failed,
    };
  }

  // =========================
  // CONCURRENCY RUNNER (no extra deps)
  // =========================
  private async runWithConcurrency(tasks: Array<() => Promise<void>>, limit: number) {
    if (!tasks.length) return;

    let index = 0;

    const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
      while (true) {
        const i = index++;
        if (i >= tasks.length) break;
        await tasks[i]();
      }
    });

    await Promise.all(workers);
  }

  // =========================
  // MESSAGE FORMATTERS
  // =========================
  private formatAttendanceMessage(
    firstName: string,
    lastName: string,
    status: string,
    checkInTime?: Date,
  ): string {
    const name = `${firstName} ${lastName}`.trim();
    const time = checkInTime
      ? checkInTime.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
      : '';

    if (status === 'PRESENT') {
      return `✅ Ваш ребёнок ${name} сегодня пришёл в школу.\nВремя: ${time}`;
    } else if (status === 'LATE') {
      return `⚠️ Ваш ребёнок ${name} сегодня опоздал.\nВремя: ${time}`;
    } else {
      return `❌ Ваш ребёнок ${name} сегодня не пришёл в школу.`;
    }
  }

  private formatPaymentReminderMessage(
    firstName: string,
    lastName: string,
    amount: number,
    dueDate: Date,
  ): string {
    return (
      `⚠️ Напоминание об оплате!\n\n` +
      `Ученик: ${firstName} ${lastName}\n` +
      `Сумма: ${amount.toLocaleString('ru-RU')} сум\n` +
      `Срок: ${dueDate.toLocaleDateString('ru-RU')}\n\n` +
      `Осталось 3 дня!`
    );
  }

  private formatPaymentConfirmationMessage(
    firstName: string,
    lastName: string,
    amount: number,
    paidDate: Date,
  ): string {
    return (
      `✅ Оплата принята!\n\n` +
      `Ученик: ${firstName} ${lastName}\n` +
      `Сумма: ${amount.toLocaleString('ru-RU')} сум\n` +
      `Дата: ${paidDate.toLocaleDateString('ru-RU')}`
    );
  }

  async sendBillingInvoiceNotices(
    paymentIds: string[],
    meta: { plan: BillingPlan; periodKey: string },
  ) {
    if (!paymentIds?.length) return { total: 0, totalSent: 0, failed: 0, skipped: 0 };
  
    // =========================
    // Production config
    // =========================
    const MAX_NOTIFY = Number(process.env.BILLING_NOTIFY_MAX ?? 3);           // har invoice max nechta yuboriladi
    const COOLDOWN_HOURS = Number(process.env.BILLING_NOTIFY_COOLDOWN_H ?? 24); // qayta yuborish oraliği (soat)
    const CONCURRENCY = Number(process.env.BILLING_NOTIFY_CONCURRENCY ?? 20);
  
    const now = new Date();
    const cooldownDate = new Date(now.getTime() - COOLDOWN_HOURS * 60 * 60 * 1000);
  
    // =========================
    // 1) Load payments with anti-spam filters
    // =========================
    const payments = await this.prisma.payment.findMany({
      where: {
        id: { in: paymentIds },
        notifyCount: { lt: MAX_NOTIFY },
        OR: [{ notifiedAt: null }, { notifiedAt: { lt: cooldownDate } }],
      },
      select: {
        id: true,
        plan: true,
        periodKey: true,
        amount: true,
        dueDate: true,
        status: true,
        waiveReason: true,
        notifyCount: true,
        student: {
          select: {
            firstName: true,
            lastName: true,
            parents: {
              where: { notifySms: true },
              select: {
                parent: {
                  select: {
                    id: true,
                    phone: true,
                    isTelegramActive: true,
                    telegramChatId: true,
                  },
                },
              },
            },
          },
        },
      },
    });
  
    // paymentIds bor, lekin anti-spam filter tufayli bo‘sh bo‘lishi mumkin
    const skipped = paymentIds.length - payments.length;
  
    if (!payments.length) {
      return { total: 0, totalSent: 0, failed: 0, skipped };
    }
  
    // =========================
    // 2) Prepare tasks (parallel)
    // =========================
    let total = 0;
    let totalSent = 0;
    let failed = 0;
  
    const paymentIdsToUpdate = new Set<string>();
  
    const planLabel = (p: BillingPlan) => (p === BillingPlan.YEARLY ? 'Годовой' : 'Ежемесячный');
  
    const tasks: Array<() => Promise<void>> = [];
  
    for (const p of payments) {
      if (!p.student) continue;
  
      const period = p.periodKey || meta?.periodKey || '';
      const title =
        p.status === PaymentStatus.WAIVED
          ? '✅ Льгота применена'
          : '⚠️ Счёт на оплату';
  
      const fullName = `${p.student.firstName ?? ''} ${p.student.lastName ?? ''}`.trim();
      const due = p.dueDate ? new Date(p.dueDate).toLocaleDateString('ru-RU') : '—';
  
      const message =
        p.status === PaymentStatus.WAIVED
          ? (
              `Ученик: ${fullName}\n` +
              `План: ${planLabel(p.plan)}\n` +
              `Период: ${period}\n` +
              `Сумма к оплате: 0 сум\n` +
              `Причина: ${p.waiveReason ?? '—'}\n\n` +
              `Льгота активна ✅`
            )
          : (
              `Ученик: ${fullName}\n` +
              `План: ${planLabel(p.plan)}\n` +
              `Период: ${period}\n` +
              `Сумма: ${Number(p.amount).toLocaleString('ru-RU')} сум\n` +
              `Срок: ${due}\n\n` +
              `Пожалуйста, оплатите вовремя.`
            );
  
      for (const link of p.student.parents) {
        const parent = link.parent;
        if (!parent) continue;
  
        total++;
  
        tasks.push(async () => {
          try {
            const res = await this.sendToRecipient({
              channel: 'ALL',
              recipientType: 'PARENT',
              recipientId: parent.id,
              phone: parent.phone,
              isTelegramActive: parent.isTelegramActive,
              telegramChatId: parent.telegramChatId,
              title,
              message,
              notifType: 'BILLING_INVOICE',
            });
  
            // ✅ Sent bo‘lsa hisoblaymiz
            const anySent = Boolean(res.telegram.sent || res.sms.sent);
            if (anySent) {
              totalSent++;
              paymentIdsToUpdate.add(p.id); // shu payment bo‘yicha notifyCount++ qilamiz
            } else {
              failed++;
            }
          } catch (e: any) {
            failed++;
            this.logger.error(`Billing invoice notice failed parent=${parent.id} payment=${p.id}: ${e?.message ?? e}`);
          }
        });
      }
    }
  
    // =========================
    // 3) Run with concurrency
    // =========================
    await this.runWithConcurrency(tasks, 8);
  
    // =========================
    // 4) Update notifiedAt + notifyCount (safe, no updateMany increment)
    // =========================
    const ids = Array.from(paymentIdsToUpdate);
    if (ids.length) {
      try {
        const chunkSize = 50;
        for (let i = 0; i < ids.length; i += chunkSize) {
          const chunk = ids.slice(i, i + chunkSize);
  
          await Promise.all(
            chunk.map((pid) =>
              this.prisma.payment.update({
                where: { id: pid },
                data: {
                  notifiedAt: now,
                  notifyCount: { increment: 1 }, // ✅ update supports increment reliably
                },
              }),
            ),
          );
        }
      } catch (e: any) {
        // best-effort: sending bo‘ldi, faqat counter yangilanmadi
        this.logger.warn(`Payment notifiedAt/notifyCount update skipped: ${e?.message ?? e}`);
      }
    }
  
    return { total, totalSent, failed, skipped };
  }
}