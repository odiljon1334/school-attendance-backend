import { Module } from '@nestjs/common';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappService } from './whatsapp.service';
import { WhatsappBotService } from './whatsapp.bot.service';
import { WhatsappStateService } from './whatsapp.state.service';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { ConfigModule } from '@nestjs/config';
import { FreedomPayService } from 'src/payments/freedom-pay.service';

@Module({
  imports: [PrismaModule, RedisModule, ConfigModule],
  controllers: [WhatsappController],
  providers: [
    WhatsappService, 
    WhatsappStateService, 
    WhatsappBotService,
    FreedomPayService,
  ],
  exports: [WhatsappService, WhatsappStateService, WhatsappBotService],
})
export class WhatsappModule {}