import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { BillingPlan } from '@prisma/client';

export enum GenerateMode {
  SKIP_EXISTING = 'SKIP_EXISTING',
  UPDATE_UNPAID = 'UPDATE_UNPAID',
}

export enum GenerateStrategy {
  FIXED_PERIOD = 'FIXED_PERIOD',   // plan + periodKey (YYYY-MM / YYYY)
  ROLLING_DUE  = 'ROLLING_DUE',    // billingPaidUntil asosida
}

export class GenerateBillingDto {
  @IsUUID()
  schoolId: string;

  @IsEnum(BillingPlan)
  plan: BillingPlan;

  @IsEnum(GenerateMode)
  @IsOptional()
  mode?: GenerateMode;

  @IsEnum(GenerateStrategy)
  @IsOptional()
  strategy?: GenerateStrategy;

  // FIXED_PERIOD uchun
  @IsString()
  @IsOptional()
  periodKey?: string;

  // FIXED_PERIOD uchun optional dueDate override
  @IsString()
  @IsOptional()
  dueDate?: string;

  // ROLLING_DUE uchun: necha kun oldin invoice chiqaramiz (default 3)
  @IsInt()
  @Min(0)
  @IsOptional()
  daysBefore?: number;

  @IsBoolean()
  @IsOptional()
  sendNotifications?: boolean;
}