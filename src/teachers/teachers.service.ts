import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTeacherDto, UpdateTeacherDto } from './dto/teacher.dto';
import * as bcrypt from 'bcrypt';
import { UserRole } from '@prisma/client';

@Injectable()
export class TeachersService {
  constructor(private prisma: PrismaService) {}

  async create(createTeacherDto: CreateTeacherDto) {
    const { username, password, email, schoolId } = createTeacherDto;

    // Check if username already exists
    const existingUser = await this.prisma.user.findUnique({
      where: { username },
    });

    if (existingUser) {
      throw new ConflictException('Username already exists');
    }

    // Check if school exists
    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
    });

    if (!school) {
      throw new NotFoundException('School not found');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = await this.prisma.user.create({
      data: {
        username,
        email,
        password: hashedPassword,
        role: UserRole.TEACHER,
        status: 'ACTIVE',
      },
    });

    // Create teacher profile
    return this.prisma.teacher.create({
      data: {
        userId: user.id,
        schoolId,
        firstName: createTeacherDto.firstName,
        lastName: createTeacherDto.lastName,
        phone: createTeacherDto.phone,
        subjects: createTeacherDto.subjects,
        telegramId: createTeacherDto.telegramId,
        photo: createTeacherDto.photo,
      },
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
        school: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
      },
    });
  }

  async findAll(schoolId?: string) {
    const where: any = {};

    if (schoolId) {
      where.schoolId = schoolId;
    }

    return this.prisma.teacher.findMany({
      where,
      include: {
        user: {
          select: {
            username: true,
            email: true,
            status: true,
          },
        },
        school: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
        _count: {
          select: {
            attendanceLogs: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findOne(id: string) {
    const teacher = await this.prisma.teacher.findUnique({
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
        school: {
          select: {
            id: true,
            name: true,
            code: true,
            address: true,
          },
        },
        attendanceLogs: {
          orderBy: {
            date: 'desc',
          },
          take: 10, // Last 10 attendance logs
        },
      },
    });

    if (!teacher) {
      throw new NotFoundException(`Teacher with ID ${id} not found`);
    }

    return teacher;
  }

  async update(id: string, updateTeacherDto: UpdateTeacherDto) {
    await this.findOne(id);

    return this.prisma.teacher.update({
      where: { id },
      data: updateTeacherDto,
      include: {
        user: {
          select: {
            username: true,
            email: true,
            status: true,
          },
        },
        school: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
      },
    });
  }

  async remove(id: string) {
    const teacher = await this.findOne(id);

    await this.prisma.$transaction(async (prisma) => {
      // Delete attendance logs
      await prisma.attendanceLog.deleteMany({ where: { teacherId: id } });

      // Delete teacher
      await prisma.teacher.delete({ where: { id } });

      // Delete user
      await prisma.user.delete({ where: { id: teacher.userId } });
    });

    return { message: 'Teacher and all related records deleted successfully' };
  }

  async getAttendanceHistory(id: string, startDate?: string, endDate?: string) {
    await this.findOne(id);

    const where: any = { teacherId: id };

    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = new Date(startDate);
      if (endDate) where.date.lte = new Date(endDate);
    }

    const attendance = await this.prisma.attendanceLog.findMany({
      where,
      orderBy: { date: 'desc' },
    });

    const stats = {
      total: attendance.length,
      present: attendance.filter((a) => a.status === 'PRESENT').length,
      late: attendance.filter((a) => a.status === 'LATE').length,
      absent: attendance.filter((a) => a.status === 'ABSENT').length,
      averageLateMinutes:
        attendance.filter((a) => a.status === 'LATE').length > 0
          ? attendance
              .filter((a) => a.status === 'LATE')
              .reduce((sum, a) => sum + a.lateMinutes, 0) /
            attendance.filter((a) => a.status === 'LATE').length
          : 0,
    };

    return { statistics: stats, attendance };
  }

  async getStatistics(id: string) {
    const teacher = await this.findOne(id);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Today's attendance
    const todayAttendance = await this.prisma.attendanceLog.findFirst({
      where: {
        teacherId: id,
        date: { gte: today },
      },
    });

    // This month's attendance
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthAttendance = await this.prisma.attendanceLog.findMany({
      where: {
        teacherId: id,
        date: { gte: startOfMonth },
      },
    });

    return {
      teacher: {
        id: teacher.id,
        fullName: `${teacher.firstName} ${teacher.lastName}`,
        subjects: teacher.subjects,
        school: teacher.school,
      },
      attendance: {
        today: todayAttendance
          ? {
              status: todayAttendance.status,
              checkInTime: todayAttendance.checkInTime,
              lateMinutes: todayAttendance.lateMinutes,
            }
          : null,
        thisMonth: {
          present: monthAttendance.filter((a) => a.status === 'PRESENT').length,
          late: monthAttendance.filter((a) => a.status === 'LATE').length,
          absent: monthAttendance.filter((a) => a.status === 'ABSENT').length,
        },
      },
    };
  }
}
