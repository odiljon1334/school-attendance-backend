import { Module } from '@nestjs/common';
import { StudentsService } from './students.service';
import { StudentsController } from './students.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { HikvisionModule } from '../hikvision/hikvision.module'; // ← Import
import { TurnstileModule } from 'src/turnstile/turnstile.module';
import { RedisModule } from '../redis/redis.module';
import { AuditLogModule } from '../audit-log/audit-log.module';

@Module({
  imports: [
    PrismaModule,
    HikvisionModule,
    TurnstileModule,
    RedisModule,
    AuditLogModule,
  ],
  controllers: [StudentsController],
  providers: [StudentsService],
  exports: [StudentsService],
})
export class StudentsModule {}