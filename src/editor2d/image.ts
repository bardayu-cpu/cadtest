export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_SIDE = 8192;
const MAX_IMAGE_PIXELS = 32_000_000;

export function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error('无法读取户型图，请选择有效的图片文件。'));
    image.src = source;
  });
}

export async function sanitizeFloorPlan(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    throw new Error('请选择 JPG、PNG 或 WebP 格式的户型图。');
  if (file.size > MAX_IMAGE_BYTES)
    throw new Error('图片不能超过 20 MB，请选择较小的文件。');
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    const width = image.naturalWidth,
      height = image.naturalHeight;
    if (
      !width ||
      !height ||
      width > MAX_IMAGE_SIDE ||
      height > MAX_IMAGE_SIDE ||
      width * height > MAX_IMAGE_PIXELS
    )
      throw new Error(
        '图片尺寸过大或无效，请使用边长不超过 8192 像素、总计不超过 3200 万像素的图片。',
      );
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('浏览器无法处理图片，请更换浏览器后重试。');
    // Store only redrawn pixels: original EXIF and other source metadata are discarded.
    // Preserve native dimensions so calibration remains based on source pixels.
    context.drawImage(image, 0, 0);
    const dataUrl = canvas.toDataURL('image/png');
    if (!dataUrl.startsWith('data:image/png;base64,'))
      throw new Error('图片处理失败，请重新上传。');
    return dataUrl;
  } finally {
    URL.revokeObjectURL(url);
  }
}
