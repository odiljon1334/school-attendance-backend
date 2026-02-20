import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as Papa from 'papaparse';

@Injectable()
export class CsvImportService {
  constructor(private prisma: PrismaService) {}

  // ==========================================
  // ✅ TEACHER CSV IMPORT
  // Format: #, Familiya, Ism, Sharif, Telefon
  // ==========================================
  async importTeachers(file: Express.Multer.File, schoolId: string) {
    if (!file) {
      throw new BadRequestException('File not provided');
    }

    const csvContent = file.buffer.toString('utf-8');
    const parsed = Papa.parse(csvContent, {
      header: true,
      skipEmptyLines: true,
    });

    if (parsed.errors.length > 0) {
      throw new BadRequestException('Invalid CSV format');
    }

    const results = {
      total: 0,
      success: 0,
      failed: 0,
      errors: [] as any[],
    };

    for (const row of parsed.data) {
      results.total++;
      try {
        // Extract data
        const firstName = row['Ism']?.trim();
        const lastName = row['Familiya']?.trim();
        const middleName = row['Sharif']?.trim();
        const phone = row['Telefon']?.trim();

        if (!firstName || !lastName) {
          throw new Error('First name and last name are required');
        }

        // Create teacher
        await this.prisma.teacher.create({
          data: {
            schoolId,
            firstName,
            lastName,
            phone: phone ? `+998${phone}` : null,
            type: 'TEACHER',
          },
        });

        results.success++;
      } catch (error) {
        results.failed++;
        results.errors.push({
          row: results.total,
          data: row,
          error: error.message,
        });
      }
    }

    return results;
  }

  // ==========================================
  // ✅ STUDENT CSV IMPORT
  // Format: #, Sinf, Navbat, Familiya, Ism, Sharif, Telefon
  // ==========================================
  async importStudents(file: Express.Multer.File, schoolId: string) {
    if (!file) {
      throw new BadRequestException('File not provided');
    }

    const csvContent = file.buffer.toString('utf-8');
    const parsed = Papa.parse(csvContent, {
      header: true,
      skipEmptyLines: true,
    });

    if (parsed.errors.length > 0) {
      throw new BadRequestException('Invalid CSV format');
    }

    const results = {
      total: 0,
      success: 0,
      failed: 0,
      errors: [] as any[],
    };

    for (const row of parsed.data) {
      results.total++;
      try {
        // Extract data
        const firstName = row['Ism']?.trim();
        const lastName = row['Familiya']?.trim();
        const middleName = row['Sharif']?.trim();
        const phone = row['Telefon']?.trim();
        const classSection = row['Sinf']?.trim(); // e.g., "9-D"
        const shift = row['Navbat']?.trim(); // e.g., "1"

        if (!firstName || !lastName || !classSection) {
          throw new Error('First name, last name, and class are required');
        }

        // Parse class (e.g., "9-D" → grade=9, section="D")
        const [gradeStr, section] = classSection.split('-');
        const grade = parseInt(gradeStr);

        if (!grade || !section) {
          throw new Error(`Invalid class format: ${classSection}`);
        }

        // Find or create class
        const academicYear = new Date().getFullYear().toString();
        let classRecord = await this.prisma.class.findFirst({
          where: {
            schoolId,
            grade,
            section,
            academicYear,
          },
        });

        if (!classRecord) {
          classRecord = await this.prisma.class.create({
            data: {
              schoolId,
              grade,
              section,
              academicYear,
            },
          });
        }

        // Create student
        await this.prisma.student.create({
          data: {
            schoolId,
            classId: classRecord.id,
            firstName,
            lastName,
            middleName,
            phone: phone ? `+998${phone}` : null,
            gender: 'MALE', // Default, can be updated later
          },
        });

        results.success++;
      } catch (error) {
        results.failed++;
        results.errors.push({
          row: results.total,
          data: row,
          error: error.message,
        });
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

    const errors: string[] = [];
    const requiredHeaders = ['Familiya', 'Ism', 'Telefon'];

    requiredHeaders.forEach((header) => {
      if (!parsed.meta.fields.includes(header)) {
        errors.push(`Missing required column: ${header}`);
      }
    });

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  validateStudentCSV(file: Express.Multer.File): { valid: boolean; errors: string[] } {
    const csvContent = file.buffer.toString('utf-8');
    const parsed = Papa.parse(csvContent, { header: true });

    const errors: string[] = [];
    const requiredHeaders = ['Sinf', 'Familiya', 'Ism', 'Telefon'];

    requiredHeaders.forEach((header) => {
      if (!parsed.meta.fields.includes(header)) {
        errors.push(`Missing required column: ${header}`);
      }
    });

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}