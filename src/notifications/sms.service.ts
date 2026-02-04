import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import axios from 'axios';

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  // Eskiz.uz API
  private readonly SMS_API_URL = 'http://eskiz.uz/api';

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {}

  // Get auth token from Eskiz
  private async getToken(): Promise<string> {
    try {
      const email = this.configService.get<string>('SMS_EMAIL');
      const password = this.configService.get<string>('SMS_PASSWORD');

      const response = await axios.post(`${this.SMS_API_URL}/auth/login`, {
        email,
        password,
      });

      // TO'G'RI: any sifatida cast
      return (response.data as any)?.data?.token || '';
    } catch (error) {
      const err = error as { response?: { data?: { message?: string } }; message?: string };
      const msg =
        err?.response?.data?.message || err?.message || (error instanceof Error ? error.message : 'Unknown error');
      this.logger.warn(`SMS token failed: ${msg}`);
      throw new Error('SMS authentication failed');
    }
  }

  // Send single SMS
  async sendSms(phone: string, message: string): Promise<boolean> {
    try {
      // In development mode, just log the message
      if (this.configService.get<string>('NODE_ENV') === 'development') {
        this.logger.log(`[SMS DEV MODE] To: ${phone}, Message: ${message}`);
        await this.logSms(phone, message, 'sent');
        return true;
      }

      const token = await this.getToken();
      const senderId =
        this.configService.get<string>('SMS_SENDER_ID') || 'Mobil-Oktyabr';

      const response = await axios.post(
        `${this.SMS_API_URL}/message/sms/send`,
        {
          mobile_no: phone.replace('+', ''),
          message,
          from: senderId,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      // TO'G'RI: response.data ni any sifatida cast qilamiz
      if ((response.data as any)?.status === 'success') {
        await this.logSms(phone, message, 'sent');
        return true;
      } else {
        await this.logSms(phone, message, 'failed');
        return false;
      }
    } catch (error) {
      const err = error as { response?: { data?: { message?: string } }; message?: string };
      const msg =
        err?.response?.data?.message || err?.message || (error instanceof Error ? error.message : 'Unknown error');
      this.logger.warn(`SMS send failed (${phone}): ${msg}`);
      await this.logSms(phone, message, 'failed');
      return false;
    }
  }

  // Send bulk SMS
  async sendSmsBulk(
    phones: string[],
    message: string,
  ): Promise<{ success: number; failed: number }> {
    const results = { success: 0, failed: 0 };

    for (const phone of phones) {
      const success = await this.sendSms(phone, message);
      if (success) {
        results.success++;
      } else {
        results.failed++;
      }
    }

    return results;
  }

  // Log SMS to database
  private async logSms(recipient: string, message: string, status: string) {
    try {
      await this.prisma.smsLog.create({
        data: {
          recipient,
          message,
          status,
          sentAt: new Date(),
        },
      });
    } catch (error) {
      this.logger.warn(
        `SMS log failed: ${error instanceof Error ? error.message : 'Unknown'}`,
      );
    }
  }

  // Get SMS history
  async getSmsLogs(startDate?: string, endDate?: string) {
    const where: any = {};

    if (startDate || endDate) {
      where.sentAt = {};
      if (startDate) where.sentAt.gte = new Date(startDate);
      if (endDate) where.sentAt.lte = new Date(endDate);
    }

    return this.prisma.smsLog.findMany({
      where,
      orderBy: { sentAt: 'desc' },
    });
  }
}
