// src/notifications/telegram.service.ts - ПОЛНОСТЬЮ НА РУССКОМ

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Telegraf, Context, Markup } from 'telegraf';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private bot: Telegraf;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {
    const token = this.configService.get('TELEGRAM_BOT_TOKEN');
    if (token) {
      this.bot = new Telegraf(token);
      this.setupBot();
      this.logger.log('Telegram bot initialized');
    } else {
      this.logger.warn('TELEGRAM_BOT_TOKEN not found - bot disabled');
    }
  }

  private setupBot() {
    // ==========================================
    // /start
    // ==========================================
    this.bot.command('start', async (ctx) => {
      const telegramId = ctx.from.id.toString();
      const chatId = ctx.chat.id.toString();

      await ctx.reply(
        '👋 Здравствуйте!\n\n' +
        'Добро пожаловать в официальный бот посещаемости!\n\n' +
        'Для регистрации выберите роль:',
        Markup.inlineKeyboard([
          [Markup.button.callback('👨‍👩‍👧 Родитель', 'role_parent')],
          [Markup.button.callback('👨‍🏫 Учитель', 'role_teacher')],
          [Markup.button.callback('👔 Директор', 'role_director')],
        ]),
      );

      await this.createSession(chatId, telegramId, 'WAITING_ROLE_SELECTION');
    });

    // ==========================================
    // CALLBACK QUERIES (BUTTON CLICKS)
    // ==========================================
    this.bot.on('callback_query', async (ctx) => {
      try {
        const data = (ctx.callbackQuery as any).data;
        const chatId = ctx.chat.id.toString();
        const telegramId = ctx.from.id.toString();

        await ctx.answerCbQuery();

        const session = await this.getSession(chatId);

        if (data.startsWith('role_')) {
          await this.handleRoleCallback(ctx, data, chatId, telegramId);
        }
        else if (data === 'parent_today') {
          await this.handleParentToday(ctx, telegramId);
        }
        else if (data === 'parent_week') {
          await this.handleParentWeek(ctx, telegramId);
        }
        else if (data === 'parent_class_teacher') {
          await this.handleClassTeacherContact(ctx, telegramId);
        }
        else if (data === 'parent_school') {
          await this.handleSchoolContact(ctx, telegramId);
        }
        else if (data === 'parent_help') {
          await ctx.editMessageText(this.getParentHelp());
        }
        else if (data === 'parent_menu') {
          await this.showParentMenu(ctx);
        }
        else if (data === 'teacher_today') {
          const message = await this.getTeacherTodayReport(telegramId);
          await ctx.editMessageText(message);
        }
        else if (data === 'teacher_week') {
          const message = await this.getTeacherWeekReport(telegramId);
          await ctx.editMessageText(message);
        }
        else if (data === 'teacher_month') {
          const message = await this.getTeacherMonthReport(telegramId);
          await ctx.editMessageText(message);
        }

      } catch (error) {
        this.logger.error('Callback query error:', error);
        await ctx.answerCbQuery('Произошла ошибка');
      }
    });

    // ==========================================
    // TEXT MESSAGES
    // ==========================================
    this.bot.on('text', async (ctx) => {
      try {
        const text = ctx.message.text.trim();
        const chatId = ctx.chat.id.toString();
        const telegramId = ctx.from.id.toString();

        const session = await this.getSession(chatId);

        if (!session) {
          await ctx.reply('Пожалуйста, нажмите /start');
          return;
        }

        switch (session.state) {
          case 'WAITING_PARENT_PHONE':
            await this.handleParentPhone(ctx, text, chatId, telegramId);
            break;

          case 'WAITING_TEACHER_PHONE':
            await this.handleTeacherPhone(ctx, text, chatId, telegramId);
            break;

          case 'WAITING_DIRECTOR_PHONE':
            await this.handleDirectorPhone(ctx, text, chatId, telegramId);
            break;

          case 'VERIFIED_PARENT':
            await this.showParentMenu(ctx);
            break;

          case 'VERIFIED_TEACHER':
            await this.showTeacherMenu(ctx);
            break;

          case 'VERIFIED_DIRECTOR':
            await this.handleDirectorText(ctx, text, chatId, telegramId, session);
            break;

          default:
            await ctx.reply('Неизвестное состояние. Нажмите /start');
        }
      } catch (error) {
        this.logger.error('Error handling text:', error);
        await ctx.reply('Произошла ошибка.');
      }
    });

    // ==========================================
    // COMMANDS
    // ==========================================
    this.bot.command('menu', async (ctx) => {
      const session = await this.getSession(ctx.chat.id.toString());
      if (!session) {
        await ctx.reply('Пожалуйста, нажмите /start');
        return;
      }

      if (session.state === 'VERIFIED_PARENT') {
        await this.showParentMenu(ctx);
      } else if (session.state === 'VERIFIED_TEACHER') {
        await this.showTeacherMenu(ctx);
      } else if (session.state === 'VERIFIED_DIRECTOR') {
        await this.showDirectorMenu(ctx);
      }
    });

    this.bot.command('help', async (ctx) => {
      const session = await this.getSession(ctx.chat.id.toString());
      if (!session) {
        await ctx.reply('Пожалуйста, нажмите /start');
        return;
      }

      let help = '';
      if (session.state === 'VERIFIED_PARENT') help = this.getParentHelp();
      else if (session.state === 'VERIFIED_TEACHER') help = this.getTeacherHelp();
      else if (session.state === 'VERIFIED_DIRECTOR') help = this.getDirectorHelp();
      else help = 'Пожалуйста, нажмите /start';

      await ctx.reply(help);
    });

    // Start polling
    this.bot.launch();
    this.logger.log('Telegram bot started polling');

    // Graceful shutdown
    process.once('SIGINT', () => this.bot.stop('SIGINT'));
    process.once('SIGTERM', () => this.bot.stop('SIGTERM'));
  }

  // ==========================================
  // SESSION MANAGEMENT
  // ==========================================
  private async createSession(chatId: string, telegramId: string, state: string) {
    await this.prisma.telegramSession.upsert({
      where: { chatId },
      create: { chatId, telegramId, state },
      update: { telegramId, state, updatedAt: new Date() },
    });
  }

  private async getSession(chatId: string) {
    return this.prisma.telegramSession.findUnique({ where: { chatId } });
  }

  private async updateSession(chatId: string, state: string, data?: any) {
    await this.prisma.telegramSession.update({
      where: { chatId },
      data: { state, data, updatedAt: new Date() },
    });
  }

  // ==========================================
  // ROLE SELECTION (CALLBACK)
  // ==========================================
  private async handleRoleCallback(ctx: Context, data: string, chatId: string, telegramId: string) {
    if (data === 'role_parent') {
      await this.updateSession(chatId, 'WAITING_PARENT_PHONE');
      await ctx.editMessageText(
        '👨‍👩‍👧 РЕГИСТРАЦИЯ РОДИТЕЛЯ\n\n' +
        '📲 Отправьте ваш номер телефона:\n' +
        'Формат: +998901234567',
      );
    } else if (data === 'role_teacher') {
      await this.updateSession(chatId, 'WAITING_TEACHER_PHONE');
      await ctx.editMessageText(
        '👨‍🏫 РЕГИСТРАЦИЯ УЧИТЕЛЯ\n\n' +
        '📲 Отправьте ваш номер телефона:\n' +
        'Формат: +998901234567',
      );
    } else if (data === 'role_director') {
      await this.updateSession(chatId, 'WAITING_DIRECTOR_PHONE');
      await ctx.editMessageText(
        '👔 РЕГИСТРАЦИЯ ДИРЕКТОРА\n\n' +
        '📲 Отправьте ваш номер телефона:\n' +
        'Формат: +998901234567',
      );
    }
  }

  // ==========================================
  // PARENT MENU
  // ==========================================
  private async showParentMenu(ctx: Context) {
    const message =
      '📱 МЕНЮ РОДИТЕЛЯ\n\n' +
      'Выберите раздел:';

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('📊 Сегодняшняя посещаемость', 'parent_today')],
      [Markup.button.callback('📅 Статистика за неделю', 'parent_week')],
      [Markup.button.callback('👨‍🏫 Классный руководитель', 'parent_class_teacher')],
      [Markup.button.callback('🏫 Администрация школы', 'parent_school')],
      [Markup.button.callback('❓ Помощь', 'parent_help')],
    ]);

    if ((ctx as any).update?.callback_query) {
      await ctx.editMessageText(message, keyboard);
    } else {
      await ctx.reply(message, keyboard);
    }
  }

  // ==========================================
  // TEACHER MENU
  // ==========================================
  private async showTeacherMenu(ctx: Context) {
    const message = '👨‍🏫 МЕНЮ УЧИТЕЛЯ\n\nВыберите отчёт:';

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('📊 Сегодняшняя посещаемость', 'teacher_today')],
      [Markup.button.callback('📅 Недельный отчёт', 'teacher_week')],
      [Markup.button.callback('📆 Месячный отчёт', 'teacher_month')],
    ]);

    await ctx.reply(message, keyboard);
  }

  // ==========================================
  // DIRECTOR MENU
  // ==========================================
  private async showDirectorMenu(ctx: Context) {
    const message = '👔 МЕНЮ ДИРЕКТОРА';

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('🏫 Статистика школы', 'director_school')],
      [Markup.button.callback('📢 Отправить объявление', 'director_announce')],
    ]);

    await ctx.reply(message, keyboard);
  }

  // ==========================================
  // PARENT REGISTRATION
  // ==========================================
  private async handleParentPhone(ctx: Context, phone: string, chatId: string, telegramId: string) {
    if (!phone.match(/^\+998\d{9}$/)) {
      await ctx.reply('❌ Неправильный формат.\nФормат: +998901234567');
      return;
    }

    try {
      const parent = await this.prisma.parent.findFirst({
        where: { phone },
        include: { student: { include: { class: true } } },
      });

      if (!parent) {
        await ctx.reply(
          '❌ Номер телефона не найден в базе данных.\n\n' +
          'Пожалуйста, обратитесь в администрацию школы.',
        );
        return;
      }

      await this.prisma.parent.update({
        where: { id: parent.id },
        data: {
          telegramId,
          telegramChatId: chatId,
          telegramUsername: ctx.from.username || '',
          isTelegramActive: true,
        },
      });

      await this.updateSession(chatId, 'VERIFIED_PARENT', { parentId: parent.id });

      await ctx.reply(
        `✅ Регистрация прошла успешно!\n\n` +
        `👤 Ваш ребёнок: ${parent.student.firstName} ${parent.student.lastName}\n` +
        `📚 Класс: ${parent.student.class.grade}-${parent.student.class.section}\n` +
        `📱 Телефон: ${phone}\n\n` +
        `Теперь вы будете получать автоматические уведомления! ✅`,
      );

      await this.showParentMenu(ctx);
    } catch (error) {
      this.logger.error('Parent registration error:', error);
      await ctx.reply('❌ Произошла ошибка.');
    }
  }

  // ==========================================
  // PARENT ACTIONS
  // ==========================================
  private async handleParentToday(ctx: Context, telegramId: string) {
    try {
      const parent = await this.prisma.parent.findFirst({
        where: { telegramId },
        include: { student: true },
      });

      if (!parent) {
        await ctx.editMessageText('❌ Данные не найдены.');
        return;
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const attendance = await this.prisma.attendance.findFirst({
        where: {
          studentId: parent.student.id,
          date: { gte: today, lt: tomorrow },
        },
      });

      let message = `📊 СЕГОДНЯШНЯЯ ПОСЕЩАЕМОСТЬ\n📅 ${today.toLocaleDateString('ru-RU')}\n\n`;
      message += `👤 ${parent.student.firstName} ${parent.student.lastName}\n\n`;

      if (!attendance) {
        message += '❌ Сегодня не пришёл в школу';
      } else {
        const checkIn = attendance.checkInTime
          ? attendance.checkInTime.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
          : '-';
        const checkOut = attendance.checkOutTime
          ? attendance.checkOutTime.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
          : '-';

        message += `✅ Пришёл: ${checkIn}\n`;
        if (attendance.checkOutTime) {
          message += `🚪 Ушёл: ${checkOut}\n`;
        }
        if (attendance.lateMinutes && attendance.lateMinutes > 0) {
          message += `⏰ Опоздание: ${attendance.lateMinutes} мин\n`;
        }
      }

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('⬅️ Назад', 'parent_menu')],
      ]);

      await ctx.editMessageText(message, keyboard);
    } catch (error) {
      this.logger.error('Parent today error:', error);
      await ctx.editMessageText('❌ Произошла ошибка.');
    }
  }

  private async handleParentWeek(ctx: Context, telegramId: string) {
    try {
      const parent = await this.prisma.parent.findFirst({
        where: { telegramId },
        include: { student: true },
      });

      if (!parent) {
        await ctx.editMessageText('❌ Данные не найдены.');
        return;
      }

      const today = new Date();
      const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

      const attendances = await this.prisma.attendance.findMany({
        where: {
          studentId: parent.student.id,
          date: { gte: weekAgo, lte: today },
        },
        orderBy: { date: 'desc' },
      });

      let message = `📅 ЗА ЭТУ НЕДЕЛЮ (7 дней)\n\n`;
      message += `👤 ${parent.student.firstName} ${parent.student.lastName}\n\n`;

      const present = attendances.filter(a => a.status === 'PRESENT' || a.status === 'LATE').length;
      const late = attendances.filter(a => a.status === 'LATE').length;
      const totalLateMinutes = attendances.reduce((sum, a) => sum + (a.lateMinutes || 0), 0);

      message += `✅ Присутствовал: ${present}/7 дней\n`;
      message += `⏰ Опоздал: ${late} раз\n`;
      if (totalLateMinutes > 0) {
        message += `⏱️ Всего опозданий: ${totalLateMinutes} мин\n`;
      }

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('⬅️ Назад', 'parent_menu')],
      ]);

      await ctx.editMessageText(message, keyboard);
    } catch (error) {
      this.logger.error('Parent week error:', error);
      await ctx.editMessageText('❌ Произошла ошибка.');
    }
  }

  private async handleClassTeacherContact(ctx: Context, telegramId: string) {
    try {
      const parent = await this.prisma.parent.findFirst({
        where: { telegramId },
        include: {
          student: {
            include: {
              class: {
                include: {
                  teacherClasses: {
                    include: { teacher: true },
                    take: 1,
                  },
                },
              },
            },
          },
        },
      });

      if (!parent) {
        await ctx.editMessageText('❌ Данные не найдены.');
        return;
      }

      let message = `👨‍🏫 КЛАССНЫЙ РУКОВОДИТЕЛЬ\n\n`;

      const classTeacher = parent.student.class.teacherClasses[0]?.teacher;

      if (classTeacher) {
        message += `Имя: ${classTeacher.firstName} ${classTeacher.lastName}\n`;
        message += `📞 Телефон: ${classTeacher.phone}\n\n`;
        message += `Для связи позвоните по телефону.`;
      } else {
        message += `❌ Классный руководитель ещё не назначен.\n\n`;
        message += `Обратитесь в администрацию школы.`;
      }

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('⬅️ Назад', 'parent_menu')],
      ]);

      await ctx.editMessageText(message, keyboard);
    } catch (error) {
      this.logger.error('Class teacher contact error:', error);
      await ctx.editMessageText('❌ Произошла ошибка.');
    }
  }

  private async handleSchoolContact(ctx: Context, telegramId: string) {
    try {
      const parent = await this.prisma.parent.findFirst({
        where: { telegramId },
        include: {
          student: {
            include: { school: true },
          },
        },
      });

      if (!parent) {
        await ctx.editMessageText('❌ Данные не найдены.');
        return;
      }

      const school = parent.student.school;

      let message = `🏫 АДМИНИСТРАЦИЯ ШКОЛЫ\n\n`;
      message += `${school.name}\n\n`;
      if (school.phone) {
        message += `📞 Телефон: ${school.phone}\n`;
      }
      if (school.address) {
        message += `📍 Адрес: ${school.address}\n`;
      }

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('⬅️ Назад', 'parent_menu')],
      ]);

      await ctx.editMessageText(message, keyboard);
    } catch (error) {
      this.logger.error('School contact error:', error);
      await ctx.editMessageText('❌ Произошла ошибка.');
    }
  }

  // ==========================================
  // TEACHER REGISTRATION
  // ==========================================
  private async handleTeacherPhone(ctx: Context, phone: string, chatId: string, telegramId: string) {
    if (!phone.match(/^\+998\d{9}$/)) {
      await ctx.reply('❌ Неправильный формат.\nФормат: +998901234567');
      return;
    }

    try {
      const teacher = await this.prisma.teacher.findFirst({
        where: { phone },
        include: {
          teacherClasses: {
            include: { class: true },
          },
        },
      });

      if (!teacher) {
        await ctx.reply('❌ Номер телефона не найден в базе данных.');
        return;
      }

      await this.prisma.teacher.update({
        where: { id: teacher.id },
        data: {
          telegramId,
          telegramChatId: chatId,
          telegramUsername: ctx.from.username || '',
          isTelegramActive: true,
        },
      });

      await this.updateSession(chatId, 'VERIFIED_TEACHER', { teacherId: teacher.id });

      const classes = teacher.teacherClasses
        .map(tc => `${tc.class.grade}-${tc.class.section}`)
        .join(', ');

      await ctx.reply(
        `✅ Регистрация прошла успешно!\n\n` +
        `👨‍🏫 Имя: ${teacher.firstName} ${teacher.lastName}\n` +
        `📚 Ваши классы: ${classes || 'Ещё не назначены'}\n\n` +
        `Помощь: /menu`,
      );

      await this.showTeacherMenu(ctx);
    } catch (error) {
      this.logger.error('Teacher registration error:', error);
      await ctx.reply('❌ Произошла ошибка.');
    }
  }

  // ==========================================
  // DIRECTOR REGISTRATION
  // ==========================================
  private async handleDirectorPhone(ctx: Context, phone: string, chatId: string, telegramId: string) {
    if (!phone.match(/^\+998\d{9}$/)) {
      await ctx.reply('❌ Неправильный формат.\nФормат: +998901234567');
      return;
    }

    try {
      const director = await this.prisma.director.findFirst({
        where: { phone },
        include: { school: true },
      });

      if (!director) {
        await ctx.reply('❌ Номер телефона не найден в базе данных.');
        return;
      }

      await this.prisma.director.update({
        where: { id: director.id },
        data: {
          telegramId,
          telegramChatId: chatId,
          telegramUsername: ctx.from.username || '',
          isTelegramActive: true,
        },
      });

      await this.updateSession(chatId, 'VERIFIED_DIRECTOR', { directorId: director.id });

      await ctx.reply(
        `✅ Регистрация прошла успешно!\n\n` +
        `👔 Имя: ${director.firstName} ${director.lastName}\n` +
        `🏫 Школа: ${director.school.name}\n\n` +
        `Помощь: /menu`,
      );
    } catch (error) {
      this.logger.error('Director registration error:', error);
      await ctx.reply('❌ Произошла ошибка.');
    }
  }

  // ==========================================
  // TEACHER REPORTS
  // ==========================================
  private async getTeacherTodayReport(telegramId: string): Promise<string> {
    try {
      const teacher = await this.prisma.teacher.findFirst({
        where: { telegramId },
        include: {
          teacherClasses: {
            include: {
              class: {
                include: { students: true },
              },
            },
          },
        },
      });

      if (!teacher || teacher.teacherClasses.length === 0) {
        return '❌ Вам не назначены классы.';
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      let message = `📊 СЕГОДНЯШНЯЯ ПОСЕЩАЕМОСТЬ\n📅 ${today.toLocaleDateString('ru-RU')}\n\n`;

      for (const tc of teacher.teacherClasses) {
        const cls = tc.class;
        const studentIds = cls.students.map(s => s.id);

        const attendances = await this.prisma.attendance.findMany({
          where: {
            date: { gte: today, lt: tomorrow },
            studentId: { in: studentIds },
          },
        });

        const present = attendances.filter(a => a.status === 'PRESENT' || a.status === 'LATE').length;
        const late = attendances.filter(a => a.status === 'LATE').length;
        const absent = cls.students.length - attendances.length;

        message += `📚 ${cls.grade}-${cls.section} (${cls.students.length} уч.)\n`;
        message += `✅ Пришли: ${present}\n`;
        message += `⏰ Опоздали: ${late}\n`;
        message += `❌ Отсутствуют: ${absent}\n\n`;
      }

      return message;
    } catch (error) {
      this.logger.error('Teacher today report error:', error);
      return '❌ Ошибка при получении отчёта.';
    }
  }

  private async getTeacherWeekReport(telegramId: string): Promise<string> {
    try {
      const teacher = await this.prisma.teacher.findFirst({
        where: { telegramId },
        include: {
          teacherClasses: {
            include: {
              class: {
                include: { students: true },
              },
            },
          },
        },
      });

      if (!teacher || teacher.teacherClasses.length === 0) {
        return '❌ Вам не назначены классы.';
      }

      const today = new Date();
      const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

      let message = `📊 НЕДЕЛЬНАЯ ПОСЕЩАЕМОСТЬ (7 дней)\n\n`;

      for (const tc of teacher.teacherClasses) {
        const cls = tc.class;
        const studentIds = cls.students.map(s => s.id);

        const attendances = await this.prisma.attendance.findMany({
          where: {
            date: { gte: weekAgo, lte: today },
            studentId: { in: studentIds },
          },
        });

        const present = attendances.filter(a => a.status === 'PRESENT' || a.status === 'LATE').length;
        const late = attendances.filter(a => a.status === 'LATE').length;
        const total = attendances.length;
        const rate = total > 0 ? ((present / total) * 100).toFixed(1) : '0';

        message += `📚 ${cls.grade}-${cls.section}:\n`;
        message += `✅ Пришли: ${present}\n`;
        message += `⏰ Опоздали: ${late}\n`;
        message += `📊 Посещаемость: ${rate}%\n\n`;
      }

      return message;
    } catch (error) {
      this.logger.error('Teacher week report error:', error);
      return '❌ Ошибка при получении отчёта.';
    }
  }

  private async getTeacherMonthReport(telegramId: string): Promise<string> {
    try {
      const teacher = await this.prisma.teacher.findFirst({
        where: { telegramId },
        include: {
          teacherClasses: {
            include: {
              class: {
                include: { students: true },
              },
            },
          },
        },
      });

      if (!teacher || teacher.teacherClasses.length === 0) {
        return '❌ Вам не назначены классы.';
      }

      const today = new Date();
      const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

      let message = `📊 МЕСЯЧНАЯ ПОСЕЩАЕМОСТЬ (30 дней)\n\n`;

      for (const tc of teacher.teacherClasses) {
        const cls = tc.class;
        const studentIds = cls.students.map(s => s.id);

        const attendances = await this.prisma.attendance.findMany({
          where: {
            date: { gte: monthAgo, lte: today },
            studentId: { in: studentIds },
          },
        });

        const present = attendances.filter(a => a.status === 'PRESENT' || a.status === 'LATE').length;
        const late = attendances.filter(a => a.status === 'LATE').length;
        const total = attendances.length;
        const rate = total > 0 ? ((present / total) * 100).toFixed(1) : '0';

        message += `📚 ${cls.grade}-${cls.section}:\n`;
        message += `✅ Пришли: ${present}\n`;
        message += `⏰ Опоздали: ${late}\n`;
        message += `📊 Посещаемость: ${rate}%\n\n`;
      }

      return message;
    } catch (error) {
      this.logger.error('Teacher month report error:', error);
      return '❌ Ошибка при получении отчёта.';
    }
  }

  private async handleDirectorText(ctx: Context, text: string, chatId: string, telegramId: string, session: any) {
    await ctx.reply('Команды: /menu');
  }

  // ==========================================
  // HELP MESSAGES
  // ==========================================
  private getParentHelp(): string {
    return (
      `🤖 ПОМОЩЬ ДЛЯ РОДИТЕЛЕЙ\n\n` +
      `📊 Сегодняшняя посещаемость - посещаемость вашего ребёнка сегодня\n` +
      `📅 За эту неделю - недельная статистика\n` +
      `👨‍🏫 Классный руководитель - связь с учителем\n` +
      `🏫 Школа - контактная информация школы\n\n` +
      `Автоматические уведомления:\n` +
      `• Пришёл/ушёл из школы\n` +
      `• Об опозданиях\n` +
      `• Напоминания об оплате\n\n` +
      `Команды:\n` +
      `/menu - Главное меню\n` +
      `/help - Помощь`
    );
  }

  private getTeacherHelp(): string {
    return (
      `🤖 ПОМОЩЬ ДЛЯ УЧИТЕЛЕЙ\n\n` +
      `📊 Сегодняшняя посещаемость\n` +
      `📅 Недельный отчёт\n` +
      `📆 Месячный отчёт\n\n` +
      `Команды:\n` +
      `/menu - Главное меню\n` +
      `/help - Помощь`
    );
  }

  private getDirectorHelp(): string {
    return (
      `🤖 ПОМОЩЬ ДЛЯ ДИРЕКТОРА\n\n` +
      `🏫 Статистика школы\n` +
      `📢 Отправить объявление\n\n` +
      `Команды:\n` +
      `/menu - Главное меню\n` +
      `/help - Помощь`
    );
  }

  // ==========================================
  // PUBLIC METHODS
  // ==========================================
  async sendMessage(chatId: string, message: string) {
    if (!this.bot) {
      throw new Error('Telegram bot not initialized');
    }

    try {
      await this.bot.telegram.sendMessage(chatId, message, { parse_mode: 'HTML' });
      return { success: true };
    } catch (error) {
      this.logger.error(`Failed to send message to ${chatId}:`, error);
      throw error;
    }
  }


  async sendPhotoFromBase64(chatId: string, photoBase64: string, caption: string) {
    if (!this.bot) {
      throw new Error('Telegram bot not initialized');
    }

    try {
      let cleanBase64 = photoBase64;

      if (photoBase64.includes('data:image')) {
        const base64Parts = photoBase64.split(',');
        if (base64Parts.length > 1) {
          cleanBase64 = base64Parts[1];
        }
      }

      const buffer = Buffer.from(cleanBase64, 'base64');

      if (buffer.length === 0) {
        throw new Error('Invalid or empty image data');
      }

      await this.bot.telegram.sendPhoto(
        chatId,
        { source: buffer },
        { caption: caption, parse_mode: 'HTML' },
      );

      this.logger.log(`Photo sent to chat ${chatId}`);
      return { success: true };
    } catch (error) {
      this.logger.error(`Failed to send photo to ${chatId}:`, error);

      try {
        await this.sendMessage(chatId, caption);
        this.logger.log(`Sent text-only message as fallback to ${chatId}`);
        return { success: true, fallback: true };
      } catch (fallbackError) {
        this.logger.error(`Fallback also failed:`, fallbackError);
        throw error;
      }
    }
  }
}