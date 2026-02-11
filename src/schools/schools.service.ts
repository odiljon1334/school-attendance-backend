import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSchoolDto } from './dto/school.dto';
import { UpdateSchoolDto } from './dto/school.dto';

@Injectable()
export class SchoolsService {
  constructor(private prisma: PrismaService) {}

  async create(createSchoolDto: CreateSchoolDto) {
    // Check if code already exists
    const existing = await this.prisma.school.findUnique({
      where: { code: createSchoolDto.code },
    });

    if (existing) {
      throw new ConflictException(`School with code ${createSchoolDto.code} already exists`);
    }

    return this.prisma.school.create({
      data: createSchoolDto,
      include: {
        district: true,
      },
    });
  }

  async findAll(districtId?: string) {
    const where: any = {};
    
    if (districtId) {
      where.districtId = districtId;
    }

    return this.prisma.school.findMany({
      where,
      include: {
        district: true,
        _count: {
          select: {
            students: true,
            teachers: true,
            directors: true,
            classes: true,
          },
        },
      },
      orderBy: {
        name: 'asc',
      },
    });
  }

  async findOne(id: string) {
    const school = await this.prisma.school.findUnique({
      where: { id },
      include: {
        district: true,
        classes: {
          include: {
            _count: {
              select: {
                students: true,
              },
            },
          },
        },
        students: {
          include: {
            class: true,
          },
        },
        teachers: true,
        directors: true,
        _count: {
          select: {
            students: true,
            teachers: true,
            directors: true,
            classes: true,
          },
        },
      },
    });

    if (!school) {
      throw new NotFoundException(`School with ID ${id} not found`);
    }

    return school;
  }

  async update(id: string, updateSchoolDto: UpdateSchoolDto) {
    // Check if school exists
    const existing = await this.prisma.school.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException(`School with ID ${id} not found`);
    }

    // Check if code is being changed and already exists
    if (updateSchoolDto.code && updateSchoolDto.code !== existing.code) {
      const codeExists = await this.prisma.school.findUnique({
        where: { code: updateSchoolDto.code },
      });

      if (codeExists) {
        throw new ConflictException(`School with code ${updateSchoolDto.code} already exists`);
      }
    }

    return this.prisma.school.update({
      where: { id },
      data: updateSchoolDto,
      include: {
        district: true,
      },
    });
  }

  async remove(id: string) {
    // Check if school exists
    const school = await this.prisma.school.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            students: true,
            teachers: true,
            directors: true,
            classes: true,
          },
        },
      },
    });

    if (!school) {
      throw new NotFoundException(`School with ID ${id} not found`);
    }

    // Check if school has students, teachers, or directors
    const totalUsers = 
      school._count.students + 
      school._count.teachers + 
      school._count.directors;

    if (totalUsers > 0) {
      throw new ConflictException(
        `Cannot delete school with ${totalUsers} users. Delete users first.`,
      );
    }

    await this.prisma.school.delete({ where: { id } });

    return { message: 'School deleted successfully' };
  }

  // Get school statistics
  async getStatistics(id: string) {
    const school = await this.prisma.school.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            students: true,
            teachers: true,
            directors: true,
            classes: true,
          },
        },
      },
    });

    if (!school) {
      throw new NotFoundException(`School with ID ${id} not found`);
    }

    // Get today's attendance
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const attendanceRecords = await this.prisma.attendance.findMany({
      where: {
        schoolId: id,
        date: {
          gte: today,
          lt: new Date(today.getTime() + 24 * 60 * 60 * 1000),
        },
      },
    });

    const studentAttendance = attendanceRecords.filter(a => a.studentId);
    const teacherAttendance = attendanceRecords.filter(a => a.teacherId);
    const directorAttendance = attendanceRecords.filter(a => a.directorId);

    const studentPresent = studentAttendance.filter(
      a => a.status === 'PRESENT' || a.status === 'LATE',
    ).length;

    const teacherPresent = teacherAttendance.filter(
      a => a.status === 'PRESENT' || a.status === 'LATE',
    ).length;

    const directorPresent = directorAttendance.filter(
      a => a.status === 'PRESENT' || a.status === 'LATE',
    ).length;

    return {
      totalStudents: school._count.students,
      totalTeachers: school._count.teachers,
      totalDirectors: school._count.directors,
      totalClasses: school._count.classes,
      todayAttendance: {
        students: {
          present: studentPresent,
          total: school._count.students,
          rate: school._count.students > 0 
            ? ((studentPresent / school._count.students) * 100).toFixed(1) 
            : '0',
        },
        teachers: {
          present: teacherPresent,
          total: school._count.teachers,
          rate: school._count.teachers > 0 
            ? ((teacherPresent / school._count.teachers) * 100).toFixed(1) 
            : '0',
        },
        directors: {
          present: directorPresent,
          total: school._count.directors,
          rate: school._count.directors > 0 
            ? ((directorPresent / school._count.directors) * 100).toFixed(1) 
            : '0',
        },
      },
    };
  }
}