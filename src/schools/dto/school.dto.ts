import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEmail,
  IsUUID,
  MinLength,
} from 'class-validator';

export class CreateSchoolDto {
  @IsUUID()
  @IsNotEmpty()
  districtId: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  address: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  // ✅ REQUIRED
  @IsString()
  @IsNotEmpty()
  @MinLength(4)
  username: string;

  // ✅ REQUIRED
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password: string;
}

// ==========================================
// ✅ UPDATE SCHOOL DTO
// ==========================================
export class UpdateSchoolDto {
  
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  code?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  // ✅ NEW: Username update
 // optional
  @IsOptional()
  @IsString()
  @MinLength(4)
  username?: string;

  // optional
  @IsOptional()
  @IsString()
  @MinLength(6)
  password?: string;

  @IsUUID()
  @IsOptional()
  districtId?: string;
}