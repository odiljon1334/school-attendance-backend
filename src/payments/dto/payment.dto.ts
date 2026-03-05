import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { BillingPlan, PaymentStatus, PaymentWaiveReason } from '@prisma/client';

export class CreatePaymentDto {
  @IsUUID()
  studentId: string;

  // NEW: MONTHLY / YEARLY
  @IsEnum(BillingPlan)
  plan: BillingPlan;

  @IsString()
  @IsNotEmpty()
  periodKey: string;

  // NEW: integer sums
  @IsInt()
  @Min(0)
  amount: number;

  @IsDateString()
  dueDate: string;

  @IsOptional()
  @IsDateString()
  paidDate?: string;

  @IsOptional()
  @IsEnum(PaymentStatus)
  status?: PaymentStatus;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class WaivePaymentDto {
  @IsEnum(PaymentWaiveReason)
  reason: PaymentWaiveReason;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdatePaymentDto {
  @IsOptional()
  @IsEnum(BillingPlan)
  plan?: BillingPlan;

  @IsOptional()
  @IsString()
  periodKey?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  amount?: number;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsDateString()
  paidDate?: string | null;

  @IsOptional()
  @IsEnum(PaymentStatus)
  status?: PaymentStatus;

  @IsOptional()
  @IsEnum(PaymentWaiveReason)
  waiveReason?: PaymentWaiveReason | null;

  @IsOptional()
  @IsDateString()
  waivedAt?: string | null;

  @IsOptional()
  @IsString()
  notes?: string | null;
}

// Report DTO — o'zgarish shart emas, lekin status/filter qoladi
export class PaymentReportDto {
  @IsString()
  @IsNotEmpty()
  schoolId: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  classId?: string;

  @IsOptional()
  @IsString()
  studentId?: string;

  @IsOptional()
  @IsEnum(PaymentStatus)
  status?: PaymentStatus;

  // NEW filters (optional)
  @IsOptional()
  @IsEnum(BillingPlan)
  plan?: BillingPlan;

  @IsOptional()
  @IsString()
  periodKey?: string;

  // optional: waived only
  @IsOptional()
  @IsBoolean()
  waivedOnly?: boolean;
}