import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
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

  // ==========================================
  // ✅ YANGI O'QUV YILI — sinflarni bir daraja ko'tarish
  // 11-yillik: max grade = 11, 12-yillik (section "(12)" bor): max grade = 12
  // Bitiruvchilar: maxGrade ga yetgan o'quvchilar isGraduated = true bo'ladi
  // ==========================================
  async promoteYear(schoolId: string, toAcademicYear?: string) {
    if (!schoolId) throw new BadRequestException('schoolId majburiy');

    // Eng so'ngi academicYear ni aniqlash
    const latestClass = await this.prisma.class.findFirst({
      where: { schoolId },
      orderBy: { academicYear: 'desc' },
    });

    if (!latestClass) throw new NotFoundException('Bu maktabda sinflar topilmadi');

    const fromYear = latestClass.academicYear;
    const newYear = toAcademicYear ?? String(parseInt(fromYear) + 1);

    if (newYear === fromYear) {
      throw new BadRequestException(`Yangi o'quv yili (${newYear}) joriy yil bilan bir xil`);
    }

    // Joriy yildagi barcha sinflar + o'quvchilar
    const classes = await this.prisma.class.findMany({
      where: { schoolId, academicYear: fromYear },
      include: { students: { select: { id: true } } },
    });

    if (!classes.length) {
      throw new NotFoundException(`${fromYear} o'quv yilida sinflar topilmadi`);
    }

    const results = {
      fromYear,
      toYear: newYear,
      promoted: 0,       // ko'tarilgan o'quvchilar soni
      graduated: 0,      // bitiruvchilar soni
      newClasses: [] as string[],
    };

    for (const cls of classes) {
      // 12-yillik sinf: section da "(12)" bor
      const is12year = cls.section.includes('(12)');
      const maxGrade = is12year ? 12 : 11;

      if (cls.grade >= maxGrade) {
        // BITIRUVCHILAR — klassdan chiqarish (schoolId saqlab qolamiz)
        // Bitiruvchi o'quvchilar uchun alohida "graduated" klasi yaratamiz yoki
        // ularni schoolda qoldirib, classId ni null qila olmaymiz (required field).
        // Shuning uchun "Bitiruvchilar" nomli maxsus sinf yaratamiz
        let graduatedClass = await this.prisma.class.findFirst({
          where: { schoolId, grade: 0, section: 'Bitiruvchilar', academicYear: fromYear },
        });
        if (!graduatedClass) {
          graduatedClass = await this.prisma.class.create({
            data: { schoolId, grade: 0, section: 'Bitiruvchilar', academicYear: fromYear },
          });
        }

        if (cls.students.length > 0) {
          await this.prisma.student.updateMany({
            where: { classId: cls.id },
            data: { classId: graduatedClass.id },
          });
          results.graduated += cls.students.length;
        }
      } else {
        // ODDIY KO'TARISH — grade + 1, yangi o'quv yili
        const newGrade = cls.grade + 1;

        // Yangi sinf allaqachon bor bo'lsa, foydalana olamiz
        let newClass = await this.prisma.class.findFirst({
          where: { schoolId, grade: newGrade, section: cls.section, academicYear: newYear },
        });
        if (!newClass) {
          newClass = await this.prisma.class.create({
            data: {
              schoolId,
              grade: newGrade,
              section: cls.section,
              academicYear: newYear,
              shift: cls.shift ?? null,
              startTime: cls.startTime ?? null,
              endTime: cls.endTime ?? null,
            },
          });
          results.newClasses.push(`${newGrade}-${cls.section}`);
        }

        if (cls.students.length > 0) {
          await this.prisma.student.updateMany({
            where: { classId: cls.id },
            data: { classId: newClass.id },
          });
          results.promoted += cls.students.length;
        }
      }
    }

    await this.invalidateClassCache(schoolId);

    return {
      message: `O'quv yili ${fromYear} → ${newYear} muvaffaqiyatli o'tkazildi`,
      ...results,
    };
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
