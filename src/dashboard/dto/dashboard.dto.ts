import { IsString, IsNotEmpty, IsOptional, IsDateString } from 'class-validator';

export class DashboardQueryDto {
  @IsString()
  @IsNotEmpty()
  schoolId: string;

  @IsDateString()
  @IsOptional()
  startDate?: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;
}

export class DistrictDashboardDto {
  @IsString()
  @IsNotEmpty()
  districtId: string;

  @IsDateString()
  @IsOptional()
  startDate?: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;
}