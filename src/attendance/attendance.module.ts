import { forwardRef, Module } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { AttendanceController } from './attendance.controller';
import { AttendanceGateway } from './attendance.gateway';
import { AbsentDaysCron } from './absent-days.cron';
import { TeacherAbsentCron } from './teacher-absent.cron';
import { AttendanceCleanupCron } from './cleanup.cron';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RedisModule } from 'src/redis/redis.module';
import { HikvisionModule } from 'src/hikvision/hikvision.module';
import { WhatsappModule } from 'src/whatsapp/whatsapp.module';
import { ConfigModule } from '@nestjs/config';
import { AuditLogModule } from '../audit-log/audit-log.module';

@Module({
  imports: [
    PrismaModule,
    NotificationsModule,
    RedisModule,
    WhatsappModule,
    ConfigModule,
    AuditLogModule,
    forwardRef(() => HikvisionModule),
  ],
  controllers: [AttendanceController],
  providers: [AttendanceService, AttendanceGateway, AbsentDaysCron, TeacherAbsentCron, AttendanceCleanupCron],
  exports: [AttendanceService, AttendanceGateway],
})
export class AttendanceModule {}
