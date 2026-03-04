import {
    Controller,
    Post,
    Body,
    Headers,
    HttpCode,
    HttpStatus,
    Logger,
  } from '@nestjs/common';
  import { WhatsappBotService } from './whatsapp.bot.service';
  import { ConfigService } from '@nestjs/config';
  import * as crypto from 'crypto';
  
  @Controller('whatsapp')
  export class WhatsappController {
    private readonly logger = new Logger(WhatsappController.name);
  
    constructor(
      private readonly botService: WhatsappBotService,
      private readonly configService: ConfigService,
    ) {}
  
    // ─────────────────────────────────────────────
    // WHAPI WEBHOOK
    // POST /whatsapp/webhook
    // ─────────────────────────────────────────────
    @Post('webhook')
    @HttpCode(HttpStatus.OK)
    async handleWebhook(
      @Body() body: any,
      @Headers() headers: Record<string, string>,
    ) {

      this.logger.log(`📨 RAW BODY: ${JSON.stringify(body)}`);
      // Signature verify (optional lekin production da kerak)
      const secret = this.configService.get<string>('WHAPI_WEBHOOK_SECRET');
      if (secret) {
        const signature = headers['x-hub-signature-256'] ?? headers['x-signature'];
        if (!this.verifySignature(body, signature, secret)) {
          this.logger.warn('⚠️ Webhook signature mismatch — ignored');
          return { ok: false };
        }
      }
  
      const event = body?.event;
      this.logger.log(`📨 WA Webhook: ${event?.type}/${event?.event}`);
      this.logger.log(`📨 event: ${JSON.stringify(event)}`);
      this.logger.log(`📨 messages: ${JSON.stringify(body?.messages)}`);
  
      // Faqat yangi xabarlar
      if (event?.type === 'messages' && event?.event === 'post') {
        this.logger.log(`✅ Routing to handleMessage`);
        this.botService.handleMessage(body).catch((err) =>
        this.logger.error(`handleMessage unhandled: ${err?.message}`),
        );
      } else {
        this.logger.warn(`⚠️ Event not matched: type=${event?.type} event=${event?.event}`);
      }
  
      // Whapi 200 kutadi — aks holda qayta yuboradi
      return { ok: true };
    }
  
    // ─────────────────────────────────────────────
    // SIGNATURE VERIFY
    // ─────────────────────────────────────────────
    private verifySignature(
      body: any,
      signature: string | undefined,
      secret: string,
    ): boolean {
      if (!signature) return false;
      try {
        const payload = JSON.stringify(body);
        const expected =
          'sha256=' +
          crypto.createHmac('sha256', secret).update(payload).digest('hex');
        return crypto.timingSafeEqual(
          Buffer.from(signature),
          Buffer.from(expected),
        );
      } catch {
        return false;
      }
    }
  }