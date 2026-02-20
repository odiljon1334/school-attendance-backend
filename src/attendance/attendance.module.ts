import { Module } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { AttendanceController } from './attendance.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RedisModule } from 'src/redis/redis.module';
import { DashboardModule } from 'src/dashboard/dashboard.module'; // 🔹 import qilindi

@Module({
  imports: [
    PrismaModule,
    NotificationsModule,
    RedisModule,
    DashboardModule, // 🔹 bu qo‘shildi
  ],
  controllers: [AttendanceController],
  providers: [AttendanceService],
  exports: [AttendanceService],
})
export class AttendanceModule {}
