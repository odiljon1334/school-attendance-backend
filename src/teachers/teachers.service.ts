import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTeacherDto } from './dto/teacher.dto';
import { UpdateTeacherDto } from './dto/teacher.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class TeachersService {
  constructor(private prisma: PrismaService) {}

  async create(createTeacherDto: CreateTeacherDto) {
    // Create user account first
    const user = await this.prisma.user.create({
      data: {
        username: createTeacherDto.username,
        password: await bcrypt.hash(createTeacherDto.password, 10),
        email: createTeacherDto.email,
        role: 'TEACHER',
        status: 'ACTIVE',
      },
    });

    // Create teacher
    const teacher = await this.prisma.teacher.create({
      data: {
        userId: user.id,
        schoolId: createTeacherDto.schoolId,
        firstName: createTeacherDto.firstName,
        lastName: createTeacherDto.lastName,
        phone: createTeacherDto.phone,
        telegramId: createTeacherDto.telegramId,
        subjects: Array.isArray(createTeacherDto.subjects)
          ? createTeacherDto.subjects
          : (typeof createTeacherDto.subjects === 'string' && createTeacherDto.subjects
              ? (createTeacherDto.subjects as string).split(',').map((s: string) => s.trim())
              : undefined),
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
        school: true,
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

    // TODO: Upload photo to turnstile if exists
    // if (teacher.photo) {
    //   await this.uploadToTurnstile(teacher.id, teacher.photo);
    // }

    return teacher;
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
            id: true,
            username: true,
            email: true,
            role: true,
            status: true,
          },
        },
        school: true,
        teacherClasses: { // ✅ FIXED: Include assigned classes
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
        school: true,
        teacherClasses: { // ✅ FIXED: Include assigned classes
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

  async update(id: string, updateTeacherDto: UpdateTeacherDto) {
    // Check if teacher exists
    const existingTeacher = await this.prisma.teacher.findUnique({
      where: { id },
      include: { user: true },
    });

    if (!existingTeacher) {
      throw new NotFoundException(`Teacher with ID ${id} not found`);
    }

    // Update user if password or email changed
    if (updateTeacherDto.password || updateTeacherDto.email) {
      const userData: any = {};
      
      if (updateTeacherDto.email) {
        userData.email = updateTeacherDto.email;
      }
      
      if (updateTeacherDto.password) {
        userData.password = await bcrypt.hash(updateTeacherDto.password, 10);
      }

      await this.prisma.user.update({
        where: { id: existingTeacher.userId },
        data: userData,
      });
    }

    // Update teacher
    const teacher = await this.prisma.teacher.update({
      where: { id },
      data: {
        firstName: updateTeacherDto.firstName,
        lastName: updateTeacherDto.lastName,
        phone: updateTeacherDto.phone,
        telegramId: updateTeacherDto.telegramId,
        subjects: Array.isArray(updateTeacherDto.subjects)
        ? updateTeacherDto.subjects
        : (typeof updateTeacherDto.subjects === 'string' && updateTeacherDto.subjects
            ? (updateTeacherDto.subjects as string).split(',').map((s: string) => s.trim())
            : undefined),
        photo: updateTeacherDto.photo,
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
        school: true,
        teacherClasses: { // ✅ FIXED: Include assigned classes
          include: {
            class: true,
          },
        },
      },
    });

    // ✅ Update assigned classes if provided
    if (updateTeacherDto.classIds) {
      // Delete old assignments
      await this.prisma.teacherClass.deleteMany({
        where: { teacherId: id },
      });

      // Create new assignments
      if (updateTeacherDto.classIds.length > 0) {
        await this.prisma.teacherClass.createMany({
          data: updateTeacherDto.classIds.map((classId: string) => ({
            teacherId: id,
            classId,
          })),
        });
      }
    }

    // TODO: Update photo on turnstile if changed
    // if (updateTeacherDto.photo && updateTeacherDto.photo !== existingTeacher.photo) {
    //   await this.uploadToTurnstile(teacher.id, teacher.photo);
    // }

    return teacher;
  }

  async remove(id: string) {
    // Check if teacher exists
    const teacher = await this.prisma.teacher.findUnique({
      where: { id },
      include: { user: true },
    });

    if (!teacher) {
      throw new NotFoundException(`Teacher with ID ${id} not found`);
    }

    // Delete related records
    await this.prisma.teacherClass.deleteMany({ where: { teacherId: id } }); // ✅ FIXED
    await this.prisma.attendance.deleteMany({ where: { teacherId: id } });

    // Delete teacher
    await this.prisma.teacher.delete({ where: { id } });

    // Delete user account
    await this.prisma.user.delete({ where: { id: teacher.userId } });

    // TODO: Remove from turnstile
    // await this.removeFromTurnstile(id);

    return { message: 'Teacher deleted successfully' };
  }

  // Get teacher attendance statistics
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
    const present = attendances.filter(a => a.status === 'PRESENT').length;
    const late = attendances.filter(a => a.status === 'LATE').length;
    const absent = attendances.filter(a => a.status === 'ABSENT').length;

    return {
      total,
      present,
      late,
      absent,
      attendanceRate: total > 0 ? ((present + late) / total * 100).toFixed(2) : '0',
    };
  }

  // Get teacher profile with school info
  async getProfile(userId: string) {
    const teacher = await this.prisma.teacher.findFirst({
      where: { userId },
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
        teacherClasses: { // ✅ FIXED: Include assigned classes
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
      firstName: teacher.firstName,
      lastName: teacher.lastName,
      phone: teacher.phone,
      telegramId: teacher.telegramId,
      subjects: teacher.subjects,
      photo: teacher.photo,
      user: teacher.user,
      school: teacher.school,
      assignedClasses: teacher.teacherClasses, // ✅ ADDED
    };
  }
}