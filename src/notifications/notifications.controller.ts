import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  UseGuards,
  HttpCode,
  HttpStatus,
  Query,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../auth/guards/jwt.auth.guards';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

export class SendDailyAttendanceDto {
  schoolId: string;
  date?: string;
}

export class SendPaymentReminderDto {
  // Called by scheduler - no body needed
}

@Controller('notifications')
@UseGuards(JwtAuthGuard, RolesGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  // Get all notifications
  @Get()
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.DISTRICT_ADMIN,
    UserRole.SCHOOL_ADMIN,
  )
  findAll(
    @Query('recipientId') recipientId?: string,
    @Query('type') type?: string,
    @Query('isSent') isSent?: string,
  ) {
    return this.notificationsService.findAll(recipientId, type, isSent);
  }

  // Send daily attendance to parents
  @Post('daily-attendance')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.DISTRICT_ADMIN,
    UserRole.SCHOOL_ADMIN,
    UserRole.DIRECTOR,
  )
  @HttpCode(HttpStatus.OK)
  sendDailyAttendance(@Body() dto: SendDailyAttendanceDto) {
    const date = dto.date ? new Date(dto.date) : new Date();
    return this.notificationsService.sendDailyAttendanceToParents(
      dto.schoolId,
      date,
    );
  }

  // Trigger payment reminders (usually called by scheduler)
  @Post('payment-reminders')
  @Roles(UserRole.SUPER_ADMIN, UserRole.DISTRICT_ADMIN)
  @HttpCode(HttpStatus.OK)
  sendPaymentReminders() {
    return this.notificationsService.sendPaymentReminders();
  }

  // Send payment confirmation
  @Post('payment-confirmation/:paymentId')
  @Roles(UserRole.SUPER_ADMIN, UserRole.DISTRICT_ADMIN)
  @HttpCode(HttpStatus.OK)
  sendPaymentConfirmation(@Param('paymentId') paymentId: string) {
    return this.notificationsService.sendPaymentConfirmation(paymentId);
  }

  // Delete notification
  @Delete(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.DISTRICT_ADMIN, UserRole.SCHOOL_ADMIN)
  @HttpCode(HttpStatus.OK)
  remove(@Param('id') id: string) {
    return this.notificationsService.remove(id);
  }
}