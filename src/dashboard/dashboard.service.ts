import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  // ────────────────────────────────────────────────────────
  // SCHOOL DASHBOARD
  // ────────────────────────────────────────────────────────
  async getSchoolDashboard(schoolId: string, startDate?: string, endDate?: string) {
    // Verify school exists
    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: { id: true, name: true, code: true },
    });

    if (!school) {
      throw new NotFoundException('School not found');
    }

    // Overview counts
    const overview = await this.getSchoolOverview(schoolId);

    // Today's attendance
    const todayAttendance = await this.getTodayAttendance(schoolId);

    // Attendance trends (last 7 days)
    const attendanceTrends = await this.getAttendanceTrends(schoolId, 7);

    // Payment statistics
    const paymentStats = await this.getPaymentStatistics(schoolId, startDate, endDate);

    // Late arrivals this week
    const lateArrivals = await this.getLateArrivals(schoolId, 7);

    // Top performing classes (by attendance)
    const topClasses = await this.getTopClassesByAttendance(schoolId);

    return {
      school,
      overview,
      todayAttendance,
      attendanceTrends,
      paymentStats,
      lateArrivals,
      topClasses,
      generatedAt: new Date(),
    };
  }

  // ────────────────────────────────────────────────────────
  // DISTRICT DASHBOARD
  // ────────────────────────────────────────────────────────
  async getDistrictDashboard(districtId: string, startDate?: string, endDate?: string) {
    const district = await this.prisma.district.findUnique({
      where: { id: districtId },
      select: { id: true, name: true, region: true, code: true },
    });

    if (!district) {
      throw new NotFoundException('District not found');
    }

    // Get all schools in district
    const schools = await this.prisma.school.findMany({
      where: { districtId },
      select: { id: true, name: true, code: true },
    });

    const schoolIds = schools.map((s) => s.id);

    // Aggregate statistics across all schools
    const totalStudents = await this.prisma.student.count({
      where: { schoolId: { in: schoolIds } },
    });

    const totalTeachers = await this.prisma.teacher.count({
      where: { schoolId: { in: schoolIds } },
    });

    const totalClasses = await this.prisma.class.count({
      where: { schoolId: { in: schoolIds } },
    });

    // Today's attendance across district
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const districtAttendance = await this.prisma.attendanceLog.groupBy({
      by: ['status'],
      where: {
        schoolId: { in: schoolIds },
        date: { gte: today },
      },
      _count: true,
    });

    // Payment statistics across district
    const districtPayments = await this.prisma.paymentRecord.groupBy({
      by: ['status'],
      where: {
        student: { schoolId: { in: schoolIds } },
      },
      _count: true,
      _sum: { amount: true },
    });

    // School rankings by attendance rate
    const schoolRankings = await this.getSchoolRankingsByAttendance(schoolIds);

    return {
      district,
      overview: {
        totalSchools: schools.length,
        totalStudents,
        totalTeachers,
        totalClasses,
      },
      schools,
      todayAttendance: districtAttendance.reduce((acc, curr) => {
        acc[curr.status.toLowerCase()] = curr._count;
        return acc;
      }, {} as Record<string, number>),
      payments: districtPayments.map((stat) => ({
        status: stat.status,
        count: stat._count,
        totalAmount: stat._sum.amount || 0,
      })),
      schoolRankings,
      generatedAt: new Date(),
    };
  }

  // ────────────────────────────────────────────────────────
  // HELPER METHODS
  // ────────────────────────────────────────────────────────

  private async getSchoolOverview(schoolId: string) {
    const [totalStudents, totalTeachers, totalClasses, totalParents] = await Promise.all([
      this.prisma.student.count({ where: { schoolId } }),
      this.prisma.teacher.count({ where: { schoolId } }),
      this.prisma.class.count({ where: { schoolId } }),
      this.prisma.parent.count({ where: { student: { schoolId } } }),
    ]);

    return {
      totalStudents,
      totalTeachers,
      totalClasses,
      totalParents,
    };
  }

  private async getTodayAttendance(schoolId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const attendance = await this.prisma.attendanceLog.groupBy({
      by: ['status'],
      where: {
        schoolId,
        date: { gte: today },
        studentId: { not: null }, // Only students
      },
      _count: true,
    });

    const totalStudents = await this.prisma.student.count({ where: { schoolId } });

    const stats = attendance.reduce((acc, curr) => {
      acc[curr.status.toLowerCase()] = curr._count;
      return acc;
    }, {} as Record<string, number>);

    const totalPresent = (stats.present || 0) + (stats.late || 0);
    const attendanceRate = totalStudents > 0 ? ((totalPresent / totalStudents) * 100).toFixed(2) : '0';

    return {
      ...stats,
      totalStudents,
      attendanceRate: `${attendanceRate}%`,
    };
  }

  private async getAttendanceTrends(schoolId: string, days: number) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    const logs = await this.prisma.attendanceLog.findMany({
      where: {
        schoolId,
        studentId: { not: null },
        date: { gte: startDate },
      },
      select: {
        date: true,
        status: true,
      },
    });

    // Group by date
    const trendsByDate = logs.reduce((acc, log) => {
      const dateKey = log.date.toISOString().split('T')[0];
      if (!acc[dateKey]) {
        acc[dateKey] = { present: 0, late: 0, absent: 0, excused: 0 };
      }
      acc[dateKey][log.status.toLowerCase()]++;
      return acc;
    }, {} as Record<string, any>);

    return Object.entries(trendsByDate).map(([date, stats]) => ({
      date,
      ...stats,
    }));
  }

  private async getPaymentStatistics(schoolId: string, startDate?: string, endDate?: string) {
    const where: any = { student: { schoolId } };

    if (startDate || endDate) {
      where.paymentDate = {};
      if (startDate) where.paymentDate.gte = new Date(startDate);
      if (endDate) where.paymentDate.lte = new Date(endDate);
    }

    const payments = await this.prisma.paymentRecord.groupBy({
      by: ['status'],
      where,
      _count: true,
      _sum: { amount: true },
    });

    return payments.map((stat) => ({
      status: stat.status,
      count: stat._count,
      totalAmount: stat._sum.amount || 0,
    }));
  }

  private async getLateArrivals(schoolId: string, days: number) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    const lateStudents = await this.prisma.attendanceLog.findMany({
      where: {
        schoolId,
        status: 'LATE',
        date: { gte: startDate },
        studentId: { not: null },
      },
      include: {
        student: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            class: {
              select: {
                grade: true,
                section: true,
              },
            },
          },
        },
      },
      orderBy: {
        date: 'desc',
      },
      take: 20,
    });

    return lateStudents.map((log) => ({
      date: log.date,
      student: log.student,
      lateMinutes: log.lateMinutes,
      checkInTime: log.checkInTime,
    }));
  }

  private async getTopClassesByAttendance(schoolId: string) {
    const classes = await this.prisma.class.findMany({
      where: { schoolId },
      select: {
        id: true,
        grade: true,
        section: true,
        _count: {
          select: {
            students: true,
          },
        },
      },
    });

    // Calculate attendance rate for each class
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const classStats = await Promise.all(
      classes.map(async (cls) => {
        const presentCount = await this.prisma.attendanceLog.count({
          where: {
            student: { classId: cls.id },
            date: { gte: today },
            status: { in: ['PRESENT', 'LATE'] },
          },
        });

        const rate =
          cls._count.students > 0 ? ((presentCount / cls._count.students) * 100).toFixed(2) : '0';

        return {
          classId: cls.id,
          grade: cls.grade,
          section: cls.section,
          totalStudents: cls._count.students,
          presentToday: presentCount,
          attendanceRate: `${rate}%`,
        };
      }),
    );

    return classStats.sort((a, b) => parseFloat(b.attendanceRate) - parseFloat(a.attendanceRate)).slice(0, 10);
  }

  private async getSchoolRankingsByAttendance(schoolIds: string[]) {
    const rankings = await Promise.all(
      schoolIds.map(async (schoolId) => {
        const school = await this.prisma.school.findUnique({
          where: { id: schoolId },
          select: { id: true, name: true, code: true },
        });

        const todayStats = await this.getTodayAttendance(schoolId);

        return {
          school,
          attendanceRate: todayStats.attendanceRate,
          totalStudents: todayStats.totalStudents,
        };
      }),
    );

    return rankings.sort((a, b) => parseFloat(b.attendanceRate) - parseFloat(a.attendanceRate));
  }
}