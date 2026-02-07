import { IsString, IsEmail, IsEnum, IsOptional, MinLength } from 'class-validator';
import { UserRole, UserStatus } from '@prisma/client';

export class CreateUserDto {
  @IsString()
  @MinLength(3)
  username: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsEnum(UserRole)
  role: UserRole;

  @IsEnum(UserStatus)
  @IsOptional()
  status?: UserStatus;
}

export class UpdateUserDto {
  @IsEmail()
  @IsOptional()
  email?: string;

  @IsEnum(UserStatus)
  @IsOptional()
  status?: UserStatus;

  @IsString()
  @MinLength(6)
  @IsOptional()
  password?: string;
}

export class ChangePasswordDto {
  @IsString()
  currentPassword: string;

  @IsString()
  @MinLength(6)
  newPassword: string;
}