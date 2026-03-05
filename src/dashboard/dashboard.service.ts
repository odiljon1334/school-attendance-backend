import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class DashboardService {
  private logger = new Logger(DashboardService.name);

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  /** ======================= HELPERS ======================= */
  private getTodayRange() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    return { today, tomorrow };
  }

  /** ======================= OVERVIEW ======================= */
  async getOverview() {
    const cacheKey = 'dashboard:overview';
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const { today, tomorrow } = this.getTodayRange();

    const [
      totalDistricts,
      totalSchools,
      totalStudents,
      totalTeachers,
      presentCount,
    ] = await Promise.all([
      this.prisma.district.count(),
      this.prisma.school.count(),
      this.prisma.student.count(),
      this.prisma.teacher.count(),
      this.prisma.attendance.count({
        where: { date: { gte: today, lt: tomorrow }, status: { in: ['PRESENT', 'LATE'] } },
      }),
    ]);

    const totalExpected = totalStudents + totalTeachers;

    const data = {
      totalDistricts,
      totalSchools,
      totalStudents,
      totalTeachers,
      todayAttendance: {
        expected: totalExpected,
        present: presentCount,
        rate: totalExpected > 0 ? ((presentCount / totalExpected) * 100).toFixed(1) : '0',
      },
    };

    await this.redis.set(cacheKey, JSON.stringify(data), 60);
    return data;
  }

  /** ======================= DISTRICT STATS ======================= */
  async getDistrictStats(districtId: string) {
    const cacheKey = `dashboard:district:${districtId}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const { today, tomorrow } = this.getTodayRange();

    const district = await this.prisma.district.findUnique({
      where: { id: districtId },
      include: {
        schools: {
          include: { _count: { select: { students: true, teachers: true, classes: true } } },
        },
      },
    });

    if (!district) return null;

    const totalSchools = district.schools.length;
    const totalStudents = district.schools.reduce((sum, s) => sum + s._count.students, 0);
    const totalTeachers = district.schools.reduce((sum, s) => sum + s._count.teachers, 0);
    const totalClasses = district.schools.reduce((sum, s) => sum + s._count.classes, 0);

    const presentCount = await this.prisma.attendance.count({
      where: {
        school: { districtId },
        date: { gte: today, lt: tomorrow },
        status: { in: ['PRESENT', 'LATE'] },
      },
    });

    const totalExpected = totalStudents + totalTeachers;

    const data = {
      districtId,
      districtName: district.name,
      totalSchools,
      totalStudents,
      totalTeachers,
      totalClasses,
      todayAttendance: {
        expected: totalExpected,
        present: presentCount,
        rate: totalExpected > 0 ? ((presentCount / totalExpected) * 100).toFixed(1) : '0',
      },
    };

    await this.redis.set(cacheKey, JSON.stringify(data), 60);
    return data;
  }

  /** ======================= SCHOOL STATS ======================= */
  async getSchoolStats(schoolId: string) {
    const cacheKey = `dashboard:school:${schoolId}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const { today, tomorrow } = this.getTodayRange();

    const stats = await this.prisma.school.findUnique({
      where: { id: schoolId },
      include: { _count: { select: { students: true, teachers: true, classes: true } } },
    });

    if (!stats) return null;

    const presentCount = await this.prisma.attendance.count({
      where: { schoolId, date: { gte: today, lt: tomorrow }, status: { in: ['PRESENT', 'LATE'] } },
    });

    const totalExpected = stats._count.students + stats._count.teachers;

    const data = {
      schoolId: stats.id,
      schoolName: stats.name,
      totalStudents: stats._count.students,
      totalTeachers: stats._count.teachers,
      totalClasses: stats._count.classes,
      todayAttendance: {
        expected: totalExpected,
        present: presentCount,
        rate: totalExpected > 0 ? ((presentCount / totalExpected) * 100).toFixed(1) : '0',
      },
    };

    await this.redis.set(cacheKey, JSON.stringify(data), 60);
    return data;
  }

  /** ======================= ATTENDANCE TRENDS ======================= */
  async getAttendanceTrends(schoolId?: string, days: number = 7) {
    const cacheKey = `dashboard:trends:${schoolId ?? 'all'}:${days}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    const grouped = await this.prisma.attendance.groupBy({
      by: ['date', 'status'],
      _count: { _all: true },
      where: { schoolId: schoolId ?? undefined, date: { gte: startDate } },
      orderBy: { date: 'asc' },
    });

    const map: Record<string, any> = {};

    for (const item of grouped) {
      const date = item.date.toISOString().split('T')[0];
      if (!map[date]) map[date] = { date, total: 0, present: 0, late: 0, absent: 0, rate: '0' };

      const count = item._count._all;
      map[date].total += count;
      if (item.status === 'PRESENT') map[date].present += count;
      if (item.status === 'LATE') map[date].late += count;
      if (item.status === 'ABSENT') map[date].absent += count;
    }

    Object.values(map).forEach(d => {
      d.rate = d.total > 0 ? (((d.present + d.late) / d.total) * 100).toFixed(1) : '0';
    });

    const result = Object.values(map);

    await this.redis.set(cacheKey, JSON.stringify(result), 120);

    // track trend keys for school
    if (schoolId) {
      await this.redis.sadd(`dashboard:keys:school:${schoolId}`, cacheKey);
    }

    return result;
  }

  /** ======================= INVALIDATE CACHE ======================= */
  async invalidateDashboardCache(schoolId: string) {
    try {
      const school = await this.prisma.school.findUnique({
        where: { id: schoolId },
        select: { districtId: true },
      });

      // keys to delete
      const trendKeys = await this.redis.smembers(`dashboard:keys:school:${schoolId}`);
      const keysToDelete = [
        `dashboard:school:${schoolId}`,
        `dashboard:overview`,
        ...(trendKeys.length ? [...trendKeys, `dashboard:keys:school:${schoolId}`] : []),
        ...(school?.districtId ? [`dashboard:district:${school.districtId}`] : []),
      ];

      if (keysToDelete.length) await this.redis.del(...keysToDelete);
    } catch (error) {
      this.logger.error('Cache invalidation error:', error);
    }
  }
}
