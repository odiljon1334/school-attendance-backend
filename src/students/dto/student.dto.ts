import { 
  IsString, 
  IsEmail, 
  IsOptional, 
  IsEnum, 
  IsBoolean, 
  IsDateString, 
  ValidateNested, 
  IsNotEmpty
} from 'class-validator';
import { Type } from 'class-transformer';
import { Gender, ParentRelation } from '@prisma/client';

class ParentDto {
  @IsString()
  @IsNotEmpty()
  phone: string;

  @IsString()
  @IsOptional()
  firstName?: string;

  @IsString()
  @IsOptional()
  lastName?: string;

  @IsEnum(ParentRelation)
  @IsOptional()
  relationship?: ParentRelation;

  @IsString()
  @IsOptional()
  telegramId?: string;
}


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

  @IsDateString()
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
  facePersonId?: string;

  @IsString()
  @IsOptional()
  enrollNumber?: string

  @IsOptional()
  @ValidateNested()
  @Type(() => ParentDto)
  parent?: ParentDto;

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
  photo?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ParentDto)
  parent?: ParentDto;
  
  @IsString()
  @IsOptional()
  facePersonId?: string;

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