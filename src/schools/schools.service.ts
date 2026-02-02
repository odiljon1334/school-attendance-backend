import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSchoolDto, UpdateSchoolDto } from './dto/school.dto';

@Injectable()
export class SchoolsService {
  constructor(private prisma: PrismaService) {}

  async create(createSchoolDto: CreateSchoolDto) {
    // Check if district exists
    const district = await this.prisma.district.findUnique({
      where: { id: createSchoolDto.districtId },
    });

    if (!district) {
      throw new NotFoundException('District not found');
    }

    // Check if code already exists
    const existingSchool = await this.prisma.school.findUnique({
      where: { code: createSchoolDto.code },
    });

    if (existingSchool) {
      throw new ConflictException('School code already exists');
    }

    return this.prisma.school.create({
      data: createSchoolDto,
      include: {
        district: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
      },
    });
  }

  async findAll(districtId?: string) {
    const where = districtId ? { districtId } : {};

    return this.prisma.school.findMany({
      where,
      include: {
        district: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
        _count: {
          select: {
            students: true,
            teachers: true,
            directors: true,
            classes: true,
            devices: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findOne(id: string) {
    const school = await this.prisma.school.findUnique({
      where: { id },
      include: {
        district: {
          select: {
            id: true,
            name: true,
            region: true,
            code: true,
          },
        },
        schoolAdmins: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            user: {
              select: {
                username: true,
                email: true,
                status: true,
              },
            },
          },
        },
        directors: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            user: {
              select: {
                username: true,
                email: true,
              },
            },
          },
        },
        _count: {
          select: {
            students: true,
            teachers: true,
            classes: true,
            devices: true,
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
    await this.findOne(id);

    // Check if new district exists (if updating districtId)
    if (updateSchoolDto.districtId) {
      const district = await this.prisma.district.findUnique({
        where: { id: updateSchoolDto.districtId },
      });

      if (!district) {
        throw new NotFoundException('District not found');
      }
    }

    // Check if new code already exists (if updating code)
    if (updateSchoolDto.code) {
      const existingSchool = await this.prisma.school.findUnique({
        where: { code: updateSchoolDto.code },
      });

      if (existingSchool && existingSchool.id !== id) {
        throw new ConflictException('School code already exists');
      }
    }

    return this.prisma.school.update({
      where: { id },
      data: updateSchoolDto,
      include: {
        district: {
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
    // Check if school exists
    await this.findOne(id);

    // Check if school has students
    const studentCount = await this.prisma.student.count({
      where: { schoolId: id },
    });

    if (studentCount > 0) {
      throw new ConflictException(
        `Cannot delete school with ${studentCount} students. Please delete or reassign students first.`,
      );
    }

    return this.prisma.school.delete({
      where: { id },
    });
  }

  async getStatistics(id: string) {
    const school = await this.findOne(id);

    // Get attendance statistics for today
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayAttendance = await this.prisma.attendanceLog.groupBy({
      by: ['status'],
      where: {
        schoolId: id,
        date: {
          gte: today,
        },
      },
      _count: true,
    });

    // Get payment statistics
    const paymentStats = await this.prisma.paymentRecord.groupBy({
      by: ['status'],
      where: {
        student: {
          schoolId: id,
        },
      },
      _count: true,
      _sum: {
        amount: true,
      },
    });

    // Get class distribution
    const classDistribution = await this.prisma.class.findMany({
      where: { schoolId: id },
      select: {
        grade: true,
        section: true,
        _count: {
          select: {
            students: true,
          },
        },
      },
      orderBy: [{ grade: 'asc' }, { section: 'asc' }],
    });

    return {
      school: {
        id: school.id,
        name: school.name,
        code: school.code,
      },
      overview: {
        totalStudents: school._count.students,
        totalTeachers: school._count.teachers,
        totalClasses: school._count.classes,
        totalDevices: school._count.devices,
      },
      attendance: {
        today: todayAttendance.reduce((acc, curr) => {
          acc[curr.status.toLowerCase()] = curr._count;
          return acc;
        }, {}),
      },
      payments: paymentStats.map((stat) => ({
        status: stat.status,
        count: stat._count,
        totalAmount: stat._sum.amount || 0,
      })),
      classes: classDistribution.map((cls) => ({
        grade: cls.grade,
        section: cls.section,
        studentCount: cls._count.students,
      })),
    };
  }

  async getClasses(id: string) {
    const school = await this.findOne(id);

    return this.prisma.class.findMany({
      where: { schoolId: id },
      include: {
        _count: {
          select: {
            students: true,
          },
        },
      },
      orderBy: [{ grade: 'asc' }, { section: 'asc' }],
    });
    console.log('school', school);
  }

  async getDevices(id: string) {
    const school = await this.findOne(id);

    return this.prisma.device.findMany({
      where: { schoolId: id },
      orderBy: {
        createdAt: 'desc',
      },
    });
    console.log('school', school);
  }
}
