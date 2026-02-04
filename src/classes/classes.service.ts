import {
    Injectable,
    NotFoundException,
    ConflictException,
  } from '@nestjs/common';
  import { PrismaService } from '../prisma/prisma.service';
  import { CreateClassDto, UpdateClassDto } from './dto/class.dto';
  
  @Injectable()
  export class ClassesService {
    constructor(private prisma: PrismaService) {}
  
    async create(createClassDto: CreateClassDto) {
      const { schoolId, grade, section, academicYear } = createClassDto;
  
      // Check if school exists
      const school = await this.prisma.school.findUnique({
        where: { id: schoolId },
      });
  
      if (!school) {
        throw new NotFoundException('School not found');
      }
  
      // Check if class already exists
      const existingClass = await this.prisma.class.findFirst({
        where: {
          schoolId,
          grade,
          section,
          academicYear,
        },
      });
  
      if (existingClass) {
        throw new ConflictException(
          `Class ${grade}-${section} for ${academicYear} already exists`,
        );
      }
  
      return this.prisma.class.create({
        data: createClassDto,
        include: {
          school: {
            select: {
              id: true,
              name: true,
              code: true,
            },
          },
          _count: {
            select: {
              students: true,
            },
          },
        },
      });
    }
  
    async findAll(schoolId?: string, academicYear?: string) {
      const where: any = {};
  
      if (schoolId) {
        where.schoolId = schoolId;
      }
  
      if (academicYear) {
        where.academicYear = academicYear;
      }
  
      return this.prisma.class.findMany({
        where,
        include: {
          school: {
            select: {
              id: true,
              name: true,
              code: true,
            },
          },
          _count: {
            select: {
              students: true,
            },
          },
        },
        orderBy: [
          { grade: 'asc' },
          { section: 'asc' },
        ],
      });
    }
  
    async findOne(id: string) {
      const classData = await this.prisma.class.findUnique({
        where: { id },
        include: {
          school: {
            select: {
              id: true,
              name: true,
              code: true,
              address: true,
            },
          },
          students: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              phone: true,
              user: {
                select: {
                  username: true,
                  status: true,
                },
              },
            },
            orderBy: {
              lastName: 'asc',
            },
          },
          _count: {
            select: {
              students: true,
            },
          },
        },
      });
  
      if (!classData) {
        throw new NotFoundException(`Class with ID ${id} not found`);
      }
  
      return classData;
    }
  
    async update(id: string, updateClassDto: UpdateClassDto) {
      await this.findOne(id);
  
      return this.prisma.class.update({
        where: { id },
        data: updateClassDto,
        include: {
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
      await this.findOne(id);
  
      // Check if class has students
      const studentCount = await this.prisma.student.count({
        where: { classId: id },
      });
  
      if (studentCount > 0) {
        throw new ConflictException(
          `Cannot delete class with ${studentCount} students. Please reassign students first.`,
        );
      }
  
      await this.prisma.class.delete({ where: { id } });
  
      return { message: 'Class deleted successfully' };
    }
  
    async getStudents(id: string) {
      const classData = await this.findOne(id);
  
      return {
        class: {
          id: classData.id,
          grade: classData.grade,
          section: classData.section,
          academicYear: classData.academicYear,
        },
        students: classData.students,
        totalStudents: classData._count.students,
      };
    }
  
    async getStatistics(id: string) {
      const classData = await this.findOne(id);
  
      // Get today's date
      const today = new Date();
      today.setHours(0, 0, 0, 0);
  
      // Today's attendance
      const todayAttendance = await this.prisma.attendanceLog.groupBy({
        by: ['status'],
        where: {
          student: {
            classId: id,
          },
          date: {
            gte: today,
          },
        },
        _count: true,
      });
  
      // Payment statistics
      const paymentStats = await this.prisma.paymentRecord.groupBy({
        by: ['status'],
        where: {
          student: {
            classId: id,
          },
        },
        _count: true,
        _sum: {
          amount: true,
        },
      });
  
      // Gender distribution
      const genderStats = await this.prisma.student.groupBy({
        by: ['gender'],
        where: { classId: id },
        _count: true,
      });
  
      return {
        class: {
          id: classData.id,
          grade: classData.grade,
          section: classData.section,
          academicYear: classData.academicYear,
          totalStudents: classData._count.students,
        },
        attendance: {
          today: todayAttendance.reduce(
            (acc, curr) => {
              acc[curr.status.toLowerCase()] = curr._count;
              return acc;
            },
            {} as Record<string, number>,
          ),
        },
        payments: paymentStats.map((stat) => ({
          status: stat.status,
          count: stat._count,
          totalAmount: stat._sum.amount || 0,
        })),
        demographics: {
          gender: genderStats.map((stat) => ({
            gender: stat.gender,
            count: stat._count,
          })),
        },
      };
    }
  }