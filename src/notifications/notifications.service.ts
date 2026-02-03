import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from './sms.service';
import { TelegramService } from './telegram.service';
import {
  SendSmsDto,
  SendSmsBulkDto,
  SendTelegramDto,
  SendTelegramBulkDto,
  NotifyParentsDto,
  NotifyClassDto,
  NotifySchoolDto,
} from './dto/notification.dto';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private prisma: PrismaService,
    private smsService: SmsService,
    private telegramService: TelegramService,
  ) {}

  // ─── SMS ──────────────────────────────────────
  async sendSms(dto: SendSmsDto) {
    const success = await this.smsService.sendSms(dto.phone, dto.message);
    return {
      success,
      phone: dto.phone,
      message: success ? 'SMS sent successfully' : 'SMS sending failed',
    };
  }

  async sendSmsBulk(dto: SendSmsBulkDto) {
    const results = await this.smsService.sendSmsBulk(dto.phones, dto.message);
    return {
      ...results,
      total: dto.phones.length,
      message: `SMS sent: ${results.success} success, ${results.failed} failed`,
    };
  }

  async getSmsLogs(startDate?: string, endDate?: string) {
    return this.smsService.getSmsLogs(startDate, endDate);
  }

  // ─── TELEGRAM ─────────────────────────────────
  async sendTelegram(dto: SendTelegramDto) {
    const success = await this.telegramService.sendMessage(
      dto.chatId,
      dto.message,
    );
    return {
      success,
      chatId: dto.chatId,
      message: success ? 'Telegram message sent' : 'Telegram sending failed',
    };
  }

  async sendTelegramBulk(dto: SendTelegramBulkDto) {
    const results = await this.telegramService.sendMessageBulk(
      dto.chatIds,
      dto.message,
    );
    return {
      ...results,
      total: dto.chatIds.length,
      message: `Telegram sent: ${results.success} success, ${results.failed} failed`,
    };
  }

  // ─── NOTIFY PARENTS (Single student) ──────────
  async notifyParents(dto: NotifyParentsDto) {
    const { studentId, message, sendSms = true, sendTelegram = true } = dto;

    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      include: { parents: true },
    });

    if (!student) {
      throw new NotFoundException('Student not found');
    }

    const results = {
      sms: { success: 0, failed: 0, skipped: 0 },
      telegram: { success: 0, failed: 0, skipped: 0 },
      parents: student.parents.length,
    };

    for (const parent of student.parents) {
      // SMS qismi tuzatildi
      if (sendSms && parent.phone) {
        const ok = await this.smsService.sendSms(parent.phone, message);
        if (ok) results.sms.success++;
        else results.sms.failed++;
      } else {
        results.sms.skipped++;
      }

      // Telegram qismi tuzatildi
      if (
        sendTelegram &&
        parent.isTelegramSubscribed &&
        parent.telegramChatId
      ) {
        const ok = await this.telegramService.sendMessage(
          parent.telegramChatId,
          message,
        );
        if (ok) results.telegram.success++;
        else results.telegram.failed++;
      } else {
        results.telegram.skipped++;
      }
    }

    return results;
  }

  // ─── NOTIFY WHOLE CLASS parents ────────────────
  async notifyClass(dto: NotifyClassDto) {
    const { classId, message, sendSms = true, sendTelegram = true } = dto;

    const students = await this.prisma.student.findMany({
      where: { classId },
      include: { parents: true },
    });

    if (students.length === 0) {
      throw new NotFoundException('No students found in this class');
    }

    const results = {
      sms: { success: 0, failed: 0, skipped: 0 },
      telegram: { success: 0, failed: 0, skipped: 0 },
      studentsNotified: students.length,
    };

    for (const student of students) {
      for (const parent of student.parents) {
        if (sendSms && parent.phone) {
          const ok = await this.smsService.sendSms(parent.phone, message);
          if (ok) results.sms.success++;
          else results.sms.failed++;
        } else {
          results.sms.skipped++;
        }

        if (
          sendTelegram &&
          parent.isTelegramSubscribed &&
          parent.telegramChatId
        ) {
          const ok = await this.telegramService.sendMessage(
            parent.telegramChatId,
            message,
          );
          if (ok) results.telegram.success++;
          else results.telegram.failed++;
        } else {
          results.telegram.skipped++;
        }
      }
    }

    return results;
  }

  // ─── NOTIFY WHOLE SCHOOL parents ───────────────
  async notifySchool(dto: NotifySchoolDto) {
    const { schoolId, message, sendSms = true, sendTelegram = true } = dto;

    const students = await this.prisma.student.findMany({
      where: { schoolId },
      include: { parents: true },
    });

    if (students.length === 0) {
      throw new NotFoundException('No students found in this school');
    }

    const results = {
      sms: { success: 0, failed: 0, skipped: 0 },
      telegram: { success: 0, failed: 0, skipped: 0 },
      studentsNotified: students.length,
    };

    const notifiedPhones = new Set<string>();
    const notifiedChatIds = new Set<string>();

    for (const student of students) {
      for (const parent of student.parents) {
        // SMS (Deduplication tuzatildi)
        if (sendSms && parent.phone) {
          if (!notifiedPhones.has(parent.phone)) {
            notifiedPhones.add(parent.phone);
            const ok = await this.smsService.sendSms(parent.phone, message);
            if (ok) results.sms.success++;
            else results.sms.failed++;
          }
        } else if (sendSms) {
          results.sms.skipped++;
        }

        // Telegram (Deduplication tuzatildi)
        if (
          sendTelegram &&
          parent.isTelegramSubscribed &&
          parent.telegramChatId
        ) {
          if (!notifiedChatIds.has(parent.telegramChatId)) {
            notifiedChatIds.add(parent.telegramChatId);
            const ok = await this.telegramService.sendMessage(
              parent.telegramChatId,
              message,
            );
            if (ok) results.telegram.success++;
            else results.telegram.failed++;
          }
        } else if (sendTelegram) {
          results.telegram.skipped++;
        }
      }
    }

    return results;
  }

  // ─── AUTOMATIC NOTIFICATIONS ──────────────────
  async notifyLateArrival(studentId: string, lateMinutes: number) {
    const student = await this.getStudentForAutoNotify(studentId);
    if (!student) return;

    const message = this.formatMessage('Kech kelish bildirishnomasi', student, [
      `⏰ Kech kelish: <b>${lateMinutes} minut</b>`,
    ]);

    await this.notifyParents({
      studentId,
      message,
      sendSms: true,
      sendTelegram: true,
    });
  }

  async notifyAbsence(studentId: string) {
    const student = await this.getStudentForAutoNotify(studentId);
    if (!student) return;

    const message = this.formatMessage('Kelmaganlik bildirishnomasi', student, [
      `📝 Bugun o'quvchi maktabga kelmaganlik qaydnomasi tuzildi.`,
    ]);

    await this.notifyParents({
      studentId,
      message,
      sendSms: true,
      sendTelegram: true,
    });
  }

  async notifyPaymentOverdue(studentId: string, amount: number, type: string) {
    const student = await this.getStudentForAutoNotify(studentId);
    if (!student) return;

    const message = this.formatMessage("To'lov muddati o'tgan", student, [
      `📑 To'lov turi: <b>${type}</b>`,
      `💵 Summa: <b>${amount.toLocaleString()} so'm</b>`,
    ]);

    await this.notifyParents({
      studentId,
      message,
      sendSms: true,
      sendTelegram: true,
    });
  }

  // Private Helper Methods
  private async getStudentForAutoNotify(studentId: string) {
    return this.prisma.student.findUnique({
      where: { id: studentId },
      include: {
        school: { select: { name: true } },
        class: { select: { grade: true, section: true } },
      },
    });
  }

  private formatMessage(title: string, student: any, extraLines: string[]) {
    return (
      `⚠️ <b>${title}</b>\n` +
      `━━━━━━━━━━━━━━━━━━━\n` +
      `👤 O'quvchi: <b>${student.firstName} ${student.lastName}</b>\n` +
      `🏫 Maktab: <b>${student.school.name}</b>\n` +
      `📚 Sinf: <b>${student.class.grade}-${student.class.section}</b>\n` +
      extraLines.join('\n') +
      `\n` +
      `📅 Sana: <b>${new Date().toLocaleDateString('uz-UZ')}</b>`
    );
  }
}
