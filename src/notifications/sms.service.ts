// src/notifications/sms.service.ts - ANDROID SMS GATEWAY

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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

  constructor(private configService: ConfigService) {
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
  // ✅ MAIN: Send SMS (Round Robin)
  // ==========================================
  async sendSms(phoneNumber: string, message: string): Promise<boolean> {
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
      this.logger.log(
        `SMS sent to ${phoneNumber} via ${gateway.url} (daily: ${gateway.dailyCount})`
      );
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to send SMS to ${phoneNumber} via ${gateway.url}:`,
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
    const otherGateways = this.gateways.filter(g => g.url !== failedUrl);

    for (const gateway of otherGateways) {
      try {
        await axios.post(
          `${gateway.url}/message`,
          {
            textMessage: { text: message },
            phoneNumbers: [phoneNumber],
          },
          {
            auth: { username: gateway.username, password: gateway.password },
            timeout: 10000,
          },
        );
        gateway.dailyCount++;
        this.logger.log(`SMS sent via fallback gateway: ${gateway.url}`);
        return true;
      } catch {
        continue;
      }
    }

    this.logger.error(`All gateways failed for ${phoneNumber}`);
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
  // ✅ Gateway status
  // ==========================================
  getStatus() {
    return this.gateways.map((g, i) => ({
      device: i + 1,
      url: g.url,
      dailyCount: g.dailyCount,
      lastReset: g.lastReset,
    }));
  }
}