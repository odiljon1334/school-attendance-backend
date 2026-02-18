// src/notifications/notifications.module.ts - UPDATED

import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';  // ← QO'SHILDI
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { SmsService } from './sms.service';
import { SmsController } from './sms.controller';
import { SmsPaymentService } from './sms-payment.service';  // ← QO'SHILDI
import { TelegramService } from './telegram.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { ConfigModule } from '@nestjs/config';
import { SmsPaymentController } from './sms-payment.controller';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    ConfigModule,
    ScheduleModule.forRoot(),  // ← QO'SHILDI
  ],
  controllers: [
    NotificationsController, 
    SmsController,
    SmsPaymentController,
  ],
  providers: [
    NotificationsService,
    SmsService,
    SmsPaymentService,  // ← QO'SHILDI
    TelegramService,
  ],
  exports: [
    NotificationsService,
    SmsService,
    SmsPaymentService,  // ← QO'SHILDI
    TelegramService,
  ],
})
export class NotificationsModule {}