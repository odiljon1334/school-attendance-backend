import {
    IsString,
    IsNotEmpty,
    IsOptional,
    IsEmail,
    IsBoolean,
  } from 'class-validator';
  
  export class CreateParentDto {
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
    studentId: string;
  
    @IsString()
    @IsNotEmpty()
    firstName: string;
  
    @IsString()
    @IsNotEmpty()
    lastName: string;
  
    @IsString()
    @IsNotEmpty()
    phone: string;
  
    @IsString()
    @IsNotEmpty()
    relationship: string; // father, mother, guardian
  
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
  
  export class UpdateParentDto {
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
    relationship?: string;
  
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