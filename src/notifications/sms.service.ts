import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.service';
import axios from 'axios';

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private readonly apiKey: string;
  private readonly fromPhone: string;
  private readonly apiUrl = 'https://api.httpsms.com/v1/messages/send';
  private dailyCount = 0;
  private lastReset = new Date();

  constructor(
    private configService: ConfigService,
    private redis: RedisService,
  ) {
    this.apiKey = this.configService.get<string>('HTTPSMS_API_KEY', '');
    this.fromPhone = this.configService.get<string>('HTTPSMS_FROM_PHONE', '');

    if (!this.apiKey) {
      this.logger.warn('⚠️ HTTPSMS_API_KEY not configured!');
    } else {
      this.logger.log(`✅ httpSMS initialized. From: ${this.fromPhone}`);
    }
  }

  // ==========================================
  // ✅ MAIN: Send SMS (with Rate Limiting)
  // ==========================================
  async sendSms(phoneNumber: string, message: string, opts?: { type?: string; limitPerMin?: number }): Promise<boolean> {
    const type = opts?.type ?? 'GENERIC';
    const limit = opts?.limitPerMin ?? 3;

    const rateLimit = await this.redis.checkSmsRateLimit(phoneNumber, limit, type);

    if (!rateLimit.allowed) {
      this.logger.warn(
        `⚠️ Rate limit exceeded for ${phoneNumber} type=${type}. Remaining: ${rateLimit.remaining}. Resets in ${rateLimit.resetIn}s.`,
      );
      return false;
    }

    this.logger.log(`Rate limit OK: ${phoneNumber} - ${rateLimit.remaining} remaining`);

    // WhatsApp link qo'shish (birinchi SMS da)
    const isFirst = await this.redis.isFirstSms(phoneNumber);
    if (isFirst) {
      const rawPhone = this.configService.get<string>('WHATSAPP_BOT_PHONE', '');
      if (rawPhone) {
        const botPhone = rawPhone.replace(/\D/g, '').replace(/^0+/, '');
        const fullPhone = botPhone.startsWith('996') ? botPhone : `996${botPhone}`;
        message += `\n\nДля получения уведомлений через WhatsApp:\nhttps://wa.me/${fullPhone}?text=Start`;
      }
    }

    if (!this.apiKey || !this.fromPhone) {
      this.logger.error('❌ httpSMS not configured (HTTPSMS_API_KEY or HTTPSMS_FROM_PHONE missing)');
      return false;
    }

    // Daily counter reset
    const now = new Date();
    if (
      now.getDate() !== this.lastReset.getDate() ||
      now.getMonth() !== this.lastReset.getMonth()
    ) {
      this.dailyCount = 0;
      this.lastReset = now;
    }

    // Telefon raqamni +998... formatga o'tkazish
    const toPhone = this.normalizePhone(phoneNumber);

    try {
      await axios.post(
        this.apiUrl,
        {
          from: this.fromPhone,
          to: toPhone,
          content: message,
        },
        {
          headers: {
            'x-api-key': this.apiKey,
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        },
      );

      this.dailyCount++;
      await this.redis.incrementTodaySms();

      this.logger.log(`✅ SMS sent to ${toPhone} via httpSMS (daily: ${this.dailyCount})`);
      return true;
    } catch (error) {
      this.logger.error(
        `❌ Failed to send SMS to ${toPhone}:`,
        error?.response?.data || error.message,
      );
      return false;
    }
  }

  // ==========================================
  // ✅ Telefon raqamni normalize qilish
  // ==========================================
  private normalizePhone(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    if (phone.startsWith('+')) return phone;
    if (digits.startsWith('998')) return `+${digits}`;
    if (digits.length === 9) return `+998${digits}`;
    return `+${digits}`;
  }

  // ==========================================
  // ✅ CHECK-IN SMS (RUS TILI)
  // ==========================================
  buildCheckInMessage(params: {
    parentName: string;
    studentName: string;
    time: string;
    isLate: boolean;
    lateMinutes?: number;
  }): string {
    const { parentName, studentName, time, isLate, lateMinutes } = params;

    const date = new Date().toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });

    if (isLate && lateMinutes) {
      return (
        `Здравствуйте, уважаемый(ая) ${parentName}!\n\n` +
        `Ваш ребёнок: ${studentName}\n` +
        `Прибыл в школу: ${time}\n` +
        `Опоздание: ${lateMinutes} мин\n` +
        `Дата: ${date}\n\n` +
        `Администрация школы.`
      );
    }

    return (
      `Здравствуйте, уважаемый(ая) ${parentName}!\n\n` +
      `Ваш ребёнок: ${studentName}\n` +
      `Прибыл в школу: ${time}\n` +
      `Дата: ${date}\n\n` +
      `Администрация школы.`
    );
  }

  // ==========================================
  // ✅ CHECK-OUT SMS (RUS TILI)
  // ==========================================
  buildCheckOutMessage(params: {
    parentName: string;
    studentName: string;
    checkInTime: string;
    checkOutTime: string;
  }): string {
    const { parentName, studentName, checkInTime, checkOutTime } = params;

    const date = new Date().toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });

    return (
      `Здравствуйте, уважаемый(ая) ${parentName}!\n\n` +
      `Ваш ребёнок: ${studentName}\n` +
      `Покинул школу: ${checkOutTime}\n` +
      `Пришёл: ${checkInTime}\n` +
      `Дата: ${date}\n\n` +
      `Администрация школы.`
    );
  }

  // ==========================================
  // ✅ STATISTICS (Redis'dan)
  // ==========================================
  async getTodaySmsCount(): Promise<number> {
    return await this.redis.getTodaySmsCount();
  }

  async getSmsRateLimitStatus(phone: string): Promise<{
    count: number;
    remaining: number;
    resetIn: number;
  }> {
    const count = await this.redis.getSmsCount(phone);
    const ttl = await this.redis.ttl(`sms:limit:${phone}`);

    return {
      count,
      remaining: Math.max(0, 3 - count),
      resetIn: ttl > 0 ? ttl : 0,
    };
  }

  // ==========================================
  // ✅ Gateway status
  // ==========================================
  async getStatus() {
    const todayTotal = await this.getTodaySmsCount();

    return {
      provider: 'httpSMS',
      fromPhone: this.fromPhone,
      configured: !!this.apiKey,
      todayTotal,
      dailyCount: this.dailyCount,
    };
  }
}
