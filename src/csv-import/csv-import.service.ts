import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as Papa from 'papaparse';
import { Prisma } from '@prisma/client';

@Injectable()
export class CsvImportService {
  constructor(private prisma: PrismaService) {}

  // ==========================================
  // ✅ PHONE FORMAT HELPER - Qirg'iziston
  // ==========================================
  private formatPhone(phone: string | null): string | null {
    if (!phone) return null;

    const cleaned = phone.replace(/[\s+]/g, '');

    if (cleaned.startsWith('996')) return `+${cleaned}`;
    if (cleaned.length === 9) return `+996${cleaned}`;

    return `+996${cleaned}`;
  }

  private normalizePhoneRaw(v: any): string | null {
    if (v === null || v === undefined) return null;
    let s = String(v).trim();
    if (!s) return null;

    // Excel: 9.967E+11
    if (/e\+/i.test(s)) {
      const n = Number(s);
      if (!Number.isFinite(n)) return null;
      s = Math.trunc(n).toString();
    }

    s = s.replace(/[^\d+]/g, '');
    return s || null;
  }

  private pick(row: any, keys: string[]) {
    for (const k of keys) {
      const v = row?.[k];
      if (v !== undefined && v !== null && String(v).trim() !== '') {
        return String(v).trim();
      }
    }
    return '';
  }

  private makeImportKey(schoolId: string, rowNumber: number) {
    // UNIQUE kolliziya bo‘lmasin deb random qo‘shdik
    return `${schoolId}:${Date.now()}:${rowNumber}:${Math.random().toString(16).slice(2)}`;
  }

  // ==========================================
  // ✅ IMPORT TEACHERS
  // ==========================================
  async importTeachers(file: Express.Multer.File, schoolId: string) {
    if (!file) throw new BadRequestException('File not provided');
    if (!schoolId) throw new BadRequestException('School ID is required');

    const csvContent = file.buffer.toString('utf-8');
    const parsed = Papa.parse(csvContent, { header: true, skipEmptyLines: true });

    if (parsed.errors.length > 0) {
      throw new BadRequestException({
        message: 'Invalid CSV format',
        errors: parsed.errors.map((e) => e.message),
      });
    }

    const results = { total: 0, success: 0, failed: 0, errors: [] as any[] };

    for (const row of parsed.data as any[]) {
      results.total++;

      try {
        // UZ/RU header support
        const firstName = this.pick(row, ['Ism', 'Имя']).trim();
        const lastName = this.pick(row, ['Familiya', 'Фамилия']).trim();
        const middleName = this.pick(row, ['Sharif', 'Отчество', 'Otasining ismi']).trim();
        const phoneRaw = this.normalizePhoneRaw(this.pick(row, ['Telefon', 'Телефон']));
        const phone = this.formatPhone(phoneRaw);

        // terminal ID (employeeNo)
        const enrollNumber =
          this.pick(row, ['employeeNo', 'EmployeeNo', 'EnrollNumber', 'ID']).toString().trim() || null;

        if (!firstName || !lastName) {
          throw new Error('Ism va Familiya majburiy');
        }

        // enrollNumber duplicate check (agar bo‘lsa)
        if (enrollNumber) {
        const existingEnroll = await this.prisma.teacher.findUnique({
        where: { enrollNumber },
      });

      if (existingEnroll) {
      throw new Error(`EnrollNumber ${enrollNumber} allaqachon mavjud`);
    }
  }

        const created = await this.prisma.teacher.create({
          data: {
            schoolId,
            firstName,
            lastName,
            phone: phone || undefined,
            type: 'TEACHER',
            enrollNumber,
          },
        });

        // Turnstile identity (ixtiyoriy)
        const employeeNo = this.pick(row, ['employeeNo', 'EmployeeNo', 'ID']).toString().trim();
        const deviceId = this.pick(row, ['deviceId', 'DeviceId']).toString().trim();

        if (employeeNo && deviceId) {
          await this.prisma.turnstileIdentity.upsert({
            where: { deviceId_employeeNo: { deviceId, employeeNo } },
            update: { personType: 'TEACHER', teacherId: created.id, studentId: null },
            create: {
              deviceId,
              employeeNo,
              personType: 'TEACHER',
              teacherId: created.id,
            },
          });
        }

        results.success++;
      } catch (error: any) {
        results.failed++;
        results.errors.push({ row: results.total, data: row, error: error?.message || String(error) });
      }
    }

    return results;
  }

  // ==========================================
  // ✅ IMPORT STUDENTS
  // ==========================================
  async importStudents(file: Express.Multer.File, schoolId: string) {
    if (!file) throw new BadRequestException('File not provided');
    if (!schoolId) throw new BadRequestException('School ID is required');

    // ✅ ENG katta muammo: Student modelida @@unique([schoolId])
    // Agar shu turgan bo‘lsa, birinchi studentdan keyin hammasi yiqiladi.
    // Shuning uchun importni boshidayoq to‘xtatamiz.
    const already = await this.prisma.student.count({ where: { schoolId } });
    if (already > 0) {
      throw new BadRequestException(
        `Prisma schema xato: Student modelida "@@unique([schoolId])" bor. ` +
          `Bu bitta maktabga faqat 1 ta student degani. ` +
          `Uni olib tashlamasangiz CSV import ishlamaydi.`,
      );
    }

    const csvContent = file.buffer.toString('utf-8');
    const parsed = Papa.parse(csvContent, { header: true, skipEmptyLines: true });

    if (parsed.errors.length) {
      throw new BadRequestException({
        message: 'Invalid CSV format',
        errors: parsed.errors.map((e) => e.message),
      });
    }

    const results = { total: 0, success: 0, failed: 0, errors: [] as any[] };
    const academicYear = new Date().getFullYear().toString();

    for (const row of parsed.data as any[]) {
      results.total++;

      try {
        // ✅ RU + UZ headerlarni qamrab olamiz
        // Class: "Класс" yoki "Sinf"
        const classSection = this.pick(row, ['Класс', 'Sinf', 'Class']).trim();

        // Names: "Фамилия/Имя/Отчество" yoki "Familiya/Ism/Sharif"
        const lastName = this.pick(row, ['Фамилия', 'Familiya', 'LastName']).trim();
        const firstName = this.pick(row, ['Имя', 'Ism', 'FirstName']).trim();
        const middleName = this.pick(row, ['Отчество', 'Sharif', 'MiddleName']).trim() || null;

        // Parent phone: "Телефон" yoki "Telefon"
        const parentPhoneRaw = this.normalizePhoneRaw(this.pick(row, ['Телефон', 'Telefon', 'Phone']));
        const parentPhone = this.formatPhone(parentPhoneRaw);

        // ✅ Minimal required
        if (!classSection || !firstName || !lastName) {
          throw new Error("Klass/Sinf, Ism, Familiya majburiy");
        }

        // "9-A" format
        const [gradeStr, sectionRaw] = classSection.split('-');
        const grade = parseInt((gradeStr || '').trim(), 10);
        const section = (sectionRaw || '').trim();

        if (!Number.isFinite(grade) || grade <= 0 || !section) {
          throw new Error(`Klass formati xato: ${classSection} (masalan: 9-A)`);
        }

        // class find/create
        let classRecord = await this.prisma.class.findFirst({
          where: { schoolId, grade, section, academicYear },
        });

        if (!classRecord) {
          classRecord = await this.prisma.class.create({
            data: { schoolId, grade, section, academicYear },
          });
        }

        // ✅ create student
        const importKey = this.makeImportKey(schoolId, results.total);

        let student;
        try {
          student = await this.prisma.student.create({
            data: {
              schoolId,
              classId: classRecord.id,
              firstName,
              lastName,
              middleName: null, // studentga shart emas
              phone: null,
              gender: 'MALE',
              photo: null,
              enrollNumber: null,
              importKey,
            },
          });
        } catch (e: any) {
          // Prisma unique errorlarni userga tushunarli qilamiz
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
            const target = (e.meta as any)?.target;
            if (Array.isArray(target) && target.includes('schoolId')) {
              throw new Error(
                `Schema xato: Student modelida "@@unique([schoolId])" bor. ` +
                  `Buni olib tashlang, aks holda bir maktabga 1 tadan ko‘p student qo‘sha olmaysiz.`,
              );
            }
            throw new Error(`Unique constraint: ${Array.isArray(target) ? target.join(',') : String(target)}`);
          }
          throw e;
        }

        // ✅ parent link (if phone exists)
        if (parentPhone) {
          const parent = await this.prisma.parent.upsert({
            where: { phone: parentPhone },
            update: {
              // bu yerda faqat borini yangilaymiz
              firstName: middleName ?? undefined,
            },
            create: {
              phone: parentPhone,
              firstName: middleName,
              lastName: null,
              isTelegramActive: false,
            },
          });

          // notifySms faqat bittasiga
          await this.prisma.studentParent.updateMany({
            where: { studentId: student.id },
            data: { notifySms: false },
          });

          await this.prisma.studentParent.upsert({
            where: { studentId_parentId: { studentId: student.id, parentId: parent.id } },
            update: { notifySms: true, relationship: 'PARENT' },
            create: { studentId: student.id, parentId: parent.id, notifySms: true, relationship: 'PARENT' },
          });
        }

        results.success++;
      } catch (e: any) {
        results.failed++;
        results.errors.push({ row: results.total, data: row, error: e?.message || String(e) });
      }
    }

    return results;
  }

  // ==========================================
  // ✅ VALIDATE CSV FORMAT
  // ==========================================
  validateTeacherCSV(file: Express.Multer.File): { valid: boolean; errors: string[] } {
    const csvContent = file.buffer.toString('utf-8');
    const parsed = Papa.parse(csvContent, { header: true });

    const fields = parsed.meta.fields || [];
    const errors: string[] = [];

    // RU yoki UZ bo‘lishi mumkin
    const requiredAny = [
      ['Familiya', 'Фамилия'],
      ['Ism', 'Имя'],
      ['Telefon', 'Телефон'],
    ];

    requiredAny.forEach((variants) => {
      const ok = variants.some((v) => fields.includes(v));
      if (!ok) errors.push(`Majburiy kolonka yo‘q: ${variants.join(' / ')}`);
    });

    return { valid: errors.length === 0, errors };
  }

  validateStudentCSV(file: Express.Multer.File) {
    const csvContent = file.buffer.toString('utf-8');
    const parsed = Papa.parse(csvContent, { header: true });

    const fields = parsed.meta.fields || [];
    const errors: string[] = [];

    const requiredAny = [
      ['Класс', 'Sinf', 'Class'],
      ['Фамилия', 'Familiya', 'LastName'],
      ['Имя', 'Ism', 'FirstName'],
    ];

    requiredAny.forEach((variants) => {
      const ok = variants.some((v) => fields.includes(v));
      if (!ok) errors.push(`Majburiy kolonka yo‘q: ${variants.join(' / ')}`);
    });

    return { valid: errors.length === 0, errors };
  }
}