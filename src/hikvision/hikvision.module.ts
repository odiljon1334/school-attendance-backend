import { forwardRef, Module } from '@nestjs/common';
import { HikvisionService } from './hikvision.service';
import { HikvisionController } from './hikvision.controller';
import { HikvisionApiService } from './hikvision-api.service';
import { PrismaModule } from '../prisma/prisma.module';
import { PayrollModule } from '../payroll/payroll.module';
import { AttendanceModule } from 'src/attendance/attendance.module';
import { AuditLogModule } from '../audit-log/audit-log.module';

@Module({
  imports: [
    PrismaModule,
    PayrollModule,
    forwardRef(() => AttendanceModule),
    AuditLogModule,
  ],
  controllers: [HikvisionController],
  providers: [HikvisionService, HikvisionApiService],
  exports: [HikvisionService, HikvisionApiService],
})
export class HikvisionModule {}