import { forwardRef, Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { BillingModule } from '../billing/billing.module';
import { PaymentWebhookController } from './payment-webhook.controller';
import { FreedomPayService } from './freedom-pay.service';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { ConfigModule } from '@nestjs/config';
import { AuditLogModule } from '../audit-log/audit-log.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    NotificationsModule,
    BillingModule,
    forwardRef(() => WhatsappModule),
    ConfigModule,
    AuditLogModule,
  ],
  controllers: [
    PaymentsController,
    PaymentWebhookController,
  ],
  providers: [
    PaymentsService,
    FreedomPayService,
  ],
  exports: [
    PaymentsService,
    FreedomPayService,
  ],
})
export class PaymentsModule {}