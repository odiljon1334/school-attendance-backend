import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Telegraf } from 'telegraf';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class TelegramService {
  private bot: Telegraf;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {
    const token = this.configService.get('TELEGRAM_BOT_TOKEN');
    if (token) {
      this.bot = new Telegraf(token);
      this.setupBot();
    }
  }

  private setupBot() {
    // Start command - parent registration
    this.bot.command('start', async (ctx) => {
      const telegramId = ctx.from.id.toString();
      const chatId = ctx.chat.id.toString();

      await ctx.reply(
        'Assalomu alaykum! 👋\n\n' +
        'Ota-ona sifatida ro\'yxatdan o\'tish uchun telefon raqamingizni yuboring:\n' +
        'Format: +998901234567',
      );

      // Save telegram info temporarily
      // Will be linked to parent when phone number is verified
    });

    // Handle phone number
    this.bot.on('text', async (ctx) => {
      const phone = ctx.message.text.trim();
      
      // Check if it's a phone number
      if (phone.match(/^\+998\d{9}$/)) {
        await this.linkParentWithPhone(
          phone,
          ctx.from.id.toString(),
          ctx.chat.id.toString(),
          ctx,
        );
      }
    });

    this.bot.launch();
  }

  private async linkParentWithPhone(
    phone: string,
    telegramId: string,
    chatId: string,
    ctx: any,
  ) {
    try {
      // Find parent by phone
      const parent = await this.prisma.parent.findUnique({
        where: { phone },
        include: {
          student: true,
        },
      });

      if (!parent) {
        await ctx.reply(
          '❌ Telefon raqam topilmadi.\n\n' +
          'Iltimos, maktab ma\'muriyati bilan bog\'laning.',
        );
        return;
      }

      // Update parent with telegram info
      await this.prisma.parent.update({
        where: { id: parent.id },
        data: {
          telegramId,
          telegramChatId: chatId,
          isTelegramActive: true,
        },
      });

      await ctx.reply(
        `✅ Muvaffaqiyatli bog'landingiz!\n\n` +
        `O'quvchi: ${parent.student.firstName} ${parent.student.lastName}\n` +
        `Telefon: ${phone}\n\n` +
        `Endi siz har kuni bolangiz haqida xabar olasiz.`,
      );
    } catch (error) {
      console.error('Error linking parent:', error);
      await ctx.reply(
        '❌ Xatolik yuz berdi. Iltimos, qaytadan urinib ko\'ring.',
      );
    }
  }

  // Send message to telegram chat
  async sendMessage(chatId: string, message: string) {
    if (!this.bot) {
      throw new Error('Telegram bot not initialized');
    }

    try {
      await this.bot.telegram.sendMessage(chatId, message);
      return { success: true };
    } catch (error) {
      console.error('Failed to send telegram message:', error);
      throw error;
    }
  }

  // Send message to multiple chats
  async sendBulkMessages(chatIds: string[], message: string) {
    const results = [];

    for (const chatId of chatIds) {
      try {
        await this.sendMessage(chatId, message);
        results.push({ chatId, success: true });
      } catch (error) {
        results.push({ chatId, success: false, error: error.message });
      }
    }

    return {
      total: chatIds.length,
      sent: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      details: results,
    };
  }

  // Get student with parent telegram info
  async getStudentWithParents(studentId: string) {
    return this.prisma.student.findUnique({
      where: { id: studentId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        telegramId: true, // FIXED: Student's own telegram (optional)
        parents: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            telegramId: true,
            telegramChatId: true, // FIXED: This is on Parent, not Student
            isTelegramActive: true,
          },
        },
      },
    });
  }

  // Send daily report to director
  async sendDailyReportToDirector(schoolId: string, date: Date) {
    const directors = await this.prisma.director.findMany({
      where: {
        schoolId,
        telegramId: { not: null },
      },
    });

    // Get attendance stats
    const attendances = await this.prisma.attendance.findMany({
      where: {
        schoolId,
        date,
      },
    });

    const teacherAttendance = attendances.filter(a => a.teacherId);
    const studentAttendance = attendances.filter(a => a.studentId);

    const teacherPresent = teacherAttendance.filter(
      a => a.status === 'PRESENT' || a.status === 'LATE',
    ).length;

    const studentPresent = studentAttendance.filter(
      a => a.status === 'PRESENT' || a.status === 'LATE',
    ).length;

    const message =
      `📊 Kunlik hisobot - ${date.toLocaleDateString('uz-UZ')}\n\n` +
      `O'qituvchilar:\n` +
      `Kelgan: ${teacherPresent}/${teacherAttendance.length}\n` +
      `Foiz: ${teacherAttendance.length > 0 ? ((teacherPresent / teacherAttendance.length) * 100).toFixed(1) : 0}%\n\n` +
      `O'quvchilar:\n` +
      `Kelgan: ${studentPresent}/${studentAttendance.length}\n` +
      `Foiz: ${studentAttendance.length > 0 ? ((studentPresent / studentAttendance.length) * 100).toFixed(1) : 0}%`;

    const results = [];

    for (const director of directors) {
      try {
        // Note: Director doesn't have telegramChatId in schema
        // You might need to add this field or use telegramId to get chatId
        if (director.telegramId) {
          await this.sendMessage(director.telegramId, message);
          results.push({ directorId: director.id, sent: true });
        }
      } catch (error) {
        console.error(`Failed to send report to director ${director.id}:`, error);
        results.push({ directorId: director.id, sent: false, error: error.message });
      }
    }

    return results;
  }
}