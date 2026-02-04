import { Module } from '@nestjs/common';
import { HikvisionService } from './hikvision.service';
import { HikvisionController } from './hikvision.controller';
import { HikvisionApiService } from './hikvision-api.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [PrismaModule, AuthModule, ConfigModule],
  controllers: [HikvisionController],
  providers: [HikvisionService, HikvisionApiService],
  exports: [HikvisionService, HikvisionApiService],
})
export class HikvisionModule {}