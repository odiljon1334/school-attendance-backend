import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class CreateDistrictDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  region: string;

  @IsString()
  @IsNotEmpty()
  code: string;
}

export class UpdateDistrictDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  region?: string;

  @IsString()
  @IsOptional()
  code?: string;
}

export class DistrictResponseDto {
  id: string;
  name: string;
  region: string;
  code: string;
  createdAt: Date;
  updatedAt: Date;
}
