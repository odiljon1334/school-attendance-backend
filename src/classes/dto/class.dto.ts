import { IsString, IsNotEmpty, IsOptional, IsNumber, Min, Max } from 'class-validator';

export class CreateClassDto {
  @IsString()
  @IsNotEmpty()
  schoolId: string;

  @IsNumber()
  @Min(1)
  @Max(11)
  grade: number; // 1-11

  @IsString()
  @IsNotEmpty()
  section: string; // A, B, C, etc.

  @IsString()
  @IsNotEmpty()
  academicYear: string; // 2024-2025

  @IsNumber()
  @Min(1)
  @Max(2)
  @IsOptional()
  shift?: number; // 1 = birinchi smena, 2 = ikkinchi smena

  @IsString()
  @IsOptional()
  startTime?: string; // "08:30"

  @IsString()
  @IsOptional()
  endTime?: string; // "13:30"
}

export class UpdateClassDto {
  @IsNumber()
  @Min(1)
  @Max(11)
  @IsOptional()
  grade?: number;

  @IsString()
  @IsOptional()
  section?: string;

  @IsString()
  @IsOptional()
  academicYear?: string;

  @IsNumber()
  @Min(1)
  @Max(2)
  @IsOptional()
  shift?: number; // 1 = birinchi smena, 2 = ikkinchi smena

  @IsString()
  @IsOptional()
  startTime?: string; // "08:30"

  @IsString()
  @IsOptional()
  endTime?: string; // "13:30"
}
