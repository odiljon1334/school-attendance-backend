import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService } from './telegram.service';

@Injectable()
export class NotificationsService {
  constructor(
    private prisma: PrismaService,
    private telegramService: TelegramService,
  ) {}

  // Get all notifications with filters
  async findAll(recipientId?: string, type?: string, isSent?: string) {
    const where: any = {};

    if (recipientId) where.recipientId = recipientId;
    if (type) where.type = type;
    if (isSent !== undefined) where.isSent = isSent === 'true';

    return this.prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  // Delete notification
  async remove(id: string) {
    await this.prisma.notification.delete({ where: { id } });
    return { message: 'Notification deleted successfully' };
  }

  // Send daily attendance notification to parents
  async sendDailyAttendanceToParents(schoolId: string, date: Date) {
    const attendances = await this.prisma.attendance.findMany({
      where: {
        schoolId,
        date,
        studentId: { not: null },
      },
      include: {
        student: {
          include: {
            parents: {
              where: {
                isTelegramActive: true, // FIXED: was isTelegramSubscribed
                telegramChatId: { not: null },
              },
            },
          },
        },
      },
    });

    const notifications = [];

    for (const attendance of attendances) {
      if (!attendance.student) continue;

      for (const parent of attendance.student.parents) {
        // FIXED: was isTelegramSubscribed
        if (parent.isTelegramActive && parent.telegramChatId) {
          const message = this.formatAttendanceMessage(
            attendance.student.firstName,
            attendance.student.lastName,
            attendance.status,
            attendance.checkInTime,
          );

          try {
            await this.telegramService.sendMessage(parent.telegramChatId, message);

            await this.prisma.notification.create({
              data: {
                recipientType: 'PARENT',
                recipientId: parent.id,
                type: 'ATTENDANCE',
                title: 'Kunlik davomat',
                message,
                sentVia: 'TELEGRAM',
                isSent: true,
                sentAt: new Date(),
              },
            });

            notifications.push({ parentId: parent.id, sent: true });
          } catch (error) {
            notifications.push({
              parentId: parent.id,
              sent: false,
              error: error.message,
            });
          }
        }
      }
    }

    return {
      total: notifications.length,
      sent: notifications.filter(n => n.sent).length,
      failed: notifications.filter(n => !n.sent).length,
    };
  }

  // Send payment reminders (3 days before due)
  async sendPaymentReminders() {
    const threeDaysFromNow = new Date();
    threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);
    threeDaysFromNow.setHours(0, 0, 0, 0);

    const nextDay = new Date(threeDaysFromNow);
    nextDay.setDate(nextDay.getDate() + 1);

    const upcomingPayments = await this.prisma.payment.findMany({
      where: {
        status: 'PENDING',
        dueDate: {
          gte: threeDaysFromNow,
          lt: nextDay,
        },
      },
      include: {
        student: {
          include: {
            parents: {
              where: {
                isTelegramActive: true, // FIXED: was isTelegramSubscribed
                telegramChatId: { not: null },
              },
            },
          },
        },
      },
    });

    const notifications = [];

    for (const payment of upcomingPayments) {
      for (const parent of payment.student.parents) {
        // FIXED: was isTelegramSubscribed
        if (parent.isTelegramActive && parent.telegramChatId) {
          const message = this.formatPaymentReminderMessage(
            payment.student.firstName,
            payment.student.lastName,
            payment.amount,
            payment.dueDate,
          );

          try {
            await this.telegramService.sendMessage(parent.telegramChatId, message);

            await this.prisma.notification.create({
              data: {
                recipientType: 'PARENT',
                recipientId: parent.id,
                type: 'PAYMENT',
                title: 'To\'lov eslatmasi',
                message,
                sentVia: 'TELEGRAM',
                isSent: true,
                sentAt: new Date(),
              },
            });

            notifications.push({ parentId: parent.id, paymentId: payment.id, sent: true });
          } catch (error) {
            notifications.push({
              parentId: parent.id,
              paymentId: payment.id,
              sent: false,
              error: error.message,
            });
          }
        }
      }
    }

    return {
      total: notifications.length,
      sent: notifications.filter(n => n.sent).length,
      failed: notifications.filter(n => !n.sent).length,
    };
  }

  // Send payment confirmation
  async sendPaymentConfirmation(paymentId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        student: {
          include: {
            parents: {
              where: {
                isTelegramActive: true, // FIXED: was isTelegramSubscribed
                telegramChatId: { not: null },
              },
            },
          },
        },
      },
    });

    if (!payment || !payment.paidDate) {
      return { sent: false, message: 'Payment not found or not paid' };
    }

    const notifications = [];

    for (const parent of payment.student.parents) {
      // FIXED: was isTelegramSubscribed
      if (parent.isTelegramActive && parent.telegramChatId) {
        const message = this.formatPaymentConfirmationMessage(
          payment.student.firstName,
          payment.student.lastName,
          payment.amount,
          payment.paidDate,
        );

        try {
          await this.telegramService.sendMessage(parent.telegramChatId, message);

          await this.prisma.notification.create({
            data: {
              recipientType: 'PARENT',
              recipientId: parent.id,
              type: 'PAYMENT',
              title: 'To\'lov tasdiqlandi',
              message,
              sentVia: 'TELEGRAM',
              isSent: true,
              sentAt: new Date(),
            },
          });

          notifications.push({ parentId: parent.id, sent: true });
        } catch (error) {
          notifications.push({
            parentId: parent.id,
            sent: false,
            error: error.message,
          });
        }
      }
    }

    return {
      total: notifications.length,
      sent: notifications.filter(n => n.sent).length,
      failed: notifications.filter(n => !n.sent).length,
    };
  }

  private formatAttendanceMessage(
    firstName: string,
    lastName: string,
    status: string,
    checkInTime?: Date,
  ): string {
    const name = `${firstName} ${lastName}`;
    const time = checkInTime
      ? checkInTime.toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' })
      : '';

    if (status === 'PRESENT') {
      return `✅ Bolangiz ${name} bugun maktabga keldi\nVaqt: ${time}`;
    } else if (status === 'LATE') {
      return `⚠️ Bolangiz ${name} bugun kech qoldi\nVaqt: ${time}`;
    } else {
      return `❌ Bolangiz ${name} bugun maktabga kelmadi`;
    }
  }

  private formatPaymentReminderMessage(
    firstName: string,
    lastName: string,
    amount: number,
    dueDate: Date,
  ): string {
    return (
      `⚠️ To'lov eslatmasi!\n\n` +
      `O'quvchi: ${firstName} ${lastName}\n` +
      `Miqdor: ${amount.toLocaleString()} so'm\n` +
      `Muddat: ${dueDate.toLocaleDateString('uz-UZ')}\n\n` +
      `3 kun qoldi!`
    );
  }

  private formatPaymentConfirmationMessage(
    firstName: string,
    lastName: string,
    amount: number,
    paidDate: Date,
  ): string {
    return (
      `✅ To'lov qabul qilindi!\n\n` +
      `O'quvchi: ${firstName} ${lastName}\n` +
      `Miqdor: ${amount.toLocaleString()} so'm\n` +
      `Sana: ${paidDate.toLocaleDateString('uz-UZ')}`
    );
  }
}