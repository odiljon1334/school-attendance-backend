import { Module } from '@nestjs/common';
import { TeachersController } from './teachers.controller';
import { TeachersService } from './teachers.service';
import { PrismaModule } from '../prisma/prisma.module';
import { TurnstileModule } from '../turnstile/turnstile.module'; // ✅ ADDED

@Module({
  imports: [
    PrismaModule,
    TurnstileModule,
  ],
  controllers: [TeachersController],
  providers: [TeachersService],
  exports: [TeachersService],
})
export class TeachersModule {}