import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import axios from 'axios';

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private readonly TELEGRAM_API_URL = 'https://api.telegram.org/bot';

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {}

  private getBotToken(): string {
    return this.configService.get<string>('TELEGRAM_BOT_TOKEN') || '';
  }

  // Send single message
  async sendMessage(chatId: string, message: string): Promise<boolean> {
    try {
      // Dev mode
      if (this.configService.get<string>('NODE_ENV') === 'development') {
        this.logger.log(
          `[TELEGRAM DEV MODE] ChatId: ${chatId}, Message: ${message}`,
        );
        return true;
      }

      const botToken = this.getBotToken();
      if (!botToken) {
        this.logger.warn('TELEGRAM_BOT_TOKEN is not set');
        return false;
      }

      const response = await axios.post(
        `${this.TELEGRAM_API_URL}${botToken}/sendMessage`,
        {
          chat_id: chatId,
          text: message,
          parse_mode: 'HTML',
        },
      );

      // TO'G'RI: any sifatida cast
      return (response.data as any)?.ok === true;
    } catch (error) {
      this.logger.error(`Failed to send Telegram message to ${chatId}`, error);
      return false;
    }
  }

  // Send bulk messages
  async sendMessageBulk(
    chatIds: string[],
    message: string,
  ): Promise<{ success: number; failed: number }> {
    const results = { success: 0, failed: 0 };

    for (const chatId of chatIds) {
      const success = await this.sendMessage(chatId, message);
      if (success) {
        results.success++;
      } else {
        results.failed++;
      }
    }

    return results;
  }

  // Get all telegram subscriptions for a school
  async getSubscriptions(schoolId?: string) {
    // TelegramSubscription jadvalini ishlatmasdan, to'g'ridan-to'g'ri Student jadvalidan olamiz
    const where: any = {};

    if (schoolId) {
      where.schoolId = schoolId;
    }

    where.isTelegramSubscribed = true;

    return this.prisma.student.findMany({
      where,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        telegramId: true,
        telegramChatId: true,
        isTelegramSubscribed: true,
      },
    });
  }
}
