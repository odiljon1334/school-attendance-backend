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
  // Correct Whapi endpoint: POST /messages/interactive with type:"button"
  // Button IDs come back with "ButtonsV3:" prefix in webhook replies
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
      await this.http.post('/messages/interactive', {
        to: chatId,
        type: 'button',
        header: header ? { type: 'text', text: header } : undefined,
        body: { text: body },
        footer: footer ? { text: footer } : undefined,
        action: {
          buttons: buttons.map((b) => ({
            type: 'quick_reply',
            id: b.id,
            title: b.title,
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
  // NOTE: Whapi list type requires WhatsApp Business account.
  // For regular accounts, falls back to multiple button messages or plain text.
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
    // Collect all rows across sections
    const allRows = sections.flatMap((s) => s.rows);

    // If 3 or fewer items, use buttons directly
    if (allRows.length <= 3) {
      return this.sendButtons(to, body, allRows, header, footer);
    }

    // Try to split into multiple button messages (max 3 per message)
    try {
      // Send header as plain text first if provided
      if (header) {
        await this.sendText(to, `*${header}*`);
      }
      // Send body text
      await this.sendText(to, body);

      // Send each section as a button group (up to 3 buttons each)
      for (const section of sections) {
        const rows = section.rows.slice(0, 3);
        if (rows.length > 0) {
          await this.http.post('/messages/interactive', {
            to: chatId,
            type: 'button',
            body: { text: section.title },
            action: {
              buttons: rows.map((r) => ({
                type: 'quick_reply',
                id: r.id,
                title: r.title,
              })),
            },
          });
        }
      }
    } catch (err: any) {
      // Final fallback: numbered plain text list
      this.logger.warn(`sendList fallback → ${chatId}: ${err?.message}`);
      const items = sections.flatMap((s, si) => [
        `*${s.title}*`,
        ...s.rows.map((r, i) => `  ${si * 10 + i + 1}. ${r.title}${r.description ? ` — ${r.description}` : ''}`),
      ]);
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
  // SEND PHOTO (base64 yoki URL)
  // Whapi endpoint: POST /messages/image
  // ─────────────────────────────────────────────
  async sendPhoto(to: string, photoBase64: string, caption?: string): Promise<void> {
    const chatId = this.toChatId(to);
    try {
      // base64 → data URI formatiga o'tkazamiz (agar allaqachon data URI bo'lmasa)
      const imageLink = photoBase64.startsWith('data:')
        ? photoBase64
        : `data:image/jpeg;base64,${photoBase64}`;

      await this.http.post('/messages/image', {
        to: chatId,
        image: {
          link: imageLink,
          caption: caption ?? '',
        },
      });

      this.logger.log(`📸 WA photo sent → ${chatId}`);
    } catch (err: any) {
      this.logger.error(`sendPhoto → ${chatId}: ${err?.message}`);
      // Foto yubora olmasa, matnni fallback qilib yuboramiz
      if (caption) {
        try {
          await this.sendText(to, caption);
          this.logger.warn(`⚠️ WA photo fallback to text → ${chatId}`);
        } catch {
          // ignore
        }
      }
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