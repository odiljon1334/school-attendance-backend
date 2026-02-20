import {
  IsString,
  IsOptional,
  IsArray,
  IsUUID,
  IsEnum,
} from 'class-validator';

enum TeacherRole {
  TEACHER = 'TEACHER',
  DIRECTOR = 'DIRECTOR',
}

export class CreateTeacherDto {
  // ✅ Type: TEACHER yoki DIRECTOR
  @IsEnum(TeacherRole)
  @IsOptional()
  type?: TeacherRole;

  @IsString()
  @IsOptional()
  schoolId?: string;

  @IsString()
  @IsOptional()
  firstName?: string;

  @IsString()
  @IsOptional()
  lastName?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsArray()
  @IsOptional()
  subjects?: string[];

  @IsString()
  @IsOptional()
  telegramId?: string;

  @IsString()
  @IsOptional()
  photo?: string;

  @IsString()
  @IsOptional()
  facePersonId?: string;

  @IsString()
  @IsOptional()
  enrollNumber?: string;

  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  classIds?: string[];
}

export class UpdateTeacherDto {
  // ✅ Type: TEACHER yoki DIRECTOR
  @IsEnum(TeacherRole)
  @IsOptional()
  type?: TeacherRole;

  @IsString()
  @IsOptional()
  firstName?: string;

  @IsString()
  @IsOptional()
  lastName?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsArray()
  @IsOptional()
  subjects?: string[];

  @IsString()
  @IsOptional()
  telegramId?: string;

  @IsString()
  @IsOptional()
  photo?: string;

  @IsString()
  @IsOptional()
  facePersonId?: string;

  @IsString()
  @IsOptional()
  enrollNumber?: string;

  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  classIds?: string[];
}