import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const MAX_EDGE = 2400; // keeps the .docx small while staying sharp when printed

export interface SavedImage {
  file: string;
  width: number;
  height: number;
}

/**
 * Converts any raster/SVG image to PNG, caps its size, and writes it to dir/<id>.png.
 * Returns null for files that are not images or are too small to be useful (icons, emoji).
 */
export async function saveAsPng(data: Buffer, dir: string, id: string): Promise<SavedImage | null> {
  try {
    const meta = await sharp(data, { animated: false }).metadata();
    if (!meta.width || !meta.height) return null;
    if (meta.width < 48 || meta.height < 48) return null;
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${safeFileName(id)}.png`);
    const info = await sharp(data, { animated: false })
      .flatten({ background: "#ffffff" })
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toFile(file);
    return { file, width: info.width, height: info.height };
  } catch {
    return null;
  }
}

/** A smaller copy for the model to look at (Claude works best with images up to ~1568px). */
export async function previewForModel(file: string): Promise<{ base64: string; mimeType: string }> {
  const buf = await sharp(file)
    .resize({ width: 1568, height: 1568, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
  return { base64: buf.toString("base64"), mimeType: "image/jpeg" };
}

export function safeFileName(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
}

export function looksLikeImage(name: string, mime?: string): boolean {
  if (mime && mime.startsWith("image/")) return true;
  return /\.(png|jpe?g|gif|bmp|webp|tiff?|svg)$/i.test(name);
}
