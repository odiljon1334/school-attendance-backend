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
  
    @Get('school/:schoolId')
    @Roles(
      UserRole.SUPER_ADMIN,
      UserRole.DISTRICT_ADMIN,
      UserRole.SCHOOL_ADMIN,
      UserRole.DIRECTOR,
    )
    getSchoolDashboard(
      @Param('schoolId') schoolId: string,
      @Query('startDate') startDate?: string,
      @Query('endDate') endDate?: string,
    ) {
      return this.dashboardService.getSchoolDashboard(schoolId, startDate, endDate);
    }
  
    @Get('district/:districtId')
    @Roles(UserRole.SUPER_ADMIN, UserRole.DISTRICT_ADMIN)
    getDistrictDashboard(
      @Param('districtId') districtId: string,
      @Query('startDate') startDate?: string,
      @Query('endDate') endDate?: string,
    ) {
      return this.dashboardService.getDistrictDashboard(districtId, startDate, endDate);
    }
  }