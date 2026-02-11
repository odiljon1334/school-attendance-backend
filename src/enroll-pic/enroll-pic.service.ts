import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as fs from 'fs';
import * as path from 'path';
import * as archiver from 'archiver';

@Injectable()
export class EnrollPicService {
  constructor(private prisma: PrismaService) {}

  /**
   * Export all photos for a school in turnstile format
   * Creates enroll_pic.zip with format: {id}_2_0_{id}_0.jpg
   */
  async exportSchoolPhotos(schoolId: string): Promise<string> {
    // Create temp directory
    const tempDir = path.join(process.cwd(), 'temp', 'enroll_pic');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Get all users with photos from school
    const [students, teachers, directors] = await Promise.all([
      this.prisma.student.findMany({
        where: { schoolId, photo: { not: null } },
        select: { id: true, photo: true, firstName: true, lastName: true },
      }),
      this.prisma.teacher.findMany({
        where: { schoolId, photo: { not: null } },
        select: { id: true, photo: true, firstName: true, lastName: true },
      }),
      this.prisma.director.findMany({
        where: { schoolId, photo: { not: null } },
        select: { id: true, photo: true, firstName: true, lastName: true },
      }),
    ]);

    const allUsers = [
      ...students.map(s => ({ ...s, type: 'student' })),
      ...teachers.map(t => ({ ...t, type: 'teacher' })),
      ...directors.map(d => ({ ...d, type: 'director' })),
    ];

    console.log(`📸 Exporting ${allUsers.length} photos for school ${schoolId}`);

    // Save each photo with turnstile format
    for (const user of allUsers) {
      // Format: {id}_2_0_{id}_0.jpg
      const fileName = `${user.id}_2_0_${user.id}_0.jpg`;
      const filePath = path.join(tempDir, fileName);

      // Convert base64 to file if needed
      if (user.photo.startsWith('data:image')) {
        // Base64 format
        const base64Data = user.photo.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        fs.writeFileSync(filePath, buffer);
      } else if (user.photo.startsWith('http')) {
        // URL - download it
        const response = await fetch(user.photo);
        const buffer = await response.arrayBuffer();
        fs.writeFileSync(filePath, Buffer.from(buffer));
      } else {
        // File path - copy it
        if (fs.existsSync(user.photo)) {
          fs.copyFileSync(user.photo, filePath);
        }
      }

      console.log(`  ✅ ${user.type}: ${user.firstName} ${user.lastName} → ${fileName}`);
    }

    // Create ZIP file
    const zipPath = path.join(process.cwd(), 'temp', `enroll_pic_${schoolId}.zip`);
    await this.createZip(tempDir, zipPath);

    // Cleanup temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });

    console.log(`✅ ZIP created: ${zipPath}`);
    return zipPath;
  }

  /**
   * Export photos for entire district
   */
  async exportDistrictPhotos(districtId: string): Promise<string> {
    const schools = await this.prisma.school.findMany({
      where: { districtId },
      select: { id: true, name: true },
    });

    const tempDir = path.join(process.cwd(), 'temp', 'enroll_pic_district');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Export each school to subfolder
    for (const school of schools) {
      const schoolDir = path.join(tempDir, school.name.replace(/[^a-zA-Z0-9]/g, '_'));
      if (!fs.existsSync(schoolDir)) {
        fs.mkdirSync(schoolDir, { recursive: true });
      }

      // Get users
      const [students, teachers, directors] = await Promise.all([
        this.prisma.student.findMany({
          where: { schoolId: school.id, photo: { not: null } },
          select: { id: true, photo: true, firstName: true, lastName: true },
        }),
        this.prisma.teacher.findMany({
          where: { schoolId: school.id, photo: { not: null } },
          select: { id: true, photo: true, firstName: true, lastName: true },
        }),
        this.prisma.director.findMany({
          where: { schoolId: school.id, photo: { not: null } },
          select: { id: true, photo: true, firstName: true, lastName: true },
        }),
      ]);

      const allUsers = [...students, ...teachers, ...directors];

      // Save photos
      for (const user of allUsers) {
        const fileName = `${user.id}_2_0_${user.id}_0.jpg`;
        const filePath = path.join(schoolDir, fileName);
        await this.savePhoto(user.photo, filePath);
      }
    }

    // Create ZIP
    const zipPath = path.join(process.cwd(), 'temp', `enroll_pic_district_${districtId}.zip`);
    await this.createZip(tempDir, zipPath);

    // Cleanup
    fs.rmSync(tempDir, { recursive: true, force: true });

    return zipPath;
  }

  /**
   * Create ZIP archive
   */
  private async createZip(sourceDir: string, outPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(outPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', () => resolve());
      archive.on('error', (err) => reject(err));

      archive.pipe(output);
      archive.directory(sourceDir, false);
      archive.finalize();
    });
  }

  /**
   * Save photo from various formats
   */
  private async savePhoto(photoData: string, outputPath: string): Promise<void> {
    if (photoData.startsWith('data:image')) {
      // Base64
      const base64Data = photoData.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      fs.writeFileSync(outputPath, buffer);
    } else if (photoData.startsWith('http')) {
      // URL
      const response = await fetch(photoData);
      const buffer = await response.arrayBuffer();
      fs.writeFileSync(outputPath, Buffer.from(buffer));
    } else {
      // File path
      if (fs.existsSync(photoData)) {
        fs.copyFileSync(photoData, outputPath);
      }
    }
  }
}