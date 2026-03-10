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
  Req,
  Patch,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../auth/guards/jwt.auth.guards';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { BroadcastDto } from './dto/notification.dto';

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

  // Get all notifications (with pagination + read filter)
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
    @Query('limit') limit?: string,
    @Query('skip') skip?: string,
    @Query('includeRead') includeRead?: string,
  ) {
    return this.notificationsService.findAll(
      recipientId,
      type,
      isSent,
      limit ? parseInt(limit, 10) : 10,
      skip ? parseInt(skip, 10) : 0,
      includeRead === 'true',
    );
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

  // Barcha o'qilmagan → o'qilgan deb belgilash (specific :id/read DAN OLDIN bo'lishi kerak)
  @Patch('mark-all-read')
  @Roles(UserRole.SUPER_ADMIN, UserRole.DISTRICT_ADMIN, UserRole.SCHOOL_ADMIN)
  @HttpCode(HttpStatus.OK)
  markAllAsRead() {
    return this.notificationsService.markAllAsRead();
  }

  // Bitta notification o'qilgan deb belgilash
  @Patch(':id/read')
  @Roles(UserRole.SUPER_ADMIN, UserRole.DISTRICT_ADMIN, UserRole.SCHOOL_ADMIN)
  @HttpCode(HttpStatus.OK)
  markAsRead(@Param('id') id: string) {
    return this.notificationsService.markAsRead(id);
  }

  // Barcha o'qilganlarni o'chirish (specific :id DAN OLDIN bo'lishi kerak)
  @Delete('read')
  @Roles(UserRole.SUPER_ADMIN, UserRole.DISTRICT_ADMIN, UserRole.SCHOOL_ADMIN)
  @HttpCode(HttpStatus.OK)
  deleteAllRead() {
    return this.notificationsService.deleteAllRead();
  }

  // Bitta notification o'chirish
  @Delete(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.DISTRICT_ADMIN, UserRole.SCHOOL_ADMIN)
  @HttpCode(HttpStatus.OK)
  remove(@Param('id') id: string) {
    return this.notificationsService.remove(id);
  }
  
  @Post('broadcast')
  @Roles(
  UserRole.SUPER_ADMIN,
  UserRole.DISTRICT_ADMIN,
  UserRole.SCHOOL_ADMIN,
  UserRole.DIRECTOR,
)
@HttpCode(HttpStatus.OK)
broadcast(@Body() dto: BroadcastDto, @Req() req: any) {
  return this.notificationsService.broadcast(dto, req.user);
}

}