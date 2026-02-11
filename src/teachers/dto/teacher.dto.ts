import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEmail,
  IsArray,
  ArrayNotEmpty,
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
  @ArrayNotEmpty()
  subjects: string[];

  @IsString()
  @IsOptional()
  telegramId?: string;

  @IsString()
  @IsOptional()
  photo?: string;

  @IsString()
  @IsOptional()
  enrollNumber?: string
}

export class UpdateTeacherDto {
  @IsString()
  @IsNotEmpty()
  password: string;

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
}
