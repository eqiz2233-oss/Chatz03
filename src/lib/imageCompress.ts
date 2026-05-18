/**
 * Client-side image compression for product photo uploads.
 *
 * Why this exists: product thumbnails were going into the DB as raw
 * base64 — a 4032×3024 phone photo can be ~6 MB raw. With 50 products,
 * one shop alone wastes hundreds of MB of DB rows and slows every page
 * load that fetches the catalog. We resize + JPEG-compress in the
 * browser before the file ever reaches the server.
 *
 * Strategy:
 *   1. Read the file via createImageBitmap (preferred, GPU-decoded,
 *      handles EXIF orientation correctly) or fall back to <img>.
 *   2. Scale down so the longest edge is ≤ MAX_EDGE px while preserving
 *      aspect ratio. No upscaling.
 *   3. Draw to an offscreen canvas, export as JPEG at QUALITY.
 *   4. Return the resulting Blob + a data: URL ready to assign to <img src>.
 *
 * The original file's transparency is lost (JPEG has no alpha). For
 * product photos this is fine; if we later need to preserve PNGs with
 * alpha we can branch on file.type.
 */

const MAX_EDGE = 1600;       // 1600px is plenty for product thumbnails
const QUALITY = 0.85;        // JPEG quality — 0.85 is sweet spot
const SKIP_IF_BELOW = 256 * 1024; // <256 KB images don't benefit from compression

export interface CompressedImage {
  dataUrl: string;
  bytes: number;
  width: number;
  height: number;
  mime: string;
}

/**
 * Compress a user-uploaded image. If anything goes wrong (corrupt file,
 * unsupported format on this browser, OOM) the function falls back to
 * returning the original file as a data URL — never throws to the caller,
 * because losing the upload entirely is worse than skipping compression.
 */
export async function compressImage(file: File): Promise<CompressedImage> {
  // Tiny files: don't bother. Compression overhead can actually make
  // already-small JPEGs slightly larger.
  if (file.size < SKIP_IF_BELOW) {
    return fileToDataUrl(file);
  }

  try {
    const bitmap = await decodeBitmap(file);
    const { width, height } = scaleToFit(bitmap.width, bitmap.height, MAX_EDGE);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d unavailable');
    ctx.drawImage(bitmap, 0, 0, width, height);
    // ImageBitmap can be released after draw.
    if ('close' in bitmap && typeof bitmap.close === 'function') bitmap.close();

    const blob = await canvasToBlob(canvas, 'image/jpeg', QUALITY);
    if (!blob) throw new Error('canvas toBlob returned null');
    const dataUrl = await blobToDataUrl(blob);
    return {
      dataUrl,
      bytes: blob.size,
      width,
      height,
      mime: 'image/jpeg',
    };
  } catch {
    // Last-resort fallback: original bytes wrapped as data URL. The caller
    // still sees a valid image — they just save the raw upload.
    return fileToDataUrl(file);
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function decodeBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  // createImageBitmap is much faster + respects EXIF on modern browsers.
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' as ImageOrientation });
    } catch {
      /* fall through to <img> */
    }
  }
  // Fallback for Safari < 14 etc.
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = (err) => reject(err);
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function scaleToFit(w: number, h: number, max: number): { width: number; height: number } {
  if (w <= max && h <= max) return { width: w, height: h };
  const ratio = Math.min(max / w, max / h);
  return {
    width: Math.round(w * ratio),
    height: Math.round(h * ratio),
  };
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const r = reader.result;
      if (typeof r === 'string') resolve(r);
      else reject(new Error('non-string FileReader result'));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function fileToDataUrl(file: File): Promise<CompressedImage> {
  const blob = file as Blob;
  const dataUrl = await blobToDataUrl(blob);
  // We don't know the real pixel dimensions without decoding, but those
  // numbers are informational only — leaving them 0 is honest.
  return {
    dataUrl,
    bytes: blob.size,
    width: 0,
    height: 0,
    mime: file.type || 'application/octet-stream',
  };
}
