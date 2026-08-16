// ─── camera-events.service.ts ────────────────────────────────────────────────
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AttendanceGateway } from '../attendance/attendance.gateway';

export type CameraEventPayload = {
  type: 'CLASSROOM_PRESENCE' | 'CLASSROOM_LEAVE' | 'UNKNOWN_PERSON';
  cameraId: string;
  schoolId: string;
  personId?: string; // student/teacher UUID
  personType?: 'STUDENT' | 'TEACHER' | 'DIRECTOR';
  confidence?: number;
  emotion?: string;
  durationSeconds?: number;
  isFirstSeen?: boolean;
  snapshot?: string; // base64
  detectedAt: number; // unix timestamp
};

@Injectable()
export class CameraEventsService {
  private readonly logger = new Logger(CameraEventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: AttendanceGateway,
  ) {}

  async handleEvent(payload: CameraEventPayload) {
    const detectedAt = new Date(payload.detectedAt * 1000);
    const today = new Date(detectedAt);
    today.setHours(0, 0, 0, 0);

    switch (payload.type) {
      case 'CLASSROOM_PRESENCE':
        return this.handlePresence(payload, detectedAt, today);
      case 'CLASSROOM_LEAVE':
        return this.handleLeave(payload, detectedAt);
      case 'UNKNOWN_PERSON':
        return this.handleUnknown(payload, detectedAt);
    }
  }

  // ── CLASSROOM_PRESENCE ────────────────────────────────────────────────────
  private async handlePresence(
    payload: CameraEventPayload,
    detectedAt: Date,
    today: Date,
  ) {
    if (!payload.personId || !payload.personType) return { ok: true };

    const isStudent = payload.personType === 'STUDENT';
    const studentId = isStudent ? payload.personId : undefined;
    const teacherId = !isStudent ? payload.personId : undefined;

    // ClassroomPresence — upsert (bugun uchun)
    const existing = await this.prisma.classroomPresence.findFirst({
      where: {
        cameraId: payload.cameraId,
        date: today,
        studentId: studentId ?? null,
        teacherId: teacherId ?? null,
      },
    });

    const emotion = this.parseEmotion(payload.emotion);

    if (existing) {
      await this.prisma.classroomPresence.update({
        where: { id: existing.id },
        data: {
          lastSeenAt: detectedAt,
          durationSec: payload.durationSeconds ?? existing.durationSec,
          confidence: payload.confidence ?? existing.confidence,
          emotion: emotion ?? existing.emotion,
        },
      });
    } else {
      await this.prisma.classroomPresence.create({
        data: {
          schoolId: payload.schoolId,
          cameraId: payload.cameraId,
          studentId: studentId ?? null,
          teacherId: teacherId ?? null,
          firstSeenAt: detectedAt,
          lastSeenAt: detectedAt,
          durationSec: payload.durationSeconds ?? 0,
          confidence: payload.confidence ?? 0,
          emotion: emotion ?? null,
          date: today,
        },
      });
    }

    // CameraEvent yozish (snapshot bilan)
    await this.prisma.cameraEvent.create({
      data: {
        schoolId: payload.schoolId,
        cameraId: payload.cameraId,
        type: 'CLASSROOM_PRESENCE',
        studentId: studentId ?? null,
        teacherId: teacherId ?? null,
        confidence: payload.confidence ?? null,
        snapshot: payload.snapshot ?? null,
        detectedAt,
      },
    });

    // WebSocket orqali TV ga broadcast
    if (payload.isFirstSeen) {
      const person = await this.resolvePerson(
        payload.personId,
        payload.personType,
      );
      if (person) {
        this.gateway.emit({
          attendanceId: payload.cameraId,
          schoolId: payload.schoolId,
          personName:
            `${person.firstName ?? ''} ${person.lastName ?? ''}`.trim(),
          personType: payload.personType,
          photo: payload.snapshot ?? undefined,
          time: detectedAt.toISOString(),
          isLate: false,
          action: 'CHECK_IN',
        });
      }
    }

    this.logger.log(
      `📹 PRESENCE: ${payload.personType} ${payload.personId} cam=${payload.cameraId} conf=${payload.confidence}%`,
    );

    return { ok: true, type: 'CLASSROOM_PRESENCE' };
  }

  // ── CLASSROOM_LEAVE ───────────────────────────────────────────────────────
  private async handleLeave(payload: CameraEventPayload, detectedAt: Date) {
    if (!payload.personId) return { ok: true };

    const today = new Date(detectedAt);
    today.setHours(0, 0, 0, 0);

    const isStudent = payload.personType === 'STUDENT';

    await this.prisma.classroomPresence.updateMany({
      where: {
        cameraId: payload.cameraId,
        date: today,
        studentId: isStudent ? payload.personId : undefined,
        teacherId: !isStudent ? payload.personId : undefined,
      },
      data: {
        lastSeenAt: detectedAt,
        durationSec: payload.durationSeconds ?? 0,
      },
    });

    await this.prisma.cameraEvent.create({
      data: {
        schoolId: payload.schoolId,
        cameraId: payload.cameraId,
        type: 'CLASSROOM_LEAVE',
        studentId: isStudent ? payload.personId : null,
        teacherId: !isStudent ? payload.personId : null,
        detectedAt,
      },
    });

    this.logger.log(`🚪 LEAVE: ${payload.personId} cam=${payload.cameraId}`);
    return { ok: true, type: 'CLASSROOM_LEAVE' };
  }

  // ── UNKNOWN_PERSON ────────────────────────────────────────────────────────
  private async handleUnknown(payload: CameraEventPayload, detectedAt: Date) {
    await this.prisma.cameraEvent.create({
      data: {
        schoolId: payload.schoolId,
        cameraId: payload.cameraId,
        type: 'UNKNOWN_PERSON',
        snapshot: payload.snapshot ?? null,
        detectedAt,
      },
    });

    // TV ga alert
    this.gateway.emit({
      attendanceId: 'unknown',
      schoolId: payload.schoolId,
      personName: 'BEGONA SHAXS',
      personType: 'STUDENT',
      photo: payload.snapshot ?? undefined,
      time: detectedAt.toISOString(),
      isLate: false,
      action: 'CHECK_IN',
    });

    this.logger.warn(
      `⚠️ UNKNOWN PERSON cam=${payload.cameraId} school=${payload.schoolId}`,
    );
    return { ok: true, type: 'UNKNOWN_PERSON' };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  private async resolvePerson(personId: string, personType: string) {
    if (personType === 'STUDENT') {
      return this.prisma.student.findUnique({
        where: { id: personId },
        select: { firstName: true, lastName: true },
      });
    }
    return this.prisma.teacher.findUnique({
      where: { id: personId },
      select: { firstName: true, lastName: true },
    });
  }

  private parseEmotion(emotion?: string) {
    const map: Record<string, any> = {
      happy: 'HAPPY',
      neutral: 'NEUTRAL',
      sad: 'SAD',
      angry: 'ANGRY',
      surprised: 'SURPRISED',
      fearful: 'FEARFUL',
      disgusted: 'DISGUSTED',
    };
    return emotion ? (map[emotion.toLowerCase()] ?? null) : null;
  }

  // ── Classroom stats (TV dashboard uchun) ─────────────────────────────────
  async getClassroomStats(cameraId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const presences = await this.prisma.classroomPresence.findMany({
      where: { cameraId, date: today },
      include: {
        student: {
          select: {
            firstName: true,
            lastName: true,
            class: { select: { grade: true, section: true } },
          },
        },
        teacher: { select: { firstName: true, lastName: true, type: true } },
      },
      orderBy: { firstSeenAt: 'desc' },
    });

    return presences.map((p) => ({
      id: p.id,
      personName: p.student
        ? `${p.student.firstName} ${p.student.lastName}`
        : `${p.teacher?.firstName ?? ''} ${p.teacher?.lastName ?? ''}`,
      personType: p.student ? 'STUDENT' : 'TEACHER',
      class: p.student
        ? `${p.student.class?.grade}-${p.student.class?.section}`
        : null,
      confidence: p.confidence,
      emotion: p.emotion,
      durationSec: p.durationSec,
      firstSeenAt: p.firstSeenAt,
      lastSeenAt: p.lastSeenAt,
    }));
  }
}
