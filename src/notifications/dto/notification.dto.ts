import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsArray,
  IsEnum,
  MinLength,
} from 'class-validator';

// SMS DTOs
export class SendSmsDto {
  @IsString()
  @IsNotEmpty()
  phone: string; // +998XXXXXXXXX

  @IsString()
  @IsNotEmpty()
  message: string;
}

export class SendSmsBulkDto {
  @IsArray()
  @IsNotEmpty()
  phones: string[]; // ["+998XXXXXXXXX", "+998XXXXXXXXX"]

  @IsString()
  @IsNotEmpty()
  message: string;
}

// Telegram DTOs
export class SendTelegramDto {
  @IsString()
  @IsNotEmpty()
  chatId: string;

  @IsString()
  @IsNotEmpty()
  message: string;
}

export class SendTelegramBulkDto {
  @IsArray()
  @IsNotEmpty()
  chatIds: string[];

  @IsString()
  @IsNotEmpty()
  message: string;
}

// Notify parents DTOs
export class NotifyParentsDto {
  @IsString()
  @IsNotEmpty()
  studentId: string;

  @IsString()
  @IsNotEmpty()
  message: string;

  @IsBoolean()
  @IsOptional()
  sendSms?: boolean; // Default: true

  @IsBoolean()
  @IsOptional()
  sendTelegram?: boolean; // Default: true
}

export enum BroadcastChannel {
  SMS = 'SMS',
  TELEGRAM = 'TELEGRAM',
  BOTH = 'BOTH',
}

export enum BroadcastTarget {
  PARENTS_ALL = 'PARENTS_ALL',
  TEACHERS_ALL = 'TEACHERS_ALL',
  DIRECTORS_ALL = 'DIRECTORS_ALL',
  SCHOOL_TEACHERS = 'SCHOOL_TEACHERS',
  SCHOOL_PARENTS = 'SCHOOL_PARENTS',
}

export enum BroadcastCategory {
  attendance = 'attendance',
  payment = 'payment',
  announcement = 'announcement',
  success = 'success',
  urgent = 'urgent',
}

export class BroadcastDto {
  @IsEnum(BroadcastChannel)
  channel: BroadcastChannel;

  @IsEnum(BroadcastCategory)
  category: BroadcastCategory;

  @IsString()
  @MinLength(1)
  title: string;

  @IsString()
  @MinLength(1)
  message: string;

  @IsEnum(BroadcastTarget)
  target: BroadcastTarget;

  @IsOptional()
  @IsString()
  schoolId?: string;
}

export class NotifyClassDto {
  @IsString()
  @IsNotEmpty()
  classId: string;

  @IsString()
  @IsNotEmpty()
  message: string;

  @IsBoolean()
  @IsOptional()
  sendSms?: boolean;

  @IsBoolean()
  @IsOptional()
  sendTelegram?: boolean;
}

export class NotifySchoolDto {
  @IsString()
  @IsNotEmpty()
  schoolId: string;

  @IsString()
  @IsNotEmpty()
  message: string;

  @IsBoolean()
  @IsOptional()
  sendSms?: boolean;

  @IsBoolean()
  @IsOptional()
  sendTelegram?: boolean;
}
