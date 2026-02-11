import { Module } from '@nestjs/common';
import { HikvisionService } from './hikvision.service';
import { HikvisionApiService } from './hikvision-api.service'; // Fayl yo'lini tekshiring
import { HikvisionController } from './hikvision.controller';
import { PrismaService } from '../prisma/prisma.service'; // Prisma yo'lini tekshiring

@Module({
  imports: [],
  controllers: [HikvisionController],
  providers: [
    HikvisionService, 
    HikvisionApiService, // SHU QATORNI QO'SHING
    PrismaService
  ],
  exports: [HikvisionService],
})
export class HikvisionModule {}