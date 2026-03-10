import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PayrollService } from '../payroll/payroll.service';
import { AttendanceService } from '../attendance/attendance.service';

export type HikvisionWebhookEvent = {
  employeeNo: string;
  deviceId: string | null;
  eventTime?: string; // terminal tomonidan yuborilgan original vaqt (ISO string)
  raw?: any;
  snapshotBytes?: Buffer;
  contentType?: string;
};

@Injectable()
export class HikvisionService {
  private readonly logger = new Logger(HikvisionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payrollService: PayrollService,
    private readonly attendanceService: AttendanceService,
  ) {}

  // Qirg'iziston vaqt zonasi: Asia/Bishkek = UTC+6
  private static readonly TIMEZONE_OFFSET = '+06:00';

  /**
   * Terminal yuborgan vaqtni parse qiladi (Qirg'iziston = UTC+6).
   *
   * Hikvision terminal odatda timezone ko'rsatmasdan local vaqt yuboradi:
   *   "2026-03-10T08:20:00" — timezone yo'q, lekin terminal Bishkek vaqtida ishlaydi
   *
   * JavaScript "timezone yo'q" stringni server vaqtida (UTC) parse qiladi —
   * bu Bishkek uchun 6 soat xatolikka olib keladi.
   * Shuning uchun timezone yo'q bo'lsa +06:00 qo'shamiz.
   *
   * - Terminal vaqt yubormasa         → server vaqti
   * - Vaqt yaroqsiz bo'lsa            → server vaqti
   * - Vaqt kelajakda (>1 min)         → server vaqti (terminal soati noto'g'ri)
   * - Vaqt 24 soatdan eski            → server vaqti (buzilgan buffer)
   * - To'g'ri vaqt                    → terminal vaqti (Bishkek offset bilan)
   */
  private resolveEventTime(eventTime?: string): Date {
    if (!eventTime) return new Date();

    // Timezone belgisi bor-yo'qligini tekshiramiz: Z, +HH:MM, -HH:MM
    const hasTimezone = /[Z]$|[+-]\d{2}:?\d{2}$/.test(eventTime.trim());
    const timeStr =
      !hasTimezone && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(eventTime.trim())
        ? `${eventTime.trim()}${HikvisionService.TIMEZONE_OFFSET}` // +06:00 qo'shamiz
        : eventTime.trim();

    const parsed = new Date(timeStr);
    if (isNaN(parsed.getTime())) {
      this.logger.warn(`Invalid eventTime from terminal: "${eventTime}", using server time`);
      return new Date();
    }

    const serverNow = new Date();
    const diffMs = serverNow.getTime() - parsed.getTime();

    // Kelajakda (1 daqiqadan ko'proq) → noto'g'ri terminal soati
    if (diffMs < -60_000) {
      this.logger.warn(`Terminal eventTime is in the future: ${eventTime}, using server time`);
      return serverNow;
    }

    // 24 soatdan eski → ehtimol buzilgan buffer
    if (diffMs > 24 * 60 * 60 * 1000) {
      this.logger.warn(`Terminal eventTime is too old (>24h): ${eventTime}, using server time`);
      return serverNow;
    }

    this.logger.log(
      `✅ Using terminal eventTime: ${parsed.toISOString()} (Bishkek: ${parsed.toLocaleTimeString('ru-RU', { timeZone: 'Asia/Bishkek', hour: '2-digit', minute: '2-digit' })})`,
    );
    return parsed;
  }

  async handleFaceRecognitionEvent(event: HikvisionWebhookEvent) {
    const employeeNo = String(event.employeeNo || '').trim();
    const deviceIdRaw = event.deviceId ? String(event.deviceId).trim() : '';
    const deviceId = deviceIdRaw ? `hikvision:${deviceIdRaw}` : 'hikvision:UNKNOWN';

    this.logger.log(
      `Webhook event: employeeNo=${employeeNo} deviceId=${deviceIdRaw || 'null'} ct=${event.contentType || ''}`,
    );

    if (!employeeNo || !/^\d+$/.test(employeeNo)) {
      this.logger.warn(`Invalid employeeNo: "${employeeNo}"`);
      return { success: false, message: 'Invalid employeeNo' };
    }

    // Terminal vaqtini ishlatamiz (WiFi offline bo'lib, keyin ulanishda original vaqt saqlanadi)
    // Agar terminal vaqt yuborsa — shuni ishlatamiz; aks holda server vaqti
    const now = this.resolveEventTime(event.eventTime);
    const capturePhoto = event.snapshotBytes ? event.snapshotBytes.toString('base64') : undefined;

    const [student, teacher] = await Promise.all([
      this.prisma.student.findUnique({
        where: { enrollNumber: employeeNo },
        select: { id: true, schoolId: true, photo: true },
      }),
      this.prisma.teacher.findFirst({
        where: { enrollNumber: employeeNo },
        select: { id: true, schoolId: true, type: true },
      }),
    ]);

    if (student) {
      // Terminal rasm yubormasa → enrollment fotosini fallback sifatida ishlatamiz
      const photoToSend = capturePhoto ?? student.photo ?? undefined;
      if (!capturePhoto && student.photo) {
        this.logger.log(`📸 Using enrollment photo for student (no terminal snapshot)`);
      }
      return this.attendanceService.handleTurnstileEvent({
        personId: `STU_${student.id}`,
        deviceId,
        timestamp: now.toISOString(),
        eventType: 'FACE_RECOGNITION',
        capturePhoto: photoToSend,
      });
    }

    if (teacher) {
      try {
        await this.payrollService.processAttendance(teacher.id, 'IN', now);
      } catch (e: any) {
        this.logger.warn(`Payroll processAttendance failed: ${e?.message || e}`);
      }

      const prefix = teacher.type === 'DIRECTOR' ? 'DIR' : 'TCH';

      await this.attendanceService.handleTurnstileEvent({
        personId: `${prefix}_${teacher.id}`,
        deviceId,
        timestamp: now.toISOString(),
        eventType: 'FACE_RECOGNITION',
      });

      return {
        success: true,
        type: teacher.type === 'DIRECTOR' ? 'DIRECTOR' : 'TEACHER',
      };
    }

    this.logger.warn(`No person matched enrollNumber(employeeNo)=${employeeNo}`);
    return { success: false, message: `Person not found for employeeNo=${employeeNo}` };
  }
}