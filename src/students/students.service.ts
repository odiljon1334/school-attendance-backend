import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TurnstileService } from '../turnstile/turnstile.service';
import { RedisService } from '../redis/redis.service';
import { CreateStudentDto } from './dto/student.dto';
import { UpdateStudentDto } from './dto/student.dto';
import * as bcrypt from 'bcrypt';
import { AuditLogService } from '../audit-log/audit-log.service';
import { compressImage } from '../utils/image.utils';

function pad(num: number, size: number) {
  return String(num).padStart(size, '0');
}

function buildEnroll(prefix: '20', year: number, seq: number) {
  return `${prefix}${year}${pad(seq, 3)}`;
}

@Injectable()
export class StudentsService {
  constructor(
    private prisma: PrismaService,
    private turnstileService: TurnstileService,
    private redis: RedisService,
    private auditLog: AuditLogService,
  ) {}

  private async nextStudentEnrollNumber(tx: PrismaService, schoolId: string) {
    const year = new Date().getFullYear();

    const counter = await tx.enrollCounter.upsert({
      where: { schoolId },
      create: { schoolId, studentSeq: 1, staffSeq: 0 },
      update: { studentSeq: { increment: 1 } },
      select: { studentSeq: true },
    });

    return buildEnroll('20', year, counter.studentSeq);
  }

  private cleanStr(v: any): string | null {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    return s.length ? s : null;
  }

  private async ensureUniqueEnrollNumber(tx: any, enrollNumber: string, schoolId: string, selfStudentId?: string) {
    const [studentDup, teacherDup] = await Promise.all([
      tx.student.findFirst({ where: { enrollNumber, schoolId }, select: { id: true } }),
      tx.teacher.findFirst({ where: { enrollNumber, schoolId }, select: { id: true } }),
    ]);

    if (teacherDup) throw new BadRequestException(`enrollNumber already exists in this school: ${enrollNumber}`);
    if (studentDup && studentDup.id !== selfStudentId)
      throw new BadRequestException(`enrollNumber already exists in this school: ${enrollNumber}`);
  }
  
  private async linkParentSmsSingle(
    tx: any,
    studentId: string,
    parentId: string,
    relationship: 'FATHER' | 'MOTHER' | 'PARENT' = 'PARENT',
  ) {
    // ✅ finans: faqat bittasiga SMS
    await tx.studentParent.updateMany({
      where: { studentId },
      data: { notifySms: false },
    });
  
    await tx.studentParent.upsert({
      where: { studentId_parentId: { studentId, parentId } },
      update: { notifySms: true, relationship },
      create: { studentId, parentId, notifySms: true, relationship },
    });
  }

  async create(createStudentDto: CreateStudentDto) {
    if (!createStudentDto.schoolId) throw new BadRequestException('schoolId is required');
    if (!createStudentDto.classId) throw new BadRequestException('classId is required');
  
    const dateOfBirth = createStudentDto.dateOfBirth ? new Date(createStudentDto.dateOfBirth) : undefined;
  
    return this.prisma.$transaction(async (tx) => {
      // 1) optional user create
      let userId: string | null = null;
      if (createStudentDto.email) {
        const user = await tx.user.create({
          data: {
            username: `student_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            password: await bcrypt.hash('default123', 10),
            email: createStudentDto.email,
            role: 'STUDENT',
            status: 'ACTIVE',
          },
        });
        userId = user.id;
      }
  
      // 2) ✅ enrollNumber ONLY if photo exists OR manual provided AND photo exists
      // Rasmni compress qilamiz (3-6MB → ~50-100KB)
      const rawPhoto = createStudentDto.photo && String(createStudentDto.photo).trim()
        ? await compressImage(createStudentDto.photo, { maxWidth: 400, maxHeight: 400, quality: 80 })
        : null;
      const hasPhoto = !!rawPhoto;
      let enrollNumber: string | null = null;
  
      if (hasPhoto) {
        enrollNumber = createStudentDto.enrollNumber?.trim()
          ? createStudentDto.enrollNumber.trim()
          : await this.nextStudentEnrollNumber(tx as any, createStudentDto.schoolId);
  
        await this.ensureUniqueEnrollNumber(tx, enrollNumber, createStudentDto.schoolId);
      } else {
        // photo yo'q -> enrollNumber kerak emas
        enrollNumber = null;
      }
  
      // 3) create student
      const student = await tx.student.create({
        data: {
          userId,
          schoolId: createStudentDto.schoolId,
          classId: createStudentDto.classId,
          firstName: createStudentDto.firstName,
          lastName: createStudentDto.lastName,
          middleName: createStudentDto.middleName ?? null,
          dateOfBirth,
          gender: createStudentDto.gender,
          phone: createStudentDto.phone ?? null,
          telegramId: createStudentDto.telegramId ?? null,
          photo: rawPhoto,
          facePersonId: createStudentDto.facePersonId || null,
          enrollNumber,
          billingPlan: createStudentDto.billingPlan ?? undefined,
        },
      });
  
      // 4) ✅ Parent link (many-to-many) + notifySms single
      if (createStudentDto.parent?.phone) {
        const phone = createStudentDto.parent.phone.trim();
        const parent = await tx.parent.upsert({
          where: { phone },
          update: {
            firstName: createStudentDto.parent.firstName ?? undefined,
            lastName: createStudentDto.parent.lastName ?? undefined,
          },
          create: {
            phone,
            firstName: createStudentDto.parent.firstName ?? null,
            lastName: createStudentDto.parent.lastName ?? null,
            isTelegramActive: false,
          },
        });
  
        await this.linkParentSmsSingle(
          tx,
          student.id,
          parent.id,
          (createStudentDto.parent.relationship as any) || 'PARENT',
        );
      }
  
      const result = await tx.student.findUnique({
        where: { id: student.id },
        include: {
          user: true,
          school: true,
          class: true,
          parents: { include: { parent: true } },
        },
      });

      await this.redis.deleteCachePattern(`classes:all:${createStudentDto.schoolId}:*`);
      await this.redis.deleteCachePattern(`students:list:${createStudentDto.schoolId}:*`);

      void this.auditLog.log({
        action: 'STUDENT_CREATE',
        entity: 'Student',
        entityId: student.id,
        schoolId: createStudentDto.schoolId,
        details: { name: `${createStudentDto.firstName} ${createStudentDto.lastName}` },
      });

      return result;
    });
  }

  async findAll(schoolId?: string, classId?: string) {
    // ✅ Redis cache — DB ga har safar urinmaymiz
    const cacheKey = `students:list:${schoolId ?? 'all'}:${classId ?? 'all'}`;
    const cached = await this.redis.getCache(cacheKey);
    if (cached) return cached;

    const where: any = {};
    if (schoolId) where.schoolId = schoolId;
    if (classId) where.classId = classId;

    const students = await this.prisma.student.findMany({
      where,
      select: {
        id: true,
        schoolId: true,
        classId: true,
        firstName: true,
        lastName: true,
        middleName: true,
        dateOfBirth: true,
        gender: true,
        phone: true,
        enrollNumber: true,
        billingPlan: true,
        billingPaidUntil: true,
        facePersonId: true,
        telegramId: true,
        createdAt: true,
        updatedAt: true,
        // ✅ photo YUKLAMAYMIZ — hasPhoto flag yetarli
        photo: true,
        // ✅ school YUKLAMAYMIZ — frontend allaqachon school ma'lumotini biladi
        class: { select: { id: true, grade: true, section: true } },
        parents: {
          select: {
            parentId: true,
            relationship: true,
            notifySms: true,
            parent: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                phone: true,
                isWhatsappActive: true,
                isTelegramActive: true,
              },
            },
          },
        },
      },
      orderBy: { lastName: 'asc' },
    });

    const result = students.map(({ photo, ...rest }) => ({
      ...rest,
      hasPhoto: !!photo,
    }));

    // ✅ 2 daqiqa cache — create/update/delete da invalidate qilinadi
    await this.redis.setCache(cacheKey, result, 120);
    return result;
  }

  // Faqat photo field uchun — dedicated endpoint ishlatadi
  async getPhotoById(id: string) {
    return this.prisma.student.findUnique({
      where: { id },
      select: { photo: true },
    });
  }

  async findOne(id: string) {
    const student = await this.prisma.student.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            email: true,
            role: true,
            status: true,
          },
        },
        school: true,
        class: true,
        parents: {
          include: {
            parent: true,
          }
        },
        attendances: { orderBy: { date: 'desc' }, take: 30 },
        payments: { orderBy: { dueDate: 'desc' }, take: 36 }, // 3 yil max
      },
    });

    if (!student) throw new NotFoundException(`Student with ID ${id} not found`);
    return student;
  }

  async update(id: string, dto: UpdateStudentDto) {

    const existing = await this.prisma.student.findUnique({
      where: { id },
      include: { parents: true },
    });
    if (!existing) throw new NotFoundException(`Student with ID ${id} not found`);
  
    const dateOfBirth = dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined;
  
    return this.prisma.$transaction(async (tx) => {
      const rawIncoming = dto.photo !== undefined
        ? this.cleanStr(dto.photo)
        : dto.faceImage !== undefined
        ? this.cleanStr(dto.faceImage)
        : undefined;
      // ✅ Rasmni compress qilamiz (3-6MB → ~50-100KB)
      const incomingPhoto = rawIncoming
        ? await compressImage(rawIncoming, { maxWidth: 400, maxHeight: 400, quality: 80 })
        : rawIncoming;
      const photoWillBeSetNow =
        incomingPhoto !== undefined && incomingPhoto !== null && !existing.photo;
  
      let enrollNumberToSet: string | undefined = undefined;
  
      if (photoWillBeSetNow && !existing.enrollNumber) {
        const manualEnroll = this.cleanStr(dto.enrollNumber);
        const candidate = manualEnroll
          ? manualEnroll
          : await this.nextStudentEnrollNumber(tx as any, existing.schoolId);
  
        await this.ensureUniqueEnrollNumber(tx, candidate, existing.schoolId, id);
        enrollNumberToSet = candidate;
      }
  
      // ✅ If dto.enrollNumber provided but photo not set -> ignore / block
      if (dto.enrollNumber?.trim() && (!photoWillBeSetNow && !existing.photo)) {
        throw new BadRequestException('enrollNumber can be assigned only after photo is uploaded');
      }
  

      const student = await tx.student.update({
        where: { id },
        data: {
          firstName: dto.firstName ?? undefined,
          lastName: dto.lastName ?? undefined,
          middleName: dto.middleName !== undefined ? this.cleanStr(dto.middleName) : undefined,
          dateOfBirth,
          gender: dto.gender ?? undefined,
          phone: dto.phone !== undefined ? this.cleanStr(dto.phone) : undefined,
          telegramId: dto.telegramId !== undefined ? this.cleanStr(dto.telegramId) : undefined,
          photo: incomingPhoto === undefined ? undefined : incomingPhoto,
          facePersonId: dto.facePersonId !== undefined ? this.cleanStr(dto.facePersonId) : undefined,
          enrollNumber: enrollNumberToSet,
          billingPlan: dto.billingPlan ?? undefined,
        },
      });

  
      // ✅ FIX: Parent link update — avval eski linklarni o'chiramiz, keyin yangi upsert
      if (dto.parent?.phone) {
        const phone = dto.parent.phone.trim();

        // ✅ Eski barcha linklarni o'chiramiz (duplicate oldini olish)
        await tx.studentParent.deleteMany({
          where: { studentId: student.id },
        });

        const parent = await tx.parent.upsert({
          where: { phone },
          update: {
            firstName: dto.parent.firstName ?? undefined,
            lastName: dto.parent.lastName ?? undefined,
          },
          create: {
            phone,
            firstName: dto.parent.firstName ?? null,
            lastName: dto.parent.lastName ?? null,
            isTelegramActive: false,
          },
        });
  
        await this.linkParentSmsSingle(tx, student.id, parent.id, (dto.parent.relationship as any) || 'PARENT');
      }

  
      const updated = await tx.student.findUnique({
        where: { id: student.id },
        include: {
          user: true,
          school: true,
          class: true,
          parents: { include: { parent: true } },
        },
      });

      void this.auditLog.log({
        action: 'STUDENT_UPDATE',
        entity: 'Student',
        entityId: id,
        schoolId: existing.schoolId,
        details: { name: `${existing.firstName} ${existing.lastName}` },
      });

      return updated;
    });
  }

  async transferStudent(
    id: string,
    classId: string,
    schoolId?: string,
  ) {
    const student = await this.prisma.student.findUnique({
      where: { id },
      select: { id: true, schoolId: true, classId: true, firstName: true, lastName: true },
    });
    if (!student) throw new NotFoundException(`Student not found`);

    // Validate target class exists
    const targetClass = await this.prisma.class.findUnique({
      where: { id: classId },
      select: { id: true, schoolId: true, grade: true, section: true },
    });
    if (!targetClass) throw new NotFoundException(`Target class not found`);

    // Determine target school
    const targetSchoolId = schoolId ?? student.schoolId;

    // Class must belong to target school
    if (targetClass.schoolId !== targetSchoolId) {
      throw new BadRequestException('Class does not belong to the target school');
    }

    const oldSchoolId = student.schoolId;
    const oldClassId = student.classId;

    const updated = await this.prisma.student.update({
      where: { id },
      data: {
        classId,
        ...(schoolId ? { schoolId } : {}),
      },
      include: {
        class: true,
        school: true,
        parents: { include: { parent: true } },
      },
    });

    // Clear Redis caches for affected schools
    await this.redis.deleteCachePattern(`classes:all:${oldSchoolId}:*`);
    await this.redis.deleteCachePattern(`students:list:${oldSchoolId}:*`);
    if (schoolId && schoolId !== oldSchoolId) {
      await this.redis.deleteCachePattern(`classes:all:${targetSchoolId}:*`);
      await this.redis.deleteCachePattern(`students:list:${targetSchoolId}:*`);
    }

    void this.auditLog.log({
      action: 'STUDENT_TRANSFER',
      entity: 'Student',
      entityId: id,
      schoolId: targetSchoolId,
      details: {
        name: `${student.firstName} ${student.lastName}`,
        fromClassId: oldClassId,
        toClassId: classId,
        fromSchoolId: oldSchoolId,
        toSchoolId: targetSchoolId,
      },
    });

    return updated;
  }

  async remove(id: string) {
    const student = await this.prisma.student.findUnique({
      where: { id },
      include: {
        user: true,
        parents: { include: { parent: true } },
      },
    });
  
    if (!student) throw new NotFoundException(`Student with ID ${id} not found`);
  
    // ✅ Parent larni yig'ib olamiz
    const parentIds = student.parents.map((sp) => sp.parentId);
  
    await this.prisma.studentParent.deleteMany({ where: { studentId: id } });
    await this.prisma.attendance.deleteMany({ where: { studentId: id } });
    await this.prisma.payment.deleteMany({ where: { studentId: id } });
    await this.prisma.student.delete({ where: { id } });
  
    // ✅ Har bir parentni tekshiramiz — boshqa studentlari yo'q bo'lsa o'chiramiz
    for (const parentId of parentIds) {
      const otherLinks = await this.prisma.studentParent.count({
        where: { parentId },
      });

      if (otherLinks === 0) {
        await this.prisma.parent.delete({ where: { id: parentId } });
      }
    }

    // Invalidate class + students cache so counts update immediately
    await this.redis.deleteCachePattern(`classes:all:${student.schoolId}:*`);
    await this.redis.deleteCachePattern(`students:list:${student.schoolId}:*`);

    void this.auditLog.log({
      action: 'STUDENT_DELETE',
      entity: 'Student',
      entityId: id,
      schoolId: student.schoolId,
      details: { name: `${student.firstName} ${student.lastName}` },
    });

    return { message: 'Student deleted successfully' };
  }

  async removeAllBySchool(schoolId: string) {
    // Get all student IDs for the school
    const students = await this.prisma.student.findMany({
      where: { schoolId },
      select: { id: true },
    });

    if (students.length === 0) {
      return { message: 'No students found for this school', deleted: 0 };
    }

    const studentIds = students.map((s) => s.id);

    // Delete all related records in bulk
    await this.prisma.studentParent.deleteMany({ where: { studentId: { in: studentIds } } });
    await this.prisma.attendance.deleteMany({ where: { studentId: { in: studentIds } } });
    await this.prisma.payment.deleteMany({ where: { studentId: { in: studentIds } } });

    // Delete orphaned parents (parents with no remaining student links)
    const orphanedParents = await this.prisma.parent.findMany({
      where: {
        students: { none: {} },
      },
      select: { id: true },
    });
    if (orphanedParents.length) {
      await this.prisma.parent.deleteMany({
        where: { id: { in: orphanedParents.map((p) => p.id) } },
      });
    }

    // Delete all students
    const { count } = await this.prisma.student.deleteMany({ where: { schoolId } });

    // Delete empty classes for the school
    await this.prisma.class.deleteMany({
      where: { schoolId, students: { none: {} } },
    });

    await this.redis.deleteCachePattern(`classes:all:${schoolId}:*`);
    await this.redis.deleteCachePattern(`students:list:${schoolId}:*`);

    void this.auditLog.log({
      action: 'STUDENT_BULK_DELETE',
      entity: 'Student',
      entityId: schoolId,
      schoolId,
      details: { deleted: count, reason: 'Bulk delete by school admin' },
    });

    return { message: `Deleted ${count} students and their related data`, deleted: count };
  }

  async getAttendanceStats(studentId: string, startDate?: Date, endDate?: Date) {
    const where: any = { studentId };

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
    const leave = attendances.filter((a) => a.status === 'LEAVE').length;
    const holiday = attendances.filter((a) => a.status === 'HOLIDAY').length;

    return {
      total,
      present,
      late,
      absent,
      leave,
      holiday,
      attendanceRate: total > 0 ? (((present + late) / total) * 100).toFixed(2) : '0',
    };
  }

  async getPhotoStatus(schoolId: string) {
    const students = await this.prisma.student.findMany({
      where: { schoolId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        photo: true,
        class: { select: { id: true, grade: true, section: true } },
      },
      orderBy: [{ class: { grade: 'asc' } }, { lastName: 'asc' }],
    });

    const classMap = new Map<string, {
      classId: string;
      className: string;
      total: number;
      withPhoto: number;
      withoutPhoto: number;
      studentsWithoutPhoto: { id: string; name: string }[];
    }>();

    for (const s of students) {
      const classId = s.class?.id ?? 'NO_CLASS';
      const className = s.class ? `${s.class.grade}-${s.class.section}` : 'Без класса';

      if (!classMap.has(classId)) {
        classMap.set(classId, { classId, className, total: 0, withPhoto: 0, withoutPhoto: 0, studentsWithoutPhoto: [] });
      }

      const entry = classMap.get(classId)!;
      entry.total++;
      if (s.photo) {
        entry.withPhoto++;
      } else {
        entry.withoutPhoto++;
        entry.studentsWithoutPhoto.push({ id: s.id, name: `${s.firstName} ${s.lastName}` });
      }
    }

    const classes = Array.from(classMap.values()).sort((a, b) => a.className.localeCompare(b.className));
    const total = students.length;
    const withPhoto = students.filter((s) => s.photo).length;

    return { total, withPhoto, withoutPhoto: total - withPhoto, classes };
  }

  async syncPhotosToTurnstile(schoolId: string) {
    const students = await this.prisma.student.findMany({
      where: { schoolId, photo: { not: null } },
      select: { id: true, photo: true },
    });

    const users = students.map((s) => ({
      id: s.id,
      photo: s.photo!,
      type: 'student' as const,
    }));

    await this.turnstileService.syncSchoolPhotos(schoolId, users);

    return { message: 'Photos sync completed', total: users.length };
  }
}