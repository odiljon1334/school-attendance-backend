/**
 * Bir martalik script: DB dagi mavjud student rasmlarini compress qiladi
 * 22 ta rasm × ~3MB = 66MB → ~22 × 50KB = ~1MB
 *
 * Ishlatish:
 *   npx ts-node -e "require('./scripts/compress-existing-photos.ts')"
 * Yoki serverda:
 *   docker exec school_backend node -e "require('./dist/scripts/compress-existing-photos.js')"
 */

import { PrismaClient } from '@prisma/client';
import sharp from 'sharp';

const prisma = new PrismaClient();

async function compressPhoto(base64: string): Promise<string> {
  const raw = base64.startsWith('data:') ? base64.split(',')[1] : base64;
  const buffer = Buffer.from(raw, 'base64');
  const compressed = await sharp(buffer)
    .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
  return compressed.toString('base64');
}

async function main() {
  console.log('🔍 Rasmli studentlarni topmoqda...');

  const students = await prisma.student.findMany({
    where: { photo: { not: null } },
    select: { id: true, firstName: true, lastName: true, photo: true },
  });

  console.log(`📊 Jami: ${students.length} ta rasm topildi\n`);

  let success = 0;
  let failed = 0;
  let totalBefore = 0;
  let totalAfter = 0;

  for (const student of students) {
    if (!student.photo) continue;

    const beforeKb = Math.round(student.photo.length / 1024);
    totalBefore += beforeKb;

    try {
      const compressed = await compressPhoto(student.photo);
      const afterKb = Math.round(compressed.length / 1024);
      totalAfter += afterKb;

      await prisma.student.update({
        where: { id: student.id },
        data: { photo: compressed },
      });

      console.log(
        `✅ ${student.lastName} ${student.firstName}: ${beforeKb}KB → ${afterKb}KB ` +
        `(${Math.round((1 - afterKb / beforeKb) * 100)}% kamaytdi)`,
      );
      success++;
    } catch (err) {
      console.error(`❌ ${student.lastName} ${student.firstName}: ${err.message}`);
      failed++;
    }
  }

  console.log('\n========================================');
  console.log(`✅ Muvaffaqiyatli: ${success} ta`);
  console.log(`❌ Xatolik:        ${failed} ta`);
  console.log(`📦 Oldin:  ${Math.round(totalBefore / 1024)} MB`);
  console.log(`📦 Keyin:  ${Math.round(totalAfter / 1024)} MB`);
  console.log(`💾 Tejaldi: ${Math.round((totalBefore - totalAfter) / 1024)} MB`);
  console.log('========================================\n');

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
