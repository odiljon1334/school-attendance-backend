import { forwardRef, Module } from '@nestjs/common';
import { HikvisionService } from './hikvision.service';
import { HikvisionController } from './hikvision.controller';
import { HikvisionApiService } from './hikvision-api.service';
import { PrismaModule } from '../prisma/prisma.module';
import { PayrollModule } from '../payroll/payroll.module';
import { AttendanceModule } from 'src/attendance/attendance.module';

@Module({
  imports: [
    PrismaModule,
    PayrollModule,
    forwardRef(() => AttendanceModule)
  ],
  controllers: [HikvisionController],
  providers: [HikvisionService, HikvisionApiService],
  exports: [HikvisionService, HikvisionApiService],
})
export class HikvisionModule {}