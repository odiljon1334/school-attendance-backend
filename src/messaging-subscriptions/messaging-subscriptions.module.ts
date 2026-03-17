import { Module } from '@nestjs/common';
import { MessagingSubscriptionsService } from './messaging-subscriptions.service';
import { MessagingSubscriptionsController } from './messaging-subscriptions.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [MessagingSubscriptionsController],
  providers: [MessagingSubscriptionsService],
  exports: [MessagingSubscriptionsService],
})
export class MessagingSubscriptionsModule {}
