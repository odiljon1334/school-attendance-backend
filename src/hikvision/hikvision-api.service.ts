import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import FormData from 'form-data';
import * as https from 'https';
import * as crypto from 'crypto';

type DigestOpts = {
  data?: any;
  headers?: Record<string, string>;
  httpsAgent?: https.Agent;
  timeout?: number;
};

@Injectable()
export class HikvisionApiService {
  private readonly logger = new Logger(HikvisionApiService.name);

  // ────────────────────────────────────────────────────────
  // helpers
  // ────────────────────────────────────────────────────────

  private buildBaseUrl(ip: string, port: number) {
    const isHttps = port === 443 || port === 8443;
    return `${isHttps ? 'https' : 'http'}://${ip}:${port}`;
  }

  private shortErr(e: any) {
    const code = e?.code ? String(e.code) : '';
    const msg = e?.message ? String(e.message) : '';
    return [code, msg].filter(Boolean).join(' | ') || 'unknown_error';
  }

  private safeJson(text: string): any {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  private isOkResponse(text: string) {
    const j = this.safeJson(text);
    if (!j) return false;
    return j?.statusCode === 1 || j?.statusString === 'OK' || j?.StatusString === 'OK';
  }

  private getSubStatus(text: string): string {
    const j = this.safeJson(text);
    const s = j?.subStatusCode ?? j?.SubStatusCode;
    return s ? String(s) : '';
  }

  private isNotSupported(text: string) {
    const low = String(text || '').toLowerCase();
    return low.includes('notsupport') || low.includes('not support');
  }

  private looksLikeAlreadyExists(text: string) {
    // Hikvision turli firmwarelarda turli subStatusCode qaytaradi
    const sub = this.getSubStatus(text).toLowerCase();
    const low = String(text || '').toLowerCase();

    return (
      sub.includes('already') ||
      sub.includes('exist') ||
      sub.includes('duplicate') ||
      low.includes('already') ||
      low.includes('exist') ||
      low.includes('duplicate') ||
      low.includes('repeated') ||
      sub === 'employeenoalreadyexist' ||
      sub === 'deviceuseralreadyexistface'
    );
  }

  private getHttpsAgent(port: number) {
    const isHttps = port === 443 || port === 8443;
    if (!isHttps) return undefined;
    const insecure = process.env.HIKVISION_INSECURE_TLS === 'true';
    return new https.Agent({ rejectUnauthorized: !insecure });
  }

  // ────────────────────────────────────────────────────────
  // digest auth
  // ────────────────────────────────────────────────────────

  private parseWwwAuthenticate(header: string): Record<string, string> {
    const out: Record<string, string> = {};
    const h = header.replace(/^Digest\s+/i, '');
    const parts = h.match(/(?:[^,"]+|"[^"]*")+/g) || [];
    for (const part of parts) {
      const p = part.trim();
      if (!p) continue;
      const eq = p.indexOf('=');
      if (eq === -1) continue;
      const k = p.slice(0, eq).trim();
      let v = p.slice(eq + 1).trim();
      v = v.replace(/^"|"$/g, '');
      out[k] = v;
    }
    return out;
  }

  private buildDigestHeader(
    method: string,
    uri: string,
    username: string,
    password: string,
    params: Record<string, string>,
  ): string {
    const { realm, nonce, opaque } = params;
    const algorithm = (params.algorithm || 'MD5').toUpperCase();

    let qop = params.qop || '';
    if (qop.includes(',')) {
      const list = qop.split(',').map((s) => s.trim());
      qop = list.includes('auth') ? 'auth' : list[0];
    }

    const md5 = (s: string) => crypto.createHash('md5').update(s).digest('hex');
    if (!realm || !nonce) throw new Error('Digest params missing realm/nonce');

    const ha1 =
      algorithm === 'MD5-SESS'
        ? md5(md5(`${username}:${realm}:${password}`) + ':' + nonce)
        : md5(`${username}:${realm}:${password}`);

    const ha2 = md5(`${method}:${uri}`);
    const nc = '00000001';
    const cnonce = crypto.randomBytes(8).toString('hex');

    const response = qop
      ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
      : md5(`${ha1}:${nonce}:${ha2}`);

    let header = `Digest username="${username}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${response}"`;
    if (qop) header += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
    if (opaque) header += `, opaque="${opaque}"`;
    if (params.algorithm) header += `, algorithm=${params.algorithm}`;
    return header;
  }

  private async digestRequest(
    method: string,
    url: string,
    username: string,
    password: string,
    options: DigestOpts = {},
  ): Promise<{ status: number; text: string }> {
    const parsed = new URL(url);
    const uri = parsed.pathname + (parsed.search || '');
    const timeout = options.timeout || 30000;

    // 1) challenge request
    const first = await axios({
      method,
      url,
      headers: { Connection: 'close' },
      data: undefined,
      httpsAgent: options.httpsAgent,
      timeout,
      validateStatus: () => true,
      responseType: 'text',
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });

    if (first.status !== 401) {
      return { status: first.status, text: first.data as string };
    }

    const wwwAuth = first.headers['www-authenticate'] as string;
    if (!wwwAuth) throw new Error("401 lekin WWW-Authenticate header yo'q");

    const params = this.parseWwwAuthenticate(wwwAuth);
    const authHeader = this.buildDigestHeader(method.toUpperCase(), uri, username, password, params);

    const headers2: any = { ...(options.headers || {}), Authorization: authHeader, Connection: 'close' };

    // FormData content-length (ba’zi qurilmalar shuni talab qiladi)
    const d: any = options.data;
    if (d && typeof d.getLengthSync === 'function' && !headers2['Content-Length']) {
      try {
        headers2['Content-Length'] = String(d.getLengthSync());
      } catch {}
    }

    const second = await axios({
      method,
      url,
      headers: headers2,
      data: options.data,
      httpsAgent: options.httpsAgent,
      timeout,
      validateStatus: () => true,
      responseType: 'text',
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });

    return { status: second.status, text: second.data as string };
  }

  // ────────────────────────────────────────────────────────
  // FDLib discovery
  // ────────────────────────────────────────────────────────

  private pickFdLib(obj: any): { faceLibType: string; FDID: string } | null {
    const cand =
      obj?.FDLib ??
      obj?.fdLib ??
      obj?.FDLibList ??
      obj?.FdLibList ??
      obj?.FDLibs ??
      obj?.data ??
      obj?.FaceLib ??
      obj?.FaceLibrary ??
      [];

    const list = Array.isArray(cand)
      ? cand
      : Array.isArray(cand?.FDLib)
        ? cand.FDLib
        : Array.isArray(cand?.list)
          ? cand.list
          : cand && typeof cand === 'object'
            ? [cand]
            : [];

    for (const it of list as any[]) {
      const faceLibType = String(it?.faceLibType ?? it?.FaceLibType ?? '');
      const FDID = String(it?.FDID ?? it?.fdid ?? it?.FdId ?? '');
      if (faceLibType && FDID) return { faceLibType, FDID };
    }

    return null;
  }

  private async getFdLibInfo(
    baseURL: string,
    agent: https.Agent | undefined,
    username: string,
    password: string,
  ) {
    const libs = await this.digestRequest(
      'GET',
      `${baseURL}/ISAPI/Intelligent/FDLib?format=json`,
      username,
      password,
      { httpsAgent: agent, timeout: 15000 },
    );

    this.logger.log(`FDLib HTTP_${libs.status}: ${libs.text.slice(0, 800)}`);

    const libsObj = this.safeJson(libs.text);
    const picked = libsObj ? this.pickFdLib(libsObj) : null;

    const caps = await this.digestRequest(
      'GET',
      `${baseURL}/ISAPI/Intelligent/FDLib/capabilities?format=json`,
      username,
      password,
      { httpsAgent: agent, timeout: 15000 },
    );

    this.logger.log(`FDLib/capabilities HTTP_${caps.status}: ${caps.text.slice(0, 800)}`);

    return { picked, libsStatus: libs.status, capsStatus: caps.status, capsText: caps.text };
  }

  // ────────────────────────────────────────────────────────
  // FDLib face upload (POST only)
  // ────────────────────────────────────────────────────────

  private async fdLibUploadOnce(params: {
    url: string;
    agent: https.Agent | undefined;
    username: string;
    password: string;
    meta: any;
    imageBuffer: Buffer;
  }): Promise<{ ok: boolean; status: number; text: string; subStatusCode?: string }> {
    const { url, agent, username, password, meta, imageBuffer } = params;

    const form = new FormData();

    form.append('FaceDataRecord', JSON.stringify(meta), {
      contentType: 'application/json',
      filename: 'FaceDataRecord.json',
    });

    form.append('FaceImage', imageBuffer, {
      contentType: 'image/jpeg',
      filename: 'face.jpg',
    });

    const res = await this.digestRequest('POST', url, username, password, {
      data: form,
      headers: form.getHeaders() as any,
      httpsAgent: agent,
      timeout: 60000,
    });

    const parsed = this.safeJson(res.text);
    const sub = parsed?.subStatusCode || parsed?.SubStatusCode;

    const ok = res.status === 200 && this.isOkResponse(res.text);
    return { ok, status: res.status, text: res.text, subStatusCode: sub ? String(sub) : undefined };
  }

  private async tryFdLibFace(
    baseURL: string,
    agent: https.Agent | undefined,
    username: string,
    password: string,
    employeeNo: string,
    personName: string,
    imageBuffer: Buffer,
  ): Promise<{ ok: boolean; status: number; text: string }> {
    this.logger.log(`img head=${imageBuffer.slice(0, 4).toString('hex')} size=${imageBuffer.length}`);

    const info = await this.getFdLibInfo(baseURL, agent, username, password);
    const picked = info.picked;

    if (!picked) {
      return {
        ok: false,
        status: 400,
        text: `FDLib not discovered. libsStatus=${info.libsStatus} capsStatus=${info.capsStatus}.`,
      };
    }

    const url = `${baseURL}/ISAPI/Intelligent/FDLib/FaceDataRecord?format=json`;

    const meta = {
      faceLibType: picked.faceLibType,
      FDID: picked.FDID,
      FPID: employeeNo,
      name: String(personName || '').slice(0, 48),
    };

    this.logger.log(`FDLib attempt: POST faceLibType=${picked.faceLibType} FDID=${picked.FDID} FPID=${employeeNo}`);

    const r = await this.fdLibUploadOnce({
      url,
      agent,
      username,
      password,
      meta,
      imageBuffer,
    });

    if (r.ok) return { ok: true, status: r.status, text: r.text };

    const sub = (r.subStatusCode || this.getSubStatus(r.text)).toLowerCase();

    if (r.status === 400 && sub === 'deviceuseralreadyexistface') {
      this.logger.warn(`⚠️ Face already exists for FPID=${employeeNo}. Treating as success.`);
      return { ok: true, status: r.status, text: r.text };
    }

    return { ok: false, status: r.status, text: r.text };
  }

  // ────────────────────────────────────────────────────────
  // UserRight (optional)
  // ────────────────────────────────────────────────────────

  private async setUserRight(params: {
    baseURL: string;
    agent: https.Agent | undefined;
    username: string;
    password: string;
    employeeNo: string;
    doorNo?: number;
    planTemplateNo?: number;
  }): Promise<{ ok: boolean; notSupported: boolean; status: number; text: string }> {
    const { baseURL, agent, username, password } = params;
    const employeeNo = String(params.employeeNo).trim();
    const doorNo = params.doorNo ?? 1;
    const planTemplateNo = params.planTemplateNo ?? 1;

    const url = `${baseURL}/ISAPI/AccessControl/UserRight/SetUp?format=json`;

    // 2 ta payload — ba’zi firmware A, ba’zilari B ishlatadi
    const payloadA = {
      UserRight: {
        employeeNo,
        RightPlan: [{ doorNo, planTemplateNo }],
      },
    };

    const payloadB = {
      UserRight: {
        employeeNo,
        doorNo,
        planTemplateNo,
      },
    };

    const doReq = async (data: any) => {
      return this.digestRequest('POST', url, username, password, {
        data: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json; charset="utf-8"' },
        httpsAgent: agent,
        timeout: 15000,
      });
    };

    const r1 = await doReq(payloadA);
    this.logger.log(`UserRight/SetUp(A) HTTP_${r1.status}: ${String(r1.text).slice(0, 400)}`);
    if (r1.status < 400 && this.isOkResponse(r1.text)) return { ok: true, notSupported: false, status: r1.status, text: r1.text };
    if (this.isNotSupported(r1.text)) return { ok: false, notSupported: true, status: r1.status, text: r1.text };

    const r2 = await doReq(payloadB);
    this.logger.log(`UserRight/SetUp(B) HTTP_${r2.status}: ${String(r2.text).slice(0, 400)}`);
    if (r2.status < 400 && this.isOkResponse(r2.text)) return { ok: true, notSupported: false, status: r2.status, text: r2.text };
    if (this.isNotSupported(r2.text)) return { ok: false, notSupported: true, status: r2.status, text: r2.text };

    return { ok: false, notSupported: false, status: r2.status, text: r2.text };
  }

  // ────────────────────────────────────────────────────────
  // PUBLIC: registerFace
  // ────────────────────────────────────────────────────────

  async registerFace(
    ip: string,
    port: number,
    username: string,
    password: string,
    employeeNo: string,
    personName: string,
    faceImageBase64: string,
    opts?: { doorNo?: number; planTemplateNo?: number },
  ): Promise<boolean> {
    const baseURL = this.buildBaseUrl(ip, port);
    const agent = this.getHttpsAgent(port);

    const emp = String(employeeNo || '').trim();
    if (!/^\d+$/.test(emp)) {
      this.logger.error(`registerFace: Invalid employeeNo (not numeric): "${emp}"`);
      return false;
    }

    try {
      // 1) UserInfo create (already exists bo‘lsa fail EMAS)
      const personData = {
        UserInfo: {
          employeeNo: emp,
          name: String(personName || '').slice(0, 48),
          userType: 'normal',
          Valid: {
            enable: true,
            beginTime: '2024-01-01T00:00:00',
            endTime: '2030-12-31T23:59:59',
          },
        },
      };

      const res1 = await this.digestRequest(
        'POST',
        `${baseURL}/ISAPI/AccessControl/UserInfo/Record?format=json`,
        username,
        password,
        {
          data: JSON.stringify(personData),
          headers: { 'Content-Type': 'application/json; charset="utf-8"' },
          httpsAgent: agent,
          timeout: 15000,
        },
      );

      this.logger.log(`UserInfo/Record HTTP_${res1.status}: ${String(res1.text).slice(0, 400)}`);

      if (res1.status >= 400 && !this.looksLikeAlreadyExists(res1.text)) {
        this.logger.warn(`UserInfo/Record failed HTTP_${res1.status}: ${String(res1.text).slice(0, 800)}`);
        return false;
      }

      // 2) Face upload (already face bo‘lsa ham TRUE)
      const imageBuffer = Buffer.from(faceImageBase64, 'base64');
      const face = await this.tryFdLibFace(baseURL, agent, username, password, emp, personName, imageBuffer);

      if (!face.ok) {
        this.logger.error(`❌ Face upload failed HTTP_${face.status}: ${String(face.text).slice(0, 1000)}`);
        return false;
      }

      this.logger.log(`✅ Face uploaded — employeeNo=${emp}`);

      // 3) UserRight (optional) — notSupport bo'lsa ham TRUE
      const right = await this.setUserRight({
        baseURL,
        agent,
        username,
        password,
        employeeNo: emp,
        doorNo: opts?.doorNo ?? 1,
        planTemplateNo: opts?.planTemplateNo ?? 1,
      });

      if (right.ok) {
        this.logger.log(`✅ UserRight set — employeeNo=${emp}`);
      } else if (right.notSupported) {
        this.logger.warn(`⚠️ UserRight not supported by firmware. Continue. employeeNo=${emp}`);
      } else {
        this.logger.warn(`⚠️ UserRight not applied. Continue anyway. HTTP_${right.status} employeeNo=${emp}`);
      }

      return true;
    } catch (e: any) {
      this.logger.error(`registerFace exception: ${this.shortErr(e)}`);
      return false;
    }
  }

  // ────────────────────────────────────────────────────────
  // DELETE USER (employeeNo)
  // ────────────────────────────────────────────────────────

  private async deleteFaceRecordFDLib(
    baseURL: string,
    agent: https.Agent | undefined,
    username: string,
    password: string,
    faceLibType: string,
    FDID: string,
    FPID: string,
  ): Promise<boolean> {
    // A) /FDDelete (PUT)
    const payloadA = { FaceDelete: { faceLibType, FDID, FPID } };

    const resA = await this.digestRequest(
      'PUT',
      `${baseURL}/ISAPI/Intelligent/FDLib/FDDelete?format=json`,
      username,
      password,
      {
        data: JSON.stringify(payloadA),
        headers: { 'Content-Type': 'application/json; charset="utf-8"' },
        httpsAgent: agent,
        timeout: 15000,
      },
    );

    this.logger.log(`FDDelete HTTP_${resA.status}: ${String(resA.text).slice(0, 500)}`);
    if (resA.status < 400) return true;

    // B) /FaceDataRecord with deleteFP (PUT)
    const payloadB = { faceLibType, FDID, FPID, deleteFP: true };

    const resB = await this.digestRequest(
      'PUT',
      `${baseURL}/ISAPI/Intelligent/FDLib/FaceDataRecord?format=json`,
      username,
      password,
      {
        data: JSON.stringify(payloadB),
        headers: { 'Content-Type': 'application/json; charset="utf-8"' },
        httpsAgent: agent,
        timeout: 15000,
      },
    );

    this.logger.log(`FaceDataRecord(deleteFP) HTTP_${resB.status}: ${String(resB.text).slice(0, 500)}`);
    return resB.status < 400;
  }

  async deleteFace(
    ip: string,
    port: number,
    username: string,
    password: string,
    employeeNo: string,
  ): Promise<boolean> {
    const baseURL = this.buildBaseUrl(ip, port);
    const agent = this.getHttpsAgent(port);

    const emp = String(employeeNo || '').trim();
    if (!/^\d+$/.test(emp)) {
      this.logger.warn(`deleteFace: Invalid employeeNo "${emp}"`);
      return false;
    }

    try {
      // 1) FDLib info
      const info = await this.getFdLibInfo(baseURL, agent, username, password);
      const picked = info.picked;

      if (!picked) {
        this.logger.warn(`FDLib not discovered, skipping face record delete`);
      } else {
        const faceDeleted = await this.deleteFaceRecordFDLib(
          baseURL,
          agent,
          username,
          password,
          picked.faceLibType,
          picked.FDID,
          emp,
        );
        this.logger.log(`FDLib face delete result: ${faceDeleted ? 'OK' : 'FAILED'}`);
      }

      // 2) Delete user (UserInfo)
      const payload = { UserInfoDelCond: { EmployeeNoList: [{ employeeNo: emp }] } };

      const res = await this.digestRequest(
        'POST',
        `${baseURL}/ISAPI/AccessControl/UserInfo/Delete?format=json`,
        username,
        password,
        {
          data: JSON.stringify(payload),
          headers: { 'Content-Type': 'application/json; charset="utf-8"' },
          httpsAgent: agent,
          timeout: 15000,
        },
      );

      if (res.status >= 400) {
        this.logger.warn(`UserInfo/Delete failed HTTP_${res.status}: ${String(res.text).slice(0, 500)}`);
        return false;
      }

      this.logger.log(`✅ User deleted: (employeeNo=${emp})`);
      return true;
    } catch (e: any) {
      this.logger.warn(`deleteFace exception: ${this.shortErr(e)}`);
      return false;
    }
  }

  // ────────────────────────────────────────────────────────
  // TEST CONNECTION
  // ────────────────────────────────────────────────────────

  async testConnection(ip: string, port: number, username: string, password: string): Promise<boolean> {
    const baseURL = this.buildBaseUrl(ip, port);
    try {
      const res = await this.digestRequest('GET', `${baseURL}/ISAPI/System/deviceInfo`, username, password, {
        httpsAgent: this.getHttpsAgent(port),
        timeout: 10000,
      });
      if (res.status >= 400) {
        this.logger.warn(`Device not OK ${ip}:${port} HTTP_${res.status}`);
        return false;
      }
      return true;
    } catch (e) {
      this.logger.warn(`Device offline ${ip}:${port} (${this.shortErr(e)})`);
      return false;
    }
  }
}