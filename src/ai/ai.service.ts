import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as https from 'https';
import * as http from 'http';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private get aiServiceUrl(): string {
    return this.config.get<string>('AI_SERVICE_URL') ?? 'http://localhost:8000';
  }

  private get serviceToken(): string {
    return this.config.get<string>('AI_SERVICE_TOKEN') ?? '';
  }

  // ──────────────────────────────────────────────────────────────────────────
  // GET /ai/embeddings
  // AI service shu endpointdan barcha embeddinglarni yuklaydi
  // ──────────────────────────────────────────────────────────────────────────
  async getAllEmbeddings(schoolId?: string) {
    const where = schoolId ? { schoolId } : {};

    const embeddings = await this.prisma.faceEmbedding.findMany({
      where,
      select: {
        id: true,
        embedding: true,
        student: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
        teacher: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            type: true,
          },
        },
      },
    });

    return embeddings.map((e) => {
      const isStudent = !!e.student;
      const person = e.student || e.teacher;
      return {
        id: isStudent ? e.student!.id : e.teacher!.id,
        name: `${person?.firstName ?? ''} ${person?.lastName ?? ''}`.trim(),
        type: isStudent ? 'STUDENT' : (e.teacher?.type ?? 'TEACHER'),
        embedding: e.embedding,
      };
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // POST /ai/generate-embeddings
  // Maktab o'quvchi/o'qituvchilarining fotolaridan embedding yaratish
  // Bu endpoint AI service tomonidan ham, admin panel tomonidan ham chaqiriladi
  // ──────────────────────────────────────────────────────────────────────────
  async generateEmbeddingsForSchool(schoolId: string): Promise<{
    processed: number;
    skipped: number;
    errors: number;
  }> {
    this.logger.log(`🔄 Embedding generation: schoolId=${schoolId}`);

    // Fotosi bor o'quvchilarni olish
    const students = await this.prisma.student.findMany({
      where: { schoolId, photo: { not: null } },
      select: { id: true, firstName: true, lastName: true, photo: true },
    });

    // Fotosi bor o'qituvchilarni olish
    const teachers = await this.prisma.teacher.findMany({
      where: { schoolId, photo: { not: null } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        type: true,
        photo: true,
      },
    });

    let processed = 0;
    let skipped = 0;
    let errors = 0;

    // O'quvchilar uchun embedding yaratish
    for (const student of students) {
      try {
        const embedding = await this.extractEmbeddingFromPhoto(student.photo!);
        if (!embedding) {
          skipped++;
          continue;
        }

        await this.prisma.faceEmbedding.upsert({
          where: { studentId: student.id },
          create: {
            schoolId,
            studentId: student.id,
            embedding,
          },
          update: {
            embedding,
          },
        });

        processed++;
        this.logger.log(
          `✅ Student embedding: ${student.firstName} ${student.lastName}`,
        );
      } catch (e: any) {
        this.logger.error(`❌ Student ${student.id}: ${e?.message}`);
        errors++;
      }
    }

    // O'qituvchilar uchun embedding yaratish
    for (const teacher of teachers) {
      try {
        const embedding = await this.extractEmbeddingFromPhoto(teacher.photo!);
        if (!embedding) {
          skipped++;
          continue;
        }

        await this.prisma.faceEmbedding.upsert({
          where: { teacherId: teacher.id },
          create: {
            schoolId: schoolId,
            teacherId: teacher.id,
            embedding,
          },
          update: {
            embedding,
          },
        });

        processed++;
        this.logger.log(
          `✅ Teacher embedding: ${teacher.firstName} ${teacher.lastName}`,
        );
      } catch (e: any) {
        this.logger.error(`❌ Teacher ${teacher.id}: ${e?.message}`);
        errors++;
      }
    }

    this.logger.log(
      `✅ Embedding generation done: processed=${processed} skipped=${skipped} errors=${errors}`,
    );

    // AI service ga reload signal yuborish
    await this.reloadAiEmbeddings().catch(() => {});

    return { processed, skipped, errors };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // AI service ga foto yuborib embedding olish
  // POST http://localhost:8000/extract-embedding
  // ──────────────────────────────────────────────────────────────────────────
  private async extractEmbeddingFromPhoto(
    photoBase64: string,
  ): Promise<number[] | null> {
    try {
      const res = await this.httpPost(
        `${this.aiServiceUrl}/extract-embedding`,
        {
          photo: photoBase64,
        },
      );

      if (res?.embedding && Array.isArray(res.embedding)) {
        return res.embedding as number[];
      }
      return null;
    } catch (e: any) {
      this.logger.warn(`extractEmbedding failed: ${e?.message}`);
      return null;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // AI service ga embedding reload signal yuborish
  // ──────────────────────────────────────────────────────────────────────────
  async reloadAiEmbeddings(): Promise<void> {
    try {
      await this.httpPost(
        `${this.aiServiceUrl}/embeddings/reload`,
        {},
        {
          'x-service-token': this.serviceToken,
        },
      );
      this.logger.log('✅ AI service embeddings reloaded');
    } catch (e: any) {
      this.logger.warn(`AI service reload failed: ${e?.message}`);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // AI service status
  // ──────────────────────────────────────────────────────────────────────────
  async getAiStatus(): Promise<any> {
    try {
      return await this.httpGet(`${this.aiServiceUrl}/status`);
    } catch {
      return { error: 'AI service ulanmadi', url: this.aiServiceUrl };
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Bitta student/teacher embedding o'chirish
  // ──────────────────────────────────────────────────────────────────────────
  async deleteEmbedding(
    personId: string,
    personType: 'student' | 'teacher',
  ): Promise<void> {
    const where =
      personType === 'student'
        ? { studentId: personId }
        : { teacherId: personId };

    await this.prisma.faceEmbedding.deleteMany({ where });
    await this.reloadAiEmbeddings().catch(() => {});
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Snapshot cron — kunlik eski snapshot larni o'chirish
  // ──────────────────────────────────────────────────────────────────────────
  async cleanOldSnapshots(daysOld = 1): Promise<{ deleted: number }> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysOld);

    const result = await this.prisma.cameraEvent.updateMany({
      where: {
        createdAt: { lt: cutoff },
        snapshot: { not: null },
      },
      data: { snapshot: null },
    });

    this.logger.log(`🗑️ Snapshots cleaned: ${result.count}`);
    return { deleted: result.count };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // HTTP helpers
  // ──────────────────────────────────────────────────────────────────────────
  private httpPost(
    url: string,
    body: any,
    headers: Record<string, string> = {},
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(body);
      const urlObj = new URL(url);
      const lib = urlObj.protocol === 'https:' ? https : http;

      const req = lib.request(
        {
          hostname: urlObj.hostname,
          port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
          path: urlObj.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data),
            'x-service-token': this.serviceToken,
            ...headers,
          },
        },
        (res) => {
          let raw = '';
          res.on('data', (chunk) => (raw += chunk));
          res.on('end', () => {
            try {
              resolve(JSON.parse(raw));
            } catch {
              resolve(raw);
            }
          });
        },
      );

      req.on('error', reject);
      req.setTimeout(30000, () => {
        req.destroy();
        reject(new Error('Timeout'));
      });
      req.write(data);
      req.end();
    });
  }

  private httpGet(url: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const lib = urlObj.protocol === 'https:' ? https : http;

      const req = lib.get(
        {
          hostname: urlObj.hostname,
          port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
          path: urlObj.pathname,
          headers: { 'x-service-token': this.serviceToken },
        },
        (res) => {
          let raw = '';
          res.on('data', (chunk) => (raw += chunk));
          res.on('end', () => {
            try {
              resolve(JSON.parse(raw));
            } catch {
              resolve(raw);
            }
          });
        },
      );

      req.on('error', reject);
      req.setTimeout(10000, () => {
        req.destroy();
        reject(new Error('Timeout'));
      });
    });
  }
}
