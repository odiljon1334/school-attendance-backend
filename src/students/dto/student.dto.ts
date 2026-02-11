import { IsString, IsEmail, IsOptional, IsEnum, IsBoolean, MinLength } from 'class-validator';
import { Gender } from '@prisma/client';

export class CreateStudentDto {
  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  schoolId: string;

  @IsString()
  classId: string;

  @IsString()
  firstName: string;

  @IsString()
  lastName: string;

  @IsString()
  @IsOptional()
  middleName?: string;

  @IsString()
  @IsOptional()
  dateOfBirth?: string;

  @IsEnum(Gender)
  gender: Gender;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  photo?: string;

  @IsString()
  @IsOptional()
  enrollNumber?: string

  @IsString()
  @IsOptional()
  telegramId?: string;

  @IsBoolean()
  @IsOptional()
  isTelegramSubscribed?: boolean;

  @IsString()
  @IsOptional()
  telegramChatId?: string;

  // ✅ NEW: Face image (base64)
  @IsString()
  @IsOptional()
  faceImage?: string; // Required! data:image/jpeg;base64,...
}

export class UpdateStudentDto {
  @IsString()
  @IsOptional()
  firstName?: string;

  @IsString()
  @IsOptional()
  lastName?: string;

  @IsString()
  @IsOptional()
  middleName?: string;

  @IsString()
  @IsOptional()
  dateOfBirth?: string;

  @IsEnum(Gender)
  @IsOptional()
  gender?: Gender;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  photo?: string;

  @IsString()
  @IsOptional()
  enrollNumber?: string

  @IsString()
  @IsOptional()
  telegramId?: string;

  @IsBoolean()
  @IsOptional()
  isTelegramSubscribed?: boolean;

  @IsString()
  @IsOptional()
  telegramChatId?: string;

  // ✅ NEW: Face image update (optional)
  @IsString()
  @IsOptional()
  faceImage?: string;
}