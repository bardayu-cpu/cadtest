import { z } from 'zod';

const point = z
  .object({ x: z.number().nonnegative(), y: z.number().nonnegative() })
  .strict();
export const visionPlanSchema = z
  .object({
    walls: z
      .array(
        z
          .object({
            id: z.string().min(1),
            start: point,
            end: point,
            kind: z.enum(['exterior', 'interior']),
            thicknessPixels: z.number().positive(),
          })
          .strict(),
      )
      .max(400),
    openings: z
      .array(
        z
          .object({
            kind: z.enum([
              'door',
              'window',
              'sliding_door',
              'opening',
              'floor_window',
            ]),
            wallId: z.string(),
            center: point,
            widthPixels: z.number().positive(),
          })
          .strict(),
      )
      .max(400),
    rooms: z
      .array(
        z
          .object({
            type: z.enum([
              'living',
              'dining',
              'bedroom',
              'master_bedroom',
              'kitchen',
              'bathroom',
              'study',
              'balcony',
              'entrance',
              'corridor',
              'other',
            ]),
            name: z.string(),
            polygon: z.array(point).min(3).max(100),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
export type VisionPlan = z.infer<typeof visionPlanSchema>;
export type VisionWall = VisionPlan['walls'][number];
// Keep the provider schema to its documented common subset. Strict validation
// (positive widths, bounds, counts, references) remains local and unchanged.
function providerSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(providerSchema);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key]) =>
            ![
              '$schema',
              'exclusiveMinimum',
              'minLength',
              'minItems',
              'maxItems',
            ].includes(key),
        )
        .map(([key, item]) => [key, providerSchema(item)]),
    );
  return value;
}
export const visionJsonSchema = providerSchema(
  z.toJSONSchema(visionPlanSchema),
);

export function visionSchemaForImage(width: number, height: number): unknown {
  const bound = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(bound);
    if (!value || typeof value !== 'object') return value;
    const entries = Object.entries(value);
    return Object.fromEntries(
      entries.map(([key, item]) => {
        if ((key === 'x' || key === 'y') && item && typeof item === 'object')
          return [key, { ...item, maximum: key === 'x' ? width : height }];
        return [key, bound(item)];
      }),
    );
  };
  return bound(visionJsonSchema);
}

export function validateVisionPlan(
  value: unknown,
  width: number,
  height: number,
): VisionPlan {
  const plan = visionPlanSchema.parse(value);
  const ids = new Set<string>();
  for (const wall of plan.walls) {
    if (ids.has(wall.id)) throw new Error('Duplicate vision wall ID.');
    ids.add(wall.id);
    if (Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y) < 1)
      throw new Error('Degenerate vision wall.');
  }
  const points = [
    ...plan.walls.flatMap((w) => [w.start, w.end]),
    ...plan.openings.map((o) => o.center),
    ...plan.rooms.flatMap((r) => r.polygon),
  ];
  if (points.some((p) => p.x > width || p.y > height))
    throw new Error('Vision coordinates exceed image bounds.');
  if (plan.openings.some((o) => !ids.has(o.wallId)))
    throw new Error('Unknown opening wall ID.');
  return plan;
}
