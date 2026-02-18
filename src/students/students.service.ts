import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TurnstileService } from '../turnstile/turnstile.service';
import { CreateStudentDto } from './dto/student.dto';
import { UpdateStudentDto } from './dto/student.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class StudentsService {
  constructor(
    private prisma: PrismaService,
    private turnstileService: TurnstileService,
  ) {}

  async create(createStudentDto: CreateStudentDto) {
    // Optional: Create user account (only if needed for login)
    let userId = null;
    
    // Students don't need user accounts by default (face recognition only)
    // But we can create one for future use
    if (createStudentDto.email) {
      const user = await this.prisma.user.create({
        data: {
          username: `student_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          password: await bcrypt.hash('default123', 10), // Default password
          email: createStudentDto.email,
          role: 'STUDENT',
          status: 'ACTIVE',
        },
      });
      userId = user.id;
    }

    // Convert dateOfBirth to Date object
    const dateOfBirth = createStudentDto.dateOfBirth 
      ? new Date(createStudentDto.dateOfBirth) 
      : undefined;

    // Create student
    const student = await this.prisma.student.create({
      data: {
        userId,
        schoolId: createStudentDto.schoolId,
        classId: createStudentDto.classId,
        firstName: createStudentDto.firstName,
        lastName: createStudentDto.lastName,
        middleName: createStudentDto.middleName,
        dateOfBirth: dateOfBirth,
        gender: createStudentDto.gender,
        phone: createStudentDto.phone,
        telegramId: createStudentDto.telegramId,
        photo: createStudentDto.photo,
        enrollNumber: createStudentDto.enrollNumber,
      },
      include: {
        user: true,
        school: true,
        class: true,
      },
    });

    // Create parent if provided
    if (createStudentDto.parent) {
      await this.prisma.parent.create({
        data: {
          studentId: student.id,
          firstName: createStudentDto.parent.firstName,
          lastName: createStudentDto.parent.lastName,
          phone: createStudentDto.parent.phone,
          relationship: createStudentDto.parent.relationship,
          isTelegramActive: false,
        },
      });

      // Fetch student again with parents
      const studentWithParents = await this.prisma.student.findUnique({
        where: { id: student.id },
        include: {
          user: true,
          school: true,
          class: true,
          parents: true,
        },
      });

      // Upload photo to turnstile if exists
      if (studentWithParents.photo) {
        await this.turnstileService.uploadPhoto(
          studentWithParents.id,
          studentWithParents.photo,
          'student',
        );
      }

      return studentWithParents;
    }

    // Upload photo to turnstile if exists
    if (student.photo) {
      await this.turnstileService.uploadPhoto(
        student.id,
        student.photo,
        'student',
      );
    }

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
            id: true,
            username: true,
            email: true,
            role: true,
            status: true,
          },
        },
        school: true,
        class: true,
        parents: true,
      },
      orderBy: {
        lastName: 'asc',
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
        school: true,
        class: true,
        parents: true,
        attendances: {
          orderBy: {
            date: 'desc',
          },
          take: 30, // Last 30 days
        },
        payments: {
          orderBy: {
            dueDate: 'desc',
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
    const existingStudent = await this.prisma.student.findUnique({
      where: { id },
    });

    if (!existingStudent) {
      throw new NotFoundException(`Student with ID ${id} not found`);
    }

    // Convert dateOfBirth to Date object if provided
    const dateOfBirth = updateStudentDto.dateOfBirth 
      ? new Date(updateStudentDto.dateOfBirth) 
      : undefined;

    // Update student
    const student = await this.prisma.student.update({
      where: { id },
      data: {
        firstName: updateStudentDto.firstName,
        lastName: updateStudentDto.lastName,
        middleName: updateStudentDto.middleName,
        dateOfBirth: dateOfBirth,
        gender: updateStudentDto.gender,
        phone: updateStudentDto.phone,
        telegramId: updateStudentDto.telegramId,
        photo: updateStudentDto.photo,
      },
      include: {
        user: true,
        school: true,
        class: true,
        parents: true,
      },
    });

    // Update photo on turnstile if changed
    if (updateStudentDto.photo && updateStudentDto.photo !== existingStudent.photo) {
      await this.turnstileService.updatePhoto(
        student.id,
        student.photo,
        'student',
      );
    }

    return student;
  }

  async remove(id: string) {
    // Check if student exists
    const student = await this.prisma.student.findUnique({
      where: { id },
      include: { user: true },
    });

    if (!student) {
      throw new NotFoundException(`Student with ID ${id} not found`);
    }

    // Delete related records first
    await this.prisma.attendance.deleteMany({ where: { studentId: id } });
    await this.prisma.payment.deleteMany({ where: { studentId: id } });
    await this.prisma.parent.deleteMany({ where: { studentId: id } });

    // Delete student
    await this.prisma.student.delete({ where: { id } });

    // Delete user account if exists
    if (student.userId) {
      await this.prisma.user.delete({ where: { id: student.userId } });
    }

    // Remove from turnstile device
    await this.turnstileService.removePhoto(id);

    return { message: 'Student deleted successfully' };
  }

  // Get student attendance statistics
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
    const present = attendances.filter(a => a.status === 'PRESENT').length;
    const late = attendances.filter(a => a.status === 'LATE').length;
    const absent = attendances.filter(a => a.status === 'ABSENT').length;
    const leave = attendances.filter(a => a.status === 'LEAVE').length;
    const holiday = attendances.filter(a => a.status === 'HOLIDAY').length;

    return {
      total,
      present,
      late,
      absent,
      leave,
      holiday,
      attendanceRate: total > 0 ? ((present + late) / total * 100).toFixed(2) : '0',
    };
  }

  // Sync all students photos to turnstile
  async syncPhotosToTurnstile(schoolId: string) {
    const students = await this.prisma.student.findMany({
      where: {
        schoolId,
        photo: { not: null },
      },
      select: {
        id: true,
        photo: true,
      },
    });

    const users = students.map(s => ({
      id: s.id,
      photo: s.photo,
      type: 'student',
    }));

    await this.turnstileService.syncSchoolPhotos(schoolId, users);

    return {
      message: 'Photos sync completed',
      total: users.length,
    };
  }
}