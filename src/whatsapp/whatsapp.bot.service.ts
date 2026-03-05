import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappService } from './whatsapp.service';
import { WhatsappStateService, WaSession, WaChild } from './whatsapp.state.service';
import { FreedomPayService } from 'src/payments/freedom-pay.service';
import { ConfigService } from '@nestjs/config';

// ─────────────────────────────────────────────────────────
// PHONE VALIDATION (Kyrgyzstan +996 | international)
// ─────────────────────────────────────────────────────────
function normalizePhone(raw: string): string | null {
  const s = raw.trim().replace(/[\s\-()]/g, '');
  if (!s) return null;

  const hasPlus = s.startsWith('+');
  const digits = s.replace(/[^\d]/g, '');

  if (digits.length < 9 || digits.length > 15) return null;

  // Local KG: 0XXXXXXXXX → +996XXXXXXXXX
  if (!hasPlus && digits.startsWith('0') && digits.length === 10) {
    return `+996${digits.slice(1)}`;
  }

  // Already country-coded
  if (hasPlus || digits.length >= 11) return `+${digits}`;

  return null;
}

function formatMoney(n: number): string {
  return Number(n || 0).toLocaleString('ru-RU') + ' сом';
}

@Injectable()
export class WhatsappBotService {
  private readonly logger = new Logger(WhatsappBotService.name);

  constructor(
    private prisma: PrismaService,
    private state: WhatsappStateService,
    private wa: WhatsappService,
    private balanceKg: FreedomPayService,         // ← QO'SHILDI
    private configService: ConfigService,
  ) {}

  // ─────────────────────────────────────────────────────────
  // MAIN ENTRY — каждое входящее сообщение обрабатывается здесь
  // ─────────────────────────────────────────────────────────
  async handleMessage(payload: any): Promise<void> {
    try {
      const messages: any[] = payload?.messages ?? [];

      for (const msg of messages) {
        // Только входящие, игнорируем собственные сообщения бота
        if (msg.from_me) continue;

        const chatId: string = msg.chat_id;          // "996XXXXXXX@s.whatsapp.net"
        const phone = this.wa.extractPhone(chatId);  // "+996XXXXXXX"

        // Текст сообщения или ответ на кнопку
        const text = this.extractText(msg);
        if (!text) continue;

        this.logger.log(`📩 WA: ${phone} → "${text}"`);

        // Индикатор печати
        await this.wa.sendTyping(phone);

        const session = await this.state.get(phone);
        await this.route(phone, text, session, msg);
      }
    } catch (err: any) {
      this.logger.error(`handleMessage error: ${err?.message}`);
    }
  }

  // ─────────────────────────────────────────────────────────
  // ROUTER — конечный автомат состояний
  // ─────────────────────────────────────────────────────────
  private async route(
    phone: string,
    text: string,
    session: WaSession | null,
    rawMsg: any,
  ): Promise<void> {
    const lower = text.toLowerCase().trim();

    // Универсальные команды (работают в любом состоянии)
    if (['привет', 'начать', 'start', 'menu', 'меню', 'hi', 'hello'].includes(lower)) {
      return this.startFlow(phone);
    }

    if (['отмена', 'cancel', '❌', 'назад', 'bekor', 'menyu', 'menu', 'меню'].includes(lower)) {
      await this.state.update(phone, { state: 'VERIFIED' });
      return this.showMainMenu(phone);
    }

    // Нет сессии — начать сначала
    if (!session) return this.startFlow(phone);

    switch (session.state) {
      case 'START':
      case 'WAITING_PHONE':
        return this.handlePhoneInput(phone, text, session);

      case 'VERIFIED':
        return this.handleVerifiedInput(phone, text, session, rawMsg);

      case 'SELECT_CHILD':
        return this.handleChildSelect(phone, text, session, rawMsg);

      case 'SELECT_PLAN':
        return this.handlePlanSelect(phone, text, session, rawMsg);

      case 'CONFIRM_PAYMENT':
        return this.handlePaymentConfirm(phone, text, session, rawMsg);

      default:
        return this.startFlow(phone);
    }
  }

  // ─────────────────────────────────────────────────────────
  // ШАГ 1: ПРИВЕТСТВИЕ
  // ─────────────────────────────────────────────────────────
  private async startFlow(phone: string): Promise<void> {
    // Qaytuvchi foydalanuvchi: whatsappPhone YOKI phone orqali topamiz
    const parent = await this.prisma.parent.findFirst({
      where: {
        OR: [
          { whatsappPhone: phone },
          { phone },
        ],
      },
      include: {
        students: {
          include: {
            student: { include: { class: true } },
          },
        },
      },
    });

    if (parent?.students?.length) {
      // Вернувшийся пользователь
      await this.state.update(phone, { state: 'VERIFIED', parentId: parent.id, phone });
      return this.showMainMenu(phone);
    }

    // Новый пользователь
    await this.state.update(phone, { state: 'WAITING_PHONE' });
    await this.wa.sendText(
      phone,
      `👋 Здравствуйте!\n\n` +
        `🏫 Добро пожаловать в систему оплаты школы!\n\n` +
        `Для регистрации введите ваш номер телефона:\n` +
        `Пример: +996700123456 или 0700123456`,
    );
  }

  // ─────────────────────────────────────────────────────────
  // ШАГ 2: ВЕРИФИКАЦИЯ ТЕЛЕФОНА
  // ─────────────────────────────────────────────────────────
  private async handlePhoneInput(
    phone: string,
    text: string,
    session: WaSession,
  ): Promise<void> {
    const normalized = normalizePhone(text);

    if (!normalized) {
      await this.wa.sendText(
        phone,
        `❌ Неверный формат номера телефона.\n\n` +
          `Допустимые форматы:\n• +996700123456\n• 0700123456`,
      );
      return;
    }

    try {
      // Очищаем старую привязку WhatsApp (если номер был у другого родителя)
      await this.prisma.parent.updateMany({
        where: { whatsappPhone: phone, phone: { not: normalized } },
        data: { whatsappPhone: null, isWhatsappActive: false },
      });

      const parent = await this.prisma.parent.findFirst({
        where: { phone: normalized },
        include: {
          students: {
            include: {
              student: {
                include: { class: true, school: true },
              },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      if (!parent) {
        await this.wa.sendText(
          phone,
          `❌ Номер телефона не найден в базе данных.\n\n` +
            `Пожалуйста, обратитесь в администрацию школы.`,
        );
        return;
      }

      if (!parent.students.length) {
        await this.wa.sendText(
          phone,
          `❌ К данному номеру не привязан ни один ученик.\n\n` +
            `Пожалуйста, обратитесь в администрацию школы.`,
        );
        return;
      }

      // Привязываем WhatsApp к родителю
      await this.prisma.parent.update({
        where: { id: parent.id },
        data: {
          whatsappPhone: phone,
          isWhatsappActive: true,
        },
      });

      // Формируем список детей
      const children = parent.students.map((sp) => {
        const s = sp.student;
        return {
          studentId: s.id,
          name: `${s.firstName} ${s.lastName}`.trim(),
          grade: s.class ? `${s.class.grade}-${s.class.section}` : '—',
          plan: s.billingPlan,
          amount: 0, // будет получено из платежей
          billingPaidUntil: s.billingPaidUntil ? s.billingPaidUntil.toISOString() : null,
        };
      });

      await this.state.update(phone, {
        state: 'VERIFIED',
        phone: normalized,
        parentId: parent.id,
        children,
      });

      const firstName = parent.firstName ?? 'Родитель';
      await this.wa.sendText(
        phone,
        `✅ *Регистрация прошла успешно!*\n\n` +
          `👤 ${firstName}\n` +
          `👨‍👩‍👧 Количество детей: ${children.length}\n\n` +
          `Теперь вы будете получать уведомления автоматически ✅`,
      );

      return this.showMainMenu(phone);
    } catch (err: any) {
      this.logger.error(`handlePhoneInput error: ${err?.message}`);
      await this.wa.sendText(phone, `❌ Произошла ошибка. Пожалуйста, попробуйте ещё раз.`);
    }
  }

  // ─────────────────────────────────────────────────────────
  // ГЛАВНОЕ МЕНЮ — List (7+ tugma bo'lgani uchun)
  // ─────────────────────────────────────────────────────────
  private async showMainMenu(phone: string): Promise<void> {
    await this.wa.sendList(
      phone,
      `Выберите нужный раздел:`,
      `Выбрать`,
      [
        {
          title: `📋 Посещаемость`,
          rows: [
            { id: 'today', title: `📊 Сегодняшняя посещаемость`, description: `Пришёл ли ребёнок сегодня?` },
            { id: 'week', title: `📅 Статистика за неделю`, description: `Последние 7 дней` },
          ],
        },
        {
          title: `💳 Оплата`,
          rows: [
            { id: 'pay', title: `💳 Оплатить`, description: `Через мобильный банкинг` },
            { id: 'payment_status', title: `📊 Статус платежей`, description: `Текущие платежи` },
          ],
        },
        {
          title: `📞 Информация`,
          rows: [
            { id: 'teacher', title: `👨‍🏫 Классный руководитель`, description: `Контакт учителя` },
            { id: 'school', title: `🏫 Школа`, description: `Контакт администрации` },
            { id: 'help', title: `❓ Помощь`, description: `Команды бота` },
          ],
        },
      ],
      `📱 ГЛАВНОЕ МЕНЮ`,
      `Нажмите для выбора`,
    );
  }

  // ─────────────────────────────────────────────────────────
  // СОСТОЯНИЕ VERIFIED — обработка кнопок и текста
  // ─────────────────────────────────────────────────────────
  private async handleVerifiedInput(
    phone: string,
    text: string,
    session: WaSession,
    rawMsg: any,
  ): Promise<void> {
    const id = this.extractButtonId(rawMsg) ?? text.toLowerCase().trim();

    switch (id) {
      case 'pay':
        return this.startPaymentFlow(phone, session);

      case 'payment_status':
      case 'status':
        return this.showPaymentStatus(phone, session);

      case 'today':
        return this.showTodayAttendance(phone, session);

      case 'week':
        return this.showWeekAttendance(phone, session);

      case 'teacher':
        return this.showTeacherContact(phone, session);

      case 'school':
        return this.showSchoolContact(phone, session);

      case 'help':
        return this.showHelp(phone);

      case 'back_menu':
        return this.showMainMenu(phone);

      default:
        return this.showMainMenu(phone);
    }
  }

  // ─────────────────────────────────────────────────────────
  // BUGUNGI DAVOMAT
  // ─────────────────────────────────────────────────────────
  private async showTodayAttendance(phone: string, session: WaSession): Promise<void> {
    if (!session.parentId) return this.startFlow(phone);

    const parent = await this.prisma.parent.findUnique({
      where: { id: session.parentId },
      include: {
        students: {
          include: { student: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!parent?.students?.length) {
      await this.wa.sendText(phone, `❌ Ma'lumot topilmadi.`);
      return this.showMainMenu(phone);
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    let msg = `📊 *СЕГОДНЯШНЯЯ ПОСЕЩАЕМОСТЬ*\n📅 ${today.toLocaleDateString('ru-RU')}\n\n`;

    for (const sp of parent.students) {
      const s = sp.student;
      const attendance = await this.prisma.attendance.findFirst({
        where: {
          studentId: s.id,
          date: { gte: today, lt: tomorrow },
        },
      });

      msg += `👤 *${s.firstName} ${s.lastName}*\n`;

      if (!attendance) {
        msg += `❌ Сегодня не пришёл в школу\n\n`;
      } else {
        const checkIn = attendance.checkInTime
          ? attendance.checkInTime.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
          : '—';
        const checkOut = attendance.checkOutTime
          ? attendance.checkOutTime.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
          : null;

        msg += `✅ Пришёл: ${checkIn}\n`;
        if (checkOut) msg += `🚪 Ушёл: ${checkOut}\n`;
        if (attendance.lateMinutes && attendance.lateMinutes > 0) {
          msg += `⏰ Опоздание: ${attendance.lateMinutes} мин\n`;
        }
        msg += `\n`;
      }
    }

    await this.wa.sendButtons(
      phone,
      msg.trim(),
      [{ id: 'week', title: `📅 За неделю` }, { id: 'back_menu', title: `⬅️ Назад` }],
      `📊 ПОСЕЩАЕМОСТЬ`,
    );
  }

  // ─────────────────────────────────────────────────────────
  // HAFTALIK STATISTIKA
  // ─────────────────────────────────────────────────────────
  private async showWeekAttendance(phone: string, session: WaSession): Promise<void> {
    if (!session.parentId) return this.startFlow(phone);

    const parent = await this.prisma.parent.findUnique({
      where: { id: session.parentId },
      include: {
        students: {
          include: { student: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!parent?.students?.length) {
      await this.wa.sendText(phone, `❌ Ma'lumot topilmadi.`);
      return this.showMainMenu(phone);
    }

    const today = new Date();
    const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

    let msg = `📅 *СТАТИСТИКА ЗА НЕДЕЛЮ* (7 дней)\n\n`;

    for (const sp of parent.students) {
      const s = sp.student;
      const attendances = await this.prisma.attendance.findMany({
        where: {
          studentId: s.id,
          date: { gte: weekAgo, lte: today },
        },
        orderBy: { date: 'desc' },
      });

      const present = attendances.filter((a) => a.status === 'PRESENT' || a.status === 'LATE').length;
      const late = attendances.filter((a) => a.status === 'LATE').length;
      const totalLate = attendances.reduce((sum, a) => sum + (a.lateMinutes || 0), 0);

      msg += `👤 *${s.firstName} ${s.lastName}*\n`;
      msg += `✅ Присутствовал: ${present}/7 дней\n`;
      msg += `⏰ Опоздал: ${late} раз\n`;
      if (totalLate > 0) msg += `⏱️ Всего опозданий: ${totalLate} мин\n`;
      msg += `\n`;
    }

    await this.wa.sendButtons(
      phone,
      msg.trim(),
      [{ id: 'today', title: `📊 Сегодня` }, { id: 'back_menu', title: `⬅️ Назад` }],
      `📅 ЗА НЕДЕЛЮ`,
    );
  }

  // ─────────────────────────────────────────────────────────
  // SINF RAHBARI KONTAKTI
  // ─────────────────────────────────────────────────────────
  private async showTeacherContact(phone: string, session: WaSession): Promise<void> {
    if (!session.parentId) return this.startFlow(phone);

    const parent = await this.prisma.parent.findUnique({
      where: { id: session.parentId },
      include: {
        students: {
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
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!parent?.students?.length) {
      await this.wa.sendText(phone, `❌ Ma'lumot topilmadi.`);
      return this.showMainMenu(phone);
    }

    let msg = `👨‍🏫 *КЛАССНЫЙ РУКОВОДИТЕЛЬ*\n\n`;

    for (const sp of parent.students) {
      const s = sp.student;
      const teacher = s.class?.teacherClasses?.[0]?.teacher;
      msg += `👤 ${s.firstName} ${s.lastName} (${s.class ? `${s.class.grade}-${s.class.section}` : '—'})\n`;
      if (teacher) {
        msg += `👨‍🏫 ${teacher.firstName ?? ''} ${teacher.lastName ?? ''}\n`;
        if (teacher.phone) msg += `📞 ${teacher.phone}\n`;
        msg += `Свяжитесь по телефону.\n`;
      } else {
        msg += `❌ Классный руководитель ещё не назначен.\n`;
      }
      msg += `\n`;
    }

    await this.wa.sendButtons(
      phone,
      msg.trim(),
      [{ id: 'school', title: `🏫 Школа` }, { id: 'back_menu', title: `⬅️ Назад` }],
      `👨‍🏫 КЛАССНЫЙ РУКОВОДИТЕЛЬ`,
    );
  }

  // ─────────────────────────────────────────────────────────
  // MAKTAB KONTAKTI
  // ─────────────────────────────────────────────────────────
  private async showSchoolContact(phone: string, session: WaSession): Promise<void> {
    if (!session.parentId) return this.startFlow(phone);

    const parent = await this.prisma.parent.findUnique({
      where: { id: session.parentId },
      include: {
        students: {
          include: {
            student: { include: { school: true } },
          },
          orderBy: { createdAt: 'asc' },
          take: 1,
        },
      },
    });

    const school = parent?.students?.[0]?.student?.school;

    let msg = `🏫 *АДМИНИСТРАЦИЯ ШКОЛЫ*\n\n`;
    msg += `${school?.name ?? 'Школа'}\n\n`;
    if (school?.phone) msg += `📞 Телефон: ${school.phone}\n`;
    if (school?.address) msg += `📍 Адрес: ${school.address}\n`;

    await this.wa.sendButtons(
      phone,
      msg.trim(),
      [{ id: 'teacher', title: `👨‍🏫 Кл. руководитель` }, { id: 'back_menu', title: `⬅️ Назад` }],
      `🏫 ШКОЛА`,
    );
  }

  // ─────────────────────────────────────────────────────────
  // ОПЛАТА — ШАГ 1: выбор ребёнка
  // ─────────────────────────────────────────────────────────
  private async startPaymentFlow(phone: string, session: WaSession): Promise<void> {
    // Обновляем список детей из БД
    const parent = await this.prisma.parent.findUnique({
      where: { id: session.parentId },
      include: {
        students: {
          include: {
            student: { include: { class: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!parent?.students?.length) {
      await this.wa.sendText(phone, `❌ Дети не найдены.`);
      return this.showMainMenu(phone);
    }

    const children = parent.students.map((sp) => ({
      studentId: sp.student.id,
      name: `${sp.student.firstName} ${sp.student.lastName}`.trim(),
      grade: sp.student.class ? `${sp.student.class.grade}-${sp.student.class.section}` : '—',
      plan: sp.student.billingPlan,
      amount: 0,
      billingPaidUntil: sp.student.billingPaidUntil
        ? sp.student.billingPaidUntil.toISOString()
        : null,
    }));

    await this.state.update(phone, { ...session, state: 'SELECT_CHILD', children });

    if (children.length === 1) {
      // Один ребёнок — сразу переходим к выбору плана
      await this.state.update(phone, {
        ...session,
        state: 'SELECT_PLAN',
        children,
        selectedStudentId: children[0].studentId,
      });
      return this.showPlanSelection(phone, children[0]);
    }

    // Несколько детей — показываем список
    await this.wa.sendList(
      phone,
      `За кого из детей хотите произвести оплату?`,
      `Выбрать`,
      [
        {
          title: 'Мои дети',
          rows: children.map((c) => ({
            id: `child_${c.studentId}`,
            title: c.name,
            description: `${c.grade} класс`,
          })),
        },
      ],
      `👨‍👩‍👧 ВЫБОР РЕБЁНКА`,
    );
  }

  // ─────────────────────────────────────────────────────────
  // ОПЛАТА — ШАГ 2: ребёнок выбран
  // ─────────────────────────────────────────────────────────
  private async handleChildSelect(
    phone: string,
    text: string,
    session: WaSession,
    rawMsg: any,
  ): Promise<void> {
    const btnId = this.extractButtonId(rawMsg) ?? text.trim();

    // "child_<uuid>" или порядковый номер (1, 2, ...)
    let studentId: string | null = null;

    if (btnId.startsWith('child_')) {
      studentId = btnId.replace('child_', '');
    } else {
      const idx = parseInt(btnId, 10) - 1;
      if (!isNaN(idx) && session.children?.[idx]) {
        studentId = session.children[idx].studentId;
      }
    }

    if (!studentId) {
      await this.wa.sendText(phone, `❌ Неверный выбор. Пожалуйста, выберите из списка.`);
      return this.startPaymentFlow(phone, session);
    }

    const child = session.children?.find((c) => c.studentId === studentId);
    if (!child) {
      await this.wa.sendText(phone, `❌ Ребёнок не найден.`);
      return this.startPaymentFlow(phone, session);
    }

    await this.state.update(phone, {
      ...session,
      state: 'SELECT_PLAN',
      selectedStudentId: studentId,
    });

    return this.showPlanSelection(phone, child);
  }

  // ─────────────────────────────────────────────────────────
  // ВЫБОР ПЛАНА ОПЛАТЫ
  // ─────────────────────────────────────────────────────────
  private async showPlanSelection(
    phone: string,
    child: WaChild | undefined,
  ): Promise<void> {
    if (!child) {
      await this.wa.sendText(phone, `❌ Ребёнок не найден. Попробуйте ещё раз.`);
      return this.showMainMenu(phone);
    }
    // Получаем неоплаченные счета из БД
    const [monthly, yearly] = await Promise.all([
      this.prisma.payment.findFirst({
        where: {
          studentId: child.studentId,
          plan: 'MONTHLY',
          status: { in: ['PENDING', 'OVERDUE'] },
        },
        orderBy: { dueDate: 'asc' },
      }),
      this.prisma.payment.findFirst({
        where: {
          studentId: child.studentId,
          plan: 'YEARLY',
          status: { in: ['PENDING', 'OVERDUE'] },
        },
        orderBy: { dueDate: 'asc' },
      }),
    ]);

    const monthlyLabel = monthly
      ? `Ежемесячный — ${formatMoney(monthly.amount)} (${monthly.periodKey})`
      : `Ежемесячный — оплачено ✅`;

    const yearlyLabel = yearly
      ? `Годовой — ${formatMoney(yearly.amount)} (${yearly.periodKey})`
      : `Годовой — оплачено ✅`;

    const buttons: Array<{ id: string; title: string }> = [];

    if (monthly) buttons.push({ id: `plan_MONTHLY_${monthly.id}`, title: `💳 Ежемесячный` });
    if (yearly) buttons.push({ id: `plan_YEARLY_${yearly.id}`, title: `💳 Годовой` });
    buttons.push({ id: 'back_menu', title: `⬅️ Назад` });

    const body =
      `👤 *${child.name}* (${child.grade})\n\n` +
      `• ${monthlyLabel}\n` +
      `• ${yearlyLabel}\n\n` +
      `Какой план хотите оплатить?`;

    if (buttons.length === 1) {
      // Оба платежа уже оплачены
      await this.wa.sendText(
        phone,
        `✅ Все платежи для ${child.name} уже оплачены!\n\nНапишите "меню" для возврата.`,
      );
      await this.state.update(phone, { state: 'VERIFIED' } as any);
      return;
    }

    await this.wa.sendButtons(phone, body, buttons, `💳 ВЫБОР ПЛАНА`);
  }

  // ─────────────────────────────────────────────────────────
  // ОПЛАТА — ШАГ 3: план выбран
  // ─────────────────────────────────────────────────────────
  private async handlePlanSelect(
    phone: string,
    text: string,
    session: WaSession,
    rawMsg: any,
  ): Promise<void> {
    const btnId = this.extractButtonId(rawMsg) ?? text.trim();

    if (btnId === 'back_menu') {
      await this.state.update(phone, { ...session, state: 'VERIFIED' });
      return this.showMainMenu(phone);
    }

    // "plan_MONTHLY_<paymentId>" или "plan_YEARLY_<paymentId>"
    const match = btnId.match(/^plan_(MONTHLY|YEARLY)_(.+)$/);
    if (!match) {
      await this.wa.sendText(phone, `❌ Неверный выбор.`);
      return this.showPlanSelection(
        phone,
        session.children?.find((c) => c.studentId === session.selectedStudentId),
      );
    }

    const plan = match[1] as 'MONTHLY' | 'YEARLY';
    const paymentId = match[2];

    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { student: { include: { class: true } } },
    });

    if (!payment || payment.status === 'PAID' || payment.status === 'WAIVED') {
      await this.wa.sendText(phone, `✅ Этот платёж уже был оплачен.`);
      await this.state.update(phone, { ...session, state: 'VERIFIED' });
      return this.showMainMenu(phone);
    }

    await this.state.update(phone, {
      ...session,
      state: 'CONFIRM_PAYMENT',
      selectedPlan: plan,
      selectedAmount: payment.amount,
      selectedPeriodKey: payment.periodKey,
      pendingPaymentId: paymentId,
    });

    const studentName = `${payment.student.firstName} ${payment.student.lastName}`.trim();
    const grade = payment.student.class
      ? `${payment.student.class.grade}-${payment.student.class.section}`
      : '—';
    const due = payment.dueDate
      ? new Date(payment.dueDate).toLocaleDateString('ru-RU')
      : '—';

    const body =
      `📋 *ИНФОРМАЦИЯ О ПЛАТЕЖЕ*\n\n` +
      `👤 Ученик: ${studentName}\n` +
      `📚 Класс: ${grade}\n` +
      `📅 Период: ${payment.periodKey}\n` +
      `💰 Сумма: *${formatMoney(payment.amount)}*\n` +
      `⏰ Срок оплаты: ${due}\n\n` +
      `Подтверждаете оплату?`;

    await this.wa.sendButtons(
      phone,
      body,
      [
        { id: 'confirm_yes', title: `✅ Да, оплатить` },
        { id: 'confirm_no', title: `❌ Отмена` },
      ],
      `💳 ПОДТВЕРЖДЕНИЕ`,
    );
  }

  // ─────────────────────────────────────────────────────────
  // ОПЛАТА — ШАГ 4: подтверждение
  // ─────────────────────────────────────────────────────────
  private async handlePaymentConfirm(
    phone: string,
    text: string,
    session: WaSession,
    rawMsg: any,
  ): Promise<void> {
    const btnId = this.extractButtonId(rawMsg) ?? text.toLowerCase().trim();
  
    if (btnId === 'confirm_no' || ['нет', 'отмена', 'no', 'cancel'].includes(btnId)) {
      await this.state.update(phone, { ...session, state: 'VERIFIED' });
      await this.wa.sendText(phone, `❌ Платёж отменён.`);
      return this.showMainMenu(phone);
    }
  
    if (btnId !== 'confirm_yes' && !['да', 'yes', 'ок', 'ok'].includes(btnId)) {
      await this.wa.sendText(phone, `Нажмите "✅ Да, оплатить" или "❌ Отмена".`);
      return;
    }
  
    await this.wa.sendText(phone, `⏳ Формируется ссылка для оплаты...`);
  
    try {
      // ─── 1. externalOrderId генерация ───
      const orderId = `PAY-${session.pendingPaymentId.slice(0, 8)}-${Date.now()}`;
  
      // ─── 2. externalOrderId DB ga saqlash (webhook matchi uchun) ───
      await this.prisma.payment.update({
        where: { id: session.pendingPaymentId },
        data: { externalOrderId: orderId },
      });
  
      // ─── 3. Balance.kg invoice yaratish ───
      const baseUrl = this.configService.get<string>('APP_BASE_URL') ?? 'https://yourapp.com';
  
      const invoice = await this.balanceKg.createInvoice({
        orderId,
        amount: session.selectedAmount,
        description: `Школьный взнос — ${session.selectedPeriodKey}`,
        callbackUrl: `${baseUrl}/webhooks/payment`,
        returnUrl: `${baseUrl}/payment/result`,
        phone: session.phone,
      });
  
      // ─── 4. WhatsApp ga to'lov variantlari yuborish ───
      const balanceEnabled = this.balanceKg.enabled;
  
      let msg =
        `💳 *ССЫЛКА ДЛЯ ОПЛАТЫ*\n\n` +
        `Сумма: *${formatMoney(session.selectedAmount)}*\n` +
        `Период: ${session.selectedPeriodKey}\n\n`;
  
      if (balanceEnabled) {
        msg += `👇 Выберите способ оплаты:\n\n`;
        if (invoice.mbankDeepLink) msg += `📱 *Mbank:*\n${invoice.mbankDeepLink}\n\n`;
        if (invoice.odengiDeepLink) msg += `📱 *O!Денги:*\n${invoice.odengiDeepLink}\n\n`;
        msg += `🌐 *Онлайн:*\n${invoice.payUrl}`;
      } else {
        // Mock mode
        msg += `🔗 ${invoice.payUrl}\n\n_Тестовый режим. Интеграция Balance.kg будет активирована позже._`;
      }
  
      await this.wa.sendText(phone, msg);
  
      await this.state.update(phone, { ...session, state: 'VERIFIED' });
  
      await this.wa.sendText(
        phone,
        `ℹ️ После успешной оплаты вы получите автоматическое уведомление.\n\nНапишите "меню" для возврата.`,
      );
    } catch (err: any) {
      this.logger.error(`handlePaymentConfirm error: ${err?.message}`);
      await this.wa.sendText(
        phone,
        `❌ Не удалось сформировать ссылку для оплаты.\n\nПожалуйста, попробуйте позже или обратитесь в администрацию школы.`,
      );
      await this.state.update(phone, { ...session, state: 'VERIFIED' });
    }
  }

  // ─────────────────────────────────────────────────────────
  // СТАТУС ПЛАТЕЖЕЙ
  // ─────────────────────────────────────────────────────────
  private async showPaymentStatus(phone: string, session: WaSession): Promise<void> {
    if (!session.parentId) return this.startFlow(phone);

    const parent = await this.prisma.parent.findUnique({
      where: { id: session.parentId },
      include: {
        students: {
          include: {
            student: {
              include: {
                class: true,
                payments: {
                  where: { status: { in: ['PENDING', 'OVERDUE', 'PAID'] } },
                  orderBy: { dueDate: 'desc' },
                  take: 3,
                },
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!parent?.students?.length) {
      await this.wa.sendText(phone, `❌ Данные не найдены.`);
      return this.showMainMenu(phone);
    }

    let msg = `📊 *СТАТУС ПЛАТЕЖЕЙ*\n\n`;

    for (const sp of parent.students) {
      const s = sp.student;
      const className = s.class ? `${s.class.grade}-${s.class.section}` : '—';
      msg += `👤 *${s.firstName} ${s.lastName}* (${className})\n`;

      if (!s.payments.length) {
        msg += `  — Платежей нет\n\n`;
        continue;
      }

      for (const p of s.payments) {
        const icon = p.status === 'PAID' ? '✅' : p.status === 'OVERDUE' ? '🔴' : '🟡';
        const planLabel = p.plan === 'MONTHLY' ? 'Ежемесячный' : 'Годовой';
        msg += `  ${icon} ${planLabel} ${p.periodKey} — ${formatMoney(p.amount)}\n`;
      }
      msg += `\n`;
    }

    await this.wa.sendButtons(
      phone,
      msg.trim(),
      [
        { id: 'pay', title: `💳 Оплатить` },
        { id: 'back_menu', title: `⬅️ Назад` },
      ],
      `📊 СТАТУС ПЛАТЕЖЕЙ`,
      `Выберите действие`,
    );
  }

  // ─────────────────────────────────────────────────────────
  // ПОМОЩЬ
  // ─────────────────────────────────────────────────────────
  private async showHelp(phone: string): Promise<void> {
    await this.wa.sendText(
      phone,
      `❓ *ПОМОЩЬ*\n\n` +
        `📊 *Сегодняшняя посещаемость* — пришёл ли ребёнок сегодня\n` +
        `📅 *За неделю* — статистика за 7 дней\n` +
        `💳 *Оплатить* — ежемесячный или годовой взнос (мобильный банкинг)\n` +
        `📊 *Статус платежей* — текущие платежи\n` +
        `👨‍🏫 *Классный руководитель* — контакт учителя\n` +
        `🏫 *Школа* — контакт администрации\n\n` +
        `Команды:\n` +
        `• "меню" — Главное меню\n` +
        `• "отмена" — Отменить действие\n\n` +
        `📞 По всем вопросам обращайтесь в администрацию школы.`,
    );
    await this.showMainMenu(phone);
  }

  // ─────────────────────────────────────────────────────────
  // PUBLIC: уведомление об успешной оплате через webhook
  // ─────────────────────────────────────────────────────────
  async notifyPaymentSuccess(paymentId: string): Promise<void> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        student: {
          include: {
            class: true,
            parents: {
              include: { parent: true },
            },
          },
        },
      },
    });

    if (!payment) return;

    const studentName = `${payment.student.firstName} ${payment.student.lastName}`.trim();
    const grade = payment.student.class
      ? `${payment.student.class.grade}-${payment.student.class.section}`
      : '—';

    for (const sp of payment.student.parents) {
      const parent = sp.parent;
      if (!parent?.isWhatsappActive || !parent?.whatsappPhone) continue;

      try {
        await this.wa.sendText(
          parent.whatsappPhone,
          `✅ *ОПЛАТА ПРИНЯТА!*\n\n` +
            `👤 Ученик: ${studentName}\n` +
            `📚 Класс: ${grade}\n` +
            `📅 Период: ${payment.periodKey}\n` +
            `💰 Сумма: ${formatMoney(payment.amount)}\n` +
            `📆 Дата: ${new Date().toLocaleDateString('ru-RU')}\n\n` +
            `Спасибо! 🙏`,
        );
      } catch (err: any) {
        this.logger.error(`notifyPaymentSuccess → ${parent.whatsappPhone}: ${err?.message}`);
      }
    }
  }

  // ─────────────────────────────────────────────────────────
  // ИЗВЛЕЧЕНИЕ ТЕКСТА / ID КНОПКИ из payload Whapi
  // ─────────────────────────────────────────────────────────
  private extractText(msg: any): string | null {
    if (msg.type === 'text') return msg.text?.body ?? null;
    if (msg.type === 'interactive') {
      const ir = msg.interactive?.button_reply;
      const lr = msg.interactive?.list_reply;
      if (ir?.title) return ir.title;
      if (lr?.title) return lr.title;
    }
    return null;
  }

  private extractButtonId(msg: any): string | null {
    if (msg?.type === 'interactive') {
      const ir = msg.interactive?.button_reply;
      const lr = msg.interactive?.list_reply;
      const raw = ir?.id ?? lr?.id ?? null;
      if (!raw) return null;
      // Whapi adds "ButtonsV3:" prefix to button IDs in webhook replies
      return raw.replace(/^ButtonsV3:/i, '');
    }
    return null;
  }
}