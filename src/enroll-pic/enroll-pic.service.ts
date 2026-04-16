import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import archiver from 'archiver';
import sharp from 'sharp';

// ─── Hikvision terminal face-photo requirements ───────────────────────────────
// Min 200×200, recommended 400-600px, JPG < 200 KB
// 500×500 @ 72% ≈ 25-50 KB — optimal: kichik hajm, yuqori sifat
const FACE_SIZE    = 500;
const FACE_QUALITY = 72;

// ─── Uploads root (http → local shortcut) ────────────────────────────────────
// Photos ko'pincha "http://host:3001/uploads/..." formatida saqlanadi.
// Server o'ziga HTTP request yubormaslik uchun to'g'ridan-to'g'ri diskdan o'qiymiz.
const UPLOADS_ROOT = path.join(process.cwd(), 'uploads');

type PersonRow = {
  id: string;
  photo: string;
  firstName?: string | null;
  lastName?: string | null;
  enrollNumber?: string | null;
  kind: 'student' | 'teacher';
};

@Injectable()
export class EnrollPicService {
  private readonly logger = new Logger(EnrollPicService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─────────────────────────────────────────────────────────────────────────────
  // ENROLL NUMBER HELPERS
  // ─────────────────────────────────────────────────────────────────────────────

  private buildEnrollNumber(prefix: '20' | '30', seq: number): string {
    const yy = String(new Date().getFullYear()).slice(-2);
    return `${prefix}${yy}${String(seq).padStart(3, '0')}`;
  }

  private async nextEnrollNumber(
    tx: Prisma.TransactionClient,
    schoolId: string,
    kind: 'student' | 'staff',
  ): Promise<string> {
    await tx.enrollCounter.upsert({
      where: { schoolId },
      create: { schoolId },
      update: {},
    });

    if (kind === 'student') {
      const u = await tx.enrollCounter.update({
        where: { schoolId },
        data: { studentSeq: { increment: 1 } },
        select: { studentSeq: true },
      });
      return this.buildEnrollNumber('20', u.studentSeq);
    }

    const u = await tx.enrollCounter.update({
      where: { schoolId },
      data: { staffSeq: { increment: 1 } },
      select: { staffSeq: true },
    });
    return this.buildEnrollNumber('30', u.staffSeq);
  }

  private normalizeEmployeeNo(v?: string | null): string {
    const s = String(v || '').trim();
    return /^\d+$/.test(s) ? s : '';
  }

  private async ensureEnrollNumbers(
    schoolId: string,
    rows: PersonRow[],
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const missing: PersonRow[] = [];

    for (const r of rows) {
      const emp = this.normalizeEmployeeNo(r.enrollNumber);
      if (emp) out.set(`${r.kind}:${r.id}`, emp);
      else missing.push(r);
    }

    if (missing.length === 0) return out;

    await this.prisma.$transaction(async (tx) => {
      for (const r of missing) {
        const emp =
          r.kind === 'student'
            ? await this.nextEnrollNumber(tx, schoolId, 'student')
            : await this.nextEnrollNumber(tx, schoolId, 'staff');

        if (r.kind === 'student') {
          await tx.student.update({ where: { id: r.id }, data: { enrollNumber: emp } });
        } else {
          await tx.teacher.update({ where: { id: r.id }, data: { enrollNumber: emp } });
        }
        out.set(`${r.kind}:${r.id}`, emp);
      }
    });

    return out;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PHOTO: raw buffer extraction  (optimized: http:// → local disk)
  // ─────────────────────────────────────────────────────────────────────────────
  private async getRawBuffer(photoData: string): Promise<Buffer> {
    // 1. base64 data-URI
    if (photoData.startsWith('data:image')) {
      return Buffer.from(
        photoData.replace(/^data:image\/\w+;base64,/, ''),
        'base64',
      );
    }

    // 2. http / https URL → local shortcut first, then network fallback
    if (photoData.startsWith('http')) {
      // Extract everything after "/uploads/"
      const uploadsIdx = photoData.indexOf('/uploads/');
      if (uploadsIdx !== -1) {
        const rel      = photoData.slice(uploadsIdx + '/uploads/'.length);
        const localPath = path.join(UPLOADS_ROOT, rel);
        if (fs.existsSync(localPath)) {
          return fsp.readFile(localPath);      // disk — ~1ms, no HTTP!
        }
      }
      // Fallback: real HTTP request (external CDN, etc.)
      const res = await fetch(photoData, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status} fetching photo`);
      return Buffer.from(await res.arrayBuffer());
    }

    // 3. Absolute / relative local path
    if (fs.existsSync(photoData)) {
      return fsp.readFile(photoData);
    }

    // 4. Bare base64 fallback
    const buf = Buffer.from(photoData, 'base64');
    if (buf.length <= 10) throw new Error(`Cannot decode photo (length=${buf.length})`);
    return buf;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PHOTO: process + save  (single-pass sharp — no double decode)
  // ─────────────────────────────────────────────────────────────────────────────
  private async savePhoto(photoData: string, outputPath: string): Promise<void> {
    const raw = await this.getRawBuffer(photoData);

    // Single sharp pipeline:
    //  .rotate()            — auto-corrects EXIF orientation (no-op if no EXIF)
    //  .resize(500,500)     — cover crop, centre
    //  .jpeg({quality:72})  — Hikvision face terminal optimal
    //
    // Note: landscape-without-EXIF will be centre-cropped (face stays visible).
    // Separate metadata() call removed → saves one full buffer decode per photo.
    await sharp(raw)
      .rotate()
      .resize(FACE_SIZE, FACE_SIZE, { fit: 'cover', position: 'centre' })
      .jpeg({ quality: FACE_QUALITY, mozjpeg: false })
      .toFile(outputPath);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PARALLEL PHOTO PROCESSOR  (concurrency=20)
  // ─────────────────────────────────────────────────────────────────────────────
  private async processPhotosParallel(
    rows: PersonRow[],
    empMap: Map<string, string>,
    outputDir: string,
    concurrency = 20,
  ): Promise<{ ok: number; failed: number }> {
    let ok = 0;
    let failed = 0;

    for (let i = 0; i < rows.length; i += concurrency) {
      const chunk = rows.slice(i, i + concurrency);
      const results = await Promise.allSettled(
        chunk.map(async (r) => {
          const emp = empMap.get(`${r.kind}:${r.id}`) ?? '';
          if (!emp) return;
          const fileName = `${emp}_2_0_${emp}_0.jpg`;
          await this.savePhoto(r.photo, path.join(outputDir, fileName));
        }),
      );
      for (const res of results) {
        if (res.status === 'fulfilled') ok++;
        else {
          failed++;
          this.logger.warn(`Photo failed: ${(res as any).reason?.message}`);
        }
      }
    }
    return { ok, failed };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // EXPORT SCHOOL
  // ─────────────────────────────────────────────────────────────────────────────
  async exportSchoolPhotos(schoolId: string): Promise<string> {
    const tempBase = path.join(process.cwd(), 'temp');
    const tempDir  = path.join(tempBase, `ep_${schoolId}_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    const t0 = Date.now();

    const [students, teachers] = await Promise.all([
      this.prisma.student.findMany({
        where:  { schoolId, photo: { not: null } },
        select: { id: true, photo: true, firstName: true, lastName: true, enrollNumber: true },
      }),
      this.prisma.teacher.findMany({
        where:  { schoolId, photo: { not: null } },
        select: { id: true, photo: true, firstName: true, lastName: true, enrollNumber: true },
      }),
    ]);

    // Filter out empty strings
    const rows: PersonRow[] = [
      ...students.filter(s => s.photo).map(s => ({ ...s, photo: s.photo!, kind: 'student' as const })),
      ...teachers.filter(t => t.photo).map(t => ({ ...t, photo: t.photo!, kind: 'teacher' as const })),
    ];

    this.logger.log(`📸 Export start: ${rows.length} photos, school=${schoolId}`);

    const empMap          = await this.ensureEnrollNumbers(schoolId, rows);
    const { ok, failed }  = await this.processPhotosParallel(rows, empMap, tempDir);

    const zipPath = path.join(tempBase, `ep_${schoolId}_${Date.now()}.zip`);
    await this.createZip(tempDir, zipPath);
    fs.rmSync(tempDir, { recursive: true, force: true });

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const sizeMB  = (fs.statSync(zipPath).size / 1024 / 1024).toFixed(1);
    this.logger.log(`✅ ZIP ready: ${sizeMB} MB in ${elapsed}s — ok:${ok} failed:${failed}`);

    return zipPath;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // EXPORT DISTRICT
  // ─────────────────────────────────────────────────────────────────────────────
  async exportDistrictPhotos(districtId: string): Promise<string> {
    const schools = await this.prisma.school.findMany({
      where:  { districtId },
      select: { id: true, name: true },
    });

    const tempBase = path.join(process.cwd(), 'temp');
    const rootDir  = path.join(tempBase, `ep_dist_${districtId}_${Date.now()}`);
    fs.mkdirSync(rootDir, { recursive: true });

    this.logger.log(`📸 District export: ${schools.length} schools`);
    const t0 = Date.now();

    const SCHOOL_CONCURRENCY = 3;
    for (let i = 0; i < schools.length; i += SCHOOL_CONCURRENCY) {
      const chunk = schools.slice(i, i + SCHOOL_CONCURRENCY);
      await Promise.allSettled(
        chunk.map(async (school) => {
          const safeName = (school.name || school.id).replace(/[^a-zA-Z0-9]/g, '_');
          const schoolDir = path.join(rootDir, safeName);
          fs.mkdirSync(schoolDir, { recursive: true });

          const [students, teachers] = await Promise.all([
            this.prisma.student.findMany({
              where:  { schoolId: school.id, photo: { not: null } },
              select: { id: true, photo: true, firstName: true, lastName: true, enrollNumber: true },
            }),
            this.prisma.teacher.findMany({
              where:  { schoolId: school.id, photo: { not: null } },
              select: { id: true, photo: true, firstName: true, lastName: true, enrollNumber: true },
            }),
          ]);

          const rows: PersonRow[] = [
            ...students.filter(s => s.photo).map(s => ({ ...s, photo: s.photo!, kind: 'student' as const })),
            ...teachers.filter(t => t.photo).map(t => ({ ...t, photo: t.photo!, kind: 'teacher' as const })),
          ];
          if (rows.length === 0) return;

          const empMap = await this.ensureEnrollNumbers(school.id, rows);
          await this.processPhotosParallel(rows, empMap, schoolDir);
        }),
      );
    }

    const zipPath = path.join(tempBase, `ep_dist_${districtId}.zip`);
    await this.createZip(rootDir, zipPath);
    fs.rmSync(rootDir, { recursive: true, force: true });

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const sizeMB  = (fs.statSync(zipPath).size / 1024 / 1024).toFixed(1);
    this.logger.log(`✅ District ZIP ready: ${sizeMB} MB in ${elapsed}s`);

    return zipPath;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ZIP — level:0 (STORE)  JPEG fayllar allaqachon siqilgan
  // ─────────────────────────────────────────────────────────────────────────────
  private createZip(sourceDir: string, outPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const output  = fs.createWriteStream(outPath);
      const archive = archiver('zip', { zlib: { level: 0 } });

      output.on('close', resolve);
      output.on('error', reject);
      archive.on('error', reject);

      archive.pipe(output);
      archive.directory(sourceDir, 'enroll_pic');
      archive.finalize();
    });
  }
}
