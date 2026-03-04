import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  HttpCode,
  HttpStatus,
  Query,
  Req,
  GoneException,
} from '@nestjs/common';
import type { Request } from 'express';

import { HikvisionService } from './hikvision.service';
import { CreateDeviceDto, UpdateDeviceDto, RegisterFaceDto } from './dto/hikvision.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.auth.guards';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@Controller('hikvision')
export class HikvisionController {
  constructor(private readonly hikvisionService: HikvisionService) {}

  private offlineOnlyError() {
    throw new GoneException(
      'Offline mode: device/face registration is disabled. Use enroll_pic.zip (flash) and webhook events.',
    );
  }

  // ────────────────────────────────────────────────────────
  // DEVICE MANAGEMENT (Disabled in Offline Mode)
  // ────────────────────────────────────────────────────────

  @Post('devices')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.DISTRICT_ADMIN, UserRole.SCHOOL_ADMIN)
  @HttpCode(HttpStatus.CREATED)
  createDevice(@Body() _createDeviceDto: CreateDeviceDto) {
    return this.offlineOnlyError();
  }

  @Get('devices')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.DISTRICT_ADMIN, UserRole.SCHOOL_ADMIN, UserRole.DIRECTOR)
  findAllDevices(@Query('schoolId') _schoolId?: string) {
    return this.offlineOnlyError();
  }

  @Get('devices/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.DISTRICT_ADMIN, UserRole.SCHOOL_ADMIN, UserRole.DIRECTOR)
  findOneDevice(@Param('id') _id: string) {
    return this.offlineOnlyError();
  }

  @Patch('devices/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.DISTRICT_ADMIN, UserRole.SCHOOL_ADMIN)
  updateDevice(@Param('id') _id: string, @Body() _updateDeviceDto: UpdateDeviceDto) {
    return this.offlineOnlyError();
  }

  @Delete('devices/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.DISTRICT_ADMIN, UserRole.SCHOOL_ADMIN)
  @HttpCode(HttpStatus.OK)
  removeDevice(@Param('id') _id: string) {
    return this.offlineOnlyError();
  }

  // ────────────────────────────────────────────────────────
  // FACE REGISTRATION (Disabled in Offline Mode)
  // ────────────────────────────────────────────────────────

  @Post('face/register')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.DISTRICT_ADMIN, UserRole.SCHOOL_ADMIN, UserRole.DIRECTOR)
  @HttpCode(HttpStatus.OK)
  registerFace(@Body() _registerFaceDto: RegisterFaceDto) {
    return this.offlineOnlyError();
  }

  @Delete('face/:deviceId/:personId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.DISTRICT_ADMIN, UserRole.SCHOOL_ADMIN, UserRole.DIRECTOR)
  @HttpCode(HttpStatus.OK)
  deleteFace(@Param('deviceId') _deviceId: string, @Param('personId') _personId: string) {
    return this.offlineOnlyError();
  }

  // =======================================================
  // ✅ WEBHOOK (Public) — OFFLINE MODE MAIN ENTRY
  // employeeNo keladi (terminaldagi enroll_pic fayl nomidan)
  // employeeNo -> student/teacher.enrollNumber orqali topiladi
  // =======================================================

  @Post('webhook/face-recognition')
  @HttpCode(HttpStatus.OK)
  async handleFaceRecognitionWebhook(@Req() req: Request) {
    const ct = String(req.headers['content-type'] || '');
    const lenHeader = req.headers['content-length'];
    const body = req.body as Buffer;

    console.log('================ HIKVISION WEBHOOK HIT ================');
    const parsed = this.parseHikvisionPayload(ct, body);
    console.log('Parsed employeeNo:', parsed.employeeNo);
    if (parsed.snapshotBytes) console.log('Snapshot bytes:', parsed.snapshotBytes.length);

    // ✅ always 200
    if (!parsed.employeeNo) {
      return { ok: true, received: true, employeeNo: null, deviceId: parsed.deviceId ?? null };
    }

    // ✅ OFFLINE SERVICE CALL:
    const res = await this.hikvisionService.handleFaceRecognitionEvent({
      employeeNo: parsed.employeeNo,
      deviceId: parsed.deviceId ?? null, // kelmasa ham OK
      raw: parsed.eventRaw,
      snapshotBytes: parsed.snapshotBytes,
      contentType: ct,
    });

    return {
      ok: true,
      received: true,
      employeeNo: parsed.employeeNo,
      deviceId: parsed.deviceId ?? null,
      result: res,
    };
  }

  // ────────────────────────────────────────────────────────
  // PARSER
  // ────────────────────────────────────────────────────────

  private parseHikvisionPayload(
    contentType: string,
    body?: Buffer,
  ): {
    kind: 'json' | 'xml' | 'multipart' | 'unknown';
    employeeNo?: string;
    deviceId?: string;
    eventRaw?: any;
    snapshotBytes?: Buffer;
  } {
    if (!body || body.length === 0) return { kind: 'unknown' };

    // ── JSON ──────────────────────────────────────────────
    if (contentType.includes('application/json')) {
      try {
        const obj = JSON.parse(body.toString('utf8'));
        const employeeNo = this.extractEmployeeNoFromObject(obj);
        const deviceId = this.extractDeviceIdFromObject(obj);
        return { kind: 'json', employeeNo, deviceId, eventRaw: obj };
      } catch {
        return { kind: 'unknown', eventRaw: body.toString('utf8') };
      }
    }

    // ── XML / text ────────────────────────────────────────
    if (contentType.includes('xml') || contentType.includes('text/plain')) {
      const xml = body.toString('utf8');
      const employeeNo = this.extractEmployeeNoFromXml(xml);
      const deviceId = this.extractDeviceIdFromXml(xml);
      return { kind: 'xml', employeeNo, deviceId, eventRaw: xml };
    }

    // ── MULTIPART ─────────────────────────────────────────
    if (contentType.includes('multipart')) {
      const boundaryMatch = contentType.match(/boundary=([^;]+)/i);
      const boundary = boundaryMatch ? boundaryMatch[1].trim().replace(/^"|"$/g, '') : '';
      if (!boundary) return { kind: 'multipart', eventRaw: 'no-boundary' };

      const parts = this.splitMultipart(body, boundary);

      let jsonObj: any | undefined;
      let xmlText: string | undefined;
      let snap: Buffer | undefined;

      for (const p of parts) {
        const h = p.headers.toLowerCase();

        // ✅ FIX: JSON part — Hikvision multipart ichida JSON yuboradi
        if (!jsonObj && h.includes('application/json')) {
          try {
            jsonObj = JSON.parse(p.body.toString('utf8'));
          } catch { /* ignore */ }
        }

        // XML part
        if (
          !xmlText &&
          (h.includes('application/xml') ||
            h.includes('text/xml') ||
            h.includes('application/soap+xml') ||
            h.includes('text/plain'))
        ) {
          const t = p.body.toString('utf8');
          if (t.includes('<')) xmlText = t;
        }

        // Snapshot image
        if (!snap && (h.includes('image/jpeg') || h.includes('image/jpg'))) {
          snap = p.body;
        }
      }

      if (!jsonObj) {
        for (const p of parts) {
          try {
            const t = p.body.toString('utf8').trim();
            if (t.startsWith('{') && t.endsWith('}')) {
              jsonObj = JSON.parse(t);
              break;
            }
          } catch { /* ignore */ }
        }
      }

      // ✅ FIX: XML topilmasa — '<' belgisi bor partni oladi
      if (!xmlText) {
        const maybe = parts.find((p) => p.body.toString('utf8').includes('<'));
        if (maybe) xmlText = maybe.body.toString('utf8');
      }

      // ✅ FIX: employeeNo/deviceId — avval JSON dan, keyin XML dan qidiramiz
      const employeeNo = jsonObj
        ? this.extractEmployeeNoFromObject(jsonObj)
        : xmlText
          ? this.extractEmployeeNoFromXml(xmlText)
          : undefined;

      const deviceId = jsonObj
        ? this.extractDeviceIdFromObject(jsonObj)
        : xmlText
          ? this.extractDeviceIdFromXml(xmlText)
          : undefined;

      return {
        kind: 'multipart',
        employeeNo,
        deviceId,
        eventRaw: jsonObj ?? xmlText ?? '(multipart-no-data)',
        snapshotBytes: snap,
      };
    }

    return { kind: 'unknown', eventRaw: body.toString('utf8') };
  }

  private extractEmployeeNoFromObject(obj: any): string | undefined {
    const v =
      obj?.employeeNo ||
      obj?.EmployeeNo ||
      obj?.employeeNoString ||
      obj?.EmployeeNoString ||
      obj?.cardNo ||
      obj?.personId ||
      obj?.UserInfo?.employeeNo ||
      obj?.AccessControllerEvent?.employeeNo ||
      obj?.AccessControllerEvent?.employeeNoString ||
      obj?.AccessControllerEvent?.cardNo ||
      obj?.Events?.[0]?.employeeNo ||
      obj?.Events?.[0]?.employeeNoString;
  
    return v ? String(v).trim() : undefined;
  }

  private extractDeviceIdFromObject(obj: any): string | undefined {
    const v =
      obj?.deviceId ||
      obj?.deviceID ||
      obj?.DeviceID ||
      obj?.AccessControllerEvent?.deviceId ||
      obj?.AccessControllerEvent?.deviceID ||
      obj?.Events?.[0]?.deviceId ||
      obj?.Events?.[0]?.deviceID;

    return v ? String(v).trim() : undefined;
  }

  private extractEmployeeNoFromXml(xml: string): string | undefined {
    let m = xml.match(/<employeeNo>\s*([^<]+)\s*<\/employeeNo>/i);
    if (m?.[1]) return m[1].trim();

    m = xml.match(/<EmployeeNo>\s*([^<]+)\s*<\/EmployeeNo>/i);
    if (m?.[1]) return m[1].trim();

    m = xml.match(/employeeNo\s*=\s*"([^"]+)"/i);
    if (m?.[1]) return m[1].trim();

    m = xml.match(/<FPID>\s*([^<]+)\s*<\/FPID>/i);
    if (m?.[1]) return m[1].trim();

    return undefined;
  }

  private extractDeviceIdFromXml(xml: string): string | undefined {
    let m = xml.match(/<deviceID>\s*([^<]+)\s*<\/deviceID>/i);
    if (m?.[1]) return m[1].trim();

    m = xml.match(/<deviceId>\s*([^<]+)\s*<\/deviceId>/i);
    if (m?.[1]) return m[1].trim();

    m = xml.match(/deviceID\s*=\s*"([^"]+)"/i);
    if (m?.[1]) return m[1].trim();

    m = xml.match(/<serialNumber>\s*([^<]+)\s*<\/serialNumber>/i);
    if (m?.[1]) return m[1].trim();

    return undefined;
  }


  private splitMultipart(buf: Buffer, boundary: string): Array<{ headers: string; body: Buffer }> {
    const boundaryBuf = Buffer.from(`--${boundary}`);
    const endBoundaryBuf = Buffer.from(`--${boundary}--`);

    const parts: Array<{ headers: string; body: Buffer }> = [];
    let start = buf.indexOf(boundaryBuf);
    if (start === -1) return parts;

    while (start !== -1) {
      if (buf.indexOf(endBoundaryBuf, start) === start) break;

      let partStart = start + boundaryBuf.length;
      if (buf[partStart] === 13 && buf[partStart + 1] === 10) partStart += 2;

      const next = buf.indexOf(boundaryBuf, partStart);
      if (next === -1) break;

      const partBuf = buf.slice(partStart, next);

      const sep = partBuf.indexOf(Buffer.from('\r\n\r\n'));
      if (sep !== -1) {
        const headerBuf = partBuf.slice(0, sep).toString('utf8');
        const bodyBuf = partBuf.slice(sep + 4);
        parts.push({ headers: headerBuf, body: this.trimCrlf(bodyBuf) });
      }

      start = next;
    }

    return parts;
  }

  private trimCrlf(b: Buffer): Buffer {
    let end = b.length;
    while (end >= 2 && b[end - 2] === 13 && b[end - 1] === 10) end -= 2;
    return b.slice(0, end);
  }
}