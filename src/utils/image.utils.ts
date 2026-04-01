import sharp from 'sharp';

/**
 * Base64 yoki Buffer rasmni compress qilib, kichik base64 qaytaradi.
 * Hikvision 3-6MB rasm → ~50-100KB gacha kamaytiradi.
 *
 * @param input  - base64 string yoki Buffer
 * @param opts   - maxWidth, maxHeight (default 400x400), quality (default 80)
 * @returns      - compressed base64 string (data: prefix siz)
 */
export async function compressImage(
  input: string | Buffer,
  opts: { maxWidth?: number; maxHeight?: number; quality?: number } = {},
): Promise<string> {
  const { maxWidth = 400, maxHeight = 400, quality = 80 } = opts;

  try {
    let buffer: Buffer;

    if (Buffer.isBuffer(input)) {
      buffer = input;
    } else {
      // base64 string — data URI yoki raw base64
      const raw = input.startsWith('data:')
        ? input.split(',')[1]
        : input;
      buffer = Buffer.from(raw, 'base64');
    }

    const compressed = await sharp(buffer)
      .resize(maxWidth, maxHeight, {
        fit: 'inside',        // Aspect ratio saqlanadi
        withoutEnlargement: true, // Kichik rasmlarni kattalashtirmaydi
      })
      .jpeg({ quality })
      .toBuffer();

    return compressed.toString('base64');
  } catch (err) {
    // Compress qilib bo'lmasa — asl rasmni qaytaramiz (fallback)
    if (Buffer.isBuffer(input)) return input.toString('base64');
    const raw = input.startsWith('data:') ? input.split(',')[1] : input;
    return raw;
  }
}
