import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsArray,
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
