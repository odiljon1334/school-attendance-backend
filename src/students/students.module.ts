import { Module } from '@nestjs/common';
import { StudentsService } from './students.service';
import { StudentsController } from './students.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { HikvisionModule } from '../hikvision/hikvision.module'; // ← Import

@Module({
  imports: [
    PrismaModule,
    HikvisionModule, // ← Add this
  ],
  controllers: [StudentsController],
  providers: [StudentsService],
  exports: [StudentsService],
})
export class StudentsModule {}