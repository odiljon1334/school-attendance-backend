import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStudentDto, UpdateStudentDto } from './dto/student.dto';
import * as bcrypt from 'bcrypt';
import { UserRole } from '@prisma/client';

@Injectable()
export class StudentsService {
  constructor(private prisma: PrismaService) {}

  async create(createStudentDto: CreateStudentDto) {
    // Check if username already exists
    const existingUser = await this.prisma.user.findUnique({
      where: { username: createStudentDto.username },
    });

    if (existingUser) {
      throw new ConflictException('Username already exists');
    }

    // Check if school exists
    const school = await this.prisma.school.findUnique({
      where: { id: createStudentDto.schoolId },
    });

    if (!school) {
      throw new NotFoundException('School not found');
    }

    // Check if class exists
    const classExists = await this.prisma.class.findUnique({
      where: { id: createStudentDto.classId },
    });

    if (!classExists) {
      throw new NotFoundException('Class not found');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(createStudentDto.password, 10);

    // Create user first
    const user = await this.prisma.user.create({
      data: {
        username: createStudentDto.username,
        email: createStudentDto.email,
        password: hashedPassword,
        role: UserRole.STUDENT,
        status: 'ACTIVE',
      },
    });

    // Create student profile
    const student = await this.prisma.student.create({
      data: {
        userId: user.id,
        schoolId: createStudentDto.schoolId,
        classId: createStudentDto.classId,
        firstName: createStudentDto.firstName,
        lastName: createStudentDto.lastName,
        middleName: createStudentDto.middleName,
        dateOfBirth: createStudentDto.dateOfBirth
          ? new Date(createStudentDto.dateOfBirth)
          : null,
        gender: createStudentDto.gender,
        phone: createStudentDto.phone,
        telegramId: createStudentDto.telegramId,
        isTelegramSubscribed: createStudentDto.isTelegramSubscribed || false,
        telegramChatId: createStudentDto.telegramChatId,
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
        class: {
          select: {
            id: true,
            grade: true,
            section: true,
            academicYear: true,
          },
        },
      },
    });

    return student;
  }

  async findAll(schoolId?: string, classId?: string) {
    const where: any = {};

    if (schoolId) {
      where.schoolId = schoolId;
    }

    if (classId) {
      where.classId = classId;
    }

    return this.prisma.student.findMany({
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
        class: {
          select: {
            id: true,
            grade: true,
            section: true,
          },
        },
        _count: {
          select: {
            attendanceLogs: true,
            absenceRecords: true,
            paymentRecords: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
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
        school: {
          select: {
            id: true,
            name: true,
            code: true,
            address: true,
            phone: true,
          },
        },
        class: {
          select: {
            id: true,
            grade: true,
            section: true,
            academicYear: true,
          },
        },
        parents: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            relationship: true,
            telegramId: true,
            isTelegramSubscribed: true,
          },
        },
        _count: {
          select: {
            attendanceLogs: true,
            absenceRecords: true,
            paymentRecords: true,
          },
        },
      },
    });

    if (!student) {
      throw new NotFoundException(`Student with ID ${id} not found`);
    }

    return student;
  }

  async update(id: string, updateStudentDto: UpdateStudentDto) {
    // Check if student exists
    await this.findOne(id);

    // Check if new class exists (if updating classId)
    if (updateStudentDto.classId) {
      const classExists = await this.prisma.class.findUnique({
        where: { id: updateStudentDto.classId },
      });

      if (!classExists) {
        throw new NotFoundException('Class not found');
      }
    }

    const updateData: any = { ...updateStudentDto };

    if (updateStudentDto.dateOfBirth) {
      updateData.dateOfBirth = new Date(updateStudentDto.dateOfBirth);
    }

    return this.prisma.student.update({
      where: { id },
      data: updateData,
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
        class: {
          select: {
            id: true,
            grade: true,
            section: true,
          },
        },
      },
    });
  }

  async remove(id: string) {
    // Check if student exists
    const student = await this.findOne(id);

    // Use transaction to ensure all deletes succeed or all fail
    await this.prisma.$transaction(async (prisma) => {
      // Delete related records first
      await prisma.paymentRecord.deleteMany({ where: { studentId: id } });
      await prisma.absenceRecord.deleteMany({ where: { studentId: id } });
      await prisma.attendanceLog.deleteMany({ where: { studentId: id } });
      await prisma.parent.deleteMany({ where: { studentId: id } });

      // Delete student
      await prisma.student.delete({ where: { id } });

      // Delete user
      await prisma.user.delete({ where: { id: student.userId } });
    });

    return {
      message: 'Student and all related records deleted successfully',
      deletedStudentId: id,
    };
  }

  async getAttendanceHistory(id: string, startDate?: string, endDate?: string) {
    await this.findOne(id);

    const where: any = { studentId: id };

    if (startDate || endDate) {
      where.date = {};
      if (startDate) {
        where.date.gte = new Date(startDate);
      }
      if (endDate) {
        where.date.lte = new Date(endDate);
      }
    }

    const attendance = await this.prisma.attendanceLog.findMany({
      where,
      orderBy: {
        date: 'desc',
      },
    });

    // Calculate statistics
    const stats = {
      total: attendance.length,
      present: attendance.filter((a) => a.status === 'PRESENT').length,
      late: attendance.filter((a) => a.status === 'LATE').length,
      absent: attendance.filter((a) => a.status === 'ABSENT').length,
      excused: attendance.filter((a) => a.status === 'EXCUSED').length,
      averageLateMinutes:
        attendance
          .filter((a) => a.status === 'LATE')
          .reduce((sum, a) => sum + a.lateMinutes, 0) /
          attendance.filter((a) => a.status === 'LATE').length || 0,
    };

    return {
      statistics: stats,
      attendance,
    };
  }

  async getAbsenceRecords(id: string) {
    await this.findOne(id);

    return this.prisma.absenceRecord.findMany({
      where: { studentId: id },
      orderBy: {
        date: 'desc',
      },
    });
  }

  async getPaymentHistory(id: string) {
    await this.findOne(id);

    const payments = await this.prisma.paymentRecord.findMany({
      where: { studentId: id },
      orderBy: {
        paymentDate: 'desc',
      },
    });

    // Calculate payment statistics
    const stats = {
      total: payments.length,
      paid: payments.filter((p) => p.status === 'PAID').length,
      unpaid: payments.filter((p) => p.status === 'UNPAID').length,
      partial: payments.filter((p) => p.status === 'PARTIAL').length,
      overdue: payments.filter((p) => p.status === 'OVERDUE').length,
      totalAmount: payments.reduce((sum, p) => sum + p.amount, 0),
      paidAmount: payments
        .filter((p) => p.status === 'PAID')
        .reduce((sum, p) => sum + p.amount, 0),
      unpaidAmount: payments
        .filter((p) => p.status === 'UNPAID' || p.status === 'OVERDUE')
        .reduce((sum, p) => sum + p.amount, 0),
    };

    return {
      statistics: stats,
      payments,
    };
  }

  async getStatistics(id: string) {
    const student = await this.findOne(id);

    // Get today's date
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Today's attendance
    const todayAttendance = await this.prisma.attendanceLog.findFirst({
      where: {
        studentId: id,
        date: {
          gte: today,
        },
      },
    });

    // This month's attendance
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthAttendance = await this.prisma.attendanceLog.findMany({
      where: {
        studentId: id,
        date: {
          gte: startOfMonth,
        },
      },
    });

    const monthStats = {
      present: monthAttendance.filter((a) => a.status === 'PRESENT').length,
      late: monthAttendance.filter((a) => a.status === 'LATE').length,
      absent: monthAttendance.filter((a) => a.status === 'ABSENT').length,
    };

    // Payment status
    const unpaidPayments = await this.prisma.paymentRecord.count({
      where: {
        studentId: id,
        status: {
          in: ['UNPAID', 'OVERDUE'],
        },
      },
    });

    return {
      student: {
        id: student.id,
        fullName: `${student.firstName} ${student.lastName}`,
        class: `${student.class.grade}-${student.class.section}`,
      },
      attendance: {
        today: todayAttendance
          ? {
              status: todayAttendance.status,
              checkInTime: todayAttendance.checkInTime,
              lateMinutes: todayAttendance.lateMinutes,
            }
          : null,
        thisMonth: monthStats,
      },
      payments: {
        unpaidCount: unpaidPayments,
      },
      telegramSubscribed: student.isTelegramSubscribed,
    };
  }
}
