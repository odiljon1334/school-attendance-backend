// src/notifications/sms-payment.controller.ts - TEST UCHUN

import { Controller, Post, Get } from '@nestjs/common';
import { SmsPaymentService } from './sms-payment.service';

@Controller('sms-payment')
export class SmsPaymentController {
  constructor(private smsPaymentService: SmsPaymentService) {}

  // ✅ Manual trigger - test uchun
  @Post('check')
  async manualCheck() {
    await this.smsPaymentService.manualCheckPaymentStatus();
    return { message: 'SMS payment check completed' };
  }

  // ✅ Cron status
  @Get('status')
  getStatus() {
    return {
      message: 'SMS payment cron is running',
      schedule: 'Daily at 09:00',
      checks: [
        'Send reminders (3 days before expiry)',
        'Disable expired subscriptions',
      ],
    };
  }
}