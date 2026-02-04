import { IsString, IsNotEmpty, IsOptional, IsNumber, IsBoolean, Min, Max } from 'class-validator';

export class CreateDeviceDto {
  @IsString()
  @IsNotEmpty()
  schoolId: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  deviceId: string; // Hikvision device ID

  @IsString()
  @IsNotEmpty()
  ipAddress: string;

  @IsNumber()
  @Min(1)
  @Max(65535)
  @IsOptional()
  port?: number; // Default: 80

  @IsString()
  @IsNotEmpty()
  username: string;

  @IsString()
  @IsNotEmpty()
  password: string;

  @IsString()
  @IsOptional()
  location?: string; // entrance, exit, etc.

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class UpdateDeviceDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  ipAddress?: string;

  @IsNumber()
  @Min(1)
  @Max(65535)
  @IsOptional()
  port?: number;

  @IsString()
  @IsOptional()
  username?: string;

  @IsString()
  @IsOptional()
  password?: string;

  @IsString()
  @IsOptional()
  location?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class RegisterFaceDto {
  @IsString()
  @IsNotEmpty()
  deviceId: string;

  @IsString()
  @IsNotEmpty()
  studentId?: string;

  @IsString()
  @IsOptional()
  teacherId?: string;

  @IsString()
  @IsOptional()
  directorId?: string;

  @IsString()
  @IsNotEmpty()
  faceImage: string; // Base64 image
}

export class FaceRecognitionEventDto {
  @IsString()
  @IsNotEmpty()
  deviceId: string;

  @IsString()
  @IsNotEmpty()
  personId: string; // Hikvision person ID

  @IsString()
  @IsNotEmpty()
  timestamp: string;

  @IsNumber()
  @IsOptional()
  temperature?: number; // Body temperature (if supported)
}