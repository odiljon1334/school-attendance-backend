import {
  Controller,
  Get,
  Query,
  UseGuards,
  Param,
} from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../auth/guards/jwt.auth.guards';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@Controller('dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  // System overview (SUPER_ADMIN only)
  @Get('overview')
  @Roles(UserRole.SUPER_ADMIN)
  getOverview() {
    return this.dashboardService.getOverview();
  }

  // District dashboard
  @Get('district/:districtId')
  @Roles(UserRole.SUPER_ADMIN, UserRole.DISTRICT_ADMIN)
  getDistrictStats(@Param('districtId') districtId: string) {
    return this.dashboardService.getDistrictStats(districtId);
  }

  // School dashboard
  @Get('school/:schoolId')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.DISTRICT_ADMIN,
    UserRole.SCHOOL_ADMIN,
    UserRole.DIRECTOR,
  )
  getSchoolStats(@Param('schoolId') schoolId: string) {
    return this.dashboardService.getSchoolStats(schoolId);
  }

  // Attendance trends
  @Get('trends')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.DISTRICT_ADMIN,
    UserRole.SCHOOL_ADMIN,
    UserRole.DIRECTOR,
  )
  getAttendanceTrends(
    @Query('schoolId') schoolId?: string,
    @Query('days') days?: string,
  ) {
    return this.dashboardService.getAttendanceTrends(
      schoolId,
      days ? parseInt(days) : 7,
    );
  }
}