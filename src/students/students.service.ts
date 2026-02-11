import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStudentDto } from './dto/student.dto';
import { UpdateStudentDto } from './dto/student.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class StudentsService {
  constructor(private prisma: PrismaService) {}

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

    // Create student
    const student = await this.prisma.student.create({
      data: {
        userId,
        schoolId: createStudentDto.schoolId,
        classId: createStudentDto.classId,
        firstName: createStudentDto.firstName,
        lastName: createStudentDto.lastName,
        middleName: createStudentDto.middleName,
        dateOfBirth: createStudentDto.dateOfBirth,
        gender: createStudentDto.gender,
        phone: createStudentDto.phone,
        telegramId: createStudentDto.telegramId,
        photo: createStudentDto.photo, // FIXED: was faceImage
        enrollNumber: createStudentDto.enrollNumber,
      },
      include: {
        user: true,
        school: true,
        class: true,
      },
    });

    // TODO: Upload photo to turnstile device if photo exists
    // if (student.photo) {
    //   await this.uploadToTurnstile(student.id, student.photo);
    // }

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

    // Update student
    const student = await this.prisma.student.update({
      where: { id },
      data: {
        firstName: updateStudentDto.firstName,
        lastName: updateStudentDto.lastName,
        middleName: updateStudentDto.middleName,
        dateOfBirth: updateStudentDto.dateOfBirth,
        gender: updateStudentDto.gender,
        phone: updateStudentDto.phone,
        telegramId: updateStudentDto.telegramId,
        photo: updateStudentDto.photo, // FIXED: was faceImage
      },
      include: {
        user: true,
        school: true,
        class: true,
        parents: true,
      },
    });

    // TODO: Update photo on turnstile device if changed
    // if (updateStudentDto.photo && updateStudentDto.photo !== existingStudent.photo) {
    //   await this.uploadToTurnstile(student.id, student.photo);
    // }

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

    // TODO: Remove from turnstile device
    // await this.removeFromTurnstile(id);

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
    const excused = attendances.filter(a => a.status === 'EXCUSED').length;

    return {
      total,
      present,
      late,
      absent,
      excused,
      attendanceRate: total > 0 ? ((present + late) / total * 100).toFixed(2) : '0',
    };
  }
}