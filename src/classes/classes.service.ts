import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class ClassesService {
  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  private async invalidateClassCache(schoolId?: string) {
    if (schoolId) {
      await this.redis.deleteCachePattern(`classes:all:${schoolId}:*`);
    }
    await this.redis.deleteCachePattern('classes:all:global:*');
  }

  async create(createClassDto: any) {
    // Check if class already exists
    const existing = await this.prisma.class.findFirst({
      where: {
        schoolId: createClassDto.schoolId,
        grade: createClassDto.grade,
        section: createClassDto.section,
        academicYear: createClassDto.academicYear,
      },
    });

    if (existing) {
      throw new ConflictException(
        `Class ${createClassDto.grade}-${createClassDto.section} already exists for ${createClassDto.academicYear}`,
      );
    }

    const result = await this.prisma.class.create({
      data: {
        schoolId: createClassDto.schoolId,
        grade: createClassDto.grade,
        section: createClassDto.section,
        academicYear: createClassDto.academicYear,
        shift: createClassDto.shift ?? null,
        startTime: createClassDto.startTime ?? null,
        endTime: createClassDto.endTime ?? null,
      },
      include: {
        school: true,
        _count: { select: { students: true } },
        teacherClasses: { include: { teacher: true } },
      },
    });

    await this.invalidateClassCache(createClassDto.schoolId);
    return result;
  }

  async findAll(schoolId?: string, academicYear?: string) {
    const cacheKey = `classes:all:${schoolId ?? 'global'}:${academicYear ?? 'current'}`;
    const cached = await this.redis.getCache(cacheKey);
    if (cached) return cached;

    const where: any = {};
    if (schoolId) where.schoolId = schoolId;
    if (academicYear) where.academicYear = academicYear;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);

    const classes = await this.prisma.class.findMany({
      where,
      include: {
        school: true,
        _count: { select: { students: true } },
        teacherClasses: { include: { teacher: true } },
        students: { select: { id: true } },
      },
      orderBy: [{ grade: 'asc' }, { section: 'asc' }],
    });

    // N+1 fix: Barcha sinflar uchun bitta query
    const allStudentIds = classes.flatMap((cls) => cls.students.map((s) => s.id));

    const allAttendances = allStudentIds.length > 0
      ? await this.prisma.attendance.findMany({
          where: {
            studentId: { in: allStudentIds },
            date: { gte: today, lt: tomorrow },
          },
          select: { studentId: true, status: true },
        })
      : [];

    // studentId bo'yicha Map yaratamiz — tez qidirish uchun
    const attendanceMap = new Map<string, string>();
    for (const a of allAttendances) {
      if (a.studentId) attendanceMap.set(a.studentId, a.status);
    }

    const result = classes.map((cls) => {
      const studentIds = cls.students.map((s) => s.id);
      const present = studentIds.filter((id) => {
        const status = attendanceMap.get(id);
        return status === 'PRESENT' || status === 'LATE';
      }).length;
      const total = cls._count.students;
      const absent = total - present;
      const rate = total > 0 ? ((present / total) * 100).toFixed(1) : '0';
      const { students, ...classWithoutStudents } = cls;
      return { ...classWithoutStudents, attendanceStats: { present, absent, rate } };
    });

    await this.redis.setCache(cacheKey, result, 60); // 60 soniya cache
    return result;
  }

  async findOne(id: string) {
    const cls = await this.prisma.class.findUnique({
      where: { id },
      include: {
        school: true,
        students: {
          include: {
            parents: true,
          },
        },
        _count: {
          select: { students: true },
        },
      },
    });

    if (!cls) {
      throw new NotFoundException(`Class with ID ${id} not found`);
    }

    return cls;
  }

  async update(id: string, updateClassDto: any) {
    const existing = await this.prisma.class.findUnique({ where: { id } });

    if (!existing) {
      throw new NotFoundException(`Class with ID ${id} not found`);
    }

    const result = await this.prisma.class.update({
      where: { id },
      data: {
        grade: updateClassDto.grade,
        section: updateClassDto.section,
        academicYear: updateClassDto.academicYear,
        shift: updateClassDto.shift ?? undefined,
        startTime: updateClassDto.startTime ?? undefined,
        endTime: updateClassDto.endTime ?? undefined,
      },
      include: {
        school: true,
        _count: { select: { students: true } },
        teacherClasses: { include: { teacher: true } },
      },
    });

    await this.invalidateClassCache(existing.schoolId ?? undefined);
    return result;
  }

  async remove(id: string) {
    const cls = await this.prisma.class.findUnique({
      where: { id },
      include: {
        _count: {
          select: { students: true },
        },
      },
    });

    if (!cls) {
      throw new NotFoundException(`Class with ID ${id} not found`);
    }

    if (cls._count.students > 0) {
      throw new ConflictException(
        `Cannot delete class with ${cls._count.students} students. Move students first.`,
      );
    }

    await this.prisma.class.delete({ where: { id } });
    await this.invalidateClassCache(cls.schoolId ?? undefined);
    return { message: 'Class deleted successfully' };
  }
}
