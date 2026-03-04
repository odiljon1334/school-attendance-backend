import { forwardRef, Module } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { AttendanceController } from './attendance.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RedisModule } from 'src/redis/redis.module';
import { HikvisionModule } from 'src/hikvision/hikvision.module';
import { WhatsappModule } from 'src/whatsapp/whatsapp.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    PrismaModule,
    NotificationsModule,
    RedisModule,
    WhatsappModule, 
    ConfigModule,
    forwardRef(() => HikvisionModule)
  ],
  controllers: [AttendanceController],
  providers: [AttendanceService],
  exports: [AttendanceService],
})
export class AttendanceModule {}
