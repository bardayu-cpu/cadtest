import { z } from 'zod';
import {
  openingSchema,
  roomSchema,
  vec2Schema,
  wallSchema,
} from '../model/schema';
import type { ExpectedFloorplan, RecognitionData } from './types';

export const recognitionDataSchema = z.object({
  mmPerPixel: z.number().positive().nullable(),
  walls: z.array(wallSchema),
  openings: z.array(openingSchema),
  rooms: z.array(roomSchema),
}) satisfies z.ZodType<RecognitionData>;

export const expectedFloorplanSchema = recognitionDataSchema.extend({
  mmPerPixel: z.number().positive(),
  image: z.string().min(1),
  imageSize: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  calibration: z
    .array(
      z.object({
        label: z.string(),
        startPixel: vec2Schema,
        endPixel: vec2Schema,
        lengthMm: z.number().positive(),
      }),
    )
    .min(3),
}) satisfies z.ZodType<ExpectedFloorplan>;
