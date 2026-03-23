import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService } from '../notifications/telegram.service';
import { SmsService } from '../notifications/sms.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';

const TZ = 'Asia/Bishkek';
const ABSENT_DAYS_THRESHOLD = 3;

/**
 * So'nggi N ta maktab kunini qaytaradi (Du-Ju, bugunni ham kiritadi)
 * Masalan: bugun Chorshanba → [Dushanba, Seshanba, Chorshanba]
 */
function lastSchoolDays(count: number): Date[] {
  const days: Date[] = [];
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);

  while (days.length < count) {
    const dow = cursor.getDay(); // 0=Yak, 6=Shanba
    if (dow !== 0 && dow !== 6) {
      days.unshift(new Date(cursor));
    }
    cursor.setDate(cursor.getDate() - 1);
  }
  return days;
}

@Injectable()
export class AbsentDaysCron {
  private readonly logger = new Logger(AbsentDaysCron.name);

  constructor(
    private prisma: PrismaService,
    private telegram: TelegramService,
    private sms: SmsService,
    private wa: WhatsappService,
  ) {}

  // Har kuni 18:00 Bishkek vaqtida (UTC+6 = 12:00 UTC)
  @Cron('0 12 * * 1-5')
  async checkAbsentStudents() {
    this.logger.log('🔍 Absent-days cron started');

    const schoolDays = lastSchoolDays(ABSENT_DAYS_THRESHOLD);
    const dayStart = schoolDays[0];
    const dayEnd = new Date(schoolDays[schoolDays.length - 1]);
    dayEnd.setHours(23, 59, 59, 999);

    // Faqat rasmi bor studentlar — rasmsiz studentlarga xabar yuborilmaydi
    const students = await this.prisma.student.findMany({
      where: { photo: { not: null } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        photo: true,
        schoolId: true,
        isSmsEnabled: true,
        phone: true,
        parents: {
          include: {
            parent: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
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
    });

    if (!students.length) return;

    // Shu 3 kun ichida kelgan studentlar (attendance record bor)
    const attendanceRecords = await this.prisma.attendance.findMany({
      where: {
        studentId: { in: students.map((s) => s.id) },
        date: { gte: dayStart, lte: dayEnd },
      },
      select: { studentId: true, date: true },
    });

    // Qaysi kunlarda kelgan: studentId → Set<YYYY-MM-DD>
    const presentDays = new Map<string, Set<string>>();
    for (const r of attendanceRecords) {
      const key = r.date.toISOString().slice(0, 10);
      if (!presentDays.has(r.studentId)) presentDays.set(r.studentId, new Set());
      presentDays.get(r.studentId)!.add(key);
    }

    const schoolDayKeys = schoolDays.map((d) => d.toISOString().slice(0, 10));

    let notified = 0;

    for (const student of students) {
      const present = presentDays.get(student.id);

      // Agar 3 maktab kunining birortasida ham kelmagan bo'lsa
      const allAbsent = schoolDayKeys.every((dk) => !present?.has(dk));
      if (!allAbsent) continue;

      // Redis cooldown: bir kunda bir marta yuborilsin
      // (soddalik uchun DB ga yozamiz — Redis bo'lmasa ham ishlaydi)
      const alreadyNotified = await this.prisma.auditLog
        .findFirst({
          where: {
            action: 'ABSENT_3DAYS_NOTIF',
            entityId: student.id,
            createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
          },
        })
        .catch(() => null);

      if (alreadyNotified) continue;

      const parents = student.parents.map((sp) => sp.parent).filter(Boolean);
      if (!parents.length) continue;

      const studentName = `${student.firstName} ${student.lastName}`;
      const message =
        `❗ Уважаемый(ая) родитель!\n\n` +
        `Ваш ребёнок *${studentName}* не посещает школу уже ${ABSENT_DAYS_THRESHOLD} дня подряд.\n\n` +
        `Пожалуйста, свяжитесь с директором школы или классным руководителем и объясните причину отсутствия.\n\n` +
        `Администрация школы.`;

      for (const parent of parents) {
        try {
          if (parent.isWhatsappActive && parent.whatsappPhone) {
            await this.wa.sendText(parent.whatsappPhone, message);
            this.logger.log(`📱 Absent-3days WA → ${parent.whatsappPhone} (${studentName})`);
          }

          if (parent.isTelegramActive && parent.telegramChatId) {
            await this.telegram.sendMessage(parent.telegramChatId, message.replace(/\*/g, ''));
            this.logger.log(`📱 Absent-3days TG → ${parent.telegramChatId} (${studentName})`);
          }

          if (parent.phone && student.isSmsEnabled) {
            const smsMsg =
              `Уважаемый(ая) родитель! Ваш ребёнок ${studentName} не посещает школу ` +
              `${ABSENT_DAYS_THRESHOLD} дня подряд. Свяжитесь с директором или классным руководителем.`;
            await this.sms.sendSms(parent.phone, smsMsg);
            this.logger.log(`📱 Absent-3days SMS → ${parent.phone} (${studentName})`);
          }
        } catch (err: any) {
          this.logger.error(`Absent-3days notif error (${studentName}): ${err?.message}`);
        }
      }

      // Log qilib qo'yamiz — qayta yuborilmasin
      await this.prisma.auditLog.create({
        data: {
          action: 'ABSENT_3DAYS_NOTIF',
          entity: 'Student',
          entityId: student.id,
          schoolId: student.schoolId,
          details: { studentName, schoolDays: schoolDayKeys },
        },
      }).catch(() => {});

      notified++;
    }

    this.logger.log(`✅ Absent-days cron done: ${notified} students notified`);
  }
}
