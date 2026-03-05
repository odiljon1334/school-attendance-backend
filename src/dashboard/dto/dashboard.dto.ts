import { IsString, IsOptional, IsDateString, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class DashboardQueryDto {
  @IsString()
  schoolId: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export class DistrictDashboardDto {
  @IsString()
  districtId: string;
}

export class TrendsQueryDto {
  @IsOptional()
  @IsString()
  schoolId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  days?: number = 7;
}
