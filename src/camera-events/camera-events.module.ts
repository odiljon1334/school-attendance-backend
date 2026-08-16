// ─── camera-events.module.ts ──────────────────────────────────────────────────
import { Module } from '@nestjs/common';
import { CameraEventsController } from './camera-events.controller';
import { CameraEventsService } from './camera-events.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ConfigModule } from '@nestjs/config';
import { AttendanceModule } from '../attendance/attendance.module';

@Module({
  imports: [PrismaModule, ConfigModule, AttendanceModule],
  controllers: [CameraEventsController],
  providers: [CameraEventsService],
  exports: [CameraEventsService],
})
export class CameraEventsModule {}
