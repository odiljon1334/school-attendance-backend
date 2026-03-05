// src/payroll/dto/payroll.dto.ts

import { IsString, IsNumber, IsArray, IsOptional, IsBoolean, IsDateString, Min, Max } from 'class-validator';

// ==================== SCHEDULE DTOs ====================

export class CreateScheduleDto {
  @IsArray()
  @IsString({ each: true })
  workDays: string[]; // ['MONDAY', 'TUESDAY', ...]

  @IsString()
  startTime: string; // '08:00'

  @IsString()
  endTime: string; // '17:00'

  @IsNumber()
  @Min(1)
  @Max(24)
  hoursPerDay: number; // 9

  @IsNumber()
  @Min(1)
  @Max(7)
  daysPerWeek: number; // 6

  @IsNumber()
  @Min(1)
  hoursPerMonth: number; // 216

  @IsNumber()
  @Min(0)
  baseSalary: number; // 5000000

  @IsNumber()
  @Min(0)
  hourlyRate: number; // 23148
}

export class UpdateScheduleDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  workDays?: string[];

  @IsOptional()
  @IsString()
  startTime?: string;

  @IsOptional()
  @IsString()
  endTime?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(24)
  hoursPerDay?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(7)
  daysPerWeek?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  hoursPerMonth?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  baseSalary?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  hourlyRate?: number;
}

// ==================== ATTENDANCE DTOs ====================

export class CheckInDto {
  @IsString()
  teacherId: string;

  @IsOptional()
  @IsDateString()
  timestamp?: string; // ISO 8601 format
}

export class CheckOutDto {
  @IsString()
  teacherId: string;

  @IsOptional()
  @IsDateString()
  timestamp?: string;
}

// ==================== PAYROLL DTOs ====================

export class MarkAsPaidDto {
  @IsOptional()
  @IsString()
  paymentMethod?: string; // 'CASH', 'BANK_TRANSFER', etc.
}

export class AddBonusDto {
  @IsNumber()
  @Min(0)
  amount: number;

  @IsOptional()
  @IsString()
  reason?: string;
}

// ==================== QUERY DTOs ====================

export class MonthQueryDto {
  @IsString()
  month: string; // Format: 'YYYY-MM' (e.g., '2026-02')
}

export class DateRangeQueryDto {
  @IsOptional()
  @IsString()
  startMonth?: string;

  @IsOptional()
  @IsString()
  endMonth?: string;
}