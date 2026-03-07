import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PayrollService } from '../payroll/payroll.service';
import { AttendanceService } from '../attendance/attendance.service';

export type HikvisionWebhookEvent = {
  employeeNo: string;
  deviceId: string | null;
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

    const now = new Date();
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