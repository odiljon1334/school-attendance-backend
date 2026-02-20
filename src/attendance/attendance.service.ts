// src/attendance/attendance.service.ts - FULLY OPTIMIZED WITH REDIS

import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService } from '../notifications/telegram.service';
import { SmsService } from '../notifications/sms.service';
import { CreateAttendanceDto, UpdateAttendanceDto } from './dto/attendance.dto';
import { RedisService } from 'src/redis/redis.service';
import { DashboardService } from 'src/dashboard/dashboard.service';

const MIN_CHECKOUT_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 soat
const RE_ENTRY_GRACE_MS        = 10 * 60 * 1000;      // 10 daqiqa
const ABSENT_THRESHOLD_MIN     = 6 * 60;              // 360 daqiqa = 6 soat
const SCHOOL_START_HOUR        = 9;                   // 09:00

@Injectable()
export class AttendanceService {
  private readonly logger = new Logger(AttendanceService.name);

  constructor(
    private prisma: PrismaService,
    private telegramService: TelegramService,
    private smsService: SmsService,
    private redis: RedisService,
    private dashboardService: DashboardService,
  ) {}

  // ==========================================
  // ✅ CACHE INVALIDATION (optimized)
  // ==========================================
  private async invalidateDashboardCache(schoolId: string) {
    try {
      // Batch delete for efficiency
      const keysToDelete = [
        `dashboard:school:${schoolId}`,
        `dashboard:overview`,
        `cache:attendance:today:${schoolId}:*`,
        `cache:stats:today:${schoolId}`,
      ];

      // Get trend keys
      const trendKeys = await this.redis.smembers(`dashboard:keys:school:${schoolId}`);
      if (trendKeys?.length) {
        keysToDelete.push(...trendKeys);
        keysToDelete.push(`dashboard:keys:school:${schoolId}`);
      }

      // Get district cache key
      const school = await this.prisma.school.findUnique({
        where: { id: schoolId },
        select: { districtId: true },
      });

      if (school?.districtId) {
        keysToDelete.push(`dashboard:district:${school.districtId}`);
      }

      // Delete all at once
      await this.redis.del(...keysToDelete);

      // Also delete pattern-based cache keys
      await this.redis.deleteCachePattern(`attendance:today:${schoolId}:*`);

      this.logger.log(`✅ Cache invalidated for school: ${schoolId}`);
    } catch (error) {
      this.logger.error('Cache invalidation error:', error);
    }
  }

  // ==========================================
  // ✅ MAIN: HIKVISION TURNSTILE EVENT
  // ==========================================
  async handleTurnstileEvent(event: {
    personId: string;
    deviceId: string;
    timestamp: string;
    eventType: string;
    capturePhoto?: string;
  }) {
    try {
      this.logger.log(`🔔 Turnstile event: ${event.personId}`);

      const person = await this.findPersonByFaceId(event.personId);
      if (!person) {
        this.logger.warn(`⚠️ Person not found: ${event.personId}`);
        return { success: false, message: 'Person not found' };
      }

      const now = new Date();
      return await this.processAttendanceLogic({
        person,
        now,
        deviceId: event.deviceId,
        capturePhoto: event.capturePhoto,
      });
    } catch (error) {
      this.logger.error('Turnstile event error:', error);
      throw error;
    }
  }

  // ==========================================
  // ✅ CORE LOGIKA
  // ==========================================
  private async processAttendanceLogic(params: {
    person: any;
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
    });

    // CASE 1: Bugun hali kelmagan
    if (!existing) {
      return await this.handleCheckIn({ person, now, deviceId, capturePhoto, existing: null });
    }

    // CASE 2: Maktabda (hali chiqmagan)
    if (!existing.checkOutTime) {
      const timeSinceCheckIn = now.getTime() - existing.checkInTime.getTime();

      if (timeSinceCheckIn >= MIN_CHECKOUT_INTERVAL_MS) {
        return await this.handleCheckOut({ person, record: existing, now });
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
    return await this.handleCheckIn({ person, now, deviceId, capturePhoto, existing });
  }

  // ==========================================
  // ✅ CHECK-IN HANDLER (with Redis counters)
  // ==========================================
  private async handleCheckIn(params: {
    person: any;
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
    } else {
      const newLateMinutes = (existing.lateMinutes || 0) + lateMinutes;
      const newLateCount = (existing.lateCount || 0) + 1;

      attendance = await this.prisma.attendance.update({
        where: { id: existing.id },
        data: {
          status: 'LATE',
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

    // ✅ NEW: Real-time counter (Redis)
    await this.redis.incrementTodayCheckIn(person.schoolId);

    // ✅ NEW: Leaderboard update (for students only)
    if (person.type === 'STUDENT') {
      const totalAttendance = await this.prisma.attendance.count({
        where: { studentId: person.id },
      });
      await this.redis.updateAttendanceLeaderboard(person.schoolId, person.id, totalAttendance);

      // Send notifications
      await this.sendCheckInNotification({ person, attendance, isLate, lateMinutes, capturePhoto });

      // Check weekly absence
      if (isLate) {
        await this.checkWeeklyAbsence(person, now, attendance);
      }
    }

    // ✅ Cache invalidation
    await this.invalidateDashboardCache(person.schoolId);

    return { success: true, action: 'CHECK_IN', attendance };
  }

  // ==========================================
  // ✅ CHECK-OUT HANDLER (with cache update)
  // ==========================================
  private async handleCheckOut(params: { person: any; record: any; now: Date }) {
    const { person, record, now } = params;

    const updated = await this.prisma.attendance.update({
      where: { id: record.id },
      data: { checkOutTime: now },
    });

    this.logger.log(`🚪 CHECK-OUT: ${person.firstName} | ${now.toTimeString().slice(0, 5)}`);

    // Send notification for students
    if (person.type === 'STUDENT') {
      await this.sendCheckOutNotification({ person, attendance: updated });
    }

    // ✅ Cache invalidation
    await this.invalidateDashboardCache(person.schoolId);

    return { success: true, action: 'CHECK_OUT', attendance: updated };
  }

  // ==========================================
  // ✅ HAFTALIK KECHIKISH TEKSHIRUVI
  // ==========================================
  private async checkWeeklyAbsence(person: any, now: Date, currentAttendance: any) {
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

    this.logger.log(
      `📊 Weekly late: ${person.firstName} | ${totalLateMinutes} min / ${ABSENT_THRESHOLD_MIN} min`,
    );

    if (totalLateMinutes >= ABSENT_THRESHOLD_MIN) {
      this.logger.warn(`⚠️ ABSENT: ${person.firstName} | ${totalLateMinutes} min this week!`);
      await this.sendAbsentNotification({ person, totalLateMinutes });
    }
  }

  // ==========================================
  // ✅ TO'LOV TEKSHIRUVI
  // ==========================================
  private async canSendNotification(student: any): Promise<{
    sms: boolean;
    telegram: boolean;
    reason?: string;
  }> {
    const now = new Date();

    // isSmsEnabled o'chirilgan
    if (!student.isSmsEnabled) {
      this.logger.warn(`SMS disabled for student ${student.firstName} ${student.lastName}`);
      return { sms: false, telegram: false, reason: 'SMS service disabled' };
    }

    // Muddat tugagan
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

      return { sms: false, telegram: false, reason: 'SMS subscription expired' };
    }

    // ✅ Hammasi yaxshi
    return { sms: true, telegram: true };
  }

  // ==========================================
  // ✅ CHECK-IN NOTIFICATION (WITH PAYMENT CHECK)
  // ==========================================
  private async sendCheckInNotification(params: {
    person: any;
    attendance: any;
    isLate: boolean;
    lateMinutes: number;
    capturePhoto?: string;
  }) {
    const { person, attendance, isLate, lateMinutes, capturePhoto } = params;

    // ✅ TO'LOV TEKSHIRUVI
    const canSend = await this.canSendNotification(person);
    if (!canSend.sms) {
      this.logger.log(`🚫 Notification blocked: ${canSend.reason}`);
      return;
    }

    const time = attendance.checkInTime.toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
    });

    for (const parent of person.parents || []) {
      try {
        // SMS
        if (parent.phone && canSend.sms) {
          const smsMessage = this.smsService.buildCheckInMessage({
            parentName: `${parent.firstName} ${parent.lastName}`,
            studentName: `${person.firstName} ${person.lastName}`,
            time,
            isLate,
            lateMinutes,
          });
          await this.smsService.sendSms(parent.phone, smsMessage);
          this.logger.log(`📱 Check-in SMS → ${parent.phone}`);
        }

        // Telegram
        if (parent.isTelegramActive && parent.telegramChatId && canSend.telegram) {
          const telegramMessage =
            `Здравствуйте, уважаемый(ая) ${parent.firstName} ${parent.lastName}!\n\n` +
            `Ваш ребёнок: ${person.firstName} ${person.lastName}\n` +
            `Прибыл в школу: ${time}` +
            (isLate ? `\nОпоздание: ${lateMinutes} мин` : '') +
            `\n\nАдминистрация школы.`;

          if (capturePhoto) {
            await this.telegramService.sendPhotoFromBase64(
              parent.telegramChatId,
              capturePhoto,
              telegramMessage,
            );
          } else {
            await this.telegramService.sendMessage(parent.telegramChatId, telegramMessage);
          }
          this.logger.log(`📱 Check-in Telegram → ${parent.telegramChatId}`);
        }
      } catch (error) {
        this.logger.error(`Notification error (parent ${parent.id}):`, error.message);
      }
    }
  }

  // ==========================================
  // ✅ CHECK-OUT NOTIFICATION (WITH PAYMENT CHECK)
  // ==========================================
  private async sendCheckOutNotification(params: { person: any; attendance: any }) {
    const { person, attendance } = params;

    // ✅ TO'LOV TEKSHIRUVI
    const canSend = await this.canSendNotification(person);
    if (!canSend.sms) {
      this.logger.log(`🚫 Check-out notification blocked: ${canSend.reason}`);
      return;
    }

    const checkInTime = attendance.checkInTime.toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
    });
    const checkOutTime = attendance.checkOutTime.toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
    });

    for (const parent of person.parents || []) {
      try {
        // SMS
        if (parent.phone && canSend.sms) {
          const smsMessage = this.smsService.buildCheckOutMessage({
            parentName: `${parent.firstName} ${parent.lastName}`,
            studentName: `${person.firstName} ${person.lastName}`,
            checkInTime,
            checkOutTime,
          });
          await this.smsService.sendSms(parent.phone, smsMessage);
          this.logger.log(`📱 Check-out SMS → ${parent.phone}`);
        }

        // Telegram
        if (parent.isTelegramActive && parent.telegramChatId && canSend.telegram) {
          const telegramMessage =
            `Здравствуйте, уважаемый(ая) ${parent.firstName} ${parent.lastName}!\n\n` +
            `Ваш ребёнок: ${person.firstName} ${person.lastName}\n` +
            `Покинул школу: ${checkOutTime}\n` +
            `Пришёл: ${checkInTime}\n\n` +
            `Администрация школы.`;

          await this.telegramService.sendMessage(parent.telegramChatId, telegramMessage);
          this.logger.log(`📱 Check-out Telegram → ${parent.telegramChatId}`);
        }
      } catch (error) {
        this.logger.error(`Check-out notification error (parent ${parent.id}):`, error.message);
      }
    }
  }

  // ==========================================
  // ✅ ABSENT NOTIFICATION (WITH PAYMENT CHECK)
  // ==========================================
  private async sendAbsentNotification(params: { person: any; totalLateMinutes: number }) {
    const { person, totalLateMinutes } = params;

    // ✅ TO'LOV TEKSHIRUVI
    const canSend = await this.canSendNotification(person);
    if (!canSend.sms) {
      this.logger.log(`🚫 Absent notification blocked: ${canSend.reason}`);
      return;
    }

    const totalHours = Math.floor(totalLateMinutes / 60);
    const totalMins = totalLateMinutes % 60;

    for (const parent of person.parents || []) {
      try {
        const message =
          `Уважаемый(ая) ${parent.firstName} ${parent.lastName}!\n\n` +
          `Ваш ребёнок: ${person.firstName} ${person.lastName}\n` +
          `Общее опоздание за неделю: ${totalHours} ч ${totalMins} мин\n` +
          `Это засчитывается как 1 день пропуска.\n\n` +
          `Администрация школы.`;

        // SMS
        if (parent.phone && canSend.sms) {
          await this.smsService.sendSms(parent.phone, message);
          this.logger.log(`📱 Absent SMS → ${parent.phone}`);
        }

        // Telegram
        if (parent.isTelegramActive && parent.telegramChatId && canSend.telegram) {
          await this.telegramService.sendMessage(parent.telegramChatId, message);
          this.logger.log(`📱 Absent Telegram → ${parent.telegramChatId}`);
        }
      } catch (error) {
        this.logger.error(`Absent notification error (parent ${parent.id}):`, error.message);
      }
    }
  }

  // ==========================================
  // ✅ FIND PERSON BY FACE ID
  // ==========================================
  private async findPersonByFaceId(facePersonId: string) {
    // 1. Check Student
    const student = await this.prisma.student.findUnique({
      where: { facePersonId },
      include: { school: true, parents: true },
    });
    if (student) return { ...student, type: 'STUDENT' };
  
    // 2. Check Teacher (includes Director)
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

  // ==========================================
  // ✅ NEW: GET TODAY ATTENDANCE (WITH CACHE)
  // ==========================================
  async getTodayAttendance(schoolId: string, classId?: string) {
    // 1. Cache key
    const cacheKey = `attendance:today:${schoolId}:${classId || 'all'}`;

    // 2. Try cache first
    const cached = await this.redis.getCache(cacheKey);
    if (cached) {
      this.logger.log(`📦 Cache HIT: ${cacheKey}`);
      return cached;
    }

    // 3. Cache MISS - fetch from DB
    this.logger.log(`🔍 Cache MISS: ${cacheKey}`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const where: any = { schoolId, date: { gte: today, lt: tomorrow } };
    if (classId) where.student = { classId };

    const data = await this.prisma.attendance.findMany({
      where,
      include: { student: true, teacher: true },
      orderBy: { checkInTime: 'asc' },
    });

    // 4. Save to cache (5 minutes)
    await this.redis.setCache(cacheKey, data, 300);

    return data;
  }

  // ==========================================
  // ✅ NEW: GET TODAY STATS (FAST)
  // ==========================================
  async getTodayStats(schoolId: string) {
    const cacheKey = `stats:today:${schoolId}`;

    // Try cache (short TTL - 30 seconds for real-time feel)
    const cached = await this.redis.getCache(cacheKey);
    if (cached) {
      return cached;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [totalStudents, presentCount, lateCount] = await Promise.all([
      this.prisma.student.count({ where: { schoolId } }),
      this.prisma.attendance.count({
        where: {
          schoolId,
          date: { gte: today, lt: tomorrow },
          status: { in: ['PRESENT', 'LATE'] },
        },
      }),
      this.prisma.attendance.count({
        where: {
          schoolId,
          date: { gte: today, lt: tomorrow },
          status: 'LATE',
        },
      }),
    ]);

    const stats = {
      totalStudents,
      presentCount,
      lateCount,
      absentCount: totalStudents - presentCount,
      attendanceRate: totalStudents > 0 ? ((presentCount / totalStudents) * 100).toFixed(1) : '0',
    };

    // Cache for 30 seconds
    await this.redis.setCache(cacheKey, stats, 30);

    return stats;
  }

  // ==========================================
  // ✅ NEW: GET TOP STUDENTS (LEADERBOARD)
  // ==========================================
  async getTopStudents(schoolId: string, limit: number = 10) {
    const cacheKey = `leaderboard:top:${schoolId}:${limit}`;

    // Try cache (5 minutes)
    const cached = await this.redis.getCache(cacheKey);
    if (cached) {
      return cached;
    }

    // Get from Redis leaderboard
    const topStudents = await this.redis.getTopAttendanceStudents(schoolId, limit);

    // Fetch student details
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

    // Merge data
    const result = topStudents.map((top) => {
      const student = students.find((s) => s.id === top.studentId);
      return {
        studentId: top.studentId,
        name: student ? `${student.firstName} ${student.lastName}` : 'Unknown',
        class: student ? `${student.class.grade}-${student.class.section}` : '',
        attendanceCount: top.count,
      };
    });

    // Cache for 5 minutes
    await this.redis.setCache(cacheKey, result, 300);

    return result;
  }

  // ==========================================
  // EXISTING CRUD METHODS
  // ==========================================
  async create(createAttendanceDto: CreateAttendanceDto) {
    const attendance = await this.prisma.attendance.create({
      data: {
        status: createAttendanceDto.status,
        date: new Date(createAttendanceDto.date),
        teacher: createAttendanceDto.teacherId
          ? { connect: { id: createAttendanceDto.teacherId } }
          : undefined,
        student: createAttendanceDto.studentId
          ? { connect: { id: createAttendanceDto.studentId } }
          : undefined,
        school: { connect: { id: createAttendanceDto.schoolId } },
      },
    });

    await this.invalidateDashboardCache(createAttendanceDto.schoolId);

    return attendance;
  }

  async findAll(schoolId?: string, date?: string, studentId?: string, classId?: string) {
    const where: any = {};
    if (schoolId) where.schoolId = schoolId;
    if (studentId) where.studentId = studentId;
    if (date) {
      const d = new Date(date);
      where.date = {
        gte: new Date(d.setHours(0, 0, 0, 0)),
        lt: new Date(d.setHours(23, 59, 59, 999)),
      };
    }
    if (classId) where.student = { classId };

    return this.prisma.attendance.findMany({
      where,
      include: { student: true, teacher: true, school: true },
      orderBy: { date: 'desc' },
    });
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
    const record = await this.prisma.attendance.findUnique({
      where: { id },
    });

    await this.prisma.attendance.delete({ where: { id } });

    if (record?.schoolId) {
      await this.invalidateDashboardCache(record.schoolId);
    }

    return { message: 'Attendance deleted successfully' };
  }
}