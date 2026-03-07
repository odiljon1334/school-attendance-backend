// src/payroll/payroll.controller.ts

import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards } from '@nestjs/common';
import { PayrollService } from './payroll.service';
import { JwtAuthGuard } from '../auth/guards/jwt.auth.guards';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('payroll')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PayrollController {
  constructor(private readonly payrollService: PayrollService) {}

  // ==================== SCHEDULE ====================
  
  @Post('schedule/:teacherId')
  @Roles('SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN')
  async setSchedule(
    @Param('teacherId') teacherId: string,
    @Body() scheduleData: {
      workDays: string[];
      startTime: string;
      endTime: string;
      hoursPerDay: number;
      daysPerWeek: number;
      hoursPerMonth: number;
      baseSalary: number;
      hourlyRate: number;
    },
  ) {
    return this.payrollService.setTeacherSchedule(teacherId, scheduleData);
  }

  
  @Get('schedule/:teacherId')
  async getSchedule(@Param('teacherId') teacherId: string) {
    return this.payrollService.getTeacherSchedule(teacherId);
  }

  @Patch('schedule/:teacherId')
  @Roles('SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN')
  async updateSchedule(
    @Param('teacherId') teacherId: string,
    @Body() scheduleData: Partial<any>,
  ) {
    return this.payrollService.updateTeacherSchedule(teacherId, scheduleData);
  }

  // ==================== ATTENDANCE ====================

  @Post('attendance/check-in')
  async checkIn(
    @Body() data: { teacherId: string; timestamp?: string },
  ) {
    const timestamp = data.timestamp ? new Date(data.timestamp) : new Date();
    return this.payrollService.processAttendance(data.teacherId, 'IN', timestamp);
  }

  @Post('attendance/check-out')
  async checkOut(
    @Body() data: { teacherId: string; timestamp?: string },
  ) {
    const timestamp = data.timestamp ? new Date(data.timestamp) : new Date();
    return this.payrollService.processAttendance(data.teacherId, 'OUT', timestamp);
  }

  @Get('attendance/:teacherId')
  async getAttendance(
    @Param('teacherId') teacherId: string,
    @Query('month') month?: string,
  ) {
    return this.payrollService.getTeacherAttendance(teacherId, month);
  }

  // ==================== PAYROLL ====================

  @Get('teacher/:teacherId/:month')
  async getTeacherPayroll(
    @Param('teacherId') teacherId: string,
    @Param('month') month: string,
  ) {
    return this.payrollService.getMonthlyReport(teacherId, month);
  }

  @Post('calculate/:month')
  @Roles('SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN')
  async calculateMonthlyPayroll(@Param('month') month: string) {
    return this.payrollService.calculateAllPayrolls(month);
  }

  @Get('school/:schoolId/:month')
  @Roles('SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN')
  async getSchoolPayroll(
    @Param('schoolId') schoolId: string,
    @Param('month') month: string,
  ) {
    return this.payrollService.getSchoolPayrollReport(schoolId, month);
  }

  @Patch(':payrollId/pay')
  @Roles('SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN')
  async markAsPaid(
    @Param('payrollId') payrollId: string,
    @Body() data: { paymentMethod?: string },
  ) {
    return this.payrollService.markPayrollAsPaid(payrollId, data.paymentMethod);
  }

  @Get('pending/:schoolId')
  @Roles('SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN')
  async getPendingPayrolls(@Param('schoolId') schoolId: string) {
    return this.payrollService.getPendingPayrolls(schoolId);
  }

  // ==================== STATS ====================

  @Get('stats/:teacherId')
  async getTeacherStats(
    @Param('teacherId') teacherId: string,
    @Query('startMonth') startMonth?: string,
    @Query('endMonth') endMonth?: string,
  ) {
    return this.payrollService.getTeacherStats(teacherId, startMonth, endMonth);
  }

  @Get('stats/school/:schoolId')
  @Roles('SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN')
  async getSchoolStats(
    @Param('schoolId') schoolId: string,
    @Query('month') month?: string,
  ) {
    return this.payrollService.getSchoolStats(schoolId, month);
  }
}