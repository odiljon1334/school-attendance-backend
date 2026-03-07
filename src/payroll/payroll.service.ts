// src/payroll/payroll.service.ts

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PayrollService {
  constructor(private prisma: PrismaService) {}

  /**
   * Calculate monthly payroll for a teacher
   */
  async calculateMonthlyPayroll(teacherId: string, month: string) {
    // Get teacher schedule
    const schedule = await this.prisma.teacherSchedule.findUnique({
      where: { teacherId },
    });

    if (!schedule) {
      return null;
    }

    // Get all attendance records for the month
    const startDate = new Date(`${month}-01`);
    const endDate = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0);

    const attendances = await this.prisma.teacherAttendance.findMany({
      where: {
        teacherId,
        date: {
          gte: startDate,
          lte: endDate,
        },
      },
      orderBy: { date: 'asc' },
    });

    // Calculate stats
    const stats = this.calculateStats(attendances, schedule);

    // Calculate salary
    const salary = this.calculateSalary(stats, schedule);

    // Save payroll record
    const payroll = await this.prisma.teacherPayroll.upsert({
      where: {
        teacherId_month: {
          teacherId,
          month,
        },
      },
      create: {
        teacherId,
        month,
        ...stats,
        ...salary,
      },
      update: {
        ...stats,
        ...salary,
        updatedAt: new Date(),
      },
    });

    return payroll;
  }

  /**
   * Calculate attendance statistics
   */
  private calculateStats(attendances: any[], schedule: any) {
    let totalDaysWorked = 0;
    let totalHoursWorked = 0;
    let lateDays = 0;
    let lateMinutes = 0;
    let earlyLeaveDays = 0;
    let earlyLeaveMinutes = 0;
    let absentDays = 0;

    const workDays = schedule.workDays as string[];
    const expectedWorkDays = attendances.filter((a) => {
      const dayName = new Date(a.date).toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase();
      return workDays.includes(dayName);
    }).length;

    for (const att of attendances) {
      if (att.isAbsent) {
        absentDays++;
        continue;
      }

      if (att.checkInTime && att.checkOutTime) {
        totalDaysWorked++;
        totalHoursWorked += att.workDuration || 0;

        if (att.isLate) {
          lateDays++;
          lateMinutes += att.lateMinutes;
        }

        if (att.leftEarly) {
          earlyLeaveDays++;
          earlyLeaveMinutes += att.earlyMinutes;
        }
      }
    }

    // Calculate missed hours
    const expectedHours = expectedWorkDays * schedule.hoursPerDay;
    const missedHours = expectedHours - totalHoursWorked;

    return {
      expectedDays: expectedWorkDays,
      expectedHours,
      baseSalary: schedule.baseSalary,
      totalDaysWorked,
      totalHoursWorked,
      lateDays,
      lateMinutes,
      earlyLeaveDays,
      earlyLeaveMinutes,
      absentDays,
      missedHours: Math.max(0, missedHours),
    };
  }

  /**
   * Calculate final salary with penalties
   */
  private calculateSalary(stats: any, schedule: any) {
    const hourlyRate = schedule.hourlyRate;
    
    // Calculate penalty
    const penaltyAmount = stats.missedHours * hourlyRate;
    
    // Calculate actual salary
    const actualSalary = stats.baseSalary - penaltyAmount;

    return {
      penaltyAmount,
      bonusAmount: 0,
      actualSalary: Math.max(0, actualSalary),
    };
  }

  /**
   * Process attendance from FaceID check-in/out
   */
  async processAttendance(teacherId: string, checkType: 'IN' | 'OUT', timestamp: Date) {
    const date = new Date(timestamp);
    date.setHours(0, 0, 0, 0);

    const schedule = await this.prisma.teacherSchedule.findUnique({
      where: { teacherId },
    });

    if (!schedule) {
      throw new Error('Teacher schedule not found');
    }

    // Get or create attendance record
    let attendance = await this.prisma.teacherAttendance.findUnique({
      where: {
        teacherId_date: {
          teacherId,
          date,
        },
      },
    });

    if (!attendance) {
      attendance = await this.prisma.teacherAttendance.create({
        data: {
          teacherId,
          date,
          status: 'ABSENT',
        },
      });
    }

    // Update check-in or check-out
    if (checkType === 'IN') {
      const [expectedHour, expectedMinute] = schedule.startTime.split(':').map(Number);
      const expectedTime = new Date(date);
      expectedTime.setHours(expectedHour, expectedMinute, 0, 0);

      const isLate = timestamp > expectedTime;
      const lateMinutes = isLate
        ? Math.floor((timestamp.getTime() - expectedTime.getTime()) / 60000)
        : 0;

      attendance = await this.prisma.teacherAttendance.update({
        where: { id: attendance.id },
        data: {
          checkInTime: timestamp,
          isLate,
          lateMinutes,
          status: 'PRESENT',
        },
      });
    } else if (checkType === 'OUT') {
      const [expectedHour, expectedMinute] = schedule.endTime.split(':').map(Number);
      const expectedTime = new Date(date);
      expectedTime.setHours(expectedHour, expectedMinute, 0, 0);

      const leftEarly = timestamp < expectedTime;
      const earlyMinutes = leftEarly
        ? Math.floor((expectedTime.getTime() - timestamp.getTime()) / 60000)
        : 0;

      // Calculate work duration
      let workDuration = 0;
      if (attendance.checkInTime) {
        workDuration = (timestamp.getTime() - attendance.checkInTime.getTime()) / 3600000;
      }

      attendance = await this.prisma.teacherAttendance.update({
        where: { id: attendance.id },
        data: {
          checkOutTime: timestamp,
          leftEarly,
          earlyMinutes,
          workDuration,
        },
      });
    }

    return attendance;
  }

  /**
   * Get monthly report for a teacher
   */
  async getMonthlyReport(teacherId: string, month: string) {
    const payroll = await this.prisma.teacherPayroll.findUnique({
      where: {
        teacherId_month: {
          teacherId,
          month,
        },
      },
      include: {
        teacher: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    if (!payroll) {
      return this.calculateMonthlyPayroll(teacherId, month);
    }

    return payroll;
  }

  /**
   * Get all monthly reports for school
   */
  async getSchoolPayrollReport(schoolId: string, month: string) {
    const payrolls = await this.prisma.teacherPayroll.findMany({
      where: {
        teacher: {
          schoolId,
        },
        month,
      },
      include: {
        teacher: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: {
        teacher: {
          lastName: 'asc',
        },
      },
    });

    const summary = {
      totalTeachers: payrolls.length,
      totalBaseSalary: payrolls.reduce((sum, p) => sum + p.baseSalary, 0),
      totalPenalties: payrolls.reduce((sum, p) => sum + p.penaltyAmount, 0),
      totalBonuses: payrolls.reduce((sum, p) => sum + p.bonusAmount, 0),
      totalActualSalary: payrolls.reduce((sum, p) => sum + p.actualSalary, 0),
      paidCount: payrolls.filter((p) => p.isPaid).length,
    };

    return {
      month,
      payrolls,
      summary,
    };
  }

  /**
   * Set teacher work schedule
   */
  // ✅ To'g'ri — create yoki update, ikkalasi ham ishlaydi
  async setTeacherSchedule(teacherId: string, scheduleData: any) {
  return this.prisma.teacherSchedule.upsert({
    where: { teacherId },
    create: { teacherId, ...scheduleData },
    update: scheduleData,
  });
  }

  /**
   * Get teacher schedule
   */
  async getTeacherSchedule(teacherId: string) {
    return this.prisma.teacherSchedule.findUnique({
      where: { teacherId },
    });
  }

  /**
   * Update teacher schedule
   */
  async updateTeacherSchedule(teacherId: string, scheduleData: any) {
    return this.prisma.teacherSchedule.update({
      where: { teacherId },
      data: scheduleData,
    });
  }

  /**
   * Get teacher attendance history
   */
  async getTeacherAttendance(teacherId: string, month?: string) {
    const where: any = { teacherId };

    if (month) {
      const startDate = new Date(`${month}-01`);
      const endDate = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0);
      where.date = { gte: startDate, lte: endDate };
    }

    return this.prisma.teacherAttendance.findMany({
      where,
      orderBy: { date: 'desc' },
    });
  }

  /**
   * Calculate payroll for all teachers in a month
   */
  async calculateAllPayrolls(month: string) {
    const teachers = await this.prisma.teacher.findMany({
      where: {
        schedule: {
          isNot: null,
        },
      },
      select: { id: true },
    });

    const results = await Promise.all(
      teachers.map((t) => this.calculateMonthlyPayroll(t.id, month)),
    );

    return {
      month,
      total: results.filter(Boolean).length,
      payrolls: results.filter(Boolean),
    };
  }

  /**
   * Mark payroll as paid
   */
  async markPayrollAsPaid(payrollId: string, paymentMethod?: string) {
    return this.prisma.teacherPayroll.update({
      where: { id: payrollId },
      data: {
        isPaid: true,
        paidAt: new Date(),
        paymentMethod,
      },
    });
  }

  /**
   * Get pending (unpaid) payrolls
   */
  async getPendingPayrolls(schoolId: string) {
    return this.prisma.teacherPayroll.findMany({
      where: {
        teacher: { schoolId },
        isPaid: false,
      },
      include: {
        teacher: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: { month: 'desc' },
    });
  }

  /**
   * Get teacher statistics over time
   */
  async getTeacherStats(teacherId: string, startMonth?: string, endMonth?: string) {
    const where: any = { teacherId };

    if (startMonth || endMonth) {
      where.month = {};
      if (startMonth) where.month.gte = startMonth;
      if (endMonth) where.month.lte = endMonth;
    }

    const payrolls = await this.prisma.teacherPayroll.findMany({
      where,
      orderBy: { month: 'asc' },
    });

    return {
      months: payrolls.map((p) => p.month),
      totalEarned: payrolls.reduce((sum, p) => sum + p.actualSalary, 0),
      totalPenalties: payrolls.reduce((sum, p) => sum + p.penaltyAmount, 0),
      averageAttendance: payrolls.length > 0
        ? payrolls.reduce((sum, p) => sum + (p.totalDaysWorked / p.expectedDays) * 100, 0) / payrolls.length
        : 0,
      payrolls,
    };
  }

  /**
   * Get school-wide statistics
   */
  async getSchoolStats(schoolId: string, month?: string) {
    const where: any = {
      teacher: { schoolId },
    };

    if (month) {
      where.month = month;
    }

    const payrolls = await this.prisma.teacherPayroll.findMany({
      where,
      include: {
        teacher: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    const totalTeachers = new Set(payrolls.map((p) => p.teacherId)).size;

    return {
      totalTeachers,
      totalBaseSalary: payrolls.reduce((sum, p) => sum + p.baseSalary, 0),
      totalPenalties: payrolls.reduce((sum, p) => sum + p.penaltyAmount, 0),
      totalActualSalary: payrolls.reduce((sum, p) => sum + p.actualSalary, 0),
      averageAttendance: payrolls.length > 0
        ? payrolls.reduce((sum, p) => sum + (p.totalDaysWorked / p.expectedDays) * 100, 0) / payrolls.length
        : 0,
      bestAttendance: payrolls.sort((a, b) => 
        (b.totalDaysWorked / b.expectedDays) - (a.totalDaysWorked / a.expectedDays)
      )[0],
      payrolls,
    };
  }
}