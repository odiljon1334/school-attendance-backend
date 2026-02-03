import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEmail,
  IsEnum,
  IsBoolean,
  IsDateString,
} from 'class-validator';
import { Gender } from '@prisma/client';

export class CreateStudentDto {
  @IsString()
  @IsNotEmpty()
  username: string;

  @IsString()
  @IsNotEmpty()
  password: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsNotEmpty()
  schoolId: string;

  @IsString()
  @IsNotEmpty()
  classId: string;

  @IsString()
  @IsNotEmpty()
  firstName: string;

  @IsString()
  @IsNotEmpty()
  lastName: string;

  @IsString()
  @IsOptional()
  middleName?: string;

  @IsDateString()
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
  telegramId?: string;

  @IsBoolean()
  @IsOptional()
  isTelegramSubscribed?: boolean;

  @IsString()
  @IsOptional()
  telegramChatId?: string;
}

export class UpdateStudentDto {
  @IsString()
  @IsOptional()
  classId?: string;

  @IsString()
  @IsOptional()
  firstName?: string;

  @IsString()
  @IsOptional()
  lastName?: string;

  @IsString()
  @IsOptional()
  middleName?: string;

  @IsDateString()
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
  telegramId?: string;

  @IsBoolean()
  @IsOptional()
  isTelegramSubscribed?: boolean;

  @IsString()
  @IsOptional()
  telegramChatId?: string;

  @IsString()
  @IsOptional()
  photo?: string;
}

export class StudentResponseDto {
  id: string;
  userId: string;
  schoolId: string;
  classId: string;
  firstName: string;
  lastName: string;
  middleName?: string;
  dateOfBirth?: Date;
  gender?: Gender;
  photo?: string;
  phone?: string;
  telegramId?: string;
  isTelegramSubscribed: boolean;
  telegramChatId?: string;
  createdAt: Date;
  updatedAt: Date;
}
