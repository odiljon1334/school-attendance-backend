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

  /** Telegram/axios xatosidan qisqa matn oladi (butun error obyektini log qilmaslik uchun). */
  private getTelegramErrorMessage(error: unknown): string {
    const err = error as { response?: { data?: { description?: string }; status?: number } };
    if (err?.response?.data?.description) return err.response.data.description;
    if (err?.response?.status) return `HTTP ${err.response.status}`;
    return error instanceof Error ? error.message : 'Unknown error';
  }

  async sendMessage(chatId: string, message: string): Promise<boolean> {
    try {
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

      return (response.data as any)?.ok === true;
    } catch (error) {
      const msg = this.getTelegramErrorMessage(error);
      this.logger.warn(`Telegram sendMessage failed (chatId=${chatId}): ${msg}`);
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
