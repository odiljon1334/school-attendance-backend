import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HikvisionApiService } from '../hikvision/hikvision-api.service';
import axios from 'axios';
import * as fs from 'fs';
import sharp = require('sharp');
import { PrismaService } from '../prisma/prisma.service';
import { TurnstilePersonType } from '@prisma/client';

export type TurnstileUserType = 'student' | 'teacher' | 'director';

@Injectable()
export class TurnstileService {
  private readonly logger = new Logger(TurnstileService.name);

  private readonly ip: string;
  private readonly port: number;
  private readonly username: string;
  private readonly password: string;
  private readonly enabled: boolean;

  // optional: sync paytida juda tez urib yubormaslik uchun
  private readonly syncDelayMs: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly hikvisionApi: HikvisionApiService,
    private readonly prisma: PrismaService,
  ) {
    this.ip = this.configService.get('TURNSTILE_IP') || '192.168.1.100';
    this.port = parseInt(this.configService.get('TURNSTILE_PORT') || '80', 10);
    this.username = this.configService.get('TURNSTILE_USERNAME') || 'admin';
    this.password = this.configService.get('TURNSTILE_PASSWORD') || 'admin123';
    this.enabled = this.configService.get('TURNSTILE_ENABLED') === 'true';

    this.syncDelayMs = parseInt(this.configService.get('TURNSTILE_SYNC_DELAY_MS') || '350', 10);
  }

  // ─────────────────────────────────────────────
  // DEVICE
  // ─────────────────────────────────────────────

  private async getActiveDeviceId(): Promise<string> {
    const device = await this.prisma.hikvisionDevice.findFirst({
      where: { isActive: true },
      select: { deviceId: true },
    });

    if (!device?.deviceId) {
      throw new Error('No active Hikvision device found in DB');
    }

    return device.deviceId;
  }

  private prefixFor(userType: TurnstileUserType): 'ST' | 'TCH' | 'DIR' {
    if (userType === 'student') return 'ST';
    if (userType === 'teacher') return 'TCH';
    return 'DIR';
  }

  /**
   * DB enumda DIRECTOR yo‘q, shuning uchun director => TEACHER sifatida saqlaymiz.
   */
  private personTypeFor(userType: TurnstileUserType): TurnstilePersonType {
    return userType === 'student' ? TurnstilePersonType.STUDENT : TurnstilePersonType.TEACHER;
  }

  // ─────────────────────────────────────────────
  // EMPLOYEE NO (AUTO CREATE)
  // ─────────────────────────────────────────────

  private async findIdentity(params: {
    deviceId: string;
    userType: TurnstileUserType;
    userId: string;
  }): Promise<{ employeeNo: string } | null> {
    const personType = this.personTypeFor(params.userType);

    return this.prisma.turnstileIdentity.findFirst({
      where: {
        deviceId: params.deviceId,
        personType,
        ...(params.userType === 'student'
          ? { studentId: params.userId }
          : { teacherId: params.userId }),
      },
      select: { employeeNo: true },
    });
  }

  private async getOrCreateEmployeeNo(params: {
    deviceId: string;
    userType: TurnstileUserType;
    userId: string;
  }): Promise<string> {
    const existing = await this.findIdentity(params);
    const emp = existing?.employeeNo ? String(existing.employeeNo).trim() : '';
    if (/^\d+$/.test(emp)) return emp;

    // create new
    const personType = this.personTypeFor(params.userType);

    for (let attempt = 0; attempt < 7; attempt++) {
      const next = await this.generateNextEmployeeNo(params.deviceId);

      try {
        await this.prisma.turnstileIdentity.create({
          data: {
            deviceId: params.deviceId,
            employeeNo: next,
            personType,
            studentId: params.userType === 'student' ? params.userId : null,
            teacherId: params.userType !== 'student' ? params.userId : null,
          },
        });

        return next;
      } catch (e: any) {
        // Unique conflict -> retry
        if (String(e?.code) === 'P2002') continue;
        throw e;
      }
    }

    throw new Error('Failed to allocate employeeNo (too many conflicts)');
  }

  /**
   * IMPORTANT:
   * TurnstileIdentity.employeeNo - String bo‘lgani uchun Prisma orderBy(desc) string bo‘yicha xato bo‘lishi mumkin.
   * Shuning uchun Postgres RAW query bilan numeric MAX olamiz.
   */
  private async generateNextEmployeeNo(deviceId: string): Promise<string> {
    // employeeNo ichida faqat raqamlar bo‘lganlarini olamiz, cast qilib max topamiz
    const rows = await this.prisma.$queryRawUnsafe<Array<{ max_no: number | null }>>(
      `
      SELECT MAX(CAST("employeeNo" AS BIGINT)) AS max_no
      FROM "TurnstileIdentity"
      WHERE "deviceId" = $1
        AND "employeeNo" ~ '^[0-9]+$'
      `,
      deviceId,
    );

    const maxNo = rows?.[0]?.max_no ?? null;

    // default start
    const start = 1000;
    const next = (maxNo ?? start) + 1;

    return String(next);
  }

  // ─────────────────────────────────────────────
  // UPLOAD
  // ─────────────────────────────────────────────

  async uploadPhoto(
    userId: string,
    photo: string,
    userType: TurnstileUserType = 'student',
  ): Promise<boolean> {
    if (!this.enabled) return false;

    try {
      this.logger.log(`Uploading photo for ${userType} ${userId}`);

      const deviceId = await this.getActiveDeviceId();

      const employeeNo = await this.getOrCreateEmployeeNo({
        deviceId,
        userType,
        userId,
      });

      const displayName = `${this.prefixFor(userType)}_${employeeNo}`; // ST_1001
      const jpegBase64 = await this.processPhotoToJpegBase64(photo, userId);

      const ok = await this.hikvisionApi.registerFace(
        this.ip,
        this.port,
        this.username,
        this.password,
        employeeNo,
        displayName,
        jpegBase64,
        { doorNo: 1, planTemplateNo: 1 },
      );

      if (!ok) {
        this.logger.error(`❌ Upload failed userId=${userId} employeeNo=${employeeNo}`);
        return false;
      }

      this.logger.log(`✅ Upload success userId=${userId} employeeNo=${employeeNo}`);
      return true;
    } catch (e: any) {
      this.logger.error(`Error uploading photo for ${userType} ${userId}: ${e?.message || e}`);
      return false;
    }
  }

  // ─────────────────────────────────────────────
  // REMOVE (IDEMPOTENT + CLEAN DB)
  // ─────────────────────────────────────────────

  async removePhoto(userId: string, userType: TurnstileUserType): Promise<boolean> {
    if (!this.enabled) return false;

    try {
      this.logger.log(`Removing photo for ${userType} ${userId}`);

      const deviceId = await this.getActiveDeviceId();
      const identity = await this.findIdentity({ deviceId, userType, userId });

      // identity bo‘lmasa ham remove endpointlar "idempotent" bo‘lsin
      if (!identity?.employeeNo) {
        this.logger.warn(`removePhoto: identity not found. Skip device delete. userId=${userId}`);
        return true;
      }

      const employeeNo = String(identity.employeeNo).trim();

      // 1) device delete (fail bo‘lsa ham DB delete bloklamaymiz)
      const deviceOk = await this.hikvisionApi.deleteFace(
        this.ip,
        this.port,
        this.username,
        this.password,
        employeeNo,
      );

      if (!deviceOk) {
        this.logger.warn(`removePhoto: device delete failed. Continue DB cleanup. employeeNo=${employeeNo}`);
      }

      // 2) DB cleanup
      await this.prisma.turnstileIdentity.deleteMany({
        where: {
          deviceId,
          employeeNo,
        },
      });

      this.logger.log(`✅ Removed from turnstile+db userId=${userId} employeeNo=${employeeNo}`);
      return true;
    } catch (e: any) {
      this.logger.error(`removePhoto error userId=${userId}: ${e?.message || e}`);
      // remove operatsiya delete flow'ni bloklamasin
      return true;
    }
  }

  // ─────────────────────────────────────────────
  // UPDATE
  // ─────────────────────────────────────────────

  async updatePhoto(
    userId: string,
    photo: string,
    userType: TurnstileUserType = 'student',
  ): Promise<boolean> {
    if (!this.enabled) return false;

    // eski employeeNo bilan device’da face bor bo‘lishi mumkin: avval o‘chiramiz
    await this.removePhoto(userId, userType);
    return this.uploadPhoto(userId, photo, userType);
  }

  // ─────────────────────────────────────────────
  // SYNC
  // ─────────────────────────────────────────────

  async syncSchoolPhotos(
    schoolId: string,
    users: Array<{ id: string; photo: string; type: TurnstileUserType }>,
  ): Promise<void> {
    if (!this.enabled) return;

    this.logger.log(`Syncing ${users.length} photos for school ${schoolId}`);

    for (const user of users) {
      if (!user.photo) continue;
      await this.uploadPhoto(user.id, user.photo, user.type);
      await new Promise((r) => setTimeout(r, this.syncDelayMs));
    }

    this.logger.log(`✅ Sync finished schoolId=${schoolId}`);
  }

  // ─────────────────────────────────────────────
  // IMAGE PROCESS
  // ─────────────────────────────────────────────

  private async processPhotoToJpegBase64(photo: string, userIdForLog?: string): Promise<string> {
    let buffer: Buffer;

    if (photo.startsWith('data:image')) {
      const base64Data = photo.replace(/^data:image\/\w+;base64,/, '');
      buffer = Buffer.from(base64Data, 'base64');
    } else if (photo.startsWith('http')) {
      const res = await axios.get(photo, { responseType: 'arraybuffer', timeout: 20000 });
      buffer = Buffer.from(res.data as any);
    } else if (fs.existsSync(photo)) {
      buffer = fs.readFileSync(photo);
    } else {
      buffer = Buffer.from(photo, 'base64');
    }

    const out = await sharp(buffer)
      .rotate()
      .resize(640, 640, { fit: 'inside', withoutEnlargement: false })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 95, chromaSubsampling: '4:2:0' })
      .toBuffer();

    const meta = await sharp(out).metadata();
    this.logger.log(
      `Photo processed${userIdForLog ? ` for ${userIdForLog}` : ''}: ${meta.width}x${meta.height}, size=${Math.round(out.length / 1024)}KB`,
    );

    return out.toString('base64');
  }
}