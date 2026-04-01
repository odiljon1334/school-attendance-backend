import { Injectable, Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import * as fs from 'fs';
import * as path from 'path';
import archiver from 'archiver';
import sharp from 'sharp';

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

  private buildEnrollNumber(prefix: '20' | '30', seq: number) {
    const yy = String(new Date().getFullYear()).slice(-2); // "26"
    // 001..999 (kerak bo‘lsa 4 xonaga o‘tib ketadi)
    const seqStr = String(seq).padStart(3, '0');
    return `${prefix}${yy}${seqStr}`; // masalan: 20 26 001 => 2026001
  }

  private async nextEnrollNumber(
    tx: Prisma.TransactionClient,
    schoolId: string,
    kind: 'student' | 'staff', // staff = teacher + director
  ): Promise<string> {
    // row bo‘lmasa yaratadi
    await tx.enrollCounter.upsert({
      where: { schoolId },
      create: { schoolId },
      update: {},
    });
  
    if (kind === 'student') {
      const updated = await tx.enrollCounter.update({
        where: { schoolId },
        data: { studentSeq: { increment: 1 } },
        select: { studentSeq: true },
      });
      return this.buildEnrollNumber('20', updated.studentSeq);
    }
  
    const updated = await tx.enrollCounter.update({
      where: { schoolId },
      data: { staffSeq: { increment: 1 } },
      select: { staffSeq: true },
    });
    return this.buildEnrollNumber('30', updated.staffSeq);
  }

  // =========================
  // ✅ EMPLOYEE NO GENERATOR
  // =========================
  private async nextEmployeeNo(tx: PrismaService): Promise<string> {
    const rows = await tx.$queryRawUnsafe<Array<{ n: bigint | number | string }>>(
      `SELECT nextval('employee_no_seq') as n`,
    );

    const n = rows?.[0]?.n;
    if (n === null || n === undefined) throw new Error('Failed to generate next employeeNo');

    return String(n);
  }

  private normalizeEmployeeNo(v?: string | null): string {
    const s = String(v || '').trim();
    if (!/^\d+$/.test(s)) return '';
    return s;
  }

  /**
   * ✅ ensure enrollNumber exists for each person that will be exported
   * - students: update enrollNumber if missing
   * - teachers: update enrollNumber if missing
   */
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

  // =========================
  // ✅ EXPORT SCHOOL
  // =========================
  async exportSchoolPhotos(schoolId: string): Promise<string> {
    // har request uchun unique temp
    const tempBase = path.join(process.cwd(), 'temp');
    const tempDir = path.join(tempBase, `enroll_pic_${schoolId}_${Date.now()}`);

    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    // 1) fetch users with photos (+ enrollNumber)
    const [students, teachers] = await Promise.all([
      this.prisma.student.findMany({
        where: { schoolId, photo: { not: null } },
        select: { id: true, photo: true, firstName: true, lastName: true, enrollNumber: true },
      }),
      this.prisma.teacher.findMany({
        where: { schoolId, photo: { not: null } },
        select: { id: true, photo: true, firstName: true, lastName: true, enrollNumber: true },
      }),
    ]);

    const rows: PersonRow[] = [
      ...students.map((s) => ({ ...s, kind: 'student' as const })),
      ...teachers.map((t) => ({ ...t, kind: 'teacher' as const })),
    ];

    this.logger.log(`📸 Exporting ${rows.length} photos for school=${schoolId}`);

    // 2) ensure enrollNumber exists (generate for missing)
    const empMap = await this.ensureEnrollNumbers(schoolId, rows);

    // 3) write photos
    for (const r of rows) {
      const emp = empMap.get(`${r.kind}:${r.id}`) || '';
      if (!emp) continue;

      const fileName = `${emp}_2_0_${emp}_0.jpg`;
      const filePath = path.join(tempDir, fileName);

      await this.savePhoto(r.photo, filePath);

      this.logger.log(
        `✅ ${r.kind}: ${(r.firstName || '').trim()} ${(r.lastName || '').trim()} -> ${fileName}`,
      );
    }

    // 4) zip
    const zipPath = path.join(tempBase, `enroll_pic_${schoolId}_${Date.now()}.zip`);
    await this.createZip(tempDir, zipPath);

    // 5) cleanup temp folder
    fs.rmSync(tempDir, { recursive: true, force: true });

    this.logger.log(`✅ ZIP created: ${zipPath}`);
    return zipPath;
  }

  // =========================
  // ✅ EXPORT DISTRICT
  // =========================
  async exportDistrictPhotos(districtId: string): Promise<string> {
    const schools = await this.prisma.school.findMany({
      where: { districtId },
      select: { id: true, name: true },
    });

    const tempBase = path.join(process.cwd(), 'temp');
    const rootDir = path.join(tempBase, `enroll_pic_district_${districtId}_${Date.now()}`);
    if (!fs.existsSync(rootDir)) fs.mkdirSync(rootDir, { recursive: true });

    for (const school of schools) {
      const safeName = (school.name || school.id).replace(/[^a-zA-Z0-9]/g, '_');
      const schoolDir = path.join(rootDir, safeName);
      if (!fs.existsSync(schoolDir)) fs.mkdirSync(schoolDir, { recursive: true });

      const [students, teachers] = await Promise.all([
        this.prisma.student.findMany({
          where: { schoolId: school.id, photo: { not: null } },
          select: { id: true, photo: true, firstName: true, lastName: true, enrollNumber: true },
        }),
        this.prisma.teacher.findMany({
          where: { schoolId: school.id, photo: { not: null } },
          select: { id: true, photo: true, firstName: true, lastName: true, enrollNumber: true },
        }),
      ]);

      const rows: PersonRow[] = [
        ...students.map((s) => ({ ...s, kind: 'student' as const })),
        ...teachers.map((t) => ({ ...t, kind: 'teacher' as const })),
      ];

      if (rows.length === 0) continue;

      const empMap = await this.ensureEnrollNumbers(school.id, rows);

      for (const r of rows) {
        const emp = empMap.get(`${r.kind}:${r.id}`) || '';
        if (!emp) continue;

        const fileName = `${emp}_2_0_${emp}_0.jpg`;
        const filePath = path.join(schoolDir, fileName);
        await this.savePhoto(r.photo, filePath);
      }
    }

    const zipPath = path.join(tempBase, `enroll_pic_district_${districtId}.zip`);
    await this.createZip(rootDir, zipPath);

    fs.rmSync(rootDir, { recursive: true, force: true });
    return zipPath;
  }

  // =========================
  // ZIP
  // =========================
  private async createZip(sourceDir: string, outPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(outPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', () => resolve());
      output.on('error', (e) => reject(e));
      archive.on('error', (err) => reject(err));

      archive.pipe(output);

      // enroll_pic folder name ichida bo‘lsin (terminal format)
      archive.directory(sourceDir, 'enroll_pic');
      archive.finalize();
    });
  }

  // =========================
  // PHOTO SAVE
  // =========================
  private async savePhoto(photoData: string, outputPath: string): Promise<void> {
    let rawBuffer: Buffer;

    // data:image;base64,...
    if (photoData.startsWith('data:image')) {
      const base64Data = photoData.replace(/^data:image\/\w+;base64,/, '');
      rawBuffer = Buffer.from(base64Data, 'base64');

    // http(s)
    } else if (photoData.startsWith('http')) {
      const response = await fetch(photoData);
      if (!response.ok) {
        throw new Error(`Failed to fetch photo: ${response.status} ${response.statusText}`);
      }
      rawBuffer = Buffer.from(await response.arrayBuffer());

    // local path
    } else if (fs.existsSync(photoData)) {
      rawBuffer = fs.readFileSync(photoData);

    // fallback: pure base64
    } else {
      rawBuffer = Buffer.from(photoData, 'base64');
      if (rawBuffer.length <= 10) {
        throw new Error(`Unknown photo format for outputPath=${outputPath}`);
      }
    }

    // Normalize for terminal: auto-rotate (EXIF), resize 600x600, JPEG ~85%
    // 1) Metadata o'qiymiz — EXIF va o'lchamlarni bilib olamiz
    const meta = await sharp(rawBuffer).metadata();

    // 2) EXIF bor bo'lsa — .rotate() avtomatik tuzatadi
    // EXIF yo'q + landscape (width > height) → face photo bo'lsa doim portrait bo'lishi kerak
    //   shuning uchun 90° CW burish kerak (eng keng tarqalgan holat)
    const isLandscape = (meta.width ?? 0) > (meta.height ?? 0);
    const hasExif = !!meta.orientation;

    let pipeline = sharp(rawBuffer);

    if (hasExif) {
      // EXIF bor → avtomatik to'g'ri buradi
      pipeline = pipeline.rotate();
    } else if (isLandscape) {
      // EXIF yo'q + landscape → 90° CW
      pipeline = pipeline.rotate(90);
    }

    await pipeline
      .resize(600, 600, {
        fit: 'cover',                        // kamera rasmi kabi square crop
        position: 'centre',
      })
      .jpeg({ quality: 85 })
      .toFile(outputPath);
  }
}