// Model lengths are millimetres. Keep all pixel and scene-unit conversions here.
function finite(value: number) {
  if (!Number.isFinite(value)) throw new Error('数值必须是有限数字。');
  return value;
}
function ratio(mmPerPixel: number) {
  if (!Number.isFinite(mmPerPixel) || mmPerPixel <= 0)
    throw new Error('比例尺必须是大于零的有限数字。');
  return mmPerPixel;
}
export function pxToMm(pixels: number, mmPerPixel: number): number {
  return finite(finite(pixels) * ratio(mmPerPixel));
}
export function mmToPx(millimetres: number, mmPerPixel: number): number {
  return finite(finite(millimetres) / ratio(mmPerPixel));
}
export function mmToMeters(millimetres: number): number {
  return finite(millimetres) / 1000;
}
export function metersToMm(metres: number): number {
  return finite(finite(metres) * 1000);
}
