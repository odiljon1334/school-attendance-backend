import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Query,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import {
  SendSmsDto,
  SendSmsBulkDto,
  SendTelegramDto,
  SendTelegramBulkDto,
  NotifyParentsDto,
  NotifyClassDto,
  NotifySchoolDto,
} from './dto/notification.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.auth.guards';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@Controller('notifications')
@UseGuards(JwtAuthGuard, RolesGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  // ─── SMS ──────────────────────────────────────
  @Post('sms/send')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.DISTRICT_ADMIN,
    UserRole.SCHOOL_ADMIN,
    UserRole.DIRECTOR,
  )
  @HttpCode(HttpStatus.OK)
  sendSms(@Body() dto: SendSmsDto) {
    return this.notificationsService.sendSms(dto);
  }

  @Post('sms/send-bulk')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.DISTRICT_ADMIN,
    UserRole.SCHOOL_ADMIN,
    UserRole.DIRECTOR,
  )
  @HttpCode(HttpStatus.OK)
  sendSmsBulk(@Body() dto: SendSmsBulkDto) {
    return this.notificationsService.sendSmsBulk(dto);
  }

  @Get('sms/logs')
  @Roles(UserRole.SUPER_ADMIN, UserRole.DISTRICT_ADMIN, UserRole.SCHOOL_ADMIN)
  getSmsLogs(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.notificationsService.getSmsLogs(startDate, endDate);
  }

  // ─── TELEGRAM ─────────────────────────────────
  @Post('telegram/send')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.DISTRICT_ADMIN,
    UserRole.SCHOOL_ADMIN,
    UserRole.DIRECTOR,
  )
  @HttpCode(HttpStatus.OK)
  sendTelegram(@Body() dto: SendTelegramDto) {
    return this.notificationsService.sendTelegram(dto);
  }

  @Post('telegram/send-bulk')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.DISTRICT_ADMIN,
    UserRole.SCHOOL_ADMIN,
    UserRole.DIRECTOR,
  )
  @HttpCode(HttpStatus.OK)
  sendTelegramBulk(@Body() dto: SendTelegramBulkDto) {
    return this.notificationsService.sendTelegramBulk(dto);
  }

  // ─── NOTIFY PARENTS ───────────────────────────
  @Post('notify/parents')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.DISTRICT_ADMIN,
    UserRole.SCHOOL_ADMIN,
    UserRole.DIRECTOR,
    UserRole.TEACHER,
  )
  @HttpCode(HttpStatus.OK)
  notifyParents(@Body() dto: NotifyParentsDto) {
    return this.notificationsService.notifyParents(dto);
  }

  @Post('notify/class')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.DISTRICT_ADMIN,
    UserRole.SCHOOL_ADMIN,
    UserRole.DIRECTOR,
    UserRole.TEACHER,
  )
  @HttpCode(HttpStatus.OK)
  notifyClass(@Body() dto: NotifyClassDto) {
    return this.notificationsService.notifyClass(dto);
  }

  @Post('notify/school')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.DISTRICT_ADMIN,
    UserRole.SCHOOL_ADMIN,
    UserRole.DIRECTOR,
  )
  @HttpCode(HttpStatus.OK)
  notifySchool(@Body() dto: NotifySchoolDto) {
    return this.notificationsService.notifySchool(dto);
  }
}
