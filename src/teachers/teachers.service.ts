import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTeacherDto, UpdateTeacherDto } from './dto/teacher.dto';

@Injectable()
export class TeachersService {
  constructor(private prisma: PrismaService) {}

  // ==========================================
  // ✅ CREATE - WITH TYPE
  // ==========================================
  async create(createTeacherDto: CreateTeacherDto) {
    const teacher = await this.prisma.teacher.create({
      data: {
        type: createTeacherDto.type || 'TEACHER', // ← TEACHER yoki DIRECTOR
        schoolId: createTeacherDto.schoolId || null,
        firstName: createTeacherDto.firstName || null,
        lastName: createTeacherDto.lastName || null,
        phone: createTeacherDto.phone || null,
        telegramId: createTeacherDto.telegramId || null,
        subjects: createTeacherDto.subjects || [],
        photo: createTeacherDto.photo || null,
        facePersonId: createTeacherDto.facePersonId || null,
        enrollNumber: createTeacherDto.enrollNumber || null,
      },
      include: {
        school: true,
        teacherClasses: {
          include: {
            class: true,
          },
        },
      },
    });

    // ✅ Assign classes if provided
    if (createTeacherDto.classIds && createTeacherDto.classIds.length > 0) {
      await this.prisma.teacherClass.createMany({
        data: createTeacherDto.classIds.map((classId: string) => ({
          teacherId: teacher.id,
          classId,
        })),
      });
    }

    return teacher;
  }

  // ==========================================
  // ✅ FIND ALL - WITH TYPE FILTER
  // ==========================================
  async findAll(schoolId?: string, type?: 'TEACHER' | 'DIRECTOR') {
    const where: any = {};

    if (schoolId) {
      where.schoolId = schoolId;
    }

    if (type) {
      where.type = type;
    }

    return this.prisma.teacher.findMany({
      where,
      include: {
        school: true,
        teacherClasses: {
          include: {
            class: true,
          },
        },
        _count: {
          select: {
            attendances: true,
          },
        },
      },
      orderBy: {
        lastName: 'asc',
      },
    });
  }

  // ==========================================
  // ✅ FIND DIRECTORS (helper)
  // ==========================================
  async findDirectors(schoolId?: string) {
    return this.findAll(schoolId, 'DIRECTOR');
  }

  // ==========================================
  // ✅ FIND TEACHERS (helper)
  // ==========================================
  async findTeachers(schoolId?: string) {
    return this.findAll(schoolId, 'TEACHER');
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
  // ✅ UPDATE - WITH TYPE
  // ==========================================
  async update(id: string, updateTeacherDto: UpdateTeacherDto) {
    const existingTeacher = await this.prisma.teacher.findUnique({
      where: { id },
    });

    if (!existingTeacher) {
      throw new NotFoundException(`Teacher with ID ${id} not found`);
    }

    const teacher = await this.prisma.teacher.update({
      where: { id },
      data: {
        type: updateTeacherDto.type, // ← Type update
        firstName: updateTeacherDto.firstName,
        lastName: updateTeacherDto.lastName,
        phone: updateTeacherDto.phone,
        telegramId: updateTeacherDto.telegramId,
        subjects: updateTeacherDto.subjects,
        photo: updateTeacherDto.photo,
        facePersonId: updateTeacherDto.facePersonId,
        enrollNumber: updateTeacherDto.enrollNumber,
      },
      include: {
        school: true,
        teacherClasses: {
          include: {
            class: true,
          },
        },
      },
    });

    // ✅ Update assigned classes if provided
    if (updateTeacherDto.classIds) {
      await this.prisma.teacherClass.deleteMany({
        where: { teacherId: id },
      });

      if (updateTeacherDto.classIds.length > 0) {
        await this.prisma.teacherClass.createMany({
          data: updateTeacherDto.classIds.map((classId: string) => ({
            teacherId: id,
            classId,
          })),
        });
      }
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
  // ✅ REMOVE
  // ==========================================
  async remove(id: string) {
    const teacher = await this.prisma.teacher.findUnique({
      where: { id },
    });

    if (!teacher) {
      throw new NotFoundException(`Teacher with ID ${id} not found`);
    }

    await this.prisma.teacherClass.deleteMany({ where: { teacherId: id } });
    await this.prisma.attendance.deleteMany({ where: { teacherId: id } });
    await this.prisma.teacher.delete({ where: { id } });

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
      type: teacher.type, // ← Type qo'shildi
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
}