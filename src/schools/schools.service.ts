import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSchoolDto, UpdateSchoolDto } from './dto/school.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class SchoolsService {
  constructor(private prisma: PrismaService) {}

  async create(createSchoolDto: CreateSchoolDto) {
    // Check if code already exists
    const existingCode = await this.prisma.school.findUnique({
      where: { code: createSchoolDto.code },
    });

    if (existingCode) {
      throw new ConflictException(`School with code ${createSchoolDto.code} already exists`);
    }

    // Check username uniqueness
    // username uniqueness
    const existingUsername = await this.prisma.school.findUnique({
      where: { username: createSchoolDto.username },
    });
    if (existingUsername) {
      throw new ConflictException(`Username ${createSchoolDto.username} already exists`);
    }
    

    // ✅ CRITICAL: Hash password
    const dataToCreate: any = { ...createSchoolDto };
    if (createSchoolDto.password) {
      dataToCreate.password = await bcrypt.hash(createSchoolDto.password, 10);
    }

    const school = await this.prisma.school.create({
      data: dataToCreate,
      include: {
        district: true,
      },
    });

    // ✅ CRITICAL: Remove password from response
    const { password, ...schoolWithoutPassword } = school;
    return schoolWithoutPassword;
  }

  async findAll(districtId?: string, schoolId?: string) {
    const where: any = {};

    if (schoolId) {
      where.id = schoolId;
    } else if (districtId) {
      where.districtId = districtId;
    }

    return this.prisma.school.findMany({
      where,
      select: {
        id: true,
        districtId: true,
        name: true,
        code: true,
        address: true,
        phone: true,
        email: true,
        username: true,
        createdAt: true,
        updatedAt: true,
        district: true,
        _count: {
          select: {
            students: true,
            teachers: true,
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
      select: {
        id: true,
        districtId: true,
        name: true,
        code: true,
        address: true,
        phone: true,
        email: true,
        username: true,
        // ❌ password: NOT included
        createdAt: true,
        updatedAt: true,
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
        _count: {
          select: {
            students: true,
            teachers: true,
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

    // Check username uniqueness
    if (updateSchoolDto.username && updateSchoolDto.username !== existing.username) {
      const usernameExists = await this.prisma.school.findUnique({
        where: { username: updateSchoolDto.username },
      });

      if (usernameExists) {
        throw new ConflictException(`Username ${updateSchoolDto.username} already exists`);
      }
    }

    // ✅ CRITICAL: Hash password if provided
    const dataToUpdate: any = { ...updateSchoolDto };
    if (updateSchoolDto.password) {
      dataToUpdate.password = await bcrypt.hash(updateSchoolDto.password, 10);
    }

    const school = await this.prisma.school.update({
      where: { id },
      data: dataToUpdate,
      include: {
        district: true,
      },
    });

    // ✅ CRITICAL: Remove password from response
    const { password, ...schoolWithoutPassword } = school;
    return schoolWithoutPassword;
  }

  // ✅ Faqat SUPER_ADMIN uchun: login va parolni almashtirish
  async updateCredentials(id: string, username: string, newPassword: string) {
    const existing = await this.prisma.school.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`School ${id} not found`);

    if (username && username !== existing.username) {
      const taken = await this.prisma.school.findUnique({ where: { username } });
      if (taken) throw new ConflictException(`Username "${username}" already exists`);
    }

    const dataToUpdate: any = {};
    if (username) dataToUpdate.username = username;
    if (newPassword) {
      dataToUpdate.password = await bcrypt.hash(newPassword, 10);
      // ✅ Eski tokenlar bu vaqtdan oldin berilgan bo'lsa invalid hisoblanadi
      dataToUpdate.credentialsChangedAt = new Date();
    }

    await this.prisma.school.update({ where: { id }, data: dataToUpdate });
    return { success: true, message: 'Credentials updated successfully' };
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
            classes: true,
          },
        },
      },
    });

    if (!school) {
      throw new NotFoundException(`School with ID ${id} not found`);
    }

    // Check if school has students, teachers
    const totalUsers = school._count.students + school._count.teachers;

    if (totalUsers > 0) {
      throw new ConflictException(
        `Cannot delete school with ${totalUsers} users. Delete users first.`,
      );
    }

    await this.prisma.school.delete({ where: { id } });

    return { message: 'School deleted successfully' };
  }

  // Get school statistics
  async getBulkStatistics(districtId?: string, schoolId?: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);

    const where: any = schoolId ? { id: schoolId } : districtId ? { districtId } : {};

    // 1 DB query: all schools with counts
    const schools = await this.prisma.school.findMany({
      where,
      select: {
        id: true,
        name: true,
        code: true,
        address: true,
        phone: true,
        _count: {
          select: { students: true, teachers: true, classes: true },
        },
      },
    });

    if (!schools.length) return [];

    const schoolIds = schools.map((s) => s.id);

    // 1 DB query: today's attendance for ALL schools at once
    const attendanceRecords = await this.prisma.attendance.findMany({
      where: {
        schoolId: { in: schoolIds },
        date: { gte: today, lt: tomorrow },
        studentId: { not: null },
      },
      select: { schoolId: true, status: true },
    });

    // Group by schoolId
    const presentBySchool = new Map<string, number>();
    for (const a of attendanceRecords) {
      if (a.status === 'PRESENT' || a.status === 'LATE') {
        presentBySchool.set(a.schoolId, (presentBySchool.get(a.schoolId) ?? 0) + 1);
      }
    }

    return schools.map((school) => {
      const present = presentBySchool.get(school.id) ?? 0;
      const total = school._count.students;
      return {
        id: school.id,
        name: school.name,
        code: school.code,
        address: school.address,
        phone: school.phone,
        counts: {
          totalStudents: total,
          totalTeachers: school._count.teachers,
          totalClasses: school._count.classes,
        },
        todayAttendance: {
          students: {
            present,
            total,
            rate: total > 0 ? ((present / total) * 100).toFixed(1) : '0',
          },
        },
      };
    });
  }

  async getStatistics(id: string) {
    const school = await this.prisma.school.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            students: true,
            teachers: true,
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
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);

    const attendanceRecords = await this.prisma.attendance.findMany({
      where: {
        schoolId: id,
        date: {
          gte: today,
          lt: tomorrow,
        },
      },
    });

    const studentAttendance = attendanceRecords.filter((a) => a.studentId);
    const teacherAttendance = attendanceRecords.filter((a) => a.teacherId);

    const studentPresent = studentAttendance.filter(
      (a) => a.status === 'PRESENT' || a.status === 'LATE',
    ).length;

    const teacherPresent = teacherAttendance.filter(
      (a) => a.status === 'PRESENT' || a.status === 'LATE',
    ).length;

    return {
      school: {
        id: school.id,
        name: school.name,
        code: school.code,
      },
      counts: {
        totalStudents: school._count.students,
        totalTeachers: school._count.teachers,
        totalClasses: school._count.classes,
      },
      todayAttendance: {
        students: {
          total: school._count.students,
          present: studentPresent,
          absent: school._count.students - studentPresent,
          rate:
            school._count.students > 0
              ? ((studentPresent / school._count.students) * 100).toFixed(1)
              : '0',
        },
        teachers: {
          total: school._count.teachers,
          present: teacherPresent,
          absent: school._count.teachers - teacherPresent,
          rate:
            school._count.teachers > 0
              ? ((teacherPresent / school._count.teachers) * 100).toFixed(1)
              : '0',
        },
      },
    };
  }
}