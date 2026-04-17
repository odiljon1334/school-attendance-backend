import { Injectable, NotFoundException, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService } from '../notifications/telegram.service';
import { SmsService } from '../notifications/sms.service';
import { CreateAttendanceDto, UpdateAttendanceDto } from './dto/attendance.dto';
import { RedisService } from 'src/redis/redis.service';
import { DashboardService } from 'src/dashboard/dashboard.service';
import { ConfigService } from '@nestjs/config';
import { WhatsappService } from 'src/whatsapp/whatsapp.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AttendanceGateway } from './attendance.gateway';

const MIN_CHECKOUT_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 soat (checkout uchun)
const RE_ENTRY_GRACE_MS = 10 * 60 * 1000; // 10 daqiqa
const ABSENT_THRESHOLD_MIN = 6 * 60; // 360 daqiqa = 6 soat
const SCHOOL_START_HOUR = 8; // 09:00
const NOTIF_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 soat xabar cheklash!

type PersonType = 'STUDENT' | 'TEACHER' | 'DIRECTOR';
type PersonResolved = any & { type: PersonType };

@Injectable()
export class AttendanceService {
  private readonly logger = new Logger(AttendanceService.name);

  constructor(
    private prisma: PrismaService,
    private telegramService: TelegramService,
    private smsService: SmsService,
    private redis: RedisService,
    private configService: ConfigService,
    private wa: WhatsappService,
    private auditLog: AuditLogService,
    @Optional() private gateway: AttendanceGateway,
  ) {}

  // ======================================================
  // REPORT
  // ======================================================
  async generateReport(dto: {
    schoolId: string;
    startDate?: string;
    endDate?: string;
    classId?: string;
    studentId?: string;
    teacherId?: string;
    limit?: number;
    offset?: number;
  }) {
    const where: any = { schoolId: dto.schoolId };

    if (dto.studentId) where.studentId = dto.studentId;
    if (dto.teacherId) where.teacherId = dto.teacherId;

    if (dto.classId) {
      where.student = { classId: dto.classId };
    }

    if (dto.startDate || dto.endDate) {
      const start = dto.startDate ? new Date(dto.startDate) : new Date('1970-01-01');
      const end = dto.endDate ? new Date(dto.endDate) : new Date();
      end.setHours(23, 59, 59, 999);
      where.date = { gte: start, lte: end };
    }

    const limit  = Math.min(dto.limit  ?? 500, 1000); // max 1000 per request
    const offset = dto.offset ?? 0;

    const [records, total] = await Promise.all([
      this.prisma.attendance.findMany({
        where,
        orderBy: { date: 'desc' },
        take:  limit,
        skip:  offset,
        include: {
          student: { select: { id: true, firstName: true, lastName: true, photo: true, class: { select: { grade: true, section: true } } } },
          teacher: { select: { id: true, firstName: true, lastName: true, photo: true, type: true } },
        },
      }),
      this.prisma.attendance.count({ where }),
    ]);

    return { records, total, limit, offset };
  }

  // ======================================================
  // ✅ CACHE INVALIDATION
  // ======================================================
  private async invalidateDashboardCache(schoolId: string) {
    try {
      const keysToDelete = [
        `dashboard:school:${schoolId}`,
        `dashboard:overview`,
        `cache:attendance:today:${schoolId}:*`,
        `cache:stats:today:${schoolId}`,
      ];

      const trendKeys = await this.redis.smembers(`dashboard:keys:school:${schoolId}`);
      if (trendKeys?.length) {
        keysToDelete.push(...trendKeys);
        keysToDelete.push(`dashboard:keys:school:${schoolId}`);
      }

      const school = await this.prisma.school.findUnique({
        where: { id: schoolId },
        select: { districtId: true },
      });

      if (school?.districtId) {
        keysToDelete.push(`dashboard:district:${school.districtId}`);
      }

      await this.redis.del(...keysToDelete);
      await this.redis.deleteCachePattern(`attendance:today:${schoolId}:*`);
      await this.redis.deleteCachePattern(`classes:all:${schoolId}:*`);

      this.logger.log(`✅ Cache invalidated for school: ${schoolId}`);
    } catch (error) {
      this.logger.error('Cache invalidation error:', error);
    }
  }

  // ======================================================
  // MAIN: TURNSTILE EVENT (HikvisionService dan keladi)
  // personId: "STU_<uuid>" | "TCH_<uuid>" | "DIR_<uuid>"
  // ======================================================
  async handleTurnstileEvent(event: {
    personId: string;
    deviceId: string;
    timestamp: string;
    eventType: string;
    capturePhoto?: string;
  }) {
    try {
      const personKey = String(event.personId || '').trim();
      if (!personKey) return { success: false, message: 'personId missing' };

      this.logger.log(`🔔 Turnstile event: ${personKey} device=${event.deviceId}`);

      const person = await this.resolvePerson(personKey);
      if (!person) {
        this.logger.warn(`⚠️ Person not found: ${personKey}`);
        return { success: false, message: 'Person not found' };
      }

      const now = new Date(event.timestamp || Date.now());
      const res = await this.processAttendanceLogic({
        person,
        now,
        deviceId: event.deviceId,
        capturePhoto: event.capturePhoto,
      });

      return res;
    } catch (error) {
      this.logger.error('Turnstile event error:', error);
      throw error;
    }
  }

  // ======================================================
  // CORE LOGIKA
  // ======================================================
  private async processAttendanceLogic(params: {
    person: PersonResolved;
    now: Date;
    deviceId: string;
    capturePhoto?: string;
  }) {
    const { person, now, deviceId, capturePhoto } = params;

    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);

    const existing = await this.prisma.attendance.findFirst({
      where: {
        date: { gte: todayStart, lte: todayEnd },
        studentId: person.type === 'STUDENT' ? person.id : undefined,
        teacherId: person.type === 'TEACHER' || person.type === 'DIRECTOR' ? person.id : undefined,
      },
      orderBy: { checkInTime: 'desc' },
    });

    // CASE 1: Bugun hali kelmagan
    if (!existing) {
      return this.handleCheckIn({ person, now, deviceId, capturePhoto, existing: null });
    }

    // CASE 2: Maktabda (hali chiqmagan)
    if (!existing.checkOutTime) {
      const timeSinceCheckIn = now.getTime() - existing.checkInTime.getTime();

      if (timeSinceCheckIn >= MIN_CHECKOUT_INTERVAL_MS) {
        return this.handleCheckOut({ person, record: existing, now, capturePhoto });
      }

      const minutesLeft = Math.ceil((MIN_CHECKOUT_INTERVAL_MS - timeSinceCheckIn) / 60000);
      this.logger.log(`⏸️ IGNORED: ${person.firstName} — checkout in ${minutesLeft} min`);
      return {
        success: true,
        action: 'IGNORED',
        message: `Checkout available in ${minutesLeft} min`,
      };
    }

    // CASE 3: Chiqib ketgan
    const timeSinceCheckOut = now.getTime() - existing.checkOutTime.getTime();

    if (timeSinceCheckOut <= RE_ENTRY_GRACE_MS) {
      const minutesSince = Math.floor(timeSinceCheckOut / 60000);
      this.logger.log(`⏸️ IGNORED: ${person.firstName} re-entered within grace (${minutesSince} min)`);
      return {
        success: true,
        action: 'IGNORED',
        message: `Re-entry within 10 min grace`,
      };
    }

    const minutesAway = Math.floor(timeSinceCheckOut / 60000);
    this.logger.log(`🔁 RE-ENTRY LATE: ${person.firstName} — away ${minutesAway} min`);
    return this.handleCheckIn({ person, now, deviceId, capturePhoto, existing });
  }

  // ======================================================
  // CHECK-IN HANDLER
  // ======================================================
  private async handleCheckIn(params: {
    person: PersonResolved;
    now: Date;
    deviceId: string;
    capturePhoto?: string;
    existing: any | null;
  }) {
    const { person, now, deviceId, capturePhoto, existing } = params;

    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const hour = now.getHours();
    const minute = now.getMinutes();
    const isLate = hour > SCHOOL_START_HOUR || (hour === SCHOOL_START_HOUR && minute > 0);
    const lateMinutes = isLate ? (hour - SCHOOL_START_HOUR) * 60 + minute : 0;

    let attendance: any;

    if (!existing) {
      try {
        attendance = await this.prisma.attendance.create({
          data: {
            schoolId: person.schoolId,
            studentId: person.type === 'STUDENT' ? person.id : undefined,
            teacherId: person.type === 'TEACHER' || person.type === 'DIRECTOR' ? person.id : undefined,
            date: todayStart,
            status: isLate ? 'LATE' : 'PRESENT',
            checkInTime: now,
            checkOutTime: null,
            lateMinutes: lateMinutes > 0 ? lateMinutes : 0,
            lateCount: isLate ? 1 : 0,
            deviceId,
          },
        });

        this.logger.log(
          `✅ CHECK-IN (new): ${person.firstName} | ${now.toTimeString().slice(0, 5)} | Late: ${isLate}`,
        );
      } catch (err: any) {
        // P2002 = unique constraint — ikkita parallel so'rov bir vaqtda create qilmoqchi bo'ldi
        // Birinchisi muvaffaqiyatli yaratdi, ikkinchisini ignore qilamiz
        if (err?.code === 'P2002') {
          this.logger.warn(
            `Race condition (P2002) — duplicate check-in ignored for ${person.firstName} ${person.lastName}`,
          );
          return { success: true, action: 'IGNORED', message: 'Duplicate concurrent scan' };
        }
        throw err;
      }
    } else {
      const newLateMinutes = (existing.lateMinutes || 0) + lateMinutes;
      const newLateCount = (existing.lateCount || 0) + 1;

      attendance = await this.prisma.attendance.update({
        where: { id: existing.id },
        data: {
          status: isLate ? 'LATE' : 'PRESENT',
          checkInTime: now,
          checkOutTime: null,
          lateMinutes: newLateMinutes,
          lateCount: newLateCount,
        },
      });

      this.logger.log(
        `✅ CHECK-IN (re-entry): ${person.firstName} | Late count: ${newLateCount} | Total: ${newLateMinutes} min`,
      );
    }

    await this.redis.incrementTodayCheckIn(person.schoolId);

    if (person.type === 'STUDENT') {
      const totalAttendance = await this.prisma.attendance.count({
        where: { studentId: person.id },
      });
      await this.redis.updateAttendanceLeaderboard(person.schoolId, person.id, totalAttendance);

      const canNotify = await this.acquireNotificationCooldownLock({
        schoolId: person.schoolId,
        personType: person.type,
        personId: person.id,
        kind: 'CHECK_IN',
      });

      if (canNotify) {
        await this.sendCheckInNotification({ person, attendance, isLate, lateMinutes, capturePhoto });
      } else {
        this.logger.log(`🔕 CHECK-IN notif suppressed (cooldown): student=${person.id}`);
      }

      if (isLate) {
        await this.checkWeeklyAbsence(person, now);
      }
    }

    if (person.type === 'TEACHER' || person.type === 'DIRECTOR') {
      await this.sendTeacherScanNotification({ person, attendance, capturePhoto, action: 'CHECK_IN' });
    }

    await this.invalidateDashboardCache(person.schoolId);

    // ── Real-time WebSocket broadcast ──
    try {
      this.gateway?.emit({
        attendanceId: attendance.id,
        schoolId: person.schoolId,
        personName: `${person.firstName ?? ''} ${person.lastName ?? ''}`.trim(),
        personType: person.type,
        className: person.class?.name ?? person.className ?? undefined,
        photo: capturePhoto ?? undefined,
        time: now.toISOString(),
        isLate,
        action: 'CHECK_IN',
      });
    } catch (e) {
      this.logger.warn('WS emit failed (non-critical):', e?.message);
    }

    return { success: true, action: 'CHECK_IN', attendance };
  }

  // ======================================================
  // CHECK-OUT HANDLER
  // ======================================================
  private async handleCheckOut(params: { person: PersonResolved; record: any; now: Date; capturePhoto?: string }) {
    const { person, record, now, capturePhoto } = params;

    const updated = await this.prisma.attendance.update({
      where: { id: record.id },
      data: { checkOutTime: now },
    });

    this.logger.log(`🚪 CHECK-OUT: ${person.firstName} | ${now.toTimeString().slice(0, 5)}`);

    if (person.type === 'STUDENT') {
      const canNotify = await this.acquireNotificationCooldownLock({
        schoolId: person.schoolId,
        personType: person.type,
        personId: person.id,
        kind: 'CHECK_OUT',
      });

      if (canNotify) {
        await this.sendCheckOutNotification({ person, attendance: updated, capturePhoto });
      } else {
        this.logger.log(`🔕 CHECK-OUT notif suppressed (cooldown): student=${person.id}`);
      }
    }

    if (person.type === 'TEACHER' || person.type === 'DIRECTOR') {
      await this.sendTeacherScanNotification({ person, attendance: updated, capturePhoto, action: 'CHECK_OUT' });
    }

    await this.invalidateDashboardCache(person.schoolId);

    // ── Real-time WebSocket broadcast ──
    try {
      this.gateway?.emit({
        attendanceId: updated.id,
        schoolId: person.schoolId,
        personName: `${person.firstName ?? ''} ${person.lastName ?? ''}`.trim(),
        personType: person.type,
        photo: capturePhoto ?? undefined,
        time: now.toISOString(),
        isLate: false,
        action: 'CHECK_OUT',
      });
    } catch (e) {
      this.logger.warn('WS emit failed (non-critical):', e?.message);
    }

    return { success: true, action: 'CHECK_OUT', attendance: updated };
  }

  // ======================================================
  // HAFTALIK KECHIKISH TEKSHIRUVI
  // ======================================================
  private async checkWeeklyAbsence(person: PersonResolved, now: Date) {
    const weekStart = new Date(now);
    const day = weekStart.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    weekStart.setDate(weekStart.getDate() + diff);
    weekStart.setHours(0, 0, 0, 0);

    const weekRecords = await this.prisma.attendance.findMany({
      where: {
        studentId: person.id,
        date: { gte: weekStart },
      },
    });

    const totalLateMinutes = weekRecords.reduce((sum, r) => sum + (r.lateMinutes || 0), 0);

    this.logger.log(`📊 Weekly late: ${person.firstName} | ${totalLateMinutes} min / ${ABSENT_THRESHOLD_MIN} min`);

    if (totalLateMinutes >= ABSENT_THRESHOLD_MIN) {
      this.logger.warn(`⚠️ ABSENT: ${person.firstName} | ${totalLateMinutes} min this week!`);
      await this.sendAbsentNotification({ person, totalLateMinutes });
    }
  }

  // ======================================================
  // NOTIF COOLDOWN (2 soat)
  // ======================================================
  private async acquireNotificationCooldownLock(params: {
    schoolId: string;
    personType: PersonType;
    personId: string;
    kind: 'CHECK_IN' | 'CHECK_OUT' | 'ABSENT';
  }): Promise<boolean> {
    if (params.personType !== 'STUDENT') return false;

    const ttlSec = Math.max(1, Math.floor(NOTIF_COOLDOWN_MS / 1000));
    const key = `notif:cooldown:${params.kind}:${params.schoolId}:${params.personId}`;

    const exists = await this.redis.getCache(key);
    if (exists) return false;

    await this.redis.setCache(key, { at: Date.now() }, ttlSec);
    return true;
  }

  // ======================================================
  // TO'LOV TEKSHIRUVI
  // ======================================================
  private async canSendNotification(student: any): Promise<{
    sms: boolean;
    telegram: boolean;
    reason?: string;
  }> {
    const now = new Date();

    if (!student.isSmsEnabled) {
      return { sms: false, telegram: true, reason: 'SMS disabled' };
    }

    if (student.smsPaidUntil && student.smsPaidUntil < now) {
      this.logger.warn(
        `SMS subscription expired for ${student.firstName} ${student.lastName} (expired: ${student.smsPaidUntil})`,
      );

      try {
        await this.prisma.student.update({
          where: { id: student.id },
          data: { isSmsEnabled: false },
        });
      } catch (err) {
        this.logger.error('Failed to auto-disable SMS:', err);
      }

      return { sms: false, telegram: true, reason: 'SMS subscription expired' };
    }

    return { sms: true, telegram: true };
  }

  // ======================================================
  // WA HELPERS
  // ======================================================

  /** Birinchi marta yuborilayotgan bo'lsa — professional tanishtiruv xabari */
  private async sendWaWelcomeIfNeeded(
    phone: string,
    parent: any,
    student: any,
    school: any,
  ): Promise<void> {
    const key = `wa:welcome:${parent.id}`;
    if (await this.redis.get(key)) return;

    const parentName = `${parent.firstName || ''} ${parent.lastName || ''}`.trim() || 'Hurmatli ota-ona';
    const studentName = `${student.firstName} ${student.lastName}`.trim();
    const schoolName = school?.name ?? 'Maktab';

    const msg =
      `👋 Ассаламу алейкум, уважаемый(ая) *${parentName}*!\n\n` +
      `Вы подключены к автоматической системе оповещения учебного заведения:\n` +
      `🏫 *${schoolName}*\n\n` +
      `Данный сервис будет информировать вас о посещаемости вашего ребёнка — *${studentName}*.\n\n` +
      `📌 *Что вы будете получать:*\n` +
      `• ✅ Уведомление о приходе в школу (с фото)\n` +
      `• ⏰ Уведомление об опоздании\n` +
      `• 🚪 Уведомление об уходе из школы\n` +
      `• ❌ Уведомление об отсутствии\n\n` +
      `По вопросам обращайтесь к администрации школы.\n\n` +
      `_${schoolName} — система контроля посещаемости_`;

    await this.wa.sendText(phone, msg).catch(() => {});
    await this.redis.set(key, '1');
  }

  /** Har bir WA xabardan keyin 3 ta tezkor tugma yuboradi */
  private async sendWaNotifButtons(phone: string): Promise<void> {
    await this.wa.sendButtons(
      phone,
      'Выберите действие:',
      [
        { id: 'today', title: '📋 Меню' },
        { id: 'school', title: 'ℹ️ Инфо' },
        { id: 'pay', title: '💳 Оплата' },
      ],
    ).catch(() => {}); // non-critical — tugma ishlamasa o'tkazib ketamiz
  }

  // ======================================================
  // CHECK-IN NOTIFICATION
  // ======================================================
  private async sendCheckInNotification(params: {
    person: PersonResolved;
    attendance: any;
    isLate: boolean;
    lateMinutes: number;
    capturePhoto?: string;
  }) {
    const { person, attendance, isLate, lateMinutes, capturePhoto } = params;

    const canSend = await this.canSendNotification(person);

    const TZ = 'Asia/Bishkek';
    const time = attendance.checkInTime.toLocaleTimeString('ru-RU', {
      hour: '2-digit', minute: '2-digit', timeZone: TZ,
    });
    const date = new Date().toLocaleDateString('ru-RU', {
      day: '2-digit', month: '2-digit', year: 'numeric', timeZone: TZ,
    });
    const school = (person as any).school;
    const studentName = `${person.firstName} ${person.lastName}`;
    const photoToSend = capturePhoto || person.photo || null;

    for (const parent of person.parents || []) {
      try {
        const parentName = `${parent.firstName || ''} ${parent.lastName || ''}`.trim();
        const effectiveWaPhone = parent.whatsappPhone || parent.phone;

        // ✅ WhatsApp — foto + tanishtiruv (birinchi marta) + tugmalar
        if (effectiveWaPhone) {
          await this.sendWaWelcomeIfNeeded(effectiveWaPhone, parent, person, school);

          const waMsg =
            `*ПОСЕЩАЕМОСТЬ* 🏫\n\n` +
            `Здравствуйте, *${parentName}*!\n\n` +
            `🎒 *${studentName}*\n` +
            (isLate
              ? `⏰ Опоздал(а) на *${lateMinutes} мин*\nВремя: ${time}`
              : `✅ Прибыл(а) в школу\n🕐 Время: *${time}*`) +
            `\n📅 ${date}\n\n_${school?.name ?? 'Администрация школы'}_`;

          if (photoToSend) {
            await this.wa.sendPhoto(effectiveWaPhone, photoToSend, waMsg).catch(
              () => this.wa.sendText(effectiveWaPhone, waMsg).catch(() => {}),
            );
          } else {
            await this.wa.sendText(effectiveWaPhone, waMsg).catch(() => {});
          }
          await this.sendWaNotifButtons(effectiveWaPhone);
          this.logger.log(`WA check-in → ${effectiveWaPhone} (photo: ${!!photoToSend})`);
        }

        // ✅ SMS — WhatsApp yo'q bo'lgan ota-onalarga
        if (parent.phone && canSend.sms && !parent.isWhatsappActive) {
          const smsMessage = this.smsService.buildCheckInMessage({
            parentName,
            studentName,
            time,
            isLate,
            lateMinutes,
          });
          await this.smsService.sendSms(parent.phone, smsMessage);
          this.logger.log(`SMS check-in → ${parent.phone}`);
        }

        // ✅ Telegram
        if (parent.isTelegramActive && parent.telegramChatId && canSend.telegram) {
          const tgMsg =
            `Здравствуйте, ${parentName}!\n\n` +
            `Ваш ребёнок: ${studentName}\n` +
            (isLate ? `Опоздал(а) на ${lateMinutes} мин. Время: ${time}` : `Прибыл(а) в школу. Время: ${time}`) +
            `\nДата: ${date}\n\nАдминистрация школы.`;
          if (capturePhoto) {
            await this.telegramService.sendPhotoFromBase64(parent.telegramChatId, capturePhoto, tgMsg);
          } else {
            await this.telegramService.sendMessage(parent.telegramChatId, tgMsg);
          }
          this.logger.log(`TG check-in → ${parent.telegramChatId}`);
        }
      } catch (error: any) {
        this.logger.error(`Check-in notif error (parent ${parent.id}): ${error?.message}`);
      }
    }
  }

  // ======================================================
  // CHECK-OUT NOTIFICATION
  // ======================================================
  private async sendCheckOutNotification(params: { person: PersonResolved; attendance: any; capturePhoto?: string }) {
    const { person, attendance, capturePhoto } = params;

    const canSend = await this.canSendNotification(person);

    const TZ = 'Asia/Bishkek';
    const checkInTime = attendance.checkInTime.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
    const checkOutTime = attendance.checkOutTime.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
    const date = new Date().toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: TZ });
    const school = (person as any).school;
    const studentName = `${person.firstName} ${person.lastName}`;
    const photoToSend = capturePhoto || person.photo || null;

    for (const parent of person.parents || []) {
      try {
        const parentName = `${parent.firstName || ''} ${parent.lastName || ''}`.trim();
        const effectiveWaPhone = parent.whatsappPhone || parent.phone;

        // ✅ WhatsApp
        if (effectiveWaPhone) {
          await this.sendWaWelcomeIfNeeded(effectiveWaPhone, parent, person, school);

          const waMsg =
            `*УЧЕНИК ПОКИНУЛ ШКОЛУ* 🚪\n\n` +
            `Здравствуйте, *${parentName}*!\n\n` +
            `🎒 *${studentName}*\n` +
            `🚪 Покинул(а) школу: *${checkOutTime}*\n` +
            `🕐 Прибыл(а): ${checkInTime}\n` +
            `📅 ${date}\n\n_${school?.name ?? 'Администрация школы'}_`;

          if (photoToSend) {
            await this.wa.sendPhoto(effectiveWaPhone, photoToSend, waMsg).catch(
              () => this.wa.sendText(effectiveWaPhone, waMsg).catch(() => {}),
            );
          } else {
            await this.wa.sendText(effectiveWaPhone, waMsg).catch(() => {});
          }
          await this.sendWaNotifButtons(effectiveWaPhone);
          this.logger.log(`WA check-out → ${effectiveWaPhone} (photo: ${!!photoToSend})`);
        }

        // ✅ SMS
        if (parent.phone && canSend.sms && !parent.isWhatsappActive) {
          const smsMessage = this.smsService.buildCheckOutMessage({
            parentName,
            studentName,
            checkInTime,
            checkOutTime,
          });
          await this.smsService.sendSms(parent.phone, smsMessage);
          this.logger.log(`SMS check-out → ${parent.phone}`);
        }

        // ✅ Telegram
        if (parent.isTelegramActive && parent.telegramChatId && canSend.telegram) {
          const tgMsg =
            `Здравствуйте, ${parentName}!\n\n` +
            `Ваш ребёнок: ${studentName}\n` +
            `Покинул(а) школу: ${checkOutTime}\n` +
            `Прибыл(а): ${checkInTime}\n` +
            `Дата: ${date}\n\nАдминистрация школы.`;
          if (capturePhoto) {
            await this.telegramService.sendPhotoFromBase64(parent.telegramChatId, capturePhoto, tgMsg);
          } else {
            await this.telegramService.sendMessage(parent.telegramChatId, tgMsg);
          }
          this.logger.log(`TG check-out → ${parent.telegramChatId}`);
        }
      } catch (error: any) {
        this.logger.error(`Check-out notif error (parent ${parent.id}): ${error?.message}`);
      }
    }
  }

  // ======================================================
  // ABSENT NOTIFICATION
  // ======================================================
  private async sendAbsentNotification(params: { person: PersonResolved; totalLateMinutes: number }) {
    const { person, totalLateMinutes } = params;

    const canSend = await this.canSendNotification(person);
    const school = (person as any).school;
    const studentName = `${person.firstName} ${person.lastName}`;
    const totalHours = Math.floor(totalLateMinutes / 60);
    const totalMins = totalLateMinutes % 60;

    for (const parent of person.parents || []) {
      try {
        const parentName = `${parent.firstName || ''} ${parent.lastName || ''}`.trim();
        const effectiveWaPhone = parent.whatsappPhone || parent.phone;
        const message =
          `Уважаемый(ая) ${parentName}!\n\n` +
          `Ваш ребёнок: ${studentName}\n` +
          `Общее опоздание за неделю: ${totalHours} ч ${totalMins} мин\n` +
          `Это засчитывается как 1 день пропуска.\n\n` +
          `Администрация школы.`;

        // ✅ WhatsApp
        if (effectiveWaPhone) {
          await this.sendWaWelcomeIfNeeded(effectiveWaPhone, parent, person, school);
          const waMsg =
            `*ПРОПУСК ЗАНЯТИЙ* ❌\n\n` +
            `Здравствуйте, *${parentName}*!\n\n` +
            `🎒 *${studentName}* не явился(ась) в школу сегодня.\n` +
            `⏱ Накоплено опозданий за неделю: *${totalHours}ч ${totalMins}мин*\n` +
            `_(засчитывается как 1 день пропуска)_\n\n` +
            `_${school?.name ?? 'Администрация школы'}_`;
          await this.wa.sendText(effectiveWaPhone, waMsg).catch(() => {});
          await this.sendWaNotifButtons(effectiveWaPhone);
          this.logger.log(`WA absent → ${effectiveWaPhone}`);
        }

        // ✅ SMS
        if (parent.phone && canSend.sms && !parent.isWhatsappActive) {
          await this.smsService.sendSms(parent.phone, message);
          this.logger.log(`SMS absent → ${parent.phone}`);
        }

        // ✅ Telegram
        if (parent.isTelegramActive && parent.telegramChatId && canSend.telegram) {
          await this.telegramService.sendMessage(parent.telegramChatId, message);
          this.logger.log(`TG absent → ${parent.telegramChatId}`);
        }
      } catch (error: any) {
        this.logger.error(`Absent notification error (parent ${parent.id}):`, error?.message || error);
      }
    }
  }

  // ======================================================
  // TEACHER/DIRECTOR SCAN → DIRECTOR NOTIFICATION
  // ======================================================
  private async sendTeacherScanNotification(params: {
    person: PersonResolved;
    attendance: any;
    capturePhoto?: string;
    action: 'CHECK_IN' | 'CHECK_OUT';
  }) {
    const { person, attendance, capturePhoto, action } = params;

    try {
      // Director scanned — send to school admin or skip
      if (person.type === 'DIRECTOR') return;

      // Teacher scanned — find director of this school
      const director = await this.prisma.teacher.findFirst({
        where: {
          schoolId: person.schoolId,
          type: 'DIRECTOR',
          id: { not: person.id },
        },
      });

      if (!director) {
        this.logger.log(`No director found for school=${person.schoolId}, skipping teacher scan notif`);
        return;
      }

      const TZ = 'Asia/Bishkek';
      const timeStr = (action === 'CHECK_IN' ? attendance.checkInTime : attendance.checkOutTime)
        ?.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: TZ });

      const emoji = action === 'CHECK_IN' ? '✅' : '🚪';
      const actionLabel = action === 'CHECK_IN' ? 'Прибыл' : 'Покинул';
      const msg =
        `${emoji} *${person.firstName ?? ''} ${person.lastName ?? ''}* (Учитель)\n` +
        `${actionLabel}: *${timeStr ?? '—'}*`;

      // WhatsApp
      if (director.isWhatsappActive && director.whatsappPhone) {
        if (capturePhoto) {
          await this.wa.sendPhoto(director.whatsappPhone, capturePhoto, msg);
        } else {
          await this.wa.sendText(director.whatsappPhone, msg);
        }
        this.logger.log(`📸 Teacher scan WA → director ${director.id} (photo: ${!!capturePhoto})`);
      }

      // Telegram
      if (director.isTelegramActive && director.telegramChatId) {
        if (capturePhoto) {
          await this.telegramService.sendPhotoFromBase64(director.telegramChatId, capturePhoto, msg);
        } else {
          await this.telegramService.sendMessage(director.telegramChatId, msg);
        }
        this.logger.log(`📸 Teacher scan TG → director ${director.id}`);
      }
    } catch (err: any) {
      this.logger.error(`sendTeacherScanNotification error: ${err?.message}`);
    }
  }

  // ======================================================
  // PERSON RESOLVE
  // ======================================================
  private async resolvePerson(personKey: string): Promise<PersonResolved | null> {
    const key = String(personKey || '').trim();

    const m = key.match(/^(STU|TCH|DIR)_(.+)$/i);
    if (m?.[1] && m?.[2]) {
      const prefix = m[1].toUpperCase();
      const id = m[2];

      if (prefix === 'STU') {
        const student = await this.prisma.student.findUnique({
          where: { id },
          include: {
            school: true,
            parents: { include: { parent: true } },
          },
        });
        if (!student) return null;

        return {
          ...student,
          type: 'STUDENT',
          parents: student.parents.map((sp) => sp.parent).filter(Boolean),
        } as PersonResolved;
      }

      const teacher = await this.prisma.teacher.findUnique({
        where: { id },
        include: { school: true },
      });

      if (!teacher) return null;

      return {
        ...teacher,
        type: prefix === 'DIR' ? 'DIRECTOR' : 'TEACHER',
      } as PersonResolved;
    }

    return this.findPersonByFaceId(key);
  }

  private async findPersonByFaceId(facePersonId: string): Promise<PersonResolved | null> {
    const student = await this.prisma.student.findUnique({
      where: { facePersonId },
      include: {
        school: true,
        parents: { include: { parent: true } },
      },
    });
    if (student) {
      return {
        ...student,
        type: 'STUDENT',
        parents: student.parents.map((sp) => sp.parent).filter(Boolean),
      };
    }

    const teacher = await this.prisma.teacher.findUnique({
      where: { facePersonId },
      include: { school: true },
    });
    if (teacher) {
      return {
        ...teacher,
        type: teacher.type === 'DIRECTOR' ? 'DIRECTOR' : 'TEACHER',
      };
    }

    return null;
  }

  // ======================================================
  // TODAY ATTENDANCE (CACHE)
  // ======================================================
  async getTodayAttendance(schoolId: string, classId?: string) {
    const cacheKey = `attendance:today:${schoolId}:${classId || 'all'}`;

    const cached = await this.redis.getCache(cacheKey);
    if (cached) {
      this.logger.log(`📦 Cache HIT: ${cacheKey}`);
      return cached;
    }

    this.logger.log(`🔍 Cache MISS: ${cacheKey}`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const where: any = { schoolId, date: { gte: today, lt: tomorrow } };
    if (classId) where.student = { classId };

    const data = await this.prisma.attendance.findMany({
      where,
      select: {
        id: true,
        studentId: true,
        teacherId: true,
        classId: true,
        schoolId: true,
        status: true,
        date: true,
        checkInTime: true,
        student: { select: { id: true, firstName: true, lastName: true, photo: true, classId: true } },
        teacher: { select: { id: true, firstName: true, lastName: true, photo: true, type: true } },
      },
      orderBy: { checkInTime: 'asc' },
    });

    await this.redis.setCache(cacheKey, data, 300);
    return data;
  }

  // ======================================================
  // TODAY STATS
  // ======================================================
  async getTodayStats(schoolId: string) {
    const cacheKey = `attendance:stats:today:${schoolId}`;
    const cached = await this.redis.getCache(cacheKey);
    if (cached) {
      this.logger.log(`📦 Cache HIT: ${cacheKey}`);
      return cached;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [totalStudents, totalTeachers, presentStudents, lateStudents, presentTeachers] = await Promise.all([
      this.prisma.student.count({ where: { schoolId } }),
      this.prisma.teacher.count({ where: { schoolId } }),

      this.prisma.attendance.count({
        where: {
          schoolId,
          studentId: { not: null },
          date: { gte: today, lt: tomorrow },
          status: 'PRESENT',
        },
      }),

      this.prisma.attendance.count({
        where: {
          schoolId,
          studentId: { not: null },
          date: { gte: today, lt: tomorrow },
          status: 'LATE',
        },
      }),

      this.prisma.attendance.count({
        where: {
          schoolId,
          teacherId: { not: null },
          date: { gte: today, lt: tomorrow },
          status: { in: ['PRESENT', 'LATE'] },
        },
      }),
    ]);

    const absentStudents = totalStudents - presentStudents - lateStudents;

    const result = {
      counts: { totalStudents, totalTeachers },
      todayAttendance: {
        students: {
          present: presentStudents,
          late: lateStudents,
          absent: absentStudents < 0 ? 0 : absentStudents,
          rate: totalStudents > 0 ? (((presentStudents + lateStudents) / totalStudents) * 100).toFixed(1) : '0',
        },
        teachers: {
          present: presentTeachers,
          absent: totalTeachers - presentTeachers,
          rate: totalTeachers > 0 ? ((presentTeachers / totalTeachers) * 100).toFixed(1) : '0',
        },
      },
    };

    await this.redis.setCache(cacheKey, result, 30); // 30 soniya cache
    return result;
  }

  // ======================================================
  // DATE STATS — haftalik/kunlik grafik uchun (bitta sanada count)
  // ======================================================
  async getStatsByDate(schoolId: string, dateStr: string) {
    const cacheKey = `attendance:stats:date:${schoolId}:${dateStr}`;
    const cached = await this.redis.getCache(cacheKey);
    if (cached) return cached;

    const date = new Date(dateStr);
    date.setHours(0, 0, 0, 0);
    const nextDay = new Date(date.getTime() + 24 * 60 * 60 * 1000);

    const [present, late, absent] = await Promise.all([
      this.prisma.attendance.count({
        where: { schoolId, studentId: { not: null }, date: { gte: date, lt: nextDay }, status: 'PRESENT' },
      }),
      this.prisma.attendance.count({
        where: { schoolId, studentId: { not: null }, date: { gte: date, lt: nextDay }, status: 'LATE' },
      }),
      this.prisma.attendance.count({
        where: { schoolId, studentId: { not: null }, date: { gte: date, lt: nextDay }, status: 'ABSENT' },
      }),
    ]);

    const result = { present, late, absent, total: present + late + absent };

    // O'tgan kunlar uchun 5 daqiqa cache (o'zgarmaydi), bugun uchun 30 soniya
    const today = new Date().toISOString().split('T')[0];
    const ttl = dateStr < today ? 300 : 30;
    await this.redis.setCache(cacheKey, result, ttl);

    return result;
  }

  // ======================================================
  // TOP STUDENTS (LEADERBOARD)
  // ======================================================
  async getTopStudents(schoolId: string, limit: number = 10) {
    const cacheKey = `leaderboard:top:${schoolId}:${limit}`;
    const cached = await this.redis.getCache(cacheKey);
    if (cached) return cached;

    const topStudents = await this.redis.getTopAttendanceStudents(schoolId, limit);
    const studentIds = topStudents.map((s) => s.studentId);

    const students = await this.prisma.student.findMany({
      where: { id: { in: studentIds } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        class: { select: { grade: true, section: true } },
      },
    });

    const result = topStudents.map((top) => {
      const student = students.find((s) => s.id === top.studentId);
      return {
        studentId: top.studentId,
        name: student ? `${student.firstName} ${student.lastName}` : 'Unknown',
        class: student ? `${student.class.grade}-${student.class.section}` : '',
        attendanceCount: top.count,
      };
    });

    await this.redis.setCache(cacheKey, result, 300);
    return result;
  }

  // ======================================================
  // CRUD
  // ======================================================
  async create(createAttendanceDto: CreateAttendanceDto) {
    const attendance = await this.prisma.attendance.create({
      data: {
        status: createAttendanceDto.status,
        date: new Date(createAttendanceDto.date),
        teacher: createAttendanceDto.teacherId ? { connect: { id: createAttendanceDto.teacherId } } : undefined,
        student: createAttendanceDto.studentId ? { connect: { id: createAttendanceDto.studentId } } : undefined,
        school: { connect: { id: createAttendanceDto.schoolId } },
      },
    });

    void this.auditLog.log({
      action: 'ATTENDANCE_MANUAL',
      entity: 'Attendance',
      entityId: attendance.id,
      schoolId: createAttendanceDto.schoolId,
      details: {
        status: createAttendanceDto.status,
        date: createAttendanceDto.date,
        studentId: createAttendanceDto.studentId,
        teacherId: createAttendanceDto.teacherId,
      },
    });

    await this.invalidateDashboardCache(createAttendanceDto.schoolId);
    return attendance;
  }

  async findAll(
    schoolId?: string,
    date?: string,
    studentId?: string,
    teacherId?: string,
    classId?: string,
    startDate?: string,
    endDate?: string,
    limit = 500,
    offset = 0,
  ) {
    const where: any = {};
    if (schoolId) where.schoolId = schoolId;
    if (studentId) where.studentId = studentId;
    if (teacherId) where.teacherId = teacherId;

    // Single date filter
    if (date) {
      const d = new Date(date);
      const start = new Date(d); start.setHours(0, 0, 0, 0);
      const end   = new Date(d); end.setHours(23, 59, 59, 999);
      where.date = { gte: start, lte: end };
    // Date range filter (history page)
    } else if (startDate || endDate) {
      const start = startDate ? new Date(startDate) : new Date('1970-01-01');
      const end   = endDate   ? new Date(endDate)   : new Date();
      end.setHours(23, 59, 59, 999);
      where.date = { gte: start, lte: end };
    }

    if (classId) where.student = { classId };

    const safeLimit = Math.min(limit, 1000);

    const [records, total] = await Promise.all([
      this.prisma.attendance.findMany({
        where,
        // Only select fields needed by the frontend — skip heavy photo/base64 blobs
        select: {
          id: true,
          schoolId: true,
          studentId: true,
          teacherId: true,
          date: true,
          status: true,
          checkInTime: true,
          checkOutTime: true,
          checkInPhoto: true,
          lateMinutes: true,
          createdAt: true,
          student: {
            select: {
              id: true, firstName: true, lastName: true, photo: true,
              class: { select: { grade: true, section: true } },
            },
          },
          teacher: {
            select: { id: true, firstName: true, lastName: true, photo: true, type: true },
          },
        },
        orderBy: { date: 'desc' },
        take:  safeLimit,
        skip:  offset,
      }),
      this.prisma.attendance.count({ where }),
    ]);

    return { records, total, limit: safeLimit, offset };
  }

  async findOne(id: string) {
    const attendance = await this.prisma.attendance.findUnique({
      where: { id },
      include: { student: true, teacher: true, school: true },
    });
    if (!attendance) throw new NotFoundException(`Attendance #${id} not found`);
    return attendance;
  }

  async update(id: string, updateAttendanceDto: UpdateAttendanceDto) {
    const updated = await this.prisma.attendance.update({
      where: { id },
      data: updateAttendanceDto,
      include: { student: true, teacher: true },
    });

    await this.invalidateDashboardCache(updated.schoolId);
    return updated;
  }

  async remove(id: string) {
    const record = await this.prisma.attendance.findUnique({ where: { id } });
    await this.prisma.attendance.delete({ where: { id } });

    if (record?.schoolId) {
      await this.invalidateDashboardCache(record.schoolId);
    }

    return { message: 'Attendance deleted successfully' };
  }
}