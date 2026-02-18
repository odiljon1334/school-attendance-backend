// src/hikvision/hikvision.module.ts - UPDATE

import { Module } from '@nestjs/common';
import { HikvisionService } from './hikvision.service';
import { HikvisionController } from './hikvision.controller';
import { HikvisionApiService } from './hikvision-api.service';
import { PrismaModule } from '../prisma/prisma.module';
import { PayrollModule } from '../payroll/payroll.module';  // ✅ ADD THIS

@Module({
  imports: [
    PrismaModule,
    PayrollModule,  // ✅ ADD THIS
  ],
  controllers: [HikvisionController],
  providers: [HikvisionService, HikvisionApiService],
  exports: [HikvisionService],
})
export class HikvisionModule {}