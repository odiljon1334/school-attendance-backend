import {
  IsString,
  IsEmail,
  IsOptional,
  IsEnum,
  MinLength,
} from 'class-validator';
import { UserRole } from '@prisma/client';

export class RegisterDto {
  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @MinLength(3)
  username: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsEnum(UserRole)
  role: UserRole;

  @IsString()
  firstName: string;

  @IsString()
  lastName: string;

  @IsString()
  phone: string;

  // Agar SCHOOL_ADMIN, DIRECTOR, TEACHER, STUDENT bo'lsa
  @IsString()
  @IsOptional()
  schoolId?: string;

  // Agar DISTRICT_ADMIN bo'lsa
  @IsString()
  @IsOptional()
  districtId?: string;

  // Agar STUDENT bo'lsa
  @IsString()
  @IsOptional()
  classId?: string;
}

export class LoginDto {
  @IsString()
  username: string;

  @IsString()
  password: string;
}

export class AuthResponseDto {
  access_token: string;
  user: {
    id: string;
    username: string;
    email?: string;
    role: UserRole;
  };
}
