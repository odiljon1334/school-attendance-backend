// src/notifications/sms.controller.ts

import { Controller, Get, Post, Body } from '@nestjs/common';
import { SmsService } from './sms.service';

@Controller('sms')
export class SmsController {
  constructor(private readonly smsService: SmsService) {}

  // ✅ GET /sms/status — barcha gateway'lar holati
  @Get('status')
  getStatus() {
    return this.smsService.getStatus();
  }

  // ✅ POST /sms/test — test SMS yuborish
  @Post('test')
  async testSms(@Body() body: { phone: string; message?: string }) {
    const message = body.message || 'Test SMS from Android Gateway!';
    const result = await this.smsService.sendSms(body.phone, message);
    return { success: result };
  }
}
