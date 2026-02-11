import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  async getOverview() {
    // Get total counts
    const [districts, schools, students, teachers, directors] = await Promise.all([
      this.prisma.district.count(),
      this.prisma.school.count(),
      this.prisma.student.count(),
      this.prisma.teacher.count(),
      this.prisma.director.count(),
    ]);

    // Get today's attendance
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const attendances = await this.prisma.attendance.findMany({
      where: {
        date: {
          gte: today,
          lt: tomorrow,
        },
      },
    });

    const totalExpected = students + teachers + directors;
    const totalPresent = attendances.filter(
      a => a.status === 'PRESENT' || a.status === 'LATE',
    ).length;

    const attendanceRate = totalExpected > 0 
      ? ((totalPresent / totalExpected) * 100).toFixed(1) 
      : '0';

    return {
      totalDistricts: districts,
      totalSchools: schools,
      totalStudents: students,
      totalTeachers: teachers,
      totalDirectors: directors,
      todayAttendance: {
        expected: totalExpected,
        present: totalPresent,
        rate: attendanceRate,
      },
    };
  }

  async getDistrictStats(districtId: string) {
    const district = await this.prisma.district.findUnique({
      where: { id: districtId },
      include: {
        schools: {
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
        },
      },
    });

    if (!district) {
      return null;
    }

    const totalSchools = district.schools.length;
    const totalStudents = district.schools.reduce(
      (sum, school) => sum + school._count.students,
      0,
    );
    const totalTeachers = district.schools.reduce(
      (sum, school) => sum + school._count.teachers,
      0,
    );
    const totalClasses = district.schools.reduce(
      (sum, school) => sum + school._count.classes,
      0,
    );

    // Get today's attendance for this district
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const attendances = await this.prisma.attendance.findMany({
      where: {
        school: {
          districtId: districtId,
        },
        date: {
          gte: today,
          lt: tomorrow,
        },
      },
    });

    const presentCount = attendances.filter(
      a => a.status === 'PRESENT' || a.status === 'LATE',
    ).length;

    const totalExpected = totalStudents + totalTeachers;
    const attendanceRate = totalExpected > 0 
      ? ((presentCount / totalExpected) * 100).toFixed(1) 
      : '0';

    return {
      districtId,
      districtName: district.name,
      totalSchools,
      totalStudents,
      totalTeachers,
      totalClasses,
      todayAttendance: {
        expected: totalExpected,
        present: presentCount,
        rate: attendanceRate,
      },
    };
  }

  async getSchoolStats(schoolId: string) {
    const stats = await this.prisma.school.findUnique({
      where: { id: schoolId },
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

    if (!stats) {
      return null;
    }

    // Get today's attendance
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const attendances = await this.prisma.attendance.findMany({
      where: {
        schoolId: schoolId,
        date: {
          gte: today,
          lt: tomorrow,
        },
      },
    });

    const presentCount = attendances.filter(
      a => a.status === 'PRESENT' || a.status === 'LATE',
    ).length;

    const totalExpected = stats._count.students + stats._count.teachers + stats._count.directors;
    const attendanceRate = totalExpected > 0 
      ? ((presentCount / totalExpected) * 100).toFixed(1) 
      : '0';

    // FIXED: Return properly structured object instead of spreading
    return {
      schoolId: stats.id,
      schoolName: stats.name,
      totalStudents: stats._count.students,
      totalTeachers: stats._count.teachers,
      totalDirectors: stats._count.directors,
      totalClasses: stats._count.classes,
      todayAttendance: {
        expected: totalExpected,
        present: presentCount,
        rate: attendanceRate,
      },
    };
  }

  async getAttendanceTrends(schoolId?: string, days: number = 7) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    const where: any = {
      date: {
        gte: startDate,
      },
    };

    if (schoolId) {
      where.schoolId = schoolId;
    }

    const attendances = await this.prisma.attendance.findMany({
      where,
      orderBy: {
        date: 'asc',
      },
    });

    // Group by date
    const trendsByDate: Record<string, any> = {};

    for (const attendance of attendances) {
      const dateKey = attendance.date.toISOString().split('T')[0];

      if (!trendsByDate[dateKey]) {
        trendsByDate[dateKey] = {
          date: dateKey,
          total: 0,
          present: 0,
          late: 0,
          absent: 0,
          rate: '0',
        };
      }

      trendsByDate[dateKey].total++;

      if (attendance.status === 'PRESENT') {
        trendsByDate[dateKey].present++;
      } else if (attendance.status === 'LATE') {
        trendsByDate[dateKey].late++;
      } else if (attendance.status === 'ABSENT') {
        trendsByDate[dateKey].absent++;
      }
    }

    // Calculate rates
    Object.keys(trendsByDate).forEach(dateKey => {
      const data = trendsByDate[dateKey];
      data.rate = data.total > 0 
        ? (((data.present + data.late) / data.total) * 100).toFixed(1) 
        : '0';
    });

    return Object.values(trendsByDate);
  }
}