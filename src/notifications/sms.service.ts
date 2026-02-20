// src/notifications/sms.service.ts - WITH REDIS RATE LIMITING

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.service';
import axios from 'axios';

interface SmsGateway {
  url: string;
  username: string;
  password: string;
  dailyCount: number;
  lastReset: Date;
}

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private currentIndex = 0;
  private gateways: SmsGateway[] = [];

  constructor(
    private configService: ConfigService,
    private redis: RedisService,  // ← REDIS QO'SHILDI
  ) {
    this.initGateways();
  }

  private initGateways() {
    const gatewayUrls = this.configService
      .get<string>('SMS_GATEWAYS', 'http://localhost:8080')
      .split(',')
      .map(url => url.trim())
      .filter(Boolean);

    const username = this.configService.get<string>('SMS_GATEWAY_USER', 'admin');
    const password = this.configService.get<string>('SMS_GATEWAY_PASS', 'admin');

    this.gateways = gatewayUrls.map(url => ({
      url,
      username,
      password,
      dailyCount: 0,
      lastReset: new Date(),
    }));

    this.logger.log(`SMS Gateway initialized with ${this.gateways.length} device(s)`);
    this.gateways.forEach((g, i) => {
      this.logger.log(`  Device ${i + 1}: ${g.url}`);
    });
  }

  // ==========================================
  // ✅ MAIN: Send SMS (with Rate Limiting)
  // ==========================================
  async sendSms(phoneNumber: string, message: string): Promise<boolean> {
    // ✅ 1. Rate limit tekshiruvi (Redis)
    const rateLimit = await this.redis.checkSmsRateLimit(phoneNumber, 3); // Max 3 per minute

    if (!rateLimit.allowed) {
      this.logger.warn(
        `⚠️ Rate limit exceeded for ${phoneNumber}. ` +
        `Remaining: ${rateLimit.remaining}. ` +
        `Resets in ${rateLimit.resetIn}s.`
      );
      return false;
    }

    this.logger.log(
      `Rate limit OK: ${phoneNumber} - ${rateLimit.remaining} remaining`
    );

    // ✅ 2. Gateway tanlash
    if (this.gateways.length === 0) {
      this.logger.error('No SMS gateways configured!');
      return false;
    }

    const gateway = this.gateways[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.gateways.length;

    // Reset daily counter if new day
    const now = new Date();
    if (
      now.getDate() !== gateway.lastReset.getDate() ||
      now.getMonth() !== gateway.lastReset.getMonth()
    ) {
      gateway.dailyCount = 0;
      gateway.lastReset = now;
    }

    try {
      // ✅ 3. SMS yuborish
      await axios.post(
        `${gateway.url}/message`,
        {
          textMessage: { text: message },
          phoneNumbers: [phoneNumber],
        },
        {
          auth: {
            username: gateway.username,
            password: gateway.password,
          },
          timeout: 10000,
          headers: { 'Content-Type': 'application/json' },
        },
      );

      gateway.dailyCount++;

      // ✅ 4. Redis counter yangilash
      await this.redis.incrementTodaySms();

      this.logger.log(
        `✅ SMS sent to ${phoneNumber} via ${gateway.url} (daily: ${gateway.dailyCount})`
      );
      return true;
    } catch (error) {
      this.logger.error(
        `❌ Failed to send SMS to ${phoneNumber} via ${gateway.url}:`,
        error.message,
      );
      return await this.sendWithFallback(phoneNumber, message, gateway.url);
    }
  }

  // ==========================================
  // ✅ Fallback: boshqa gateway
  // ==========================================
  private async sendWithFallback(
    phoneNumber: string,
    message: string,
    failedUrl: string,
  ): Promise<boolean> {
    const otherGateways = this.gateways.filter(
      g => g.url !== failedUrl && g.dailyCount < 1000,
    );

    for (const gateway of otherGateways) {
      try {
        const response = await axios.post(
          `${gateway.url}/message`,
          { textMessage: { text: message }, phoneNumbers: [phoneNumber] },
          {
            auth: { username: gateway.username, password: gateway.password },
            timeout: 5000,
          },
        );

        if (response.status === 200) {
          gateway.dailyCount++;
          await this.redis.incrementTodaySms();
          this.logger.log(`✅ Fallback success: ${gateway.url}`);
          return true;
        }
      } catch (e) {
        this.logger.warn(`Fallback gateway ${gateway.url} ham ishlamadi.`);
      }
    }
    return false;
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
      remaining: Math.max(0, 3 - count), // Max 3 per minute
      resetIn: ttl > 0 ? ttl : 0,
    };
  }

  // ==========================================
  // ✅ Gateway status
  // ==========================================
  async getStatus() {
    const todayTotal = await this.getTodaySmsCount();

    return {
      todayTotal,
      gateways: this.gateways.map((g, i) => ({
        device: i + 1,
        url: g.url,
        dailyCount: g.dailyCount,
        lastReset: g.lastReset,
      })),
    };
  }
}