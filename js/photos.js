// Downscale photos on the device before saving (keeps storage small, strips EXIF/GPS metadata).

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Не вдалося відкрити зображення'));
    img.src = url;
  });
}

function resize(img, max, quality) {
  const w0 = img.naturalWidth, h0 = img.naturalHeight;
  const r = Math.min(1, max / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * r)), h = Math.max(1, Math.round(h0 * r));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return new Promise((resolve, reject) => {
    c.toBlob((b) => (b ? resolve({ blob: b, w, h }) : reject(new Error('Не вдалося стиснути фото'))), 'image/jpeg', quality);
  });
}

/** Returns { blob, thumb, width, height }. Re-encoding drops all EXIF data (incl. GPS). */
export async function processImage(file) {
  if (!file || !/^image\//.test(file.type || 'image/')) throw new Error('Оберіть файл зображення');
  if (file.size > 40 * 1024 * 1024) throw new Error('Файл завеликий (понад 40 МБ)');
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const full = await resize(img, 2400, 0.86);
    const thumb = await resize(img, 360, 0.72);
    return { blob: full.blob, thumb: thumb.blob, width: full.w, height: full.h };
  } finally {
    URL.revokeObjectURL(url);
  }
}
