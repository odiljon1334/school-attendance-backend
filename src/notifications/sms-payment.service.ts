// src/notifications/sms-payment.service.ts - SMS TO'LOV CRON JOB

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from './sms.service';
import { TelegramService } from './telegram.service';

@Injectable()
export class SmsPaymentService {
  private readonly logger = new Logger(SmsPaymentService.name);

  constructor(
    private prisma: PrismaService,
    private smsService: SmsService,
    private telegramService: TelegramService,
  ) {}

  // ==========================================
  // ✅ KUNLIK TEKSHIRUV - Har kuni 09:00
  // ==========================================
  @Cron('0 9 * * *', { name: 'sms-payment-check' })
  async checkSmsPaymentStatus() {
    this.logger.log('🔄 Starting SMS payment check...');

    try {
      await this.sendExpiryReminders();
      await this.disableExpiredSubscriptions();
      this.logger.log('✅ SMS payment check completed');
    } catch (error) {
      this.logger.error('❌ SMS payment check failed:', error);
    }
  }

  // ==========================================
  // ✅ ESLATMA YUBORISH (3 kun oldin)
  // ==========================================
  private async sendExpiryReminders() {
    const now = new Date();
    const threeDaysLater = new Date(now);
    threeDaysLater.setDate(threeDaysLater.getDate() + 3);
    threeDaysLater.setHours(23, 59, 59, 999);

    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    // 3 kun ichida muddati tugaydigan studentlar
    const studentsNearExpiry = await this.prisma.student.findMany({
      where: {
        isSmsEnabled: true,
        smsPaidUntil: {
          gte: tomorrow,           // Kamida ertadan boshlab
          lte: threeDaysLater,     // 3 kungacha
        },
        smsReminderSent: false,    // Hali eslatma yuborilmagan
      },
      include: {
        parents: true,
        class: true,
      },
    });

    this.logger.log(`📧 Found ${studentsNearExpiry.length} students near SMS expiry`);

    for (const student of studentsNearExpiry) {
      try {
        const daysLeft = Math.ceil(
          (student.smsPaidUntil.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
        );

        await this.sendReminderNotification(student, daysLeft);

        // Eslatma yuborilgan deb belgilash
        await this.prisma.student.update({
          where: { id: student.id },
          data:  { smsReminderSent: true },
        });

        this.logger.log(
          `✅ Reminder sent: ${student.firstName} ${student.lastName} (${daysLeft} days left)`
        );
      } catch (error) {
        this.logger.error(
          `❌ Failed to send reminder for ${student.firstName} ${student.lastName}:`,
          error.message
        );
      }
    }
  }

  // ==========================================
  // ✅ MUDDATI TUGAGAN STUDENTLARNI O'CHIRISH
  // ==========================================
  private async disableExpiredSubscriptions() {
    const now = new Date();

    // Muddati tugagan lekin hali enabled bo'lgan studentlar
    const expiredStudents = await this.prisma.student.findMany({
      where: {
        isSmsEnabled: true,
        smsPaidUntil: {
          lt: now, // Muddati o'tgan
        },
      },
      include: {
        parents: true,
        class: true,
      },
    });

    this.logger.log(`🔴 Found ${expiredStudents.length} expired SMS subscriptions`);

    for (const student of expiredStudents) {
      try {
        // SMS xizmatini o'chirish
        await this.prisma.student.update({
          where: { id: student.id },
          data: {
            isSmsEnabled: false,
            smsReminderSent: false, // Keyingi oy uchun reset
          },
        });

        // Ota-onaga xabar berish
        await this.sendExpiredNotification(student);

        this.logger.log(
          `🔴 SMS disabled: ${student.firstName} ${student.lastName} (expired: ${student.smsPaidUntil})`
        );
      } catch (error) {
        this.logger.error(
          `❌ Failed to disable SMS for ${student.firstName} ${student.lastName}:`,
          error.message
        );
      }
    }
  }

  // ==========================================
  // ✅ ESLATMA XABARI YUBORISH
  // ==========================================
  private async sendReminderNotification(student: any, daysLeft: number) {
    const expiryDate = student.smsPaidUntil.toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });

    const message =
      `Уважаемые родители!\n\n` +
      `Срок действия SMS-уведомлений для вашего ребёнка ${student.firstName} ${student.lastName} ` +
      `истекает через ${daysLeft} ${this.getDaysWord(daysLeft)}.\n\n` +
      `Дата окончания: ${expiryDate}\n\n` +
      `Пожалуйста, продлите подписку, чтобы продолжать получать уведомления о посещаемости.\n\n` +
      `По вопросам оплаты обращайтесь в администрацию школы.\n\n` +
      `Администрация школы.`;

    for (const parent of student.parents || []) {
      try {
        // SMS
        if (parent.phone) {
          await this.smsService.sendSms(parent.phone, message);
          this.logger.log(`📧 Reminder SMS → ${parent.phone}`);
        }

        // Telegram
        if (parent.isTelegramActive && parent.telegramChatId) {
          await this.telegramService.sendMessage(parent.telegramChatId, message);
          this.logger.log(`📧 Reminder Telegram → ${parent.telegramChatId}`);
        }
      } catch (error) {
        this.logger.error(`Failed to send reminder to parent ${parent.id}:`, error.message);
      }
    }
  }

  // ==========================================
  // ✅ MUDDAT TUGAGAN XABARI
  // ==========================================
  private async sendExpiredNotification(student: any) {
    const message =
      `Уважаемые родители!\n\n` +
      `Срок действия SMS-уведомлений для вашего ребёнка ${student.firstName} ${student.lastName} истёк.\n\n` +
      `SMS-уведомления временно приостановлены.\n\n` +
      `Для возобновления уведомлений, пожалуйста, обратитесь в администрацию школы.\n\n` +
      `Администрация школы.`;

    for (const parent of student.parents || []) {
      try {
        // SMS (oxirgi marta yuboriladi)
        if (parent.phone) {
          await this.smsService.sendSms(parent.phone, message);
          this.logger.log(`🔴 Expiry SMS → ${parent.phone}`);
        }

        // Telegram
        if (parent.isTelegramActive && parent.telegramChatId) {
          await this.telegramService.sendMessage(parent.telegramChatId, message);
          this.logger.log(`🔴 Expiry Telegram → ${parent.telegramChatId}`);
        }
      } catch (error) {
        this.logger.error(`Failed to send expiry notice to parent ${parent.id}:`, error.message);
      }
    }
  }

  // ==========================================
  // ✅ HELPER: Kun so'zi (1 день, 2 дня, 5 дней)
  // ==========================================
  private getDaysWord(days: number): string {
    if (days === 1) return 'день';
    if (days >= 2 && days <= 4) return 'дня';
    return 'дней';
  }

  // ==========================================
  // ✅ MANUAL TRIGGER (test uchun)
  // ==========================================
  async manualCheckPaymentStatus() {
    this.logger.log('🔧 Manual SMS payment check triggered');
    await this.checkSmsPaymentStatus();
  }
}