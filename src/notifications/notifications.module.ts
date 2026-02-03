import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { SmsService } from './sms.service';
import { TelegramService } from './telegram.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [PrismaModule, AuthModule, ConfigModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, SmsService, TelegramService],
  exports: [NotificationsService, SmsService, TelegramService],
})
export class NotificationsModule {}
