import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { MessagingSubscriptionsService } from './messaging-subscriptions.service';
import { JwtAuthGuard } from '../auth/guards/jwt.auth.guards';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('messaging-subscriptions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN')
export class MessagingSubscriptionsController {
  constructor(private readonly service: MessagingSubscriptionsService) {}

  // ─── Umumiy ko'rinish (maktab bo'yicha) ────────────────
  @Get('overview')
  getOverview(@Query('schoolId') schoolId?: string) {
    return this.service.getOverview(schoolId);
  }

  // ─── Telegram subscriptionlar ──────────────────────────
  @Get('telegram')
  getTelegram(
    @Query('schoolId') schoolId?: string,
    @Query('isActive') isActive?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.getTelegramSubscriptions({
      schoolId,
      isActive: isActive !== undefined ? isActive === 'true' : undefined,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? Math.min(parseInt(limit, 10), 200) : 50,
    });
  }

  // ─── WhatsApp subscriptionlar ──────────────────────────
  @Get('whatsapp')
  getWhatsapp(
    @Query('schoolId') schoolId?: string,
    @Query('isActive') isActive?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.getWhatsappSubscriptions({
      schoolId,
      isActive: isActive !== undefined ? isActive === 'true' : undefined,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? Math.min(parseInt(limit, 10), 200) : 50,
    });
  }
}
