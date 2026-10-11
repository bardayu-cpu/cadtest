import type { RecognitionReport, Wall } from '../model/types';
import { detectLines, detectDimensionLines } from './lines';
import { readDimensionLabels, type OcrOptions } from './ocr';
import { preprocess, type RasterImage } from './preprocess';
import { detectScale, type ScaleMeasurement } from './scale';
import { detectWalls } from './walls';

export interface RecognitionResult {
  mmPerPixel: number | null;
  walls: Wall[];
  report: RecognitionReport;
  diagnostics: {
    inverted: boolean;
    dimensionMeasurements: ScaleMeasurement[];
    durationMs: number;
    ocrError?: string;
  };
}
export interface RecognitionOptions {
  ocr?: OcrOptions;
}

async function decodeBrowserImage(image: Blob): Promise<RasterImage> {
  const bitmap = await createImageBitmap(image);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D unavailable.');
    context.drawImage(bitmap, 0, 0);
    return context.getImageData(0, 0, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}

export async function recognizeFloorPlan(
  image: RasterImage | Blob,
  options: RecognitionOptions = {},
): Promise<RecognitionResult> {
  const started = performance.now();
  const raster = 'data' in image ? image : await decodeBrowserImage(image);
  const binary = preprocess(raster);
  const lines = detectLines(binary);
  const dimensions = detectDimensionLines(lines, binary);
  let labels: Awaited<ReturnType<typeof readDimensionLabels>> = [];
  const warnings: string[] = [];
  let ocrError: string | undefined;
  if (dimensions.length) {
    try {
      labels = await readDimensionLabels(binary, options.ocr, dimensions);
    } catch (error) {
      ocrError = error instanceof Error ? error.message : String(error);
      warnings.push('数字 OCR 不可用，请检查识别资源或手动校准比例尺。');
    }
  }
  const scale = detectScale(dimensions, labels);
  warnings.push(...scale.warnings);
  const walls =
    scale.mmPerPixel === null
      ? []
      : detectWalls(
          lines.filter((line) => !dimensions.includes(line)),
          scale.mmPerPixel,
        );
  if (!walls.length) warnings.push('未检测到可靠双线墙，请人工核对或描墙。');
  else
    warnings.push(
      '仅识别比例尺和近似正交双线墙；请校对家具误检、门洞断点及未闭合墙段。',
    );
  return {
    mmPerPixel: scale.mmPerPixel,
    walls,
    report: {
      createdAt: new Date().toISOString(),
      method: 'cv',
      scaleDetected: scale.mmPerPixel !== null,
      warnings,
    },
    diagnostics: {
      inverted: binary.inverted,
      dimensionMeasurements: scale.measurements,
      durationMs: performance.now() - started,
      ...(ocrError ? { ocrError } : {}),
    },
  };
}
