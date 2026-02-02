import { IsString, IsNotEmpty, IsOptional, IsEmail } from 'class-validator';

export class CreateSchoolDto {
  @IsString()
  @IsNotEmpty()
  districtId: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  address: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsNotEmpty()
  code: string;
}

export class UpdateSchoolDto {
  @IsString()
  @IsOptional()
  districtId?: string;

  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  code?: string;
}

export class SchoolResponseDto {
  id: string;
  districtId: string;
  name: string;
  address: string;
  phone?: string;
  email?: string;
  code: string;
  createdAt: Date;
  updatedAt: Date;
}
