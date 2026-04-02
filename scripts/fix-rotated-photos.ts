/**
 * Bir martalik script: DB dagi yonbosh (landscape) rasmlarni to'g'rilaydi.
 *
 * Muammo: avvalgi compress script EXIF strip qilgan, lekin rotate qilmagan.
 * Natija: portret suratlar landscape holatda DB da saqlanib qolgan.
 *
 * Yechim: landscape rasm (width > height) bo'lsa → 90° buramiz.
 *
 * Serverda ishlatish:
 *   docker exec -it school_backend sh -c "cd /app && node fix-rotated-photos.js"
 */

import { PrismaClient } from '@prisma/client';
import sharp from 'sharp';

const prisma = new PrismaClient();

async function fixPhoto(base64: string): Promise<{ fixed: string; wasRotated: boolean }> {
  const raw = base64.startsWith('data:') ? base64.split(',')[1] : base64;
  const buffer = Buffer.from(raw, 'base64');

  const meta = await sharp(buffer).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;

  // Portrait uchun width < height bo'lishi kerak.
  // Agar landscape bo'lsa — yonbosh saqlangan, 90° CW buramiz.
  const isLandscape = w > h;

  let pipeline = sharp(buffer).rotate(); // EXIF bor bo'lsa auto-rotate

  if (isLandscape) {
    // EXIF yo'q + landscape = yonbosh saqlangan portret rasm
    pipeline = sharp(buffer).rotate(90);
  }

  const fixed = await pipeline
    .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();

  return {
    fixed: fixed.toString('base64'),
    wasRotated: isLandscape,
  };
}

async function main() {
  console.log('🔍 Rasmli studentlarni topmoqda...');

  const students = await prisma.student.findMany({
    where: { photo: { not: null } },
    select: { id: true, firstName: true, lastName: true, photo: true },
  });

  console.log(`📊 Jami: ${students.length} ta rasm topildi\n`);

  let rotated = 0;
  let skipped = 0;
  let failed = 0;

  for (const student of students) {
    if (!student.photo) continue;

    try {
      const { fixed, wasRotated } = await fixPhoto(student.photo);

      await prisma.student.update({
        where: { id: student.id },
        data: { photo: fixed },
      });

      if (wasRotated) {
        console.log(`🔄 Rotated: ${student.lastName} ${student.firstName}`);
        rotated++;
      } else {
        console.log(`✅ OK:      ${student.lastName} ${student.firstName}`);
        skipped++;
      }
    } catch (err: any) {
      console.error(`❌ Xato: ${student.lastName} ${student.firstName}: ${err.message}`);
      failed++;
    }
  }

  console.log('\n========================================');
  console.log(`🔄 Rotated (to'g'irlandi): ${rotated} ta`);
  console.log(`✅ OK (avvaldanoq to'g'ri): ${skipped} ta`);
  console.log(`❌ Xatolik:                 ${failed} ta`);
  console.log('========================================\n');

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
