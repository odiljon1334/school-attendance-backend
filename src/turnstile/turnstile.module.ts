import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TurnstileService } from './turnstile.service';
import { TurnstileController } from './turnstile.controller';

@Module({
  imports: [ConfigModule],
  providers: [TurnstileService],
  controllers: [TurnstileController],
  exports: [TurnstileService],
})
export class TurnstileModule {}