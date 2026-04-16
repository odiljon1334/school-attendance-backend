import { Controller, Get, Param, Query } from '@nestjs/common';
import { MapService } from './map.service';

@Controller('map')
export class MapController {
  constructor(private readonly svc: MapService) {}

  /** Национальная сводка (шапка карты) */
  @Get('summary')
  getSummary(@Query('date') date?: string) {
    return this.svc.getNationalSummary(date);
  }

  /** Все районы с цветом посещаемости */
  @Get('districts')
  getDistricts(@Query('date') date?: string) {
    return this.svc.getDistrictStats(date);
  }

  /** Детализация по одному району */
  @Get('districts/:id')
  getDistrict(@Param('id') id: string, @Query('date') date?: string) {
    return this.svc.getDistrictDetail(id, date);
  }

  /** Тренд: ?period=daily|weekly|monthly|yearly&districtId=...&schoolId=... */
  @Get('trend')
  getTrend(
    @Query('period') period: 'daily' | 'weekly' | 'monthly' | 'yearly' = 'weekly',
    @Query('districtId') districtId?: string,
    @Query('schoolId')   schoolId?: string,
  ) {
    return this.svc.getAttendanceTrend(period, districtId, schoolId);
  }
}
