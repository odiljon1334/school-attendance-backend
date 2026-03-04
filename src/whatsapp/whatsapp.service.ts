import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);
  private readonly http: AxiosInstance;

  constructor(private configService: ConfigService) {
    const baseURL = this.configService.get<string>('WHAPI_API_URL');
    const token = this.configService.get<string>('WHAPI_TOKEN');

    this.http = axios.create({
      baseURL,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 15_000,
    });
  }

  // ─────────────────────────────────────────────
  // HEALTH CHECK
  // ─────────────────────────────────────────────
  async checkHealth(): Promise<boolean> {
    try {
      const res = await this.http.get('/health');
      return res.data?.status === 'active';
    } catch {
      return false;
    }
  }

  // ─────────────────────────────────────────────
  // SEND PLAIN TEXT
  // ─────────────────────────────────────────────
  async sendText(to: string, body: string): Promise<void> {
    const chatId = this.toChatId(to);
    try {
      await this.http.post('/messages/text', { to: chatId, body });
    } catch (err: any) {
      this.logger.error(`sendText → ${chatId}: ${err?.message}`);
      throw err;
    }
  }

  // ─────────────────────────────────────────────
  // SEND INTERACTIVE BUTTONS (max 3 buttons)
  // ─────────────────────────────────────────────
  async sendButtons(
    to: string,
    body: string,
    buttons: Array<{ id: string; title: string }>,
    header?: string,
    footer?: string,
  ): Promise<void> {
    const chatId = this.toChatId(to);
    try {
      await this.http.post('/messages/interactive/buttons', {
        to: chatId,
        header: header ? { type: 'text', text: header } : undefined,
        body: { text: body },
        footer: footer ? { text: footer } : undefined,
        action: {
          buttons: buttons.map((b) => ({
            type: 'reply',
            reply: { id: b.id, title: b.title },
          })),
        },
      });
    } catch (err: any) {
      // Fallback: buttons ishlamasa plain text
      this.logger.warn(`sendButtons fallback → ${chatId}: ${err?.message}`);
      const fallback =
        (header ? `*${header}*\n\n` : '') +
        body +
        '\n\n' +
        buttons.map((b, i) => `${i + 1}. ${b.title}`).join('\n') +
        (footer ? `\n\n_${footer}_` : '');
      await this.sendText(to, fallback);
    }
  }

  // ─────────────────────────────────────────────
  // SEND LIST (4+ options uchun)
  // ─────────────────────────────────────────────
  async sendList(
    to: string,
    body: string,
    buttonText: string,
    sections: Array<{
      title: string;
      rows: Array<{ id: string; title: string; description?: string }>;
    }>,
    header?: string,
    footer?: string,
  ): Promise<void> {
    const chatId = this.toChatId(to);
    try {
      await this.http.post('/messages/interactive/list', {
        to: chatId,
        header: header ? { type: 'text', text: header } : undefined,
        body: { text: body },
        footer: footer ? { text: footer } : undefined,
        action: { button: buttonText, sections },
      });
    } catch (err: any) {
      // Fallback: plain text
      this.logger.warn(`sendList fallback → ${chatId}: ${err?.message}`);
      const items = sections.flatMap((s) =>
        s.rows.map((r, i) => `${i + 1}. ${r.title}${r.description ? ` — ${r.description}` : ''}`),
      );
      const fallback =
        (header ? `*${header}*\n\n` : '') +
        body +
        '\n\n' +
        items.join('\n') +
        (footer ? `\n\n_${footer}_` : '');
      await this.sendText(to, fallback);
    }
  }

  // ─────────────────────────────────────────────
  // TYPING INDICATOR (UX uchun)
  // ─────────────────────────────────────────────
  async sendTyping(to: string): Promise<void> {
    const chatId = this.toChatId(to);
    try {
      await this.http.post('/chats/typing', { chat_id: chatId, presence: 'composing' });
    } catch {
      // ignore — typing optional
    }
  }

  // ─────────────────────────────────────────────
  // HELPER: "+996XXXXXXX" → "996XXXXXXX@s.whatsapp.net"
  // ─────────────────────────────────────────────
  toChatId(phone: string): string {
    const digits = phone.replace(/[^\d]/g, '');
    return `${digits}@s.whatsapp.net`;
  }

  // ─────────────────────────────────────────────
  // EXTRACT SENDER PHONE FROM WEBHOOK PAYLOAD
  // "996XXXXXXX@s.whatsapp.net" → "+996XXXXXXX"
  // ─────────────────────────────────────────────
  extractPhone(chatId: string): string {
    return '+' + chatId.replace('@s.whatsapp.net', '').replace(/[^\d]/g, '');
  }
}