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
import { TrendsQueryDto } from './dto/dashboard.dto';

@Controller('dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('overview')
  @Roles(UserRole.SUPER_ADMIN)
  getOverview() {
    return this.dashboardService.getOverview();
  }

  @Get('district/:districtId')
  @Roles(UserRole.SUPER_ADMIN, UserRole.DISTRICT_ADMIN)
  getDistrictStats(@Param('districtId') districtId: string) {
    return this.dashboardService.getDistrictStats(districtId);
  }

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

  @Get('trends')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.DISTRICT_ADMIN,
    UserRole.SCHOOL_ADMIN,
    UserRole.DIRECTOR,
  )
  getAttendanceTrends(@Query() query: TrendsQueryDto) {
    return this.dashboardService.getAttendanceTrends(
      query.schoolId,
      query.days,
    );
  }
}
