import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsDateString,
  IsNumber,
  Min,
} from 'class-validator';
import { AttendanceStatus } from '@prisma/client';

export class CheckInDto {
  @IsString()
  @IsNotEmpty()
  schoolId: string;

  @IsString()
  @IsOptional()
  studentId?: string;

  @IsString()
  @IsOptional()
  teacherId?: string;

  @IsString()
  @IsOptional()
  directorId?: string;

  @IsString()
  @IsOptional()
  deviceId?: string;

  @IsDateString()
  @IsOptional()
  checkInTime?: string; // Optional - defaults to now
}

export class CheckOutDto {
  @IsString()
  @IsNotEmpty()
  attendanceLogId: string;

  @IsDateString()
  @IsOptional()
  checkOutTime?: string; // Optional - defaults to now
}

export class CreateAttendanceDto {
  @IsString()
  @IsNotEmpty()
  schoolId: string;

  @IsString()
  @IsOptional()
  studentId?: string;

  @IsString()
  @IsOptional()
  teacherId?: string;

  @IsString()
  @IsOptional()
  directorId?: string;

  @IsEnum(AttendanceStatus)
  @IsNotEmpty()
  status: AttendanceStatus;

  @IsDateString()
  @IsOptional()
  date?: string;

  @IsDateString()
  @IsOptional()
  checkInTime?: string;

  @IsDateString()
  @IsOptional()
  checkOutTime?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  lateMinutes?: number;

  @IsString()
  @IsOptional()
  deviceId?: string;
}

export class UpdateAttendanceDto {
  @IsEnum(AttendanceStatus)
  @IsOptional()
  status?: AttendanceStatus;

  @IsDateString()
  @IsOptional()
  checkInTime?: string;

  @IsDateString()
  @IsOptional()
  checkOutTime?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  lateMinutes?: number;
}

export class CreateAbsenceRecordDto {
  @IsString()
  @IsNotEmpty()
  studentId: string;

  @IsDateString()
  @IsNotEmpty()
  date: string;

  @IsString()
  @IsOptional()
  reason?: string;

  @IsOptional()
  isExcused?: boolean;

  @IsString()
  @IsOptional()
  document?: string; // File path
}

export class AttendanceReportDto {
  @IsString()
  @IsNotEmpty()
  schoolId: string;

  @IsDateString()
  @IsOptional()
  startDate?: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;

  @IsString()
  @IsOptional()
  classId?: string;

  @IsString()
  @IsOptional()
  studentId?: string;
}
