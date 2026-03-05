import {
    Controller,
    Post,
    Body,
    Headers,
    HttpCode,
    HttpStatus,
    Logger,
    BadRequestException,
    Inject,
    forwardRef,
  } from '@nestjs/common';
  import { PrismaService } from '../prisma/prisma.service';
  import { extractPaymentMethod, FreedomPayService, isSuccessStatus, WebhookPayload } from './freedom-pay.service';
  import { WhatsappBotService } from '../whatsapp/whatsapp.bot.service';
  import { NotificationsService } from '../notifications/notifications.service';
  
  @Controller('webhooks')
  export class PaymentWebhookController {
    private readonly logger = new Logger(PaymentWebhookController.name);
  
    constructor(
      private prisma: PrismaService,
      private balanceKg: FreedomPayService,
      @Inject(forwardRef(() => WhatsappBotService))
      private whatsappBot: WhatsappBotService,
      private notifications: NotificationsService,
    ) {}
  
    // ─────────────────────────────────────────────────────────
    // POST /webhooks/payment  (JWT guard YO'Q)
    // ─────────────────────────────────────────────────────────
    @Post('payment')
    @HttpCode(HttpStatus.OK)
    async handlePaymentWebhook(
      @Body() body: WebhookPayload,
      @Headers() headers: Record<string, string>,
    ) {
      this.logger.log(`📥 Payment webhook: orderId=${body.order_id} status=${body.status}`);
  
      // 1. Signature verify
      if (!this.balanceKg.verifyWebhookSignature(body)) {
        this.logger.warn(`⚠️ Invalid signature for orderId=${body.order_id}`);
        throw new BadRequestException('Invalid signature');
      }
  
      // 2. Faqat SUCCESS
      if (!isSuccessStatus(body.status)) {
        this.logger.log(`ℹ️ status=${body.status} — skipped`);
        return { received: true };
      }
  
      // 3. Payment topish
      const payment = await this.prisma.payment.findFirst({
        where: { externalOrderId: body.order_id },
        include: {
          student: {
            include: {
              school: true,
              parents: { include: { parent: true } },
            },
          },
        },
      });
  
      if (!payment) {
        this.logger.warn(`⚠️ Payment not found: orderId=${body.order_id}`);
        return { received: true };
      }
  
      // 4. Idempotency
      if (payment.status === 'PAID') {
        this.logger.log(`ℹ️ Already PAID: id=${payment.id}`);
        return { received: true };
      }
  
      // 5. Mark as PAID
      const now = new Date();
  
      await this.prisma.$transaction([
        this.prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: 'PAID',
            paidDate: now,
            transactionId: body.transaction_id,
            paymentMethod: extractPaymentMethod(body),
          },
        }),
        this.prisma.student.update({
          where: { id: payment.studentId },
          data: { billingPaidUntil: this.calcPaidUntil(payment.plan, now) },
        }),
      ]);
  
      this.logger.log(`✅ PAID: id=${payment.id} amount=${payment.amount} method=${extractPaymentMethod(body)}`);
  
      // 6. Notifications (non-blocking)
      Promise.allSettled([
        this.whatsappBot.notifyPaymentSuccess(payment.id),
        this.notifications.sendPaymentConfirmation(payment.id),
      ]).catch((err) =>
        this.logger.error(`Notification error: ${err?.message}`),
      );
  
      return { received: true };
    }
  
    private calcPaidUntil(plan: string, from: Date): Date {
      const d = new Date(from);
      if (plan === 'YEARLY') d.setFullYear(d.getFullYear() + 1);
      else d.setMonth(d.getMonth() + 1);
      return d;
    }
  }