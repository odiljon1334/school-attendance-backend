import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDistrictDto } from './dto/district.dto';
import { UpdateDistrictDto } from './dto/district.dto';

@Injectable()
export class DistrictsService {
  constructor(private prisma: PrismaService) {}

  async create(createDistrictDto: CreateDistrictDto) {
    // Check if code already exists
    const existing = await this.prisma.district.findUnique({
      where: { code: createDistrictDto.code },
    });

    if (existing) {
      throw new ConflictException(`District with code ${createDistrictDto.code} already exists`);
    }

    return this.prisma.district.create({
      data: createDistrictDto,
    });
  }

  async findAll() {
    return this.prisma.district.findMany({
      include: {
        schools: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
        _count: {
          select: {
            schools: true,
          },
        },
      },
      orderBy: {
        name: 'asc',
      },
    });
  }

  async findOne(id: string) {
    const district = await this.prisma.district.findUnique({
      where: { id },
      include: {
        schools: {
          include: {
            _count: {
              select: {
                students: true,
                teachers: true,
                classes: true,
              },
            },
          },
        },
        _count: {
          select: {
            schools: true,
          },
        },
      },
    });

    if (!district) {
      throw new NotFoundException(`District with ID ${id} not found`);
    }

    return district;
  }

  async update(id: string, updateDistrictDto: UpdateDistrictDto) {
    // Check if district exists
    const existing = await this.prisma.district.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException(`District with ID ${id} not found`);
    }

    // Check if code is being changed and already exists
    if (updateDistrictDto.code && updateDistrictDto.code !== existing.code) {
      const codeExists = await this.prisma.district.findUnique({
        where: { code: updateDistrictDto.code },
      });

      if (codeExists) {
        throw new ConflictException(`District with code ${updateDistrictDto.code} already exists`);
      }
    }

    return this.prisma.district.update({
      where: { id },
      data: updateDistrictDto,
    });
  }

  async remove(id: string) {
    // Check if district exists
    const district = await this.prisma.district.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            schools: true,
          },
        },
      },
    });

    if (!district) {
      throw new NotFoundException(`District with ID ${id} not found`);
    }

    // Check if district has schools
    if (district._count.schools > 0) {
      throw new ConflictException(
        `Cannot delete district with ${district._count.schools} schools. Delete schools first.`,
      );
    }

    await this.prisma.district.delete({ where: { id } });

    return { message: 'District deleted successfully' };
  }

  // Bulk: barcha districtlar statistikasi — 2 ta DB query
  async getWithStats() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);

    const districts = await this.prisma.district.findMany({
      select: {
        id: true, name: true, code: true, region: true,
        _count: { select: { schools: true } },
        schools: {
          select: {
            id: true,
            _count: { select: { students: true, teachers: true, classes: true } },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    if (!districts.length) return [];

    const schoolIds = districts.flatMap((d) => d.schools.map((s) => s.id));

    const attendanceRecords = await this.prisma.attendance.findMany({
      where: {
        schoolId: { in: schoolIds },
        date: { gte: today, lt: tomorrow },
        studentId: { not: null },
        status: { in: ['PRESENT', 'LATE'] },
      },
      select: { schoolId: true },
    });

    // schoolId → districtId map
    const schoolToDistrict = new Map<string, string>();
    for (const d of districts)
      for (const s of d.schools) schoolToDistrict.set(s.id, d.id);

    const presentByDistrict = new Map<string, number>();
    for (const a of attendanceRecords) {
      const distId = schoolToDistrict.get(a.schoolId);
      if (distId) presentByDistrict.set(distId, (presentByDistrict.get(distId) ?? 0) + 1);
    }

    return districts.map((d) => {
      const totalStudents = d.schools.reduce((s, sc) => s + sc._count.students, 0);
      const present = presentByDistrict.get(d.id) ?? 0;
      return {
        id: d.id, name: d.name, code: d.code, region: d.region,
        counts: {
          totalSchools: d._count.schools,
          totalStudents,
          totalTeachers: d.schools.reduce((s, sc) => s + sc._count.teachers, 0),
          totalClasses:  d.schools.reduce((s, sc) => s + sc._count.classes,  0),
        },
        todayAttendance: {
          present, total: totalStudents,
          rate: totalStudents > 0 ? ((present / totalStudents) * 100).toFixed(1) : '0',
        },
      };
    });
  }

  // Get district statistics
  async getStatistics(id: string) {
    const district = await this.prisma.district.findUnique({
      where: { id },
      include: {
        schools: {
          include: {
            _count: {
              select: {
                students: true,
                teachers: true,
                classes: true,
              },
            },
          },
        },
        _count: {
          select: {
            schools: true,
          },
        },
      },
    });

    if (!district) {
      throw new NotFoundException(`District with ID ${id} not found`);
    }

    // Calculate totals
    const totalSchools = district._count.schools;
    const totalStudents = district.schools.reduce((sum, school) => sum + school._count.students, 0);
    const totalTeachers = district.schools.reduce((sum, school) => sum + school._count.teachers, 0);
    const totalClasses = district.schools.reduce((sum, school) => sum + school._count.classes, 0);

    // Get today's attendance
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const attendanceRecords = await this.prisma.attendance.findMany({
      where: {
        school: {
          districtId: id,
        },
        date: {
          gte: today,
          lt: new Date(today.getTime() + 24 * 60 * 60 * 1000),
        },
      },
    });

    const presentCount = attendanceRecords.filter(
      a => a.status === 'PRESENT' || a.status === 'LATE',
    ).length;

    const attendanceRate = totalStudents > 0 
      ? ((presentCount / totalStudents) * 100).toFixed(1) 
      : '0';

    return {
      totalSchools,
      totalStudents,
      totalTeachers,
      totalClasses,
      todayAttendance: {
        present: presentCount,
        total: totalStudents,
        rate: attendanceRate,
      },
    };
  }
}