import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEmail,
  IsArray,
  IsUUID,
} from 'class-validator';

export class CreateTeacherDto {
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
  firstName: string;

  @IsString()
  @IsNotEmpty()
  lastName: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsArray()
  @IsOptional() // ✅ FIXED: Made optional (not required)
  subjects?: string[];

  @IsString()
  @IsOptional()
  telegramId?: string;

  @IsString()
  @IsOptional()
  photo?: string;

  // ✅ ADDED: Class IDs for assignment
  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  classIds?: string[];
}

export class UpdateTeacherDto {
  @IsString()
  @IsOptional() // ✅ FIXED: Made optional (not required)
  password?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

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

  // ✅ ADDED: Class IDs for reassignment
  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  classIds?: string[];
}