import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Kyrgyzstan oblastlari: region nomi → GeoJSON CODE
const REGION_TO_CODE: Record<string, string> = {
  'Баткенская':      'BAT',
  'Джалал-Абадская': 'JA',
  'Нарынская':       'NAR',
  'Ошская':          'OSH',
  'Таласская':       'TAL',
  'Чуйская':         'CHU',
  'Иссык-Кульская':  'IK',
};

const REGION_NAMES: Record<string, string> = {
  BAT: 'Баткенская область',
  JA:  'Джалал-Абадская область',
  NAR: 'Нарынская область',
  OSH: 'Ошская область',
  TAL: 'Таласская область',
  CHU: 'Чуйская область',
  IK:  'Иссык-Кульская область',
};

const REGION_CENTER: Record<string, { lat: number; lng: number }> = {
  BAT: { lat: 39.75, lng: 71.20 },
  JA:  { lat: 40.93, lng: 71.00 },
  NAR: { lat: 41.40, lng: 72.50 },
  OSH: { lat: 40.50, lng: 73.50 },
  TAL: { lat: 41.50, lng: 70.40 },
  CHU: { lat: 42.00, lng: 73.00 },
  IK:  { lat: 42.40, lng: 77.00 },
};

const ONLINE_MS = 5 * 60 * 1000;

function dayRange(date?: string) {
  const t = date ? new Date(date) : new Date();
  const s = new Date(t); s.setHours(0, 0, 0, 0);
  const e = new Date(t); e.setHours(23, 59, 59, 999);
  return { dayStart: s, dayEnd: e };
}

@Injectable()
export class MapService {
  constructor(private prisma: PrismaService) {}

  /**
   * Oblast bo'yicha agregatsiya. District.region maydoni oblastni ko'rsatadi.
   * Dashboard jadvalida district'lar o'zgarishsiz qoladi.
   */
  async getDistrictStats(date?: string) {
    const { dayStart, dayEnd } = dayRange(date);
    const now = Date.now();

    const districts = await this.prisma.district.findMany({
      select: {
        id: true, name: true, nameRu: true, region: true, code: true,
        schools: {
          select: {
            id: true, hasTurnstile: true,
            hikvisionDevices: {
              select: { id: true, isActive: true, lastSeenAt: true },
            },
            students: { select: { id: true } },
            attendances: {
              where: { date: { gte: dayStart, lte: dayEnd }, studentId: { not: null } },
              select: { status: true },
            },
          },
        },
      },
    });

    // Region bo'yicha guruhlash
    const regionMap = new Map<string, {
      anchorDistrictId: string;
      region: string;
      schools: typeof districts[0]['schools'];
    }>();

    for (const d of districts) {
      const region = d.region!;
      if (!regionMap.has(region)) {
        regionMap.set(region, { anchorDistrictId: d.id, region, schools: [] });
      }
      regionMap.get(region)!.schools.push(...d.schools);
    }

    const result: any[] = [];

    for (const [region, data] of regionMap.entries()) {
      const code = REGION_TO_CODE[region];
      if (!code) continue; // noma'lum region — o'tkazib yuboramiz

      const schools = data.schools;
      const totalSchools     = schools.length;
      const turnstileSchools = schools.filter(s => s.hasTurnstile).length;
      const onlineTurnstiles = schools.filter(s =>
        s.hikvisionDevices.some(dev =>
          dev.isActive && dev.lastSeenAt &&
          now - new Date(dev.lastSeenAt).getTime() < ONLINE_MS,
        ),
      ).length;

      let totalStudents = 0;
      let presentStudents = 0;
      for (const s of schools) {
        totalStudents  += s.students.length;
        presentStudents += s.attendances.filter(
          a => a.status === 'PRESENT' || a.status === 'LATE',
        ).length;
      }

      const attendanceRate = totalStudents > 0
        ? Math.round((presentStudents / totalStudents) * 100)
        : null;

      const center = REGION_CENTER[code] ?? { lat: 41.2, lng: 74.7 };

      result.push({
        id:               data.anchorDistrictId,
        name:             REGION_NAMES[code],
        nameRu:           REGION_NAMES[code],
        region,
        code,
        osmId:            null,
        lat:              center.lat,
        lng:              center.lng,
        totalSchools,
        turnstileSchools,
        onlineTurnstiles,
        totalStudents,
        presentStudents,
        attendanceRate,
        color:            this.rateToColor(attendanceRate),
      });
    }

    return result;
  }

  /**
   * Oblast detail: anchor district ID → region → barcha district'lar → barcha maktablar
   */
  async getDistrictDetail(districtId: string, date?: string) {
    const { dayStart, dayEnd } = dayRange(date);
    const nowMs = Date.now();

    // Anchor district'dan region'ni aniqlaymiz
    const anchor = await this.prisma.district.findUnique({
      where: { id: districtId },
      select: { region: true, nameRu: true, name: true },
    });
    if (!anchor) return null;

    // Bir xil region'dagi barcha district'lar
    const whereDistrict = anchor.region
      ? { region: anchor.region }
      : { id: districtId };

    const districts = await this.prisma.district.findMany({
      where: whereDistrict,
      select: {
        id: true,
        schools: {
          select: {
            id: true, name: true, nameRu: true, code: true,
            hasTurnstile: true, lat: true, lng: true,
            hikvisionDevices: {
              select: { id: true, name: true, isActive: true, lastSeenAt: true, ipAddress: true },
            },
            students: { select: { id: true } },
            teachers:  { select: { id: true } },
            attendances: {
              where: { date: { gte: dayStart, lte: dayEnd }, studentId: { not: null } },
              select: { status: true },
            },
          },
        },
      },
    });

    const allSchoolsRaw = districts.flatMap(d => d.schools);

    const schools = allSchoolsRaw.map(s => {
      const total   = s.students.length;
      const present = s.attendances.filter(
        a => a.status === 'PRESENT' || a.status === 'LATE',
      ).length;
      const rate = total > 0 ? Math.round((present / total) * 100) : null;

      const devices = s.hikvisionDevices.map(dev => ({
        id:         dev.id,
        name:       dev.name,
        ipAddress:  dev.ipAddress,
        isActive:   dev.isActive,
        lastSeenAt: dev.lastSeenAt,
        isOnline:   dev.isActive &&
                    !!dev.lastSeenAt &&
                    nowMs - new Date(dev.lastSeenAt).getTime() < ONLINE_MS,
      }));

      return {
        id:              s.id,
        name:            s.name,
        nameRu:          s.nameRu,
        code:            s.code,
        hasTurnstile:    s.hasTurnstile,
        lat:             s.lat,
        lng:             s.lng,
        totalStudents:   total,
        totalTeachers:   s.teachers.length,
        presentStudents: present,
        attendanceRate:  rate,
        devices,
        turnstileOnline: devices.some(d => d.isOnline),
      };
    });

    const regionName = anchor.region
      ? REGION_NAMES[REGION_TO_CODE[anchor.region] ?? ''] ?? anchor.region
      : (anchor.nameRu ?? anchor.name);

    return {
      id:     districtId,
      name:   regionName,
      nameRu: regionName,
      region: anchor.region,
      schools,
      summary: {
        totalSchools:     schools.length,
        turnstileSchools: allSchoolsRaw.filter(s => s.hasTurnstile).length,
        totalStudents:    schools.reduce((s, x) => s + x.totalStudents, 0),
        presentStudents:  schools.reduce((s, x) => s + x.presentStudents, 0),
      },
    };
  }

  /**
   * Общая сводка по стране
   */
  async getNationalSummary(date?: string) {
    const { dayStart, dayEnd } = dayRange(date);

    const [
      totalDistricts, totalSchools, totalStudents, totalTeachers,
      turnstileSchools, presentToday, teacherPresentToday,
    ] = await Promise.all([
      this.prisma.district.count(),
      this.prisma.school.count(),
      this.prisma.student.count(),
      this.prisma.teacher.count(),
      this.prisma.school.count({ where: { hasTurnstile: true } }),
      this.prisma.attendance.count({
        where: { date: { gte: dayStart, lte: dayEnd }, studentId: { not: null }, status: { in: ['PRESENT', 'LATE'] } },
      }),
      this.prisma.attendance.count({
        where: { date: { gte: dayStart, lte: dayEnd }, teacherId: { not: null }, status: { in: ['PRESENT', 'LATE'] } },
      }),
    ]);

    return {
      totalDistricts,
      totalSchools,
      turnstileSchools,
      totalStudents,
      totalTeachers,
      presentStudentsToday:  presentToday,
      presentTeachersToday:  teacherPresentToday,
      studentAttendanceRate: totalStudents > 0
        ? Math.round((presentToday / totalStudents) * 100)
        : 0,
    };
  }

  /**
   * Тренд посещаемости
   */
  async getAttendanceTrend(
    period: 'daily' | 'weekly' | 'monthly' | 'yearly',
    districtId?: string,
    schoolId?: string,
  ) {
    const now = new Date();
    const records: { date: string; present: number; absent: number; late: number }[] = [];

    if (period === 'daily') {
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now); d.setDate(d.getDate() - i);
        const stat = await this.getDayStat(d, districtId, schoolId);
        records.push({ date: d.toISOString().slice(0, 10), ...stat });
      }
    } else if (period === 'weekly') {
      for (let i = 7; i >= 0; i--) {
        const end = new Date(now); end.setDate(end.getDate() - i * 7);
        const start = new Date(end); start.setDate(start.getDate() - 6);
        const stat = await this.getRangeStat(start, end, districtId, schoolId);
        records.push({ date: `Нед.${8 - i}`, ...stat });
      }
    } else if (period === 'monthly') {
      const months = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
      for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const start = new Date(d.getFullYear(), d.getMonth(), 1);
        const end   = new Date(d.getFullYear(), d.getMonth() + 1, 0);
        const stat  = await this.getRangeStat(start, end, districtId, schoolId);
        records.push({ date: `${months[d.getMonth()]} ${d.getFullYear()}`, ...stat });
      }
    } else {
      const months = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
      const year = now.getFullYear();
      for (let m = 0; m < 12; m++) {
        const start = new Date(year, m, 1);
        const end   = new Date(year, m + 1, 0);
        const stat  = await this.getRangeStat(start, end, districtId, schoolId);
        records.push({ date: months[m], ...stat });
      }
    }

    return records;
  }

  // ─── helpers ───────────────────────────────────────────────────────────────
  private async getDayStat(date: Date, districtId?: string, schoolId?: string) {
    const start = new Date(date); start.setHours(0, 0, 0, 0);
    const end   = new Date(date); end.setHours(23, 59, 59, 999);
    return this.getRangeStat(start, end, districtId, schoolId);
  }

  private async getRangeStat(
    start: Date, end: Date,
    districtId?: string, schoolId?: string,
  ) {
    // districtId here is the anchor district → resolve region's school IDs
    let schoolIds: string[] | undefined;

    if (schoolId) {
      schoolIds = [schoolId];
    } else if (districtId) {
      const anchor = await this.prisma.district.findUnique({
        where: { id: districtId },
        select: { region: true },
      });
      const where = anchor?.region ? { region: anchor.region } : { id: districtId };
      const districtIds = (await this.prisma.district.findMany({ where, select: { id: true } }))
        .map(d => d.id);
      schoolIds = (await this.prisma.school.findMany({
        where: { districtId: { in: districtIds } },
        select: { id: true },
      })).map(s => s.id);
    }

    const base: any = { studentId: { not: null }, date: { gte: start, lte: end } };
    if (schoolIds) base.schoolId = { in: schoolIds };

    const [present, absent, late] = await Promise.all([
      this.prisma.attendance.count({ where: { ...base, status: 'PRESENT' } }),
      this.prisma.attendance.count({ where: { ...base, status: 'ABSENT'  } }),
      this.prisma.attendance.count({ where: { ...base, status: 'LATE'    } }),
    ]);
    return { present, absent, late };
  }

  private rateToColor(rate: number | null): string {
    if (rate === null) return '#6b7280';
    if (rate >= 80)    return '#22c55e';
    if (rate >= 60)    return '#eab308';
    if (rate >= 40)    return '#f97316';
    return '#ef4444';
  }
}
