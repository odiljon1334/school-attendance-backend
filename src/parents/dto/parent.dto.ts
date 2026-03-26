import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsEnum,
} from 'class-validator';
import { ParentRelation } from '@prisma/client';

export class CreateParentDto {

  @IsString()
  @IsNotEmpty()
  studentId: string;

  @IsString()
  @IsNotEmpty()
  firstName: string;

  @IsString()
  @IsOptional()
  lastName?: string;

  @IsString()
  @IsNotEmpty()
  phone: string;

  @IsEnum(ParentRelation, {
    message: 'Некорректное значение relationship (ParentRelation)',
  })
  @IsOptional()
  relationship?: ParentRelation;

  @IsBoolean()
  @IsOptional()
  notifySms?: boolean;

  @IsString()
  @IsOptional()
  telegramId?: string;

  @IsString()
  @IsOptional()
  telegramChatId?: string;

  @IsString()
  @IsOptional()
  telegramUsername?: string;

  @IsBoolean()
  @IsOptional()
  isTelegramActive?: boolean;
}

export class UpdateParentDto {
 
  @IsString()
  @IsOptional()
  studentId?: string;

  @IsEnum(ParentRelation, {
    message: 'Некорректное значение relationship (ParentRelation)',
  })
  @IsOptional()
  relationship?: ParentRelation;

  @IsBoolean()
  @IsOptional()
  notifySms?: boolean;

  @IsString()
  @IsOptional()
  telegramId?: string;

  @IsString()
  @IsOptional()
  telegramChatId?: string;

  @IsString()
  @IsOptional()
  telegramUsername?: string;

  @IsBoolean()
  @IsOptional()
  isTelegramActive?: boolean;
}