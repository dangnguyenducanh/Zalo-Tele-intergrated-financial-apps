// A phone photo is often 4000 px wide and 5–10 MB, but Vercel refuses request bodies over 4.5 MB (docs/04 §4.9).
// So the browser redraws it at most 1600 px on its longest side and sends a JPEG, usually 200–600 KB.
export const MAX_SIDE = 1600;

export function fitWithin(width: number, height: number, max = MAX_SIDE) {
  const scale = Math.min(1, max / Math.max(width, height)); // never enlarge a small photo
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

// Any image the browser can open (JPEG, PNG, WebP…) → a JPEG Blob. Rejects when the file is not an image.
// createImageBitmap applies the photo's EXIF rotation, so a portrait shot stays upright.
export async function resizeImage(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = fitWithin(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is not available');
  context.fillStyle = '#fff'; // a transparent PNG becomes white, not black, as a JPEG
  context.fillRect(0, 0, width, height);
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the image'))), 'image/jpeg', 0.85);
  });
}
