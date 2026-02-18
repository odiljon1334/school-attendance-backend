import {
    IsString,
    IsNotEmpty,
    IsOptional,
    IsEmail,
  } from 'class-validator';
  
  export class CreateDirectorDto {
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
  
    @IsString()
    @IsOptional()
    telegramId?: string;
  
    @IsString()
    @IsOptional()
    photo?: string;
  }
  
  export class UpdateDirectorDto {
    @IsString()
    @IsOptional()
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
  
    @IsString()
    @IsOptional()
    telegramId?: string;
  
    @IsString()
    @IsOptional()
    photo?: string;
  }