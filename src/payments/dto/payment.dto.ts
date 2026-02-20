import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsNumber,
  Min,
  IsDateString,
} from 'class-validator';
import { PaymentStatus } from '@prisma/client';

export class CreatePaymentDto {
  @IsString()
  @IsNotEmpty()
  studentId: string;

  @IsNumber()
  @Min(0)
  amount: number;

  @IsString()
  @IsNotEmpty()
  month: string; // Masalan: "October" yoki "2024-10"

  @IsString()
  @IsNotEmpty()
  academicYear: string; // Masalan: "2024-2025"

  @IsDateString()
  @IsOptional()
  dueDate?: string; // Servisda default qiymat beriladi agar kelmasa

  @IsDateString()
  @IsOptional()
  paymentDate?: string; // Sxemadagi paidDate uchun

  @IsEnum(PaymentStatus)
  @IsOptional()
  status?: PaymentStatus;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class UpdatePaymentDto {
  @IsNumber()
  @Min(0)
  @IsOptional()
  amount?: number;

  @IsEnum(PaymentStatus)
  @IsOptional()
  status?: PaymentStatus;

  @IsString()
  @IsOptional()
  month?: string; // Oyni o'zgartirish imkoniyati qo'shildi

  @IsString()
  @IsOptional()
  academicYear?: string; // O'quv yilini o'zgartirish imkoniyati qo'shildi

  @IsDateString()
  @IsOptional()
  paymentDate?: string;

  @IsDateString()
  @IsOptional()
  dueDate?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class PaymentReportDto {
  @IsString()
  @IsNotEmpty()
  schoolId: string;

  @IsDateString()
  @IsNotEmpty() // Hisobot uchun odatda oraliq shart
  startDate: string;

  @IsDateString()
  @IsNotEmpty()
  endDate: string;

  @IsString()
  @IsOptional()
  classId?: string;

  @IsString()
  @IsOptional()
  studentId?: string;

  @IsEnum(PaymentStatus)
  @IsOptional()
  status?: PaymentStatus;
}