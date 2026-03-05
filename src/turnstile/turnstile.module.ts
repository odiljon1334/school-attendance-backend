import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TurnstileService } from './turnstile.service';
import { TurnstileController } from './turnstile.controller';
import { HikvisionModule } from '../hikvision/hikvision.module';

@Module({
  imports: [ConfigModule, HikvisionModule],
  providers: [TurnstileService],
  controllers: [TurnstileController],
  exports: [TurnstileService],
})
export class TurnstileModule {}