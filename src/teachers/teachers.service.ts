import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TurnstileService } from '../turnstile/turnstile.service';
import { CreateTeacherDto, UpdateTeacherDto } from './dto/teacher.dto';
import { AuditLogService } from '../audit-log/audit-log.service';

function pad(num: number, size: number) {
  return String(num).padStart(size, '0');
}

function buildEnroll(prefix: '30', year: number, seq: number) {
  return `${prefix}${year}${pad(seq, 3)}`;
}


@Injectable()
export class TeachersService {
  constructor(
    private prisma: PrismaService,
    private turnstileService: TurnstileService,
    private auditLog: AuditLogService,
  ) {}

  private async nextStaffEnrollNumber(tx: PrismaService, schoolId: string) {
    const year = new Date().getFullYear();

    // upsert counter
    const counter = await tx.enrollCounter.upsert({
      where: { schoolId },
      create: { schoolId, staffSeq: 1, studentSeq: 0 },
      update: { staffSeq: { increment: 1 } },
      select: { staffSeq: true },
    });

    return buildEnroll('30', year, counter.staffSeq);
  }

  private cleanStr(v: any): string | null {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    return s.length ? s : null;
  }


  async create(dto: CreateTeacherDto) {
    if (!dto.schoolId) throw new BadRequestException('schoolId is required');
  
    const finalType = (dto.type ?? 'TEACHER') as 'TEACHER' | 'DIRECTOR';
    const classIds = finalType === 'DIRECTOR' ? [] : (dto.classIds || []);
  
    return this.prisma.$transaction(async (tx) => {
      const hasPhoto = !!(dto.photo && String(dto.photo).trim());

      let enrollNumber: string | null = null;
      if (hasPhoto) {
        enrollNumber = dto.enrollNumber?.trim()
        ? dto.enrollNumber.trim()
        : await this.nextStaffEnrollNumber(tx as any, dto.schoolId);
        const [studentDup, teacherDup] = await Promise.all([
        tx.student.findFirst({ where: { enrollNumber }, select: { id: true } }),
        tx.teacher.findFirst({ where: { enrollNumber }, select: { id: true } }),
      ]);
      if (studentDup || teacherDup) throw new BadRequestException(`enrollNumber already exists: ${enrollNumber}`);
    } else {
      enrollNumber = null;
    }
  
    const teacher = await tx.teacher.create({
      data: {
        schoolId: dto.schoolId,
        type: finalType,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: this.cleanStr(dto.phone),
        telegramId: this.cleanStr(dto.telegramId),
        photo: hasPhoto ? this.cleanStr(dto.photo) : null,
        subjects: dto.subjects || [],
        enrollNumber,
      },
    });
  
      if (classIds.length > 0) {
        await tx.teacherClass.createMany({
          data: classIds.map((classId) => ({ teacherId: teacher.id, classId })),
          skipDuplicates: true,
        });
      }
  
      const result = await tx.teacher.findUnique({
        where: { id: teacher.id },
        include: { teacherClasses: { include: { class: true } } },
      });

      void this.auditLog.log({
        action: 'TEACHER_CREATE',
        entity: 'Teacher',
        entityId: teacher.id,
        schoolId: dto.schoolId,
        details: { name: `${dto.firstName} ${dto.lastName}`, type: finalType },
      });

      return result;
    });
  }

  async update(id: string, dto: UpdateTeacherDto) {
    const existing = await this.prisma.teacher.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Teacher not found');
  
    const finalType = (dto.type || existing.type) as 'TEACHER' | 'DIRECTOR';
    const classIds = finalType === 'DIRECTOR' ? [] : (dto.classIds || []);
  
    return this.prisma.$transaction(async (tx) => {
      const incomingPhoto = dto.photo !== undefined ? this.cleanStr(dto.photo) : undefined;
      const photoWillBeSetNow = incomingPhoto !== undefined && incomingPhoto !== null && !existing.photo;

      let enrollNumberToSet: string | undefined = undefined;

      if (photoWillBeSetNow && !existing.enrollNumber) {
        const candidate = dto.enrollNumber?.trim()
        ? dto.enrollNumber.trim()
        : await this.nextStaffEnrollNumber(tx as any, existing.schoolId!);
        
        const [studentDup, teacherDup] = await Promise.all([
          tx.student.findFirst({ where: { enrollNumber: candidate }, select: { id: true } }),
          tx.teacher.findFirst({ where: { enrollNumber: candidate }, select: { id: true } }),
        ]);
        
        if (studentDup || (teacherDup && teacherDup.id !== id)) {
        throw new BadRequestException(`enrollNumber already exists: ${candidate}`);
      }
      enrollNumberToSet = candidate;
    }
    
    if (dto.enrollNumber?.trim() && (!photoWillBeSetNow && !existing.photo)) {
      throw new BadRequestException('enrollNumber can be assigned only after photo is uploaded');
    }
  
    await tx.teacher.update({
      where: { id },
      data: {
        type: dto.type ?? undefined,
        firstName: dto.firstName ?? undefined,
        lastName: dto.lastName ?? undefined,
        phone: dto.phone !== undefined ? this.cleanStr(dto.phone) : undefined,
        telegramId: dto.telegramId !== undefined ? this.cleanStr(dto.telegramId) : undefined,
        photo: incomingPhoto === undefined ? undefined : incomingPhoto,
        subjects: dto.subjects ?? undefined,
        enrollNumber: enrollNumberToSet,
      },
    });
  
      await tx.teacherClass.deleteMany({ where: { teacherId: id } });
  
      if (classIds.length > 0) {
        await tx.teacherClass.createMany({
          data: classIds.map((classId) => ({ teacherId: id, classId })),
          skipDuplicates: true,
        });
      }
  
      const updated = await tx.teacher.findUnique({
        where: { id },
        include: { teacherClasses: { include: { class: true } } },
      });

      void this.auditLog.log({
        action: 'TEACHER_UPDATE',
        entity: 'Teacher',
        entityId: id,
        schoolId: existing.schoolId ?? undefined,
        details: { name: `${existing.firstName} ${existing.lastName}` },
      });

      return updated;
    });
  }

  async getAll(schoolId: string) {
    return this.prisma.teacher.findMany({
      where: { schoolId },
      orderBy: { lastName: 'asc' },
      take: 500, // safety cap
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        photo: true,
        gender: true,
        type: true,
        enrollNumber: true,
        subjects: true,
        teacherClasses: {
          select: {
            class: { select: { id: true, grade: true, section: true } },
          },
        },
      },
    });
  }

  // ==========================================
  // ✅ FIND ALL - paginated, lightweight
  // ==========================================
  async findAll(
    schoolId?: string,
    type?: 'TEACHER' | 'DIRECTOR',
    limit = 100,
    offset = 0,
    search?: string,
  ) {
    const where: any = {};
    if (schoolId) where.schoolId = schoolId;
    if (type)     where.type     = type;
    if (search) {
      const q = search.trim();
      where.OR = [
        { firstName: { contains: q, mode: 'insensitive' } },
        { lastName:  { contains: q, mode: 'insensitive' } },
        { phone:     { contains: q, mode: 'insensitive' } },
      ];
    }

    const take = Math.min(limit, 300);

    return this.prisma.teacher.findMany({
      where,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        photo: true,
        gender: true,
        type: true,
        enrollNumber: true,
        subjects: true,
        schoolId: true,
        teacherClasses: {
          select: {
            class: { select: { id: true, grade: true, section: true } },
          },
        },
      },
      orderBy: { lastName: 'asc' },
      take,
      skip: offset,
    });
  }

  // ==========================================
  // ✅ FIND DIRECTORS (helper)
  // ==========================================
  async findDirectors(schoolId?: string) {
    return this.findAll(schoolId, 'DIRECTOR', 300, 0);
  }

  // ==========================================
  // ✅ FIND TEACHERS (helper)
  // ==========================================
  async findTeachers(schoolId?: string) {
    return this.findAll(schoolId, 'TEACHER', 300, 0);
  }

  // ==========================================
  // ✅ FIND ONE
  // ==========================================
  async findOne(id: string) {
    const teacher = await this.prisma.teacher.findUnique({
      where: { id },
      include: {
        school: true,
        teacherClasses: {
          include: {
            class: true,
          },
        },
        attendances: {
          orderBy: {
            date: 'desc',
          },
          take: 30,
        },
      },
    });

    if (!teacher) {
      throw new NotFoundException(`Teacher with ID ${id} not found`);
    }

    return teacher;
  }

  // ==========================================
  // ✅ SET AS DIRECTOR (SuperAdmin only)
  // ==========================================
  async setAsDirector(id: string) {
    return await this.prisma.teacher.update({
      where: { id },
      data: { type: 'DIRECTOR' },
      include: {
        school: true,
      },
    });
  }

  // ==========================================
  // ✅ SET AS TEACHER (SuperAdmin only)
  // ==========================================
  async setAsTeacher(id: string) {
    return await this.prisma.teacher.update({
      where: { id },
      data: { type: 'TEACHER' },
      include: {
        school: true,
      },
    });
  }

  // ==========================================
  // ✅ REMOVE - WITH TURNSTILE DELETE
  // ==========================================
  async remove(id: string) {
    const teacher = await this.prisma.teacher.findUnique({
      where: { id },
    });

    if (!teacher) {
      throw new NotFoundException(`Teacher with ID ${id} not found`);
    }
    const userType =
    teacher.type === 'DIRECTOR' ? 'director' : 'teacher';
  
    // await this.turnstileService.removePhoto(id, userType);
    await this.prisma.teacherClass.deleteMany({ where: { teacherId: id } });
    await this.prisma.attendance.deleteMany({ where: { teacherId: id } });
    await this.prisma.teacher.delete({ where: { id } });

    void this.auditLog.log({
      action: 'TEACHER_DELETE',
      entity: 'Teacher',
      entityId: id,
      schoolId: teacher.schoolId ?? undefined,
      details: { name: `${teacher.firstName} ${teacher.lastName}`, type: teacher.type },
    });

    return { message: 'Teacher deleted successfully' };
  }

  // ==========================================
  // ✅ GET ATTENDANCE STATS
  // ==========================================
  async getAttendanceStats(teacherId: string, startDate?: Date, endDate?: Date) {
    const where: any = { teacherId };

    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = startDate;
      if (endDate) where.date.lte = endDate;
    }

    const attendances = await this.prisma.attendance.findMany({
      where,
      orderBy: { date: 'desc' },
    });

    const total = attendances.length;
    const present = attendances.filter((a) => a.status === 'PRESENT').length;
    const late = attendances.filter((a) => a.status === 'LATE').length;
    const absent = attendances.filter((a) => a.status === 'ABSENT').length;

    return {
      total,
      present,
      late,
      absent,
      attendanceRate: total > 0 ? (((present + late) / total) * 100).toFixed(2) : '0',
    };
  }

  // ==========================================
  // ✅ GET PROFILE BY PHONE (for Telegram)
  // ==========================================
  async getProfileByPhone(phone: string) {
    const teacher = await this.prisma.teacher.findFirst({
      where: { phone },
      include: {
        school: true,
        teacherClasses: {
          include: {
            class: true,
          },
        },
      },
    });

    if (!teacher) {
      throw new NotFoundException('Teacher profile not found');
    }

    return {
      id: teacher.id,
      type: teacher.type,
      firstName: teacher.firstName,
      lastName: teacher.lastName,
      phone: teacher.phone,
      telegramId: teacher.telegramId,
      subjects: teacher.subjects,
      photo: teacher.photo,
      school: teacher.school,
      assignedClasses: teacher.teacherClasses,
    };
  }

  // ==========================================
  // ✅ GET PROFILE BY FACE ID (for Attendance)
  // ==========================================
  async getProfileByFaceId(facePersonId: string) {
    const teacher = await this.prisma.teacher.findFirst({
      where: { facePersonId },
      include: {
        school: true,
      },
    });

    if (!teacher) {
      throw new NotFoundException('Teacher not found');
    }

    return teacher;
  }

  // ==========================================
  // ✅ SYNC TEACHERS PHOTOS TO TURNSTILE
  // ==========================================
  async syncPhotosToTurnstile(schoolId: string) {
    const teachers = await this.prisma.teacher.findMany({
      where: {
        schoolId,
        photo: { not: null },
      },
      select: {
        id: true,
        photo: true,
        type: true,
      },
    });

    const users = teachers.map((t) => ({
      id: t.id,
      photo: t.photo!,
      type: t.type === 'DIRECTOR' ? ('director' as const) : ('teacher' as const),
    }));

    await this.turnstileService.syncSchoolPhotos(schoolId, users);

    return {
      message: 'Photos sync completed',
      total: users.length,
    };
  }
}