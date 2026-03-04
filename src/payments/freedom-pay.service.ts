import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import * as crypto from 'crypto';

// ─────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────
export type PaymentMethod = 'MBANK' | 'ODENGI' | 'ELCART' | 'QR';

export interface CreateInvoiceParams {
  orderId: string;        // уникальный ID нашей системы
  amount: number;         // в сомах (KGS)
  description: string;   // описание платежа
  callbackUrl: string;    // webhook при успехе
  returnUrl: string;      // редирект после оплаты
  method?: PaymentMethod; // предпочтительный метод (опционально)
  phone?: string;         // телефон плательщика (для Mbank/O!Dengi)
}

export interface InvoiceResult {
  invoiceId: string;
  payUrl: string;           // универсальная ссылка
  qrCode?: string;          // base64 QR
  mbankDeepLink?: string;   // mbank://pay?...
  odengiDeepLink?: string;  // odengi://pay?...
  expiresAt?: Date;
}

export interface WebhookPayload {
  order_id: string;
  invoice_id?: string;
  payment_id?: string;
  status: string;
  amount: number;
  method?: string;
  payment_method?: string;
  transaction_id: string;
  paid_at?: string;
  signature: string;
}

export function isSuccessStatus(status: string): boolean {
  return ['success', 'SUCCESS', 'paid', 'PAID'].includes(status);
}

export function extractPaymentMethod(body: WebhookPayload): string {
  return body.payment_method ?? body.method ?? 'ONLINE';
}

// ─────────────────────────────────────────────────────────
// BALANCE.KG SERVICE
// ─────────────────────────────────────────────────────────
@Injectable()
export class FreedomPayService {
  private readonly logger = new Logger(FreedomPayService.name);
  private readonly http: AxiosInstance;
  private readonly merchantId: string;
  private readonly secretKey: string;
  private readonly isEnabled: boolean;

  constructor(private configService: ConfigService) {
    const apiUrl = this.configService.get<string>('BALANCE_KG_API_URL');
    this.merchantId = this.configService.get<string>('BALANCE_KG_MERCHANT_ID') ?? '';
    this.secretKey = this.configService.get<string>('BALANCE_KG_SECRET_KEY') ?? '';

    this.isEnabled = !!(apiUrl && this.merchantId && this.secretKey);

    if (this.isEnabled) {
      this.http = axios.create({
        baseURL: apiUrl,
        timeout: 15_000,
        headers: { 'Content-Type': 'application/json' },
      });
      this.logger.log('✅ Balance.kg gateway enabled');
    } else {
      this.logger.warn('⚠️  Balance.kg credentials not set — running in MOCK mode');
    }
  }

  // ─────────────────────────────────────────────────────────
  // CREATE INVOICE
  // ─────────────────────────────────────────────────────────
  async createInvoice(params: CreateInvoiceParams): Promise<InvoiceResult> {
    if (!this.isEnabled) {
      return this.mockInvoice(params);
    }

    const payload = {
      merchant_id: this.merchantId,
  		order_id: params.orderId,
  		amount: params.amount,
  		currency: 'KGS',
  		description: params.description,
  		callback_url: params.callbackUrl,
  		return_url: params.returnUrl,
    };

    const signature = this.sign(payload);

    try {
      const res = await this.http.post('/invoice/create', { ...payload, signature });
      const data = res.data;

      return {
        invoiceId: data.payment_id,
  			payUrl: data.payment_url,
  			mbankDeepLink: data.mbank_link,
  			odengiDeepLink: data.odengi_link,
      };
    } catch (err: any) {
      this.logger.error(`createInvoice failed [orderId=${params.orderId}]: ${err?.message}`);
      throw new Error(`Balance.kg createInvoice error: ${err?.response?.data?.message ?? err?.message}`);
    }
  }

  // ─────────────────────────────────────────────────────────
  // VERIFY WEBHOOK SIGNATURE
  // ─────────────────────────────────────────────────────────
  verifyWebhookSignature(body: WebhookPayload): boolean {
    if (!this.secretKey) return true;

    try {
      const { signature, ...rest } = body;

      // Ключи по алфавиту → строка → HMAC-SHA256
      const sorted = Object.keys(rest)
        .sort()
        .map((k) => `${k}=${(rest as any)[k]}`)
        .join('&');

      const expected = crypto
        .createHmac('sha256', this.secretKey)
        .update(sorted)
        .digest('hex');

      return crypto.timingSafeEqual(
        Buffer.from(signature ?? '', 'hex'),
        Buffer.from(expected, 'hex'),
      );
    } catch (err: any) {
      this.logger.warn(`Signature verify error: ${err?.message}`);
      return false;
    }
  }

  // ─────────────────────────────────────────────────────────
  // CHECK INVOICE STATUS (polling fallback)
  // ─────────────────────────────────────────────────────────
  async checkInvoiceStatus(invoiceId: string): Promise<'SUCCESS' | 'PENDING' | 'FAILED'> {
    if (!this.isEnabled) return 'PENDING';

    try {
      const signature = this.sign({ invoice_id: invoiceId, merchant_id: this.merchantId });
      const res = await this.http.post('/invoice/status', {
        invoice_id: invoiceId,
        merchant_id: this.merchantId,
        signature,
      });
      return res.data?.status ?? 'PENDING';
    } catch (err: any) {
      this.logger.warn(`checkInvoiceStatus error [${invoiceId}]: ${err?.message}`);
      return 'PENDING';
    }
  }

  // ─────────────────────────────────────────────────────────
  // SIGN PAYLOAD (HMAC-SHA256, ключи по алфавиту)
  // ─────────────────────────────────────────────────────────
  private sign(payload: Record<string, any>): string {
    const str = Object.keys(payload)
      .sort()
      .filter((k) => payload[k] !== undefined && payload[k] !== null)
      .map((k) => `${k}=${payload[k]}`)
      .join('&');

    return crypto.createHmac('sha256', this.secretKey).update(str).digest('hex');
  }

  // ─────────────────────────────────────────────────────────
  // MOCK MODE (пока нет merchant account)
  // ─────────────────────────────────────────────────────────
  private mockInvoice(params: CreateInvoiceParams): InvoiceResult {
    const mockId = `MOCK_${params.orderId}`;
    this.logger.warn(`🧪 MOCK invoice: orderId=${params.orderId} amount=${params.amount} KGS`);

    return {
      invoiceId: mockId,
      payUrl: `https://mock.balance.kg/pay/${params.orderId}`,
      qrCode: undefined,
      mbankDeepLink: `mbank://payment?order=${params.orderId}&amount=${params.amount}`,
      odengiDeepLink: `odengi://payment?order=${params.orderId}&amount=${params.amount}`,
    };
  }

  get enabled(): boolean {
    return this.isEnabled;
  }
}